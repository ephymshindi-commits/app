import {
  closeDialog, configureClient, isAdministrator, isStudent, isTrainer, loadProfile, renderPageTitle,
  showAuthMessage, showToast, state,
} from './modules/core.js';
import { loadDashboard } from './modules/dashboard.js';
import { initStudents, loadStudents } from './modules/students.js';
import { initStaff, loadWorkers } from './modules/staff.js';
import { initFinance, loadFinance } from './modules/finance.js';
import { initInventory, loadInventory } from './modules/inventory.js';
import { initCourses, loadCourses } from './modules/courses.js';
import { initStudentProfile, openStudentProfile } from './modules/student-profile.js';
import { initAcademics, loadAcademics } from './modules/academics.js';
import { initResults, loadResults } from './modules/results.js';
import { initTimetable, loadTimetable } from './modules/timetable.js';
import { initAttendance, loadAttendance } from './modules/attendance.js';
import { initLibrary, loadLibrary } from './modules/library.js';
import { initAnnouncements, loadAnnouncements } from './modules/announcements.js';
import { initInsights, loadAnalytics, loadReports } from './modules/insights.js';
import { initAssessments, loadAssessments } from './modules/assessments.js';
import { initSettings, loadSettings } from './modules/settings.js';
import { initHelp } from './modules/help.js';
import { initLiveClasses, loadLiveClasses } from './modules/live-classes.js';

const appShell = document.querySelector('#app-shell');
const authScreen = document.querySelector('#auth-screen');
const loginForm = document.querySelector('#login-form');
const loginEmail = document.querySelector('#login-email');
const loginPassword = document.querySelector('#login-password');

const viewLoaders = {
  dashboard: loadDashboard,
  students: loadStudents,
  workers: loadWorkers,
  academics: loadAcademics,
  finance: loadFinance,
  inventory: loadInventory,
  attendance: loadAttendance,
  results: loadResults,
  learning: loadCourses,
  assessments: async () => { await Promise.all([loadAssessments(), loadLiveClasses()]); },
  timetable: loadTimetable,
  analytics: loadAnalytics,
  library: loadLibrary,
  announcements: loadAnnouncements,
  reports: loadReports,
  settings: loadSettings,
};

const unavailableViews = new Set();

function showComingSoon() {
  document.querySelector('#coming-soon-title').textContent = 'Coming soon';
  document.querySelector('#coming-soon-copy').hidden = true;
  document.querySelector('#coming-soon-modal').showModal();
}

function setAdministratorControls() {
  document.querySelectorAll('[data-admin-only]').forEach((element) => {
    element.hidden = !isAdministrator();
  });
  document.querySelectorAll('[data-staff-only]').forEach((element) => {
    element.hidden = !['administrator', 'trainer'].includes(state.role);
  });
  document.querySelectorAll('[data-student-only]').forEach((element) => {
    element.hidden = !isStudent();
  });
  document.querySelectorAll('[data-role-view]').forEach((element) => {
    element.hidden = !element.dataset.roleView.split(',').includes(state.role);
  });
}

function canAccessView(target) {
  if (isAdministrator()) return true;
  const trainerViews = new Set(['attendance', 'results', 'learning', 'assessments', 'timetable', 'library', 'announcements']);
  const studentViews = new Set(['student-profile', 'results', 'assessments', 'timetable', 'library', 'announcements']);
  return isTrainer() ? trainerViews.has(target) : studentViews.has(target);
}

async function showView(target) {
  if (!canAccessView(target)) return;
  if (unavailableViews.has(target)) {
    showComingSoon();
    return;
  }
  const view = document.querySelector(`#${target}`);
  if (!view) return;
  document.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item === view));
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === target));
  renderPageTitle(target);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.querySelector('.sidebar').classList.remove('open');
  if (target === 'student-profile' && isStudent()) {
    await openStudentProfile(null, 'overview', 'student-profile');
    return;
  }
  if (viewLoaders[target]) await viewLoaders[target]();
}

async function renderSession(session) {
  if (!session?.user) {
    appShell.hidden = true;
    authScreen.hidden = false;
    loginPassword.value = '';
    return;
  }
  authScreen.hidden = true;
  appShell.hidden = false;
  await loadProfile(session.user);
  await loadSettings();
  setAdministratorControls();
  if (isAdministrator()) await loadDashboard();
  else if (isStudent()) await showView('student-profile');
  else await showView('learning');
}

async function handleSignIn(event) {
  event.preventDefault();
  if (!state.client) return showAuthMessage('Supabase configuration is not available.');
  const button = loginForm.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Signing in…';
  showAuthMessage();
  try {
    const { error } = await state.client.auth.signInWithPassword({
      email: loginEmail.value.trim(), password: loginPassword.value,
    });
    if (error) showAuthMessage(error.message);
  } catch (error) {
    showAuthMessage('Could not reach the sign-in service. Check your connection and try again.');
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
}

async function handlePasswordReset() {
  if (!state.client) return showAuthMessage('Supabase configuration is not available.');
  const email = loginEmail.value.trim();
  if (!email) return showAuthMessage('Enter your email address first.');
  const options = location.protocol.startsWith('http') ? { redirectTo: `${location.origin}${location.pathname}` } : {};
  try {
    const { error } = await state.client.auth.resetPasswordForEmail(email, options);
    if (error) throw error;
    showAuthMessage('If this address has an account, a reset link is on its way.', 'success');
  } catch (error) {
    showAuthMessage('Could not send a reset link. Check the email address and try again.');
  }
}

function initSharedInteractions() {
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });
  document.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view-target]');
    if (viewButton) showView(viewButton.dataset.viewTarget);
    if (event.target.closest('[data-coming-soon]')) showComingSoon();
  });
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.closeDialog)));
  document.querySelector('.mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
  document.querySelector('#forgot-password').addEventListener('click', handlePasswordReset);
  document.querySelector('#sign-out').addEventListener('click', async () => {
    try {
      const { error } = await state.client.auth.signOut();
      if (error) throw error;
      showAuthMessage('You have signed out.', 'success');
    } catch (error) {
      showToast('Could not sign out. Check your connection and try again.');
    }
  });
  document.addEventListener('student-profile:open', async (event) => {
    const { studentId, tab, source } = event.detail;
    await showView('student-profile');
    await openStudentProfile(studentId, tab, source);
  });
  document.addEventListener('student-profile:back', ({ detail }) => showView(detail.source || 'students'));
}

async function initializeAuth() {
  configureClient();
  if (!state.client) return showAuthMessage('Supabase configuration is not available. Check src/app-config.js.');
  try {
    const { data: { session } } = await state.client.auth.getSession();
    await renderSession(session);
    state.client.auth.onAuthStateChange((_event, nextSession) => window.setTimeout(() => renderSession(nextSession), 0));
  } catch (error) {
    showAuthMessage('Could not restore your session. Reload the page and try again.');
  }
}

loginForm.addEventListener('submit', handleSignIn);
initStudents();
initStaff();
initFinance();
initInventory();
initCourses();
initStudentProfile();
initAcademics();
initResults();
initTimetable();
initAttendance();
initLibrary();
initAnnouncements();
initInsights();
initAssessments();
initSettings();
initHelp();
initLiveClasses();
initSharedInteractions();
initializeAuth();
