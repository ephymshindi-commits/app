-- Phase 8: editable institution settings.
-- Agora App Certificates must remain in a Supabase Edge Function secret,
-- never in this table or any browser-visible configuration.

create table if not exists public.institution_settings (
  id boolean primary key default true check (id),
  institution_name text not null default 'LOVE & TRUTH BIBLE AND SKILLS TRAINING COLLEGE',
  academic_year_label text not null default 'Academic year 2026 / 2027',
  support_email text,
  agora_app_id text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.institution_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.institution_settings enable row level security;

create policy "institution settings: authenticated read" on public.institution_settings
  for select to authenticated using (true);

create policy "institution settings: administrators manage" on public.institution_settings
  for all to authenticated
  using ((select public.is_administrator()))
  with check ((select public.is_administrator()));

drop trigger if exists institution_settings_updated_at on public.institution_settings;
create trigger institution_settings_updated_at before update on public.institution_settings
  for each row execute function public.set_updated_at();
