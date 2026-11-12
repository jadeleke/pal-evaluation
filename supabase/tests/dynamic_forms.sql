-- Run as DB owner only, after applying the dynamic-forms migration.
-- All synthetic identities, forms, and responses are rolled back.
begin;
create temporary table pal_dynamic_test (
 admin_id uuid, volunteer_id uuid, a uuid, b uuid, form_id uuid,
 token text, version_id uuid, question_id uuid, schema jsonb, submission_key uuid
);
insert into pal_dynamic_test(admin_id,volunteer_id,a,b,question_id,submission_key)
 values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select,update on pal_dynamic_test to authenticated,anon;
insert into auth.users(id,email)
 select admin_id,'pal-dynamic-admin@example.invalid' from pal_dynamic_test
 union all select volunteer_id,'pal-dynamic-volunteer@example.invalid' from pal_dynamic_test;
update public.profiles set active=true,role='super_admin' where id=(select admin_id from pal_dynamic_test);
update public.profiles set active=true where id=(select volunteer_id from pal_dynamic_test);
insert into public.cohorts(id,programme_id,name)
 select a,(select id from public.programmes limit 1),'Synthetic dynamic A' from pal_dynamic_test
 union all select b,(select id from public.programmes limit 1),'Synthetic dynamic B' from pal_dynamic_test;
update pal_dynamic_test set schema=jsonb_build_object('sections',jsonb_build_array(jsonb_build_object(
 'id',gen_random_uuid(),'title','Evaluation','questions',jsonb_build_array(jsonb_build_object(
 'id',question_id,'label','Was training completed?','type','yesno','required',true)))));
select set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true)
 from pal_dynamic_test;
set local role authenticated;
do $$
declare t record; response jsonb; published jsonb;
begin
 select * into t from pal_dynamic_test;
 response:=public.manage_dynamic_form('create',null,t.a,'Synthetic evaluation','Test only',
  t.schema,now()-interval '1 minute',now()+interval '1 day');
 update pal_dynamic_test set form_id=(response->>'id')::uuid,token=response->>'token';
 if public.get_dynamic_form(response->>'token') is not null then raise exception 'Draft link exposed'; end if;
 published:=public.manage_dynamic_form('publish',(response->>'id')::uuid);
 if published->>'status'<>'published' then raise exception 'Publish did not succeed'; end if;
 update pal_dynamic_test set version_id=(select published_version_id from public.dynamic_forms where id=(response->>'id')::uuid);
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare t record; result uuid; invalid boolean; answers jsonb;
begin
 select * into t from pal_dynamic_test;
 if public.get_dynamic_form(t.token) is null then raise exception 'Public form not available'; end if;
 if public.get_dynamic_form(repeat('0',64)) is not null then raise exception 'Forged form link accepted'; end if;
 answers:=jsonb_build_object(t.question_id::text,'Yes');
 result:=public.submit_dynamic_form(t.token,t.version_id,answers,t.submission_key);
 if public.submit_dynamic_form(t.token,t.version_id,answers,t.submission_key)<>result then
  raise exception 'Retry not idempotent'; end if;
 invalid:=false;
 begin perform public.submit_dynamic_form(t.token,t.version_id,answers||'{"cohort_id":"synthetic-other-cohort"}',gen_random_uuid());
 exception when others then invalid:=true; end;
 if not invalid then raise exception 'Arbitrary cohort answer accepted'; end if;
 invalid:=false;
 begin perform public.submit_dynamic_form(t.token,t.version_id,'{}'::jsonb,gen_random_uuid());
 exception when others then invalid:=true; end;
 if not invalid then raise exception 'Missing required choice accepted'; end if;
 invalid:=false;
 begin perform public.submit_dynamic_form(t.token,t.version_id,answers,gen_random_uuid(),'spam');
 exception when others then invalid:=true; end;
 if not invalid then raise exception 'Honeypot bypassed'; end if;
 invalid:=false;
 begin perform 1 from public.dynamic_form_submissions;
 exception when insufficient_privilege then invalid:=true; end;
 if not invalid then raise exception 'Anonymous table read was allowed'; end if;
 invalid:=false;
 begin perform public.manage_dynamic_form('close',t.form_id);
 exception when insufficient_privilege then invalid:=true; end;
 if not invalid then raise exception 'Anonymous form management was allowed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',volunteer_id,'role','authenticated')::text,true)
 from pal_dynamic_test;
set local role authenticated;
do $$
declare t record; invalid boolean:=false;
begin
 select * into t from pal_dynamic_test;
 if exists(select 1 from public.dynamic_form_submissions)
 or exists(select 1 from public.dynamic_forms) then raise exception 'Volunteer saw private dynamic records'; end if;
 begin perform public.manage_dynamic_form('close',t.form_id);
 exception when insufficient_privilege then invalid:=true; end;
 if not invalid then raise exception 'Volunteer changed a form'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true)
 from pal_dynamic_test;
set local role authenticated;
do $$
declare t record; schema2 jsonb; response jsonb; new_version uuid; old_token text;
begin
 select * into t from pal_dynamic_test;
 if (select count(*) from public.dynamic_form_submissions where cohort_id=t.a)<>1
  or exists(select 1 from public.dynamic_form_submissions where cohort_id=t.b)
  then raise exception 'Cohort isolation failed'; end if;
 schema2:=jsonb_set(t.schema,'{sections,0,questions,0,label}','"Training successfully completed?"'::jsonb);
 perform public.manage_dynamic_form('save',t.form_id,t.a,'Updated evaluation','Updated',schema2);
 perform public.manage_dynamic_form('publish',t.form_id);
 select published_version_id into new_version from public.dynamic_forms where id=t.form_id;
 if new_version=t.version_id then raise exception 'New version not created'; end if;
 if (select count(*) from public.dynamic_form_versions where form_id=t.form_id)<>2 then raise exception 'Expected exactly two versions'; end if;
 if (select version_id from public.dynamic_form_submissions where form_id=t.form_id limit 1)<>t.version_id
  then raise exception 'Previous submission version was modified'; end if;
 old_token:=t.token;
 response:=public.manage_dynamic_form('rotate',t.form_id);
 if public.get_dynamic_form(old_token) is not null then raise exception 'Revoked link still active'; end if;
 if public.get_dynamic_form(response->>'token') is null then raise exception 'Replacement link unavailable'; end if;
 perform public.manage_dynamic_form('close',t.form_id);
 if public.get_dynamic_form(response->>'token') is not null then raise exception 'Closed form still active'; end if;
 if (select count(*) from public.dynamic_form_audit where form_id=t.form_id)<5
  then raise exception 'Missing form audit trail'; end if;
end $$;
reset role;
rollback;
