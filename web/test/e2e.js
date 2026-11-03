// Uji ujung ke ujung terhadap server yang sedang berjalan (BASE_URL, default http://localhost:3000).
// Membutuhkan basis data kosong. Membutuhkan `pdftoppm` (poppler-utils) untuk merender PDF menjadi gambar.
//
//  1. mendaftarkan penutur uji (3 sampel) dan 5 penutur lain sebagai pembanding
//  2. menerbitkan ijazah dengan rekaman ke-4 penutur uji (tidak ada di sampel)
//  3. merender PDF ijazah menjadi gambar 150 dpi (seperti hasil pindaian) dan memverifikasinya
//  4. uji perusakan: data ijazah diubah, 1 bit QR diubah, ijazah dicabut
//  5. ijazah dengan suara orang lain: kriptografi sah tetapi kecocokan suara harus gagal
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('pg');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const FX = path.join(__dirname, 'fixtures');
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failures++; };

async function call(p, opts = {}) {
  const res = await fetch(BASE + p, opts);
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`${p}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}
const json = (p, obj) => call(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
function form(fields, fileField, filePath) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (fileField) fd.append(fileField, new Blob([fs.readFileSync(filePath)], { type: filePath.endsWith('.webm') ? 'audio/webm' : filePath.endsWith('.png') ? 'image/png' : filePath.endsWith('.jpg') ? 'image/jpeg' : 'audio/wav' }), path.basename(filePath));
  return fd;
}
const enroll = (id, f) => call(`/api/speakers/${id}/recordings`, { method: 'POST', body: form({}, 'audio', path.join(FX, f)) });

function renderPdfToImage(pdfBuf, dpi = 150) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ijazah-'));
  fs.writeFileSync(path.join(dir, 'i.pdf'), pdfBuf);
  execFileSync('pdftoppm', ['-png', '-r', String(dpi), '-singlefile', path.join(dir, 'i.pdf'), path.join(dir, 'page')]);
  return path.join(dir, 'page.png');
}
const summary = (r) => r.matches.map((m) => `${m.speakerName} ${m.similarityPct}%${m.meetsThreshold ? ' ✓' : ''}`).join(' | ');

(async () => {
  const health = await call('/api/health');
  console.log(`Server: Codec 2 ${health.codecMode}, ambang ${health.matchThreshold}%, layanan suara ${health.voiceService.ok ? 'aktif' : 'MATI'}`);

  console.log('\n1. Basis data suara');
  const me = await json('/api/speakers', { name: 'Penutur Uji', role: 'Rektor' });
  for (const f of ['penutur_uji_1.webm', 'penutur_uji_2.webm', 'penutur_uji_3.webm']) await enroll(me.id, f);
  const others = { 'Penutur Lain A': ['lain_hts1.wav'], 'Penutur Lain B': ['lain_kristoff.wav'], 'Penutur Lain C': ['lain_ve9qrp_0.wav', 'lain_ve9qrp_1.wav'],
    'Penutur Lain D': ['lain_david_0.wav'], 'Penutur Lain E': ['lain_vk2tpm_0.wav', 'lain_vk2tpm_1.wav'] };
  const otherIds = {};
  for (const [name, files] of Object.entries(others)) {
    const s = await json('/api/speakers', { name, role: 'Dekan' }); otherIds[name] = s.id;
    for (const f of files) await enroll(s.id, f);
  }
  const speakers = await call('/api/speakers');
  check(speakers.length === 6, `6 penutur terdaftar, ${speakers.reduce((a, s) => a + s.recordings, 0)} rekaman`);

  console.log('\n2. Penerbitan ijazah');
  const data = { nomor_ijazah: 'UJI/2026/0001', nama: 'Siti Rahmawati', nim: '2021110001', tempat_lahir: 'Bogor', tanggal_lahir: '2003-05-17',
    program_studi: 'Teknik Informatika', fakultas: 'Teknik dan Sains', gelar: 'Sarjana Komputer (S.Kom.)', tanggal_lulus: '2026-10-28', signer_speaker_id: me.id };
  const issued = await call('/api/diplomas', { method: 'POST', body: form(data, 'audio', path.join(FX, 'penutur_uji_4.webm')) });
  console.log(`  isi QR ${issued.payloadBytes} byte (suara ${issued.voiceBytes} byte), QR versi ${issued.qrVersion}`);
  check(issued.qrVersion <= 40, 'payload muat dalam satu kode QR');

  console.log('\n3. Verifikasi dari PDF yang dirender 150 dpi (simulasi pindaian)');
  const pdf = await call(`/api/diplomas/${issued.id}/pdf`);
  fs.writeFileSync(path.join(os.tmpdir(), 'ijazah-uji.pdf'), pdf);
  const img = renderPdfToImage(pdf, 150);
  const r1 = await call('/api/verify-image', { method: 'POST', body: form({}, 'image', img) });
  console.log(`  ${summary(r1)}`);
  check(r1.valid, 'ijazah dinyatakan sah');
  check(r1.checks.signature.ok && r1.checks.document.ok, 'tanda tangan sah dan hash dokumen cocok');
  check(r1.matches.length === 3, 'mengembalikan 3 rekaman teratas');
  check(r1.matches[0].speakerId === me.id && r1.matches[0].meetsThreshold, 'peringkat 1 = penanda tangan dan ≥ ambang');
  check(r1.checks.voice.ok, 'kecocokan suara dengan penanda tangan');
  const sameSpeakerAbove = r1.matches.filter((m) => m.speakerId === me.id && m.purpose === 'enrollment' && m.meetsThreshold).length;
  console.log(`  sampel penutur uji (rekaman berbeda) yang ≥ ambang di 3 teratas: ${sameSpeakerAbove}`);
  check(r1.matches.filter((m) => m.speakerId !== me.id).every((m) => !m.meetsThreshold), 'tidak ada penutur lain yang lolos ambang');

  // QR dibaca langsung dari PNG
  const qrPng = await call(`/api/diplomas/${issued.id}/qr.png`);
  const qrFile = path.join(os.tmpdir(), 'qr-uji.png'); fs.writeFileSync(qrFile, qrPng);
  const r2 = await call('/api/verify-image', { method: 'POST', body: form({}, 'image', qrFile) });
  check(r2.valid && r2.matches[0].similarityPct === r1.matches[0].similarityPct, 'hasil dari PNG QR identik dengan dari PDF');

  console.log('\n4. Uji perusakan');
  const db = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://ijazah:ijazah@localhost:5432/ijazah' });
  await db.connect();
  const { rows } = await db.query('SELECT payload FROM diplomas WHERE id = $1', [issued.id]);
  const payload = rows[0].payload;

  await db.query('UPDATE diplomas SET nama = $1 WHERE id = $2', ['Siti Rahmawati Palsu', issued.id]);
  const t1 = await json('/api/verify', { payload_b64: payload.toString('base64') });
  check(!t1.valid && !t1.checks.document.ok && t1.checks.signature.ok, 'data ijazah diubah di basis data → hash tidak cocok, ditolak');
  await db.query('UPDATE diplomas SET nama = $1 WHERE id = $2', [data.nama, issued.id]);

  const flipped = Buffer.from(payload); flipped[60] ^= 0x01;
  const t2 = await json('/api/verify', { payload_b64: flipped.toString('base64') });
  check(!t2.valid && !t2.checks.signature.ok, '1 bit isi QR diubah → tanda tangan tidak sah, ditolak');

  const t3 = await json('/api/verify', { payload_b64: Buffer.from('bukan QR ijazah').toString('base64') });
  check(!t3.valid && !t3.checks.format.ok, 'QR asing → format ditolak');

  console.log('\n5. Suara orang lain atas nama Penutur Uji');
  const res5 = await fetch(BASE + '/api/diplomas', { method: 'POST', body: form({ ...data, nomor_ijazah: 'UJI/2026/0002' }, 'audio', path.join(FX, 'lain_david_1.wav')) });
  const b5 = await res5.json();
  console.log(`  penerbitan: HTTP ${res5.status} — ${b5.error || 'diterbitkan'}`);
  check(res5.status === 422, 'penerbitan ditolak karena suara tidak cocok dengan sampel penanda tangan');

  // Simulasi kunci penerbit bocor: QR dipalsukan dengan suara orang lain dan ditandatangani kunci asli
  const payloadLib = require('../src/payload');
  const crypto = require('crypto');
  const keyDir = process.env.KEY_DIR || path.join(__dirname, '..', 'keys');
  const priv = crypto.createPrivateKey(fs.readFileSync(path.join(keyDir, 'issuer_ed25519.pem')));
  const parsed = payloadLib.parse(payload);
  const { rows: dv } = await db.query(`SELECT r.codec_bits FROM voice_recordings r JOIN speakers s ON s.id = r.speaker_id WHERE s.name = 'Penutur Lain D' LIMIT 1`);
  const forged = payloadLib.build({ codecMode: parsed.codecMode, voice: dv[0].codec_bits, issuedAt: Date.now(), docHash: parsed.docHash, keyId: parsed.keyId, nomorIjazah: parsed.nomorIjazah, privateKey: priv });
  const t5 = await json('/api/verify', { payload_b64: forged.toString('base64') });
  console.log(`  QR palsu bertanda tangan sah: ${summary(t5)}`);
  check(t5.checks.signature.ok && t5.checks.document.ok && !t5.checks.voice.ok, 'kriptografi sah, tetapi kecocokan suara GAGAL');
  check(t5.matches[0].speakerId === otherIds['Penutur Lain D'], 'suara dikenali sebagai Penutur Lain D');

  await call(`/api/diplomas/${issued.id}/revoke`, { method: 'POST' });
  const t4 = await json('/api/verify', { payload_b64: payload.toString('base64') });
  check(!t4.valid && !t4.checks.revocation.ok, 'ijazah dicabut → ditolak');

  await db.end();
  console.log(failures ? `\n${failures} pemeriksaan GAGAL` : '\nSemua pemeriksaan lulus.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
