-- Allow Super Admins to remove unused records. Existing foreign keys protect reports, forms and cohorts.
grant delete on public.programmes, public.cohorts to authenticated;

create policy programmes_delete_admin on public.programmes for delete to authenticated
using ((select private.is_super_admin()));

create policy cohorts_delete_admin on public.cohorts for delete to authenticated
using ((select private.is_super_admin()));
