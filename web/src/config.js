const path = require('path');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const publicBaseUrl = env('PUBLIC_BASE_URL', 'http://localhost:3000');
let detectedBasePath = '';
try {
  const parsedPath = new URL(publicBaseUrl).pathname.replace(/\/+$/, '');
  if (parsedPath) detectedBasePath = parsedPath;
} catch {}

module.exports = {
  port: Number(env('PORT', 3000)),
  databaseUrl: env('DATABASE_URL', 'postgres://ijazah:ijazah@localhost:5432/ijazah'),
  voiceServiceUrl: env('VOICE_SERVICE_URL', 'http://localhost:8001'),
  keyDir: env('KEY_DIR', path.join(__dirname, '..', 'keys')),
  codecMode: env('CODEC2_MODE', '3200'),            // 3200 = kualitas terbaik; 2400 = QR lebih kecil
  matchThreshold: Number(env('MATCH_THRESHOLD', 80)), // persen kemiripan minimum untuk dinyatakan cocok
  qrErrorCorrection: env('QR_ECC', 'L'),
  issuanceVoiceCheck: env('ISSUANCE_VOICE_CHECK', 'true') !== 'false', // tolak penerbitan bila suara tak cocok dengan sampel penanda tangan
  adminToken: env('ADMIN_TOKEN', ''),               // kosong = tanpa proteksi (hanya untuk uji lokal)
  institution: {
    name: env('INSTITUTION_NAME', 'NAMA UNIVERSITAS'),
    subtitle: env('INSTITUTION_SUBTITLE', 'Alamat atau keterangan institusi'),
    city: env('INSTITUTION_CITY', 'Kota'),
  },
  publicBaseUrl,
  basePath: env('BASE_PATH', detectedBasePath),
};
