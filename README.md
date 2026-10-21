# PAL Evaluation

Volunteer reporting and cohort evaluation for Play & Learn Foundation. This is a standalone pilot, not the foundation's main website.

## Canonical deployment

- **Website (production):** https://pal-evaluation.vercel.app/
- **Vercel project:** `pal-evaluation` (`prj_gEtujlrke91HBDNgMcmEUbg3VomC`)
- **GitHub repository:** https://github.com/jadeleke/pal-evaluation
- **Deployment source:** GitHub `main`
- **Supabase project:** `hjzeridpighstfzgnlvr` (Auth, PostgreSQL with RLS, Edge Functions)

**Release procedure:** commit and push website updates to GitHub `main`, deploy that exact commit to the **pal-evaluation** Vercel production project, then verify its production URL and deployed commit SHA. Check that GitHub-triggered automatic deployments are enabled in Vercel Git settings; if a push does not automatically deploy, perform an explicit Git-sourced deployment. Do not deploy changes to the other Vercel project.

## Features

- PAL Tech, Girl Empowerment, and Mobile Library programmes
- Multiple volunteers per cohort, invitation-based access and roles
- Session reports, report history, attendance/outcomes, period-based evaluation dashboard, CSV export
- Super Admin management of cohorts and volunteers
- Aggregate child attendance only; do not put identifying information about children in narrative fields

## Local development

From the repository root:

```bash
python3 -m http.server 8080
```

Open http://localhost:8080 and use synthetic test data. Internet access is required for the external Supabase client library. The publishable key in `app.js` is browser-safe; **never include the service-role/secret key in frontend code**.

## Authentication and email

Supabase → Authentication → URL Configuration:
- **Site URL:** `https://pal-evaluation.vercel.app/`
- **Allowed redirect:** `https://pal-evaluation.vercel.app/**`

Use a custom SMTP provider for invitations, confirmations, magic links and password resets. Supabase's built-in sender has strict limits and can restrict recipients. Any message previously generated with an outdated redirect must be regenerated after configuration is corrected.

The designated PAL Super Admin onboarding addresses are authorized in the **private** database one-time allowlist. An account obtains super-admin permissions only after its Auth email verification successfully completes. Do not manually create Auth users through raw SQL or bypass email ownership verification.

The `invite-volunteer` Edge Function source is in `supabase/functions/invite-volunteer/index.ts`, and is deployed separately from Vercel. Changes to that file must also be deployed to Supabase (JWT verification on).

## Deployment settings

- Framework: Other / static
- Root directory: repository root
- Build command: none
- Output directory: `.`
- Install command: none

## Security and release checks

Run `node --check app.js`, test authentication and invite flows with authorized accounts, verify programme/cohort access via RLS and confirm reporting + analytics behaviour. A successful Vercel build does not prove email delivery, authorization or end-to-end acceptance tests.

Database schema: `supabase/migrations/20261020232500_initial_pal_evaluation.sql`. Already applied; do not rerun unconditionally. Initial administrator bootstrap was applied separately in the hosted database.
