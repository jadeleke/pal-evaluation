-- Custom forms are additive. Existing session-report forms and links use their original tables.
create table private.custom_forms (
 id uuid primary key default gen_random_uuid(),
 cohort_id uuid not null references public.cohorts,
 draft jsonb not null,
 status text not null default 'draft' check(status in ('draft','published','closed','archived')),
 revision integer not null default 1,
 live_version integer,
 token text not null unique default encode(extensions.gen_random_bytes(32),'hex'),
 created_by uuid not null references public.profiles,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,cohort_id)
);
create table private.custom_form_versions (
 form_id uuid not null references private.custom_forms,
 version integer not null,
 definition jsonb not null,
 published_at timestamptz not null default now(),
 primary key(form_id,version)
);
alter table private.custom_forms add foreign key(id,live_version) references private.custom_form_versions(form_id,version);
create table private.custom_form_responses (
 id uuid primary key default gen_random_uuid(),
 form_id uuid not null,
 cohort_id uuid not null,
 version integer not null,
 submission_key uuid not null,
 answers jsonb not null,
 submitted_at timestamptz not null default now(),
 unique(form_id,submission_key),
 foreign key(form_id,cohort_id) references private.custom_forms(id,cohort_id),
 foreign key(form_id,version) references private.custom_form_versions(form_id,version)
);
create index custom_forms_cohort on private.custom_forms(cohort_id);
create index custom_responses_form_time on private.custom_form_responses(form_id,submitted_at desc,id);
create table private.custom_form_audit (
 id bigint generated always as identity primary key,
 form_id uuid not null references private.custom_forms,
 actor uuid not null references public.profiles,
 action text not null,
 occurred_at timestamptz not null default now()
);
alter table private.custom_forms enable row level security;
alter table private.custom_form_versions enable row level security;
alter table private.custom_form_responses enable row level security;
alter table private.custom_form_audit enable row level security;
revoke all on private.custom_forms, private.custom_form_versions, private.custom_form_responses, private.custom_form_audit from public, anon, authenticated;

