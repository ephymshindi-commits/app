import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const client = createClient('https://xagmipuvbvzyqpzxkqbl.supabase.co', 'sb_publishable_RV1CRDnRY-q8xeiQWCJV4w_N49rg918', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: {
      getItem(key) {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = document.cookie.match(new RegExp(`(?:^|; )${escapedKey}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : null;
      },
      setItem(key, value) { document.cookie = `${key}=${encodeURIComponent(value)}; Path=/; Domain=.ltbstc.com; Max-Age=2592000; SameSite=Lax; Secure`; },
      removeItem(key) { document.cookie = `${key}=; Path=/; Domain=.ltbstc.com; Max-Age=0; SameSite=Lax; Secure`; },
    },
  },
});

const dialog = document.querySelector('#student-login-modal');
const form = document.querySelector('#student-login-form');
const message = document.querySelector('#student-login-message');
const submit = document.querySelector('#student-login-submit');
const setMessage = (text = '') => { message.textContent = text; };
const setBusy = (busy) => { submit.disabled = busy; submit.textContent = busy ? 'Signing in…' : 'Sign in →'; };

document.querySelectorAll('[data-student-login]').forEach((button) => button.addEventListener('click', () => {
  setMessage();
  dialog.showModal();
  document.querySelector('#registration-number').focus();
}));
document.querySelector('[data-close-login]').addEventListener('click', () => dialog.close());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setBusy(true);
  setMessage();
  try {
    const { data, error } = await client.functions.invoke('student-registration-login', {
      body: { registrationNumber: document.querySelector('#registration-number').value.trim(), password: document.querySelector('#student-password').value },
    });
    if (error || data?.error || !data?.session) throw error || new Error(data?.error || 'Invalid registration number or password.');
    const { error: sessionError } = await client.auth.setSession(data.session);
    if (sessionError) throw sessionError;
    setMessage('Opening your student dashboard…');
    window.location.assign('https://ltbstc.com/');
  } catch (error) {
    setMessage(error?.message && !/non-2xx status code/i.test(error.message) ? error.message : 'Invalid registration number or password.');
  } finally {
    setBusy(false);
  }
});

document.querySelector('#year').textContent = new Date().getFullYear();
