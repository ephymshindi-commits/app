-- Manager demonstration data for TVET Connect.
-- Apply only to a new/demo environment. Safe to re-run: all records use
-- stable natural keys and upserts where the schema permits them.

-- Staff profiles correspond to Supabase Auth accounts created for the demo.
insert into public.profiles (id, full_name, email, role)
select id, 'School Administrator', email, 'administrator'::public.app_role
from auth.users where email = 'admin@tvetconnect.school'
on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, role = excluded.role;

insert into public.profiles (id, full_name, email, role)
select id, 'Amina Mwangi', email, 'trainer'::public.app_role
from auth.users where email = 'amina.mwangi@tvetconnect.school'
on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, role = excluded.role;

insert into public.profiles (id, full_name, email, role)
select id, 'Peter Otieno', email, 'trainer'::public.app_role
from auth.users where email = 'peter.otieno@tvetconnect.school'
on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, role = excluded.role;

insert into public.departments (name, code) values
  ('Information and Communication Technology', 'ICT'),
  ('Electrical and Electronic Engineering', 'EEE'),
  ('Building Technology', 'BT')
on conflict (code) do update set name = excluded.name;

insert into public.programmes (department_id, name, code, duration_years, active)
select d.id, v.name, v.code, v.duration_years, true
from (values
  ('ICT', 'Information Communication Technology', 'ICT-DIP', 3),
  ('EEE', 'Electrical Installation Technology', 'EIT-DIP', 3),
  ('BT', 'Building Technology', 'BT-DIP', 3)
) as v(department_code, name, code, duration_years)
join public.departments d on d.code = v.department_code
on conflict (code) do update set name = excluded.name, active = true;

insert into public.academic_years (name, starts_on, ends_on, active)
values ('2026/2027', '2026-01-05', '2026-12-18', true)
on conflict (name) do update set starts_on = excluded.starts_on, ends_on = excluded.ends_on, active = true;

insert into public.semesters (academic_year_id, name, starts_on, ends_on)
select ay.id, v.name, v.starts_on::date, v.ends_on::date
from (values
  ('Semester 1', '2026-01-05', '2026-05-01'),
  ('Semester 2', '2026-05-18', '2026-08-28')
) as v(name, starts_on, ends_on)
join public.academic_years ay on ay.name = '2026/2027'
on conflict (academic_year_id, name) do update set starts_on = excluded.starts_on, ends_on = excluded.ends_on;

insert into public.intakes (academic_year_id, name, starts_on, closes_on)
select id, 'January 2026', '2026-01-05', '2026-02-06'
from public.academic_years where name = '2026/2027'
on conflict (academic_year_id, name) do update set starts_on = excluded.starts_on, closes_on = excluded.closes_on;

insert into public.units (programme_id, code, name, year_of_study, semester_number, credit_hours)
select p.id, v.code, v.name, v.year_of_study, v.semester_number, v.credit_hours
from (values
  ('ICT-DIP', 'ICT 204', 'Computer Networks', 2, 1, 60.00),
  ('ICT-DIP', 'ICT 205', 'Database Systems', 2, 1, 60.00),
  ('EIT-DIP', 'EIT 210', 'Electrical Installation II', 2, 1, 75.00),
  ('BT-DIP', 'BT 101', 'Building Materials', 1, 1, 60.00)
) as v(programme_code, code, name, year_of_study, semester_number, credit_hours)
join public.programmes p on p.code = v.programme_code
on conflict (code) do update set name = excluded.name, credit_hours = excluded.credit_hours;

insert into public.staff_members (profile_id, employee_number, job_title, department_id, phone, employment_status)
select p.id, v.employee_number, v.job_title, d.id, v.phone, 'active'::public.staff_employment_status
from (values
  ('admin@tvetconnect.school', 'EMP/2026/001', 'School Administrator', 'ICT', '+254700000001'),
  ('amina.mwangi@tvetconnect.school', 'EMP/2026/002', 'ICT Trainer', 'ICT', '+254700000002'),
  ('peter.otieno@tvetconnect.school', 'EMP/2026/003', 'Electrical Trainer', 'EEE', '+254700000003')
) as v(email, employee_number, job_title, department_code, phone)
join public.profiles p on p.email = v.email
join public.departments d on d.code = v.department_code
on conflict (profile_id) do update set employee_number = excluded.employee_number, job_title = excluded.job_title,
  department_id = excluded.department_id, phone = excluded.phone, employment_status = excluded.employment_status;

