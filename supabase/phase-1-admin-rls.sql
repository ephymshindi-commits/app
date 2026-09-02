

drop policy if exists "profiles: users update self" on public.profiles;

create policy "profiles: administrators manage" on public.profiles
for all to authenticated
using (public.is_administrator())
with check (public.is_administrator());

create policy "students: administrators manage" on public.students
for all to authenticated
using (public.is_administrator())
with check (public.is_administrator());

create policy "students: students read own" on public.students
for select to authenticated
using (profile_id = auth.uid());

create policy "enrollments: administrators manage" on public.enrollments
for all to authenticated
using (public.is_administrator())
with check (public.is_administrator());

create policy "enrollments: students read own" on public.enrollments
for select to authenticated
using (student_id = public.my_student_id());

create policy "invoices: administrators manage" on public.invoices
for all to authenticated
using (public.is_administrator())
with check (public.is_administrator());

create policy "invoices: students read own" on public.invoices
for select to authenticated
using (student_id = public.my_student_id());

create policy "payments: administrators manage" on public.payments
for all to authenticated
using (public.is_administrator())
with check (public.is_administrator());

create policy "payments: students read own" on public.payments
for select to authenticated
using (student_id = public.my_student_id());

create policy "attendance records: administrators manage" on public.attendance_records
for all to authenticated
using (public.is_administrator())
with check (public.is_administrator());

create policy "attendance records: students read own" on public.attendance_records
for select to authenticated
using (student_id = public.my_student_id());
