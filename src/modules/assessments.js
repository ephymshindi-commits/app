import {
  appendTableRow, clearTable, closeDialog, friendlyDbError, isAdministrator, openDialog,
  setButtonBusy, setFormMessage, setText, showToast, state,
} from './core.js';

function relation(record) { return Array.isArray(record) ? record[0] : record; }
function staffCanCreate() { return ['administrator', 'trainer'].includes(state.role); }
function toLocalInput(value) { return value ? new Date(value).toISOString().slice(0, 16) : ''; }

async function loadCourseOptions() {
  const select = document.querySelector('#assessment-course');
  select.replaceChildren(new Option('Loading courses…', ''));
  let request = state.client.from('learning_courses').select('id, title, units(code, name)').order('created_at', { ascending: false });
  if (state.role === 'trainer') request = request.eq('trainer_id', state.user.id);
  const { data, error } = await request;
  if (error) throw error;
  select.replaceChildren(new Option('Select course', ''));
  (data || []).forEach((course) => {
    const unit = relation(course.units);
    select.append(new Option(`${course.title} · ${unit?.code || 'Unit'}`, course.id));
  });
}

function action(label, id) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'text-button'; button.dataset.assessmentId = id; button.textContent = label;
  return button;
}

function actions(assessment) {
  const group = document.createElement('div'); group.className = 'button-row';
  const question = action('Questions', assessment.id); question.dataset.assessmentQuestionId = assessment.id;
  const publish = action(assessment.published ? 'Unpublish' : 'Publish', assessment.id);
  group.append(question, publish);
  return group;
}

export async function loadAssessments() {
  setText('assessments-message', 'Loading assessments…');
  try {
    let request = state.client.from('online_assessments')
      .select('id, title, kind, opens_at, closes_at, duration_minutes, attempt_limit, published, learning_courses(title, units(code))')
      .order('opens_at', { ascending: false }).limit(100);
    if (state.role === 'trainer') request = request.eq('created_by', state.user.id);
    const { data, error } = await request;
    if (error) throw error;
    clearTable('assessments-table');
    (data || []).forEach((assessment) => {
      const course = relation(assessment.learning_courses); const status = assessment.published ? 'Published' : 'Draft';
      appendTableRow('assessments-table', [assessment.title, course ? `${course.title} · ${relation(course.units)?.code || ''}` : '—', `${new Date(assessment.opens_at).toLocaleString()} – ${new Date(assessment.closes_at).toLocaleString()}`, `${assessment.duration_minutes} min`, assessment.attempt_limit, status, staffCanCreate() ? actions(assessment) : '—']);
    });
    setText('assessments-message', data?.length ? 'Assessment schedule is up to date.' : 'No assessments have been created yet.');
  } catch (error) { setText('assessments-message', friendlyDbError(error, 'Unable to load online assessments.')); }
}

async function openAssessmentForm() {
  if (!staffCanCreate()) return showToast('Only staff can create online assessments.');
  try {
    await loadCourseOptions(); document.querySelector('#assessment-form').reset();
    const now = new Date(); const close = new Date(now.getTime() + 60 * 60 * 1000);
    document.querySelector('#assessment-opens-at').value = toLocalInput(now);
    document.querySelector('#assessment-closes-at').value = toLocalInput(close);
    document.querySelector('#assessment-duration').value = '45'; document.querySelector('#assessment-attempt-limit').value = '1';
    setFormMessage('assessment-form-message'); openDialog('assessment-modal');
  } catch (error) { showToast(friendlyDbError(error, 'Unable to prepare assessment form.')); }
}

async function saveAssessment(event) {
  event.preventDefault();
  if (!staffCanCreate()) return;
  const button = document.querySelector('#save-assessment');
  setButtonBusy(button, true, 'Saving…', 'Save assessment'); setFormMessage('assessment-form-message');
  try {
    const { error } = await state.client.from('online_assessments').insert({
      course_id: document.querySelector('#assessment-course').value, title: document.querySelector('#assessment-title').value.trim(),
      kind: document.querySelector('#assessment-kind').value, instructions: document.querySelector('#assessment-instructions').value.trim() || null,
      opens_at: new Date(document.querySelector('#assessment-opens-at').value).toISOString(), closes_at: new Date(document.querySelector('#assessment-closes-at').value).toISOString(),
      duration_minutes: Number(document.querySelector('#assessment-duration').value), attempt_limit: Number(document.querySelector('#assessment-attempt-limit').value),
      published: document.querySelector('#assessment-published').value === 'true', created_by: state.user.id,
    });
    if (error) throw error;
    closeDialog('assessment-modal'); showToast('Assessment saved.'); await loadAssessments();
  } catch (error) { setFormMessage('assessment-form-message', friendlyDbError(error, 'Could not save assessment.')); }
  finally { setButtonBusy(button, false, '', 'Save assessment'); }
}

