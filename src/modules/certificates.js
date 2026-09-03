import {
  appendTableRow, clearTable, closeDialog, formatKes, friendlyDbError, openDialog,
  requireAdministrator, setButtonBusy, setFormMessage, setText, showToast, state,
} from './core.js';
import { certificatePreviewMarkup, downloadCertificatePdf } from './certificate-pdf.js';

let previewCertificate = null;

function related(value) {
  return Array.isArray(value) ? value[0] : value;
}

function action(label, actionName, id, primary = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'primary-button' : 'outline-button';
  button.dataset.certificateAction = actionName;
  button.dataset.certificateId = id;
  button.textContent = label;
  return button;
}

function actionGroup(buttons) {
  const group = document.createElement('div');
  group.className = 'button-row';
  buttons.forEach((button) => group.append(button));
  return group;
}

function dateText(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

async function loadAdminCertificates() {
  const [studentsResult, certificatesResult, signatoriesResult] = await Promise.all([
    state.client.from('students').select('id, first_name, last_name, registration_number, programme_id, status, programmes(name, code)').in('status', ['active', 'graduated']).order('first_name'),
    state.client.from('certificates').select('id, student_id, certificate_hash, status, issued_at, students(first_name, last_name, registration_number), programmes(name, code)').order('issued_at', { ascending: false }),
    state.client.from('certificate_signatories').select('id, staff_name, role_title, signature_image_url, is_active').order('role_title'),
  ]);
  [studentsResult, certificatesResult, signatoriesResult].forEach((result) => { if (result.error) throw result.error; });
  const eligibilityRows = await Promise.all((studentsResult.data || []).map(async (student) => {
    const { data, error } = await state.client.rpc('certificate_eligibility', { target_student_id: student.id }).single();
    if (error) throw error;
    return { student, eligibility: data };
  }));

  clearTable('certificate-eligibility-table');
  eligibilityRows.forEach(({ student, eligibility }) => {
    const programme = related(student.programmes);
    const buttons = [];
    if (!eligibility.graduation_approved) buttons.push(action('Approve graduation', 'approve-graduation', student.id, true));
    if (eligibility.eligible) buttons.push(action('Issue certificate', 'issue', student.id, true));
    appendTableRow('certificate-eligibility-table', [
      `${student.first_name} ${student.last_name} · ${student.registration_number || '—'}`,
      programme ? `${programme.name} (${programme.code})` : '—',
      `${eligibility.passed_units}/${eligibility.total_units} passed`,
      Number(eligibility.fee_balance) === 0 ? 'Cleared' : formatKes(eligibility.fee_balance),
      eligibility.graduation_approved ? 'Approved' : 'Awaiting approval',
      eligibility.eligible ? 'Ready to issue' : eligibility.reason,
      actionGroup(buttons),
    ]);
  });
  setText('certificates-message', eligibilityRows.length ? 'Eligibility updates directly from released results, active programme fees and finance approvals.' : 'No active or graduated students are available.');

  clearTable('certificates-table');
  (certificatesResult.data || []).forEach((certificate) => {
    const student = related(certificate.students); const programme = related(certificate.programmes);
    const statusAction = certificate.status === 'REVOKED' ? action('Activate', 'activate', certificate.id, true) : action('Revoke', 'revoke', certificate.id);
    const preview = action('Preview', 'preview', certificate.id);
    const download = action('Download', 'download', certificate.id, true);
    appendTableRow('certificates-table', [
      `${student?.first_name || 'Student'} ${student?.last_name || ''}`.trim(),
      programme ? `${programme.name} (${programme.code})` : '—',
      certificate.certificate_hash.slice(0, 14), dateText(certificate.issued_at), certificate.status,
      actionGroup([preview, download, statusAction]),
    ]);
  });
  clearTable('certificate-signatories-table');
  (signatoriesResult.data || []).forEach((signatory) => appendTableRow('certificate-signatories-table', [
    signatory.staff_name, signatory.role_title, signatory.signature_image_url || 'No image', signatory.is_active ? 'Active' : 'Inactive',
  ]));
}

async function loadStudentCertificates() {
  const [eligibilityResult, certificatesResult] = await Promise.all([
    state.client.rpc('my_certificate_eligibility').maybeSingle(),
    state.client.rpc('my_certificates'),
  ]);
  if (eligibilityResult.error) throw eligibilityResult.error;
  if (certificatesResult.error) throw certificatesResult.error;
  const eligibility = eligibilityResult.data;
  const list = document.querySelector('#student-certificates-list');
  list.replaceChildren();
  setText('student-certificate-message', eligibility?.eligible ? 'You meet the academic and finance requirements. Your administrator can now issue your certificate.' : eligibility?.reason || 'Your certificate eligibility is being assessed.');
  (certificatesResult.data || []).forEach((certificate) => {
    const card = document.createElement('article');
    card.className = 'panel';
    const heading = document.createElement('div'); heading.className = 'panel-head';
    const copy = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = `${certificate.programme_name} e-Certificate`;
    const description = document.createElement('p'); description.textContent = `Issued ${dateText(certificate.issued_at)} · Verified certificate`;
    copy.append(title, description); heading.append(copy);
    heading.append(action('Download e-Certificate', 'download', certificate.certificate_id, true));
    card.append(heading);
    list.append(card);
  });
}

export async function loadCertificates() {
  setText('certificates-message', 'Loading certificate records…');
  try {
    if (state.role === 'student') await loadStudentCertificates();
    else if (state.role === 'administrator') await loadAdminCertificates();
  } catch (error) {
    const message = friendlyDbError(error, 'Unable to load certificate records.');
    setText(state.role === 'student' ? 'student-certificate-message' : 'certificates-message', message);
  }
}

async function downloadCertificate(certificateId) {
  try {
    const { data, error } = await state.client.rpc('certificate_detail_for_view', { target_certificate_id: certificateId });
    if (error || !data) throw error || new Error('Certificate details are unavailable.');
    await downloadCertificatePdf(data);
  } catch (error) { showToast(error?.message || friendlyDbError(error, 'Unable to prepare this certificate download.')); }
}

async function openCertificatePreview(certificateId) {
  try {
    const { data, error } = await state.client.rpc('certificate_detail_for_view', { target_certificate_id: certificateId });
    if (error || !data) throw error || new Error('Certificate details are unavailable.');
    previewCertificate = data;
    document.querySelector('#certificate-preview-content').innerHTML = certificatePreviewMarkup(data);
    openDialog('certificate-preview-modal');
  } catch (error) { showToast(friendlyDbError(error, 'Unable to prepare this certificate preview.')); }
}

async function handleCertificateAction(button) {
  const actionName = button.dataset.certificateAction;
  const id = button.dataset.certificateId;
  try {
    if (actionName === 'download') return downloadCertificate(id);
    if (actionName === 'preview') return openCertificatePreview(id);
    if (!requireAdministrator()) return;
    if (actionName === 'approve-graduation') {
      const { error } = await state.client.rpc('set_graduation_approval', { target_student_id: id, approved_value: true, approval_note: null });
      if (error) throw error;
      showToast('Graduation approval recorded.');
    }
    if (actionName === 'issue') {
      const { data, error } = await state.client.rpc('issue_eligible_certificate', { target_student_id: id }).single();
      if (error) throw error;
      showToast(`Certificate issued. Verification hash: ${data.certificate_hash.slice(0, 12)}…`);
    }
    if (actionName === 'revoke' || actionName === 'activate') {
      const { error } = await state.client.rpc('set_certificate_status', { target_certificate_id: id, target_status: actionName === 'revoke' ? 'REVOKED' : 'ACTIVE' });
      if (error) throw error;
      showToast(actionName === 'revoke' ? 'Certificate verification link revoked.' : 'Certificate verification link activated.');
    }
    await loadCertificates();
  } catch (error) { showToast(friendlyDbError(error, 'Could not complete the certificate action.')); }
}

async function openSignatoryForm() {
  if (!requireAdministrator()) return;
  document.querySelector('#signatory-form').reset();
  setFormMessage('signatory-form-message');
  openDialog('signatory-modal');
}

async function saveSignatory(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-signatory');
  setButtonBusy(button, true, 'Saving…', 'Save signatory'); setFormMessage('signatory-form-message');
  try {
    const { error } = await state.client.from('certificate_signatories').insert({
      staff_name: document.querySelector('#signatory-name').value.trim(),
      role_title: document.querySelector('#signatory-role').value.trim(),
      signature_image_url: document.querySelector('#signatory-image').value.trim() || null,
      is_active: true,
    });
    if (error) throw error;
    closeDialog('signatory-modal'); showToast('Certificate signatory saved.'); await loadCertificates();
  } catch (error) { setFormMessage('signatory-form-message', friendlyDbError(error, 'Could not save this signatory.')); }
  finally { setButtonBusy(button, false, '', 'Save signatory'); }
}

export function initCertificates() {
  document.querySelector('#add-signatory').addEventListener('click', openSignatoryForm);
  document.querySelector('#signatory-form').addEventListener('submit', saveSignatory);
  document.querySelector('#download-preview-certificate').addEventListener('click', async () => {
    if (!previewCertificate) return;
    try { await downloadCertificatePdf(previewCertificate); }
    catch (error) { showToast(error?.message || 'Unable to prepare this certificate download.'); }
  });
  document.querySelector('#certificates').addEventListener('click', (event) => {
    const button = event.target.closest('[data-certificate-action]');
    if (button) handleCertificateAction(button);
  });
}
