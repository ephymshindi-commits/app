import { formatKes } from './core.js';

const logoUrl = 'https://res.cloudinary.com/ywbvk3ek/image/upload/f_auto,q_auto/love_truth';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function detailRow(label, value) {
  return `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd></div>`;
}

export function receiptDocument(payment) {
  const student = Array.isArray(payment.students) ? payment.students[0] : payment.students;
  const invoice = Array.isArray(payment.invoices) ? payment.invoices[0] : payment.invoices;
  const studentName = `${student?.first_name || ''} ${student?.last_name || ''}`.trim() || 'Student';
  const receivedAt = payment.received_at ? new Date(payment.received_at).toLocaleString() : '—';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Official receipt ${escapeHtml(payment.receipt_number)}</title>
  <style>
    :root { --navy:#123467; --blue:#2764e7; --gold:#b88726; --ink:#1c2941; --muted:#6f7d92; --line:#dbe4ef; }
    * { box-sizing:border-box; }
    body { margin:0; background:#eef3f8; color:var(--ink); font:14px Arial,sans-serif; }
    .receipt { position:relative; isolation:isolate; max-width:820px; min-height:1040px; margin:28px auto; padding:48px 54px; background:#fff; overflow:hidden; box-shadow:0 12px 35px #10285b1f; }
    .watermark { position:absolute; z-index:-1; top:50%; left:50%; width:460px; transform:translate(-50%,-50%); opacity:.055; filter:grayscale(1); }
    .top-rule { height:8px; margin:-48px -54px 34px; background:linear-gradient(90deg,var(--navy),var(--blue),var(--gold)); }
    .brand { display:flex; align-items:center; gap:18px; padding-bottom:23px; border-bottom:1px solid var(--line); }
    .brand img { width:76px; height:76px; object-fit:contain; }
    .school-name { margin:0; color:var(--navy); font-size:20px; line-height:1.25; letter-spacing:.4px; }
    .school-name span { display:block; margin-top:4px; color:var(--gold); font-size:10px; letter-spacing:1.6px; }
    .document-title { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin:33px 0 25px; }
    .document-title h1 { margin:0; color:var(--navy); font-size:30px; letter-spacing:.5px; }
    .document-title p { margin:7px 0 0; color:var(--muted); font-size:12px; }
    .receipt-number { min-width:180px; padding:12px 14px; border:1px solid #cbdcf6; border-radius:8px; background:#f5f8ff; text-align:right; }
    .receipt-number small { display:block; color:var(--muted); font-size:9px; font-weight:700; letter-spacing:1px; }
    .receipt-number strong { display:block; margin-top:4px; color:var(--blue); font-size:14px; }
    .paid-banner { margin:0 0 26px; padding:19px 22px; border-radius:10px; background:linear-gradient(100deg,#11366e,#2868d8); color:#fff; }
    .paid-banner span { display:block; font-size:10px; font-weight:700; letter-spacing:1.2px; }
    .paid-banner strong { display:block; margin-top:6px; font-size:27px; }
    .paid-banner small { display:block; margin-top:6px; opacity:.84; font-size:11px; }
    .section-label { margin:25px 0 10px; color:var(--gold); font-size:10px; font-weight:700; letter-spacing:1.4px; }
    .details { display:grid; grid-template-columns:1fr 1fr; gap:0 34px; margin:0; }
    .detail-row { display:grid; grid-template-columns:135px 1fr; gap:8px; padding:11px 0; border-bottom:1px solid var(--line); }
    dt { color:var(--muted); font-size:11px; font-weight:700; }
    dd { margin:0; color:var(--ink); font-size:12px; font-weight:700; text-align:right; overflow-wrap:anywhere; }
    .balance { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-top:28px; padding:17px 19px; border:1px solid #dae4f5; border-radius:9px; background:#f8fbff; }
    .balance span { color:var(--muted); font-size:12px; font-weight:700; }
    .balance strong { color:var(--navy); font-size:18px; }
    .verification { margin-top:34px; padding:18px 20px; border-left:4px solid var(--gold); background:#fffaf0; color:#6e5830; font-size:12px; line-height:1.55; }
    .footer { position:absolute; right:54px; bottom:43px; left:54px; display:flex; justify-content:space-between; gap:16px; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:10px; line-height:1.45; }
    .footer strong { color:var(--navy); }
    @media(max-width:650px) {
      .receipt { min-height:100vh; margin:0; padding:30px 24px; }
      .top-rule { margin:-30px -24px 26px; }
      .document-title, .footer { display:block; }
      .receipt-number { margin-top:18px; text-align:left; }
      .details { grid-template-columns:1fr; }
      .footer { position:static; margin-top:30px; }
      .brand img { width:60px; height:60px; }
      .school-name { font-size:16px; }
    }
    @media print {
      body { background:#fff; }
      .receipt { max-width:none; min-height:0; margin:0; box-shadow:none; }
      .watermark { opacity:.045; }
      .footer { position:static; margin-top:38px; }
    }
  </style>
</head>
<body>
  <main class="receipt">
    <img class="watermark" src="${logoUrl}" alt="" />
    <div class="top-rule"></div>
    <header class="brand">
      <img src="${logoUrl}" alt="Love and Truth College logo" />
      <div><h2 class="school-name">LOVE &amp; TRUTH BIBLE AND SKILLS<br />TRAINING COLLEGE<span>LEARNING WITH PURPOSE. TRAINING WITH EXCELLENCE.</span></h2></div>
    </header>
    <section class="document-title">
      <div><h1>Official payment receipt</h1><p>This receipt confirms payment received by the institution.</p></div>
      <div class="receipt-number"><small>RECEIPT NUMBER</small><strong>${escapeHtml(payment.receipt_number)}</strong></div>
    </section>
    <section class="paid-banner"><span>AMOUNT RECEIVED</span><strong>${escapeHtml(formatKes(payment.amount))}</strong><small>Received on ${escapeHtml(receivedAt)}</small></section>
    <p class="section-label">STUDENT DETAILS</p>
    <dl class="details">${detailRow('Student name', studentName)}${detailRow('Registration number', student?.registration_number)}${detailRow('Fee charge number', invoice?.invoice_number)}${detailRow('Payment method', payment.method)}${detailRow('Transaction reference', payment.reference)}${detailRow('Receipt status', 'Verified payment')}</dl>
    <section class="balance"><span>Account balance after this payment</span><strong>${escapeHtml(formatKes(payment.balance || 0))}</strong></section>
    <section class="verification"><strong>Thank you for your payment.</strong><br />Keep this official receipt for your records. For any query, present the receipt number and student registration number to the college finance office.</section>
    <footer class="footer"><div><strong>LOVE &amp; TRUTH BIBLE AND SKILLS TRAINING COLLEGE</strong><br />This is a computer-generated official receipt.</div><div>Receipt no. ${escapeHtml(payment.receipt_number)}<br />Generated ${escapeHtml(new Date().toLocaleString())}</div></footer>
  </main>
</body>
</html>`;
}
