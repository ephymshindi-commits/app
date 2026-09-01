-- ============================================================================
-- TVET Connect — Phase 4: MVP Requirements the Brief Names but the Schema
-- Doesn't Have Yet
-- ============================================================================
-- Prerequisite: run after phase-3-security-hardening.sql (this migration
-- relies on public.is_administrator(), public.is_trainer(),
-- public.my_student_id() and public.set_updated_at(), all defined in
-- phase-2-digital-campus.sql, plus btree_gist enabled in phase-3).
--
-- Source: tvet.docx, "Phase 1 — MVP". Three items are named explicitly
-- there and are entirely absent from schema.sql:
--   - Next of kin information (Student Management)
--   - Intakes as a first-class entity (Admissions & Enrollment, section 4)
--   - Marks, grades, results (Examinations & Results). The only "results"
--     tables that exist today — assessment_attempts / assessment_responses
--     from phase-2 — belong to the Phase-2 *online quiz* engine. There is
--     nowhere to record an offline CAT or final exam mark, no grading
--     scale, and no result-approval workflow.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. NEXT OF KIN
-- ----------------------------------------------------------------------------
alter table public.students
  add column if not exists next_of_kin_name text,
  add column if not exists next_of_kin_relationship text,
  add column if not exists next_of_kin_phone text;
-- Nullable by design: existing rows and mid-registration drafts shouldn't
-- break on migration day. Enforce "required before a student is marked
-- active" at the application layer, or add a NOT NULL later once historical
-- data has been backfilled — a hard NOT NULL here would break every row
-- already in production today.


-- ----------------------------------------------------------------------------
-- 2. INTAKES
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- 3. GRADING SCALE, MARKS AND RESULTS (offline CATs / final exams)
-- ----------------------------------------------------------------------------
-- Kept separate from the phase-2 online-assessment tables on purpose: this
-- is the permanent transcript-grade record, it must outlive any particular
-- quiz engine, and it needs its own approval workflow — trainer enters,
-- administrator approves and releases, only then can the student see it.

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
-- No overlap-exclusion constraint on (min_score, max_score) yet: that needs
-- a numrange exclusion constraint (btree_gist, already enabled in phase-3),
-- and whether band boundaries are inclusive/exclusive on each end is an
-- institutional grading-policy decision, not a database one — confirm it
-- with the institution before locking the ranges down at the DB level.

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
-- Reuses the set_updated_at() function already defined in phase-2-digital-campus.sql.

drop trigger if exists audit_unit_results on public.unit_results;
create trigger audit_unit_results
  after insert or update or delete on public.unit_results
  for each row execute function public.record_audit_log();
-- Reuses the audit trigger function defined in phase-3-security-hardening.sql —
-- mark changes are explicitly called out in the brief's security requirements.

alter table public.grading_scales enable row level security;
alter table public.grading_bands enable row level security;
alter table public.unit_results enable row level security;

create policy "grading scales: authenticated read" on public.grading_scales for select to authenticated using (true);
create policy "grading scales: administrators manage" on public.grading_scales for all to authenticated
  using (public.is_administrator()) with check (public.is_administrator());

create policy "grading bands: authenticated read" on public.grading_bands for select to authenticated using (true);
create policy "grading bands: administrators manage" on public.grading_bands for all to authenticated
  using (public.is_administrator()) with check (public.is_administrator());

-- Results: a student may read only their OWN results, and only once
-- 'released' — never while draft, submitted, or merely approved-but-
-- unreleased. Administrators can do anything. A trainer may create and edit
-- their own entries, but only while status = 'draft' — the WITH CHECK
-- re-evaluates on every UPDATE, so once a trainer submits a mark (moving it
-- out of 'draft') this same policy stops matching their own row, and only
-- the administrator policy can move it further. A trainer can never
-- self-approve or self-release a mark they entered.
create policy "unit results: students read own released" on public.unit_results
  for select to authenticated
  using (status = 'released' and student_id = public.my_student_id());

create policy "unit results: administrators manage" on public.unit_results
  for all to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- Trainers can always see marks they personally entered, regardless of
-- status. This is a separate SELECT policy from the write policies below
-- on purpose: an earlier draft of this migration used a single FOR ALL
-- policy gated on status = 'draft', which meant a trainer's own mark
-- became invisible to them the moment they submitted it, since no other
-- policy covers a trainer reading their own non-draft rows. Visibility
-- here does not imply edit rights — see the write policies below.
create policy "unit results: trainers read own entries" on public.unit_results
  for select to authenticated
  using (public.is_trainer() and entered_by = auth.uid());

-- A trainer may create a new draft mark for their own entry...
create policy "unit results: trainers create own drafts" on public.unit_results
  for insert to authenticated
  with check (public.is_trainer() and entered_by = auth.uid() and status = 'draft');

-- ...and edit or withdraw it, but only while it is still 'draft'. The
-- moment status leaves 'draft' (submitted, approved, released), the USING
-- clause stops matching and only an administrator can move the row
-- further — a trainer can never self-approve or self-release their own mark.
create policy "unit results: trainers update own drafts" on public.unit_results
  for update to authenticated
  using (public.is_trainer() and entered_by = auth.uid() and status = 'draft')
  with check (public.is_trainer() and entered_by = auth.uid() and status = 'draft');

create policy "unit results: trainers delete own drafts" on public.unit_results
  for delete to authenticated
  using (public.is_trainer() and entered_by = auth.uid() and status = 'draft');


-- ----------------------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------------------
-- As a trainer test account: insert a unit_results row for a unit you don't
-- teach — it should be rejected. Submit one of your own drafts (as an
-- administrator, set status = 'submitted'), then as that same trainer try to
-- UPDATE it again — rejected, because the USING clause no longer matches a
-- non-'draft' row. Confirm you can still SELECT that same now-submitted row
-- as the trainer (read access doesn't depend on status; only write does).
-- As a student test account: SELECT unit_results — you should see nothing
-- until an administrator sets status = 'released' on a row that is yours.
-- ============================================================================
