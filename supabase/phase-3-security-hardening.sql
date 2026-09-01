-- ============================================================================
-- TVET Connect — Phase 3: Security Hardening & Performance Patch
-- ============================================================================
-- Prerequisite: schema.sql, phase-1-admin-rls.sql and phase-2-digital-campus.sql
-- have all already been run, in that order. Run this file once, then verify
-- with the checks at the bottom before moving on to phase-4.
--
-- WHAT THIS FIXES (full detail in AUDIT-REPORT.md):
--   1. Seven tables were created with RLS never switched on: departments,
--      programmes, academic_years, semesters, units, fee_structures,
--      audit_logs. On Supabase, RLS-off plus the platform's default
--      anon/authenticated grants means these were readable — and in most
--      cases writable — by anyone holding the public anon key, which ships
--      in every browser bundle. audit_logs is the serious one: it exists to
--      store old_data/new_data snapshots of your most sensitive rows.
--   2. audit_logs was never written to. A table nothing ever inserts into
--      isn't an audit trail, it just looks like one.
--   3. Nothing stops a payment being recorded against the wrong student's
--      invoice — student_id on payments and student_id on invoices are
--      never checked against each other.
--   4. "How much does this student owe" and "what is this student's
--      attendance rate" have no single source of truth, so every screen
--      that needs the number would reinvent the arithmetic and drift.
--   5. The timetable-conflict TODO left in phase-2 is resolved with a real
--      database constraint instead of a comment.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. CLOSE THE OPEN TABLES
-- ----------------------------------------------------------------------------
-- Reference/catalog tables: fine to be readable by any signed-in user (a
-- course catalog isn't sensitive on its own), but writes stay admin-only.

alter table public.departments     enable row level security;
alter table public.programmes      enable row level security;
alter table public.academic_years  enable row level security;
alter table public.semesters       enable row level security;
alter table public.units           enable row level security;
alter table public.fee_structures  enable row level security;
alter table public.audit_logs      enable row level security;

create policy "departments: authenticated read" on public.departments
  for select to authenticated using (true);
create policy "departments: administrators manage" on public.departments
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());

create policy "programmes: authenticated read" on public.programmes
  for select to authenticated using (true);
create policy "programmes: administrators manage" on public.programmes
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());

create policy "academic years: authenticated read" on public.academic_years
  for select to authenticated using (true);
create policy "academic years: administrators manage" on public.academic_years
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());

create policy "semesters: authenticated read" on public.semesters
  for select to authenticated using (true);
create policy "semesters: administrators manage" on public.semesters
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());

create policy "units: authenticated read" on public.units
  for select to authenticated using (true);
create policy "units: administrators manage" on public.units
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());

-- Fee structures are institution pricing, not student PII — but they're
-- still financial policy, so keep writes admin-only.
create policy "fee structures: authenticated read" on public.fee_structures
  for select to authenticated using (true);
create policy "fee structures: administrators manage" on public.fee_structures
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());

-- audit_logs: nobody edits history. Administrators may read it. No client
-- role gets insert/update/delete — rows are written exclusively by the
-- trigger in section 2, which runs SECURITY DEFINER and bypasses RLS on
-- insert. If you ever need to write a log row from application code
-- directly, do it through a SECURITY DEFINER function, never a direct insert.
create policy "audit logs: administrators read" on public.audit_logs
  for select to authenticated using (public.is_administrator());


-- ----------------------------------------------------------------------------
-- 2. MAKE THE AUDIT LOG ACTUALLY LOG
-- ----------------------------------------------------------------------------
create or replace function public.record_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    (case when tg_op = 'DELETE' then old.id else new.id end),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

-- Attached to the tables the project brief calls out by name: mark changes,
-- fee adjustments and account administration. Extend this list to
-- unit_results once phase-4 is applied.
drop trigger if exists audit_students on public.students;
create trigger audit_students
  after insert or update or delete on public.students
  for each row execute function public.record_audit_log();

drop trigger if exists audit_invoices on public.invoices;
create trigger audit_invoices
  after insert or update or delete on public.invoices
  for each row execute function public.record_audit_log();

drop trigger if exists audit_payments on public.payments;
create trigger audit_payments
  after insert or update or delete on public.payments
  for each row execute function public.record_audit_log();

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles
  after update or delete on public.profiles
  for each row execute function public.record_audit_log();
