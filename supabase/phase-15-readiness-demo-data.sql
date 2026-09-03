insert into public.students (
  first_name, last_name, personal_email, phone, programme_id, status, admitted_at
)
select
  item.first_name,
  item.last_name,
  item.email,
  item.phone,
  programme.id,
  'active'::public.student_status,
  current_date
from (
  values
    ('Miriam', 'Kiptoo', 'demo.student01@example.test', '+254700100101', 'ICT-DIP'),
    ('Daniel', 'Otieno', 'demo.student02@example.test', '+254700100102', 'ICT-DIP'),
    ('Purity', 'Wambui', 'demo.student03@example.test', '+254700100103', 'ICT-DIP'),
    ('Brian', 'Mutua', 'demo.student04@example.test', '+254700100104', 'ICT-DIP'),
    ('Sharon', 'Chebet', 'demo.student05@example.test', '+254700100105', 'EIT-DIP'),
    ('Kevin', 'Maina', 'demo.student06@example.test', '+254700100106', 'EIT-DIP'),
    ('Faith', 'Njeri', 'demo.student07@example.test', '+254700100107', 'EIT-DIP'),
    ('Peter', 'Kamau', 'demo.student08@example.test', '+254700100108', 'BT-DIP'),
    ('Esther', 'Akinyi', 'demo.student09@example.test', '+254700100109', 'BT-DIP'),
    ('Samuel', 'Kiprono', 'demo.student10@example.test', '+254700100110', 'BT-DIP')
) as item(first_name, last_name, email, phone, programme_code)
join public.programmes programme on programme.code = item.programme_code
where not exists (
  select 1 from public.students student where student.personal_email = item.email
);

insert into public.units (
  programme_id, code, name, year_of_study, semester_number, credit_hours
)
select programme.id, item.code, item.name, 1, 1, 45
from (
  values
    ('BT-DIP', 'BT 102', 'Building Construction I'),
    ('EIT-DIP', 'EIT 211', 'Electrical Safety and Regulations')
) as item(programme_code, code, name)
join public.programmes programme on programme.code = item.programme_code
where not exists (select 1 from public.units unit where unit.code = item.code);

insert into public.learning_courses (
  unit_id, semester_id, trainer_id, title, description, visibility
)
select unit.id,
       semester.id,
       case when unit.code = 'BT 102' then electrical_trainer.profile_id else ict_trainer.profile_id end,
       format('%s · %s', unit.code, unit.name),
       'Readiness demonstration course space.',
       'published'::public.course_visibility
from public.units unit
join public.semesters semester on semester.name = 'Semester 1'
cross join lateral (
  select staff.profile_id from public.staff_members staff
  where staff.job_title = 'ICT Trainer' limit 1
) as ict_trainer
cross join lateral (
  select staff.profile_id from public.staff_members staff
  where staff.job_title = 'Electrical Trainer' limit 1
) as electrical_trainer
where unit.code in ('ICT 205', 'BT 102')
  and not exists (
    select 1 from public.learning_courses course
    where course.unit_id = unit.id and course.semester_id = semester.id
  );

insert into public.course_memberships (course_id, student_id)
select course.id, student.id
from public.learning_courses course
join public.units unit on unit.id = course.unit_id
join public.students student on student.programme_id = unit.programme_id
where student.personal_email in (
  'demo.student01@example.test',
  'demo.student02@example.test',
  'demo.student05@example.test',
  'demo.student06@example.test',
  'demo.student08@example.test',
  'demo.student09@example.test'
)
  and not exists (
    select 1 from public.course_memberships membership
    where membership.course_id = course.id and membership.student_id = student.id
  );

insert into public.assignments (
  course_id, title, instructions, due_at, max_score, status, created_by
)
select course.id,
       format('Readiness assignment: %s', course.title),
       'Complete the guided revision activity and submit your work before the due date.',
       now() + interval '14 days',
       30,
       'published'::public.assignment_status,
       admin_profile.id
from public.learning_courses course
cross join lateral (
  select profile.id from public.profiles profile
  where profile.role = 'administrator' limit 1
) as admin_profile
where not exists (
  select 1 from public.assignments assignment
  where assignment.course_id = course.id
    and assignment.title = format('Readiness assignment: %s', course.title)
);

insert into public.course_materials (
  course_id, title, description, material_type, external_url, published, published_at, created_by
)
select course.id,
       format('Study guide: %s', course.title),
       'A demonstration learning resource for this course space.',
       'link',
       'https://www.khanacademy.org/',
       true,
       now(),
       admin_profile.id
