import {
  appendTableRow, clearTable, closeDialog, friendlyDbError, isAdministrator, isTrainer, openDialog,
  setButtonBusy, setFormMessage, setText, showToast, state,
} from './core.js';

let rosterStudents = [];

function option(label, value = '') { return new Option(label, value); }
function relation(record) { return Array.isArray(record) ? record[0] : record; }

async function loadAttendanceOptions() {
  let unitIds = null; let semesterIds = null;
  if (isTrainer()) {
    const { data: courses, error } = await state.client.from('learning_courses').select('unit_id, semester_id').eq('trainer_id', state.user.id);
    if (error) throw error;
    unitIds = [...new Set((courses || []).map((course) => course.unit_id))];
    semesterIds = [...new Set((courses || []).map((course) => course.semester_id))];
  }
  let unitsQuery = state.client.from('units').select('id, code, name').order('code');
  let semestersQuery = state.client.from('semesters').select('id, name, starts_on, academic_years(name)').order('starts_on', { ascending: false });
  if (unitIds) unitsQuery = unitIds.length ? unitsQuery.in('id', unitIds) : unitsQuery.in('id', ['00000000-0000-0000-0000-000000000000']);
  if (semesterIds) semestersQuery = semesterIds.length ? semestersQuery.in('id', semesterIds) : semestersQuery.in('id', ['00000000-0000-0000-0000-000000000000']);
  const [unitsResult, semestersResult] = await Promise.all([unitsQuery, semestersQuery]);
  [unitsResult, semestersResult].forEach((result) => { if (result.error) throw result.error; });
  const unit = document.querySelector('#attendance-unit');
  unit.replaceChildren(option('Select unit'));
  (unitsResult.data || []).forEach((row) => unit.append(option(`${row.code} — ${row.name}`, row.id)));
  const semester = document.querySelector('#attendance-semester');
  semester.replaceChildren(option('Select semester'));
  (semestersResult.data || []).forEach((row) => semester.append(option(`${relation(row.academic_years)?.name || 'Academic year'} — ${row.name}`, row.id)));
}

function formatDate(value) { return value ? new Date(value).toLocaleString() : '—'; }

export async function loadAttendance() {
  if (!isAdministrator() && !isTrainer()) return;
  setText('attendance-message', 'Loading class registers…');
  try {
    const { data: sessions, error } = await state.client.from('attendance_sessions')
      .select('id, held_at, units(code, name), semesters(name, academic_years(name))').order('held_at', { ascending: false }).limit(100);
    if (error) throw error;
    const ids = (sessions || []).map((session) => session.id);
    const recordsResult = ids.length
      ? await state.client.from('attendance_records').select('session_id, status').in('session_id', ids)
      : { data: [], error: null };
    if (recordsResult.error) throw recordsResult.error;
    const records = new Map();
    (recordsResult.data || []).forEach((record) => {
      const summary = records.get(record.session_id) || { marked: 0, present: 0, absent: 0 };
      summary.marked += 1;
      if (['present', 'late', 'excused'].includes(record.status)) summary.present += 1;
      if (['absent', 'late'].includes(record.status)) summary.absent += 1;
      records.set(record.session_id, summary);
    });
    clearTable('attendance-table');
    (sessions || []).forEach((session) => {
      const unit = relation(session.units); const semester = relation(session.semesters); const summary = records.get(session.id) || { marked: 0, present: 0, absent: 0 };
      appendTableRow('attendance-table', [formatDate(session.held_at), unit ? `${unit.code} — ${unit.name}` : '—', `${relation(semester?.academic_years)?.name || ''} ${semester?.name || ''}`.trim() || '—', summary.marked, summary.present, summary.absent]);
    });
    setText('attendance-message', sessions?.length ? 'Latest 100 class registers.' : 'No class registers have been recorded yet.');
  } catch (error) { setText('attendance-message', friendlyDbError(error, 'Unable to load attendance records.')); }
}

