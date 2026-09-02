


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

create policy "fee structures: authenticated read" on public.fee_structures
  for select to authenticated using (true);
create policy "fee structures: administrators manage" on public.fee_structures
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());

create policy "audit logs: administrators read" on public.audit_logs
  for select to authenticated using (public.is_administrator());


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

alter view public.student_fee_balances set (security_invoker = true);


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


create extension if not exists btree_gist;

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


create index if not exists enrollments_semester_idx on public.enrollments(semester_id);
create index if not exists attendance_records_student_idx on public.attendance_records(student_id);
create index if not exists invoices_due_on_idx on public.invoices(due_on) where status in ('issued','part_paid');
create index if not exists payments_invoice_idx on public.payments(invoice_id);



drop policy if exists "students: administrators manage" on public.students;
create policy "students: administrators manage" on public.students
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop policy if exists "students: students read own" on public.students;
create policy "students: students read own" on public.students
  for select to authenticated
  using (profile_id = (select auth.uid()));
