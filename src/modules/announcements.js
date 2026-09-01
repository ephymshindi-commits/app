import {
  closeDialog, friendlyDbError, isAdministrator, openDialog, setButtonBusy,
  setFormMessage, setText, showToast, state,
} from './core.js';

function relation(record) { return Array.isArray(record) ? record[0] : record; }
function label(value) { return value === 'all' ? 'Everyone' : `${value[0].toUpperCase()}${value.slice(1)}`; }

export async function loadAnnouncements() {
  setText('announcements-message', 'Loading announcements…');
  try {
    const { data, error } = await state.client.from('announcements')
      .select('id, title, message, audience, published_at, created_at, profiles(full_name)')
      .eq('published', true).order('published_at', { ascending: false }).limit(100);
    if (error) throw error;
    const list = document.querySelector('#announcements-list'); list.replaceChildren();
    (data || []).forEach((announcement) => {
      const card = document.createElement('article'); card.className = 'panel announcement-card';
      const head = document.createElement('header'); const title = document.createElement('h3'); title.textContent = announcement.title;
      const audience = document.createElement('span'); audience.className = 'status active'; audience.textContent = label(announcement.audience);
      head.append(title, audience);
      const message = document.createElement('p'); message.textContent = announcement.message;
      const meta = document.createElement('div'); meta.className = 'announcement-meta';
      meta.textContent = `Published ${new Date(announcement.published_at || announcement.created_at).toLocaleString()} · ${relation(announcement.profiles)?.full_name || 'College administration'}`;
      card.append(head, message, meta); list.append(card);
    });
    setText('announcements-message', data?.length ? '' : 'No announcements have been published yet.');
  } catch (error) { setText('announcements-message', friendlyDbError(error, 'Unable to load announcements.')); }
}

function openAnnouncementForm() {
  if (!isAdministrator()) return showToast('Only administrators can publish announcements.');
  document.querySelector('#announcement-form').reset(); setFormMessage('announcement-form-message'); openDialog('announcement-modal');
}

async function saveAnnouncement(event) {
  event.preventDefault();
  if (!isAdministrator()) return;
  const button = document.querySelector('#save-announcement');
  setButtonBusy(button, true, 'Publishing…', 'Publish announcement'); setFormMessage('announcement-form-message');
  try {
    const { error } = await state.client.from('announcements').insert({
      title: document.querySelector('#announcement-title').value.trim(), message: document.querySelector('#announcement-message').value.trim(),
      audience: document.querySelector('#announcement-audience').value, published: true, published_at: new Date().toISOString(), created_by: state.user.id,
    });
    if (error) throw error;
    closeDialog('announcement-modal'); showToast('Announcement published.'); await loadAnnouncements();
  } catch (error) { setFormMessage('announcement-form-message', friendlyDbError(error, 'Could not publish announcement.')); }
  finally { setButtonBusy(button, false, '', 'Publish announcement'); }
}

export function initAnnouncements() {
  document.querySelector('#add-announcement').addEventListener('click', openAnnouncementForm);
  document.querySelector('#announcement-form').addEventListener('submit', saveAnnouncement);
}
