// Representasi kanonik ijazah yang di-hash. Kode QR tercetak DI ATAS dokumen, jadi hash tidak
// bisa mencakup berkas PDF final (akan melingkar). Yang di-hash adalah isi ijazah dalam urutan
// kunci yang tetap; pemeriksa menghitung ulang hash dari data di basis data dan membandingkannya
// dengan hash di dalam QR, lalu mencocokkan data yang ditampilkan dengan yang tercetak di kertas.
const crypto = require('crypto');

const FIELDS = ['nomor_ijazah', 'nama', 'nim', 'tempat_lahir', 'tanggal_lahir', 'program_studi', 'fakultas', 'gelar', 'tanggal_lulus'];

function canonical(d, institutionName, signer) {
  const obj = { format: 'ijazah-bersuara/v1', institusi: institutionName };
  for (const k of FIELDS) obj[k] = String(d[k] ?? '').trim();
  obj.penanda_tangan = { nama: signer.name, jabatan: signer.role || '' };
  return JSON.stringify(obj);
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest();

function validate(d) {
  const missing = FIELDS.filter((k) => !String(d[k] ?? '').trim());
  if (missing.length) return `Data belum lengkap: ${missing.join(', ')}`;
  for (const k of ['tanggal_lahir', 'tanggal_lulus']) if (!/^\d{4}-\d{2}-\d{2}$/.test(d[k])) return `Format ${k} harus YYYY-MM-DD`;
  return null;
}

module.exports = { canonical, sha256, validate, FIELDS };
