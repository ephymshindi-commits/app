create table if not exists public.student_payment_submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('Card', 'Cheque')),
  transaction_details text not null check (char_length(trim(transaction_details)) >= 3),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  payment_id uuid references public.payments(id) on delete set null
);

create index if not exists student_payment_submissions_student_idx
  on public.student_payment_submissions(student_id, submitted_at desc);
create index if not exists student_payment_submissions_status_idx
  on public.student_payment_submissions(status, submitted_at desc);

alter table public.student_payment_submissions enable row level security;

drop policy if exists "payment submissions: students submit own" on public.student_payment_submissions;
create policy "payment submissions: students submit own" on public.student_payment_submissions
  for insert to authenticated
  with check (
    public.current_app_role() = 'student'
    and student_id = public.my_student_id()
    and submitted_by = auth.uid()
  );

drop policy if exists "payment submissions: students read own" on public.student_payment_submissions;
create policy "payment submissions: students read own" on public.student_payment_submissions
  for select to authenticated
  using (student_id = public.my_student_id());

drop policy if exists "payment submissions: administrators manage" on public.student_payment_submissions;
create policy "payment submissions: administrators manage" on public.student_payment_submissions
  for all to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

drop policy if exists "mpesa requests: students read own" on public.mpesa_stk_requests;
create policy "mpesa requests: students read own" on public.mpesa_stk_requests
  for select to authenticated
  using (student_id = public.my_student_id());

