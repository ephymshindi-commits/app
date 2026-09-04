import { formatKes, friendlyDbError, initials, registrationLabel, requireAdministrator, setText, showToast, state } from './core.js';
import { renderStudentPaymentSections } from './student-payments.js';

const profileState = { student: null, finance: null, payments: [], submissions: [], mpesaRequests: [], activeTab: 'overview', source: 'students' };

function related(record) {
  return Array.isArray(record) ? record[0] : record;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function dateText(value) {
  return value ? new Date(`${value}`.slice(0, 10)).toLocaleDateString() : '—';
}

function statusClass(status) {
  return status === 'active' || status === 'paid' ? 'active' : 'pending';
}

function appendRow(body, values) {
  const row = document.createElement('tr');
  values.forEach((value) => row.append(createElement('td', '', value)));
  body.append(row);
}

function panel(title, description) {
  const section = createElement('section', 'panel');
  const head = createElement('div', 'panel-head');
  const copy = document.createElement('div');
  copy.append(createElement('h3', '', title), createElement('p', '', description));
  head.append(copy);
  section.append(head);
  return section;
}

function stat(label, value, note = '') {
  const card = createElement('article', 'stat-card');
  const copy = document.createElement('div');
  copy.append(createElement('p', '', label), createElement('strong', '', value));
  if (note) copy.append(createElement('small', '', note));
  card.append(copy);
  return card;
}

function renderOverview(content) {
  const student = profileState.student;
  const details = panel('Student details', 'Core admission and contact information.');
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  appendRow(body, ['Admission date', dateText(student.admitted_at)]);
  appendRow(body, ['Registration number', registrationLabel(student.registration_number)]);
  appendRow(body, ['Academic status', student.status.replace('_', ' ')]);
  appendRow(body, ['Next of kin', [student.next_of_kin_name, student.next_of_kin_relationship, student.next_of_kin_phone].filter(Boolean).join(' · ') || '—']);
  table.append(body);
  details.append(table);
  content.append(details);
  if (state.role === 'administrator') {
    const account = panel('Student login', 'Students sign in with their registration number. Passwords are never stored in readable form.');
    account.append(createElement('p', 'form-note', `Username: ${registrationLabel(student.registration_number)}`));
    const action = createElement('button', 'outline-button', 'Reset temporary password');
    action.type = 'button';
    action.dataset.studentPasswordReset = student.id;
    account.append(action);
    content.append(account);
  }
}

function renderFinance(content) {
  const payments = profileState.payments;
  const account = profileState.finance || { total_fee: 0, total_paid: 0, balance: 0, account_state: 'fee structure pending' };
  const balance = Number(account.balance || 0);
  const balanceLabel = balance < 0 ? 'Excess credit' : balance === 0 && Number(account.total_fee) > 0 ? 'Balance' : 'Fee balance';
  const balanceValue = balance < 0 ? formatKes(Math.abs(balance)) : formatKes(balance);
  const stats = createElement('div', 'stats-grid mini');
  stats.append(
    stat('Programme fee', formatKes(account.total_fee)),
    stat('Payments received', formatKes(account.total_paid), `${payments.length} payment${payments.length === 1 ? '' : 's'} recorded`),
    stat(balanceLabel, balanceValue, account.account_state || '—'),
  );
  content.append(stats);

  const paymentPanel = panel('Payment record', 'Receipts recorded against this student account and its programme fee structure.');
  if (state.role === 'administrator') {
    const payButton = createElement('button', 'primary-button', 'Pay');
    payButton.type = 'button';
    payButton.dataset.studentFinancePay = profileState.student.id;
    paymentPanel.querySelector('.panel-head').append(payButton);
  }
  const paymentWrap = createElement('div', 'table-wrap');
  const paymentTable = document.createElement('table');
  const paymentHead = document.createElement('thead');
  paymentHead.innerHTML = '<tr><th>Receipt no.</th><th>Amount</th><th>Method</th><th>Reference</th><th>Received</th></tr>';
  const paymentBody = document.createElement('tbody');
  payments.forEach((payment) => appendRow(paymentBody, [payment.receipt_number, formatKes(payment.amount), payment.method, payment.reference || '—', new Date(payment.received_at).toLocaleDateString()]));
  if (!payments.length) appendRow(paymentBody, ['No payments recorded.', '—', '—', '—', '—']);
  paymentTable.append(paymentHead, paymentBody);
  paymentWrap.append(paymentTable);
  paymentPanel.append(paymentWrap);
  content.append(paymentPanel);
  if (state.role === 'student') renderStudentPaymentSections(content, account, profileState.submissions, profileState.mpesaRequests);
}

function renderContent() {
  const content = document.querySelector('#student-profile-content');
  if (!content || !profileState.student) return;
  content.replaceChildren();
  if (profileState.activeTab === 'finance') renderFinance(content);
  else renderOverview(content);
  document.querySelectorAll('[data-profile-tab]').forEach((tab) => {
    const active = tab.dataset.profileTab === profileState.activeTab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
}

function renderProfile() {
  const student = profileState.student;
  const programme = related(student.programmes);
  setText('student-profile-name', `${student.first_name} ${student.last_name}`);
  setText('student-profile-subtitle', `${registrationLabel(student.registration_number)} · Student profile`);
  setText('student-profile-avatar', initials(`${student.first_name} ${student.last_name}`));
  setText('student-profile-registration', registrationLabel(student.registration_number));
  setText('student-profile-programme', programme ? `${programme.name}${programme.code ? ` (${programme.code})` : ''}` : 'Programme not assigned');
  setText('student-profile-phone', student.phone || '—');
  setText('student-profile-email', student.personal_email || '—');
  setText('student-profile-kin', [student.next_of_kin_name, student.next_of_kin_relationship].filter(Boolean).join(' · ') || student.next_of_kin_phone || '—');
  const status = document.querySelector('#student-profile-status');
  status.textContent = student.status.replace('_', ' ');
  status.className = `status ${statusClass(student.status)}`;
  const back = document.querySelector('#student-profile-back');
  back.textContent = `← Back to ${profileState.source === 'finance' ? 'finance' : 'students'}`;
  renderContent();
}

export function createStudentProfileLink(label, studentId, tab = 'overview', source = 'students') {
  const button = createElement('button', 'student-link', label);
  button.type = 'button';
  button.dataset.studentProfileId = studentId;
  button.dataset.studentProfileTab = tab;
  button.dataset.studentProfileSource = source;
  return button;
}

export async function openStudentProfile(studentId, tab = 'overview', source = 'students') {
  if (!requireAdministrator() && state.role !== 'student') return;
  profileState.activeTab = tab;
  profileState.source = source;
  setText('student-profile-name', 'Loading student profile…');
  setText('student-profile-subtitle', 'Retrieving student records.');
  document.querySelector('#student-profile-content').replaceChildren();
  try {
    if (!studentId) {
      const { data: ownStudent, error: ownStudentError } = await state.client.from('students').select('id').eq('profile_id', state.user.id).maybeSingle();
      if (ownStudentError || !ownStudent) throw ownStudentError || new Error('Student profile was not found.');
      studentId = ownStudent.id;
    }
    const [studentResult, financeResult, paymentsResult, submissionsResult, mpesaRequestsResult] = await Promise.all([
      state.client.from('students').select('id, registration_number, first_name, last_name, phone, personal_email, status, admitted_at, next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, programmes(name, code)').eq('id', studentId).maybeSingle(),
      state.role === 'student' ? state.client.rpc('my_student_finance_snapshot').maybeSingle() : state.client.rpc('student_finance_snapshot', { target_student_id: studentId }).maybeSingle(),
      state.role === 'student' ? state.client.rpc('my_student_payment_history') : state.client.from('payments').select('id, receipt_number, amount, method, reference, received_at').eq('student_id', studentId).order('received_at', { ascending: false }),
      state.role === 'student' ? state.client.rpc('my_student_payment_submissions') : Promise.resolve({ data: [], error: null }),
      state.role === 'student' ? state.client.rpc('my_mpesa_payment_requests') : Promise.resolve({ data: [], error: null }),
    ]);
    if (studentResult.error) throw studentResult.error;
    if (!studentResult.data) throw new Error('Student record was not found.');
    if (financeResult.error) throw financeResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
    if (submissionsResult.error) throw submissionsResult.error;
    if (mpesaRequestsResult.error) throw mpesaRequestsResult.error;
    profileState.student = studentResult.data;
    profileState.finance = financeResult.data;
    profileState.payments = paymentsResult.data || [];
    profileState.submissions = submissionsResult.data || [];
    profileState.mpesaRequests = mpesaRequestsResult.data || [];
    renderProfile();
  } catch (error) {
    setText('student-profile-name', 'Student profile unavailable');
    setText('student-profile-subtitle', friendlyDbError(error, 'Unable to retrieve this student record.'));
    showToast(friendlyDbError(error, 'Unable to retrieve this student record.'));
  }
}

export function initStudentProfile() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-student-profile-id]');
    if (!trigger) return;
    document.dispatchEvent(new CustomEvent('student-profile:open', { detail: {
      studentId: trigger.dataset.studentProfileId,
      tab: trigger.dataset.studentProfileTab || 'overview',
      source: trigger.dataset.studentProfileSource || 'students',
    } }));
  });
  document.querySelectorAll('[data-profile-tab]').forEach((tab) => tab.addEventListener('click', () => {
    profileState.activeTab = tab.dataset.profileTab;
    renderContent();
  }));
  document.querySelector('#student-profile-back').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('student-profile:back', { detail: { source: profileState.source } }));
  });
  document.querySelector('#student-profile-content').addEventListener('click', (event) => {
    const button = event.target.closest('[data-student-finance-pay]');
    if (button) document.dispatchEvent(new CustomEvent('finance:record-payment', { detail: { studentId: button.dataset.studentFinancePay } }));
    const resetButton = event.target.closest('[data-student-password-reset]');
    if (resetButton) resetStudentPassword(resetButton.dataset.studentPasswordReset);
  });
  document.addEventListener('student-profile:refresh-finance', (event) => {
    const studentRefresh = state.role === 'student' || profileState.student?.id === event.detail?.studentId;
    if (studentRefresh && profileState.activeTab === 'finance') {
      openStudentProfile(state.role === 'student' ? null : event.detail.studentId, 'finance', profileState.source);
    }
  });
}

async function resetStudentPassword(studentId) {
  if (!requireAdministrator()) return;
  if (!window.confirm('Reset this student’s password? The new temporary password will be shown once.')) return;
  try {
    const { data, error } = await state.client.functions.invoke('admin-reset-student-password', { body: { studentId } });
    if (error || data?.error) throw error || new Error(data.error);
    const account = data.account;
    document.querySelector('#student-login-details').textContent = `Student: ${account.fullName}\nUsername: ${account.username}\nTemporary password: ${account.temporaryPassword}`;
    document.querySelector('#student-login-details-modal').showModal();
    showToast('New temporary password created. Give it to the student privately.');
  } catch (error) {
    showToast(friendlyDbError(error, 'Unable to reset the student password.'));
  }
}
