

create type public.course_visibility as enum ('draft', 'published', 'archived');
create type public.assignment_status as enum ('draft', 'published', 'closed');
create type public.submission_status as enum ('draft', 'submitted', 'late', 'graded', 'returned');
create type public.assessment_kind as enum ('cat', 'exam', 'quiz', 'practice');
create type public.question_kind as enum ('multiple_choice', 'true_false', 'short_answer', 'essay');
create type public.attempt_status as enum ('in_progress', 'submitted', 'graded', 'expired');
create type public.risk_level as enum ('watch', 'high', 'critical', 'resolved');

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'administrator', false)
$$;

create or replace function public.is_trainer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'trainer', false)
$$;

create or replace function public.my_student_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.students where profile_id = auth.uid()
$$;

create table public.learning_courses (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  semester_id uuid not null references public.semesters(id) on delete restrict,
  trainer_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  description text,
  visibility public.course_visibility not null default 'draft',
  cover_image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(unit_id, semester_id)
);

create table public.course_memberships (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  joined_at timestamptz not null default now(),
  unique(course_id, student_id)
);

create or replace function public.has_course_access(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_administrator()
    or exists (
      select 1 from public.learning_courses c
      where c.id = target_course_id and c.trainer_id = auth.uid()
    )
    or exists (
      select 1 from public.course_memberships cm
      join public.students s on s.id = cm.student_id
      where cm.course_id = target_course_id and s.profile_id = auth.uid()
    )
$$;

create table public.course_materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  title text not null,
  description text,
  material_type text not null check (material_type in ('note', 'video', 'link', 'file')),
  storage_path text,
  external_url text,
  published boolean not null default false,
  published_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((storage_path is not null) or (external_url is not null))
);

create table public.virtual_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meeting_url text not null,
  recording_path text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  title text not null,
  instructions text not null,
  due_at timestamptz,
  max_score numeric(7,2) not null default 100 check (max_score > 0),
  status public.assignment_status not null default 'draft',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  submission_text text,
  storage_path text,
  submitted_at timestamptz,
  status public.submission_status not null default 'draft',
  score numeric(7,2) check (score >= 0),
  feedback text,
  graded_by uuid references public.profiles(id) on delete set null,
  graded_at timestamptz,
  unique(assignment_id, student_id),
  check ((submission_text is not null) or (storage_path is not null) or status = 'draft')
);

create table public.question_banks (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  title text not null,
  description text,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  question_bank_id uuid not null references public.question_banks(id) on delete cascade,
  prompt text not null,
  kind public.question_kind not null,
  marks numeric(7,2) not null default 1 check (marks > 0),
  explanation text,
  created_at timestamptz not null default now()
);

create table public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  option_text text not null,
  is_correct boolean not null default false,
  position smallint not null check (position > 0),
  unique(question_id, position)
);

create table public.online_assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  title text not null,
  instructions text,
  kind public.assessment_kind not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  attempt_limit smallint not null default 1 check (attempt_limit > 0),
  published boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create table public.assessment_questions (
  assessment_id uuid not null references public.online_assessments(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  position smallint not null check (position > 0),
  marks numeric(7,2) not null check (marks > 0),
  primary key (assessment_id, question_id),
  unique(assessment_id, position)
);

create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.online_assessments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  attempt_number smallint not null check (attempt_number > 0),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  status public.attempt_status not null default 'in_progress',
  score numeric(7,2) check (score >= 0),
  unique(assessment_id, student_id, attempt_number)
);

create table public.assessment_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.assessment_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  selected_option_id uuid references public.question_options(id) on delete restrict,
  response_text text,
  score numeric(7,2) check (score >= 0),
  marker_feedback text,
  unique(attempt_id, question_id),
  check (selected_option_id is not null or response_text is not null)
);

create table public.library_resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  resource_type text not null check (resource_type in ('book', 'journal', 'video', 'repository', 'link')),
  subject text,
  external_url text,
  storage_path text,
  access_level text not null default 'institution' check (access_level in ('public', 'institution', 'staff_only')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (external_url is not null or storage_path is not null)
);

create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete restrict,
  semester_id uuid not null references public.semesters(id) on delete restrict,
  trainer_id uuid not null references public.profiles(id) on delete restrict,
  programme_id uuid not null references public.programmes(id) on delete restrict,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  starts_at time not null,
  ends_at time not null,
  room_name text,
  delivery_mode text not null default 'in_person' check (delivery_mode in ('in_person', 'online', 'hybrid')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.student_risk_alerts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  course_id uuid references public.learning_courses(id) on delete set null,
  level public.risk_level not null,
  reason text not null,
  source_metric text,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  notes text,
  check ((level = 'resolved') = (resolved_at is not null))
);

