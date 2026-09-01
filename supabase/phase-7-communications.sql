-- Phase 7: institution communications
-- Apply after phase-6-operations-workflows.sql.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 160),
  message text not null check (char_length(trim(message)) between 3 and 4000),
  audience text not null default 'all' check (audience in ('all', 'students', 'staff')),
  published boolean not null default true,
  published_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((published and published_at is not null) or not published)
);

create index if not exists announcements_published_idx
  on public.announcements (published, published_at desc);

alter table public.announcements enable row level security;

create policy "announcements: authenticated read published" on public.announcements
  for select to authenticated using (published or (select public.is_administrator()));

create policy "announcements: administrators manage" on public.announcements
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop trigger if exists announcements_updated_at on public.announcements;
create trigger announcements_updated_at before update on public.announcements
  for each row execute function public.set_updated_at();

drop trigger if exists audit_announcements on public.announcements;
create trigger audit_announcements
  after insert or update or delete on public.announcements
  for each row execute function public.record_audit_log();
