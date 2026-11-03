# Ijazah Bersuara

Aplikasi penerbitan dan verifikasi ijazah dengan **kode QR yang memuat suara penanda tangan**, mengikuti
rancangan pada naskah jurnal *Penyematan Suara Terkompresi Berbasis Vokoder Prediksi Linier ke dalam Kode QR
Statis sebagai Media Autentikasi Dokumen Secara Luring* (Gambar 1 dan Tabel 2).

Alur kerjanya:

1. **Basis data suara** — daftarkan penanda tangan (Rektor, Dekan, …) dan rekam 3–5 sampel suara masing-masing.
2. **Terbitkan ijazah** — isi data lulusan, rekam pernyataan penanda tangan (4 detik). Sistem:
   - mengodekan suara dengan **Codec 2 mode 3200** (1600 byte untuk 4 detik),
   - memastikan suara pernyataan cocok dengan sampel penanda tangan (≥ 80%), bila tidak penerbitan ditolak,
   - menghitung **SHA-256** data ijazah, menggabungkannya dengan suara, lalu menandatangani dengan **Ed25519**,
   - membuat kode QR (±1724 byte, versi 30) dan **PDF ijazah** A4 lanskap siap cetak.
3. **Verifikasi** — pindai QR dengan kamera atau unggah foto/pindaian ijazah. Sistem memeriksa tanda tangan,
   mencocokkan hash dengan data terdaftar, memeriksa pencabutan, **menyintesis suara dari QR**, lalu menampilkan
   **3 rekaman paling mirip** dari basis data beserta persentase kemiripan dan status terhadap **ambang 80%**.

## Arsitektur

```
peramban ──► web (Node.js + Express) ──► PostgreSQL + pgvector  (data ijazah, rekaman, embedding 256-d)
                     │
                     └──► voice-service (Python + FastAPI)
                            ├─ ffmpeg   : webm/opus/wav → PCM 8 kHz
                            ├─ codec2   : c2enc / c2dec (mode 3200)
                            └─ sherpa-onnx + WeSpeaker ResNet34 : embedding penutur
```

| Komponen | Isi |
|---|---|
| `web/src/payload.js` | Format biner isi QR (v2): `VQ` · versi · codec · panjang suara · waktu terbit · SHA-256 · id kunci · nomor ijazah · suara · tanda tangan Ed25519 |
| `web/src/document.js` | Data ijazah kanonik yang di-hash |
| `web/src/keys.js` | Kunci penerbit Ed25519 (privat di berkas, publik di basis data) |
| `web/src/pdf.js` | PDF ijazah dengan QR |
| `web/src/qr.js` | Pembuatan QR dan pembacaan QR dari gambar (ZXing WebAssembly, cadangan jsQR) |
| `web/src/server.js` | API, gerbang suara saat penerbitan, verifikasi, pencarian 3 teratas |
| `voice-service/app.py` | Codec 2, embedding penutur |
| `web/migrations/001_init.sql` | Skema basis data |

## Menjalankan dengan Docker

```bash
cp .env.example .env        # isi INSTITUTION_*, POSTGRES_PASSWORD, ADMIN_TOKEN
docker compose up -d --build
# buka http://localhost:3000
```

Catatan: berkas Docker belum dapat dibangun di lingkungan pengembangan (akses ke Docker Hub diblokir), jadi
belum diuji sebagai *container*. Seluruh komponen telah diuji secara langsung (tanpa Docker) dengan versi yang
sama dengan isi image: Ubuntu 24.04, PostgreSQL 16 + pgvector, codec2 1.2, ffmpeg, Python 3, Node.js 22.

## Menjalankan tanpa Docker (Ubuntu 24.04, sudah diuji)

```bash
sudo apt install postgresql-16 postgresql-16-pgvector codec2 ffmpeg libsndfile1 python3-venv poppler-utils
sudo -u postgres psql -c "CREATE USER ijazah WITH PASSWORD 'ijazah';" -c "CREATE DATABASE ijazah OWNER ijazah;"
sudo -u postgres psql -d ijazah -c "CREATE EXTENSION vector;"

# layanan suara
cd voice-service
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
mkdir -p models && curl -fL -o models/wespeaker_en_voxceleb_resnet34_LM.onnx \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx
SPEAKER_MODEL=models/wespeaker_en_voxceleb_resnet34_LM.onnx uvicorn app:app --port 8001

# aplikasi web (terminal lain)
cd web && npm ci
INSTITUTION_NAME="Nama Universitas" INSTITUTION_CITY="Kota" npm start
```

Pembacaan QR memakai ZXing (WebAssembly), baik di peramban maupun server; jsQR hanya cadangan. Pada uji,
jsQR gagal membaca QR versi 29–30 dari pindaian halaman di bawah 200 dpi, sedangkan ZXing berhasil dari 100 dpi.

