-- Public capability links: only SHA-256 hashes are persisted. No anonymous table access.
create table public.public_report_forms (
 id uuid primary key default gen_random_uuid(),
 cohort_id uuid not null references public.cohorts(id),
 title text not null check (length(trim(title)) between 1 and 120),
 description text not null default '' check (length(description)<=1000),
 status text not null default 'draft' check (status in ('draft','published','closed')),
 opens_at timestamptz not null default now(),
 closes_at timestamptz not null default (now()+interval '30 days'),
 token_hash text not null unique,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 check (closes_at>opens_at), unique(id,cohort_id)
);
create table public.public_report_submissions (
 like public.session_reports including defaults including constraints,
 form_id uuid not null,
 reporter_name text not null check(length(trim(reporter_name)) between 1 and 120),
 reporter_email text not null check(length(reporter_email)<=254 and reporter_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 submission_key uuid not null,
 primary key(id), unique(form_id,submission_key),
 foreign key(form_id,cohort_id) references public.public_report_forms(id,cohort_id),
 check (enrolled_count<=5000),
 check (length(challenges)<=2000 and length(next_steps)<=2000 and length(co_facilitators)<=150)
);
alter table public.public_report_submissions alter column reporter_id drop not null;
alter table public.public_report_submissions add check (reporter_id is null);
create index public_submissions_cohort_date on public.public_report_submissions(cohort_id,session_date desc);
create index public_submissions_rate on public.public_report_submissions(form_id,created_at desc);
alter table public.public_report_forms enable row level security;
alter table public.public_report_submissions enable row level security;
revoke all on public.public_report_forms,public.public_report_submissions from public,anon,authenticated;
grant select on public.public_report_forms,public.public_report_submissions to authenticated;
create policy public_forms_admin_read on public.public_report_forms for select to authenticated using ((select private.is_super_admin()));
create policy public_submissions_admin_read on public.public_report_submissions for select to authenticated using ((select private.is_super_admin()));

create function private.manage_public_form(p_action text,p_id uuid,p_cohort_id uuid,p_title text,p_description text,p_opens_at timestamptz,p_closes_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.public_report_forms; secret text;
begin
 if not private.is_super_admin() then raise exception 'Super Admin access required' using errcode='42501'; end if;
 if p_action='create' then
  if not exists(select 1 from public.cohorts c join public.programmes p on p.id=c.programme_id where c.id=p_cohort_id and c.status='active' and p.active) then raise exception 'Choose an active cohort'; end if;
  secret:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.public_report_forms(cohort_id,title,description,opens_at,closes_at,token_hash,created_by)
  values(p_cohort_id,trim(p_title),coalesce(p_description,''),p_opens_at,p_closes_at,encode(extensions.digest(secret,'sha256'),'hex'),auth.uid()) returning * into f;
 else
  select * into f from public.public_report_forms where id=p_id for update;
  if not found then raise exception 'Form not found'; end if;
  if p_action='edit' then
   update public.public_report_forms set title=trim(p_title),description=coalesce(p_description,''),opens_at=p_opens_at,closes_at=p_closes_at where id=f.id returning * into f;
  elsif p_action in ('published','closed','draft') then
   update public.public_report_forms set status=p_action where id=f.id returning * into f;
  elsif p_action='rotate' then
   secret:=encode(extensions.gen_random_bytes(32),'hex');
   update public.public_report_forms set token_hash=encode(extensions.digest(secret,'sha256'),'hex') where id=f.id;
  else raise exception 'Invalid action'; end if;
 end if;
 return jsonb_build_object('id',f.id,'token',secret);
end $$;

create function private.get_public_form(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('title',f.title,'description',f.description,'cohort',c.name,'programme',p.name,'opens_at',f.opens_at,'closes_at',f.closes_at)
 from public.public_report_forms f join public.cohorts c on c.id=f.cohort_id join public.programmes p on p.id=c.programme_id
 where length(p_token)=64 and f.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
 and f.status='published' and now() between f.opens_at and f.closes_at and c.status='active' and p.active;
$$;

create function private.submit_public_report(p_token text,p_payload jsonb,p_submission_key uuid,p_website text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare f public.public_report_forms; result uuid; email text;
begin
 if octet_length(p_payload::text)>20000 or coalesce(p_website,'')<>'' or p_submission_key is null then raise exception 'Invalid submission'; end if;
 -- Serialize checks and insert on the form row; concurrent requests cannot bypass limits.
 select * into f from public.public_report_forms where length(p_token)=64 and token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if not found or f.status<>'published' or now()<f.opens_at or now()>f.closes_at or not exists(select 1 from public.cohorts c join public.programmes p on p.id=c.programme_id where c.id=f.cohort_id and c.status='active' and p.active) then raise exception 'Form unavailable'; end if;
 -- Reject routing/identity fields and unknown input. Cohort and reporter_id are never accepted.
 if p_payload - array['reporter_name','reporter_email','session_date','outcome','enrolled_count','attended_count','topic','progress','summary','challenges','next_steps','co_facilitators'] <> '{}'::jsonb then raise exception 'Unexpected fields'; end if;
 select id into result from public.public_report_submissions where form_id=f.id and submission_key=p_submission_key;
 if found then return result; end if;
 email:=lower(trim(p_payload->>'reporter_email'));
 if (select count(*) from public.public_report_submissions where form_id=f.id and created_at>now()-interval '1 minute')>=10
 or (select count(*) from public.public_report_submissions where form_id=f.id and created_at>now()-interval '1 day')>=500
 or (select count(*) from public.public_report_submissions where form_id=f.id and reporter_email=email and created_at>now()-interval '1 day')>=5 then
 raise exception 'Submission limit reached. Please try later or contact PAL.' using errcode='P0001'; end if;
 insert into public.public_report_submissions(form_id,cohort_id,reporter_name,reporter_email,submission_key,session_date,outcome,enrolled_count,attended_count,topic,progress,summary,challenges,next_steps,co_facilitators)
 values(f.id,f.cohort_id,trim(p_payload->>'reporter_name'),email,p_submission_key,(p_payload->>'session_date')::date,p_payload->>'outcome',(p_payload->>'enrolled_count')::integer,(p_payload->>'attended_count')::integer,trim(p_payload->>'topic'),p_payload->>'progress',trim(p_payload->>'summary'),coalesce(p_payload->>'challenges',''),coalesce(p_payload->>'next_steps',''),coalesce(p_payload->>'co_facilitators','')) returning id into result;
 return result;
end $$;

-- Explicitly granted invoker wrappers; privileged implementations stay outside exposed schemas.
create function public.manage_public_form(p_action text,p_id uuid default null,p_cohort_id uuid default null,p_title text default null,p_description text default '',p_opens_at timestamptz default now(),p_closes_at timestamptz default now()+interval '30 days') returns jsonb
language sql security invoker set search_path='' as $$ select private.manage_public_form(p_action,p_id,p_cohort_id,p_title,p_description,p_opens_at,p_closes_at) $$;
create function public.get_public_form(p_token text) returns jsonb language sql security invoker set search_path='' as $$ select private.get_public_form(p_token) $$;
create function public.submit_public_report(p_token text,p_payload jsonb,p_submission_key uuid,p_website text default '') returns uuid language sql security invoker set search_path='' as $$ select private.submit_public_report(p_token,p_payload,p_submission_key,p_website) $$;
revoke all on function private.manage_public_form(text,uuid,uuid,text,text,timestamptz,timestamptz),public.manage_public_form(text,uuid,uuid,text,text,timestamptz,timestamptz),private.get_public_form(text),public.get_public_form(text),private.submit_public_report(text,jsonb,uuid,text),public.submit_public_report(text,jsonb,uuid,text) from public,anon,authenticated;
grant usage on schema private to anon;
grant execute on function private.manage_public_form(text,uuid,uuid,text,text,timestamptz,timestamptz),public.manage_public_form(text,uuid,uuid,text,text,timestamptz,timestamptz) to authenticated;
grant execute on function private.get_public_form(text),public.get_public_form(text),private.submit_public_report(text,jsonb,uuid,text),public.submit_public_report(text,jsonb,uuid,text) to anon,authenticated;
