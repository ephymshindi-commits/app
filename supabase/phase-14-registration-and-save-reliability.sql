alter table public.students
  alter column registration_number drop not null;

create table if not exists public.student_registration_counters (
  programme_id uuid not null references public.programmes(id) on delete restrict,
  registration_year integer not null check (registration_year between 2000 and 9999),
  last_issued integer not null default 0 check (last_issued >= 0),
  primary key (programme_id, registration_year)
);

insert into public.student_registration_counters (programme_id, registration_year, last_issued)
select
  s.programme_id,
  split_part(s.registration_number, '/', 3)::integer,
  max(split_part(s.registration_number, '/', 2)::integer)
from public.students s
join public.programmes p on p.id = s.programme_id
where s.registration_number ~ '^[A-Z0-9]+/[0-9]{4}/[0-9]{4}$'
  and split_part(s.registration_number, '/', 1) = upper(trim(p.code))
group by s.programme_id, split_part(s.registration_number, '/', 3)::integer
on conflict (programme_id, registration_year)
do update set last_issued = greatest(
  public.student_registration_counters.last_issued,
  excluded.last_issued
);

alter table public.student_registration_counters enable row level security;

drop policy if exists "registration counters: administrators read" on public.student_registration_counters;
create policy "registration counters: administrators read" on public.student_registration_counters
  for select to authenticated
  using ((select public.is_administrator()));

create or replace function public.issue_student_registration_number(
  target_student_id uuid,
  target_profile_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  programme_code text;
  registration_year integer := extract(year from current_date)::integer;
  next_number integer;
  issued_number text;
begin
  select upper(trim(p.code))
  into programme_code
  from public.students s
  join public.programmes p on p.id = s.programme_id
  where s.id = target_student_id
    and s.profile_id is null
  for update of s;

  if programme_code is null then
    raise exception 'Student record was not found or already has an account.';
  end if;

  if programme_code !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' then
    raise exception 'The programme code must use letters, numbers and optional single hyphens before a student account can be created.';
  end if;

  insert into public.student_registration_counters (programme_id, registration_year, last_issued)
  select programme_id, registration_year, 1
  from public.students
  where id = target_student_id
  on conflict (programme_id, registration_year)
  do update set last_issued = public.student_registration_counters.last_issued + 1
  returning last_issued into next_number;

  issued_number := format('%s/%s/%s', programme_code, lpad(next_number::text, 4, '0'), registration_year);

  update public.students
  set profile_id = target_profile_id,
      registration_number = issued_number
  where id = target_student_id
    and profile_id is null;

  if not found then
    raise exception 'Student account could not be linked.';
  end if;

  return issued_number;
end;
$$;

revoke all on function public.issue_student_registration_number(uuid, uuid) from public;
grant execute on function public.issue_student_registration_number(uuid, uuid) to service_role;

do $$
declare
  managed_table text;
begin
  foreach managed_table in array array[
    'profiles', 'departments', 'programmes', 'academic_years', 'semesters', 'units',
    'fee_structures', 'intakes', 'students', 'enrollments', 'invoices', 'payments',
    'attendance_sessions', 'attendance_records', 'staff_members', 'announcements',
    'institution_settings', 'inventory_categories', 'inventory_suppliers',
    'inventory_items', 'inventory_movements', 'learning_courses', 'course_memberships',
    'course_materials', 'virtual_sessions', 'assignments', 'assignment_submissions',
    'question_banks', 'questions', 'question_options', 'online_assessments',
    'assessment_questions', 'assessment_attempts', 'assessment_responses',
    'library_resources', 'timetable_slots', 'student_risk_alerts', 'grading_scales',
    'grading_bands', 'unit_results', 'mpesa_stk_requests'
  ]
  loop
    execute format('grant select, insert, update, delete on table public.%I to authenticated', managed_table);
    execute format('drop policy if exists "save reliability: administrators manage" on public.%I', managed_table);
    execute format(
      'create policy "save reliability: administrators manage" on public.%I for all to authenticated using ((select public.is_administrator())) with check ((select public.is_administrator()))',
      managed_table
    );
  end loop;
end;
$$;
