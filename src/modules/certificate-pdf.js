const logoUrl = 'https://res.cloudinary.com/ywbvk3ek/image/upload/f_auto,q_auto/love_truth';

export function verificationUrl(certificate) {
  return `${window.location.origin}${certificate.verificationUrl}`;
}

export function certificateQrUrl(certificate) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(verificationUrl(certificate))}`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

export function certificatePreviewMarkup(certificate) {
  const units = certificate.units || [];
  const signatories = certificate.signatories || [];
  const grades = units.map((unit) => unit.grade || 'CREDIT');
  const signature = (signatory, fallbackTitle) => {
    const person = signatory || { name: '', title: fallbackTitle };
    const image = person.signatureUrl ? `<img src="${escapeHtml(person.signatureUrl)}" alt="${escapeHtml(person.title)} signature" />` : '';
    return `<div class="certificate-preview-signature">${image}<span>${escapeHtml(person.title || fallbackTitle)}</span>${person.name ? `<small>${escapeHtml(person.name)}</small>` : ''}</div>`;
  };
  return `<article class="certificate-preview"><div class="certificate-watermark"></div><header class="certificate-preview-brand"><div class="certificate-preview-contact">P.O. BOX 143-50200<br />BUNGOMA<br />Love &amp; Truth College</div><img src="${logoUrl}" alt="Love and Truth College logo" /><div class="certificate-preview-contact">E-CERTIFICATE<br />VERIFIABLE ONLINE<br />${escapeHtml(new Date(certificate.issuedAt).toLocaleDateString())}</div></header><h2>Love and Truth Bible and Skills Training College</h2><p class="certificate-offers">Offers: Diploma &amp; Technical Courses</p><p class="certificate-certifies">This is to certify that;</p><h1 class="certificate-name">${escapeHtml(certificate.studentName)}</h1><p class="certificate-copy">Has successfully completed the approved programme of training and passed the final certificate examinations listed below, in testimony whereof we have awarded this</p><p class="certificate-programme">Certificate in ${escapeHtml(certificate.programmeName)}</p><div class="certificate-units"><section><h3>COURSE(S)</h3><ol>${units.map((unit) => `<li>${escapeHtml(unit.code)}. ${escapeHtml(unit.name)}</li>`).join('') || '<li>Programme unit record</li>'}</ol></section><section class="certificate-grades"><h3>GRADE(S)</h3>${grades.map((grade) => `<div>${escapeHtml(grade)}</div>`).join('') || '<div>CREDIT</div>'}</section></div><footer class="certificate-preview-footer">${signature(signatories[0], 'Director')}<img class="certificate-preview-qr" src="${certificateQrUrl(certificate)}" alt="Certificate verification QR code" />${signature(signatories[1], 'Authorised signature')}</footer><p class="certificate-preview-hash">CERT. NO: ${escapeHtml(certificate.certificateHash.slice(0, 16).toUpperCase())}</p></article>`;
}

function imageData(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = reject;
    image.src = url;
  });
}

function line(document, text, x, y, width = 170) {
  const lines = document.splitTextToSize(text, width);
  document.text(lines, x, y);
  return y + (lines.length * 6);
}

export async function downloadCertificatePdf(certificate) {
  const Pdf = window.jspdf?.jsPDF;
  if (!Pdf) throw new Error('Certificate PDF tools are still loading. Please try again.');
  const doc = new Pdf({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const publicVerificationUrl = verificationUrl(certificate);
  let logo = null; let qr = null;
  try { logo = await imageData(logoUrl); } catch {}
  try { qr = await imageData(certificateQrUrl(certificate)); } catch {}
  const signatureImages = await Promise.all((certificate.signatories || []).slice(0, 2).map(async (signatory) => {
    if (!signatory.signatureUrl) return null;
    try { return await imageData(signatory.signatureUrl); } catch { return null; }
  }));

  doc.setFillColor(7, 35, 76); doc.rect(0, 0, pageWidth, 297, 'F');
  doc.setFillColor(255, 255, 255); doc.rect(12, 12, pageWidth - 24, 273, 'F');
  doc.setDrawColor(215, 169, 57); doc.setLineWidth(2); doc.rect(16, 16, pageWidth - 32, 265);
  doc.setFillColor(7, 35, 76); doc.circle(7, 7, 49, 'F'); doc.circle(pageWidth - 7, 7, 49, 'F'); doc.circle(7, 290, 49, 'F');
  doc.setDrawColor(215, 169, 57); doc.setLineWidth(5); doc.circle(7, 7, 43, 'S'); doc.circle(pageWidth - 7, 7, 43, 'S'); doc.circle(7, 290, 43, 'S');
  if (logo && doc.GState) {
    doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.055 }));
    [[27, 87], [85, 87], [143, 87], [27, 174], [85, 174], [143, 174]].forEach(([x, y]) => doc.addImage(logo, 'PNG', x, y, 38, 38));
    doc.restoreGraphicsState();
  }
  if (logo) doc.addImage(logo, 'PNG', (pageWidth / 2) - 19, 24, 38, 38);
  doc.setTextColor(93, 76, 24); doc.setFont('times', 'bold'); doc.setFontSize(15);
  doc.text('LOVE AND TRUTH BIBLE AND SKILLS TRAINING', pageWidth / 2, 70, { align: 'center' }); doc.text('COLLEGE', pageWidth / 2, 77, { align: 'center' });
  doc.setFont('times', 'italic'); doc.setFontSize(15); doc.setTextColor(20, 20, 20); doc.text('Offers: Diploma & Technical Courses', pageWidth / 2, 89, { align: 'center' });
  doc.setFontSize(13); doc.text('This is to certify that;', pageWidth / 2, 99, { align: 'center' });
  doc.setFont('times', 'bold'); doc.setFontSize(20); doc.setTextColor(190, 10, 20); doc.text(certificate.studentName.toUpperCase(), pageWidth / 2, 112, { align: 'center' });
  doc.setFont('times', 'normal'); doc.setFontSize(13); doc.setTextColor(25, 25, 25); doc.text('Has successfully completed the approved programme of training and passed', pageWidth / 2, 124, { align: 'center' }); doc.text('the final certificate examinations listed below, in testimony whereof we', pageWidth / 2, 131, { align: 'center' }); doc.text('have awarded this', pageWidth / 2, 138, { align: 'center' });
  doc.setFont('times', 'bold'); doc.setFontSize(18); doc.setTextColor(205, 15, 22); doc.text(`Certificate in ${certificate.programmeName}`, pageWidth / 2, 152, { align: 'center', maxWidth: 160 });
  const units = certificate.units || [];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(18, 35, 68);
  doc.text('COURSE(S)', 35, 163); doc.text('GRADE(S)', pageWidth - 35, 163, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(22, 22, 22);
  units.slice(0, 8).forEach((unit, index) => {
    const y = 170 + (index * 5.6);
    doc.text(`${index + 1}. ${unit.code} - ${unit.name}`, 29, y, { maxWidth: 125 });
    doc.setFont('helvetica', 'bold'); doc.text(unit.grade || 'CREDIT', pageWidth - 29, y, { align: 'right' }); doc.setFont('helvetica', 'normal');
  });
  if (!units.length) doc.text('Programme unit record', 29, 170);
  if (qr) doc.addImage(qr, 'PNG', (pageWidth / 2) - 15, 221, 30, 30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(30, 30, 30); doc.text('Scan to verify', pageWidth / 2, 254, { align: 'center' });
  const signatories = certificate.signatories || [];
  const signatureY = 264;
  signatories.slice(0, 2).forEach((signatory, index) => {
    const x = index === 0 ? 48 : pageWidth - 48;
    doc.setDrawColor(140, 150, 168); doc.line(x - 28, signatureY, x + 28, signatureY);
    if (signatureImages[index]) doc.addImage(signatureImages[index], 'PNG', x - 18, signatureY - 17, 36, 14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(18, 52, 103); doc.text(signatory.name, x, signatureY + 6, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(85, 96, 116); doc.text(signatory.title, x, signatureY + 11, { align: 'center' });
  });
  doc.setFontSize(7); doc.setTextColor(190, 20, 25); doc.text(`CERT. NO: ${certificate.certificateHash.slice(0, 16).toUpperCase()}`, pageWidth - 22, 277, { align: 'right' });

  doc.addPage();
  doc.setFillColor(18, 52, 103); doc.rect(0, 0, pageWidth, 14, 'F');
  doc.setTextColor(18, 52, 103); doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.text('Academic transcript', 20, 30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(85, 96, 116);
  doc.text(`${certificate.studentName} · ${certificate.programmeName} · ${certificate.registrationNumber || '—'}`, 20, 38);
  let y = 54;
  doc.setFillColor(235, 241, 250); doc.rect(20, y - 6, pageWidth - 40, 8, 'F');
  doc.setTextColor(18, 52, 103); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('UNIT', 22, y); doc.text('CREDIT HRS', 145, y, { align: 'right' }); doc.text('GRADE', 170, y, { align: 'right' });
  y += 8; doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 49, 65);
  (certificate.units || []).forEach((unit) => {
    if (y > 265) { doc.addPage(); y = 25; }
    y = line(doc, `${unit.code} — ${unit.name}`, 22, y, 112);
    doc.text(String(unit.creditHours ?? '—'), 145, y - 6, { align: 'right' }); doc.text(unit.grade || '—', 170, y - 6, { align: 'right' });
    doc.setDrawColor(225, 229, 236); doc.line(20, y - 2, pageWidth - 20, y - 2); y += 3;
  });
  doc.setFontSize(8); doc.setTextColor(85, 96, 116); doc.text(`Verification URL: ${publicVerificationUrl}`, 20, 280, { maxWidth: pageWidth - 40 });
  doc.save(`e-certificate-${certificate.certificateHash.slice(0, 12)}.pdf`);
}
