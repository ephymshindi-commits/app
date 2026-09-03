alter table public.students
  add column if not exists year_of_study smallint not null default 1 check (year_of_study > 0);

create or replace function public.student_finance_snapshot(target_student_id uuid)
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
  if not public.is_administrator() then
    raise exception 'Only administrators can view student finance accounts';
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
    where student.id = target_student_id
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

create or replace function public.student_finance_accounts()
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
  if not public.is_administrator() then
    raise exception 'Only administrators can view student finance accounts';
  end if;

  return query
  select snapshot.*
  from public.students student
  cross join lateral public.student_finance_snapshot(student.id) snapshot
  where student.status = 'active'
  order by snapshot.first_name, snapshot.last_name;
end;
$$;

create or replace function public.enforce_invoice_payment_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;

create or replace function public.record_student_payment(
  target_student_id uuid,
  paid_amount numeric,
  payment_method text,
  payment_reference text,
  receipt_no text
)
returns table (
  payment_id uuid,
  receipt_number text,
  amount numeric,
  total_fee numeric,
  total_paid numeric,
  balance numeric,
  account_state text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_student public.students;
  fee_amount numeric;
  ledger_invoice_id uuid;
  saved_payment public.payments;
  account record;
begin
  if not public.is_administrator() then
    raise exception 'Only administrators can record student payments';
  end if;
  if paid_amount is null or paid_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if payment_method not in ('M-PESA', 'Card', 'Cash', 'Cheque', 'In-kind contribution') then
    raise exception 'Select a valid payment method';
  end if;
  if payment_method = 'In-kind contribution' and coalesce(trim(payment_reference), '') = '' then
    raise exception 'Describe the supplied item or service for an in-kind contribution';
  end if;
  if coalesce(trim(receipt_no), '') = '' then
    raise exception 'A receipt number is required';
  end if;

  select * into target_student from public.students where id = target_student_id;
  if target_student.id is null then
    raise exception 'Student record was not found';
  end if;

  select structure.amount into fee_amount
  from public.fee_structures structure
  join public.academic_years year on year.id = structure.academic_year_id
  where structure.programme_id = target_student.programme_id
    and structure.year_of_study = target_student.year_of_study
    and year.active
  order by year.starts_on desc
  limit 1;
  if fee_amount is null then
    raise exception 'Set the active programme fee structure before recording a payment';
  end if;

  select id into ledger_invoice_id
  from public.invoices
  where student_id = target_student.id
    and invoice_number = format('FEE-%s-%s', extract(year from current_date)::integer, left(target_student.id::text, 8));
  if ledger_invoice_id is null then
    insert into public.invoices (student_id, invoice_number, amount, due_on, status, issued_at)
    values (
      target_student.id,
      format('FEE-%s-%s', extract(year from current_date)::integer, left(target_student.id::text, 8)),
      fee_amount,
      null,
      'issued',
      now()
    )
    returning id into ledger_invoice_id;
  end if;

  insert into public.payments (student_id, invoice_id, receipt_number, amount, method, reference, recorded_by)
  values (target_student.id, ledger_invoice_id, trim(receipt_no), paid_amount, payment_method, nullif(trim(payment_reference), ''), auth.uid())
  returning * into saved_payment;

  select * into account from public.student_finance_snapshot(target_student.id);
  return query select saved_payment.id, saved_payment.receipt_number, saved_payment.amount, account.total_fee, account.total_paid, account.balance, account.account_state;
end;
$$;

revoke all on function public.student_finance_snapshot(uuid) from public;
revoke all on function public.student_finance_accounts() from public;
revoke all on function public.record_student_payment(uuid, numeric, text, text, text) from public;
grant execute on function public.student_finance_snapshot(uuid) to authenticated;
grant execute on function public.student_finance_accounts() to authenticated;
grant execute on function public.record_student_payment(uuid, numeric, text, text, text) to authenticated;
