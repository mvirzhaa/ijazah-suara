const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const config = require('./config');

const segs = (payload) => [{ data: Array.from(payload), mode: 'byte' }];

function info(payload) {
  const q = QRCode.create(segs(payload), { errorCorrectionLevel: config.qrErrorCorrection });
  return { version: q.version, modules: q.modules.size };
}

const png = (payload, scale = 8) =>
  QRCode.toBuffer(segs(payload), { errorCorrectionLevel: config.qrErrorCorrection, margin: 4, scale, type: 'png' });

// Lokasi paket zxing-wasm (paket ini tidak mengekspor package.json, jadi dicari lewat node_modules)
const ZXING_DIR = path.join(path.dirname(require.resolve('jsqr/package.json')), '..', 'zxing-wasm');

// ZXing (WebAssembly) dipakai sebagai pembaca utama: pada pindaian halaman ijazah ia membaca QR versi 29–30
// dari 100 hingga 600 dpi, sedangkan jsQR gagal di bawah 200 dpi. jsQR tetap dipakai sebagai cadangan.
let zxingReady = null;
function zxing() {
  if (!zxingReady) {
    zxingReady = import('zxing-wasm/reader').then((m) => {
      const wasm = fs.readFileSync(path.join(ZXING_DIR, 'dist', 'reader', 'zxing_reader.wasm'));
      m.prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) } });
      return m;
    });
  }
  return zxingReady;
}

async function decodeWithZxing(buf) {
  const m = await zxing();
  const res = await m.readBarcodes(new Blob([buf]), { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
  return res.length && res[0].isValid ? Buffer.from(res[0].bytes) : null;
}

function decodeWithJsQR(buf) {
  let img;
  if (buf[0] === 0x89 && buf[1] === 0x50) { const p = PNG.sync.read(buf); img = { data: p.data, width: p.width, height: p.height }; }
  else if (buf[0] === 0xff && buf[1] === 0xd8) img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
  else return null;
  const full = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length);
  for (const f of [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]) {
    const im = f === 1 ? { data: full, width: img.width, height: img.height } : downscale(full, img.width, img.height, f);
    if (im.width < 200) break;
    const r = jsQR(im.data, im.width, im.height);
    if (r && r.binaryData) return Buffer.from(r.binaryData);
  }
  return null;
}

// Membaca QR dari berkas gambar (PNG/JPEG/WebP) di sisi server, mengembalikan byte mentah
async function decodeImage(buf) {
  const bytes = (await decodeWithZxing(buf).catch(() => null)) || decodeWithJsQR(buf);
  if (!bytes) throw Object.assign(new Error('Kode QR tidak ditemukan pada gambar. Pastikan seluruh QR terlihat jelas, tidak terpotong, dan pindaian minimal 100 dpi.'), { code: 'NO_QR' });
  return bytes;
}

function downscale(src, w, h, f) {
  const W = Math.floor(w / f), H = Math.floor(h / f), out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y * f) * w;
    for (let x = 0; x < W; x++) {
      const i = (sy + Math.floor(x * f)) * 4, o = (y * W + x) * 4;
      out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2]; out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

module.exports = { info, png, decodeImage, ZXING_DIR };
