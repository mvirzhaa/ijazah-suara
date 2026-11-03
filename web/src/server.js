const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { pool, migrate, waitForDb, toVector } = require('./db');
const keys = require('./keys');
const payload = require('./payload');
const docu = require('./document');
const qr = require('./qr');
const voice = require('./voice');
const { diplomaPdf } = require('./pdf');

const app = express();
if (config.basePath) {
  app.use((req, res, next) => {
    if (req.url === config.basePath) {
      return res.redirect(301, config.basePath + '/');
    }
    if (req.url.startsWith(config.basePath + '/')) {
      req.url = req.url.slice(config.basePath.length);
    }
    next();
  });
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/jsQR.js', express.static(require.resolve('jsqr/dist/jsQR.js')));
app.use('/vendor/zxing', express.static(path.join(qr.ZXING_DIR, 'dist')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireAdmin = (req, res, next) => {
  if (!config.adminToken || req.get('x-admin-token') === config.adminToken) return next();
  res.status(401).json({ error: 'Token admin diperlukan untuk tindakan ini.' });
};
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const wavDataUrl = (buf) => 'data:audio/wav;base64,' + Buffer.from(buf).toString('base64');

// ---------------------------------------------------------------- umum
app.get('/api/health', wrap(async (req, res) => {
  const v = await voice.health().catch((e) => ({ ok: false, error: e.message }));
  await pool.query('SELECT 1');
  res.json({ ok: true, voiceService: v, codecMode: config.codecMode, matchThreshold: config.matchThreshold, keyId: keys.issuerKey().keyId.toString('hex') });
}));

app.get('/api/config', (req, res) => res.json({
  codecMode: config.codecMode, matchThreshold: config.matchThreshold, institution: config.institution, adminRequired: !!config.adminToken, basePath: config.basePath, publicBaseUrl: config.publicBaseUrl,
}));

// ---------------------------------------------------------------- penutur & rekaman
app.get('/api/speakers', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.role, s.created_at, count(r.id)::int AS recordings
       FROM speakers s LEFT JOIN voice_recordings r ON r.speaker_id = s.id
      GROUP BY s.id ORDER BY s.name`);
  res.json(rows);
}));

app.post('/api/speakers', requireAdmin, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim(), role = String(req.body.role || '').trim();
  if (!name) return bad(res, 'Nama penutur wajib diisi.');
  const { rows } = await pool.query('INSERT INTO speakers (name, role) VALUES ($1, $2) RETURNING *', [name, role || null]);
  res.status(201).json(rows[0]);
}));

app.get('/api/speakers/:id/recordings', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, purpose, codec_mode, duration_s, octet_length(codec_bits) AS codec_bytes, created_at
       FROM voice_recordings WHERE speaker_id = $1 ORDER BY created_at DESC`, [req.params.id]);
  res.json(rows);
}));

async function storeRecording(speakerId, purpose, file, client = pool, processed = null) {
  const v = processed || await voice.processRecording(file.buffer, file.mimetype, file.originalname);
  const { rows } = await client.query(
    `INSERT INTO voice_recordings (speaker_id, purpose, upload_mime, upload_bytes, original_wav, codec_mode, codec_bits, decoded_wav, duration_s, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector) RETURNING id, created_at`,
    [speakerId, purpose, file.mimetype, file.buffer, v.originalWav, v.mode, v.codecBits, v.decodedWav, v.durationS, toVector(v.embedding)]);
  return { id: rows[0].id, createdAt: rows[0].created_at, ...v };
}

app.post('/api/speakers/:id/recordings', requireAdmin, upload.single('audio'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'Berkas audio tidak ada.');
  const sp = await pool.query('SELECT id FROM speakers WHERE id = $1', [req.params.id]);
  if (!sp.rows.length) return bad(res, 'Penutur tidak ditemukan.', 404);
  const r = await storeRecording(req.params.id, 'enrollment', req.file);
  res.status(201).json({ id: r.id, durationS: r.durationS, codecBytes: r.codecBits.length, mode: r.mode });
}));

