import {
  state, appendTableRow, clearTable, closeDialog, formatKes, friendlyDbError, friendlyFunctionError, openDialog,
  registrationLabel, requireAdministrator, setButtonBusy, setFormMessage, setText, showToast,
} from './core.js';
import { createStudentProfileLink } from './student-profile.js';
import { loadOperationalSummary } from './operational-summary.js';
import { receiptDocument } from './receipt-template.js';

let openInvoices = new Map();
let recentPayments = new Map();

function option(label, value = '') {
  return new Option(label, value);
}

function createReference(prefix) {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${suffix}`;
}

function downloadReceipt(payment) {
  const blob = new Blob([receiptDocument(payment)], { type: 'text/html' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${payment.receipt_number}.html`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function showConfirmation(payment) {
  const student = Array.isArray(payment.students) ? payment.students[0] : payment.students;
  const message = `LOVE & TRUTH BIBLE AND SKILLS TRAINING COLLEGE: Thank you. We received ${formatKes(payment.amount)} for ${student?.first_name || 'the student'} ${student?.last_name || ''} (${student?.registration_number || '—'}). Balance: ${formatKes(payment.balance || 0)}. Receipt: ${payment.receipt_number}.`;
  document.querySelector('#payment-confirmation-copy').textContent = message;
  const email = student?.personal_email;
  const emailLink = document.querySelector('#payment-confirmation-email');
  emailLink.hidden = !email; emailLink.href = email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Payment confirmation ${payment.receipt_number}`)}&body=${encodeURIComponent(message)}` : '#';
  document.querySelector('#download-confirmation-receipt').onclick = () => downloadReceipt(payment);
  openDialog('payment-confirmation-modal');
}

async function loadStudentsInto(selectId) {
  const select = document.querySelector(`#${selectId}`);
  select.replaceChildren(option('Loading students…'));
  const { data, error } = await state.client.from('students')
    .select('id, registration_number, first_name, last_name')
    .eq('status', 'active').order('registration_number').limit(500);
  if (error) throw error;
  select.replaceChildren(option('Select student'));
  (data || []).forEach((student) => select.append(option(`${registrationLabel(student.registration_number)} — ${student.first_name} ${student.last_name}`, student.id)));
}

async function loadOpenInvoicesIntoPaymentForm() {
  const select = document.querySelector('#payment-invoice');
  select.replaceChildren(option('Loading invoices…'));
  const { data, error } = await state.client.from('invoices')
    .select('id, student_id, invoice_number, amount, status, students(registration_number, first_name, last_name)')
    .in('status', ['issued', 'part_paid']).order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  openInvoices = new Map();
  select.replaceChildren(option('Select invoice'));
  (data || []).forEach((invoice) => {
    const student = Array.isArray(invoice.students) ? invoice.students[0] : invoice.students;
    openInvoices.set(invoice.id, invoice);
    select.append(option(`${invoice.invoice_number} — ${student?.registration_number || 'Student'} (${formatKes(invoice.amount)})`, invoice.id));
  });
}

export async function loadFinance() {
  if (!requireAdministrator()) return;
  setText('finance-message', 'Loading financial records…');
  try {
    const [summaryResult, invoicesResult, paymentsResult] = await Promise.all([
      loadOperationalSummary(),
      state.client.from('invoices')
        .select('id, invoice_number, amount, due_on, status, students(id, registration_number, first_name, last_name)')
        .order('created_at', { ascending: false }).limit(50),
      state.client.from('payments')
        .select('id, receipt_number, amount, method, reference, received_at, students(id, registration_number, first_name, last_name, personal_email), invoices(invoice_number)')
        .order('received_at', { ascending: false }).limit(50),
    ]);
    if (invoicesResult.error) throw invoicesResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
    const summary = summaryResult || {};
    setText('finance-invoiced', formatKes(summary.total_invoiced));
    setText('finance-collected', formatKes(summary.total_collected));
    const rate = Number(summary.total_invoiced || 0)
      ? (Number(summary.total_collected || 0) / Number(summary.total_invoiced || 0)) * 100 : 0;
    setText('finance-rate', `${rate.toFixed(1)}% collection rate`);
    setText('finance-outstanding', formatKes(summary.total_outstanding));
    setText('finance-debtors', `${summary.students_with_balance || 0} student${Number(summary.students_with_balance || 0) === 1 ? '' : 's'} with a balance`);
    clearTable('finance-table');
    const invoices = invoicesResult.data || [];
    setText('finance-message', invoices.length ? 'Fee charges and receipt records are up to date.' : 'No fee charges have been created yet.');
    invoices.forEach((invoice) => {
      const student = Array.isArray(invoice.students) ? invoice.students[0] : invoice.students;
      appendTableRow('finance-table', [
        student ? createStudentProfileLink(`${student.first_name} ${student.last_name}`, student.id, 'finance', 'finance') : 'Student unavailable',
        invoice.invoice_number, formatKes(invoice.amount), invoice.due_on || '—', invoice.status,
      ]);
    });
    clearTable('receipts-table'); recentPayments = new Map();
    (paymentsResult.data || []).forEach((payment) => {
      const student = Array.isArray(payment.students) ? payment.students[0] : payment.students;
      recentPayments.set(payment.id, payment);
      const receiptButton = document.createElement('button'); receiptButton.type = 'button'; receiptButton.className = 'text-button'; receiptButton.dataset.receiptDownload = payment.id; receiptButton.textContent = 'Download receipt';
      appendTableRow('receipts-table', [payment.receipt_number, student ? createStudentProfileLink(`${student.first_name} ${student.last_name}`, student.id, 'finance', 'finance') : 'Student unavailable', formatKes(payment.amount), payment.method, new Date(payment.received_at).toLocaleDateString(), receiptButton]);
    });
  } catch (error) {
    setText('finance-message', friendlyDbError(error, 'Unable to load finance data. Apply Phase 5 and Phase 6, then try again.'));
  }
}

async function openInvoiceForm() {
  if (!requireAdministrator()) return;
  try {
    await loadStudentsInto('invoice-student');
    document.querySelector('#invoice-form').reset();
    document.querySelector('#invoice-number').value = createReference('FEE');
    document.querySelector('#invoice-due-on').value = new Date().toISOString().slice(0, 10);
    setFormMessage('invoice-form-message');
    openDialog('invoice-modal');
  } catch (error) {
    showToast(friendlyDbError(error, 'Unable to prepare the invoice form.'));
  }
}

async function submitInvoice(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-invoice');
  setButtonBusy(button, true, 'Saving…', 'Save fee charge');
  setFormMessage('invoice-form-message');
  try {
    const { error } = await state.client.from('invoices').insert({
      student_id: document.querySelector('#invoice-student').value,
      invoice_number: document.querySelector('#invoice-number').value.trim(),
      amount: Number(document.querySelector('#invoice-amount').value),
      due_on: document.querySelector('#invoice-due-on').value || null,
      status: 'issued', issued_at: new Date().toISOString(),
    });
    if (error) throw error;
    closeDialog('invoice-modal');
    showToast('Fee charge saved successfully.');
    await loadFinance();
  } catch (error) {
    setFormMessage('invoice-form-message', friendlyDbError(error, 'Could not issue the invoice.'));
  } finally {
    setButtonBusy(button, false, '', 'Save fee charge');
  }
}

async function openPaymentForm() {
  if (!requireAdministrator()) return;
  try {
    await loadOpenInvoicesIntoPaymentForm();
    document.querySelector('#payment-form').reset();
    document.querySelector('#payment-receipt').value = createReference('RCT');
    document.querySelector('#payment-method').value = 'M-PESA';
    setFormMessage('payment-form-message');
    openDialog('payment-modal');
  } catch (error) {
    showToast(friendlyDbError(error, 'Unable to prepare the payment form.'));
  }
}

async function openMpesaForm() {
  if (!requireAdministrator()) return;
  try {
    await loadOpenInvoicesIntoPaymentForm();
    const source = document.querySelector('#payment-invoice');
    const target = document.querySelector('#mpesa-invoice');
    target.replaceChildren(...[...source.options].map((entry) => new Option(entry.text, entry.value)));
    document.querySelector('#mpesa-stk-form').reset();
    setFormMessage('mpesa-stk-form-message'); openDialog('mpesa-stk-modal');
  } catch (error) { showToast(friendlyDbError(error, 'Unable to prepare the M-Pesa request.')); }
}

async function requestMpesaStk(event) {
  event.preventDefault();
  const button = document.querySelector('#send-mpesa-stk');
  setButtonBusy(button, true, 'Sending…', 'Send M-Pesa prompt'); setFormMessage('mpesa-stk-form-message');
  try {
    const { data, error } = await state.client.functions.invoke('mpesa-stk', { body: { invoiceId: document.querySelector('#mpesa-invoice').value, amount: Number(document.querySelector('#mpesa-amount').value), phone: document.querySelector('#mpesa-phone').value.trim() } });
    if (error || data?.error) throw error || new Error(data.error);
    closeDialog('mpesa-stk-modal'); showToast(data.message || 'M-Pesa prompt sent.');
  } catch (error) { setFormMessage('mpesa-stk-form-message', await friendlyFunctionError(error, 'Could not send the M-Pesa prompt.')); }
  finally { setButtonBusy(button, false, '', 'Send M-Pesa prompt'); }
}

async function submitPayment(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-payment');
  const invoice = openInvoices.get(document.querySelector('#payment-invoice').value);
  if (!invoice) return setFormMessage('payment-form-message', 'Select an open invoice first.');
  setButtonBusy(button, true, 'Recording…', 'Record payment');
  setFormMessage('payment-form-message');
  try {
    const { data: payment, error } = await state.client.from('payments').insert({
      student_id: invoice.student_id,
      invoice_id: invoice.id,
      receipt_number: document.querySelector('#payment-receipt').value.trim(),
      amount: Number(document.querySelector('#payment-amount').value),
      method: document.querySelector('#payment-method').value,
      reference: document.querySelector('#payment-reference').value.trim() || null,
      recorded_by: state.user.id,
    }).select('id, receipt_number, amount, method, reference, received_at, students(id, registration_number, first_name, last_name, personal_email), invoices(invoice_number)').single();
    if (error) throw error;
    const { data: paymentRows, error: totalError } = await state.client.from('payments').select('amount').eq('invoice_id', invoice.id);
    if (totalError) throw totalError;
    payment.balance = Math.max(0, Number(invoice.amount) - (paymentRows || []).reduce((sum, row) => sum + Number(row.amount || 0), 0));
    closeDialog('payment-modal');
    showToast('Payment recorded. Receipt is ready to download.');
    await loadFinance();
    showConfirmation(payment);
  } catch (error) {
    setFormMessage('payment-form-message', friendlyDbError(error, 'Could not record this payment.'));
  } finally {
    setButtonBusy(button, false, '', 'Record payment');
  }
}

export function initFinance() {
  document.querySelector('#add-invoice').addEventListener('click', openInvoiceForm);
  document.querySelector('#record-payment').addEventListener('click', openPaymentForm);
  document.querySelector('#request-mpesa-stk').addEventListener('click', openMpesaForm);
  document.querySelector('#invoice-form').addEventListener('submit', submitInvoice);
  document.querySelector('#payment-form').addEventListener('submit', submitPayment);
  document.querySelector('#mpesa-stk-form').addEventListener('submit', requestMpesaStk);
  document.querySelector('#receipts-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-receipt-download]');
    if (button) downloadReceipt(recentPayments.get(button.dataset.receiptDownload));
  });
}