function renderRoster() {
  const roster = document.querySelector('#attendance-roster');
  roster.replaceChildren();
  if (!rosterStudents.length) {
    roster.textContent = 'No active students were found for this unit’s programme.';
    return;
  }
  rosterStudents.forEach((student) => {
    const row = document.createElement('div'); row.className = 'attendance-roster-row';
    const copy = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = `${student.first_name} ${student.last_name}`;
    const number = document.createElement('small'); number.textContent = student.registration_number;
    copy.append(name, number);
    const status = document.createElement('select'); status.dataset.attendanceStudentId = student.id;
    ['present', 'absent', 'late', 'excused'].forEach((value) => status.append(option(value[0].toUpperCase() + value.slice(1), value)));
    row.append(copy, status); roster.append(row);
  });
}

async function loadRoster() {
  const unitId = document.querySelector('#attendance-unit').value;
  const semesterId = document.querySelector('#attendance-semester').value;
  if (!unitId || !semesterId) return setFormMessage('attendance-form-message', 'Select the unit and semester first.');
  setFormMessage('attendance-form-message');
  try {
    const { data: unit, error: unitError } = await state.client.from('units').select('programme_id').eq('id', unitId).maybeSingle();
    if (unitError || !unit) throw unitError || new Error('Unit not found');
    const { data, error } = await state.client.from('students').select('id, first_name, last_name, registration_number').eq('programme_id', unit.programme_id).eq('status', 'active').order('registration_number');
    if (error) throw error;
    rosterStudents = data || []; renderRoster();
  } catch (error) { setFormMessage('attendance-form-message', friendlyDbError(error, 'Unable to load the class register.')); }
}

async function openAttendanceForm() {
  if (!isAdministrator() && !isTrainer()) return showToast('Only academic staff can take attendance.');
  try {
    await loadAttendanceOptions(); rosterStudents = [];
    document.querySelector('#attendance-form').reset();
    document.querySelector('#attendance-held-at').value = new Date().toISOString().slice(0, 16);
    document.querySelector('#attendance-roster').textContent = 'Choose the unit and semester, then load the class register.';
    setFormMessage('attendance-form-message'); openDialog('attendance-modal');
  } catch (error) { showToast(friendlyDbError(error, 'Unable to prepare the class register.')); }
}

async function saveAttendance(event) {
  event.preventDefault();
  if (!isAdministrator() && !isTrainer()) return;
  if (!rosterStudents.length) return setFormMessage('attendance-form-message', 'Load a class register before saving.');
  const button = document.querySelector('#save-attendance');
  setButtonBusy(button, true, 'Saving…', 'Save register'); setFormMessage('attendance-form-message');
  try {
    const { data: session, error: sessionError } = await state.client.from('attendance_sessions').insert({
      unit_id: document.querySelector('#attendance-unit').value, semester_id: document.querySelector('#attendance-semester').value,
      held_at: new Date(document.querySelector('#attendance-held-at').value).toISOString(), recorded_by: state.user.id,
    }).select('id').single();
    if (sessionError) throw sessionError;
    const records = [...document.querySelectorAll('[data-attendance-student-id]')].map((select) => ({ session_id: session.id, student_id: select.dataset.attendanceStudentId, status: select.value }));
    const { error } = await state.client.from('attendance_records').insert(records);
    if (error) throw error;
    closeDialog('attendance-modal'); showToast('Attendance register saved.'); await loadAttendance();
  } catch (error) { setFormMessage('attendance-form-message', friendlyDbError(error, 'Could not save attendance register.')); }
  finally { setButtonBusy(button, false, '', 'Save register'); }
}

export function initAttendance() {
  document.querySelector('#take-attendance').addEventListener('click', openAttendanceForm);
  document.querySelector('#load-attendance-roster').addEventListener('click', loadRoster);
  document.querySelector('#attendance-form').addEventListener('submit', saveAttendance);
}
