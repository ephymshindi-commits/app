
create table public.mpesa_stk_requests (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  phone text not null,
  checkout_request_id text unique,
  merchant_request_id text,
  status text not null default 'requested' check (status in ('requested', 'paid', 'failed', 'cancelled')),
  result_code integer,
  result_description text,
  mpesa_receipt_number text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mpesa_stk_requests_status_idx on public.mpesa_stk_requests(status, created_at desc);
alter table public.mpesa_stk_requests enable row level security;

create policy "mpesa requests: administrators manage" on public.mpesa_stk_requests
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

create trigger mpesa_stk_requests_updated_at before update on public.mpesa_stk_requests
  for each row execute function public.set_updated_at();

create trigger audit_mpesa_stk_requests after insert or update or delete on public.mpesa_stk_requests
  for each row execute function public.record_audit_log();
