import {
  state, appendTableRow, clearTable, closeDialog, formatKes, friendlyDbError, openDialog,
  requireAdministrator, setButtonBusy, setFormMessage, setText, showToast,
} from './core.js';

let openInvoices = new Map();

function option(label, value = '') {
  return new Option(label, value);
}

function createReference(prefix) {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${suffix}`;
}

async function loadStudentsInto(selectId) {
  const select = document.querySelector(`#${selectId}`);
  select.replaceChildren(option('Loading students…'));
  const { data, error } = await state.client.from('students')
    .select('id, registration_number, first_name, last_name')
    .eq('status', 'active').order('registration_number').limit(500);
  if (error) throw error;
  select.replaceChildren(option('Select student'));
  (data || []).forEach((student) => select.append(option(`${student.registration_number} — ${student.first_name} ${student.last_name}`, student.id)));
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
    const [summaryResult, invoicesResult] = await Promise.all([
      state.client.from('institution_operational_summary').select('*').single(),
      state.client.from('invoices')
        .select('id, invoice_number, amount, due_on, status, students(registration_number, first_name, last_name)')
        .order('created_at', { ascending: false }).limit(50),
    ]);
    if (summaryResult.error) throw summaryResult.error;
    if (invoicesResult.error) throw invoicesResult.error;
    const summary = summaryResult.data || {};
    setText('finance-invoiced', formatKes(summary.total_invoiced));
    setText('finance-collected', formatKes(summary.total_collected));
    const rate = Number(summary.total_invoiced || 0)
      ? (Number(summary.total_collected || 0) / Number(summary.total_invoiced || 0)) * 100 : 0;
    setText('finance-rate', `${rate.toFixed(1)}% collection rate`);
    setText('finance-outstanding', formatKes(summary.total_outstanding));
    setText('finance-debtors', `${summary.students_with_balance || 0} student${Number(summary.students_with_balance || 0) === 1 ? '' : 's'} with a balance`);
    clearTable('finance-table');
    const invoices = invoicesResult.data || [];
    setText('finance-message', invoices.length ? 'Latest 50 invoices. Payment status updates automatically after a payment.' : 'No invoices have been issued yet.');
    invoices.forEach((invoice) => {
      const student = Array.isArray(invoice.students) ? invoice.students[0] : invoice.students;
      appendTableRow('finance-table', [
        student ? `${student.first_name} ${student.last_name}` : 'Student unavailable',
        invoice.invoice_number, formatKes(invoice.amount), invoice.due_on || '—', invoice.status,
      ]);
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
    document.querySelector('#invoice-number').value = createReference('INV');
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
  setButtonBusy(button, true, 'Issuing…', 'Issue invoice');
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
    showToast('Invoice issued successfully.');
    await loadFinance();
  } catch (error) {
    setFormMessage('invoice-form-message', friendlyDbError(error, 'Could not issue the invoice.'));
  } finally {
    setButtonBusy(button, false, '', 'Issue invoice');
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

async function submitPayment(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-payment');
  const invoice = openInvoices.get(document.querySelector('#payment-invoice').value);
  if (!invoice) return setFormMessage('payment-form-message', 'Select an open invoice first.');
  setButtonBusy(button, true, 'Recording…', 'Record payment');
  setFormMessage('payment-form-message');
  try {
    const { error } = await state.client.from('payments').insert({
      student_id: invoice.student_id,
      invoice_id: invoice.id,
      receipt_number: document.querySelector('#payment-receipt').value.trim(),
      amount: Number(document.querySelector('#payment-amount').value),
      method: document.querySelector('#payment-method').value,
      reference: document.querySelector('#payment-reference').value.trim() || null,
      recorded_by: state.user.id,
    });
    if (error) throw error;
    closeDialog('payment-modal');
    showToast('Payment recorded and invoice status updated.');
    await loadFinance();
  } catch (error) {
    setFormMessage('payment-form-message', friendlyDbError(error, 'Could not record this payment.'));
  } finally {
    setButtonBusy(button, false, '', 'Record payment');
  }
}

export function initFinance() {
  document.querySelector('#add-invoice').addEventListener('click', openInvoiceForm);
  document.querySelector('#record-payment').addEventListener('click', openPaymentForm);
  document.querySelector('#invoice-form').addEventListener('submit', submitInvoice);
  document.querySelector('#payment-form').addEventListener('submit', submitPayment);
}
