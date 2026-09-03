import {
  closeDialog, formatKes, friendlyDbError, friendlyFunctionError, openDialog,
  setButtonBusy, setFormMessage, showToast, state,
} from './core.js';

let currentSummary = '';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function panel(title, description) {
  const section = element('section', 'panel');
  const head = element('div', 'panel-head');
  const copy = document.createElement('div');
  copy.append(element('h3', '', title), element('p', '', description));
  head.append(copy);
  section.append(head);
  return { section, head };
}

function appendRow(body, values) {
  const row = document.createElement('tr');
  values.forEach((value) => row.append(element('td', '', value)));
  body.append(row);
}

function dateText(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function statusText(status) {
  return String(status || 'pending').replaceAll('_', ' ');
}

function setMethodFields() {
  const method = document.querySelector('#student-payment-method').value;
  const mpesa = method === 'M-PESA';
  document.querySelector('#student-payment-phone-label').hidden = !mpesa;
  document.querySelector('#student-payment-details-label').hidden = mpesa;
  document.querySelector('#student-payment-phone').required = mpesa;
  document.querySelector('#student-payment-details').required = !mpesa;
  document.querySelector('#submit-student-payment').textContent = mpesa ? 'Send M-Pesa prompt' : 'Submit for finance approval';
}

export function renderStudentPaymentSections(content, account, submissions = [], mpesaRequests = []) {
  const action = panel('Pay school fees', 'M-Pesa payments update automatically once Safaricom confirms them. Card and cheque payments require finance approval.');
  const payButton = element('button', 'primary-button', 'Make a payment');
  payButton.type = 'button';
  payButton.dataset.studentMakePayment = 'true';
  action.head.append(payButton);
  const balance = Number(account?.balance || 0);
  currentSummary = `Programme fee: ${formatKes(account?.total_fee)} · Confirmed payments: ${formatKes(account?.total_paid)} · ${balance > 0 ? `Balance due: ${formatKes(balance)}` : balance < 0 ? `Excess credit: ${formatKes(Math.abs(balance))}` : 'Fully paid'}`;
  action.section.append(element('p', 'form-note', balance > 0 ? `Current amount due: ${formatKes(balance)}.` : balance < 0 ? `Your account has an excess credit of ${formatKes(Math.abs(balance))}.` : 'Your account is fully paid.'));
  content.append(action.section);

  const requestPanel = panel('Payment confirmations', 'M-Pesa prompts are reconciled automatically. Submitted card and cheque details remain pending until approved by finance.');
  const wrap = element('div', 'table-wrap');
  const table = document.createElement('table');
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>Method</th><th>Amount</th><th>Status</th><th>Reference / note</th><th>Submitted</th></tr>';
  const body = document.createElement('tbody');
  const requests = [
    ...mpesaRequests.map((request) => ({ method: 'M-PESA', amount: request.amount, status: request.status, note: request.mpesa_receipt_number || request.result_description || 'Awaiting M-Pesa confirmation', at: request.created_at })),
    ...submissions.map((submission) => ({ method: submission.method, amount: submission.amount, status: submission.status, note: submission.transaction_details, at: submission.submitted_at })),
  ].sort((left, right) => new Date(right.at) - new Date(left.at));
  requests.forEach((request) => appendRow(body, [request.method, formatKes(request.amount), statusText(request.status), request.note, dateText(request.at)]));
  if (!requests.length) appendRow(body, ['No payment confirmations yet.', '—', '—', '—', '—']);
  table.append(head, body);
  wrap.append(table);
  requestPanel.section.append(wrap);
  content.append(requestPanel.section);
}

async function submitStudentPayment(event) {
  event.preventDefault();
  const button = document.querySelector('#submit-student-payment');
  const method = document.querySelector('#student-payment-method').value;
  const amount = Number(document.querySelector('#student-payment-amount').value);
  setButtonBusy(button, true, method === 'M-PESA' ? 'Sending…' : 'Submitting…', method === 'M-PESA' ? 'Send M-Pesa prompt' : 'Submit for finance approval');
  setFormMessage('student-payment-form-message');
  try {
    if (method === 'M-PESA') {
      const { data, error } = await state.client.functions.invoke('mpesa-stk', {
        body: { amount, phone: document.querySelector('#student-payment-phone').value.trim() },
      });
      if (error) throw new Error(await friendlyFunctionError(error, 'Unable to send the M-Pesa prompt.'));
      closeDialog('student-payment-modal');
      showToast(data?.message || 'M-Pesa prompt sent. Your payment record will update once it is confirmed.');
      window.setTimeout(() => document.dispatchEvent(new CustomEvent('student-profile:refresh-finance', { detail: {} })), 8000);
    } else {
      const { error } = await state.client.rpc('submit_own_payment_proof', {
        paid_amount: amount,
        payment_method: method,
        transaction_details: document.querySelector('#student-payment-details').value.trim(),
      });
      if (error) throw error;
      closeDialog('student-payment-modal');
      showToast('Payment details submitted. Your balance will update after finance approval.');
      document.dispatchEvent(new CustomEvent('student-profile:refresh-finance', { detail: {} }));
    }
  } catch (error) {
    setFormMessage('student-payment-form-message', error?.message || friendlyDbError(error, 'Could not submit this payment.'));
  } finally {
    setButtonBusy(button, false, '', method === 'M-PESA' ? 'Send M-Pesa prompt' : 'Submit for finance approval');
  }
}

function openStudentPayment() {
  document.querySelector('#student-payment-form').reset();
  document.querySelector('#student-payment-account').textContent = currentSummary;
  setMethodFields();
  setFormMessage('student-payment-form-message');
  openDialog('student-payment-modal');
}

export function initStudentPayments() {
  document.querySelector('#student-payment-form').addEventListener('submit', submitStudentPayment);
  document.querySelector('#student-payment-method').addEventListener('change', setMethodFields);
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-student-make-payment]')) openStudentPayment();
  });
}
