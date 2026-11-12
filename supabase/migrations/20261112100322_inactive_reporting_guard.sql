-- Keep historical reports visible while pausing new reporting for inactive groups.
create policy session_reports_require_active_group on public.session_reports
as restrictive for insert to authenticated
with check (
 exists (
  select 1 from public.cohorts c
  join public.programmes p on p.id=c.programme_id
  where c.id=session_reports.cohort_id and c.status='active' and p.active
 )
);