insert into public.students (registration_number, first_name, last_name, phone, personal_email, programme_id, intake_id, status, admitted_at)
select v.registration_number, v.first_name, v.last_name, v.phone, v.email, p.id, i.id, 'active'::public.student_status, '2026-01-05'
from (values
  ('TVET/2026/001', 'Faith', 'Wanjiku', '+254711000001', 'faith.wanjiku@student.tvetconnect.school', 'ICT-DIP'),
  ('TVET/2026/002', 'Brian', 'Otieno', '+254711000002', 'brian.otieno@student.tvetconnect.school', 'ICT-DIP'),
  ('TVET/2026/003', 'Mercy', 'Achieng', '+254711000003', 'mercy.achieng@student.tvetconnect.school', 'EIT-DIP'),
  ('TVET/2026/004', 'David', 'Kiptoo', '+254711000004', 'david.kiptoo@student.tvetconnect.school', 'EIT-DIP'),
  ('TVET/2026/005', 'Sharon', 'Njeri', '+254711000005', 'sharon.njeri@student.tvetconnect.school', 'BT-DIP'),
  ('TVET/2026/006', 'Kevin', 'Maina', '+254711000006', 'kevin.maina@student.tvetconnect.school', 'BT-DIP')
) as v(registration_number, first_name, last_name, phone, email, programme_code)
join public.programmes p on p.code = v.programme_code
join public.intakes i on i.name = 'January 2026'
on conflict (registration_number) do update set first_name = excluded.first_name, last_name = excluded.last_name,
  phone = excluded.phone, personal_email = excluded.personal_email, programme_id = excluded.programme_id,
  intake_id = excluded.intake_id, status = excluded.status;

insert into public.enrollments (student_id, semester_id, programme_id, year_of_study)
select s.id, sem.id, s.programme_id, case when s.registration_number in ('TVET/2026/005', 'TVET/2026/006') then 1 else 2 end
from public.students s
join public.semesters sem on sem.name = 'Semester 1'
on conflict (student_id, semester_id) do update set programme_id = excluded.programme_id, year_of_study = excluded.year_of_study;

insert into public.fee_structures (programme_id, academic_year_id, year_of_study, amount)
select p.id, ay.id, 1, 45000 from public.programmes p cross join public.academic_years ay
where ay.name = '2026/2027'
on conflict (programme_id, academic_year_id, year_of_study) do update set amount = excluded.amount;

insert into public.invoices (student_id, invoice_number, amount, due_on, status, issued_at)
select s.id, v.invoice_number, v.amount, '2026-02-15', 'issued'::public.invoice_status, now()
from (values
  ('TVET/2026/001', 'INV-2026-001', 45000.00),
  ('TVET/2026/002', 'INV-2026-002', 45000.00),
  ('TVET/2026/003', 'INV-2026-003', 50000.00),
  ('TVET/2026/004', 'INV-2026-004', 50000.00),
  ('TVET/2026/005', 'INV-2026-005', 40000.00),
  ('TVET/2026/006', 'INV-2026-006', 40000.00)
) as v(registration_number, invoice_number, amount)
join public.students s on s.registration_number = v.registration_number
on conflict (invoice_number) do update set amount = excluded.amount, due_on = excluded.due_on;

insert into public.payments (student_id, invoice_id, receipt_number, amount, method, reference, recorded_by)
select s.id, i.id, v.receipt_number, v.amount, 'M-PESA', v.reference, admin.id
from (values
  ('TVET/2026/001', 'INV-2026-001', 'RCT-2026-001', 45000.00, 'QWE123ABC'),
  ('TVET/2026/002', 'INV-2026-002', 'RCT-2026-002', 25000.00, 'QWE124ABC'),
  ('TVET/2026/003', 'INV-2026-003', 'RCT-2026-003', 10000.00, 'QWE125ABC')
) as v(registration_number, invoice_number, receipt_number, amount, reference)
join public.students s on s.registration_number = v.registration_number
join public.invoices i on i.invoice_number = v.invoice_number
join public.profiles admin on admin.email = 'admin@tvetconnect.school'
on conflict (receipt_number) do nothing;