app.get('/api/recordings/:id/audio', wrap(async (req, res) => {
  const col = req.query.kind === 'decoded' ? 'decoded_wav' : 'original_wav';
  const { rows } = await pool.query(`SELECT ${col} AS wav FROM voice_recordings WHERE id = $1`, [req.params.id]);
  if (!rows.length) return bad(res, 'Rekaman tidak ditemukan.', 404);
  res.type('audio/wav').send(rows[0].wav);
}));

// ---------------------------------------------------------------- ijazah
app.post('/api/diplomas', requireAdmin, upload.single('audio'), wrap(async (req, res) => {
  const d = {};
  for (const k of docu.FIELDS) d[k] = String(req.body[k] || '').trim();
  const err = docu.validate(d);
  if (err) return bad(res, err);
  if (!req.file) return bad(res, 'Rekaman suara pernyataan penanda tangan wajib ada.');
  const sp = await pool.query('SELECT * FROM speakers WHERE id = $1', [req.body.signer_speaker_id]);
  if (!sp.rows.length) return bad(res, 'Penanda tangan belum dipilih atau tidak ditemukan.');
  const signer = sp.rows[0];
  const dup = await pool.query('SELECT 1 FROM diplomas WHERE nomor_ijazah = $1', [d.nomor_ijazah]);
  if (dup.rows.length) return bad(res, `Nomor ijazah ${d.nomor_ijazah} sudah pernah diterbitkan.`, 409);

  // Gerbang suara: pernyataan harus cocok dengan sampel suara penanda tangan yang terdaftar.
  // Tanpa ini, rekaman suara orang lain akan tersimpan atas nama penanda tangan.
  const processed = await voice.processRecording(req.file.buffer, req.file.mimetype, req.file.originalname);
  const g = await pool.query(
    `SELECT max(1 - (embedding <=> $1::vector)) AS best, count(*)::int AS n
       FROM voice_recordings WHERE speaker_id = $2 AND purpose = 'enrollment'`, [toVector(processed.embedding), signer.id]);
  const issuanceSimilarity = g.rows[0].best === null ? null : Math.round(Number(g.rows[0].best) * 1000) / 10;
  if (config.issuanceVoiceCheck) {
    if (!g.rows[0].n) return bad(res, `${signer.name} belum memiliki sampel suara. Rekam sampel di halaman Basis data suara terlebih dahulu.`, 422);
    if (issuanceSimilarity < config.matchThreshold) {
      return bad(res, `Suara pernyataan tidak cocok dengan sampel suara ${signer.name} (kemiripan ${issuanceSimilarity}%, ambang ${config.matchThreshold}%). Ijazah tidak diterbitkan.`, 422);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rec = await storeRecording(signer.id, 'issuance', req.file, client, processed);
    const canonicalJson = docu.canonical(d, config.institution.name, signer);
    const docHash = docu.sha256(canonicalJson);
    const k = keys.issuerKey();
    const p = payload.build({ codecMode: rec.mode, voice: rec.codecBits, issuedAt: Date.now(), docHash, keyId: k.keyId, nomorIjazah: d.nomor_ijazah, privateKey: k.privateKey });
    const qi = qr.info(p); // melempar galat bila tidak muat di QR versi 40
    const { rows } = await client.query(
      `INSERT INTO diplomas (nomor_ijazah, nama, nim, tempat_lahir, tanggal_lahir, program_studi, fakultas, gelar, tanggal_lulus,
                             signer_speaker_id, recording_id, canonical_json, doc_hash, key_id, payload, qr_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [d.nomor_ijazah, d.nama, d.nim, d.tempat_lahir, d.tanggal_lahir, d.program_studi, d.fakultas, d.gelar, d.tanggal_lulus,
        signer.id, rec.id, canonicalJson, docHash, k.keyId, p, qi.version]);
    await client.query('COMMIT');
    res.status(201).json({ id: rows[0].id, payloadBytes: p.length, voiceBytes: rec.codecBits.length, qrVersion: qi.version, qrModules: qi.modules,
      docHash: docHash.toString('hex'), durationS: rec.durationS, codecMode: rec.mode, issuanceSimilarityPct: issuanceSimilarity });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}));

app.get('/api/diplomas', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.nomor_ijazah, d.nama, d.nim, d.program_studi, d.gelar, d.tanggal_lulus, d.qr_version, d.revoked, d.issued_at,
            octet_length(d.payload) AS payload_bytes, s.name AS signer_name, s.role AS signer_role
       FROM diplomas d JOIN speakers s ON s.id = d.signer_speaker_id ORDER BY d.issued_at DESC`);
  res.json(rows);
}));

async function loadDiploma(where, val) {
  const { rows } = await pool.query(
    `SELECT d.*, s.name AS signer_name, s.role AS signer_role FROM diplomas d JOIN speakers s ON s.id = d.signer_speaker_id WHERE ${where} = $1`, [val]);
  return rows[0];
}

app.get('/api/diplomas/:id/qr.png', wrap(async (req, res) => {
  const d = await loadDiploma('d.id', req.params.id);
  if (!d) return bad(res, 'Ijazah tidak ditemukan.', 404);
  res.type('png').send(await qr.png(d.payload, 6));
}));

app.get('/api/diplomas/:id/pdf', wrap(async (req, res) => {
  const d = await loadDiploma('d.id', req.params.id);
  if (!d) return bad(res, 'Ijazah tidak ditemukan.', 404);
  const pdf = await diplomaPdf(d, { name: d.signer_name, role: d.signer_role });
  res.type('pdf').set('Content-Disposition', `inline; filename="ijazah-${d.nomor_ijazah.replace(/[^\w.-]+/g, '_')}.pdf"`).send(pdf);
}));

app.post('/api/diplomas/:id/revoke', requireAdmin, wrap(async (req, res) => {
  const r = await pool.query('UPDATE diplomas SET revoked = true WHERE id = $1 RETURNING id', [req.params.id]);
  if (!r.rowCount) return bad(res, 'Ijazah tidak ditemukan.', 404);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- verifikasi
// Pembanding hanya sampel suara terdaftar (enrollment). Rekaman penerbitan sendiri tidak dipakai
// karena isinya identik dengan suara di QR (selalu ~100%) dan tidak menambah bukti.
async function topMatches(embedding, limit = 3) {
  const { rows } = await pool.query(
    `SELECT r.id AS recording_id, r.purpose, r.created_at, s.id AS speaker_id, s.name, s.role,
            1 - (r.embedding <=> $1::vector) AS similarity
       FROM voice_recordings r JOIN speakers s ON s.id = r.speaker_id
      WHERE r.purpose = 'enrollment'
      ORDER BY r.embedding <=> $1::vector LIMIT $2`, [toVector(embedding), limit]);
  return rows.map((r, i) => {
    const pct = Math.max(0, Math.min(100, Number(r.similarity) * 100));
    return { rank: i + 1, recordingId: r.recording_id, speakerId: r.speaker_id, speakerName: r.name, speakerRole: r.role, purpose: r.purpose,
      recordedAt: r.created_at, similarityPct: Math.round(pct * 10) / 10, meetsThreshold: pct >= config.matchThreshold };
  });
}

async function verifyBytes(bytes) {
  const out = { checks: {}, valid: false };
  let p;
  try { p = payload.parse(bytes); } catch (e) {
    out.checks.format = { ok: false, message: e.message };
    return out;
  }
  out.checks.format = { ok: true, message: `Format VQ v2, Codec 2 mode ${p.codecMode}, ${bytes.length} byte` };
  out.payload = { nomorIjazah: p.nomorIjazah, issuedAt: p.issuedAt, docHash: p.docHash.toString('hex'), keyId: p.keyId.toString('hex'), codecMode: p.codecMode, voiceBytes: p.voiceLen, totalBytes: bytes.length };

  const pk = await keys.publicKeyById(p.keyId);
  const sigOk = !!pk && payload.verifySignature(p, pk.key);
  out.checks.signature = { ok: sigOk, message: !pk ? 'Kunci penerbit tidak dikenal' : sigOk ? 'Tanda tangan digital Ed25519 sah' : 'Tanda tangan tidak sah: isi QR telah diubah atau bukan dari penerbit ini' };

  const d = await loadDiploma('d.nomor_ijazah', p.nomorIjazah);
  if (!d) {
    out.checks.document = { ok: false, message: `Ijazah nomor ${p.nomorIjazah} tidak terdaftar di basis data` };
  } else {
    const recomputed = docu.sha256(docu.canonical(d, config.institution.name, { name: d.signer_name, role: d.signer_role }));
    const hashOk = recomputed.equals(p.docHash);
    out.checks.document = { ok: hashOk, message: hashOk ? 'Hash dokumen cocok dengan data ijazah terdaftar' : 'Hash dokumen TIDAK cocok: data ijazah berbeda dari yang ditandatangani' };
    out.checks.revocation = { ok: !d.revoked, message: d.revoked ? 'Ijazah ini telah DICABUT' : 'Ijazah tidak dicabut' };
    out.diploma = { id: d.id, nomor_ijazah: d.nomor_ijazah, nama: d.nama, nim: d.nim, tempat_lahir: d.tempat_lahir, tanggal_lahir: d.tanggal_lahir,
      program_studi: d.program_studi, fakultas: d.fakultas, gelar: d.gelar, tanggal_lulus: d.tanggal_lulus, signer: { id: d.signer_speaker_id, name: d.signer_name, role: d.signer_role },
      issuanceRecordingId: d.recording_id };
  }
  out.valid = out.checks.signature.ok && out.checks.document.ok && (!out.checks.revocation || out.checks.revocation.ok);

  // suara: sintesis dari QR lalu cari 3 rekaman paling mirip
  const dec = await voice.decode(p.voice, p.codecMode);
  out.voice = { durationS: dec.durationS, audio: wavDataUrl(dec.decodedWav) };
  out.matches = await topMatches(dec.embedding, 3);
  out.matchThreshold = config.matchThreshold;
  const best = out.matches.find((m) => m.meetsThreshold);
  out.checks.voice = !best
    ? { ok: false, message: `Tidak ada rekaman di basis data dengan kemiripan ≥ ${config.matchThreshold}%` }
    : d && best.speakerId !== d.signer_speaker_id
      ? { ok: false, message: `Suara paling mirip milik ${best.speakerName}, bukan penanda tangan ijazah (${d.signer_name})` }
      : { ok: true, message: `Suara cocok dengan ${best.speakerName} (${best.similarityPct}%)` };

  await pool.query('INSERT INTO verifications (diploma_id, valid, result) VALUES ($1,$2,$3)',
    [d ? d.id : null, out.valid, JSON.stringify({ checks: out.checks, payload: out.payload, matches: out.matches })]);
  return out;
}

app.post('/api/verify', wrap(async (req, res) => {
  const b64 = req.body.payload_b64;
  if (!b64) return bad(res, 'payload_b64 wajib diisi.');
  res.json(await verifyBytes(Buffer.from(b64, 'base64')));
}));

app.post('/api/verify-image', upload.single('image'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'Berkas gambar tidak ada.');
  let bytes;
  try { bytes = await qr.decodeImage(req.file.buffer); } catch (e) { return bad(res, e.message, 422); }
  res.json(await verifyBytes(bytes));
}));

// ---------------------------------------------------------------- galat
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Terjadi kesalahan pada server.' });
});

async function start() {
  await waitForDb();
  await migrate();
  const k = await keys.loadOrCreateIssuerKey();
  return app.listen(config.port, () => console.log(`Ijazah Bersuara berjalan di http://localhost:${config.port} (kunci ${k.keyId.toString('hex')}, Codec 2 ${config.codecMode}, ambang ${config.matchThreshold}%)`));
}

if (require.main === module) start().catch((e) => { console.error(e); process.exit(1); });
module.exports = { app, start, verifyBytes };
