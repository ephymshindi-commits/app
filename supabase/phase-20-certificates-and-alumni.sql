do $$ begin
  create type public.certificate_status as enum ('DRAFT', 'ACTIVE', 'REVOKED');
exception when duplicate_object then null;
end $$;

create table if not exists public.certificate_signatories (
  id uuid primary key default gen_random_uuid(),
  staff_name text not null,
  role_title text not null,
  signature_image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.graduation_approvals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.students(id) on delete restrict,
  approved boolean not null default false,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  programme_id uuid not null references public.programmes(id) on delete restrict,
  course_id uuid references public.learning_courses(id) on delete set null,
  certificate_hash text not null unique,
  qr_code_url text,
  status public.certificate_status not null default 'DRAFT',
  issued_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, programme_id),
  check ((status = 'ACTIVE') = (issued_at is not null)),
  check ((status = 'REVOKED') = (archived_at is not null))
);

create table if not exists public.certificate_units (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.certificates(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  unit_code text not null,
  unit_name text not null,
  credit_hours numeric(5,2) not null default 0,
  grade text,
  total_score numeric(5,2),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(certificate_id, unit_code)
);

create table if not exists public.alumni_registry (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.students(id) on delete restrict,
  programme_id uuid not null references public.programmes(id) on delete restrict,
  certificate_id uuid unique references public.certificates(id) on delete set null,
  cohort_label text,
  graduated_at timestamptz not null default now(),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists certificates_hash_idx on public.certificates(certificate_hash);
create index if not exists certificates_student_status_idx on public.certificates(student_id, status);
create index if not exists certificate_units_certificate_idx on public.certificate_units(certificate_id);
create index if not exists alumni_registry_programme_idx on public.alumni_registry(programme_id, graduated_at desc);

drop trigger if exists certificate_signatories_updated_at on public.certificate_signatories;
create trigger certificate_signatories_updated_at before update on public.certificate_signatories
  for each row execute function public.set_updated_at();
drop trigger if exists graduation_approvals_updated_at on public.graduation_approvals;
create trigger graduation_approvals_updated_at before update on public.graduation_approvals
  for each row execute function public.set_updated_at();
drop trigger if exists certificates_updated_at on public.certificates;
create trigger certificates_updated_at before update on public.certificates
  for each row execute function public.set_updated_at();
drop trigger if exists alumni_registry_updated_at on public.alumni_registry;
create trigger alumni_registry_updated_at before update on public.alumni_registry
  for each row execute function public.set_updated_at();

alter table public.certificate_signatories enable row level security;
alter table public.graduation_approvals enable row level security;
alter table public.certificates enable row level security;
alter table public.certificate_units enable row level security;
alter table public.alumni_registry enable row level security;

create policy "certificate signatories: administrators manage" on public.certificate_signatories
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "graduation approvals: administrators manage" on public.graduation_approvals
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "certificates: administrators manage" on public.certificates
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "certificates: students read own active" on public.certificates
  for select to authenticated using (student_id = public.my_student_id() and status = 'ACTIVE');
create policy "certificate units: administrators manage" on public.certificate_units
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "certificate units: students read own active" on public.certificate_units
  for select to authenticated using (exists (
    select 1 from public.certificates certificate
    where certificate.id = certificate_units.certificate_id
      and certificate.student_id = public.my_student_id()
      and certificate.status = 'ACTIVE'
  ));
create policy "alumni: administrators manage" on public.alumni_registry
  for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "alumni: students read own" on public.alumni_registry
  for select to authenticated using (student_id = public.my_student_id());

create or replace function public.certificate_eligibility(target_student_id uuid)
returns table (
  student_id uuid,
  programme_id uuid,
  academic_complete boolean,
  finance_cleared boolean,
  graduation_approved boolean,
  eligible boolean,
  total_units bigint,
  passed_units bigint,
  fee_balance numeric,
  reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_administrator() then
    raise exception 'Only administrators can view certificate eligibility';
  end if;
  return query
  with details as (
    select student.id as student_id, student.programme_id,
      (select count(*) from public.units unit where unit.programme_id = student.programme_id)::bigint as total_units,
      (select count(*) from public.unit_results result
        join public.units unit on unit.id = result.unit_id
        where result.student_id = student.id
          and unit.programme_id = student.programme_id
          and result.status = 'released'
          and result.grade is not null
          and not exists (
            select 1 from public.grading_scales scale
            join public.grading_bands band on band.grading_scale_id = scale.id
            where (scale.programme_id = student.programme_id or scale.programme_id is null)
              and lower(band.grade) = lower(result.grade)
              and not band.is_pass
          )
      )::bigint as passed_units,
      coalesce((select structure.amount from public.fee_structures structure
        join public.academic_years year on year.id = structure.academic_year_id
        where structure.programme_id = student.programme_id and structure.year_of_study = student.year_of_study and year.active
        order by year.starts_on desc limit 1), 0)::numeric
      - coalesce((select sum(payment.amount) from public.payments payment where payment.student_id = student.id), 0)::numeric as fee_balance,
      coalesce((select approval.approved from public.graduation_approvals approval where approval.student_id = student.id), false) as graduation_approved
    from public.students student where student.id = target_student_id
  )
  select details.student_id, details.programme_id,
    details.total_units > 0 and details.passed_units = details.total_units,
    details.fee_balance = 0,
    details.graduation_approved,
    details.total_units > 0 and details.passed_units = details.total_units and details.fee_balance = 0 and details.graduation_approved,
    details.total_units, details.passed_units, details.fee_balance,
    case
      when details.total_units = 0 then 'No programme units have been configured.'
      when details.passed_units <> details.total_units then format('%s of %s programme units are released and passed.', details.passed_units, details.total_units)
      when details.fee_balance <> 0 then format('Fee balance must be exactly zero (current balance: %s).', details.fee_balance)
      when not details.graduation_approved then 'Graduation approval is required.'
      else 'Eligible for certificate issue.'
    end
  from details;
end;
$$;

create or replace function public.set_graduation_approval(target_student_id uuid, approved_value boolean, approval_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_administrator() then raise exception 'Only administrators can record graduation approval'; end if;
  insert into public.graduation_approvals (student_id, approved, approved_by, approved_at, note)
  values (target_student_id, approved_value, auth.uid(), case when approved_value then now() else null end, nullif(trim(approval_note), ''))
  on conflict (student_id) do update set approved = excluded.approved, approved_by = excluded.approved_by,
    approved_at = excluded.approved_at, note = excluded.note;
end;
$$;

create or replace function public.issue_eligible_certificate(target_student_id uuid)
returns table (certificate_id uuid, certificate_hash text, status public.certificate_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  eligibility record;
  certificate public.certificates;
  student public.students;
  graduation_year text;
begin
  if not public.is_administrator() then raise exception 'Only administrators can issue certificates'; end if;
  select * into eligibility from public.certificate_eligibility(target_student_id);
  if eligibility.student_id is null then raise exception 'Student record was not found'; end if;
  if not eligibility.eligible then raise exception 'Certificate cannot be issued: %', eligibility.reason; end if;
  select * into student from public.students where id = target_student_id;
  insert into public.certificates (student_id, programme_id, certificate_hash, status, issued_at, created_by)
  values (student.id, student.programme_id, encode(digest(gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex'), 'ACTIVE', now(), auth.uid())
  on conflict (student_id, programme_id) do update set status = 'ACTIVE', issued_at = coalesce(certificates.issued_at, now()), archived_at = null, created_by = auth.uid()
  returning * into certificate;
  update public.certificates set qr_code_url = format('/api/verify-certificate/%s', certificate.certificate_hash) where id = certificate.id;
  delete from public.certificate_units where certificate_id = certificate.id;
  insert into public.certificate_units (certificate_id, unit_id, unit_code, unit_name, credit_hours, grade, total_score, completed_at)
  select certificate.id, unit.id, unit.code, unit.name, unit.credit_hours, result.grade, result.total_score, result.released_at
  from public.units unit
  join public.unit_results result on result.unit_id = unit.id and result.student_id = student.id and result.status = 'released'
  where unit.programme_id = student.programme_id;
  graduation_year := extract(year from current_date)::text;
  insert into public.alumni_registry (student_id, programme_id, certificate_id, cohort_label, graduated_at)
  values (student.id, student.programme_id, certificate.id, graduation_year, certificate.issued_at)
  on conflict (student_id) do update set certificate_id = excluded.certificate_id, programme_id = excluded.programme_id,
    cohort_label = excluded.cohort_label, graduated_at = excluded.graduated_at, archived_at = null;
  update public.students set status = 'graduated' where id = student.id and status <> 'archived';
  return query select certificate.id, certificate.certificate_hash, certificate.status;
end;
$$;

create or replace function public.set_certificate_status(target_certificate_id uuid, target_status public.certificate_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare certificate public.certificates; eligibility record;
begin
  if not public.is_administrator() then raise exception 'Only administrators can change certificate status'; end if;
  select * into certificate from public.certificates where id = target_certificate_id;
  if certificate.id is null then raise exception 'Certificate was not found'; end if;
  if target_status = 'ACTIVE' then
    select * into eligibility from public.certificate_eligibility(certificate.student_id);
    if not eligibility.eligible then raise exception 'Certificate cannot be activated: %', eligibility.reason; end if;
  end if;
  update public.certificates set status = target_status,
    issued_at = case when target_status = 'ACTIVE' then coalesce(issued_at, now()) else issued_at end,
    archived_at = case when target_status = 'REVOKED' then now() else null end
  where id = target_certificate_id;
end;
$$;

create or replace function public.my_certificate_eligibility()
returns table (academic_complete boolean, finance_cleared boolean, graduation_approved boolean, eligible boolean, total_units bigint, passed_units bigint, fee_balance numeric, reason text)
language plpgsql
stable security definer set search_path = public
as $$
declare details record;
begin
  if public.current_app_role() <> 'student' then raise exception 'Only students can view certificate eligibility'; end if;
  select * into details from public.students where profile_id = auth.uid();
  if details.id is null then return; end if;
  return query
  with unit_summary as (
    select (select count(*) from public.units where programme_id = details.programme_id)::bigint as total_units,
      (select count(*) from public.unit_results result join public.units unit on unit.id = result.unit_id
       where result.student_id = details.id and unit.programme_id = details.programme_id and result.status = 'released' and result.grade is not null
       and not exists (select 1 from public.grading_scales scale join public.grading_bands band on band.grading_scale_id = scale.id where (scale.programme_id = details.programme_id or scale.programme_id is null) and lower(band.grade) = lower(result.grade) and not band.is_pass)
      )::bigint as passed_units,
      coalesce((select structure.amount from public.fee_structures structure join public.academic_years year on year.id = structure.academic_year_id where structure.programme_id = details.programme_id and structure.year_of_study = details.year_of_study and year.active order by year.starts_on desc limit 1), 0)::numeric - coalesce((select sum(amount) from public.payments where student_id = details.id), 0)::numeric as fee_balance,
      coalesce((select approved from public.graduation_approvals where student_id = details.id), false) as approved
  ) select total_units > 0 and total_units = passed_units, fee_balance = 0, approved, total_units > 0 and total_units = passed_units and fee_balance = 0 and approved, total_units, passed_units, fee_balance,
    case when total_units = 0 then 'No programme units have been configured.' when passed_units <> total_units then format('%s of %s programme units are released and passed.', passed_units, total_units) when fee_balance <> 0 then format('Fee balance must be exactly zero (current balance: %s).', fee_balance) when not approved then 'Graduation approval is required.' else 'Eligible for certificate issue.' end
  from unit_summary;
end;
$$;

create or replace function public.my_certificates()
returns table (certificate_id uuid, certificate_hash text, status public.certificate_status, issued_at timestamptz, programme_name text, programme_code text)
language plpgsql
stable security definer set search_path = public
as $$
begin
  if public.current_app_role() <> 'student' then raise exception 'Only students can view certificates'; end if;
  return query select certificate.id, certificate.certificate_hash, certificate.status, certificate.issued_at, programme.name, programme.code
    from public.certificates certificate join public.programmes programme on programme.id = certificate.programme_id
    where certificate.student_id = public.my_student_id() and certificate.status = 'ACTIVE' order by certificate.issued_at desc;
end;
$$;

create or replace function public.certificate_detail_for_view(target_certificate_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare payload jsonb;
begin
  if not public.is_administrator() and not exists (select 1 from public.certificates where id = target_certificate_id and student_id = public.my_student_id() and status = 'ACTIVE') then raise exception 'Certificate not available'; end if;
  select jsonb_build_object(
    'certificateId', certificate.id, 'certificateHash', certificate.certificate_hash, 'status', certificate.status, 'issuedAt', certificate.issued_at,
    'studentName', trim(student.first_name || ' ' || student.last_name), 'registrationNumber', student.registration_number,
    'programmeName', programme.name, 'programmeCode', programme.code,
    'verificationUrl', coalesce(certificate.qr_code_url, format('/api/verify-certificate/%s', certificate.certificate_hash)),
    'units', coalesce((select jsonb_agg(jsonb_build_object('code', unit.unit_code, 'name', unit.unit_name, 'creditHours', unit.credit_hours, 'grade', unit.grade, 'score', unit.total_score) order by unit.unit_code) from public.certificate_units unit where unit.certificate_id = certificate.id), '[]'::jsonb),
    'signatories', coalesce((select jsonb_agg(jsonb_build_object('name', signatory.staff_name, 'title', signatory.role_title, 'signatureUrl', signatory.signature_image_url) order by signatory.role_title) from public.certificate_signatories signatory where signatory.is_active), '[]'::jsonb)
  ) into payload
  from public.certificates certificate join public.students student on student.id = certificate.student_id join public.programmes programme on programme.id = certificate.programme_id
  where certificate.id = target_certificate_id;
  return payload;
end;
$$;

create or replace function public.public_verify_certificate(target_hash text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare payload jsonb;
begin
  select jsonb_build_object(
    'valid', true, 'certificateHash', certificate.certificate_hash, 'status', certificate.status, 'issuedAt', certificate.issued_at,
    'studentName', trim(student.first_name || ' ' || student.last_name), 'registrationNumber', student.registration_number,
    'programmeName', programme.name, 'programmeCode', programme.code,
    'units', coalesce((select jsonb_agg(jsonb_build_object('code', unit.unit_code, 'name', unit.unit_name, 'creditHours', unit.credit_hours, 'grade', unit.grade) order by unit.unit_code) from public.certificate_units unit where unit.certificate_id = certificate.id), '[]'::jsonb)
  ) into payload
  from public.certificates certificate join public.students student on student.id = certificate.student_id join public.programmes programme on programme.id = certificate.programme_id
  where certificate.certificate_hash = target_hash and certificate.status = 'ACTIVE';
  return coalesce(payload, jsonb_build_object('valid', false, 'status', 'NOT_FOUND'));
end;
$$;

revoke all on function public.certificate_eligibility(uuid) from public;
revoke all on function public.set_graduation_approval(uuid, boolean, text) from public;
revoke all on function public.issue_eligible_certificate(uuid) from public;
revoke all on function public.set_certificate_status(uuid, public.certificate_status) from public;
revoke all on function public.my_certificate_eligibility() from public;
revoke all on function public.my_certificates() from public;
revoke all on function public.certificate_detail_for_view(uuid) from public;
revoke all on function public.public_verify_certificate(text) from public;
grant execute on function public.certificate_eligibility(uuid) to authenticated;
grant execute on function public.set_graduation_approval(uuid, boolean, text) to authenticated;
grant execute on function public.issue_eligible_certificate(uuid) to authenticated;
grant execute on function public.set_certificate_status(uuid, public.certificate_status) to authenticated;
grant execute on function public.my_certificate_eligibility() to authenticated;
grant execute on function public.my_certificates() to authenticated;
grant execute on function public.certificate_detail_for_view(uuid) to authenticated;
grant execute on function public.public_verify_certificate(text) to anon, authenticated;
