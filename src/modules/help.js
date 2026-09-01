import { openDialog } from './core.js';
import { getSupportEmail } from './settings.js';

export function initHelp() {
  document.querySelector('#open-help').addEventListener('click', () => {
    const email = getSupportEmail();
    const link = document.querySelector('#help-contact-link');
    link.href = email ? `mailto:${email}?subject=Love%20%26%20Truth%20College%20system%20support` : 'mailto:';
    link.hidden = !email;
    openDialog('help-modal');
  });
}
