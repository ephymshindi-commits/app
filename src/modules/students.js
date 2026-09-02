import {
  state, appendTableRow, clearTable, closeDialog, friendlyDbError, friendlyFunctionError, initials,
  openDialog, requireAdministrator, setButtonBusy, setFormMessage, setText, showToast,
} from './core.js';
import { createStudentProfileLink } from './student-profile.js';

const PAGE_SIZE = 200;
let searchTimer;
let editingStudentId = null;

function option(label, value = '') {
  return new Option(label, value);
}

async function loadProgrammes() {
  const select = document.querySelector('#student-programme');
  select.replaceChildren(option('Loading programmes…'));
  const { data, error } = await state.client.from('programmes').select('id, name, code').eq('active', true).order('name');
  if (error || !data?.length) {
    select.replaceChildren(option('No active programmes available'));
    return false;
  }
  select.replaceChildren(option('Select programme'));
  data.forEach((programme) => select.append(option(`${programme.name} (${programme.code})`, programme.id)));
  return true;
}

function actionButton(label, action, studentId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button';
  button.dataset.studentAction = action;
  button.dataset.studentId = studentId;
  button.textContent = label;
  return button;
}

function drawStudents(rows) {
  clearTable('student-table');
  setText('student-table-message', rows.length ? 'Showing up to 200 matching students.' : 'No students found.');
  rows.forEach((student, index) => {
    const fullName = `${student.first_name} ${student.last_name}`;
    const name = document.createElement('div');
    const avatar = document.createElement('span');
    avatar.className = `table-avatar ${['blue', 'orange', 'green', 'purple'][index % 4]}`;
    avatar.textContent = initials(fullName);
    const copy = createStudentProfileLink(fullName, student.id, 'overview', 'students');
    name.append(avatar, copy);
    const programme = Array.isArray(student.programmes) ? student.programmes[0] : student.programmes;
    appendTableRow('student-table', [
      name,
      student.registration_number || 'Awaiting account creation',
      programme?.name || '—',
      student.phone || student.personal_email || '—',
      new Date(`${student.admitted_at}T00:00:00`).toLocaleDateString(),
      student.status,
      (() => { const wrap = document.createElement('div'); wrap.className = 'button-row'; wrap.append(actionButton('Edit', 'edit', student.id), actionButton(student.profile_id ? 'Login active' : 'Create login', 'login', student.id)); return wrap; })(),
    ]);
  });
}

export async function loadStudents(query = '') {
  if (!requireAdministrator()) return;
  setText('student-table-message', 'Loading students…');
  let request = state.client
    .from('students')
    .select('id, registration_number, first_name, last_name, phone, personal_email, profile_id, status, admitted_at, programme_id, next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, programmes(name)')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  const term = query.trim();
  if (term) {
    const escaped = term.replace(/[%_,]/g, (character) => `\\${character}`);
    request = request.or(`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,registration_number.ilike.%${escaped}%`);
  }
  try {
    const { data, error } = await request;
    if (error) throw error;
    drawStudents(data || []);
  } catch (error) {
    setText('student-table-message', friendlyDbError(error, 'Unable to load students. Please try again.'));
  }
}

async function openStudentLogin(studentId) {
  const { data: student, error } = await state.client.from('students').select('id, first_name, last_name, registration_number, personal_email, profile_id, programmes(name, code)').eq('id', studentId).maybeSingle();
  if (error || !student) return showToast('Unable to open that student account.');
  if (student.profile_id) return showToast('This student already has a login account.');
  document.querySelector('#student-login-form').reset();
  document.querySelector('#student-login-id').value = student.id;
  const programme = Array.isArray(student.programmes) ? student.programmes[0] : student.programmes;
  setText('student-login-name', `${student.first_name} ${student.last_name} · ${programme?.code || 'Programme code pending'} · Registration number will be issued when this account is created.`);
  document.querySelector('#student-login-email').value = student.personal_email || '';
  setFormMessage('student-login-form-message'); openDialog('student-login-modal');
}

