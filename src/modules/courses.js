import {
  state, closeDialog, friendlyDbError, openDialog, requireAdministrator,
  setButtonBusy, setFormMessage, setText, showToast,
} from './core.js';

let activeCourseId = null;

function option(label, value = '') {
  return new Option(label, value);
}

async function loadCourseFormOptions() {
  const [unitsResult, semestersResult, trainersResult] = await Promise.all([
    state.client.from('units').select('id, code, name').order('code'),
    state.client.from('semesters').select('id, name, academic_years(name)').order('starts_on', { ascending: false }),
    state.client.from('profiles').select('id, full_name').eq('role', 'trainer').order('full_name'),
  ]);
  if (unitsResult.error) throw unitsResult.error;
  if (semestersResult.error) throw semestersResult.error;
  if (trainersResult.error) throw trainersResult.error;
  const unitSelect = document.querySelector('#course-unit');
  const semesterSelect = document.querySelector('#course-semester');
  const trainerSelect = document.querySelector('#course-trainer');
  unitSelect.replaceChildren(option('Select unit'));
  semesterSelect.replaceChildren(option('Select semester'));
  trainerSelect.replaceChildren(option('Select trainer'));
  (unitsResult.data || []).forEach((unit) => unitSelect.append(option(`${unit.code} — ${unit.name}`, unit.id)));
  (semestersResult.data || []).forEach((semester) => {
    const year = Array.isArray(semester.academic_years) ? semester.academic_years[0] : semester.academic_years;
    semesterSelect.append(option(`${year?.name || 'Academic year'} — ${semester.name}`, semester.id));
  });
  (trainersResult.data || []).forEach((trainer) => trainerSelect.append(option(trainer.full_name, trainer.id)));
  return (unitsResult.data?.length && semestersResult.data?.length && trainersResult.data?.length);
}

function courseCard(course) {
  const card = document.createElement('article');
  card.className = 'panel course-card';
  const unit = Array.isArray(course.units) ? course.units[0] : course.units;
  const trainer = Array.isArray(course.profiles) ? course.profiles[0] : course.profiles;
  const heading = document.createElement('h3');
  heading.textContent = course.title;
  const detail = document.createElement('p');
  detail.textContent = `${unit?.code || 'Unit'} · ${trainer?.full_name || 'Trainer not assigned'}`;
  const status = document.createElement('span');
  status.className = `status ${course.visibility === 'published' ? 'active' : 'pending'}`;
  status.textContent = course.visibility;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'outline-button';
  button.dataset.courseAction = 'enrol';
  button.dataset.courseId = course.id;
  button.textContent = 'Manage enrolment';
  card.append(heading, detail, status, button);
  return card;
}

export async function loadCourses() {
  if (!requireAdministrator()) return;
  const grid = document.querySelector('#course-grid');
  grid.replaceChildren();
  setText('courses-message', 'Loading course spaces…');
  try {
    const { data, error } = await state.client
      .from('learning_courses')
      .select('id, title, visibility, units(code, name), profiles(full_name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    setText('courses-message', data?.length ? `${data.length} course space${data.length === 1 ? '' : 's'} configured.` : 'No course spaces have been created yet.');
    (data || []).forEach((course) => grid.append(courseCard(course)));
  } catch (error) {
    setText('courses-message', friendlyDbError(error, 'Unable to load course spaces.'));
  }
}

async function openCourseForm() {
  if (!requireAdministrator()) return;
  try {
    const ready = await loadCourseFormOptions();
    if (!ready) return showToast('Create units, semesters and trainer accounts before creating a course.');
    document.querySelector('#course-form').reset();
    document.querySelector('#course-visibility').value = 'draft';
    setFormMessage('course-form-message');
    openDialog('course-modal');
  } catch (error) {
    showToast(friendlyDbError(error, 'Unable to prepare the course form.'));
  }
}

async function submitCourse(event) {
  event.preventDefault();
  if (!requireAdministrator()) return;
  const button = document.querySelector('#save-course');
  setButtonBusy(button, true, 'Creating…', 'Create course');
  setFormMessage('course-form-message');
  try {
    const { error } = await state.client.from('learning_courses').insert({
      title: document.querySelector('#course-title').value.trim(),
      unit_id: document.querySelector('#course-unit').value,
      semester_id: document.querySelector('#course-semester').value,
      trainer_id: document.querySelector('#course-trainer').value,
      visibility: document.querySelector('#course-visibility').value,
      description: document.querySelector('#course-description').value.trim() || null,
    });
    if (error) throw error;
    closeDialog('course-modal');
    showToast('Course space created successfully.');
    await loadCourses();
  } catch (error) {
    setFormMessage('course-form-message', friendlyDbError(error, 'Could not create the course space.'));
  } finally {
    setButtonBusy(button, false, '', 'Create course');
  }
}

async function openEnrolmentForm(courseId) {
  if (!requireAdministrator()) return;
  activeCourseId = courseId;
  const select = document.querySelector('#course-student');
  select.replaceChildren(option('Loading active students…'));
  try {
    const { data, error } = await state.client.from('students')
      .select('id, registration_number, first_name, last_name').eq('status', 'active').order('registration_number').limit(500);
    if (error) throw error;
    select.replaceChildren(option('Select student'));
    (data || []).forEach((student) => select.append(option(`${student.registration_number} — ${student.first_name} ${student.last_name}`, student.id)));
    setFormMessage('enrolment-form-message');
    openDialog('enrolment-modal');
  } catch (error) {
    showToast(friendlyDbError(error, 'Unable to load students for enrolment.'));
  }
}

async function submitEnrolment(event) {
  event.preventDefault();
  if (!requireAdministrator() || !activeCourseId) return;
  const button = document.querySelector('#save-enrolment');
  setButtonBusy(button, true, 'Enrolling…', 'Enrol student');
  setFormMessage('enrolment-form-message');
  try {
    const { error } = await state.client.from('course_memberships').insert({
      course_id: activeCourseId,
      student_id: document.querySelector('#course-student').value,
    });
    if (error) throw error;
    closeDialog('enrolment-modal');
    showToast('Student enrolled in the course space.');
  } catch (error) {
    setFormMessage('enrolment-form-message', friendlyDbError(error, 'Could not enrol this student. They may already be enrolled.'));
  } finally {
    setButtonBusy(button, false, '', 'Enrol student');
  }
}

export function initCourses() {
  document.querySelector('#add-course').addEventListener('click', openCourseForm);
  document.querySelector('#course-form').addEventListener('submit', submitCourse);
  document.querySelector('#course-grid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-course-action="enrol"]');
    if (button) openEnrolmentForm(button.dataset.courseId);
  });
  document.querySelector('#enrolment-form').addEventListener('submit', submitEnrolment);
}
