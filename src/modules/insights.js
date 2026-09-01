import { appendTableRow, clearTable, formatKes, friendlyDbError, isAdministrator, setText, state } from './core.js';
import { createStudentProfileLink } from './student-profile.js';

function relation(record) { return Array.isArray(record) ? record[0] : record; }

async function attendanceData() {
  const [summaryResult, studentsResult, semestersResult] = await Promise.all([
    state.client.from('student_attendance_summary').select('student_id, semester_id, sessions_recorded, sessions_present, attendance_percentage'),
    state.client.from('students').select('id, first_name, last_name, registration_number').eq('status', 'active'),
    state.client.from('semesters').select('id, name, academic_years(name)'),
  ]);
  [summaryResult, studentsResult, semestersResult].forEach((result) => { if (result.error) throw result.error; });
  const students = new Map((studentsResult.data || []).map((student) => [student.id, student]));
  const semesters = new Map((semestersResult.data || []).map((semester) => [semester.id, semester]));
  return { rows: summaryResult.data || [], students, semesters, activeStudents: studentsResult.data || [] };
}

export async function loadAnalytics() {
  if (!isAdministrator()) return;
  setText('analytics-message', 'Loading learning analytics…');
  try {
    const { rows, students, semesters, activeStudents } = await attendanceData();
    const lowest = new Map();
    rows.forEach((row) => {
      const current = lowest.get(row.student_id);
      if (!current || Number(row.attendance_percentage) < Number(current.attendance_percentage)) lowest.set(row.student_id, row);
    });
    const followUp = [...lowest.values()].filter((row) => Number(row.attendance_percentage) < 75);
    setText('analytics-active-students', activeStudents.length);
    setText('analytics-follow-up', followUp.length);
    setText('analytics-on-track', Math.max(0, activeStudents.length - followUp.length));
    clearTable('analytics-table');
    followUp.sort((a, b) => Number(a.attendance_percentage) - Number(b.attendance_percentage)).forEach((row) => {
      const student = students.get(row.student_id); const semester = semesters.get(row.semester_id);
      appendTableRow('analytics-table', [
        student ? createStudentProfileLink(`${student.first_name} ${student.last_name}`, student.id, 'overview', 'analytics') : 'Student unavailable',
        student?.registration_number || '—', `${relation(semester?.academic_years)?.name || ''} ${semester?.name || ''}`.trim() || '—',
        row.sessions_recorded, `${row.attendance_percentage}%`, 'Contact student and agree a support plan',
      ]);
    });
    setText('analytics-message', followUp.length ? `${followUp.length} student${followUp.length === 1 ? '' : 's'} need attendance follow-up.` : 'No attendance support cases are currently flagged.');
  } catch (error) { setText('analytics-message', friendlyDbError(error, 'Unable to load learning analytics.')); }
}

export async function loadReports() {
  if (!isAdministrator()) return;
  try {
    const [summaryResult, studentsResult, resultsResult] = await Promise.all([
      state.client.from('institution_operational_summary').select('*').single(),
      state.client.from('students').select('id, programme_id, status, programmes(name, code)').eq('status', 'active'),
      state.client.from('unit_results').select('id', { count: 'exact', head: true }).eq('status', 'released'),
    ]);
    [summaryResult, studentsResult, resultsResult].forEach((result) => { if (result.error) throw result.error; });
    const summary = summaryResult.data || {};
    setText('report-active-students', summary.active_students || 0);
    setText('report-fees-collected', formatKes(summary.total_collected));
    setText('report-fees-note', `${formatKes(summary.total_outstanding)} outstanding`);
    setText('report-released-results', resultsResult.count || 0);
    const grouped = new Map();
    (studentsResult.data || []).forEach((student) => {
      const programme = relation(student.programmes); const label = programme ? `${programme.name} (${programme.code})` : 'Programme not assigned';
      grouped.set(label, (grouped.get(label) || 0) + 1);
    });
    clearTable('report-enrolment-table');
    [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([programme, count]) => appendTableRow('report-enrolment-table', [programme, count]));
    clearTable('report-finance-table');
    appendTableRow('report-finance-table', ['Total invoiced', formatKes(summary.total_invoiced)]);
    appendTableRow('report-finance-table', ['Payments collected', formatKes(summary.total_collected)]);
    appendTableRow('report-finance-table', ['Outstanding balance', formatKes(summary.total_outstanding)]);
  } catch (error) {
    console.error(error);
    setText('report-active-students', '—'); setText('report-fees-collected', '—'); setText('report-released-results', '—');
  }
}

export function initInsights() {
  document.querySelector('#print-reports').addEventListener('click', () => window.print());
}
