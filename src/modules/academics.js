import {
  appendTableRow, clearTable, closeDialog, friendlyDbError, openDialog,
  formatKes, requireAdministrator, setButtonBusy, setFormMessage, setText, showToast, state,
} from './core.js';

function option(label, value = '') {
  return new Option(label, value);
}

async function fillSelect(selectId, table, columns, label) {
  const select = document.querySelector(`#${selectId}`);
  select.replaceChildren(option(`Loading ${label}…`));
  const { data, error } = await state.client.from(table).select(columns).order('name');
  if (error) throw error;
  select.replaceChildren(option(`Select ${label.slice(0, -1)}`));
  (data || []).forEach((row) => select.append(option(row.code ? `${row.name} (${row.code})` : row.name, row.id)));
}

async function loadProgrammeOptions() {
  await fillSelect('unit-programme', 'programmes', 'id, name, code', 'programmes');
}

async function loadDepartmentOptions() {
  await fillSelect('programme-department', 'departments', 'id, name, code', 'departments');
}

async function loadAcademicYearOptions() {
  const select = document.querySelector('#semester-academic-year');
  select.replaceChildren(option('Loading academic years…'));
  const { data, error } = await state.client.from('academic_years').select('id, name, starts_on').order('starts_on', { ascending: false });
  if (error) throw error;
  select.replaceChildren(option('Select academic year'));
  (data || []).forEach((year) => select.append(option(year.name, year.id)));
}

async function loadFeeStructureOptions() {
  const [programmes, years] = await Promise.all([
    state.client.from('programmes').select('id, name, code').order('name'),
    state.client.from('academic_years').select('id, name, starts_on').order('starts_on', { ascending: false }),
  ]);
  if (programmes.error) throw programmes.error;
  if (years.error) throw years.error;
  const programmeSelect = document.querySelector('#fee-programme');
  const yearSelect = document.querySelector('#fee-academic-year');
  programmeSelect.replaceChildren(option('Select programme'));
  yearSelect.replaceChildren(option('Select academic year'));
  (programmes.data || []).forEach((programme) => programmeSelect.append(option(`${programme.name} (${programme.code})`, programme.id)));
  (years.data || []).forEach((year) => yearSelect.append(option(year.name, year.id)));
}

function relation(record) {
  return Array.isArray(record) ? record[0] : record;
}

function dateText(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—';
}

function addUnitButton(programmeId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button';
  button.dataset.addUnitFor = programmeId;
  button.textContent = 'Add unit';
  return button;
}

export async function loadAcademics() {
  if (!requireAdministrator()) return;
  setText('programmes-message', 'Loading programmes…');
  setText('units-message', 'Loading units…');
  setText('calendar-message', 'Loading academic calendar…');
  try {
    const [programmesResult, unitsResult, yearsResult, semestersResult, feesResult] = await Promise.all([
      state.client.from('programmes').select('id, name, code, duration_years, active, departments(name)').order('name'),
      state.client.from('units').select('id, name, code, year_of_study, semester_number, credit_hours, programmes(name, code)').order('code'),
      state.client.from('academic_years').select('id, name, starts_on, ends_on, active').order('starts_on', { ascending: false }),
      state.client.from('semesters').select('id, name, starts_on, ends_on, academic_years(name)').order('starts_on', { ascending: false }),
      state.client.from('fee_structures').select('id, amount, year_of_study, programmes(name, code), academic_years(name)').order('amount', { ascending: false }),
    ]);
    [programmesResult, unitsResult, yearsResult, semestersResult, feesResult].forEach((result) => { if (result.error) throw result.error; });
    clearTable('programmes-table');
    (programmesResult.data || []).forEach((programme) => appendTableRow('programmes-table', [
      `${programme.name} (${programme.code})`, relation(programme.departments)?.name || '—', `${programme.duration_years} year${Number(programme.duration_years) === 1 ? '' : 's'}`, programme.active ? 'Active' : 'Inactive', addUnitButton(programme.id),
    ]));
    clearTable('units-table');
    (unitsResult.data || []).forEach((unit) => appendTableRow('units-table', [
      `${unit.code} — ${unit.name}`, relation(unit.programmes)?.name || '—', `Year ${unit.year_of_study}`, `Semester ${unit.semester_number}`, Number(unit.credit_hours || 0).toString(),
    ]));
    clearTable('calendar-table');
    const semestersByYear = new Map();
    (semestersResult.data || []).forEach((semester) => {
      const year = relation(semester.academic_years);
      const entries = semestersByYear.get(year?.name || 'Academic year') || [];
      entries.push(semester);
      semestersByYear.set(year?.name || 'Academic year', entries);
    });
    (yearsResult.data || []).forEach((year) => {
      const entries = semestersByYear.get(year.name) || [];
      if (!entries.length) appendTableRow('calendar-table', [year.active ? `${year.name} (Current)` : year.name, 'No semesters yet', `${dateText(year.starts_on)} – ${dateText(year.ends_on)}`]);
      entries.forEach((semester) => appendTableRow('calendar-table', [year.active ? `${year.name} (Current)` : year.name, semester.name, `${dateText(semester.starts_on)} – ${dateText(semester.ends_on)}`]));
    });
    clearTable('fee-structures-table');
    (feesResult.data || []).forEach((fee) => appendTableRow('fee-structures-table', [
      `${relation(fee.programmes)?.name || 'Programme'} (${relation(fee.programmes)?.code || '—'})`, relation(fee.academic_years)?.name || '—', `Year ${fee.year_of_study}`, formatKes(fee.amount),
    ]));
    setText('programmes-message', programmesResult.data?.length ? '' : 'No programmes yet. Add the first programme to begin.');
    setText('units-message', unitsResult.data?.length ? '' : 'No units yet.');
    setText('calendar-message', yearsResult.data?.length ? '' : 'No academic years yet.');
    setText('fee-structures-message', feesResult.data?.length ? 'Only administrators can change programme fees.' : 'No programme fees configured yet.');
  } catch (error) {
    const message = friendlyDbError(error, 'Unable to load academic setup.');
    setText('programmes-message', message);
    setText('units-message', message);
    setText('calendar-message', message);
  }
}

