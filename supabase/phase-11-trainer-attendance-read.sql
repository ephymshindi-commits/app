-- Trainers may review attendance for their assigned units, including sessions
-- created by an administrator, but can still only write registers they started.
drop policy if exists "attendance records: trainers read own sessions" on public.attendance_records;
drop policy if exists "attendance records: trainers read assigned units" on public.attendance_records;
create policy "attendance records: trainers read assigned units" on public.attendance_records
  for select to authenticated
  using (
    public.is_trainer() and exists (
      select 1 from public.attendance_sessions s
      join public.learning_courses c on c.unit_id = s.unit_id
      where s.id = attendance_records.session_id and c.trainer_id = auth.uid()
    )
  );

drop policy if exists "attendance records: trainers create own sessions" on public.attendance_records;
create policy "attendance records: trainers create assigned course members" on public.attendance_records
  for insert to authenticated
  with check (
    public.is_trainer() and exists (
      select 1
      from public.attendance_sessions s
      join public.learning_courses c on c.unit_id = s.unit_id and c.semester_id = s.semester_id
      join public.course_memberships cm on cm.course_id = c.id
      where s.id = attendance_records.session_id
        and s.recorded_by = auth.uid()
        and c.trainer_id = auth.uid()
        and cm.student_id = attendance_records.student_id
    )
  );