from public.learning_courses course
cross join lateral (
  select profile.id from public.profiles profile
  where profile.role = 'administrator' limit 1
) as admin_profile
where not exists (
  select 1 from public.course_materials material
  where material.course_id = course.id
    and material.title = format('Study guide: %s', course.title)
);

insert into public.virtual_sessions (
  course_id, title, starts_at, ends_at, meeting_url, created_by
)
select course.id,
       format('Revision class: %s', course.title),
       now() + (row_number() over (order by course.title) * interval '2 days'),
       now() + (row_number() over (order by course.title) * interval '2 days') + interval '90 minutes',
       format('agora://readiness-%s', replace(course.id::text, '-', '')),
       course.trainer_id
from public.learning_courses course
where not exists (
  select 1 from public.virtual_sessions session
  where session.course_id = course.id
    and session.title = format('Revision class: %s', course.title)
);

insert into public.online_assessments (
  course_id, title, instructions, kind, opens_at, closes_at, duration_minutes,
  attempt_limit, published, created_by
)
select course.id,
       format('Readiness CAT: %s', course.title),
       'Demonstration online assessment. Read each question carefully before submitting.',
       'cat'::public.assessment_kind,
       now() - interval '1 day',
       now() + interval '21 days',
       45,
       1,
       true,
       course.trainer_id
from public.learning_courses course
where not exists (
  select 1 from public.online_assessments assessment
  where assessment.course_id = course.id
    and assessment.title = format('Readiness CAT: %s', course.title)
);

insert into public.question_banks (unit_id, title, description, owner_id)
select unit.id,
       format('Readiness questions: %s', unit.code),
       'Demonstration assessment question bank.',
       course.trainer_id
from public.learning_courses course
join public.units unit on unit.id = course.unit_id
where not exists (
  select 1 from public.question_banks bank
  where bank.unit_id = unit.id and bank.title = format('Readiness questions: %s', unit.code)
);

insert into public.questions (question_bank_id, prompt, kind, marks, explanation)
select bank.id,
       format('Readiness question for %s: identify one core concept covered in this unit.', unit.code),
       'short_answer'::public.question_kind,
       5,
       'Use the course study guide when revising.'
from public.question_banks bank
join public.units unit on unit.id = bank.unit_id
where bank.title = format('Readiness questions: %s', unit.code)
  and not exists (
    select 1 from public.questions question
    where question.question_bank_id = bank.id
  );

insert into public.timetable_slots (
  unit_id, semester_id, trainer_id, programme_id, day_of_week, starts_at,
  ends_at, room_name, delivery_mode
)
select unit.id,
       semester.id,
       case when unit.code like 'ICT%' then ict_trainer.profile_id else electrical_trainer.profile_id end,
       unit.programme_id,
       item.day_of_week,
       item.starts_at::time,
       item.ends_at::time,
       item.room_name,
       item.delivery_mode
from (
  values
    ('ICT 204', 1, '08:00', '10:00', 'Computer Lab 1', 'in_person'),
    ('ICT 205', 2, '10:30', '12:30', 'Computer Lab 1', 'in_person'),
    ('EIT 210', 3, '08:00', '10:00', 'Workshop A', 'in_person'),
    ('EIT 211', 4, '10:30', '12:30', 'Workshop A', 'hybrid'),
    ('BT 101', 5, '08:00', '10:00', 'Workshop B', 'in_person')
) as item(unit_code, day_of_week, starts_at, ends_at, room_name, delivery_mode)
join public.units unit on unit.code = item.unit_code
join public.semesters semester on semester.name = 'Semester 1'
cross join lateral (
  select staff.profile_id from public.staff_members staff
  where staff.job_title = 'ICT Trainer' limit 1
) as ict_trainer
cross join lateral (
  select staff.profile_id from public.staff_members staff
  where staff.job_title = 'Electrical Trainer' limit 1
) as electrical_trainer
where not exists (
  select 1 from public.timetable_slots slot
  where slot.unit_id = unit.id and slot.semester_id = semester.id
);

