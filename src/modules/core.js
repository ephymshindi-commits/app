export const state = {
  client: null,
  user: null,
  role: '',
  firstName: 'Account user',
  fullName: 'Account user',
};

export function configureClient() {
  const config = window.TVET_CONFIG || {};
  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) return null;
  state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return state.client;
}

export function isAdministrator() {
  return state.role === 'administrator';
}

export function isTrainer() {
  return state.role === 'trainer';
}

export function isStudent() {
  return state.role === 'student';
}

export function requireAdministrator(message = 'Only administrators can perform this action.') {
  if (isAdministrator()) return true;
  showToast(message);
  return false;
}

export function friendlyDbError(error, fallback = 'Something went wrong. Please try again.') {
  switch (error?.code) {
    case '23505': return 'That value is already in use.';
    case '23503': return 'That linked record no longer exists. Refresh and try again.';
    case '42501': return 'You do not have permission to do that.';
    case '23514': return 'That record does not meet the school workflow rules.';
    default: return fallback;
  }
}

export async function friendlyFunctionError(error, fallback = 'The secure school service could not complete that request.') {
  try {
    const response = error?.context;
    const body = response?.clone ? await response.clone().json() : null;
    if (typeof body?.error === 'string' && body.error.trim()) return body.error;
  } catch {}
  const message = error?.message?.trim();
  return message && !/non-2xx status code/i.test(message) ? message : fallback;
}

export function initials(name = '') {
  return name.split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '--';
}

export function formatKes(value) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency', currency: 'KES', maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function registrationLabel(value) {
  return value || 'Awaiting account creation';
}

export function setText(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element) element.textContent = value;
}

export function clearTable(id) {
  document.querySelector(`#${id}`)?.replaceChildren();
}

export function appendTableRow(id, values) {
  const row = document.createElement('tr');
  values.forEach((value) => {
    const cell = document.createElement('td');
    if (value instanceof Node) cell.append(value);
    else cell.textContent = value ?? '—';
    row.append(cell);
  });
  document.querySelector(`#${id}`)?.append(row);
}

let toastTimer;
export function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3800);
}

export function showAuthMessage(message = '', type = '') {
  const element = document.querySelector('#auth-message');
  if (!element) return;
  element.textContent = message;
  element.className = `auth-message ${type}`.trim();
}

export function openDialog(id) {
  document.querySelector(`#${id}`)?.showModal();
}

export function closeDialog(id) {
  document.querySelector(`#${id}`)?.close();
}

export function setFormMessage(id, message = '') {
  setText(id, message);
}

export function setButtonBusy(button, busy, busyText, idleText) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

export function renderPageTitle(target) {
  const pageNames = {
    dashboard: `Welcome back, ${state.firstName}`,
    students: 'Student management', workers: 'Staff & roles', academics: 'Academic management',
    finance: 'Finance management', attendance: 'Attendance', results: 'Results management', assessments: 'Online assessments', timetable: 'Timetable',
    inventory: 'Inventory management',
    analytics: 'Learning analytics', library: 'Digital library', announcements: 'Announcements', reports: 'Reports', settings: 'Settings',
    learning: 'Digital learning space', 'student-profile': 'My profile',
  };
  const title = document.querySelector('#page-title');
  if (!title) return;
  title.replaceChildren(document.createTextNode(pageNames[target] || target));
  if (target === 'dashboard') {
    const greeting = document.createElement('span');
    greeting.textContent = '👋';
    title.append(' ', greeting);
  }
}

export async function loadProfile(user) {
  state.user = user;
  const fallbackName = user.email?.split('@')[0] || 'Account user';
  let profile = { full_name: fallbackName, role: 'student' };
  try {
    const { data, error } = await state.client.from('profiles').select('full_name, role').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (data) profile = data;
  } catch (error) {
    showToast('Your profile could not be loaded. Restricted access is active.');
  }
  state.role = profile.role;
  state.fullName = profile.full_name || fallbackName;
  state.firstName = profile.full_name.split(' ')[0] || fallbackName;
  setText('user-name', profile.full_name);
  setText('user-role', profile.role.replace('_', ' '));
  setText('user-avatar', initials(profile.full_name));
  renderPageTitle('dashboard');
}