create index learning_courses_semester_idx on public.learning_courses(semester_id, visibility);
create index course_memberships_student_idx on public.course_memberships(student_id);
create index assignments_course_status_idx on public.assignments(course_id, status, due_at);
create index online_assessments_course_window_idx on public.online_assessments(course_id, opens_at, closes_at);
create index timetable_slots_trainer_idx on public.timetable_slots(trainer_id, semester_id, day_of_week);
create index student_risk_alerts_open_idx on public.student_risk_alerts(student_id, level) where resolved_at is null;

alter table public.learning_courses enable row level security;
alter table public.course_memberships enable row level security;
alter table public.course_materials enable row level security;
alter table public.virtual_sessions enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.question_banks enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.online_assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.assessment_responses enable row level security;
alter table public.library_resources enable row level security;
alter table public.timetable_slots enable row level security;
alter table public.student_risk_alerts enable row level security;

create policy "learning courses: members read" on public.learning_courses for select to authenticated using (public.has_course_access(id));
create policy "learning courses: admins or trainer create" on public.learning_courses for insert to authenticated with check (public.is_administrator() or (public.is_trainer() and trainer_id = auth.uid()));
create policy "learning courses: admins or owner update" on public.learning_courses for update to authenticated using (public.is_administrator() or (public.is_trainer() and trainer_id = auth.uid())) with check (public.is_administrator() or (public.is_trainer() and trainer_id = auth.uid()));
create policy "learning courses: admins or owner delete" on public.learning_courses for delete to authenticated using (public.is_administrator() or (public.is_trainer() and trainer_id = auth.uid()));

create policy "course memberships: members read" on public.course_memberships for select to authenticated using (public.has_course_access(course_id));
create policy "course memberships: staff manage" on public.course_memberships for all to authenticated using (public.is_administrator() or exists (select 1 from public.learning_courses c where c.id = course_id and c.trainer_id = auth.uid())) with check (public.is_administrator() or exists (select 1 from public.learning_courses c where c.id = course_id and c.trainer_id = auth.uid()));

create policy "materials: course members read published" on public.course_materials for select to authenticated using (public.is_administrator() or created_by = auth.uid() or (public.has_course_access(course_id) and published));
create policy "materials: course trainers manage" on public.course_materials for all to authenticated using (public.is_administrator() or exists (select 1 from public.learning_courses c where c.id = course_id and c.trainer_id = auth.uid())) with check (public.is_administrator() or exists (select 1 from public.learning_courses c where c.id = course_id and c.trainer_id = auth.uid()));

create policy "sessions: course members read" on public.virtual_sessions for select to authenticated using (public.has_course_access(course_id));
create policy "sessions: course trainers manage" on public.virtual_sessions for all to authenticated using (public.is_administrator() or exists (select 1 from public.learning_courses c where c.id = course_id and c.trainer_id = auth.uid())) with check (public.is_administrator() or exists (select 1 from public.learning_courses c where c.id = course_id and c.trainer_id = auth.uid()));

create policy "assignments: course members read published" on public.assignments for select to authenticated using (public.is_administrator() or created_by = auth.uid() or (public.has_course_access(course_id) and status = 'published'));
create policy "assignments: course trainers manage" on public.assignments for all to authenticated using (public.is_administrator() or exists (select 1 from public.learning_courses c where c.id = course_id and c.trainer_id = auth.uid())) with check (public.is_administrator() or exists (select 1 from public.learning_courses c where c.id = course_id and c.trainer_id = auth.uid()));
create policy "submissions: student and trainer access" on public.assignment_submissions for select to authenticated using (student_id = public.my_student_id() or public.is_administrator() or exists (select 1 from public.assignments a join public.learning_courses c on c.id = a.course_id where a.id = assignment_id and c.trainer_id = auth.uid()));
create policy "submissions: student create own" on public.assignment_submissions for insert to authenticated with check (student_id = public.my_student_id());
create policy "submissions: student edit draft, trainer grade" on public.assignment_submissions for update to authenticated using (student_id = public.my_student_id() or public.is_administrator() or exists (select 1 from public.assignments a join public.learning_courses c on c.id = a.course_id where a.id = assignment_id and c.trainer_id = auth.uid())) with check (student_id = public.my_student_id() or public.is_administrator() or exists (select 1 from public.assignments a join public.learning_courses c on c.id = a.course_id where a.id = assignment_id and c.trainer_id = auth.uid()));

