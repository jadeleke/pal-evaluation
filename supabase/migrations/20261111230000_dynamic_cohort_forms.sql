-- Additive dynamic form model. Existing session_reports and public_report_* remain untouched.
-- Every dynamic form is permanently assigned to one cohort.
create table public.dynamic_forms (
 id uuid primary key default gen_random_uuid(),
 cohort_id uuid not null references public.cohorts(id),
 title text not null check (length(trim(title)) between 1 and 120),
 description text not null default '' check (length(description)<=1000),
 status text not null default 'draft' check (status in ('draft','published','closed','archived')),
 draft_schema jsonb not null default '{"sections":[]}'::jsonb,
 published_version_id uuid,
 token_hash text not null unique,
 opens_at timestamptz not null default now(),
 closes_at timestamptz not null default now()+interval '30 days',
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,cohort_id),
 check (closes_at>opens_at),
 check (octet_length(draft_schema::text)<100000)
);
create table public.dynamic_form_versions (
 id uuid primary key default gen_random_uuid(),
 form_id uuid not null references public.dynamic_forms(id),
 version_no integer not null check (version_no>0),
 schema jsonb not null,
 published_at timestamptz not null default now(),
 retired_at timestamptz,
 unique(form_id,version_no),
 unique(id,form_id),
 check (octet_length(schema::text)<100000)
);
alter table public.dynamic_forms add constraint dynamic_form_published_version_fk
 foreign key (published_version_id,id) references public.dynamic_form_versions(id,form_id);
create table public.dynamic_form_submissions (
 id uuid primary key default gen_random_uuid(),
 form_id uuid not null,
 cohort_id uuid not null,
 version_id uuid not null,
 answers jsonb not null check (jsonb_typeof(answers)='object' and octet_length(answers::text)<30000),
 submission_key uuid not null,
 created_at timestamptz not null default now(),
 unique(form_id,submission_key),
 foreign key(form_id,cohort_id) references public.dynamic_forms(id,cohort_id),
 foreign key(version_id,form_id) references public.dynamic_form_versions(id,form_id)
);
create index dynamic_forms_cohort_idx on public.dynamic_forms(cohort_id,status);
create index dynamic_form_submissions_cohort_idx on public.dynamic_form_submissions(cohort_id,created_at desc);
create index dynamic_form_submissions_rate_idx on public.dynamic_form_submissions(form_id,created_at desc);
alter table public.dynamic_forms enable row level security;
alter table public.dynamic_form_versions enable row level security;
alter table public.dynamic_form_submissions enable row level security;
revoke all on public.dynamic_forms,public.dynamic_form_versions,public.dynamic_form_submissions from public,anon,authenticated;
grant select on public.dynamic_forms,public.dynamic_form_versions,public.dynamic_form_submissions to authenticated;
create policy dynamic_forms_admin_read on public.dynamic_forms for select to authenticated using ((select private.is_super_admin()));
create policy dynamic_versions_admin_read on public.dynamic_form_versions for select to authenticated using ((select private.is_super_admin()));
create policy dynamic_submissions_admin_read on public.dynamic_form_submissions for select to authenticated using ((select private.is_super_admin()));

-- Conditions only point backwards to an earlier single-choice question, preventing cycles.
create function private.validate_dynamic_schema(p_schema jsonb) returns void
language plpgsql set search_path='' as $$
declare s jsonb; q jsonb; o jsonb; sid text; qid text; typ text; ref text;
 seen text[]:='{}'; conditional text[]:='{}'; choices jsonb:='{}'::jsonb; option_values text[]; cnt int:=0; sections_count int:=0;
