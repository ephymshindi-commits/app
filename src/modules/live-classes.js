import { closeDialog, friendlyDbError, openDialog, setButtonBusy, setFormMessage, setText, showToast, state } from './core.js';

let rtcClient = null;
let localTracks = [];
let activeSession = null;

const relation = (value) => Array.isArray(value) ? value[0] : value;
const canSchedule = () => ['administrator', 'trainer'].includes(state.role);
const channelFor = () => `ltbsc-${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;

function formatTime(value) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function classActions(session) {
  const wrap = document.createElement('div'); wrap.className = 'button-row';
  const join = document.createElement('button'); join.type = 'button'; join.className = 'outline-button'; join.dataset.liveJoin = session.id; join.textContent = 'Join class';
  wrap.append(join); return wrap;
}

async function loadCourseOptions() {
  const { data, error } = await state.client.from('learning_courses').select('id, title, units(code)').order('title');
  if (error) throw error;
  const select = document.querySelector('#live-course');
  select.replaceChildren(new Option('Select course', ''));
  (data || []).forEach((course) => select.append(new Option(`${course.title} · ${relation(course.units)?.code || 'Unit'}`, course.id)));
  return data?.length;
}

export async function loadLiveClasses() {
  setText('live-classes-message', 'Loading live classes…');
  try {
    const { data, error } = await state.client.from('virtual_sessions')
      .select('id, title, starts_at, ends_at, meeting_url, learning_courses(title, units(code))')
      .order('starts_at', { ascending: true }).limit(30);
    if (error) throw error;
    const table = document.querySelector('#live-classes-table'); table.replaceChildren();
    (data || []).forEach((session) => {
      const course = relation(session.learning_courses);
      const row = document.createElement('tr');
      [session.title, course ? `${course.title} · ${relation(course.units)?.code || ''}` : '—', `${formatTime(session.starts_at)} – ${new Date(session.ends_at).toLocaleTimeString([], { timeStyle: 'short' })}`]
        .forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
      const action = document.createElement('td'); action.append(classActions(session)); row.append(action); table.append(row);
    });
    setText('live-classes-message', data?.length ? 'Choose a scheduled class to join.' : 'No live classes have been scheduled yet.');
  } catch (error) { setText('live-classes-message', friendlyDbError(error, 'Unable to load live classes.')); }
}

async function openScheduleForm() {
  if (!canSchedule()) return showToast('Only staff can schedule live classes.');
  try {
    if (!await loadCourseOptions()) return showToast('Create a course space before scheduling a live class.');
    document.querySelector('#live-class-form').reset();
    const start = new Date(Date.now() + 5 * 60 * 1000); const end = new Date(start.getTime() + 60 * 60 * 1000);
    document.querySelector('#live-starts-at').value = localInput(start); document.querySelector('#live-ends-at').value = localInput(end);
    setFormMessage('live-class-form-message'); openDialog('live-class-modal');
  } catch (error) { showToast(friendlyDbError(error, 'Unable to prepare the live-class form.')); }
}

function localInput(value) { const offset = value.getTimezoneOffset() * 60000; return new Date(value - offset).toISOString().slice(0, 16); }

async function saveLiveClass(event) {
  event.preventDefault();
  if (!canSchedule()) return;
  const button = document.querySelector('#save-live-class');
  setButtonBusy(button, true, 'Scheduling…', 'Schedule class'); setFormMessage('live-class-form-message');
  try {
    const startsAt = new Date(document.querySelector('#live-starts-at').value);
    const endsAt = new Date(document.querySelector('#live-ends-at').value);
    if (endsAt <= startsAt) throw new Error('The class end time must be after the start time.');
    const { error } = await state.client.from('virtual_sessions').insert({
      course_id: document.querySelector('#live-course').value, title: document.querySelector('#live-title').value.trim(),
      starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), meeting_url: `agora://${channelFor()}`, created_by: state.user.id,
    });
    if (error) throw error;
    closeDialog('live-class-modal'); showToast('Live class scheduled.'); await loadLiveClasses();
  } catch (error) { setFormMessage('live-class-form-message', error?.message || friendlyDbError(error, 'Could not schedule the live class.')); }
  finally { setButtonBusy(button, false, '', 'Schedule class'); }
}

async function getAgoraRtc() {
  if (window.AgoraRTC) return window.AgoraRTC;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.24.0/AgoraRTC_N-production.js';
    script.onload = resolve; script.onerror = () => reject(new Error('Unable to load the video classroom service.'));
    document.head.append(script);
  });
  return window.AgoraRTC;
}

function addRemotePlayer(user) {
  const player = document.createElement('div'); player.id = `remote-${user.uid}`; player.className = 'remote-player';
  document.querySelector('#live-remote-streams').append(player); user.videoTrack?.play(player);
}

async function joinClass(sessionId) {
  const joinButton = document.querySelector(`[data-live-join="${sessionId}"]`);
  setButtonBusy(joinButton, true, 'Joining…', 'Join class');
  try {
    const { data, error } = await state.client.functions.invoke('agora-token', { body: { sessionId } });
    if (error || data?.error) throw error || new Error(data.error);
    activeSession = data; const AgoraRTC = await getAgoraRtc();
    rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    rtcClient.on('user-published', async (user, mediaType) => { await rtcClient.subscribe(user, mediaType); if (mediaType === 'video') addRemotePlayer(user); if (mediaType === 'audio') user.audioTrack.play(); });
    rtcClient.on('user-unpublished', (user) => document.querySelector(`#remote-${user.uid}`)?.remove());
    await rtcClient.join(data.appId, data.channelName, data.token, data.uid);
    if (data.canPublish) {
      localTracks = await AgoraRTC.createMicrophoneAndCameraTracks();
      localTracks[1].play('live-local-player'); await rtcClient.publish(localTracks);
    } else {
      document.querySelector('#live-local-player').textContent = 'You joined as a participant.';
    }
    document.querySelector('#live-class-title').textContent = 'Live class connected';
    document.querySelector('#live-leave-class').hidden = false;
    openDialog('live-room-modal');
  } catch (error) { showToast(error?.message || 'Could not join the live class.'); await leaveClass(); }
  finally { setButtonBusy(joinButton, false, '', 'Join class'); }
}

async function leaveClass() {
  localTracks.forEach((track) => { track.stop(); track.close(); }); localTracks = [];
  if (rtcClient) { await rtcClient.leave(); rtcClient = null; }
  document.querySelector('#live-remote-streams').replaceChildren(); document.querySelector('#live-local-player').replaceChildren(); activeSession = null;
  closeDialog('live-room-modal');
}

export function initLiveClasses() {
  document.querySelector('#schedule-live-class').addEventListener('click', openScheduleForm);
  document.querySelector('#live-class-form').addEventListener('submit', saveLiveClass);
  document.querySelector('#live-classes-table').addEventListener('click', (event) => { const button = event.target.closest('[data-live-join]'); if (button) joinClass(button.dataset.liveJoin); });
  document.querySelector('#live-leave-class').addEventListener('click', leaveClass);
  document.querySelector('#live-room-modal').addEventListener('close', () => { if (rtcClient) leaveClass(); });
}