async function togglePublished(id) {
  if (!staffCanCreate()) return;
  try {
    const { data, error } = await state.client.from('online_assessments').select('published').eq('id', id).maybeSingle();
    if (error || !data) throw error || new Error('Assessment not found');
    const { error: updateError } = await state.client.from('online_assessments').update({ published: !data.published }).eq('id', id);
    if (updateError) throw updateError;
    showToast(data.published ? 'Assessment returned to draft.' : 'Assessment published.'); await loadAssessments();
  } catch (error) { showToast(friendlyDbError(error, 'Could not update assessment status.')); }
}

let questionAssessmentId = null;

async function openQuestionForm(assessmentId) {
  if (!staffCanCreate()) return;
  questionAssessmentId = assessmentId;
  document.querySelector('#assessment-question-form').reset();
  document.querySelector('#assessment-question-marks').value = '1';
  document.querySelector('#assessment-question-kind').value = 'multiple_choice';
  setFormMessage('assessment-question-form-message');
  openDialog('assessment-question-modal');
}

async function saveQuestion(event) {
  event.preventDefault();
  if (!staffCanCreate() || !questionAssessmentId) return;
  const button = document.querySelector('#save-assessment-question');
  setButtonBusy(button, true, 'Saving…', 'Add question'); setFormMessage('assessment-question-form-message');
  try {
    const { data: assessment, error: assessmentError } = await state.client.from('online_assessments')
      .select('id, title, learning_courses(unit_id)').eq('id', questionAssessmentId).maybeSingle();
    if (assessmentError || !assessment) throw assessmentError || new Error('Assessment not found');
    const unitId = relation(assessment.learning_courses)?.unit_id;
    if (!unitId) throw new Error('Course unit is missing.');
    const bankTitle = `${assessment.title} question bank`;
    let { data: bank, error: bankError } = await state.client.from('question_banks').select('id').eq('unit_id', unitId).eq('title', bankTitle).maybeSingle();
    if (bankError) throw bankError;
    if (!bank) {
      const result = await state.client.from('question_banks').insert({ unit_id: unitId, title: bankTitle, owner_id: state.user.id }).select('id').single();
      if (result.error) throw result.error;
      bank = result.data;
    }
    const kind = document.querySelector('#assessment-question-kind').value;
    const { data: question, error: questionError } = await state.client.from('questions').insert({
      question_bank_id: bank.id, prompt: document.querySelector('#assessment-question-prompt').value.trim(), kind,
      marks: Number(document.querySelector('#assessment-question-marks').value),
    }).select('id, marks').single();
    if (questionError) throw questionError;
    const rawOptions = ['a', 'b', 'c', 'd'].map((letter, index) => ({ text: document.querySelector(`#assessment-option-${letter}`).value.trim(), position: index + 1 }));
    const options = rawOptions.filter((item) => item.text);
    if (kind === 'true_false') { options.splice(0, options.length, { text: 'True', position: 1 }, { text: 'False', position: 2 }); }
    if (options.length < 2) throw new Error('Add at least two answer options.');
    const correctPosition = Number(document.querySelector('#assessment-correct-option').value);
    if (!options.some((item) => item.position === correctPosition)) throw new Error('The selected correct answer needs a matching option.');
    const { error: optionsError } = await state.client.from('question_options').insert(options.map((item) => ({ question_id: question.id, option_text: item.text, position: item.position, is_correct: item.position === correctPosition })));
    if (optionsError) throw optionsError;
    const { count, error: countError } = await state.client.from('assessment_questions').select('*', { count: 'exact', head: true }).eq('assessment_id', questionAssessmentId);
    if (countError) throw countError;
    const { error: linkError } = await state.client.from('assessment_questions').insert({ assessment_id: questionAssessmentId, question_id: question.id, position: Number(count || 0) + 1, marks: question.marks });
    if (linkError) throw linkError;
    closeDialog('assessment-question-modal'); showToast('Question added to assessment.');
  } catch (error) { setFormMessage('assessment-question-form-message', friendlyDbError(error, error?.message || 'Could not save question.')); }
  finally { setButtonBusy(button, false, '', 'Add question'); }
}

export function initAssessments() {
  document.querySelector('#create-assessment').addEventListener('click', openAssessmentForm);
  document.querySelector('#assessment-form').addEventListener('submit', saveAssessment);
  document.querySelector('#assessment-question-form').addEventListener('submit', saveQuestion);
  document.querySelector('#assessments-table').addEventListener('click', (event) => {
    const question = event.target.closest('[data-assessment-question-id]');
    if (question) return openQuestionForm(question.dataset.assessmentQuestionId);
    const button = event.target.closest('[data-assessment-id]');
    if (button) togglePublished(button.dataset.assessmentId);
  });
}