async function openFeeStructureDialog() {
  if (!requireAdministrator()) return;
  try {
    await loadFeeStructureOptions();
    document.querySelector('#fee-structure-form').reset();
    document.querySelector('#fee-year-of-study').value = '1';
    setFormMessage('fee-structure-form-message'); openDialog('fee-structure-modal');
  } catch (error) { showToast(friendlyDbError(error, 'Unable to prepare the fee structure form.')); }
}

async function submitFeeStructure(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-fee-structure');
  setButtonBusy(button, true, 'Saving…', 'Save fee structure'); setFormMessage('fee-structure-form-message');
  try {
    const { error } = await state.client.from('fee_structures').upsert({
      programme_id: document.querySelector('#fee-programme').value,
      academic_year_id: document.querySelector('#fee-academic-year').value,
      year_of_study: Number(document.querySelector('#fee-year-of-study').value),
      amount: Number(document.querySelector('#fee-amount').value),
    }, { onConflict: 'programme_id,academic_year_id,year_of_study' });
    if (error) throw error;
    closeDialog('fee-structure-modal'); showToast('Programme fee structure saved.'); await loadAcademics();
  } catch (error) { setFormMessage('fee-structure-form-message', friendlyDbError(error, 'Could not save this fee structure.')); }
  finally { setButtonBusy(button, false, '', 'Save fee structure'); }
}

async function openSetupDialog(dialogId, loader, formId, messageId) {
  if (!requireAdministrator()) return;
  try {
    if (loader) await loader();
    document.querySelector(`#${formId}`).reset();
    setFormMessage(messageId);
    openDialog(dialogId);
  } catch (error) {
    showToast(friendlyDbError(error, 'Unable to prepare this form.'));
  }
}

async function submitProgramme(event) {
  event.preventDefault();
  const button = document.querySelector('#save-programme');
  setButtonBusy(button, true, 'Saving…', 'Save programme');
  try {
    const { error } = await state.client.from('programmes').insert({
      name: document.querySelector('#programme-name').value.trim(), code: document.querySelector('#programme-code').value.trim().toUpperCase(),
      department_id: document.querySelector('#programme-department').value, duration_years: Number(document.querySelector('#programme-duration').value), active: true,
    });
    if (error) throw error;
    closeDialog('programme-modal'); showToast('Programme saved.'); await loadAcademics();
  } catch (error) { setFormMessage('programme-form-message', friendlyDbError(error, 'Could not save programme.')); }
  finally { setButtonBusy(button, false, '', 'Save programme'); }
}

async function submitDepartment(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-department');
  setButtonBusy(button, true, 'Saving…', 'Save department');
  setFormMessage('department-form-message');
  try {
    const { error } = await state.client.from('departments').insert({
      name: document.querySelector('#department-name').value.trim(),
      code: document.querySelector('#department-code').value.trim().toUpperCase(),
    });
    if (error) throw error;
    closeDialog('department-modal');
    showToast('Department saved. It is now available when creating a programme.');
    await loadAcademics();
  } catch (error) { setFormMessage('department-form-message', friendlyDbError(error, 'Could not save department.')); }
  finally { setButtonBusy(button, false, '', 'Save department'); }
}

