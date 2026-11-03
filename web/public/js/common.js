// Utilitas bersama: navigasi, pemanggilan API, dan perekam suara 4 detik
const NAV = [
  ['index.html', 'Beranda'], ['suara.html', 'Basis data suara'], ['terbitkan.html', 'Terbitkan ijazah'],
  ['daftar.html', 'Daftar ijazah'], ['verifikasi.html', 'Verifikasi'],
];

function getBasePath() {
  const p = window.location.pathname;
  const lastSlash = p.lastIndexOf('/');
  return lastSlash >= 0 ? p.substring(0, lastSlash + 1) : '/';
}

function apiUrl(path) {
  if (!path) return '';
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  const base = getBasePath();
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return base + clean;
}
window.apiUrl = apiUrl;

function renderHeader() {
  const here = location.pathname.split('/').pop() || 'index.html';
  const h = document.createElement('header');
  h.className = 'top';
  h.innerHTML = `<div class="wrap"><a class="brand" href="${apiUrl('index.html')}">Ijazah <span>Bersuara</span></a><nav>${
    NAV.map(([href, t]) => `<a href="${apiUrl(href)}" class="${href === here ? 'active' : ''}">${t}</a>`).join('')}</nav></div>`;
  document.body.prepend(h);
}

function adminToken() { try { return localStorage.getItem('adminToken') || ''; } catch { return ''; } }

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  const t = adminToken(); if (t) headers['x-admin-token'] = t;
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const url = apiUrl(path);
  const res = await fetch(url, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers, body: opts.body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Permintaan gagal (${res.status})`);
  return data;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s) => s ? new Date(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const fmtDateTime = (s) => new Date(s).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

function notice(el, type, text) { el.innerHTML = `<div class="notice ${type}">${esc(text)}</div>`; }

// Perekam: merekam tepat `seconds` detik lalu mengembalikan Blob audio
class FixedRecorder {
  constructor(root, seconds = 4) {
    this.seconds = seconds; this.blob = null; this.onchange = null;
    root.classList.add('recorder');
    root.innerHTML = `<button type="button" class="rec-btn">● Rekam ${seconds} detik</button>
      <div class="meter"><div></div></div><span class="muted rec-status">Belum ada rekaman</span>
      <audio class="rec-audio hidden" controls></audio>
      <label class="muted" style="margin:0">atau unggah berkas <input type="file" accept="audio/*" class="rec-file" style="width:auto;border:0;padding:0"></label>`;
    this.btn = root.querySelector('.rec-btn'); this.bar = root.querySelector('.meter > div');
    this.status = root.querySelector('.rec-status'); this.audio = root.querySelector('.rec-audio');
    this.btn.onclick = () => this.record();
    root.querySelector('.rec-file').onchange = (e) => { const f = e.target.files[0]; if (f) this.set(f, `Berkas: ${f.name}`); };
  }
  set(blob, label) {
    this.blob = blob; this.status.textContent = label;
    this.audio.src = URL.createObjectURL(blob); this.audio.classList.remove('hidden');
    if (this.onchange) this.onchange(blob);
  }
  reset() {
    this.blob = null; this.status.textContent = 'Belum ada rekaman'; this.bar.style.width = '0';
    this.audio.removeAttribute('src'); this.audio.classList.add('hidden');
  }
  async record() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { this.status.textContent = 'Mikrofon tidak dapat diakses: ' + e.message; return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.btn.disabled = true; const t0 = performance.now();
    const tick = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      this.bar.style.width = Math.min(100, (t / this.seconds) * 100) + '%';
      this.status.textContent = `Merekam… ${Math.max(0, this.seconds - t).toFixed(1)} dtk`;
    }, 100);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start(); await new Promise((r) => setTimeout(r, this.seconds * 1000 + 250)); rec.stop(); await stopped;
    clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); this.btn.disabled = false; this.bar.style.width = '100%';
    this.set(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), 'Rekaman siap');
  }
}

document.addEventListener('DOMContentLoaded', renderHeader);