create or replace function public.my_student_finance_snapshot()
returns table (
  student_id uuid,
  registration_number text,
  first_name text,
  last_name text,
  programme_name text,
  programme_code text,
  total_fee numeric,
  total_paid numeric,
  balance numeric,
  account_state text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_app_role() <> 'student' then
    raise exception 'Only students can view this account';
  end if;

  return query
  with account as (
    select
      student.id as student_id,
      student.registration_number,
      student.first_name,
      student.last_name,
      programme.name as programme_name,
      programme.code as programme_code,
      coalesce((
        select structure.amount
        from public.fee_structures structure
        join public.academic_years year on year.id = structure.academic_year_id
        where structure.programme_id = student.programme_id
          and structure.year_of_study = student.year_of_study
          and year.active
        order by year.starts_on desc
        limit 1
      ), 0)::numeric as total_fee,
      coalesce((select sum(payment.amount) from public.payments payment where payment.student_id = student.id), 0)::numeric as total_paid
    from public.students student
    join public.programmes programme on programme.id = student.programme_id
    where student.profile_id = auth.uid()
  )
  select
    account.student_id,
    account.registration_number,
    account.first_name,
    account.last_name,
    account.programme_name,
    account.programme_code,
    account.total_fee,
    account.total_paid,
    account.total_fee - account.total_paid as balance,
    case
      when account.total_fee = 0 then 'fee structure pending'
      when account.total_fee - account.total_paid < 0 then 'excess payment'
      when account.total_fee - account.total_paid = 0 then 'fully paid'
      else 'balance due'
    end as account_state
  from account;
end;
$$;

create or replace function public.my_student_payment_history()
returns table (
  payment_id uuid,
  receipt_number text,
  amount numeric,
  method text,
  reference text,
  received_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_app_role() <> 'student' then
    raise exception 'Only students can view this payment history';
  end if;
  return query
  select payment.id, payment.receipt_number, payment.amount, payment.method, payment.reference, payment.received_at
  from public.payments payment
  where payment.student_id = public.my_student_id()
  order by payment.received_at desc;
end;
$$;

create or replace function public.my_student_payment_submissions()
returns table (
  submission_id uuid,
  amount numeric,
  method text,
  transaction_details text,
  status text,
  submitted_at timestamptz,
  review_note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_app_role() <> 'student' then
    raise exception 'Only students can view submitted payment details';
  end if;
  return query
  select submission.id, submission.amount, submission.method, submission.transaction_details,
         submission.status, submission.submitted_at, submission.review_note
  from public.student_payment_submissions submission
  where submission.student_id = public.my_student_id()
  order by submission.submitted_at desc;
end;
$$;

create or replace function public.my_mpesa_payment_requests()
returns table (
  request_id uuid,
  amount numeric,
  status text,
  result_description text,
  mpesa_receipt_number text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_app_role() <> 'student' then
    raise exception 'Only students can view M-Pesa requests';
  end if;
  return query
  select request.id, request.amount, request.status, request.result_description,
         request.mpesa_receipt_number, request.created_at
  from public.mpesa_stk_requests request
  where request.student_id = public.my_student_id()
  order by request.created_at desc;
end;
$$;

create or replace function public.submit_own_payment_proof(
  paid_amount numeric,
  payment_method text,
  transaction_details text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_submission_id uuid;
begin
  if public.current_app_role() <> 'student' then
    raise exception 'Only students can submit payment details';
  end if;
  if paid_amount is null or paid_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if payment_method not in ('Card', 'Cheque') then
    raise exception 'Use M-Pesa for an instant confirmation, or submit Card or Cheque details for review';
  end if;
  if char_length(trim(coalesce(transaction_details, ''))) < 3 then
    raise exception 'Enter the card transaction details or cheque number';
  end if;

  insert into public.student_payment_submissions (
    student_id, amount, method, transaction_details, submitted_by
  ) values (
    public.my_student_id(), paid_amount, payment_method, trim(transaction_details), auth.uid()
  ) returning id into saved_submission_id;
  return saved_submission_id;
end;
$$;

create or replace function public.institution_finance_summary()
returns table (
  total_fee numeric,
  total_collected numeric,
  total_balance numeric,
  active_students bigint,
  pending_submissions bigint,
  pending_submission_amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_administrator() then
    raise exception 'Only administrators can view the institution finance summary';
  end if;
  return query
  with accounts as (
    select * from public.student_finance_accounts()
  )
  select
    coalesce(sum(account.total_fee), 0)::numeric,
    coalesce(sum(account.total_paid), 0)::numeric,
    coalesce(sum(account.balance), 0)::numeric,
    count(*)::bigint,
    (select count(*) from public.student_payment_submissions where status = 'pending')::bigint,
    (select coalesce(sum(amount), 0) from public.student_payment_submissions where status = 'pending')::numeric
  from accounts account;
end;
$$;

create or replace function public.approve_student_payment_submission(
  target_submission_id uuid,
  approve boolean,
  decision_note text default null
)
returns table (
  submission_id uuid,
  status text,
  payment_id uuid,
  receipt_number text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.student_payment_submissions;
  target_student public.students;
  fee_amount numeric;
  ledger_invoice_id uuid;
  saved_payment public.payments;
begin
  if not public.is_administrator() then
    raise exception 'Only administrators can approve payment submissions';
  end if;
  select * into submission from public.student_payment_submissions where id = target_submission_id for update;
  if submission.id is null then
    raise exception 'Payment submission was not found';
  end if;
  if submission.status <> 'pending' then
    raise exception 'This payment submission has already been reviewed';
  end if;

  if not approve then
    update public.student_payment_submissions
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(decision_note), '')
    where id = submission.id;
    return query select submission.id, 'rejected'::text, null::uuid, null::text;
    return;
  end if;

  select * into target_student from public.students where id = submission.student_id;
  select structure.amount into fee_amount
  from public.fee_structures structure
  join public.academic_years year on year.id = structure.academic_year_id
  where structure.programme_id = target_student.programme_id
    and structure.year_of_study = target_student.year_of_study
    and year.active
  order by year.starts_on desc
  limit 1;
  if fee_amount is null then
    raise exception 'Set the active programme fee structure before approving this payment';
  end if;

  select id into ledger_invoice_id
  from public.invoices
  where student_id = target_student.id
    and invoice_number = format('FEE-%s-%s', extract(year from current_date)::integer, left(target_student.id::text, 8));
  if ledger_invoice_id is null then
    insert into public.invoices (student_id, invoice_number, amount, due_on, status, issued_at)
    values (target_student.id, format('FEE-%s-%s', extract(year from current_date)::integer, left(target_student.id::text, 8)), fee_amount, null, 'issued', now())
    returning id into ledger_invoice_id;
  end if;

  insert into public.payments (student_id, invoice_id, receipt_number, amount, method, reference, recorded_by)
  values (
    target_student.id,
    ledger_invoice_id,
    format('RCT-%s-%s', extract(year from current_date)::integer, upper(left(submission.id::text, 8))),
    submission.amount,
    submission.method,
    submission.transaction_details,
    auth.uid()
  ) returning * into saved_payment;

  update public.student_payment_submissions
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = nullif(trim(decision_note), ''), payment_id = saved_payment.id
  where id = submission.id;
  return query select submission.id, 'approved'::text, saved_payment.id, saved_payment.receipt_number;
end;
$$;

revoke all on function public.my_student_finance_snapshot() from public;
revoke all on function public.my_student_payment_history() from public;
revoke all on function public.my_student_payment_submissions() from public;
revoke all on function public.my_mpesa_payment_requests() from public;
revoke all on function public.submit_own_payment_proof(numeric, text, text) from public;
revoke all on function public.institution_finance_summary() from public;
revoke all on function public.approve_student_payment_submission(uuid, boolean, text) from public;
grant execute on function public.my_student_finance_snapshot() to authenticated;
grant execute on function public.my_student_payment_history() to authenticated;
grant execute on function public.my_student_payment_submissions() to authenticated;
grant execute on function public.my_mpesa_payment_requests() to authenticated;
grant execute on function public.submit_own_payment_proof(numeric, text, text) to authenticated;
grant execute on function public.institution_finance_summary() to authenticated;
grant execute on function public.approve_student_payment_submission(uuid, boolean, text) to authenticated;
