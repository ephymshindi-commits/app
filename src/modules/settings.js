import { friendlyDbError, isAdministrator, setButtonBusy, setFormMessage, setText, showToast, state } from './core.js';

let currentSettings = null;

function applyBrand(settings) {
  if (!settings) return;
  document.querySelectorAll('.institution').forEach((element) => {
    const label = element.querySelector('span');
    element.firstChild.textContent = settings.institution_name;
    if (label) label.textContent = settings.academic_year_label;
  });
  document.title = `${settings.institution_name} | Management System`;
}

export async function loadSettings() {
  setText('settings-form-message', 'Loading settings…');
  try {
    const { data, error } = await state.client.from('institution_settings').select('institution_name, academic_year_label, support_email, agora_app_id').eq('id', true).maybeSingle();
    if (error) throw error;
    currentSettings = data;
    document.querySelector('#settings-institution-name').value = data?.institution_name || 'LOVE & TRUTH BIBLE AND SKILLS TRAINING COLLEGE';
    document.querySelector('#settings-academic-year').value = data?.academic_year_label || 'Academic year 2026 / 2027';
    document.querySelector('#settings-support-email').value = data?.support_email || '';
    document.querySelector('#settings-agora-app-id').value = data?.agora_app_id || '';
    setText('settings-form-message', isAdministrator() ? '' : 'Only administrators can update these settings.');
    document.querySelector('#save-settings').hidden = !isAdministrator();
    applyBrand(data);
  } catch (error) { setText('settings-form-message', friendlyDbError(error, 'Unable to load institution settings.')); }
}

async function saveSettings(event) {
  event.preventDefault();
  if (!isAdministrator()) return;
  const button = document.querySelector('#save-settings');
  setButtonBusy(button, true, 'Saving…', 'Save settings'); setFormMessage('settings-form-message');
  const payload = {
    id: true, institution_name: document.querySelector('#settings-institution-name').value.trim(),
    academic_year_label: document.querySelector('#settings-academic-year').value.trim(), support_email: document.querySelector('#settings-support-email').value.trim() || null,
    agora_app_id: document.querySelector('#settings-agora-app-id').value.trim() || null, updated_by: state.user.id,
  };
  try {
    const { data, error } = await state.client.from('institution_settings').upsert(payload).select().single();
    if (error) throw error;
    currentSettings = data; applyBrand(data); showToast('Institution settings saved.');
  } catch (error) { setFormMessage('settings-form-message', friendlyDbError(error, 'Could not save institution settings.')); }
  finally { setButtonBusy(button, false, '', 'Save settings'); }
}

export function getSupportEmail() { return currentSettings?.support_email || ''; }
export function initSettings() { document.querySelector('#settings-form').addEventListener('submit', saveSettings); }