begin
 if p_schema is null or jsonb_typeof(p_schema)<>'object'
   or jsonb_typeof(p_schema->'sections')<>'array'
   or octet_length(p_schema::text)>90000 then raise exception 'Invalid form structure'; end if;
 for s in select value from jsonb_array_elements(p_schema->'sections') loop
  sections_count:=sections_count+1;
  if sections_count>30 then raise exception 'Maximum 30 sections'; end if;
  sid:=s->>'id';
  if sid is null or sid!~'^[0-9a-f-]{36}$'
   or length(trim(coalesce(s->>'title',''))) not between 1 and 120
   or length(coalesce(s->>'description',''))>1000
   or jsonb_typeof(s->'questions')<>'array' then raise exception 'Invalid section'; end if;
  if s ? 'when' and s->'when' <> 'null'::jsonb then
   ref:=s->'when'->>'questionId';
   if ref is null or not(ref=any(conditional)) or not exists (
     select 1 from jsonb_array_elements_text(choices->ref) candidate
     where candidate.value=s->'when'->>'value')
   then raise exception 'Section conditions must match an earlier choice option'; end if;
  end if;
  for q in select value from jsonb_array_elements(s->'questions') loop
   cnt:=cnt+1; if cnt>150 then raise exception 'Maximum 150 questions'; end if;
   qid:=q->>'id';typ:=q->>'type';
   if qid is null or qid!~'^[0-9a-f-]{36}$' or qid=any(seen)
      or length(trim(coalesce(q->>'label',''))) not between 1 and 160
      or typ not in ('text','paragraph','number','currency','date','time','datetime','select','radio','checkbox','yesno','rating','linear','email','phone','heading')
      or length(coalesce(q->>'help',''))>500 or length(coalesce(q->>'placeholder',''))>180
      or (q ? 'required' and jsonb_typeof(q->'required')<>'boolean')
   then raise exception 'Invalid or duplicate question'; end if;
   if q ? 'when' and q->'when' <> 'null'::jsonb then
    ref:=q->'when'->>'questionId';
    if ref is null or not(ref=any(conditional)) or not exists (
      select 1 from jsonb_array_elements_text(choices->ref) candidate
      where candidate.value=q->'when'->>'value')
    then raise exception 'Question conditions must match an earlier choice option'; end if;
   end if;
   if typ in ('select','radio','checkbox') then
    if jsonb_typeof(q->'options')<>'array' or jsonb_array_length(q->'options') not between 1 and 30 then
      raise exception 'Choice question needs 1–30 options'; end if;
    option_values:='{}';
    for o in select value from jsonb_array_elements(q->'options') loop
      if jsonb_typeof(o)<>'string' or length(trim(o #>> '{}')) not between 1 and 160
       or (o #>> '{}')=any(option_values) then raise exception 'Invalid or repeated option'; end if;
      option_values:=array_append(option_values,o #>> '{}');
    end loop;
   end if;
   if typ in ('rating','linear') and (
     coalesce(q->>'min','')!~'^-?[0-9]{1,3}$' or coalesce(q->>'max','')!~'^-?[0-9]{1,3}$'
     or (q->>'min')::integer>=(q->>'max')::integer
     or (q->>'max')::integer-(q->>'min')::integer>20) then
       raise exception 'Scales require a valid minimum and maximum (range <=20)'; end if;
   seen:=array_append(seen,qid);
   if typ in ('select','radio','yesno') and not(q ? 'when') then
     conditional:=array_append(conditional,qid);
     choices:=jsonb_set(choices,array[qid],case when typ='yesno'
       then '["Yes","No"]'::jsonb else q->'options' end);
   end if;
  end loop;
 end loop;
 if cnt=0 then raise exception 'Add at least one question before publishing'; end if;
end $$;

create function private.manage_dynamic_form(
 p_action text, p_id uuid default null, p_cohort_id uuid default null,
 p_title text default null, p_description text default '',
 p_schema jsonb default null, p_opens_at timestamptz default null,
 p_closes_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.dynamic_forms; secret text; next_version integer; new_id uuid;
begin
 if not private.is_super_admin() then raise exception 'Super Admin access required' using errcode='42501'; end if;
 if p_action='create' then
  if not exists(select 1 from public.cohorts c join public.programmes p on p.id=c.programme_id
   where c.id=p_cohort_id and c.status='active' and p.active) then raise exception 'Choose an active cohort'; end if;
  if coalesce(p_title,'')='' or p_schema is null then raise exception 'Title and form structure required'; end if;
  -- Drafts may be empty, but any supplied sections must be correctly shaped.
  if p_schema<>'{"sections":[]}'::jsonb then perform private.validate_dynamic_schema(p_schema); end if;
  secret:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.dynamic_forms(cohort_id,title,description,draft_schema,token_hash,opens_at,closes_at,created_by)
  values (p_cohort_id,trim(p_title),coalesce(p_description,''),p_schema,
   encode(extensions.digest(secret,'sha256'),'hex'),
   coalesce(p_opens_at,now()),coalesce(p_closes_at,now()+interval '30 days'),auth.uid())
  returning * into f;
 elsif p_action='duplicate' then
  select * into f from public.dynamic_forms where id=p_id;
  if not found then raise exception 'Form not found'; end if;
  if not exists(select 1 from public.cohorts c join public.programmes p on p.id=c.programme_id
    where c.id=p_cohort_id and c.status='active' and p.active) then raise exception 'Choose an active cohort'; end if;
  secret:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.dynamic_forms(cohort_id,title,description,draft_schema,token_hash,opens_at,closes_at,created_by)
  values(p_cohort_id,f.title||' (copy)',f.description,f.draft_schema,encode(extensions.digest(secret,'sha256'),'hex'),
    now(),now()+interval '30 days',auth.uid()) returning * into f;
 else
  select * into f from public.dynamic_forms where id=p_id for update;
  if not found then raise exception 'Form not found'; end if;
  if p_action='save' then
   if f.status='archived' then raise exception 'Archived form cannot be edited'; end if;
   if p_cohort_id is not null and p_cohort_id<>f.cohort_id then raise exception 'Cohort cannot change'; end if;
   if p_schema is null then raise exception 'Form structure required'; end if;
   if p_schema<>'{"sections":[]}'::jsonb then perform private.validate_dynamic_schema(p_schema); end if;
   update public.dynamic_forms set title=trim(p_title),description=coalesce(p_description,''),
    draft_schema=p_schema,opens_at=coalesce(p_opens_at,opens_at),
    closes_at=coalesce(p_closes_at,closes_at),updated_at=now()
    where id=f.id returning * into f;
  elsif p_action='publish' then
   perform private.validate_dynamic_schema(f.draft_schema);
   if f.published_version_id is null or not exists (
     select 1 from public.dynamic_form_versions v
      where v.id=f.published_version_id and v.schema=f.draft_schema) then
    select coalesce(max(version_no),0)+1 into next_version from public.dynamic_form_versions where form_id=f.id;
    if f.published_version_id is not null then
      update public.dynamic_form_versions set retired_at=now() where id=f.published_version_id and retired_at is null;
    end if;
    insert into public.dynamic_form_versions(form_id,version_no,schema)
     values(f.id,next_version,f.draft_schema) returning id into new_id;
    update public.dynamic_forms set published_version_id=new_id where id=f.id;
   end if;
   update public.dynamic_forms set status='published',updated_at=now() where id=f.id returning * into f;
  elsif p_action in ('close','archive','draft') then
   update public.dynamic_forms set status=case when p_action='close' then 'closed'
     when p_action='archive' then 'archived' else 'draft' end,updated_at=now()
     where id=f.id returning * into f;
  elsif p_action='rotate' then
   secret:=encode(extensions.gen_random_bytes(32),'hex');
   update public.dynamic_forms set token_hash=encode(extensions.digest(secret,'sha256'),'hex'),
     updated_at=now() where id=f.id returning * into f;
  else raise exception 'Invalid action'; end if;
 end if;
 return jsonb_build_object('id',f.id,'token',secret,'status',f.status);
end $$;

create function private.get_dynamic_form(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('title',f.title,'description',f.description,'cohort',c.name,
  'programme',p.name,'schema',v.schema,'version_id',v.id,'version_no',v.version_no)
 from public.dynamic_forms f
 join public.dynamic_form_versions v on v.id=f.published_version_id
 join public.cohorts c on c.id=f.cohort_id
 join public.programmes p on p.id=c.programme_id
 where length(p_token)=64 and f.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  and f.status='published' and now() between f.opens_at and f.closes_at
  and c.status='active' and p.active;
$$;

create function private.submit_dynamic_form(p_token text,p_version_id uuid,p_answers jsonb,
 p_submission_key uuid,p_website text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare f public.dynamic_forms; v public.dynamic_form_versions; result uuid;
 s jsonb; q jsonb; answer jsonb; item jsonb; qid text; typ text; required boolean;
 visible boolean; opts text[]; val text; num numeric; submitted_keys text[]:='{}';
begin
 if p_submission_key is null or coalesce(p_website,'')<>'' or p_answers is null
  or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>29000
 then raise exception 'Invalid submission'; end if;
 -- Lock the form to serialize rate checks and idempotent inserts.
 select * into f from public.dynamic_forms
  where length(p_token)=64 and token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if not found or f.status<>'published' or now() not between f.opens_at and f.closes_at
  or not exists(select 1 from public.cohorts c join public.programmes p on p.id=c.programme_id
    where c.id=f.cohort_id and c.status='active' and p.active)
 then raise exception 'Form unavailable'; end if;
 select * into v from public.dynamic_form_versions
 where id=p_version_id and form_id=f.id
  and (id=f.published_version_id or (retired_at is not null and now()<=retired_at+interval '2 hours'));
 if not found then raise exception 'Form has been updated. Reload to use the latest version'; end if;
 select id into result from public.dynamic_form_submissions
   where form_id=f.id and submission_key=p_submission_key;
 if found then return result; end if;
 if (select count(*) from public.dynamic_form_submissions where form_id=f.id and created_at>now()-interval '1 minute')>=10
  or (select count(*) from public.dynamic_form_submissions where form_id=f.id and created_at>now()-interval '1 day')>=500
 then raise exception 'Submission limit reached. Please try again later'; end if;
 for s in select value from jsonb_array_elements(v.schema->'sections') loop
  visible:=true;
  if s ? 'when' and s->'when' <> 'null'::jsonb then
    visible:=coalesce(p_answers->>(s->'when'->>'questionId'),'')=s->'when'->>'value';
  end if;
  for q in select value from jsonb_array_elements(s->'questions') loop
   qid:=q->>'id';typ:=q->>'type';answer:=p_answers->qid;
   if q ? 'when' and q->'when' <> 'null'::jsonb then
    if coalesce(p_answers->>(q->'when'->>'questionId'),'')<>q->'when'->>'value' then
      if answer is not null then raise exception 'Answer supplied for hidden question'; end if;
      continue;
    end if;
   end if;
   if not visible or typ='heading' then
    if answer is not null then raise exception 'Answer supplied for hidden/display-only question'; end if;
    continue;
   end if;
   submitted_keys:=array_append(submitted_keys,qid);
   required:=coalesce((q->>'required')::boolean,false);
   if answer is null or answer='null'::jsonb or answer='""'::jsonb or answer='[]'::jsonb then
     if required then raise exception 'Required question missing: %',left(q->>'label',80); end if;
     continue;
   end if;
   if typ='checkbox' then
     if jsonb_typeof(answer)<>'array' or jsonb_array_length(answer)>30 then raise exception 'Invalid selection'; end if;
     select array_agg(value #>> '{}') into opts from jsonb_array_elements(q->'options');
     for item in select value from jsonb_array_elements(answer) loop
       if jsonb_typeof(item)<>'string' or not (item #>> '{}')=any(opts) then raise exception 'Invalid selection'; end if;
     end loop;
   elsif typ in ('select','radio') then
     if jsonb_typeof(answer)<>'string' or not exists(
      select 1 from jsonb_array_elements_text(q->'options') o where o.value=answer #>> '{}')
      then raise exception 'Invalid choice'; end if;
   elsif typ='yesno' then
     if jsonb_typeof(answer)<>'string' or (answer #>> '{}') not in ('Yes','No') then raise exception 'Invalid yes/no answer'; end if;
   elsif typ in ('number','currency','rating','linear') then
     if jsonb_typeof(answer)<>'number' or length(answer::text)>20
      or answer::text!~'^-?[0-9]{1,15}(\.[0-9]{1,2})?$' then raise exception 'Invalid numeric value'; end if;
     num:=(answer #>> '{}')::numeric;
     if typ in ('rating','linear') and (num< (q->>'min')::numeric or num>(q->>'max')::numeric or trunc(num)<>num)
       then raise exception 'Out of range'; end if;
     if typ in ('number','currency') and
        ((q ? 'min' and num<(q->>'min')::numeric) or (q ? 'max' and num>(q->>'max')::numeric))
       then raise exception 'Out of range'; end if;
   else
     if jsonb_typeof(answer)<>'string' then raise exception 'Expected text answer'; end if;
     val:=answer #>> '{}';
     if length(val)>4000 or (q ? 'minLength' and length(val)<(q->>'minLength')::int)
       or (q ? 'maxLength' and length(val)>(q->>'maxLength')::int) then raise exception 'Text length invalid'; end if;
     if typ='email' and val!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email'; end if;
     if typ='phone' and val!~'^\+?[0-9 ()-]{6,22}$' then raise exception 'Invalid phone'; end if;
     if typ='date' and val!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid date'; end if;
     if typ='time' and val!~'^[0-9]{2}:[0-9]{2}$' then raise exception 'Invalid time'; end if;
     if typ='datetime' and val!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}' then raise exception 'Invalid date and time'; end if;
   end if;
  end loop;
 end loop;
 if exists(select 1 from jsonb_object_keys(p_answers) k where not(k=any(submitted_keys)))
  then raise exception 'Unexpected answer field'; end if;
 insert into public.dynamic_form_submissions(form_id,cohort_id,version_id,answers,submission_key)
 values(f.id,f.cohort_id,v.id,p_answers,p_submission_key) returning id into result;
 return result;
end $$;

-- Thin invoker wrappers are the only Data API methods; privileged helpers remain private.
create function public.manage_dynamic_form(
 p_action text,p_id uuid default null,p_cohort_id uuid default null,p_title text default null,
 p_description text default '',p_schema jsonb default null,p_opens_at timestamptz default null,
 p_closes_at timestamptz default null
) returns jsonb language sql security invoker set search_path='' as $$
 select private.manage_dynamic_form(p_action,p_id,p_cohort_id,p_title,p_description,p_schema,p_opens_at,p_closes_at) $$;
create function public.get_dynamic_form(p_token text) returns jsonb
 language sql security invoker set search_path='' as $$ select private.get_dynamic_form(p_token) $$;
create function public.submit_dynamic_form(p_token text,p_version_id uuid,p_answers jsonb,
 p_submission_key uuid,p_website text default '') returns uuid
 language sql security invoker set search_path='' as $$
 select private.submit_dynamic_form(p_token,p_version_id,p_answers,p_submission_key,p_website) $$;
revoke all on function private.validate_dynamic_schema(jsonb),
 private.manage_dynamic_form(text,uuid,uuid,text,text,jsonb,timestamptz,timestamptz),
 public.manage_dynamic_form(text,uuid,uuid,text,text,jsonb,timestamptz,timestamptz),
 private.get_dynamic_form(text),public.get_dynamic_form(text),
 private.submit_dynamic_form(text,uuid,jsonb,uuid,text),
 public.submit_dynamic_form(text,uuid,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function private.validate_dynamic_schema(jsonb) to authenticated;
grant execute on function private.manage_dynamic_form(text,uuid,uuid,text,text,jsonb,timestamptz,timestamptz),
 public.manage_dynamic_form(text,uuid,uuid,text,text,jsonb,timestamptz,timestamptz) to authenticated;
grant execute on function private.get_dynamic_form(text),public.get_dynamic_form(text),
 private.submit_dynamic_form(text,uuid,jsonb,uuid,text),
 public.submit_dynamic_form(text,uuid,jsonb,uuid,text) to anon,authenticated;
