create or replace function public.student_has_attendance_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.attendance_records record
    where record.session_id = target_session_id
      and record.student_id = public.my_student_id()
  )
$$;

revoke all on function public.student_has_attendance_session(uuid) from public;
grant execute on function public.student_has_attendance_session(uuid) to authenticated;

drop policy if exists "attendance sessions: students read own" on public.attendance_sessions;
create policy "attendance sessions: students read own" on public.attendance_sessions
  for select to authenticated
  using (public.student_has_attendance_session(id));
