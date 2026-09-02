

alter table public.attendance_sessions enable row level security;

drop policy if exists "attendance sessions: administrators manage" on public.attendance_sessions;
create policy "attendance sessions: administrators manage" on public.attendance_sessions
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop policy if exists "attendance sessions: students read own" on public.attendance_sessions;
create policy "attendance sessions: students read own" on public.attendance_sessions
  for select to authenticated
  using (
    exists (
      select 1
      from public.attendance_records ar
      where ar.session_id = attendance_sessions.id
        and ar.student_id = (select public.my_student_id())
    )
  );

drop trigger if exists audit_attendance_sessions on public.attendance_sessions;
create trigger audit_attendance_sessions
  after insert or update or delete on public.attendance_sessions
  for each row execute function public.record_audit_log();

drop trigger if exists audit_attendance_records on public.attendance_records;
create trigger audit_attendance_records
  after insert or update or delete on public.attendance_records
  for each row execute function public.record_audit_log();


alter table public.unit_results
  add column if not exists submitted_at timestamptz;

create or replace function public.enforce_unit_result_workflow()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New results must start as draft';
    end if;
    new.submitted_at := null;
    new.approved_by := null;
    new.approved_at := null;
    new.released_at := null;
    return new;
  end if;

  if old.status <> 'draft'
     and (new.cat_score, new.exam_score, new.grade, new.student_id, new.unit_id, new.semester_id)
         is distinct from (old.cat_score, old.exam_score, old.grade, old.student_id, old.unit_id, old.semester_id) then
    raise exception 'Submitted, approved and released results cannot be edited';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'submitted' then
    new.submitted_at := coalesce(new.submitted_at, now());
    return new;
  end if;

  if old.status = 'submitted' and new.status = 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
    return new;
  end if;

  if old.status = 'approved' and new.status = 'released' then
    new.released_at := now();
    return new;
  end if;

  raise exception 'Invalid result status transition: % to %', old.status, new.status;
end;
$$;

drop trigger if exists enforce_unit_result_workflow on public.unit_results;
create trigger enforce_unit_result_workflow
  before insert or update on public.unit_results
  for each row execute function public.enforce_unit_result_workflow();

create or replace function public.submit_my_unit_result(target_result_id uuid)
returns public.unit_results
language plpgsql
security definer
set search_path = public
as $$
declare
  submitted_result public.unit_results;
begin
  if not public.is_trainer() then
    raise exception 'Only trainers may submit result drafts';
  end if;

  update public.unit_results
  set status = 'submitted'
  where id = target_result_id
    and entered_by = auth.uid()
    and status = 'draft'
  returning * into submitted_result;

  if submitted_result.id is null then
    raise exception 'Draft result not found or not owned by the current trainer';
  end if;
  return submitted_result;
end;
$$;

revoke all on function public.submit_my_unit_result(uuid) from public;
grant execute on function public.submit_my_unit_result(uuid) to authenticated;


create or replace view public.institution_operational_summary as
select
  (select count(*) from public.students where status = 'active')::bigint as active_students,
  (select coalesce(sum(amount), 0)::numeric(12,2) from public.invoices where status <> 'void') as total_invoiced,
  (select coalesce(sum(amount), 0)::numeric(12,2) from public.payments) as total_collected,
  (select coalesce(sum(balance), 0)::numeric(12,2) from public.student_fee_balances where balance > 0) as total_outstanding,
  (select count(*) from public.student_fee_balances where balance > 0)::bigint as students_with_balance,
  (
    select round(
      100.0 * count(*) filter (where ar.status in ('present', 'late'))
      / nullif(count(*) filter (where ar.status <> 'excused'), 0),
      1
    )
    from public.attendance_records ar
    join public.attendance_sessions ases on ases.id = ar.session_id
  ) as attendance_percentage,
  (select count(*) from public.unit_results where status in ('submitted', 'approved'))::bigint as pending_results,
  (select count(*) from public.student_attendance_summary where attendance_percentage < 75)::bigint as low_attendance_students;

alter view public.institution_operational_summary set (security_invoker = true);
