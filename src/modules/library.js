import {
  closeDialog, friendlyDbError, isAdministrator, openDialog, setButtonBusy,
  setFormMessage, setText, showToast, state,
} from './core.js';

let resources = [];
let activeType = 'all';

function renderResources() {
  const grid = document.querySelector('#library-grid');
  const term = document.querySelector('#library-search').value.trim().toLowerCase();
  const filtered = resources.filter((resource) => {
    const matchesType = activeType === 'all' || resource.resource_type === activeType;
    const haystack = [resource.title, resource.author, resource.subject, resource.resource_type].join(' ').toLowerCase();
    return matchesType && (!term || haystack.includes(term));
  });
  grid.replaceChildren();
  filtered.forEach((resource) => {
    const card = document.createElement('article'); card.className = 'panel library-card';
    const type = document.createElement('span'); type.textContent = resource.resource_type;
    const title = document.createElement('h3'); title.textContent = resource.title;
    const copy = document.createElement('p'); copy.textContent = [resource.subject, resource.author].filter(Boolean).join(' · ') || 'Institution resource';
    const link = document.createElement('a'); link.href = resource.external_url || '#'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open resource →';
    card.append(type, title, copy, link); grid.append(card);
  });
  setText('library-message', filtered.length ? `${filtered.length} resource${filtered.length === 1 ? '' : 's'} available.` : 'No resources match this search.');
}

export async function loadLibrary() {
  setText('library-message', 'Loading resources…');
  try {
    const { data, error } = await state.client.from('library_resources').select('id, title, author, resource_type, subject, external_url, access_level').order('created_at', { ascending: false });
    if (error) throw error;
    resources = data || []; renderResources();
  } catch (error) { setText('library-message', friendlyDbError(error, 'Unable to load library resources.')); }
}

function openLibraryForm() {
  if (!isAdministrator()) return showToast('Only administrators can add library resources.');
  document.querySelector('#library-form').reset(); setFormMessage('library-form-message'); openDialog('library-modal');
}

async function saveLibraryResource(event) {
  event.preventDefault();
  if (!isAdministrator()) return;
  const button = document.querySelector('#save-library-resource');
  setButtonBusy(button, true, 'Saving…', 'Save resource'); setFormMessage('library-form-message');
  try {
    const { error } = await state.client.from('library_resources').insert({
      title: document.querySelector('#library-title').value.trim(), author: document.querySelector('#library-author').value.trim() || null,
      resource_type: document.querySelector('#library-type').value, subject: document.querySelector('#library-subject').value.trim() || null,
      external_url: document.querySelector('#library-url').value.trim(), access_level: document.querySelector('#library-access').value, created_by: state.user.id,
    });
    if (error) throw error;
    closeDialog('library-modal'); showToast('Library resource saved.'); await loadLibrary();
  } catch (error) { setFormMessage('library-form-message', friendlyDbError(error, 'Could not save library resource.')); }
  finally { setButtonBusy(button, false, '', 'Save resource'); }
}

export function initLibrary() {
  document.querySelector('#add-library-resource').addEventListener('click', openLibraryForm);
  document.querySelector('#library-form').addEventListener('submit', saveLibraryResource);
  document.querySelector('#library-search').addEventListener('input', renderResources);
  document.querySelectorAll('[data-library-type]').forEach((button) => button.addEventListener('click', () => {
    activeType = button.dataset.libraryType;
    document.querySelectorAll('[data-library-type]').forEach((chip) => chip.classList.toggle('active', chip === button));
    renderResources();
  }));
}
