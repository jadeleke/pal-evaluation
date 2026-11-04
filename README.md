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
- **Account Settings → Change email address:** signed-in volunteers/admins enter and confirm a new email; Supabase Auth emails verification links (often to old and new addresses). Once fully verified, a database trigger syncs `public.profiles.email` by user ID without changing roles or cohort assignments. This is not an admin ability to override another member's email.
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

### Verified email-change workflow

Use **Account settings** in the PAL Evaluation sidebar to request an email change. The user confirms ownership using Supabase's email-change template (`{{ .ConfirmationURL }}`). Secure email change may require two confirmations. Supabase Auth Site URL must be `https://pal-evaluation.vercel.app/` with `https://pal-evaluation.vercel.app/**` allowed; SMTP must be configured in the dedicated PAL Evaluation Supabase project. The account keeps its existing role and cohort memberships. Users may need to sign back in after verification. Tested at static syntax level only until a real user completes email change in a browser.
# Cohort public reporting forms

Super Admins can open **Public forms**, choose one active cohort, set a title,
instructions and opening/closing dates, then save a draft. Copy the generated
link before leaving the page and select **Publish**. The reporting template uses
the existing PAL session fields, plus self-reported volunteer name and email.
It is a fixed session-report template, not an arbitrary question builder.

Forms can be edited, duplicated, closed, reopened, or have their link replaced.
The cohort cannot change after creation. Duplicating creates a new draft and can
target another cohort. A replaced link stops working immediately. Tokens contain
256 random bits; only SHA-256 hashes are stored. Tokens are URL fragments, and
responses set `Referrer-Policy: no-referrer`.

Anonymous clients have no table read/write access. Narrow database RPCs validate
the capability token, publication window, active programme/cohort and all report
fields. Submission cohort IDs come exclusively from the form record; routing and
identity fields supplied in the payload are rejected. A composite foreign key
also binds submissions to their form's cohort. Public submissions are readable
only by active Super Admins and never impersonate authenticated volunteers.

Spam safeguards include a honeypot, payload/field limits, idempotent retry keys,
and transactionally serialized limits: 10 submissions/minute and 500/day per form,
plus 5/day per normalized email per form. These limits are fixed server-side.
There is no CAPTCHA, IP-based throttling or email verification. Email identities
are self-reported; a determined attacker with a shared link can consume its quota.
Close or replace a compromised link. Do not collect child-identifying data.

Public submissions appear alongside authenticated reports for Super Admins.
Analytics and filtered CSV exports require a selected cohort; combined analytics
require explicitly selecting **Organization overview (all cohorts)**. Data is
loaded in pages rather than silently truncating to 1,000 reports.

Checks: `node --check app.js`, `node --check public-forms.js`,
`node tests/frontend.mjs`. Run `supabase/tests/public_forms.sql` as database owner
to exercise synthetic Auth identities, role permissions, cohort binding, link
rotation, publication windows, validation, retries and rate limits. It rolls back
all fixtures. This does not test invitation delivery or real browser sign-in.
