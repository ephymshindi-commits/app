import { closeDialog, friendlyDbError, initials, openDialog, setButtonBusy, setFormMessage, setText, showToast, state } from './core.js';

let rtcClient = null;
let localVideoTrack = null;
let localAudioTrack = null;
let presenceChannel = null;
let activeSession = null;
const participants = new Map();

const relation = (value) => Array.isArray(value) ? value[0] : value;
const canSchedule = () => ['administrator', 'trainer'].includes(state.role);
const channelFor = () => `ltbsc-${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;

function formatTime(value) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function classActions(session) {
  const wrap = document.createElement('div');
  wrap.className = 'button-row';
  const join = document.createElement('button');
  join.type = 'button';
  join.className = 'outline-button';
  join.dataset.liveJoin = session.id;
  join.textContent = 'Join class';
  wrap.append(join);
  return wrap;
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
    const table = document.querySelector('#live-classes-table');
    table.replaceChildren();
    (data || []).forEach((session) => {
      const course = relation(session.learning_courses);
      const row = document.createElement('tr');
      [
        session.title,
        course ? `${course.title} · ${relation(course.units)?.code || ''}` : '—',
        `${formatTime(session.starts_at)} – ${new Date(session.ends_at).toLocaleTimeString([], { timeStyle: 'short' })}`,
      ].forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      const action = document.createElement('td');
      action.append(classActions(session));
      row.append(action);
      table.append(row);
    });
    setText('live-classes-message', data?.length ? 'Choose a scheduled class to join.' : 'No live classes have been scheduled yet.');
  } catch (error) {
    setText('live-classes-message', friendlyDbError(error, 'Unable to load live classes.'));
  }
}

async function openScheduleForm() {
  if (!canSchedule()) return showToast('Only staff can schedule live classes.');
  try {
    if (!await loadCourseOptions()) return showToast('Create a course space before scheduling a live class.');
    document.querySelector('#live-class-form').reset();
    const start = new Date(Date.now() + 5 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    document.querySelector('#live-starts-at').value = localInput(start);
    document.querySelector('#live-ends-at').value = localInput(end);
    setFormMessage('live-class-form-message');
    openDialog('live-class-modal');
  } catch (error) {
    showToast(friendlyDbError(error, 'Unable to prepare the live-class form.'));
  }
}

function localInput(value) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value - offset).toISOString().slice(0, 16);
}

async function saveLiveClass(event) {
  event.preventDefault();
  if (!canSchedule()) return;
  const button = document.querySelector('#save-live-class');
  setButtonBusy(button, true, 'Scheduling…', 'Schedule class');
  setFormMessage('live-class-form-message');
  try {
    const startsAt = new Date(document.querySelector('#live-starts-at').value);
    const endsAt = new Date(document.querySelector('#live-ends-at').value);
    if (endsAt <= startsAt) throw new Error('The class end time must be after the start time.');
    const { error } = await state.client.from('virtual_sessions').insert({
      course_id: document.querySelector('#live-course').value,
      title: document.querySelector('#live-title').value.trim(),
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      meeting_url: `agora://${channelFor()}`,
      created_by: state.user.id,
    });
    if (error) throw error;
    closeDialog('live-class-modal');
    showToast('Live class scheduled.');
    await loadLiveClasses();
  } catch (error) {
    setFormMessage('live-class-form-message', error?.message || friendlyDbError(error, 'Could not schedule the live class.'));
  } finally {
    setButtonBusy(button, false, '', 'Schedule class');
  }
}

async function getAgoraRtc() {
  if (window.AgoraRTC) return window.AgoraRTC;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.24.0/AgoraRTC_N-production.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Unable to load the video classroom service.'));
    document.head.append(script);
  });
  return window.AgoraRTC;
}

function participantName(uid) {
  return participants.get(String(uid))?.name || `Class member ${uid}`;
}