create policy "question banks: owner and admins access" on public.question_banks for all to authenticated using (public.is_administrator() or owner_id = auth.uid()) with check (public.is_administrator() or owner_id = auth.uid());
create policy "questions: bank owner and admins access" on public.questions for all to authenticated using (public.is_administrator() or exists (select 1 from public.question_banks qb where qb.id = question_bank_id and qb.owner_id = auth.uid())) with check (public.is_administrator() or exists (select 1 from public.question_banks qb where qb.id = question_bank_id and qb.owner_id = auth.uid()));
create policy "options: bank owner and admins access" on public.question_options for all to authenticated using (public.is_administrator() or exists (select 1 from public.questions q join public.question_banks qb on qb.id = q.question_bank_id where q.id = question_id and qb.owner_id = auth.uid())) with check (public.is_administrator() or exists (select 1 from public.questions q join public.question_banks qb on qb.id = q.question_bank_id where q.id = question_id and qb.owner_id = auth.uid()));

create policy "assessments: course members read published" on public.online_assessments for select to authenticated using (public.is_administrator() or created_by = auth.uid() or (public.has_course_access(course_id) and published));
create policy "assessments: course trainers manage" on public.online_assessments for all to authenticated using (public.is_administrator() or exists (select 1 from public.learning_courses c where c.id = course_id and c.trainer_id = auth.uid())) with check (public.is_administrator() or exists (select 1 from public.learning_courses c where c.id = course_id and c.trainer_id = auth.uid()));
create policy "assessment questions: accessible with assessment" on public.assessment_questions for select to authenticated using (public.is_administrator() or exists (select 1 from public.online_assessments a where a.id = assessment_id and (a.created_by = auth.uid() or (a.published and public.has_course_access(a.course_id)))));
create policy "assessment questions: trainers manage" on public.assessment_questions for all to authenticated using (public.is_administrator() or exists (select 1 from public.online_assessments a join public.learning_courses c on c.id = a.course_id where a.id = assessment_id and c.trainer_id = auth.uid())) with check (public.is_administrator() or exists (select 1 from public.online_assessments a join public.learning_courses c on c.id = a.course_id where a.id = assessment_id and c.trainer_id = auth.uid()));
create policy "attempts: student and trainers access" on public.assessment_attempts for select to authenticated using (student_id = public.my_student_id() or public.is_administrator() or exists (select 1 from public.online_assessments a join public.learning_courses c on c.id = a.course_id where a.id = assessment_id and c.trainer_id = auth.uid()));
create policy "attempts: student creates own" on public.assessment_attempts for insert to authenticated with check (student_id = public.my_student_id());
create policy "attempts: student updates own active attempt or trainer grades" on public.assessment_attempts for update to authenticated using (student_id = public.my_student_id() or public.is_administrator() or exists (select 1 from public.online_assessments a join public.learning_courses c on c.id = a.course_id where a.id = assessment_id and c.trainer_id = auth.uid())) with check (student_id = public.my_student_id() or public.is_administrator() or exists (select 1 from public.online_assessments a join public.learning_courses c on c.id = a.course_id where a.id = assessment_id and c.trainer_id = auth.uid()));
create policy "responses: attempt owner and trainer access" on public.assessment_responses for all to authenticated using (exists (select 1 from public.assessment_attempts at where at.id = attempt_id and (at.student_id = public.my_student_id() or public.is_administrator() or exists (select 1 from public.online_assessments a join public.learning_courses c on c.id = a.course_id where a.id = at.assessment_id and c.trainer_id = auth.uid())))) with check (exists (select 1 from public.assessment_attempts at where at.id = attempt_id and (at.student_id = public.my_student_id() or public.is_administrator() or exists (select 1 from public.online_assessments a join public.learning_courses c on c.id = a.course_id where a.id = at.assessment_id and c.trainer_id = auth.uid()))));

create policy "library: authenticated readers" on public.library_resources for select to authenticated using (access_level in ('public', 'institution') or public.is_administrator());
create policy "library: admins manage" on public.library_resources for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "timetable: authenticated readers" on public.timetable_slots for select to authenticated using (true);
create policy "timetable: admins manage" on public.timetable_slots for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "risk alerts: student, trainer and admin read" on public.student_risk_alerts for select to authenticated using (student_id = public.my_student_id() or public.is_administrator() or exists (select 1 from public.course_memberships cm join public.learning_courses c on c.id = cm.course_id where cm.student_id = student_risk_alerts.student_id and c.trainer_id = auth.uid()));
create policy "risk alerts: staff manage" on public.student_risk_alerts for all to authenticated using (public.is_administrator() or exists (select 1 from public.course_memberships cm join public.learning_courses c on c.id = cm.course_id where cm.student_id = student_risk_alerts.student_id and c.trainer_id = auth.uid())) with check (public.is_administrator() or exists (select 1 from public.course_memberships cm join public.learning_courses c on c.id = cm.course_id where cm.student_id = student_risk_alerts.student_id and c.trainer_id = auth.uid()));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$ begin new.updated_at = now(); return new; end; $$;

create trigger learning_courses_updated_at before update on public.learning_courses for each row execute function public.set_updated_at();
create trigger assignments_updated_at before update on public.assignments for each row execute function public.set_updated_at();
