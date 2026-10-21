# PAL Evaluation

Volunteer session reporting, cohort management, and programme analytics for Play & Learn Foundation. The website is **not** part of PAL's public foundation website.

## Current state

- Static, responsive HTML/CSS/JavaScript app built for Vercel, using Supabase Auth and PostgreSQL.
- Programme and cohort views, report submission/history, analytics, account sign-in and password recovery, super-admin invite and deactivate workflows.
- Separate Supabase project **PAL Evaluation** in `eu-west-1` (`hjzeridpighstfzgnlvr`), with an initial migration already applied and an `invite-volunteer` Edge Function deployed.
- Three programmes: PAL Tech, Girl Empowerment, Mobile Library.
- No dummy reports or children records; the site shows genuine counts from the database. This **does not** mean full real-user acceptance testing has passed.
- **Vercel and GitHub remote deployment not complete** as of packaging. Creating the Vercel project via connected account returned HTTP 403. This repository package contains a local commit, not a GitHub remote push.

## Run locally

Run a local static server from the repository root and open its address (do not open `index.html` as a `file://` URL):

```bash
python3 -m http.server 8080
# http://localhost:8080
```

The browser fetches the supported Supabase client library from `esm.sh`. Internet access is required. `app.js` has the **public publishable key** and URL, which are intended for frontend use. **Never put a `service_role` key or other secret into frontend assets.**

## First administrator (required)

The initial migration deliberately does **not** create a super administrator or a hard-coded password. In Supabase's **Authentication → Users**, manually invite or create the trusted initial admin user using an address you control. After the user appears in `auth.users`, run the following in the Supabase SQL Editor, replacing the placeholder with **that exact admin email**:

```sql
update public.profiles
set role = 'super_admin', active = true
where id = (select id from auth.users where email = 'admin@example.org')
returning id, email, role, active;
```

Verify exactly **one** intended profile is updated. Only do this during initial bootstrap. Protect admin accounts with MFA where supported and regularly review privileged membership. No members are preloaded.

## Auth email / URL configuration

1. In Supabase Dashboard → Authentication → URL Configuration, set the Site URL to your final Vercel URL and add that same HTTPS URL to allowed redirect URLs. Include any separate staging URLs used during testing.
2. Configure and test the authentication mail delivery provider for production invite/reset emails; built-in email limits may be restrictive.
3. Set the Edge Function secret `PAL_SITE_URL` to the same deployed HTTPS URL. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to hosted functions; never expose these secrets in client code.
4. Invite a test volunteer from the super-admin member screen. Accept the email invite, set a password, and confirm that an inactive/non-member account cannot create reports.
5. Audit Row Level Security and invitation controls before entering live data.

## GitHub → Vercel workflow

1. Create a **private** `pal-evaluation` repository under the correct GitHub owner and push the local `main` branch with Git. GitHub access from this ChatGPT connection currently does not have a writable installation or repo-create capability.
2. From Vercel, select **Add New → Project → Import Git Repository**, then choose `pal-evaluation` (not the existing `pal-tech` project). The repository is a plain static site; framework preset **Other**, root directory `/`, no build command, output directory `/`.
3. Deploy the site, then finish the Supabase auth redirects above and validate sign-in and invite flows.
4. Leave custom PAL foundation domains and existing sites untouched until PAL approves integration.

## Database

`supabase/migrations/20261020232500_initial_pal_evaluation.sql` documents the schema for reproducibility. **Do not run it again against the already provisioned database without checking migration history**; it creates the tables and a trigger without idempotent `IF NOT EXISTS` guards. All public tables have RLS enabled.

`supabase/functions/invite-volunteer/index.ts` contains the source for the deployed `invite-volunteer` Edge Function. Changes to the local source require a deliberate redeployment.

## Known limits / production readiness

- The first super admin and email URLs still require setup; login and invite acceptance have not been end-to-end verified using real accounts.
- Current analytics present period-based session counts, attendance and progress summaries; this is not a full Power BI equivalent or child-level longitudinal analysis.
- The app stores aggregate counts, not child identities. **Do not record identifiable child data in free-text fields.**
- The front-end has no automated end-to-end tests or continuous delivery yet.
- Deployment permissions must be fixed or the GitHub import completed in the Vercel UI before a public link exists.