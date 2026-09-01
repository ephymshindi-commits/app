import {
  appendTableRow, clearTable, closeDialog, friendlyDbError, isAdministrator, openDialog,
  setButtonBusy, setFormMessage, setText, showToast, state,
} from './core.js';
import { createStudentProfileLink } from './student-profile.js';

let editingResultId = null;

function option(label, value = '') { return new Option(label, value); }
function relation(record) { return Array.isArray(record) ? record[0] : record; }
function staffCanManageResults() { return ['administrator', 'trainer'].includes(state.role); }

async function loadFormOptions() {
  const [studentsResult, unitsResult, semestersResult] = await Promise.all([
    state.client.from('students').select('id, registration_number, first_name, last_name').eq('status', 'active').order('registration_number'),
    state.client.from('units').select('id, code, name').order('code'),
    state.client.from('semesters').select('id, name, starts_on, academic_years(name)').order('starts_on', { ascending: false }),
  ]);
  [studentsResult, unitsResult, semestersResult].forEach((result) => { if (result.error) throw result.error; });
  const fields = [
    ['result-student', studentsResult.data || [], (row) => `${row.registration_number} — ${row.first_name} ${row.last_name}`],
    ['result-unit', unitsResult.data || [], (row) => `${row.code} — ${row.name}`],
    ['result-semester', semestersResult.data || [], (row) => `${relation(row.academic_years)?.name || 'Academic year'} — ${row.name}`],
  ];
  fields.forEach(([id, rows, label]) => {
    const select = document.querySelector(`#${id}`);
    select.replaceChildren(option(`Select ${id.replace('result-', '')}`));
    rows.forEach((row) => select.append(option(label(row), row.id)));
  });
}

function actionButton(label, id) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'text-button'; button.dataset.resultId = id; button.textContent = label;
  return button;
}

export async function loadResults() {
  if (!staffCanManageResults()) return;
  setText('results-message', 'Loading results…');
  try {
    const { data, error } = await state.client.from('unit_results')
      .select('id, cat_score, exam_score, total_score, grade, status, student_id, students(first_name, last_name, registration_number), units(code, name), semesters(name, academic_years(name))')
      .order('updated_at', { ascending: false }).limit(200);
    if (error) throw error;
    clearTable('results-table');
    (data || []).forEach((result) => {
      const student = relation(result.students); const unit = relation(result.units); const semester = relation(result.semesters);
      appendTableRow('results-table', [
        student ? createStudentProfileLink(`${student.first_name} ${student.last_name}`, result.student_id, 'overview', 'results') : 'Student unavailable',
        unit ? `${unit.code} — ${unit.name}` : '—', `${relation(semester?.academic_years)?.name || ''} ${semester?.name || ''}`.trim() || '—',
        result.cat_score ?? '—', result.exam_score ?? '—', result.total_score ?? '—', result.grade || '—', result.status, actionButton('Manage', result.id),
      ]);
    });
    setText('results-message', data?.length ? 'Select Manage to update a result workflow.' : 'No results entered yet.');
  } catch (error) { setText('results-message', friendlyDbError(error, 'Unable to load results.')); }
}

function configureResultWorkflow(status = 'draft') {
  const select = document.querySelector('#result-status');
  select.replaceChildren(option('Draft', 'draft'));
  if (isAdministrator()) {
    select.append(option('Submitted for review', 'submitted'), option('Approved', 'approved'), option('Released', 'released'));
  }
  select.value = status;
}

async function openResultForm(result = null) {
  if (!staffCanManageResults()) return showToast('Only staff can manage results.');
  try {
    await loadFormOptions();
    editingResultId = result?.id || null;
    document.querySelector('#result-form').reset();
    setText('result-modal-title', result ? 'Manage result' : 'Enter result');
    setFormMessage('result-form-message');
    configureResultWorkflow(result?.status || 'draft');
    if (result) {
      document.querySelector('#result-student').value = result.student_id;
      document.querySelector('#result-unit').value = result.unit_id;
      document.querySelector('#result-semester').value = result.semester_id;
      document.querySelector('#result-cat').value = result.cat_score ?? '';
      document.querySelector('#result-exam').value = result.exam_score ?? '';
      document.querySelector('#result-grade').value = result.grade || '';
    }
    openDialog('result-modal');
  } catch (error) { showToast(friendlyDbError(error, 'Unable to prepare result entry.')); }
}

async function fetchResult(id) {
  const { data, error } = await state.client.from('unit_results').select('id, student_id, unit_id, semester_id, cat_score, exam_score, grade, status').eq('id', id).maybeSingle();
  if (error || !data) throw error || new Error('Result not found');
  return data;
}

async function submitResult(event) {
  event.preventDefault();
  if (!staffCanManageResults()) return;
  const button = document.querySelector('#save-result');
  setButtonBusy(button, true, 'Saving…', 'Save result'); setFormMessage('result-form-message');
  const status = document.querySelector('#result-status').value;
  const payload = {
    student_id: document.querySelector('#result-student').value, unit_id: document.querySelector('#result-unit').value,
    semester_id: document.querySelector('#result-semester').value, cat_score: document.querySelector('#result-cat').value || null,
    exam_score: document.querySelector('#result-exam').value || null, grade: document.querySelector('#result-grade').value.trim() || null, status,
  };
  if (isAdministrator()) {
    const approved = ['approved', 'released'].includes(status);
    payload.approved_by = approved ? state.user.id : null;
    payload.approved_at = approved ? new Date().toISOString() : null;
    payload.released_at = status === 'released' ? new Date().toISOString() : null;
  }
  try {
    const request = editingResultId
      ? state.client.from('unit_results').update(payload).eq('id', editingResultId)
      : state.client.from('unit_results').insert({ ...payload, entered_by: state.user.id });
    const { error } = await request;
    if (error) throw error;
    closeDialog('result-modal'); showToast('Result saved.'); await loadResults();
  } catch (error) { setFormMessage('result-form-message', friendlyDbError(error, 'Could not save result.')); }
  finally { setButtonBusy(button, false, '', 'Save result'); }
}

export function initResults() {
  document.querySelector('#add-result').addEventListener('click', () => openResultForm());
  document.querySelector('#result-form').addEventListener('submit', submitResult);
  document.querySelector('#results-table').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-result-id]');
    if (!button) return;
    try { await openResultForm(await fetchResult(button.dataset.resultId)); }
    catch (error) { showToast(friendlyDbError(error, 'Unable to open result.')); }
  });
}
