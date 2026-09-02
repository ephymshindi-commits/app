-- Phase 10: separate administrator, trainer and student workspaces.
-- This is deliberately enforced by RLS as well as by the visible navigation.

create or replace function public.trainer_manages_course_student(target_student_id uuid, target_unit_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.learning_courses c
    join public.course_memberships cm on cm.course_id = c.id
    where c.trainer_id = auth.uid()
      and c.unit_id = target_unit_id
      and cm.student_id = target_student_id
  )
$$;

-- Trainers see only students enrolled in a course they teach.
create policy "students: trainers read assigned course members" on public.students
  for select to authenticated
  using (
    public.is_trainer() and exists (
      select 1 from public.course_memberships cm
      join public.learning_courses c on c.id = cm.course_id
      where cm.student_id = students.id and c.trainer_id = auth.uid()
    )
  );

-- Trainers can see all results for their assigned students and unit, while
-- retaining edit rights only for draft results they entered themselves.
drop policy if exists "unit results: trainers read own entries" on public.unit_results;
drop policy if exists "unit results: trainers create own drafts" on public.unit_results;
drop policy if exists "unit results: trainers update own drafts" on public.unit_results;
drop policy if exists "unit results: trainers delete own drafts" on public.unit_results;
create policy "unit results: trainers read assigned" on public.unit_results
  for select to authenticated
  using (public.is_trainer() and public.trainer_manages_course_student(student_id, unit_id));
create policy "unit results: trainers create assigned drafts" on public.unit_results
  for insert to authenticated
  with check (public.is_trainer() and entered_by = auth.uid() and status = 'draft' and public.trainer_manages_course_student(student_id, unit_id));
create policy "unit results: trainers update own assigned drafts" on public.unit_results
  for update to authenticated
  using (public.is_trainer() and entered_by = auth.uid() and status = 'draft' and public.trainer_manages_course_student(student_id, unit_id))
  with check (public.is_trainer() and entered_by = auth.uid() and status = 'draft' and public.trainer_manages_course_student(student_id, unit_id));
create policy "unit results: trainers delete own assigned drafts" on public.unit_results
  for delete to authenticated
  using (public.is_trainer() and entered_by = auth.uid() and status = 'draft' and public.trainer_manages_course_student(student_id, unit_id));

-- Trainers take and view attendance only for their own units.
create policy "attendance sessions: trainers read own units" on public.attendance_sessions
  for select to authenticated
  using (public.is_trainer() and exists (select 1 from public.learning_courses c where c.trainer_id = auth.uid() and c.unit_id = attendance_sessions.unit_id));
create policy "attendance sessions: trainers create own units" on public.attendance_sessions
  for insert to authenticated
  with check (public.is_trainer() and recorded_by = auth.uid() and exists (select 1 from public.learning_courses c where c.trainer_id = auth.uid() and c.unit_id = attendance_sessions.unit_id));
create policy "attendance sessions: trainers update own" on public.attendance_sessions
  for update to authenticated
  using (public.is_trainer() and recorded_by = auth.uid())
  with check (public.is_trainer() and recorded_by = auth.uid());
create policy "attendance records: trainers read own sessions" on public.attendance_records
  for select to authenticated
  using (public.is_trainer() and exists (select 1 from public.attendance_sessions s where s.id = attendance_records.session_id and s.recorded_by = auth.uid()));
create policy "attendance records: trainers create own sessions" on public.attendance_records
  for insert to authenticated
  with check (public.is_trainer() and exists (select 1 from public.attendance_sessions s where s.id = attendance_records.session_id and s.recorded_by = auth.uid()));

-- The timetable is scoped to the lecturer or the student's programme.
drop policy if exists "timetable: authenticated readers" on public.timetable_slots;
create policy "timetable: administrators read" on public.timetable_slots for select to authenticated using (public.is_administrator());
create policy "timetable: trainers read own" on public.timetable_slots for select to authenticated using (public.is_trainer() and trainer_id = auth.uid());
create policy "timetable: students read programme" on public.timetable_slots for select to authenticated using (
  programme_id in (select programme_id from public.students where profile_id = auth.uid())
);

-- Students have no finance workspace in this portal; finance stays an
-- administrator-only responsibility.
drop policy if exists "invoices: students read own" on public.invoices;
drop policy if exists "payments: students read own" on public.payments;

-- Published notices are directed to the correct audience.
drop policy if exists "announcements: authenticated read published" on public.announcements;
create policy "announcements: audience read published" on public.announcements
  for select to authenticated
  using (
    public.is_administrator()
    or (published and (
      audience = 'all'
      or (audience = 'students' and public.current_app_role() = 'student')
      or (audience = 'staff' and public.current_app_role() in ('administrator', 'trainer'))
    ))
  );
