import { formatKes, friendlyDbError, initials, requireAdministrator, setText, showToast, state } from './core.js';

const profileState = { student: null, invoices: [], payments: [], activeTab: 'overview', source: 'students' };

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
  appendRow(body, ['Registration number', student.registration_number]);
  appendRow(body, ['Academic status', student.status.replace('_', ' ')]);
  appendRow(body, ['Next of kin', [student.next_of_kin_name, student.next_of_kin_relationship, student.next_of_kin_phone].filter(Boolean).join(' · ') || '—']);
  table.append(body);
  details.append(table);
  content.append(details);
}

function renderFinance(content) {
  const invoices = profileState.invoices;
  const payments = profileState.payments;
  const invoiced = invoices.reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const paid = payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const outstanding = Math.max(0, invoiced - paid);
  const stats = createElement('div', 'stats-grid mini');
  stats.append(stat('Total invoiced', formatKes(invoiced)), stat('Payments received', formatKes(paid), `${payments.length} payment${payments.length === 1 ? '' : 's'} recorded`), stat('Outstanding balance', formatKes(outstanding)));
  content.append(stats);

  const invoicePanel = panel('Invoices', 'All invoices issued to this student.');
  const invoiceWrap = createElement('div', 'table-wrap');
  const invoiceTable = document.createElement('table');
  const invoiceHead = document.createElement('thead');
  invoiceHead.innerHTML = '<tr><th>Invoice no.</th><th>Amount</th><th>Due date</th><th>Status</th></tr>';
  const invoiceBody = document.createElement('tbody');
  invoices.forEach((invoice) => appendRow(invoiceBody, [invoice.invoice_number, formatKes(invoice.amount), dateText(invoice.due_on), invoice.status]));
  if (!invoices.length) appendRow(invoiceBody, ['No invoices issued.', '—', '—', '—']);
  invoiceTable.append(invoiceHead, invoiceBody);
  invoiceWrap.append(invoiceTable);
  invoicePanel.append(invoiceWrap);
  content.append(invoicePanel);

  const paymentPanel = panel('Payment record', 'Receipts recorded against this student account.');
  const paymentWrap = createElement('div', 'table-wrap');
  const paymentTable = document.createElement('table');
  const paymentHead = document.createElement('thead');
  paymentHead.innerHTML = '<tr><th>Receipt no.</th><th>Invoice</th><th>Amount</th><th>Method</th><th>Received</th></tr>';
  const paymentBody = document.createElement('tbody');
  payments.forEach((payment) => appendRow(paymentBody, [payment.receipt_number, related(payment.invoices)?.invoice_number || '—', formatKes(payment.amount), payment.method, new Date(payment.received_at).toLocaleDateString()]));
  if (!payments.length) appendRow(paymentBody, ['No payments recorded.', '—', '—', '—', '—']);
  paymentTable.append(paymentHead, paymentBody);
  paymentWrap.append(paymentTable);
  paymentPanel.append(paymentWrap);
  content.append(paymentPanel);
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
  setText('student-profile-subtitle', `${student.registration_number} · Student profile`);
  setText('student-profile-avatar', initials(`${student.first_name} ${student.last_name}`));
  setText('student-profile-registration', student.registration_number);
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
  if (!requireAdministrator()) return;
  profileState.activeTab = tab;
  profileState.source = source;
  setText('student-profile-name', 'Loading student profile…');
  setText('student-profile-subtitle', 'Retrieving student records.');
  document.querySelector('#student-profile-content').replaceChildren();
  try {
    const [studentResult, invoicesResult, paymentsResult] = await Promise.all([
      state.client.from('students').select('id, registration_number, first_name, last_name, phone, personal_email, status, admitted_at, next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, programmes(name, code)').eq('id', studentId).maybeSingle(),
      state.client.from('invoices').select('id, invoice_number, amount, due_on, status').eq('student_id', studentId).order('created_at', { ascending: false }),
      state.client.from('payments').select('id, receipt_number, amount, method, received_at, invoices(invoice_number)').eq('student_id', studentId).order('received_at', { ascending: false }),
    ]);
    if (studentResult.error) throw studentResult.error;
    if (!studentResult.data) throw new Error('Student record was not found.');
    if (invoicesResult.error) throw invoicesResult.error;
    if (paymentsResult.error) throw paymentsResult.error;
    profileState.student = studentResult.data;
    profileState.invoices = invoicesResult.data || [];
    profileState.payments = paymentsResult.data || [];
    renderProfile();
  } catch (error) {
    console.error(error);
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
}
