// Format biner isi kode QR (versi 2), mengikuti Tabel 2 pada naskah jurnal dengan tambahan
// nomor ijazah dan jenis codec:
//
//  'VQ'(2) | versi(1)=2 | codec(1) | panjang suara(2) | waktu terbit unix(4) | SHA-256 dokumen(32)
//  | id kunci(4) | panjang nomor ijazah(1) | nomor ijazah (UTF-8) | bitstream Codec 2 | tanda tangan Ed25519(64)
//
// Tanda tangan menutupi seluruh byte sebelum tanda tangan.
const crypto = require('crypto');

const MAGIC = Buffer.from('VQ', 'ascii');
const VERSION = 2;
const CODECS = { 1: '3200', 2: '2400', 3: '1600', 4: '1400', 5: '1300', 6: '1200' };
const CODEC_ID = Object.fromEntries(Object.entries(CODECS).map(([k, v]) => [v, Number(k)]));
const SIG_LEN = 64;

function build({ codecMode, voice, issuedAt, docHash, keyId, nomorIjazah, privateKey }) {
  if (!CODEC_ID[codecMode]) throw new Error('Mode codec tidak dikenal: ' + codecMode);
  const no = Buffer.from(nomorIjazah, 'utf8');
  if (no.length > 255) throw new Error('Nomor ijazah terlalu panjang');
  if (docHash.length !== 32 || keyId.length !== 4) throw new Error('Panjang hash/id kunci salah');
  const head = Buffer.alloc(2 + 1 + 1 + 2 + 4);
  MAGIC.copy(head, 0);
  head[2] = VERSION;
  head[3] = CODEC_ID[codecMode];
  head.writeUInt16BE(voice.length, 4);
  head.writeUInt32BE(Math.floor(issuedAt / 1000), 6);
  const body = Buffer.concat([head, docHash, keyId, Buffer.from([no.length]), no, voice]);
  const sig = crypto.sign(null, body, privateKey);
  return Buffer.concat([body, sig]);
}

function parse(buf) {
  buf = Buffer.from(buf);
  const fail = (msg) => { const e = new Error(msg); e.code = 'BAD_PAYLOAD'; throw e; };
  if (buf.length < 10 + 32 + 4 + 1 + SIG_LEN) fail('Isi QR terlalu pendek untuk format ini');
  if (!buf.subarray(0, 2).equals(MAGIC)) fail('Bukan QR Ijazah Bersuara (penanda format tidak cocok)');
  if (buf[2] !== VERSION) fail(`Versi format ${buf[2]} tidak didukung`);
  const codecMode = CODECS[buf[3]];
  if (!codecMode) fail('Jenis codec tidak dikenal');
  const voiceLen = buf.readUInt16BE(4);
  const issuedAt = new Date(buf.readUInt32BE(6) * 1000);
  let o = 10;
  const docHash = buf.subarray(o, o + 32); o += 32;
  const keyId = buf.subarray(o, o + 4); o += 4;
  const noLen = buf[o]; o += 1;
  const nomorIjazah = buf.subarray(o, o + noLen).toString('utf8'); o += noLen;
  const voice = buf.subarray(o, o + voiceLen); o += voiceLen;
  if (o + SIG_LEN !== buf.length) fail('Panjang isi QR tidak konsisten');
  const body = buf.subarray(0, o);
  const signature = buf.subarray(o);
  return { codecMode, voiceLen, issuedAt, docHash, keyId, nomorIjazah, voice, body, signature };
}

const verifySignature = (parsed, publicKey) => crypto.verify(null, parsed.body, publicKey, parsed.signature);

module.exports = { build, parse, verifySignature, CODECS };
