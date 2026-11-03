// Membuat PDF ijazah (A4 lanskap) dengan kode QR bersuara
const PDFDocument = require('pdfkit');
const config = require('./config');
const qr = require('./qr');

const fmtDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

async function diplomaPdf(d, signer) {
  const qrPng = await qr.png(d.payload, 10);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Ijazah ${d.nomor_ijazah}`, Author: config.institution.name } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', () => r(Buffer.concat(chunks))));

  const W = doc.page.width, H = doc.page.height;
  const ink = '#1f2a44', accent = '#8a6d1d', muted = '#5b6475';

  // bingkai ganda
  doc.lineWidth(3).strokeColor(accent).rect(22, 22, W - 44, H - 44).stroke();
  doc.lineWidth(0.8).rect(32, 32, W - 64, H - 64).stroke();

  let y = 46;
  doc.fillColor(ink).font('Times-Bold').fontSize(20).text(config.institution.name.toUpperCase(), 0, y, { width: W, align: 'center' });
  y += 24;
  doc.font('Times-Roman').fontSize(11).fillColor(muted).text(config.institution.subtitle, 0, y, { width: W, align: 'center' });
  y += 17;
  doc.moveTo(W / 2 - 160, y).lineTo(W / 2 + 160, y).lineWidth(0.8).strokeColor(accent).stroke();
  y += 10;
  doc.font('Times-Bold').fontSize(32).fillColor(ink).text('I J A Z A H', 0, y, { width: W, align: 'center' });
  y += 38;
  doc.font('Times-Roman').fontSize(12).fillColor(muted).text(`Nomor: ${d.nomor_ijazah}`, 0, y, { width: W, align: 'center' });
  y += 20;
  doc.fillColor(ink).fontSize(13).text('Dengan ini menyatakan bahwa', 0, y, { width: W, align: 'center' });
  y += 18;
  doc.font('Times-Bold').fontSize(25).text(d.nama, 0, y, { width: W, align: 'center' });
  y += 34;

  const rows = [
    ['Nomor Induk Mahasiswa', d.nim],
    ['Tempat, tanggal lahir', `${d.tempat_lahir}, ${fmtDate(d.tanggal_lahir)}`],
    ['Program studi', d.program_studi],
    ['Fakultas', d.fakultas],
  ];
  const lx = W / 2 - 190, vx = W / 2 - 20;
  doc.font('Times-Roman').fontSize(12.5);
  for (const [k, v] of rows) {
    doc.fillColor(muted).text(k, lx, y, { width: 165 });
    doc.fillColor(ink).text(':  ' + v, vx - 10, y, { width: 330 });
    y += 17;
  }
  y += 6;
  doc.fillColor(ink).fontSize(13).text(`telah menyelesaikan seluruh persyaratan pendidikan pada tanggal ${fmtDate(d.tanggal_lulus)}`, 0, y, { width: W, align: 'center' });
  y += 17;
  doc.text('dan kepadanya diberikan gelar', 0, y, { width: W, align: 'center' });
  y += 18;
  doc.font('Times-Bold').fontSize(16).text(d.gelar, 0, y, { width: W, align: 'center' });
  y += 20;
  doc.font('Times-Roman').fontSize(12).fillColor(muted).text('beserta segala hak dan kewajiban yang melekat pada gelar tersebut.', 0, y, { width: W, align: 'center' });

  // QR bersuara (kiri bawah)
  // QR dibuat besar (±6,7 cm) agar pindaian halaman 150-200 dpi tetap terbaca
  const qs = 190, qx = 50, qy = H - 40 - qs - 18;
  doc.image(qrPng, qx, qy, { width: qs, height: qs });
  doc.font('Times-Roman').fontSize(7.5).fillColor(muted)
    .text('Pindai untuk memverifikasi keaslian ijazah dan mendengarkan pernyataan suara penanda tangan.', qx - 4, qy + qs + 3, { width: qs + 8, align: 'center' });

  // penanda tangan (kanan bawah)
  const sx = W - 62 - 230, sy = H - 70 - 130;
  doc.font('Times-Roman').fontSize(12).fillColor(ink).text(`${config.institution.city}, ${fmtDate(d.tanggal_lulus)}`, sx, sy, { width: 230, align: 'center' });
  doc.text(signer.role || 'Penanda tangan', sx, sy + 17, { width: 230, align: 'center' });
  doc.font('Times-Italic').fontSize(9).fillColor(accent).text('Ditandatangani secara elektronik\n(tanda tangan digital Ed25519 + suara pada kode QR)', sx, sy + 48, { width: 230, align: 'center' });
  doc.font('Times-Bold').fontSize(12.5).fillColor(ink).text(signer.name, sx, sy + 86, { width: 230, align: 'center', underline: true });

  // jejak hash
  doc.font('Courier').fontSize(6.5).fillColor(muted)
    .text(`SHA-256 dokumen: ${d.doc_hash.toString('hex')}`, 0, H - 56, { width: W, align: 'center' });
  doc.font('Times-Roman').fontSize(7).text(`Verifikasi: ${config.publicBaseUrl}/verifikasi.html`, 0, H - 47, { width: W, align: 'center' });

  doc.end();
  return done;
}

module.exports = { diplomaPdf, fmtDate };
