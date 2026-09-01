# TVET Connect — Phase 2 Digital Academic Campus

This project now contains the MVP prototype plus the Phase 2 foundation from the project brief: course spaces, learning materials, virtual-class scheduling, assignments, timed online assessments, question banks, a digital library, timetable records and early-support analytics.

## What works now

- Responsive administration prototype with Phase 1 modules and new Digital Campus navigation.
- Supabase email/password sign-in, session restoration, password-reset requests and sign-out.
- Local interactive previews for creating course spaces and assessment drafts.
- Searchable/filterable digital-library preview and operational timetable / support views.
- Credential-safe client configuration: only Supabase’s publishable/anon key is ever intended for browser code.
- Additive Phase 2 PostgreSQL migration with UUIDs, foreign keys, checks, indexes, audit-friendly timestamps and role-aware Row Level Security policies.

The on-screen institutional records remain illustrative until authentication and Supabase data wiring are completed. Do not use the analytics indicators for real student decisions until the institution approves the thresholds and workflows.

## Run the interface

Open [index.html](index.html) in a current browser. The prototype has no build step.

## Supabase setup — do this next

1. Create a Supabase project in the appropriate region.
2. In **SQL Editor**, run these files **in this exact order** — each one depends on the last, and the order is not the order the filenames suggest:
   1. [supabase/schema.sql](supabase/schema.sql)
   2. [supabase/phase-2-digital-campus.sql](supabase/phase-2-digital-campus.sql) — despite the filename, this must run **before** phase-1-admin-rls.sql: it's where `is_administrator()`, `my_student_id()` and `is_trainer()` are actually defined, and phase-1's policies call all three. Running phase-1 first fails outright with `function public.is_administrator() does not exist` — confirmed by actually executing both files against a real Postgres 16 instance in that order before writing this README.
   3. [supabase/phase-1-admin-rls.sql](supabase/phase-1-admin-rls.sql) — **previously missing from this list entirely**, regardless of ordering. Without it, `students`, `enrollments`, `invoices`, `payments` and `attendance_records` have RLS enabled with no policies at all, so nobody — including administrators — can read or write them, and the student roster/registration screen will silently fail. Skipping it does not fail safe; it just breaks the app quietly. It also drops a `profiles` self-update policy from `schema.sql` that, left in place, lets any authenticated user grant themselves the `administrator` role directly — see `AUDIT-REPORT.md`, Pillar 2, if this project has already been deployed without this step.
   4. [supabase/phase-3-security-hardening.sql](supabase/phase-3-security-hardening.sql) — closes tables that were left with RLS off entirely (`departments`, `programmes`, `academic_years`, `semesters`, `units`, `fee_structures`, `audit_logs`), wires up audit logging, and adds the fee-balance/attendance-percentage views and timetable-conflict constraint. See `AUDIT-REPORT.md`.
    5. [supabase/phase-4-mvp-gap-fill.sql](supabase/phase-4-mvp-gap-fill.sql) — adds next-of-kin fields, intakes, and the grading-scale/unit-results tables the MVP brief calls for but the original schema didn't have.
    6. [supabase/phase-5-operational-readiness.sql](supabase/phase-5-operational-readiness.sql) — closes RLS on `attendance_sessions`, adds auditable result-status transitions, and creates the RLS-aware live dashboard summary used by the Finance, Attendance and Results screens.
    7. [supabase/phase-6-operations-workflows.sql](supabase/phase-6-operations-workflows.sql) — adds the staff register, automatic invoice-payment status updates, overpayment prevention and safe student-archive timestamp handling.

   Run all seven files in this order. The first five were execution-tested in a disposable Postgres 16 environment; apply the two newer operational migrations in a staging Supabase project with administrator, trainer and student accounts before production rollout.
3. In **Authentication → Providers**, enable Email. Decide whether email confirmation and password recovery emails should be sent now; configure a custom SMTP sender before a public rollout.
4. In **Storage**, create a **private** bucket called `learning-content`. Use it for notes, submitted files, recordings and library uploads; keep paths in the database, and generate short-lived signed URLs in the application.
5. In **Project Settings → API**, copy the project URL and the **publishable/anon** key into [src/app-config.js](src/app-config.js). Start from [src/app-config.example.js](src/app-config.example.js).
6. Create an initial administrator through **Authentication → Users → Add user**, then create the matching `public.profiles` row with role `administrator`. Do not add the service-role/secret key to this project.

## Worker provisioning setup

The Staff & roles screen creates an Auth invitation through a protected Edge Function. This is intentionally server-side: a browser must never receive a service-role key.

1. Apply `phase-6-operations-workflows.sql` after the previous migrations.
2. Deploy [supabase/functions/admin-create-worker/index.ts](supabase/functions/admin-create-worker/index.ts) as `admin-create-worker`.
3. Add `SUPABASE_SERVICE_ROLE_KEY` as an Edge Function secret. Supabase provides `SUPABASE_URL` and `SUPABASE_ANON_KEY` in deployed functions; never put the service-role key in `src/app-config.js` or any browser file.
4. Add the deployed application URL in **Authentication → URL Configuration → Redirect URLs** so invited workers can complete account setup.

After this setup, administrators can securely invite trainers or administrators, record employee details, issue invoices, record linked payments, create course spaces and enrol students from the application.

**Before doing anything else:** if you have ever committed or shared `supabase/.env.local.example` with a real value in `SUPABASE_ACCESS_TOKEN`, treat that token as compromised and rotate it in **Supabase Dashboard → Account → Access Tokens** right now, regardless of where this README step is in your setup order. See `AUDIT-REPORT.md`, Finding #1.

Example initial profile statement—replace the UUID and email with the created Auth user values:

```sql
insert into public.profiles (id, full_name, email, role)
values ('AUTH-USER-UUID-HERE', 'System Administrator', 'admin@example.edu', 'administrator');
```

## Keys and accounts needed

Needed now:

- Supabase project URL
- Supabase publishable/anon key
- Optional custom SMTP credentials when staff/student password emails must reliably reach users

Not needed yet:

- Supabase service-role/secret key — keep it server-only for a later protected API layer.
- M-PESA or bank keys — those belong to Phase 3 payments and reconciliation.
- Zoom/Google Meet/Microsoft Teams keys — Phase 2 records a provider-neutral secure meeting URL. Choose a virtual-class provider before adding automated meeting creation.
- SMS, push, AI, and mobile credentials — later roadmap phases.

## Important implementation notes

- The migration assumes `schema.sql` is already applied; it is deliberately additive and does not rewrite historical MVP data.
- `phase-2-digital-campus.sql` includes database RLS for the new module tables. Test every policy with administrator, trainer and student accounts before relying on it in production.
- Timetable conflict policy is marked as a TODO because the institution must first decide whether groups may share rooms/trainers and which situations constitute an allowed overlap.
- Establish formal workflows for assessment publication, marking, result release, late submissions, file retention and student-support escalation before enabling them for users.

## Current sign-in behavior

The application now opens on a secure sign-in screen. It accepts only accounts created in Supabase Auth. On first sign-in it reads the person’s own `profiles` row to display their name and role; if that profile has not yet been created, it uses the email name as a safe fallback.

Before password-reset links will work in production, add the deployed application URL under **Authentication → URL Configuration → Redirect URLs**. A local `file://` preview cannot receive a recovery redirect; use an HTTPS deployment or local development server.

## Recommended next delivery

The next implementation pass should add approved Phase 1 access policies plus live student and academic queries/mutations. A thin protected server/API layer should be introduced before adding any operation that requires a secret or third-party payment/video API key.