-- Deliberately skips INSERT on profiles: the one row created per signup
-- isn't a "sensitive change" and would just add noise. Role/name edits
-- after that point are what matter, and UPDATE already covers those.


-- ----------------------------------------------------------------------------
-- 3. FINANCIAL INTEGRITY — a payment must belong to its invoice's own student
-- ----------------------------------------------------------------------------
create or replace function public.enforce_payment_student_matches_invoice()
returns trigger
language plpgsql
as $$
declare
  invoice_student uuid;
begin
  if new.invoice_id is not null then
    select student_id into invoice_student from public.invoices where id = new.invoice_id;
    if invoice_student is null then
      raise exception 'Invoice % does not exist', new.invoice_id;
    end if;
    if invoice_student <> new.student_id then
      raise exception 'Payment student (%) does not match invoice student (%)', new.student_id, invoice_student;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_student_matches_invoice on public.payments;
create trigger payments_student_matches_invoice
  before insert or update on public.payments
  for each row execute function public.enforce_payment_student_matches_invoice();


-- ----------------------------------------------------------------------------
-- 4. FEE BALANCE — one source of truth instead of ad-hoc arithmetic per screen
-- ----------------------------------------------------------------------------
create or replace view public.student_fee_balances as
select
  s.id as student_id,
  s.registration_number,
  coalesce(sum(i.amount) filter (where i.status <> 'void'), 0)::numeric(12,2) as total_invoiced,
  coalesce(p.total_paid, 0)::numeric(12,2) as total_paid,
  (coalesce(sum(i.amount) filter (where i.status <> 'void'), 0) - coalesce(p.total_paid, 0))::numeric(12,2) as balance
from public.students s
left join public.invoices i on i.student_id = s.id
left join (
  select student_id, sum(amount) as total_paid
  from public.payments
  group by student_id
) p on p.student_id = s.id
group by s.id, s.registration_number, p.total_paid;

comment on view public.student_fee_balances is
  'Single source of truth for "how much does this student owe". Query this
   view from every screen that needs the number instead of recomputing it —
   the finance dashboard, the student self-service view and any report
   should all read the same balance.';

-- Views created without an explicit security setting run with the view
-- OWNER's row-level permissions on the underlying tables in older Postgres
-- defaults, which on Supabase is effectively a bypass of invoices/payments
-- RLS. Force invoker semantics so this view can never become an RLS hole.
alter view public.student_fee_balances set (security_invoker = true);


-- ----------------------------------------------------------------------------
-- 5. ATTENDANCE PERCENTAGE — same reasoning as the fee balance above
-- ----------------------------------------------------------------------------
create or replace view public.student_attendance_summary as
select
  ar.student_id,
  ases.semester_id,
  count(*) as sessions_recorded,
  count(*) filter (where ar.status = 'present') as sessions_present,
  count(*) filter (where ar.status = 'late') as sessions_late,
  count(*) filter (where ar.status = 'absent') as sessions_absent,
  count(*) filter (where ar.status = 'excused') as sessions_excused,
  round(
    100.0 * count(*) filter (where ar.status in ('present','late'))
    / nullif(count(*) filter (where ar.status <> 'excused'), 0),
  1) as attendance_percentage
from public.attendance_records ar
join public.attendance_sessions ases on ases.id = ar.session_id
group by ar.student_id, ases.semester_id;

alter view public.student_attendance_summary set (security_invoker = true);


-- ----------------------------------------------------------------------------
-- 6. TIMETABLE CONFLICTS — the phase-2 TODO, resolved as a real constraint
-- ----------------------------------------------------------------------------
-- Institution decision encoded here: a trainer cannot be in two places at
-- once, and a room cannot host two overlapping sessions, on the same day of
-- the same semester. Confirm this matches the institution's actual rule
-- before relying on it — the brief flags this as a policy question, not
-- just a technical one.
create extension if not exists btree_gist;

-- NOTE: built with `'2000-01-01'::date + starts_at` (date+time arithmetic),
-- not `('2000-01-01 ' || starts_at::text)::timestamp` (text parsing) — the
-- text-cast version looks equivalent but Postgres rejects it here, because
-- timestamp text parsing depends on the session's DateStyle setting and is
-- therefore only STABLE, not IMMUTABLE, and generated columns require an
-- immutable expression. Verified against a real Postgres 16 instance before
-- shipping this file — see the note at the end of AUDIT-REPORT.md.
alter table public.timetable_slots
  add column if not exists time_range tsrange
  generated always as (
    tsrange('2000-01-01'::date + starts_at, '2000-01-01'::date + ends_at)
  ) stored;

