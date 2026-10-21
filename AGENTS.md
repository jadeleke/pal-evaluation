# Implementation instructions for PAL Evaluation

## Product
Build an accessible, mobile-friendly volunteer reporting portal for Play & Learn Foundation, preserving a visual relationship to https://playandlearnfoundation.org/ without changing the foundation website. The product includes PAL Tech, Girl Empowerment and Mobile Library programmes; multiple volunteers may be assigned to cohorts.

## Roles and workflow
- **Super admin**: create cohorts, invite users by email, activate/deactivate member access, assign members to cohorts, view all reports and analytics.
- **Volunteer**: sign in via invitation, set/reset password, see assigned cohorts and submit session reports; never access other volunteers' reports unless explicitly authorized by audited RLS policies.
- **Programme admin**: placeholder role. Do not enable additional access without policies and tests.
- Session reports require date, cohort, topic, outcome, enrolment, attendance, progress assessment, short narrative, challenges and next steps. Use counts only; do not collect personal details about children.

## Technology
- Static frontend (`index.html`, `styles.css`, `app.js`); Supabase PostgreSQL, Auth and Edge Functions; deployable on Vercel.
- Existing Supabase project: `hjzeridpighstfzgnlvr` (EU West). Never create or modify unrelated projects.
- Enforce RLS at the database, not merely through hidden UI sections. The public Supabase publishable key may be client-visible; privileged service credentials may not.
- Changes to schemas require migrations; use least-privilege and review with Supabase security advisers.

## Quality gates
- `node --check app.js` and HTML ID check.
- Before release, test: first-admin bootstrap, invite email and accept flow, password reset, cohort assignment, report creation/read authorization, revoked access, analytics time filters, responsive navigation, and browser errors.
- Run a volunteer-vs-super-admin access-control test with real test accounts. Keep test data synthetic and remove it before introducing real data.
- Test deployment in a separate `pal-evaluation` Vercel project; do not modify `pal-tech`.

## Scope boundaries
Do not claim GitHub or Vercel deployment succeeded without an actual remote URL and confirmed deployment state. No credentials in repo. No children-identifying records. Avoid presenting simulated analytics as genuine outcomes.
