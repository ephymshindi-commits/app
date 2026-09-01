import {
  state, appendTableRow, clearTable, closeDialog, friendlyDbError, openDialog,
  requireAdministrator, setButtonBusy, setFormMessage, setText, showToast,
} from './core.js';

function option(label, value = '') {
  return new Option(label, value);
}

export async function loadWorkers() {
  if (!requireAdministrator()) return;
  setText('workers-message', 'Loading workers…');
  try {
    const { data, error } = await state.client
      .from('staff_members')
      .select('id, employee_number, job_title, phone, employment_status, profiles(full_name, email, role), departments(name)')
      .order('employee_number');
    if (error) throw error;
    clearTable('workers-table');
    setText('workers-message', data?.length ? `${data.length} worker record${data.length === 1 ? '' : 's'}.` : 'No workers have been provisioned yet.');
    (data || []).forEach((worker) => {
      const profile = Array.isArray(worker.profiles) ? worker.profiles[0] : worker.profiles;
      const department = Array.isArray(worker.departments) ? worker.departments[0] : worker.departments;
      appendTableRow('workers-table', [
        profile?.full_name || 'Account pending', worker.employee_number, worker.job_title,
        department?.name || '—', profile?.role?.replace('_', ' ') || '—', worker.employment_status,
      ]);
    });
  } catch (error) {
    setText('workers-message', friendlyDbError(error, 'Unable to load staff records. Apply Phase 6 and try again.'));
  }
}

async function loadDepartments() {
  const select = document.querySelector('#worker-department');
  select.replaceChildren(option('No department'));
  const { data, error } = await state.client.from('departments').select('id, name, code').order('name');
  if (error) throw error;
  (data || []).forEach((department) => select.append(option(`${department.name} (${department.code})`, department.id)));
}

async function openWorkerForm() {
  if (!requireAdministrator()) return;
  try {
    await loadDepartments();
    document.querySelector('#worker-form').reset();
    document.querySelector('#worker-status').value = 'active';
    document.querySelector('#worker-role').value = 'trainer';
    setFormMessage('worker-form-message');
    openDialog('worker-modal');
  } catch (error) {
    showToast(friendlyDbError(error, 'Unable to prepare the worker form.'));
  }
}

function workerPayload() {
  return {
    fullName: document.querySelector('#worker-name').value.trim(),
    email: document.querySelector('#worker-email').value.trim(),
    employeeNumber: document.querySelector('#worker-number').value.trim(),
    jobTitle: document.querySelector('#worker-title').value.trim(),
    departmentId: document.querySelector('#worker-department').value || null,
    phone: document.querySelector('#worker-phone').value.trim() || null,
    role: document.querySelector('#worker-role').value,
    employmentStatus: document.querySelector('#worker-status').value,
  };
}

async function submitWorker(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-worker');
  setButtonBusy(button, true, 'Sending invite…', 'Invite worker');
  setFormMessage('worker-form-message');
  try {
    const { data, error } = await state.client.functions.invoke('admin-create-worker', { body: workerPayload() });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    closeDialog('worker-modal');
    showToast('Worker account created and invitation sent.');
    await loadWorkers();
  } catch (error) {
    console.error(error);
    setFormMessage('worker-form-message', error?.message || 'Could not provision this worker. Confirm the Edge Function is deployed.');
  } finally {
    setButtonBusy(button, false, '', 'Invite worker');
  }
}

export function initStaff() {
  document.querySelector('#add-worker').addEventListener('click', openWorkerForm);
  document.querySelector('#worker-form').addEventListener('submit', submitWorker);
}