create function private.form_value_valid(q jsonb,a jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare t text:=q->>'type'; v text:=a#>>'{}'; n numeric;
begin
 if a is null or a='null' then return false; end if;
 if t in ('number','currency','rating','scale') then
  if jsonb_typeof(a)<>'number' then return false; end if;
  n:=v::numeric;
  return abs(n)<=1000000000000 and (q->>'min' is null or n >= (q->>'min')::numeric)
   and (q->>'max' is null or n <= (q->>'max')::numeric)
   and (t not in ('rating','scale') or trunc(n)=n);
 end if;
 if t='checkbox' then
  if jsonb_typeof(a)<>'array' then return false; end if;
  return jsonb_array_length(a) between 1 and 50
   and not exists(select 1 from jsonb_array_elements(a) x where jsonb_typeof(x)<>'string' or not ((q->'options') ? (x#>>'{}')))
   and (select count(distinct x) from jsonb_array_elements(a) x)=jsonb_array_length(a);
 end if;
 if jsonb_typeof(a)<>'string' or length(trim(v))=0 or length(v)>4000 then return false; end if;
 case t
  when 'dropdown','radio','yesno' then return (q->'options') ? v;
  when 'email' then return length(v)<=254 and v ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
  when 'phone' then return v ~ '^\+?[0-9 ()-]{7,30}$' and length(regexp_replace(v,'[^0-9]','','g')) between 7 and 15;
  when 'date','datetime','time' then
   if t='date' then
    if v !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    perform v::date;
   elsif t='datetime' then
    if v !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$' then return false; end if;
    perform v::timestamp;
   else
    if v !~ '^([01]\d|2[0-3]):[0-5]\d$' then return false; end if;
   end if;
   return (q->>'min' is null or v >= q->>'min') and (q->>'max' is null or v <= q->>'max');
  when 'text','paragraph' then return length(v) between coalesce((q->>'min')::integer,1) and coalesce((q->>'max')::integer,4000);
  else return false;
 end case;
exception when data_exception then return false;
end $$;

create function private.check_custom_definition(d jsonb, publishing boolean) returns void
language plpgsql set search_path='' as $$
declare s jsonb; q jsonb; item jsonb; rule jsonb; source jsonb; opt jsonb;
 seen text[]:='{}'; eligible jsonb:='{}'; count_questions int:=0; t text;
begin
 if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>200000
  or length(trim(coalesce(d->>'title',''))) not between 1 and 120
  or length(coalesce(d->>'description',''))>2000
  or jsonb_typeof(d->'sections') is distinct from 'array'
  or jsonb_array_length(d->'sections') not between 1 and 30 then raise exception 'Add a title and between 1 and 30 sections'; end if;
 if d->>'opens' is not null and d->>'closes' is not null and (d->>'opens')::timestamptz >= (d->>'closes')::timestamptz then
  raise exception 'Closing time must follow opening time'; end if;
 perform (d->>'opens')::timestamptz,(d->>'closes')::timestamptz;
 for s in select value from jsonb_array_elements(d->'sections') loop
  if jsonb_typeof(s->'questions') is distinct from 'array' then raise exception 'Invalid section questions'; end if;
  for item in select s union all select value from jsonb_array_elements(s->'questions') loop
   if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'id','') !~ '^[a-z0-9-]{1,64}$'
    or item->>'id'=any(seen) or length(trim(coalesce(item->>'title',''))) not between 1 and 200
    or length(coalesce(item->>'description',''))>1000 or length(coalesce(item->>'placeholder',''))>200 then raise exception 'Invalid section or question'; end if;
   seen:=array_append(seen,item->>'id');
   rule:=item->'when';
   if rule is not null and rule<>'null' then
    source:=eligible->(rule->>'id');
    if source is null or jsonb_typeof(rule) is distinct from 'object'
      or private.form_value_valid(source,rule->'equals') is not true then
     raise exception 'Visibility rules must match an earlier, always visible required choice question'; end if;
   end if;
   if item->>'id'=s->>'id' then continue; end if;
   q:=item; t:=q->>'type'; count_questions:=count_questions+1;
   if count_questions>150 or t is null or t not in ('text','paragraph','number','currency','date','time','datetime','dropdown','radio','checkbox','yesno','rating','scale','email','phone')
    or jsonb_typeof(q->'required') is distinct from 'boolean' then raise exception 'Invalid question type or form has more than 150 questions'; end if;
   if t in ('dropdown','radio','checkbox','yesno') then
    opt:=q->'options';
    if jsonb_typeof(opt) is distinct from 'array' or jsonb_array_length(opt) not between 1 and 50
     or exists(select 1 from jsonb_array_elements(opt) x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 150)
     or (select count(distinct x) from jsonb_array_elements(opt) x)<>jsonb_array_length(opt) then raise exception 'Use 1 to 50 distinct choice options'; end if;
    if t='yesno' and opt<>'["Yes","No"]'::jsonb then raise exception 'Invalid yes/no choices'; end if;
   end if;
   if t in ('number','currency','rating','scale') then
    if (q->>'min')::numeric > (q->>'max')::numeric then raise exception 'Minimum exceeds maximum'; end if;
    if t in ('rating','scale') and (q->>'min' is null or q->>'max' is null
      or (q->>'min')::integer not between 0 and 100 or (q->>'max')::integer not between 0 and 100
      or (q->>'max')::integer-(q->>'min')::integer>20) then raise exception 'Use scale bounds between 0 and 100 with at most 21 choices'; end if;
   elsif t in ('text','paragraph') then
    if coalesce((q->>'min')::integer,1) not between 0 and 4000 or coalesce((q->>'max')::integer,4000) not between 1 and 4000
      or (q->>'min')::integer > (q->>'max')::integer then raise exception 'Invalid text length limits'; end if;
   elsif t in ('date','datetime','time') then
    if q->>'min'>q->>'max'
      or (q->>'min' is not null and not private.form_value_valid(q-'min'-'max',q->'min'))
      or (q->>'max' is not null and not private.form_value_valid(q-'min'-'max',q->'max')) then raise exception 'Invalid date or time limits'; end if;
   end if;
   if t='currency' and coalesce(q->>'currency','') !~ '^[A-Z]{3}$' then raise exception 'Use a three-letter currency code'; end if;
   if t in ('dropdown','radio','yesno') and (q->>'required')::boolean and coalesce(q->'when','null')='null'
      and coalesce(s->'when','null')='null' then eligible:=eligible||jsonb_build_object(q->>'id',q); end if;
  end loop;
 end loop;
 if publishing and count_questions=0 then raise exception 'Add at least one question before publishing'; end if;
end $$;

create function private.custom_admin(p_action text,p_id uuid,p_cohort uuid,p_revision int,p_definition jsonb,p_offset int)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f private.custom_forms; next_version int; output jsonb;
begin
 if not private.is_super_admin() then raise exception 'Super Admin access required' using errcode='42501'; end if;
 if p_action='overview' then
  return (select jsonb_build_object('forms',count(*),'published',count(*) filter(where fm.status='published'),
   'responses',coalesce(sum((select count(*) from private.custom_form_responses r where r.form_id=fm.id)),0))
   from private.custom_forms fm join public.cohorts c on c.id=fm.cohort_id
   where (p_cohort is null or fm.cohort_id=p_cohort)
    and (p_definition->>'programme' is null or c.programme_id=(p_definition->>'programme')::uuid));
 end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into output from (
   select fm.id,fm.cohort_id,fm.draft->>'title' as title,fm.draft->>'template' as template,fm.status,fm.revision,fm.live_version,fm.created_at,fm.updated_at,
    (select count(*) from private.custom_form_responses r where r.form_id=fm.id) as responses
   from private.custom_forms fm join public.cohorts c on c.id=fm.cohort_id
   where (p_cohort is null or fm.cohort_id=p_cohort)
    and (p_definition->>'programme' is null or c.programme_id=(p_definition->>'programme')::uuid)
   order by fm.created_at desc,fm.id limit 50 offset greatest(coalesce(p_offset,0),0)
  ) x;
  return output;
 end if;
 if p_action='create' then
  perform private.check_custom_definition(p_definition,false);
  if not exists(select 1 from public.cohorts c join public.programmes p on p.id=c.programme_id where c.id=p_cohort and c.status='active' and p.active) then raise exception 'Choose an active cohort'; end if;
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
   if p_action='publish' then
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
  update private.custom_forms set draft=f.draft,status=f.status,live_version=f.live_version,token=f.token,revision=revision+1,updated_at=now()
   where id=f.id returning * into f;
 end if;
 insert into private.custom_form_audit(form_id,actor,action) values(f.id,auth.uid(),p_action);
 return to_jsonb(f);
end $$;

create function private.custom_public(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',v.version,'definition',v.definition,'cohort',c.name,'programme',p.name)
 from private.custom_forms f join private.custom_form_versions v on v.form_id=f.id and v.version=f.live_version
 join public.cohorts c on c.id=f.cohort_id join public.programmes p on p.id=c.programme_id
 where length(p_token)=64 and f.token=p_token and f.status='published' and c.status='active' and p.active
  and coalesce((v.definition->>'opens')::timestamptz,'-infinity')<=now()
  and coalesce((v.definition->>'closes')::timestamptz,'infinity')>now()
$$;

create function private.custom_submit(p_token text,p_version int,p_answers jsonb,p_key uuid,p_website text)
returns uuid language plpgsql security definer set search_path='' as $$
declare f private.custom_forms; d jsonb; s jsonb; q jsonb; rule jsonb; a jsonb; clean jsonb:='{}'; result uuid;
begin
 if p_key is null or coalesce(p_website,'')<>'' or jsonb_typeof(p_answers) is distinct from 'object'
  or octet_length(p_answers::text)>60000 then raise exception 'Invalid submission'; end if;
 select * into f from private.custom_forms where length(p_token)=64 and token=p_token for update;
 if not found then raise exception 'Form unavailable'; end if;
 select id into result from private.custom_form_responses where form_id=f.id and submission_key=p_key;
 if found then return result; end if;
 if f.status<>'published' or not exists(select 1 from public.cohorts c join public.programmes p on p.id=c.programme_id where c.id=f.cohort_id and c.status='active' and p.active)
  then raise exception 'Form unavailable'; end if;
 -- Previously loaded versions get a short completion window after republishing.
 select definition into d from private.custom_form_versions where form_id=f.id and version=p_version
  and (version=f.live_version or exists(select 1 from private.custom_form_versions live where live.form_id=f.id and live.version=f.live_version and live.published_at>now()-interval '30 minutes'));
 if d is null or coalesce((d->>'opens')::timestamptz,'-infinity')>now()
  or coalesce((d->>'closes')::timestamptz,'infinity')<=now()
  or exists(select 1 from private.custom_form_versions live where live.form_id=f.id and live.version=f.live_version and (coalesce((live.definition->>'closes')::timestamptz,'infinity')<=now() or coalesce((live.definition->>'opens')::timestamptz,'-infinity')>now()))
 then raise exception 'This form has closed or changed. Reopen the link.'; end if;
 if (select count(*) from private.custom_form_responses where form_id=f.id and submitted_at>now()-interval '1 minute')>=30
 or (select count(*) from private.custom_form_responses where form_id=f.id and submitted_at>now()-interval '1 day')>=1000 then
  raise exception 'Submission limit reached. Please try again later.'; end if;
 for s in select value from jsonb_array_elements(d->'sections') loop
  rule:=s->'when';
  if coalesce(rule,'null')<>'null' and (clean->(rule->>'id')) is distinct from rule->'equals' then continue; end if;
  for q in select value from jsonb_array_elements(s->'questions') loop
   rule:=q->'when';
   if coalesce(rule,'null')<>'null' and (clean->(rule->>'id')) is distinct from rule->'equals' then continue; end if;
   a:=p_answers->(q->>'id');
   if a is null and not (q->>'required')::boolean then continue; end if;
   if private.form_value_valid(q,a) is not true then raise exception 'Check the answer for "%"',q->>'title'; end if;
   clean:=clean||jsonb_build_object(q->>'id',a);
  end loop;
 end loop;
 if p_answers<>clean then raise exception 'Unexpected answers'; end if;
 insert into private.custom_form_responses(form_id,cohort_id,version,submission_key,answers)
 values(f.id,f.cohort_id,p_version,p_key,clean) returning id into result;
 return result;
end $$;

create function public.custom_admin(p_action text,p_id uuid default null,p_cohort uuid default null,p_revision int default null,p_definition jsonb default null,p_offset int default 0)
returns jsonb language sql set search_path='' as $$ select private.custom_admin(p_action,p_id,p_cohort,p_revision,p_definition,p_offset) $$;
create function public.custom_public(p_token text) returns jsonb language sql stable set search_path='' as $$ select private.custom_public(p_token) $$;
create function public.custom_submit(p_token text,p_version int,p_answers jsonb,p_key uuid,p_website text default '')
returns uuid language sql set search_path='' as $$ select private.custom_submit(p_token,p_version,p_answers,p_key,p_website) $$;
revoke all on function private.form_value_valid(jsonb,jsonb),private.check_custom_definition(jsonb,boolean),
 private.custom_admin(text,uuid,uuid,int,jsonb,int),public.custom_admin(text,uuid,uuid,int,jsonb,int),
 private.custom_public(text),public.custom_public(text),private.custom_submit(text,int,jsonb,uuid,text),public.custom_submit(text,int,jsonb,uuid,text)
 from public,anon,authenticated;
grant execute on function private.custom_admin(text,uuid,uuid,int,jsonb,int),public.custom_admin(text,uuid,uuid,int,jsonb,int) to authenticated;
grant execute on function private.custom_public(text),public.custom_public(text),private.custom_submit(text,int,jsonb,uuid,text),public.custom_submit(text,int,jsonb,uuid,text) to anon,authenticated;
