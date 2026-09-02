drop policy if exists "profiles: administrators manage" on public.profiles;
create policy "profiles: administrators manage" on public.profiles
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop policy if exists "students: administrators manage" on public.students;
create policy "students: administrators manage" on public.students
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop policy if exists "enrollments: administrators manage" on public.enrollments;
create policy "enrollments: administrators manage" on public.enrollments
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop policy if exists "invoices: administrators manage" on public.invoices;
create policy "invoices: administrators manage" on public.invoices
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop policy if exists "payments: administrators manage" on public.payments;
create policy "payments: administrators manage" on public.payments
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop policy if exists "attendance records: administrators manage" on public.attendance_records;
create policy "attendance records: administrators manage" on public.attendance_records
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop policy if exists "attendance sessions: administrators manage" on public.attendance_sessions;
create policy "attendance sessions: administrators manage" on public.attendance_sessions
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop policy if exists "unit results: administrators manage" on public.unit_results;
create policy "unit results: administrators manage" on public.unit_results
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

grant select on public.student_fee_balances to authenticated;
grant select on public.student_attendance_summary to authenticated;
grant select on public.institution_operational_summary to authenticated;

comment on view public.student_fee_balances is null;
