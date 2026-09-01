import {
  appendTableRow, clearTable, closeDialog, friendlyDbError, isAdministrator, openDialog,
  setButtonBusy, setFormMessage, setText, showToast, state,
} from './core.js';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function option(label, value = '') { return new Option(label, value); }
function relation(record) { return Array.isArray(record) ? record[0] : record; }
function timeText(value) { return value ? String(value).slice(0, 5) : '—'; }

async function loadOptions() {
  const [unitsResult, semestersResult, trainersResult, programmesResult] = await Promise.all([
    state.client.from('units').select('id, code, name').order('code'),
    state.client.from('semesters').select('id, name, starts_on, academic_years(name)').order('starts_on', { ascending: false }),
    state.client.from('profiles').select('id, full_name').eq('role', 'trainer').order('full_name'),
    state.client.from('programmes').select('id, name, code').eq('active', true).order('name'),
  ]);
  [unitsResult, semestersResult, trainersResult, programmesResult].forEach((result) => { if (result.error) throw result.error; });
  const optionSets = [
    ['timetable-unit', unitsResult.data || [], (row) => `${row.code} — ${row.name}`, 'unit'],
    ['timetable-semester', semestersResult.data || [], (row) => `${relation(row.academic_years)?.name || 'Academic year'} — ${row.name}`, 'semester'],
    ['timetable-trainer', trainersResult.data || [], (row) => row.full_name, 'trainer'],
    ['timetable-programme', programmesResult.data || [], (row) => `${row.name} (${row.code})`, 'programme'],
  ];
  optionSets.forEach(([id, rows, label, singular]) => {
    const select = document.querySelector(`#${id}`);
    select.replaceChildren(option(`Select ${singular}`));
    rows.forEach((row) => select.append(option(label(row), row.id)));
  });
}

function actionButton(id) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'text-button'; button.dataset.timetableSlotId = id; button.textContent = 'Remove';
  return button;
}

export async function loadTimetable() {
  setText('timetable-message', 'Loading timetable…');
  try {
    const { data, error } = await state.client.from('timetable_slots')
      .select('id, day_of_week, starts_at, ends_at, room_name, delivery_mode, units(code, name), programmes(name, code), profiles(full_name)')
      .order('day_of_week').order('starts_at').limit(250);
    if (error) throw error;
    clearTable('timetable-table');
    (data || []).forEach((slot) => {
      const unit = relation(slot.units); const programme = relation(slot.programmes); const trainer = relation(slot.profiles);
      appendTableRow('timetable-table', [
        DAYS[slot.day_of_week] || '—', `${timeText(slot.starts_at)} – ${timeText(slot.ends_at)}`, unit ? `${unit.code} — ${unit.name}` : '—',
        programme ? `${programme.name} (${programme.code})` : '—', trainer?.full_name || '—', slot.room_name || 'Online', slot.delivery_mode.replace('_', ' '), isAdministrator() ? actionButton(slot.id) : '—',
      ]);
    });
    setText('timetable-message', data?.length ? 'Room and trainer clashes are blocked automatically.' : 'No timetable slots have been added.');
  } catch (error) { setText('timetable-message', friendlyDbError(error, 'Unable to load timetable.')); }
}

async function openTimetableForm() {
  if (!isAdministrator()) return showToast('Only administrators can create timetable slots.');
  try {
    await loadOptions();
    document.querySelector('#timetable-form').reset();
    document.querySelector('#timetable-day').value = '1';
    document.querySelector('#timetable-mode').value = 'in_person';
    setFormMessage('timetable-form-message');
    openDialog('timetable-modal');
  } catch (error) { showToast(friendlyDbError(error, 'Unable to prepare timetable form.')); }
}

async function submitTimetable(event) {
  event.preventDefault();
  if (!isAdministrator()) return;
  const button = document.querySelector('#save-timetable-slot');
  setButtonBusy(button, true, 'Saving…', 'Save timetable slot'); setFormMessage('timetable-form-message');
  try {
    const { error } = await state.client.from('timetable_slots').insert({
      unit_id: document.querySelector('#timetable-unit').value, semester_id: document.querySelector('#timetable-semester').value,
      trainer_id: document.querySelector('#timetable-trainer').value, programme_id: document.querySelector('#timetable-programme').value,
      day_of_week: Number(document.querySelector('#timetable-day').value), starts_at: document.querySelector('#timetable-start').value,
      ends_at: document.querySelector('#timetable-end').value, room_name: document.querySelector('#timetable-room').value.trim() || null,
      delivery_mode: document.querySelector('#timetable-mode').value,
    });
    if (error) throw error;
    closeDialog('timetable-modal'); showToast('Timetable slot saved.'); await loadTimetable();
  } catch (error) {
    const message = error?.code === '23P01'
      ? 'This trainer or room already has an overlapping session at that time.'
      : friendlyDbError(error, 'Could not save timetable slot.');
    setFormMessage('timetable-form-message', message);
  } finally { setButtonBusy(button, false, '', 'Save timetable slot'); }
}

async function removeTimetableSlot(id) {
  if (!isAdministrator()) return;
  try {
    const { error } = await state.client.from('timetable_slots').delete().eq('id', id);
    if (error) throw error;
    showToast('Timetable slot removed.'); await loadTimetable();
  } catch (error) { showToast(friendlyDbError(error, 'Could not remove timetable slot.')); }
}

export function initTimetable() {
  document.querySelector('#add-timetable-slot').addEventListener('click', openTimetableForm);
  document.querySelector('#timetable-form').addEventListener('submit', submitTimetable);
  document.querySelector('#timetable-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-timetable-slot-id]');
    if (button) removeTimetableSlot(button.dataset.timetableSlotId);
  });
}