insert into public.inventory_suppliers (name, contact_person, phone, email, address)
select item.name, item.contact_person, item.phone, item.email, item.address
from (
  values
    ('Readiness ICT Supplies', 'James Kariuki', '+254700200001', 'ict-supplies@example.test', 'Nairobi'),
    ('Readiness Furniture Supplies', 'Mary Wanjiru', '+254700200002', 'furniture@example.test', 'Nairobi'),
    ('Readiness Workshop Tools', 'Paul Mutiso', '+254700200003', 'tools@example.test', 'Nairobi'),
    ('Readiness Library Supplies', 'Irene Akinyi', '+254700200004', 'library@example.test', 'Nairobi'),
    ('Readiness Office Supplies', 'David Cheruiyot', '+254700200005', 'office@example.test', 'Nairobi')
) as item(name, contact_person, phone, email, address)
where not exists (
  select 1 from public.inventory_suppliers supplier where supplier.name = item.name
);

insert into public.inventory_items (
  asset_code, name, category_id, supplier_id, description, unit_of_measure,
  reorder_level, unit_cost, item_condition, operational_status, location,
  acquired_on, purchase_reference, created_by
)
select item.asset_code,
       item.name,
       category.id,
       supplier.id,
       item.description,
       'each',
       item.reorder_level,
       item.unit_cost,
       'new',
       'active',
       item.location,
       current_date,
       format('DEMO-SUP-%s', item.asset_code),
       admin_profile.id
from (
  values
    ('DEMO-LAP-001', 'Training laptop', 'ICT equipment', 'Readiness ICT Supplies', 'Demonstration training laptop.', 2, 65000, 'ICT Lab'),
    ('DEMO-DESK-001', 'Student desk', 'Furniture', 'Readiness Furniture Supplies', 'Demonstration student desk.', 5, 8500, 'Room 2'),
    ('DEMO-TOOL-001', 'Electrical tool kit', 'Teaching equipment', 'Readiness Workshop Tools', 'Demonstration electrical tool kit.', 2, 12000, 'Workshop A'),
    ('DEMO-BOOK-001', 'Technical reference book', 'Library resources', 'Readiness Library Supplies', 'Demonstration library reference.', 3, 2500, 'Library'),
    ('DEMO-STAT-001', 'Stationery pack', 'Office supplies', 'Readiness Office Supplies', 'Demonstration stationery pack.', 10, 650, 'Administration')
) as item(asset_code, name, category_name, supplier_name, description, reorder_level, unit_cost, location)
join public.inventory_categories category on category.name = item.category_name
join public.inventory_suppliers supplier on supplier.name = item.supplier_name
cross join lateral (
  select profile.id from public.profiles profile
  where profile.role = 'administrator' limit 1
) as admin_profile
where not exists (
  select 1 from public.inventory_items inventory where inventory.asset_code = item.asset_code
);

insert into public.inventory_movements (
  item_id, supplier_id, movement_type, quantity_change, unit_cost,
  delivery_reference, notes, recorded_by
)
select inventory.id,
       inventory.supplier_id,
       'opening_balance',
       item.quantity,
       inventory.unit_cost,
       format('DEMO-OPEN-%s', inventory.asset_code),
       'Readiness demonstration opening balance.',
       admin_profile.id
from (
  values
    ('DEMO-LAP-001', 8),
    ('DEMO-DESK-001', 30),
    ('DEMO-TOOL-001', 12),
    ('DEMO-BOOK-001', 25),
    ('DEMO-STAT-001', 100)
) as item(asset_code, quantity)
join public.inventory_items inventory on inventory.asset_code = item.asset_code
cross join lateral (
  select profile.id from public.profiles profile
  where profile.role = 'administrator' limit 1
) as admin_profile
where not exists (
  select 1 from public.inventory_movements movement
  where movement.item_id = inventory.id
    and movement.delivery_reference = format('DEMO-OPEN-%s', inventory.asset_code)
);

insert into public.library_resources (
  title, author, resource_type, subject, external_url, access_level, created_by
)
select item.title,
       item.author,
       item.resource_type,
       item.subject,
       item.url,
       'institution',
       admin_profile.id
from (
  values
    ('Computer networking fundamentals', 'Open educational resource', 'book', 'ICT', 'https://www.khanacademy.org/computing'),
    ('Electrical safety guide', 'Open educational resource', 'repository', 'Electrical Installation', 'https://www.osha.gov/electrical'),
    ('Building materials introduction', 'Open educational resource', 'video', 'Building Technology', 'https://www.youtube.com/'),
    ('Digital research skills', 'Open educational resource', 'link', 'Study Skills', 'https://www.open.edu/openlearn/'),
    ('Technical writing reference', 'Open educational resource', 'journal', 'Communication Skills', 'https://owl.purdue.edu/')
) as item(title, author, resource_type, subject, url)
cross join lateral (
  select profile.id from public.profiles profile
  where profile.role = 'administrator' limit 1
) as admin_profile
where not exists (
  select 1 from public.library_resources resource where resource.title = item.title
);