function renderParticipants() {
  const list = document.querySelector('#live-participant-list');
  if (!list) return;
  list.replaceChildren();
  const people = [...participants.values()].sort((left, right) => left.name.localeCompare(right.name));
  people.forEach((person) => {
    const remoteTitle = document.querySelector(`#remote-${person.uid} .video-meta strong`);
    const remoteBadge = document.querySelector(`#remote-${person.uid} .video-meta span`);
    if (remoteTitle) remoteTitle.textContent = person.name;
    if (remoteBadge) remoteBadge.textContent = person.isPresenter ? 'Lecturer' : 'Live';
    const item = document.createElement('li');
    item.className = 'participant-row';
    const avatar = document.createElement('span');
    avatar.className = 'participant-avatar';
    avatar.textContent = initials(person.name);
    const details = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = person.name;
    const status = document.createElement('small');
    status.textContent = person.uid === String(activeSession?.uid) ? 'You' : person.isPresenter ? 'Lecturer' : 'Student';
    details.append(name, status);
    const live = document.createElement('span');
    live.className = 'presence-dot';
    live.title = 'Live in this class';
    item.append(avatar, details, live);
    list.append(item);
  });
  setText('live-participant-count', `${people.length} live`);
}

function syncPresence() {
  const stateByKey = presenceChannel?.presenceState?.() || {};
  participants.clear();
  Object.values(stateByKey).forEach((entries) => {
    const person = entries[entries.length - 1];
    if (person?.uid) participants.set(String(person.uid), person);
  });
  if (activeSession?.uid && !participants.has(String(activeSession.uid))) {
    participants.set(String(activeSession.uid), {
      uid: String(activeSession.uid), name: state.fullName, isPresenter: activeSession.isPresenter,
    });
  }
  renderParticipants();
}

async function connectPresence() {
  presenceChannel = state.client.channel(`live-class:${activeSession.channelName}`, { config: { presence: { key: String(activeSession.uid) } } });
  presenceChannel.on('presence', { event: 'sync' }, syncPresence);
  presenceChannel.on('presence', { event: 'join' }, syncPresence);
  presenceChannel.on('presence', { event: 'leave' }, syncPresence);
  await new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 4000);
    presenceChannel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      window.clearTimeout(timeout);
      await presenceChannel.track({ uid: String(activeSession.uid), name: state.fullName, isPresenter: activeSession.isPresenter });
      syncPresence();
      resolve();
    });
  });
}

function createVideoTile({ id, name, label, local = false }) {
  const tile = document.createElement('article');
  tile.id = id;
  tile.className = `video-tile${local ? ' local-player' : ' remote-player'}`;
  const video = document.createElement('div');
  video.id = `${id}-video`;
  video.className = 'video-surface';
  const placeholder = document.createElement('div');
  placeholder.id = `${id}-placeholder`;
  placeholder.className = 'video-placeholder';
  const avatar = document.createElement('span');
  avatar.className = 'video-avatar';
  avatar.textContent = initials(name);
  const text = document.createElement('span');
  text.textContent = local ? 'Camera is off' : 'Connecting video…';
  placeholder.append(avatar, text);
  const meta = document.createElement('div');
  meta.className = 'video-meta';
  const title = document.createElement('strong');
  title.textContent = name;
  const badge = document.createElement('span');
  badge.textContent = label;
  meta.append(title, badge);
  tile.append(video, placeholder, meta);
  return tile;
}

function renderLocalTile() {
  const container = document.querySelector('#live-local-player');
  container.replaceChildren(createVideoTile({ id: 'local-stream', name: state.fullName, label: activeSession?.isPresenter ? 'Lecturer' : 'You', local: true }));
}

function addRemotePlayer(user) {
  const id = `remote-${user.uid}`;
  document.querySelector(`#${id}`)?.remove();
  const player = createVideoTile({ id, name: participantName(user.uid), label: participants.get(String(user.uid))?.isPresenter ? 'Lecturer' : 'Live' });
  document.querySelector('#live-remote-streams').append(player);
  const placeholder = document.querySelector(`#${id}-placeholder`);
  placeholder.hidden = true;
  user.videoTrack?.play(`${id}-video`);
}

function updateMediaControls() {
  const camera = document.querySelector('#toggle-live-camera');
  const microphone = document.querySelector('#toggle-live-microphone');
  camera.textContent = localVideoTrack?.enabled ? '▣ Camera on' : '▣ Start camera';
  microphone.textContent = localAudioTrack?.enabled ? '◉ Mic on' : '◉ Start mic';
  camera.classList.toggle('is-active', Boolean(localVideoTrack?.enabled));
  microphone.classList.toggle('is-active', Boolean(localAudioTrack?.enabled));
}

