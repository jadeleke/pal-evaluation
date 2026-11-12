-- An unassigned draft can be prepared before an active cohort is chosen.
alter table private.custom_forms alter column cohort_id drop not null;
alter table private.custom_forms add constraint custom_form_publication_requires_cohort
check (cohort_id is not null or (status <> 'published' and live_version is null));

create or replace function private.custom_admin(p_action text,p_id uuid,p_cohort uuid,p_revision int,p_definition jsonb,p_offset int)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f private.custom_forms; next_version int; output jsonb;
begin
 if not private.is_super_admin() then raise exception 'Super Admin access required' using errcode='42501'; end if;
 if p_action='overview' then
  return (select jsonb_build_object('forms',count(*),'published',count(*) filter(where fm.status='published'),
   'responses',coalesce(sum((select count(*) from private.custom_form_responses r where r.form_id=fm.id)),0))
   from private.custom_forms fm left join public.cohorts c on c.id=fm.cohort_id
   where (p_cohort is null or fm.cohort_id=p_cohort)
    and (p_definition->>'programme' is null or c.programme_id=(p_definition->>'programme')::uuid));
 end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into output from (
   select fm.id,fm.cohort_id,fm.draft->>'title' as title,fm.draft->>'template' as template,fm.status,fm.revision,fm.live_version,fm.created_at,fm.updated_at,
    (select count(*) from private.custom_form_responses r where r.form_id=fm.id) as responses
   from private.custom_forms fm left join public.cohorts c on c.id=fm.cohort_id
   where (p_cohort is null or fm.cohort_id=p_cohort)
    and (p_definition->>'programme' is null or c.programme_id=(p_definition->>'programme')::uuid)
   order by fm.created_at desc,fm.id limit 50 offset greatest(coalesce(p_offset,0),0)
  ) x;
  return output;
 end if;
 if p_action='create' then
  perform private.check_custom_definition(p_definition,false);
  if p_cohort is not null and not exists(select 1 from public.cohorts c join public.programmes p on p.id=c.programme_id where c.id=p_cohort and c.status='active' and p.active) then raise exception 'Choose an active cohort'; end if;
  insert into private.custom_forms(cohort_id,draft,created_by) values(p_cohort,p_definition,auth.uid()) returning * into f;
 else
  select * into f from private.custom_forms where id=p_id for update;
  if not found then raise exception 'Form not found'; end if;
  if p_action='get' then
   return jsonb_build_object('form',to_jsonb(f),'versions',(select coalesce(jsonb_agg(to_jsonb(v) order by version desc),'[]') from private.custom_form_versions v where v.form_id=f.id));
  elsif p_action='responses' then
   return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select id,version,submitted_at,answers from private.custom_form_responses r where r.form_id=f.id order by submitted_at desc,id limit 200 offset greatest(coalesce(p_offset,0),0)
   ) x);
  end if;
  if f.revision is distinct from p_revision then raise exception 'This form changed. Reload it before saving or publishing.'; end if;
  if p_action in ('save','publish') then
   perform private.check_custom_definition(p_definition,p_action='publish');
   if p_cohort is not null and f.cohort_id is distinct from p_cohort then
    if f.cohort_id is not null then raise exception 'This form already belongs to a cohort'; end if;
    if not exists(select 1 from public.cohorts c join public.programmes p on p.id=c.programme_id where c.id=p_cohort and c.status='active' and p.active) then raise exception 'Choose an active cohort'; end if;
    f.cohort_id:=p_cohort;
   end if;
   if p_action='publish' then
    if f.cohort_id is null then raise exception 'Choose a cohort before publishing'; end if;
    if not exists(select 1 from public.cohorts c join public.programmes p on p.id=c.programme_id where c.id=f.cohort_id and c.status='active' and p.active) then raise exception 'This cohort is unavailable'; end if;
    select coalesce(max(version),0)+1 into next_version from private.custom_form_versions where form_id=f.id;
    insert into private.custom_form_versions(form_id,version,definition) values(f.id,next_version,p_definition);
    f.live_version:=next_version;
    f.status:='published';
   end if;
   f.draft:=p_definition;
  elsif p_action in ('draft','closed','archived') then f.status:=p_action;
  elsif p_action='rotate' then f.token:=encode(extensions.gen_random_bytes(32),'hex');
  else raise exception 'Unknown form action'; end if;
  update private.custom_forms set cohort_id=f.cohort_id,draft=f.draft,status=f.status,live_version=f.live_version,token=f.token,revision=revision+1,updated_at=now()
   where id=f.id returning * into f;
 end if;
 insert into private.custom_form_audit(form_id,actor,action) values(f.id,auth.uid(),p_action);
 return to_jsonb(f);
end $$;
