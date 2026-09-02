

alter table public.students
  add column if not exists next_of_kin_name text,
  add column if not exists next_of_kin_relationship text,
  add column if not exists next_of_kin_phone text;


create table if not exists public.intakes (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  name text not null,                       -- e.g. 'January 2026', 'May 2026'
  starts_on date not null,
  closes_on date,
  created_at timestamptz not null default now(),
  unique(academic_year_id, name),
  check (closes_on is null or closes_on >= starts_on)
);

alter table public.students
  add column if not exists intake_id uuid references public.intakes(id) on delete restrict;

alter table public.intakes enable row level security;
create policy "intakes: authenticated read" on public.intakes for select to authenticated using (true);
create policy "intakes: administrators manage" on public.intakes for all to authenticated
  using (public.is_administrator()) with check (public.is_administrator());



create type public.result_status as enum ('draft', 'submitted', 'approved', 'released');

create table public.grading_scales (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid references public.programmes(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.grading_bands (
  id uuid primary key default gen_random_uuid(),
  grading_scale_id uuid not null references public.grading_scales(id) on delete cascade,
  grade text not null,                -- 'A', 'B+', 'Distinction', etc.
  min_score numeric(5,2) not null,
  max_score numeric(5,2) not null,
  is_pass boolean not null default true,
  unique(grading_scale_id, grade),
  check (max_score >= min_score)
);

create table public.unit_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  semester_id uuid not null references public.semesters(id) on delete restrict,
  cat_score numeric(5,2) check (cat_score >= 0),
  exam_score numeric(5,2) check (exam_score >= 0),
  total_score numeric(5,2) generated always as (coalesce(cat_score,0) + coalesce(exam_score,0)) stored,
  grade text,
  status public.result_status not null default 'draft',
  entered_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, unit_id, semester_id),
  check (status not in ('approved','released') or approved_by is not null),
  check ((status = 'released') = (released_at is not null))
);

create index unit_results_student_idx on public.unit_results(student_id, semester_id);
create index unit_results_unit_semester_idx on public.unit_results(unit_id, semester_id, status);

create trigger unit_results_updated_at before update on public.unit_results
  for each row execute function public.set_updated_at();

drop trigger if exists audit_unit_results on public.unit_results;
create trigger audit_unit_results
  after insert or update or delete on public.unit_results
  for each row execute function public.record_audit_log();

alter table public.grading_scales enable row level security;
alter table public.grading_bands enable row level security;
alter table public.unit_results enable row level security;

create policy "grading scales: authenticated read" on public.grading_scales for select to authenticated using (true);
create policy "grading scales: administrators manage" on public.grading_scales for all to authenticated
  using (public.is_administrator()) with check (public.is_administrator());

create policy "grading bands: authenticated read" on public.grading_bands for select to authenticated using (true);
create policy "grading bands: administrators manage" on public.grading_bands for all to authenticated
  using (public.is_administrator()) with check (public.is_administrator());

create policy "unit results: students read own released" on public.unit_results
  for select to authenticated
  using (status = 'released' and student_id = public.my_student_id());

create policy "unit results: administrators manage" on public.unit_results
  for all to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

create policy "unit results: trainers read own entries" on public.unit_results
  for select to authenticated
  using (public.is_trainer() and entered_by = auth.uid());

create policy "unit results: trainers create own drafts" on public.unit_results
  for insert to authenticated
  with check (public.is_trainer() and entered_by = auth.uid() and status = 'draft');

create policy "unit results: trainers update own drafts" on public.unit_results
  for update to authenticated
  using (public.is_trainer() and entered_by = auth.uid() and status = 'draft')
  with check (public.is_trainer() and entered_by = auth.uid() and status = 'draft');

create policy "unit results: trainers delete own drafts" on public.unit_results
  for delete to authenticated
  using (public.is_trainer() and entered_by = auth.uid() and status = 'draft');