async function submitUnit(event) {
  event.preventDefault();
  const button = document.querySelector('#save-unit');
  setButtonBusy(button, true, 'Saving…', 'Save unit');
  try {
    const { error } = await state.client.from('units').insert({
      name: document.querySelector('#unit-name').value.trim(), code: document.querySelector('#unit-code').value.trim(), programme_id: document.querySelector('#unit-programme').value,
      year_of_study: Number(document.querySelector('#unit-year').value), semester_number: Number(document.querySelector('#unit-semester-number').value), credit_hours: Number(document.querySelector('#unit-credit-hours').value),
    });
    if (error) throw error;
    closeDialog('unit-modal'); showToast('Unit saved.'); await loadAcademics();
  } catch (error) { setFormMessage('unit-form-message', friendlyDbError(error, 'Could not save unit.')); }
  finally { setButtonBusy(button, false, '', 'Save unit'); }
}

async function openUnitForProgramme(programmeId) {
  if (!requireAdministrator()) return;
  try {
    await loadProgrammeOptions();
    document.querySelector('#unit-form').reset();
    document.querySelector('#unit-programme').value = programmeId;
    setFormMessage('unit-form-message');
    openDialog('unit-modal');
  } catch (error) { showToast(friendlyDbError(error, 'Unable to prepare the unit form.')); }
}

async function submitAcademicYear(event) {
  event.preventDefault();
  const button = document.querySelector('#save-academic-year');
  setButtonBusy(button, true, 'Saving…', 'Save academic year');
  try {
    const active = document.querySelector('#academic-year-active').value === 'true';
    if (active) {
      const { error } = await state.client.from('academic_years').update({ active: false }).eq('active', true);
      if (error) throw error;
    }
    const { error } = await state.client.from('academic_years').insert({
      name: document.querySelector('#academic-year-name').value.trim(), starts_on: document.querySelector('#academic-year-start').value,
      ends_on: document.querySelector('#academic-year-end').value, active,
    });
    if (error) throw error;
    closeDialog('academic-year-modal'); showToast('Academic year saved.'); await loadAcademics();
  } catch (error) { setFormMessage('academic-year-form-message', friendlyDbError(error, 'Could not save academic year.')); }
  finally { setButtonBusy(button, false, '', 'Save academic year'); }
}

async function submitSemester(event) {
  event.preventDefault();
  const button = document.querySelector('#save-semester');
  setButtonBusy(button, true, 'Saving…', 'Save semester');
  try {
    const { error } = await state.client.from('semesters').insert({
      academic_year_id: document.querySelector('#semester-academic-year').value, name: document.querySelector('#semester-name').value.trim(),
      starts_on: document.querySelector('#semester-start').value, ends_on: document.querySelector('#semester-end').value,
    });
    if (error) throw error;
    closeDialog('semester-modal'); showToast('Semester saved.'); await loadAcademics();
  } catch (error) { setFormMessage('semester-form-message', friendlyDbError(error, 'Could not save semester.')); }
  finally { setButtonBusy(button, false, '', 'Save semester'); }
}

export function initAcademics() {
  document.querySelector('#add-department').addEventListener('click', () => openSetupDialog('department-modal', null, 'department-form', 'department-form-message'));
  document.querySelector('#add-programme').addEventListener('click', () => openSetupDialog('programme-modal', loadDepartmentOptions, 'programme-form', 'programme-form-message'));
  document.querySelector('#add-unit').addEventListener('click', () => openSetupDialog('unit-modal', loadProgrammeOptions, 'unit-form', 'unit-form-message'));
  document.querySelector('#add-unit-secondary').addEventListener('click', () => openSetupDialog('unit-modal', loadProgrammeOptions, 'unit-form', 'unit-form-message'));
  document.querySelector('#add-academic-year').addEventListener('click', () => openSetupDialog('academic-year-modal', null, 'academic-year-form', 'academic-year-form-message'));
  document.querySelector('#add-semester').addEventListener('click', () => openSetupDialog('semester-modal', loadAcademicYearOptions, 'semester-form', 'semester-form-message'));
  document.querySelector('#set-programme-fee').addEventListener('click', openFeeStructureDialog);
  document.querySelector('#programme-form').addEventListener('submit', submitProgramme);
  document.querySelector('#department-form').addEventListener('submit', submitDepartment);
  document.querySelector('#unit-form').addEventListener('submit', submitUnit);
  document.querySelector('#academic-year-form').addEventListener('submit', submitAcademicYear);
  document.querySelector('#semester-form').addEventListener('submit', submitSemester);
  document.querySelector('#fee-structure-form').addEventListener('submit', submitFeeStructure);
  document.querySelector('#programmes-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-unit-for]');
    if (button) openUnitForProgramme(button.dataset.addUnitFor);
  });
}