Kamera dan mikrofon peramban hanya aktif di `localhost` atau **HTTPS**. Untuk dipakai dari ponsel di jaringan,
pasang di balik *reverse proxy* HTTPS (mis. Caddy atau Nginx) dan isi `PUBLIC_BASE_URL`.

## Pengujian

`web/test/e2e.js` menjalankan seluruh alur terhadap server yang berjalan dengan basis data kosong:

```bash
cd web && npm test
```

Hasil pada lingkungan pengembangan (4 rekaman penutur uji + 9 rekaman dari 5 penutur lain):

| Pemeriksaan | Hasil |
|---|---|
| Isi QR | 1588 byte untuk rekaman 3,66 dtk (QR versi 29); 1724 byte untuk 4 dtk (versi 30) |
| Verifikasi dari PDF dirender 150 dpi | sah; 3 teratas = sampel penanda tangan 89,2% · 83,2% · 82,8% |
| Penutur lain di atas ambang 80% | tidak ada |
| Data ijazah diubah di basis data | ditolak (hash tidak cocok) |
| 1 bit isi QR diubah | ditolak (tanda tangan tidak sah) |
| QR bukan milik aplikasi ini | ditolak (format) |
| Penerbitan dengan suara orang lain | ditolak saat penerbitan (kemiripan 36,9%) |
| QR dipalsukan dengan kunci asli tetapi suara orang lain | tanda tangan sah, **kecocokan suara gagal**, suara dikenali sebagai penutur lain |
| Ijazah dicabut | ditolak |
| Pindaian halaman ijazah (PNG & JPEG) | terbaca dari 100 hingga 600 dpi; 75 dpi terlalu kasar |
| Pindai dengan kamera (kamera simulasi 1280×720 diarahkan ke QR) | terbaca dan terverifikasi dalam ±0,4 detik |

### Kualitas suara

Codec 2 mode 3200 menggantikan vokoder LPC buatan sendiri pada versi HTML sebelumnya. Pada empat rekaman uji
yang sama, PESQ-NB naik dari 1,37 menjadi 2,36 (sekitar 2,41 dengan *high-pass* dan normalisasi level yang kini
diterapkan sebelum pengodean), dengan ukuran data yang sama (64 bit per 20 ms).

### Pencocokan suara

Embedding penutur dihitung dengan WeSpeaker ResNet34. Agar adil, **rekaman di basis data juga melewati Codec 2**
sebelum embedding dihitung, sehingga dibandingkan dalam kondisi yang sama dengan suara dari QR. Pada uji
dengan 4 rekaman penutur uji dan 7 penutur lain:

| | Enrollment asli | Enrollment lewat Codec 2 (dipakai) |
|---|---|---|
| Rata-rata kemiripan penutur sama | 78,6% | 86,5% |
| Pasangan penutur sama ≥ 80% | 16 dari 22 | 18 dari 22 |
| Pasangan penutur berbeda ≥ 80% | 1 dari 160 | 0 dari 160 |
| Peringkat 1 benar | – | 11 dari 11 |

Artinya, dengan ambang 80% sekitar 1 dari 5 rekaman asli penutur yang sama bisa jatuh di bawah ambang, sehingga
**rekam 3–5 sampel per penanda tangan**: verifikasi memakai yang paling mirip. Angka ini berasal dari data uji yang
kecil; sebelum dipakai resmi, ulangi pengukuran dengan suara pejabat yang sebenarnya dan sesuaikan `MATCH_THRESHOLD`.

## Hal yang perlu dipahami

- **Yang membuktikan keaslian adalah tanda tangan digital dan hash**, bukan suara. Suara adalah lapisan tambahan
  yang dapat didengar manusia dan dicocokkan dengan basis data. Suara sintetis atau tiruan (*deepfake*) dapat
  mengecoh pencocokan suara otomatis.
- Hash dibuat dari **data ijazah** (bukan berkas PDF), karena QR dicetak di atas PDF itu sendiri. Saat verifikasi,
  cocokkan data yang ditampilkan dengan yang tercetak di kertas.
- **Kunci privat penerbit** ada di `keys/issuer_ed25519.pem` (Docker: volume `keys`). Siapa pun yang memegangnya
  dapat menerbitkan QR yang sah, jadi batasi aksesnya dan buat cadangan. Bila hilang, ijazah lama tetap dapat
  diverifikasi (kunci publik ada di basis data), tetapi ijazah baru memakai kunci baru.
- Isi `ADMIN_TOKEN` bila aplikasi dapat diakses orang lain; tanpa token, siapa pun dapat menerbitkan ijazah.
- Untuk kekuatan hukum sebagai tanda tangan elektronik tersertifikasi (PP 71/2019), kunci penerbit perlu
  diterbitkan melalui Penyelenggara Sertifikasi Elektronik (PSrE); hal ini di luar cakupan aplikasi ini.
- Rekaman uji di `web/test/fixtures/lain_*.wav` berasal dari repositori Codec 2 (LGPL-2.1).