async function toggleCamera() {
  if (!rtcClient) return;
  try {
    if (!localVideoTrack) {
      const AgoraRTC = await getAgoraRtc();
      localVideoTrack = await AgoraRTC.createCameraVideoTrack();
      await rtcClient.publish([localVideoTrack]);
      localVideoTrack.play('local-stream-video');
    } else {
      await localVideoTrack.setEnabled(!localVideoTrack.enabled);
      if (localVideoTrack.enabled) localVideoTrack.play('local-stream-video');
    }
    document.querySelector('#local-stream-placeholder').hidden = Boolean(localVideoTrack.enabled);
    updateMediaControls();
  } catch (error) {
    showToast(error?.message || 'Your camera could not be started. Check browser permission.');
  }
}

async function toggleMicrophone() {
  if (!rtcClient) return;
  try {
    if (!localAudioTrack) {
      const AgoraRTC = await getAgoraRtc();
      localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      await rtcClient.publish([localAudioTrack]);
    } else {
      await localAudioTrack.setEnabled(!localAudioTrack.enabled);
    }
    updateMediaControls();
  } catch (error) {
    showToast(error?.message || 'Your microphone could not be started. Check browser permission.');
  }
}

function configureRoom() {
  renderLocalTile();
  document.querySelector('#live-class-title').textContent = activeSession.title || 'Live class connected';
  setText('live-course-status', activeSession.isPresenter ? 'Lecturer room' : 'Student room');
  document.querySelector('#live-leave-class').hidden = false;
  updateMediaControls();
  openDialog('live-room-modal');
}

async function joinClass(sessionId) {
  const joinButton = document.querySelector(`[data-live-join="${sessionId}"]`);
  setButtonBusy(joinButton, true, 'Joining…', 'Join class');
  try {
    const { data, error } = await state.client.functions.invoke('agora-token', { body: { sessionId } });
    if (error || data?.error) throw error || new Error(data.error);
    activeSession = data;
    const AgoraRTC = await getAgoraRtc();
    rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    rtcClient.on('user-published', async (user, mediaType) => {
      await rtcClient.subscribe(user, mediaType);
      if (mediaType === 'video') addRemotePlayer(user);
      if (mediaType === 'audio') user.audioTrack.play();
    });
    rtcClient.on('user-unpublished', (user, mediaType) => {
      if (mediaType === 'video') document.querySelector(`#remote-${user.uid}`)?.remove();
    });
    rtcClient.on('user-left', (user) => document.querySelector(`#remote-${user.uid}`)?.remove());
    await rtcClient.join(data.appId, data.channelName, data.token, data.uid);
    configureRoom();
    await connectPresence();
    if (data.isPresenter) await toggleCamera();
  } catch (error) {
    showToast(error?.message || 'Could not join the live class.');
    await leaveClass();
  } finally {
    setButtonBusy(joinButton, false, '', 'Join class');
  }
}

async function leaveClass() {
  [localVideoTrack, localAudioTrack].filter(Boolean).forEach((track) => { track.stop(); track.close(); });
  localVideoTrack = null;
  localAudioTrack = null;
  if (presenceChannel) {
    await state.client.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  if (rtcClient) {
    await rtcClient.leave();
    rtcClient = null;
  }
  participants.clear();
  document.querySelector('#live-remote-streams').replaceChildren();
  document.querySelector('#live-local-player').replaceChildren();
  document.querySelector('#live-participant-list').replaceChildren();
  activeSession = null;
  closeDialog('live-room-modal');
}

export function initLiveClasses() {
  document.querySelector('#schedule-live-class').addEventListener('click', openScheduleForm);
  document.querySelector('#live-class-form').addEventListener('submit', saveLiveClass);
  document.querySelector('#live-classes-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-live-join]');
    if (button) joinClass(button.dataset.liveJoin);
  });
  document.querySelector('#toggle-live-camera').addEventListener('click', toggleCamera);
  document.querySelector('#toggle-live-microphone').addEventListener('click', toggleMicrophone);
  document.querySelector('#live-leave-class').addEventListener('click', leaveClass);
  document.querySelector('#live-room-modal').addEventListener('close', () => { if (rtcClient) leaveClass(); });
}
