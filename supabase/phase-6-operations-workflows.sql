

create type public.staff_employment_status as enum ('active', 'on_leave', 'inactive');

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  employee_number text not null unique,
  job_title text not null,
  department_id uuid references public.departments(id) on delete set null,
  phone text,
  employment_status public.staff_employment_status not null default 'active',
  started_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index staff_members_department_status_idx
  on public.staff_members(department_id, employment_status);

alter table public.staff_members enable row level security;

create policy "staff members: administrators manage" on public.staff_members
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

create policy "staff members: staff read own" on public.staff_members
  for select to authenticated
  using (profile_id = (select auth.uid()));

create trigger staff_members_updated_at before update on public.staff_members
  for each row execute function public.set_updated_at();

drop trigger if exists audit_staff_members on public.staff_members;
create trigger audit_staff_members
  after insert or update or delete on public.staff_members
  for each row execute function public.record_audit_log();

create or replace function public.sync_student_archive_timestamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
  else
    new.archived_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists students_sync_archive_timestamp on public.students;
create trigger students_sync_archive_timestamp
  before insert or update of status on public.students
  for each row execute function public.sync_student_archive_timestamp();


create or replace function public.enforce_invoice_payment_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_amount numeric(12,2);
  paid_amount numeric(12,2);
begin
  if new.invoice_id is null then
    return new;
  end if;

  select amount into invoice_amount from public.invoices where id = new.invoice_id;
  select coalesce(sum(amount), 0) into paid_amount
  from public.payments
  where invoice_id = new.invoice_id
    and id is distinct from new.id;

  if paid_amount + new.amount > invoice_amount then
    raise exception 'Payment exceeds the remaining balance on this invoice';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_do_not_exceed_invoice on public.payments;
create trigger payments_do_not_exceed_invoice
  before insert or update on public.payments
  for each row execute function public.enforce_invoice_payment_total();

create or replace function public.sync_invoice_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_invoice_id uuid;
  invoice_amount numeric(12,2);
  paid_amount numeric(12,2);
begin
  for affected_invoice_id in
    select distinct invoice_id
    from (
      select case when tg_op <> 'DELETE' then new.invoice_id end as invoice_id
      union all
      select case when tg_op <> 'INSERT' then old.invoice_id end as invoice_id
    ) as changed
    where invoice_id is not null
  loop
    select amount into invoice_amount from public.invoices where id = affected_invoice_id;
    select coalesce(sum(amount), 0) into paid_amount
    from public.payments
    where invoice_id = affected_invoice_id;

    update public.invoices
    set status = case
      when paid_amount >= invoice_amount then 'paid'::public.invoice_status
      when paid_amount > 0 then 'part_paid'::public.invoice_status
      else 'issued'::public.invoice_status
    end
    where id = affected_invoice_id
      and status <> 'void';
  end loop;
  return coalesce(new, old);
end;
$$;

drop trigger if exists payments_sync_invoice_status on public.payments;
create trigger payments_sync_invoice_status
  after insert or update or delete on public.payments
  for each row execute function public.sync_invoice_payment_status();

create index invoices_open_student_idx
  on public.invoices(student_id, status, due_on)
  where status in ('issued', 'part_paid');