insert into public.learning_courses (unit_id, semester_id, trainer_id, title, description, visibility)
select u.id, sem.id, t.id, v.title, v.description, 'published'::public.course_visibility
from (values
  ('ICT 204', 'amina.mwangi@tvetconnect.school', 'ICT 204 · Computer Networks', 'Network infrastructure, configuration and practical troubleshooting.'),
  ('EIT 210', 'peter.otieno@tvetconnect.school', 'EIT 210 · Electrical Installation II', 'Workshop-based electrical installation and safety practice.'),
  ('BT 101', 'peter.otieno@tvetconnect.school', 'BT 101 · Building Materials', 'Materials selection, handling and construction practice.')
) as v(unit_code, trainer_email, title, description)
join public.units u on u.code = v.unit_code
join public.semesters sem on sem.name = 'Semester 1'
join public.profiles t on t.email = v.trainer_email
on conflict (unit_id, semester_id) do update set trainer_id = excluded.trainer_id, title = excluded.title,
  description = excluded.description, visibility = excluded.visibility;

insert into public.course_memberships (course_id, student_id)
select c.id, s.id
from public.learning_courses c
join public.units u on u.id = c.unit_id
join public.students s on (
  (u.code = 'ICT 204' and s.registration_number in ('TVET/2026/001', 'TVET/2026/002')) or
  (u.code = 'EIT 210' and s.registration_number in ('TVET/2026/003', 'TVET/2026/004')) or
  (u.code = 'BT 101' and s.registration_number in ('TVET/2026/005', 'TVET/2026/006'))
)
on conflict (course_id, student_id) do nothing;

insert into public.attendance_sessions (unit_id, semester_id, held_at, recorded_by)
select u.id, sem.id, v.held_at::timestamptz, admin.id
from (values
  ('ICT 204', '2026-02-02 09:00:00+03'), ('ICT 204', '2026-02-09 09:00:00+03'),
  ('EIT 210', '2026-02-03 11:00:00+03'), ('EIT 210', '2026-02-10 11:00:00+03'),
  ('BT 101', '2026-02-04 14:00:00+03'), ('BT 101', '2026-02-11 14:00:00+03')
) as v(unit_code, held_at)
join public.units u on u.code = v.unit_code
join public.semesters sem on sem.name = 'Semester 1'
join public.profiles admin on admin.email = 'admin@tvetconnect.school'
where not exists (select 1 from public.attendance_sessions x where x.unit_id = u.id and x.held_at = v.held_at::timestamptz);

insert into public.attendance_records (session_id, student_id, status)
select ses.id, s.id,
  case
    when s.registration_number = 'TVET/2026/003' then 'absent'::public.attendance_status
    when s.registration_number = 'TVET/2026/004' and ses.held_at::date = '2026-02-10' then 'absent'::public.attendance_status
    else 'present'::public.attendance_status
  end
from public.attendance_sessions ses
join public.units u on u.id = ses.unit_id
join public.students s on (
  (u.code = 'ICT 204' and s.registration_number in ('TVET/2026/001', 'TVET/2026/002')) or
  (u.code = 'EIT 210' and s.registration_number in ('TVET/2026/003', 'TVET/2026/004')) or
  (u.code = 'BT 101' and s.registration_number in ('TVET/2026/005', 'TVET/2026/006'))
)
on conflict (session_id, student_id) do update set status = excluded.status;

insert into public.unit_results (student_id, unit_id, semester_id, cat_score, exam_score, grade, status, entered_by)
select s.id, u.id, sem.id, v.cat_score, v.exam_score, v.grade, 'draft'::public.result_status, trainer.id
from (values
  ('TVET/2026/001', 'ICT 204', 'amina.mwangi@tvetconnect.school', 28.00, 55.00, 'A'),
  ('TVET/2026/002', 'ICT 204', 'amina.mwangi@tvetconnect.school', 23.00, 46.00, 'B'),
  ('TVET/2026/003', 'EIT 210', 'peter.otieno@tvetconnect.school', 18.00, 32.00, 'C'),
  ('TVET/2026/004', 'EIT 210', 'peter.otieno@tvetconnect.school', 16.00, 28.00, 'D')
) as v(registration_number, unit_code, trainer_email, cat_score, exam_score, grade)
join public.students s on s.registration_number = v.registration_number
join public.units u on u.code = v.unit_code
join public.semesters sem on sem.name = 'Semester 1'
join public.profiles trainer on trainer.email = v.trainer_email
on conflict (student_id, unit_id, semester_id) do update set cat_score = excluded.cat_score, exam_score = excluded.exam_score,
  grade = excluded.grade, entered_by = excluded.entered_by;

update public.unit_results set status = 'submitted'::public.result_status
where status = 'draft' and student_id in (
  select id from public.students where registration_number in ('TVET/2026/001', 'TVET/2026/003')
);