alter table public.timetable_slots
  drop constraint if exists timetable_slots_no_trainer_overlap;
alter table public.timetable_slots
  add constraint timetable_slots_no_trainer_overlap
  exclude using gist (
    trainer_id with =,
    semester_id with =,
    day_of_week with =,
    time_range with &&
  );

alter table public.timetable_slots
  drop constraint if exists timetable_slots_no_room_overlap;
alter table public.timetable_slots
  add constraint timetable_slots_no_room_overlap
  exclude using gist (
    room_name with =,
    semester_id with =,
    day_of_week with =,
    time_range with &&
  ) where (room_name is not null);


-- ----------------------------------------------------------------------------
-- 7. MISSING INDEXES FOR "THOUSANDS OF STUDENTS" QUERY PATTERNS
-- ----------------------------------------------------------------------------
-- The existing unique constraints put these columns leftmost-first for the
-- constraint's own lookup, but the common reporting queries filter the
-- other way round, so Postgres can't use them (leftmost-prefix rule).
create index if not exists enrollments_semester_idx on public.enrollments(semester_id);
create index if not exists attendance_records_student_idx on public.attendance_records(student_id);
create index if not exists invoices_due_on_idx on public.invoices(due_on) where status in ('issued','part_paid');
create index if not exists payments_invoice_idx on public.payments(invoice_id);


-- ----------------------------------------------------------------------------
-- 8. RLS PERFORMANCE — cache the auth lookup instead of re-running it per row
-- ----------------------------------------------------------------------------
-- Supabase's own Postgres guidance: wrapping a stable, auth-dependent
-- function call as `(select public.fn())` lets the planner treat it as an
-- initplan (evaluated once per statement) instead of once per row. On a
-- students table with thousands of rows that's the difference between one
-- profiles lookup and thousands of them for a single SELECT *.
--
-- This patch applies the rewrite to the two highest-traffic policies as a
-- worked example. The same rewrite should be applied to the remaining
-- policies in phase-1-admin-rls.sql and phase-2-digital-campus.sql during a
-- maintenance window, testing each one — a blind find-and-replace across
-- 40+ policies you can't load-test first isn't something to ship unattended.

drop policy if exists "students: administrators manage" on public.students;
create policy "students: administrators manage" on public.students
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop policy if exists "students: students read own" on public.students;
create policy "students: students read own" on public.students
  for select to authenticated
  using (profile_id = (select auth.uid()));


-- ----------------------------------------------------------------------------
-- VERIFY (run these yourself after applying — do not skip this)
-- ----------------------------------------------------------------------------
-- 1. Confirm RLS is now on for every public table with no exceptions:
--      select relname, relrowsecurity
--      from pg_class
--      where relnamespace = 'public'::regnamespace and relkind = 'r'
--      order by relrowsecurity, relname;
--    Every row should show relrowsecurity = true. Anything showing false is
--    a table nobody remembered to lock down — treat that as a stop-ship bug.
--
-- 2. From a terminal (NOT this file), confirm the previously-open tables no
--    longer return data to a fully anonymous request — no Authorization
--    header at all, just the public apikey, which is what a signed-out
--    visitor's browser sends:
--      curl "https://<project-ref>.supabase.co/rest/v1/audit_logs?select=*&limit=1" \
--        -H "apikey: <anon-key>"
--    Before this patch this likely returned real rows. After it, EVERY
--    table in this project should return `[]` to this exact request,
--    including departments/programmes/etc — none of the policies above (or
--    anywhere else in this project) grant anything to the unauthenticated
--    `anon` role, only to `authenticated`. If any table still returns rows
--    here, that table has a policy you don't intend, or still has RLS off.
--
-- 3. Repeat the same request but add a real logged-in user's session token:
--      -H "Authorization: Bearer <a signed-in non-admin user's access token>"
--    Now departments/programmes/academic_years/semesters/units/fee_structures
--    SHOULD return rows (that's the intended "any signed-in user may read
--    the catalog" policy), while audit_logs should still return `[]` for
--    that same non-admin user (admin-only, by design, in both directions).
-- ============================================================================