insert into public.announcements (
  title, message, audience, published, published_at, created_by
)
select item.title,
       item.message,
       item.audience,
       true,
       now(),
       admin_profile.id
from (
  values
    ('Welcome to the new academic term', 'Please review your timetable and course spaces before classes begin.', 'all'),
    ('Library resources available', 'Five new digital learning resources are available in the digital library.', 'students'),
    ('Staff academic briefing', 'Trainers should review their assigned courses, attendance and assessment windows.', 'staff'),
    ('Finance office notice', 'Students should retain every receipt after making a school payment.', 'students'),
    ('Campus safety reminder', 'Follow workshop safety procedures and report damaged equipment to the office.', 'all')
) as item(title, message, audience)
cross join lateral (
  select profile.id from public.profiles profile
  where profile.role = 'administrator' limit 1
) as admin_profile
where not exists (
  select 1 from public.announcements announcement where announcement.title = item.title
);

insert into public.student_risk_alerts (student_id, course_id, level, reason, source_metric)
select student.id,
       course.id,
       item.level::public.risk_level,
       item.reason,
       item.source_metric
from (
  values
    ('demo.student01@example.test', 'watch', 'Attendance follow-up demonstration.', 'attendance'),
    ('demo.student02@example.test', 'high', 'Assessment completion follow-up demonstration.', 'assessment'),
    ('demo.student05@example.test', 'watch', 'Course engagement follow-up demonstration.', 'engagement'),
    ('demo.student08@example.test', 'critical', 'Fee-support follow-up demonstration.', 'finance'),
    ('demo.student09@example.test', 'watch', 'Academic support follow-up demonstration.', 'results')
) as item(email, level, reason, source_metric)
join public.students student on student.personal_email = item.email
left join public.learning_courses course on course.id = (
  select membership.course_id from public.course_memberships membership
  where membership.student_id = student.id limit 1
)
where not exists (
  select 1 from public.student_risk_alerts alert where alert.reason = item.reason
);

insert into public.unit_results (
  student_id, unit_id, semester_id, cat_score, exam_score, grade, status, entered_by
)
select student.id,
       unit.id,
       semester.id,
       item.cat_score,
       item.exam_score,
       item.grade,
       'draft'::public.result_status,
       admin_profile.id
from (
  values
    ('demo.student01@example.test', 'ICT 205', 25, 58, 'A'),
    ('demo.student02@example.test', 'ICT 204', 21, 51, 'B'),
    ('demo.student05@example.test', 'EIT 211', 23, 55, 'A'),
    ('demo.student06@example.test', 'EIT 210', 18, 48, 'B'),
    ('demo.student08@example.test', 'BT 101', 20, 50, 'B')
) as item(email, unit_code, cat_score, exam_score, grade)
join public.students student on student.personal_email = item.email
join public.units unit on unit.code = item.unit_code
join public.semesters semester on semester.name = 'Semester 1'
cross join lateral (
  select profile.id from public.profiles profile
  where profile.role = 'administrator' limit 1
) as admin_profile
where not exists (
  select 1 from public.unit_results result
  where result.student_id = student.id
    and result.unit_id = unit.id
    and result.semester_id = semester.id
);

insert into public.payments (
  student_id, invoice_id, receipt_number, amount, method, reference, recorded_by
)
select invoice.student_id,
       invoice.id,
       item.receipt_number,
       item.amount,
       'M-PESA',
       item.reference,
       admin_profile.id
from (
  values
    ('INV-2026-006', 'RCT-DEMO-2026-004', 10000, 'DEMO-MPESA-004'),
    ('INV-2026-004', 'RCT-DEMO-2026-005', 5000, 'DEMO-MPESA-005')
) as item(invoice_number, receipt_number, amount, reference)
join public.invoices invoice on invoice.invoice_number = item.invoice_number
cross join lateral (
  select profile.id from public.profiles profile
  where profile.role = 'administrator' limit 1
) as admin_profile
where not exists (
  select 1 from public.payments payment where payment.receipt_number = item.receipt_number
);