async function createStudentLogin(event) {
  event.preventDefault();
  const button = document.querySelector('#save-student-login'); const password = document.querySelector('#student-login-password').value;
  setButtonBusy(button, true, 'Creating…', 'Create login'); setFormMessage('student-login-form-message');
  try {
    const { data, error } = await state.client.functions.invoke('admin-create-student-login', { body: { studentId: document.querySelector('#student-login-id').value, email: document.querySelector('#student-login-email').value.trim(), temporaryPassword: password } });
    if (error || data?.error) throw error || new Error(data.error);
    closeDialog('student-login-modal');
    document.querySelector('#student-login-details').textContent = `Student: ${data.account.fullName}\nRegistration number: ${data.account.registrationNumber}\nEmail: ${data.account.email}\nTemporary password: ${password}`;
    openDialog('student-login-details-modal'); showToast('Student login created. Give the details to the student securely.');
    await loadStudents(document.querySelector('#student-search').value);
  } catch (error) { setFormMessage('student-login-form-message', await friendlyFunctionError(error, 'Could not create the student login.')); }
  finally { setButtonBusy(button, false, '', 'Create login'); }
}

function resetStudentForm() {
  editingStudentId = null;
  document.querySelector('#student-form').reset();
  setText('student-modal-title', 'Register a student');
  setText('save-student', 'Save student');
  setText('student-registration-preview', 'Issued automatically after the student login account is created.');
  setFormMessage('student-form-message');
}

export async function openStudentForm(student = null) {
  if (!requireAdministrator()) return;
  const available = await loadProgrammes();
  if (!available) return showToast('Create an active programme before registering a student.');
  resetStudentForm();
  if (student) {
    editingStudentId = student.id;
    setText('student-modal-title', 'Edit student record');
    setText('save-student', 'Save changes');
    const fields = {
      '#student-first-name': student.first_name, '#student-last-name': student.last_name,
      '#student-programme': student.programme_id,
      '#student-email': student.personal_email || '', '#student-phone': student.phone || '',
      '#student-nok-name': student.next_of_kin_name || '', '#student-nok-relationship': student.next_of_kin_relationship || '',
      '#student-nok-phone': student.next_of_kin_phone || '', '#student-status': student.status,
    };
    Object.entries(fields).forEach(([selector, value]) => { document.querySelector(selector).value = value; });
    setText('student-registration-preview', student.registration_number || 'Issued automatically when the student login is created.');
  }
  openDialog('student-modal');
}

async function submitStudent(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const save = document.querySelector('#save-student');
  setButtonBusy(save, true, editingStudentId ? 'Saving…' : 'Registering…', editingStudentId ? 'Save changes' : 'Save student');
  setFormMessage('student-form-message');
  const payload = {
    first_name: document.querySelector('#student-first-name').value.trim(),
    last_name: document.querySelector('#student-last-name').value.trim(),
    programme_id: document.querySelector('#student-programme').value,
    personal_email: document.querySelector('#student-email').value.trim() || null,
    phone: document.querySelector('#student-phone').value.trim() || null,
    next_of_kin_name: document.querySelector('#student-nok-name').value.trim() || null,
    next_of_kin_relationship: document.querySelector('#student-nok-relationship').value.trim() || null,
    next_of_kin_phone: document.querySelector('#student-nok-phone').value.trim() || null,
    status: document.querySelector('#student-status').value,
  };
  try {
    const request = editingStudentId
      ? state.client.from('students').update(payload).eq('id', editingStudentId)
      : state.client.from('students').insert(payload);
    const { error } = await request;
    if (error) throw error;
    closeDialog('student-modal');
    showToast(editingStudentId ? 'Student record updated.' : 'Student registered successfully.');
    await loadStudents(document.querySelector('#student-search').value);
  } catch (error) {
    setFormMessage('student-form-message', friendlyDbError(error, 'Could not save the student record.'));
  } finally {
    setButtonBusy(save, false, '', editingStudentId ? 'Save changes' : 'Save student');
  }
}

export function initStudents() {
  document.querySelector('#add-student').addEventListener('click', () => openStudentForm());
  document.querySelector('#new-action').addEventListener('click', () => openStudentForm());
  document.querySelector('#student-search').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => loadStudents(event.target.value), 250);
  });
  document.querySelector('#student-form').addEventListener('submit', submitStudent);
  document.querySelector('#student-table').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-student-action]');
    if (!button) return;
    if (button.dataset.studentAction === 'login') return openStudentLogin(button.dataset.studentId);
    if (button.dataset.studentAction !== 'edit') return;
    const { data, error } = await state.client.from('students')
      .select('id, first_name, last_name, registration_number, programme_id, personal_email, phone, next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, status')
      .eq('id', button.dataset.studentId).maybeSingle();
    if (error || !data) return showToast('Unable to open that student record.');
    openStudentForm(data);
  });
  document.querySelector('#student-login-form').addEventListener('submit', createStudentLogin);
}
