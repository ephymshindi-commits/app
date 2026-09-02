import { state } from './core.js';

const number = (value) => Number(value || 0);

function summarizeRows({ activeStudents, invoices, payments, attendanceRecords, results, attendanceRows }) {
  const chargeRows = (invoices || []).filter((invoice) => invoice.status !== 'void');
  const collected = (payments || []).reduce((sum, payment) => sum + number(payment.amount), 0);
  const paidByInvoice = new Map();
  (payments || []).forEach((payment) => {
    if (!payment.invoice_id) return;
    paidByInvoice.set(payment.invoice_id, number(paidByInvoice.get(payment.invoice_id)) + number(payment.amount));
  });
  const balancesByStudent = new Map();
  chargeRows.forEach((invoice) => {
    const balance = Math.max(0, number(invoice.amount) - number(paidByInvoice.get(invoice.id)));
    balancesByStudent.set(invoice.student_id, number(balancesByStudent.get(invoice.student_id)) + balance);
  });
  const chargeTotal = chargeRows.reduce((sum, invoice) => sum + number(invoice.amount), 0);
  const countedAttendance = (attendanceRecords || []).filter((record) => record.status !== 'excused');
  const attended = countedAttendance.filter((record) => ['present', 'late'].includes(record.status)).length;
  const attendancePercentage = countedAttendance.length ? Number(((attended / countedAttendance.length) * 100).toFixed(1)) : null;
  return {
    active_students: activeStudents,
    total_invoiced: chargeTotal,
    total_collected: collected,
    total_outstanding: [...balancesByStudent.values()].reduce((sum, balance) => sum + balance, 0),
    students_with_balance: [...balancesByStudent.values()].filter((balance) => balance > 0).length,
    attendance_percentage: attendancePercentage,
    pending_results: (results || []).filter((result) => ['submitted', 'approved'].includes(result.status)).length,
    low_attendance_students: (attendanceRows || []).filter((row) => number(row.attendance_percentage) < 75).length,
  };
}

async function loadFallbackSummary() {
  const [studentsResult, invoicesResult, paymentsResult, attendanceResult, resultsResult, attendanceRowsResult] = await Promise.all([
    state.client.from('students').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    state.client.from('invoices').select('id, student_id, amount, status').limit(1000),
    state.client.from('payments').select('invoice_id, amount').limit(1000),
    state.client.from('attendance_records').select('status').limit(1000),
    state.client.from('unit_results').select('status').limit(1000),
    state.client.from('student_attendance_summary').select('attendance_percentage').limit(1000),
  ]);
  return summarizeRows({
    activeStudents: studentsResult.count || 0,
    invoices: invoicesResult.error ? [] : invoicesResult.data,
    payments: paymentsResult.error ? [] : paymentsResult.data,
    attendanceRecords: attendanceResult.error ? [] : attendanceResult.data,
    results: resultsResult.error ? [] : resultsResult.data,
    attendanceRows: attendanceRowsResult.error ? [] : attendanceRowsResult.data,
  });
}

export async function loadOperationalSummary() {
  const { data, error } = await state.client.from('institution_operational_summary').select('*').maybeSingle();
  if (!error && data) return data;
  return loadFallbackSummary();
}
