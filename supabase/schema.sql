create extension if not exists "pgcrypto";

create type public.app_role as enum ('administrator', 'trainer', 'student');
create type public.student_status as enum ('active', 'deferred', 'withdrawn', 'graduated', 'archived');
create type public.invoice_status as enum ('draft', 'issued', 'part_paid', 'paid', 'void');
create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.app_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.departments (id uuid primary key default gen_random_uuid(), name text not null unique, code text not null unique, created_at timestamptz not null default now());
create table public.programmes (id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments(id) on delete restrict, name text not null, code text not null unique, duration_years smallint not null check (duration_years > 0), active boolean not null default true, unique(department_id,name));
create table public.academic_years (id uuid primary key default gen_random_uuid(), name text not null unique, starts_on date not null, ends_on date not null, active boolean not null default false, check(ends_on > starts_on));
create table public.semesters (id uuid primary key default gen_random_uuid(), academic_year_id uuid not null references public.academic_years(id) on delete restrict, name text not null, starts_on date not null, ends_on date not null, unique(academic_year_id,name), check(ends_on > starts_on));
create table public.units (id uuid primary key default gen_random_uuid(), programme_id uuid not null references public.programmes(id) on delete restrict, code text not null unique, name text not null, year_of_study smallint not null check(year_of_study > 0), semester_number smallint not null check(semester_number between 1 and 3), credit_hours numeric(5,2) not null default 0 check(credit_hours >= 0));
create table public.students (id uuid primary key default gen_random_uuid(), profile_id uuid unique references public.profiles(id) on delete set null, registration_number text unique, first_name text not null, last_name text not null, phone text, personal_email text, programme_id uuid not null references public.programmes(id) on delete restrict, status public.student_status not null default 'active', admitted_at date not null default current_date, archived_at timestamptz, created_at timestamptz not null default now(), check((status = 'archived') = (archived_at is not null)));
create table public.enrollments (id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete restrict, semester_id uuid not null references public.semesters(id) on delete restrict, programme_id uuid not null references public.programmes(id) on delete restrict, year_of_study smallint not null check(year_of_study > 0), enrolled_at timestamptz not null default now(), unique(student_id,semester_id));
create table public.fee_structures (id uuid primary key default gen_random_uuid(), programme_id uuid not null references public.programmes(id) on delete restrict, academic_year_id uuid not null references public.academic_years(id) on delete restrict, year_of_study smallint not null, amount numeric(12,2) not null check(amount >= 0), unique(programme_id,academic_year_id,year_of_study));
create table public.invoices (id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete restrict, invoice_number text not null unique, amount numeric(12,2) not null check(amount >= 0), due_on date, status public.invoice_status not null default 'draft', issued_at timestamptz, created_at timestamptz not null default now());
create table public.payments (id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete restrict, invoice_id uuid references public.invoices(id) on delete restrict, receipt_number text not null unique, amount numeric(12,2) not null check(amount > 0), method text not null, reference text, received_at timestamptz not null default now(), recorded_by uuid references public.profiles(id) on delete set null);
create table public.attendance_sessions (id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units(id) on delete restrict, semester_id uuid not null references public.semesters(id) on delete restrict, held_at timestamptz not null default now(), recorded_by uuid not null references public.profiles(id) on delete restrict);
create table public.attendance_records (id uuid primary key default gen_random_uuid(), session_id uuid not null references public.attendance_sessions(id) on delete cascade, student_id uuid not null references public.students(id) on delete restrict, status public.attendance_status not null, unique(session_id,student_id));
create table public.audit_logs (id bigint generated always as identity primary key, actor_id uuid references public.profiles(id) on delete set null, action text not null, entity_type text not null, entity_id uuid, old_data jsonb, new_data jsonb, created_at timestamptz not null default now());

create index students_registration_number_idx on public.students(registration_number);
create index students_programme_status_idx on public.students(programme_id,status);
create index invoices_student_status_idx on public.invoices(student_id,status);
create index payments_student_received_idx on public.payments(student_id,received_at desc);

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.attendance_records enable row level security;

create policy "profiles: users read self" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles: users update self" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
