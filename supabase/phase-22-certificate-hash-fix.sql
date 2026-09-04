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
  values (student.id, student.programme_id, encode(extensions.digest((gen_random_uuid()::text || clock_timestamp()::text)::bytea, 'sha256'), 'hex'), 'ACTIVE', now(), auth.uid())
  on conflict (student_id, programme_id) do update set status = 'ACTIVE', issued_at = coalesce(certificates.issued_at, now()), archived_at = null, created_by = auth.uid()
  returning * into certificate;
  update public.certificates set qr_code_url = format('/api/verify-certificate/%s', certificate.certificate_hash) where id = certificate.id;
  delete from public.certificate_units where public.certificate_units.certificate_id = certificate.id;
  insert into public.certificate_units (certificate_id, unit_id, unit_code, unit_name, credit_hours, grade, total_score, completed_at)
  select certificate.id, unit.id, unit.code, unit.name, unit.credit_hours, result.grade, result.total_score, result.released_at
  from public.units unit join public.unit_results result on result.unit_id = unit.id and result.student_id = student.id and result.status = 'released'
  where unit.programme_id = student.programme_id;
  graduation_year := extract(year from current_date)::text;
  insert into public.alumni_registry (student_id, programme_id, certificate_id, cohort_label, graduated_at)
  values (student.id, student.programme_id, certificate.id, graduation_year, certificate.issued_at)
  on conflict (student_id) do update set certificate_id = excluded.certificate_id, programme_id = excluded.programme_id,
    cohort_label = excluded.cohort_label, graduated_at = excluded.graduated_at, archived_at = null;
  update public.students set status = 'graduated' where id = student.id and public.students.status <> 'archived';
  return query select certificate.id, certificate.certificate_hash, certificate.status;
end;
$$;
