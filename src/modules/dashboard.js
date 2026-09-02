import { state, formatKes, isAdministrator, setText } from './core.js';
import { loadOperationalSummary } from './operational-summary.js';

function attentionRow(icon, title, detail, target) {
  const row = document.createElement('div');
  row.className = 'attention-item';
  const iconElement = document.createElement('span');
  iconElement.textContent = icon;
  const copy = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = title;
  const description = document.createElement('p');
  description.textContent = detail;
  copy.append(heading, description);
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.viewTarget = target;
  button.textContent = 'Review';
  row.append(iconElement, copy, button);
  return row;
}

export async function loadDashboard() {
  if (!isAdministrator()) return;
  try {
    const summary = await loadOperationalSummary();
    const activeStudents = Number(summary.active_students || 0);
    const collected = Number(summary.total_collected || 0);
    const invoiced = Number(summary.total_invoiced || 0);
    const attendance = summary.attendance_percentage === null ? null : Number(summary.attendance_percentage || 0);
    const pendingResults = Number(summary.pending_results || 0);
    setText('student-count', activeStudents);
    setText('metric-active-students', activeStudents);
    setText('metric-active-students-note', 'Active student records');
    setText('metric-fees-collected', formatKes(collected));
    setText('metric-fees-note', `of ${formatKes(invoiced)} invoiced`);
    setText('metric-attendance', attendance === null ? '—' : `${attendance}%`);
    setText('metric-attendance-note', attendance === null ? 'No attendance records yet' : 'Across recorded sessions');
    setText('metric-results-pending', pendingResults);
    setText('metric-results-pending-note', 'Submitted or approved marks');

    const attention = document.querySelector('#attention-list');
    attention.replaceChildren();
    const items = [];
    if (Number(summary.students_with_balance || 0)) items.push(['◫', 'Outstanding balances', `${summary.students_with_balance} students have ${formatKes(summary.total_outstanding)} outstanding`, 'finance']);
    if (pendingResults) items.push(['⌁', 'Results awaiting review', `${pendingResults} marks are pending approval or release`, 'results']);
    if (Number(summary.low_attendance_students || 0)) items.push(['◷', 'Attendance follow-up', `${summary.low_attendance_students} students are below 75% attendance`, 'attendance']);
    setText('attention-count', items.length);
    if (!items.length) attention.textContent = 'No current operational items need attention.';
    items.forEach((item) => attention.append(attentionRow(...item)));
  } catch (error) {
    setText('metric-active-students-note', 'Live data is temporarily unavailable.');
  }
}
