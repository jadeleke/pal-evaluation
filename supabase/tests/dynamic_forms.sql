begin;
do $$
declare
 cohort uuid; other_cohort uuid; admin_id uuid; volunteer_id uuid; form_id uuid; f jsonb; d jsonb; raw_token text; answer_id uuid; retry_key uuid:=gen_random_uuid();
begin
 select id into admin_id from public.profiles where role='super_admin' and active limit 1;
 select id into volunteer_id from public.profiles where role<>'super_admin' limit 1;
 select c.id into cohort from public.cohorts c join public.programmes p on p.id=c.programme_id where c.status='active' and p.active order by c.id limit 1;
 select id into other_cohort from public.cohorts where id<>cohort limit 1;
 if admin_id is null or cohort is null then raise exception 'Test needs an active admin and cohort'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 d:='{"title":"Rollback-only form test","sections":[{"id":"s","title":"Start","questions":[{"id":"choice","title":"Completed?","type":"yesno","required":true,"options":["Yes","No"]}]},{"id":"outcomes","title":"Outcomes","when":{"id":"choice","equals":"Yes"},"questions":[{"id":"score","title":"Score","type":"number","required":true,"min":0,"max":10}]}]}'::jsonb;
 f:=public.custom_admin('create',p_cohort=>cohort,p_definition=>d);
 form_id:=(f->>'id')::uuid;
 raw_token:=f->>'token';
 if public.custom_public(raw_token) is not null then raise exception 'Draft was public'; end if;
 begin
  perform public.custom_admin('publish',p_id=>form_id,p_revision=>1,p_definition=>jsonb_set(d,'{sections,0,when}','{"id":"choice","equals":"Yes"}'));
  raise exception 'Condition unexpectedly passed' using errcode='ZX001';
 exception when raise_exception then
  if sqlerrm not like 'Visibility rules%' then raise; end if;
 end;
 f:=public.custom_admin('publish',p_id=>form_id,p_revision=>1,p_definition=>d);
 if (public.custom_public(raw_token)->>'version')::int is distinct from 1 then raise exception 'Version 1 unavailable'; end if;
 if not exists(select 1 from jsonb_array_elements(public.custom_admin('list',p_cohort=>cohort)) x where x->>'id'=form_id::text) then raise exception 'List missing form'; end if;
 if other_cohort is not null and exists(select 1 from jsonb_array_elements(public.custom_admin('list',p_cohort=>other_cohort)) x where x->>'id'=form_id::text) then raise exception 'Cross-cohort list'; end if;
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 execute 'set local role anon';
 answer_id:=public.custom_submit(raw_token,1,'{"choice":"Yes","score":8}',retry_key);
 if public.custom_submit(raw_token,1,'{"choice":"Yes","score":8}',retry_key)<>answer_id then raise exception 'Duplicate retry'; end if;
 begin
  perform public.custom_submit(raw_token,1,'{"choice":"No","score":8}',gen_random_uuid());
  raise exception 'Hidden answer unexpectedly accepted' using errcode='ZX001';
 exception when raise_exception then
  if sqlerrm<>'Unexpected answers' then raise; end if;
 end;
 begin
  perform public.custom_submit(raw_token,1,'{"choice":"Yes","score":11}',gen_random_uuid());
  raise exception 'Invalid score unexpectedly accepted' using errcode='ZX001';
 exception when raise_exception then
  if sqlerrm not like 'Check the answer%' then raise; end if;
 end;
 begin
  perform count(*) from private.custom_form_responses;
  raise exception 'Anonymous table read unexpectedly succeeded' using errcode='ZX001';
 exception when insufficient_privilege then null;
 end;
 execute 'reset role';
 if volunteer_id is not null then
  perform set_config('request.jwt.claims',jsonb_build_object('sub',volunteer_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  begin
   perform public.custom_admin('get',p_id=>form_id);
   raise exception 'Volunteer management unexpectedly succeeded' using errcode='ZX001';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
 end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 f:=public.custom_admin('publish',p_id=>form_id,p_revision=>2,p_definition=>jsonb_set(d,'{sections,1,questions}','[]'));
 if (public.custom_public(raw_token)->>'version')::int is distinct from 2 then raise exception 'Version 2 unavailable'; end if;
 if (select count(*) from private.custom_form_responses where id=answer_id and cohort_id=cohort and version=1 and answers->>'score'='8')<>1 then raise exception 'Original version or cohort not preserved'; end if;
 if jsonb_array_length(public.custom_admin('responses',p_id=>form_id))<>1 then raise exception 'Expected one response'; end if;
 f:=public.custom_admin('publish',p_id=>form_id,p_revision=>3,p_definition=>d||'{"closes":"2000-01-01T00:00:00Z"}');
 if public.custom_public(raw_token) is not null then raise exception 'Expired link was available'; end if;
 f:=public.custom_admin('rotate',p_id=>form_id,p_revision=>4);
 if public.custom_public(raw_token) is not null or f->>'token'=raw_token then raise exception 'Rotation failed'; end if;
end $$;
rollback;
select 'PASS: custom form publishing, conditional validation, anonymous submission, retry, access control, version history, cohort binding and expiration' as result;
