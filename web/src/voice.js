// Klien HTTP ke layanan suara (Python/FastAPI)
const config = require('./config');

async function call(path, init) {
  let res;
  try { res = await fetch(config.voiceServiceUrl + path, init); } catch (e) {
    throw Object.assign(new Error('Layanan suara tidak dapat dihubungi: ' + e.message), { status: 503 });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.detail || `Layanan suara gagal (${res.status})`), { status: res.status >= 500 ? 502 : 400 });
  return body;
}

async function processRecording(buffer, mimetype, filename = 'rekaman.webm') {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mimetype || 'application/octet-stream' }), filename);
  fd.append('mode', config.codecMode);
  const r = await call('/process', { method: 'POST', body: fd });
  return {
    mode: r.mode,
    durationS: r.duration_s,
    codecBits: Buffer.from(r.codec_b64, 'base64'),
    originalWav: Buffer.from(r.original_wav_b64, 'base64'),
    decodedWav: Buffer.from(r.decoded_wav_b64, 'base64'),
    embedding: r.embedding,
  };
}

async function decode(codecBits, mode) {
  const r = await call('/decode', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codec_b64: Buffer.from(codecBits).toString('base64'), mode }),
  });
  return { durationS: r.duration_s, decodedWav: Buffer.from(r.decoded_wav_b64, 'base64'), embedding: r.embedding };
}

const health = () => call('/health');

module.exports = { processRecording, decode, health };
