import {
  state, appendTableRow, clearTable, closeDialog, formatKes, friendlyDbError, openDialog,
  registrationLabel, requireAdministrator, setButtonBusy, setFormMessage, setText, showToast,
} from './core.js';
import { createStudentProfileLink } from './student-profile.js';
import { receiptDocument } from './receipt-template.js';

let financeAccounts = new Map();
let selectedPaymentStudentId = null;

function receiptNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  return `RCT-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function accountLabel(account) {
  if (Number(account.balance) < 0) return `Excess ${formatKes(Math.abs(Number(account.balance)))}`;
  if (Number(account.balance) === 0 && Number(account.total_fee) > 0) return 'Fully paid';
  return `Balance ${formatKes(account.balance)}`;
}

function downloadReceipt(payment) {
  const blob = new Blob([receiptDocument(payment)], { type: 'text/html' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = `${payment.receipt_number}.html`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function showConfirmation(payment) {
  const student = Array.isArray(payment.students) ? payment.students[0] : payment.students;
  const balanceText = Number(payment.balance) < 0 ? `Excess credit: ${formatKes(Math.abs(Number(payment.balance)))}.` : `Balance: ${formatKes(payment.balance)}.`;
  document.querySelector('#payment-confirmation-copy').textContent = `LOVE & TRUTH BIBLE AND SKILLS TRAINING COLLEGE: Thank you. We received ${formatKes(payment.amount)} for ${student?.first_name || ''} ${student?.last_name || ''} (${student?.registration_number || '—'}). ${balanceText} Receipt: ${payment.receipt_number}.`;
  const email = student?.personal_email;
  const emailLink = document.querySelector('#payment-confirmation-email');
  emailLink.hidden = !email;
  emailLink.href = email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Payment confirmation ${payment.receipt_number}`)}&body=${encodeURIComponent(document.querySelector('#payment-confirmation-copy').textContent)}` : '#';
  document.querySelector('#download-confirmation-receipt').onclick = () => downloadReceipt(payment);
  openDialog('payment-confirmation-modal');
}

function payButton(studentId) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'primary-button'; button.dataset.financePay = studentId; button.textContent = 'Pay';
  return button;
}

function reviewButton(label, submissionId, approve) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = approve ? 'primary-button' : 'outline-button';
  button.dataset.paymentSubmissionId = submissionId;
  button.dataset.paymentSubmissionDecision = String(approve);
  button.textContent = label;
  return button;
}

function setFinanceSummary(summary) {
  setText('finance-total-fee', formatKes(summary?.total_fee));
  setText('finance-total-collected', formatKes(summary?.total_collected));
  const balance = Number(summary?.total_balance || 0);
  setText('finance-total-balance', balance < 0 ? `Credit ${formatKes(Math.abs(balance))}` : formatKes(balance));
  setText('finance-student-count', `${summary?.active_students || 0} active student account${Number(summary?.active_students || 0) === 1 ? '' : 's'}`);
  setText('finance-pending-amount', `${summary?.pending_submissions || 0} payment${Number(summary?.pending_submissions || 0) === 1 ? '' : 's'} awaiting approval · ${formatKes(summary?.pending_submission_amount)}`);
}

function renderPendingSubmissions(submissions) {
  clearTable('payment-submissions-table');
  (submissions || []).forEach((submission) => {
    const student = Array.isArray(submission.students) ? submission.students[0] : submission.students;
    const actions = document.createElement('div');
    actions.className = 'button-row';
    actions.append(reviewButton('Approve', submission.id, true), reviewButton('Reject', submission.id, false));
    appendTableRow('payment-submissions-table', [
      createStudentProfileLink(`${student?.first_name || 'Student'} ${student?.last_name || ''}`.trim(), submission.student_id, 'finance', 'finance'),
      formatKes(submission.amount), submission.method, submission.transaction_details,
      new Date(submission.submitted_at).toLocaleString(), actions,
    ]);
  });
  setText('payment-submissions-message', submissions?.length ? `${submissions.length} payment submission${submissions.length === 1 ? '' : 's'} require finance approval.` : 'No card or cheque payment submissions are awaiting approval.');
}

export async function loadFinance() {
  if (!requireAdministrator()) return;
  setText('finance-message', 'Loading student finance accounts…');
  try {
    const [accountsResult, summaryResult, submissionsResult] = await Promise.all([
      state.client.rpc('student_finance_accounts'),
      state.client.rpc('institution_finance_summary').maybeSingle(),
      state.client.from('student_payment_submissions').select('id, student_id, amount, method, transaction_details, submitted_at, students(first_name, last_name)').eq('status', 'pending').order('submitted_at'),
    ]);
    if (accountsResult.error) throw accountsResult.error;
    if (summaryResult.error) throw summaryResult.error;
    if (submissionsResult.error) throw submissionsResult.error;
    const data = accountsResult.data;
    setFinanceSummary(summaryResult.data);
    renderPendingSubmissions(submissionsResult.data || []);
    financeAccounts = new Map((data || []).map((account) => [account.student_id, account]));
    clearTable('finance-table');
    (data || []).forEach((account) => appendTableRow('finance-table', [
      createStudentProfileLink(`${account.first_name} ${account.last_name}`, account.student_id, 'finance', 'finance'),
      registrationLabel(account.registration_number), `${account.programme_name} (${account.programme_code})`,
      formatKes(account.total_fee), formatKes(account.total_paid), accountLabel(account), payButton(account.student_id),
    ]));
    setText('finance-message', data?.length ? 'Select a student to review their full payment history or record a payment.' : 'No active students are available for finance records.');
  } catch (error) { setText('finance-message', friendlyDbError(error, 'Unable to load student finance accounts.')); }
}

async function reviewPaymentSubmission(submissionId, approve) {
  if (!requireAdministrator()) return;
  try {
    const { data, error } = await state.client.rpc('approve_student_payment_submission', {
      target_submission_id: submissionId,
      approve,
      decision_note: null,
    }).single();
    if (error) throw error;
    showToast(approve ? `Payment approved. Receipt ${data?.receipt_number || 'created'} is now on the student account.` : 'Payment submission rejected. The student can submit corrected details.');
    await loadFinance();
    document.dispatchEvent(new CustomEvent('student-profile:refresh-finance', { detail: { studentId: null } }));
  } catch (error) { showToast(friendlyDbError(error, 'Could not review this payment submission.')); }
}

async function openPaymentForm(studentId) {
  if (!requireAdministrator()) return;
  try {
    let account = financeAccounts.get(studentId);
    if (!account) {
      const { data, error } = await state.client.rpc('student_finance_snapshot', { target_student_id: studentId }).maybeSingle();
      if (error || !data) throw error || new Error('Student finance account was not found.');
      account = data;
    }
    selectedPaymentStudentId = studentId;
    document.querySelector('#payment-form').reset();
    document.querySelector('#payment-student-id').value = studentId;
    document.querySelector('#payment-student-account').textContent = `${account.first_name} ${account.last_name} · ${registrationLabel(account.registration_number)} · ${account.programme_name}`;
    document.querySelector('#payment-account-summary').textContent = `Programme fee: ${formatKes(account.total_fee)} · Paid: ${formatKes(account.total_paid)} · ${accountLabel(account)}`;
    document.querySelector('#payment-receipt').value = receiptNumber();
    document.querySelector('#payment-method').value = 'M-PESA';
    setFormMessage('payment-form-message'); openDialog('payment-modal');
  } catch (error) { showToast(friendlyDbError(error, 'Unable to prepare this student payment.')); }
}

async function submitPayment(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-payment');
  setButtonBusy(button, true, 'Recording…', 'Record payment'); setFormMessage('payment-form-message');
  try {
    const { data: saved, error } = await state.client.rpc('record_student_payment', {
      target_student_id: selectedPaymentStudentId || document.querySelector('#payment-student-id').value,
      paid_amount: Number(document.querySelector('#payment-amount').value),
      payment_method: document.querySelector('#payment-method').value,
      payment_reference: document.querySelector('#payment-reference').value.trim(),
      receipt_no: document.querySelector('#payment-receipt').value.trim(),
    }).single();
    if (error || !saved) throw error || new Error('Payment was not recorded.');
    const { data: payment, error: paymentError } = await state.client.from('payments')
      .select('id, receipt_number, amount, method, reference, received_at, students(id, registration_number, first_name, last_name, personal_email), invoices(invoice_number)')
      .eq('id', saved.payment_id).single();
    if (paymentError) throw paymentError;
    payment.balance = saved.balance; payment.totalFee = saved.total_fee; payment.accountState = saved.account_state;
    selectedPaymentStudentId = null;
    closeDialog('payment-modal'); showToast('Payment recorded. Receipt is ready to print or download.');
    await loadFinance(); showConfirmation(payment);
    document.dispatchEvent(new CustomEvent('student-profile:refresh-finance', { detail: { studentId: payment.students?.id || payment.students?.[0]?.id } }));
  } catch (error) { setFormMessage('payment-form-message', friendlyDbError(error, 'Could not record this payment.')); }
  finally { setButtonBusy(button, false, '', 'Record payment'); }
}

export function initFinance() {
  document.querySelector('#payment-form').addEventListener('submit', submitPayment);
  document.querySelector('#finance-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-finance-pay]');
    if (button) openPaymentForm(button.dataset.financePay);
  });
  document.querySelector('#payment-submissions-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-payment-submission-id]');
    if (button) reviewPaymentSubmission(button.dataset.paymentSubmissionId, button.dataset.paymentSubmissionDecision === 'true');
  });
  document.addEventListener('finance:record-payment', (event) => openPaymentForm(event.detail.studentId));
}
