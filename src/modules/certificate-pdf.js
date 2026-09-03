const logoUrl = 'https://res.cloudinary.com/ywbvk3ek/image/upload/f_auto,q_auto/love_truth';

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
  const verificationUrl = `${window.location.origin}${certificate.verificationUrl}`;
  let logo = null; let qr = null;
  try { logo = await imageData(logoUrl); } catch {}
  try { qr = await imageData(`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(verificationUrl)}`); } catch {}

  doc.setFillColor(18, 52, 103); doc.rect(0, 0, pageWidth, 18, 'F');
  doc.setDrawColor(184, 135, 38); doc.setLineWidth(1.3); doc.line(20, 28, pageWidth - 20, 28);
  if (logo) doc.addImage(logo, 'PNG', 20, 34, 27, 27);
  doc.setTextColor(18, 52, 103); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  doc.text('LOVE & TRUTH BIBLE AND SKILLS', pageWidth / 2, 42, { align: 'center' });
  doc.text('TRAINING COLLEGE', pageWidth / 2, 50, { align: 'center' });
  doc.setTextColor(184, 135, 38); doc.setFontSize(8); doc.text('LEARNING WITH PURPOSE. TRAINING WITH EXCELLENCE.', pageWidth / 2, 57, { align: 'center' });
  doc.setTextColor(18, 52, 103); doc.setFontSize(28); doc.text('CERTIFICATE OF COMPLETION', pageWidth / 2, 78, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(85, 96, 116);
  doc.text('This is to certify that', pageWidth / 2, 92, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(18, 52, 103);
  doc.text(certificate.studentName.toUpperCase(), pageWidth / 2, 105, { align: 'center' });
  doc.setDrawColor(184, 135, 38); doc.setLineWidth(.5); doc.line(48, 109, pageWidth - 48, 109);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(85, 96, 116);
  doc.text('has successfully completed the prescribed course of study in', pageWidth / 2, 121, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(18, 52, 103);
  doc.text(certificate.programmeName, pageWidth / 2, 133, { align: 'center', maxWidth: 160 });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(85, 96, 116);
  doc.text(`Registration number: ${certificate.registrationNumber || '—'}`, pageWidth / 2, 148, { align: 'center' });
  doc.text(`Issued: ${new Date(certificate.issuedAt).toLocaleDateString()}`, pageWidth / 2, 155, { align: 'center' });
  if (qr) doc.addImage(qr, 'PNG', pageWidth - 47, 164, 28, 28);
  doc.setFontSize(7); doc.text('Scan to verify', pageWidth - 33, 195, { align: 'center' });
  const signatories = certificate.signatories || [];
  const signatureY = 212;
  signatories.slice(0, 2).forEach((signatory, index) => {
    const x = index === 0 ? 47 : pageWidth - 47;
    doc.setDrawColor(140, 150, 168); doc.line(x - 28, signatureY, x + 28, signatureY);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(18, 52, 103); doc.text(signatory.name, x, signatureY + 6, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(85, 96, 116); doc.text(signatory.title, x, signatureY + 11, { align: 'center' });
  });
  doc.setFontSize(7); doc.setTextColor(85, 96, 116); doc.text(`Certificate hash: ${certificate.certificateHash}`, 20, 278);
  doc.text('This is a digitally issued certificate. Verify authenticity before relying on it.', pageWidth - 20, 278, { align: 'right' });

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
  doc.setFontSize(8); doc.setTextColor(85, 96, 116); doc.text(`Verification URL: ${verificationUrl}`, 20, 280, { maxWidth: pageWidth - 40 });
  doc.save(`e-certificate-${certificate.certificateHash.slice(0, 12)}.pdf`);
}
