-- Production reset and baseline hardening.
-- Run only for the final production hand-over: this permanently removes
-- institutional operational records while leaving the application schema intact.

begin;

-- Clear every operational and demonstration record. `CASCADE` follows the
-- existing foreign-key graph and `RESTART IDENTITY` resets generated counters.
truncate table
  public.assessment_responses,
  public.assessment_attempts,
  public.assessment_questions,
  public.assignment_submissions,
  public.assignments,
  public.course_memberships,
  public.course_materials,
  public.virtual_sessions,
  public.question_options,
  public.questions,
  public.online_assessments,
  public.question_banks,
  public.attendance_records,
  public.attendance_sessions,
  public.unit_results,
  public.graduation_approvals,
  public.certificate_units,
  public.certificates,
  public.alumni_registry,
  public.student_payment_submissions,
  public.mpesa_stk_requests,
  public.payments,
  public.invoices,
  public.enrollments,
  public.student_risk_alerts,
  public.student_registration_counters,
  public.students,
  public.staff_members,
  public.profiles,
  public.timetable_slots,
  public.learning_courses,
  public.library_resources,
  public.announcements,
  public.inventory_movements,
  public.inventory_items,
  public.inventory_suppliers,
  public.inventory_categories,
  public.certificate_signatories,
  public.fee_structures,
  public.units,
  public.semesters,
  public.academic_years,
  public.intakes,
  public.programmes,
  public.departments,
  public.grading_bands,
  public.grading_scales,
  public.audit_logs
restart identity cascade;

-- Institution settings are retained only as configuration, never operational data.
update public.institution_settings
set agora_app_id = null,
    updated_at = now();

-- Database functions must never be callable by anonymous visitors. The browser
-- uses authenticated RPCs only; service-role functions bypass these grants.
revoke all on all functions in schema public from public, anon;
grant usage on schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Keep trigger-only and server-only helpers out of the PostgREST RPC surface.
revoke execute on function public.issue_student_registration_number(uuid, uuid) from authenticated, anon, public;
grant execute on function public.issue_student_registration_number(uuid, uuid) to service_role;
revoke execute on function public.record_audit_log() from authenticated, anon, public;
revoke execute on function public.enforce_payment_student_matches_invoice() from authenticated, anon, public;
revoke execute on function public.enforce_invoice_payment_total() from authenticated, anon, public;
revoke execute on function public.sync_invoice_payment_status() from authenticated, anon, public;
revoke execute on function public.public_verify_certificate(text) from authenticated, anon, public;

-- Pin trigger helper resolution to trusted schemas to prevent search_path
-- manipulation if these functions are ever invoked through a trigger.
alter function public.set_updated_at() set search_path = public;
alter function public.enforce_payment_student_matches_invoice() set search_path = public;

commit;
