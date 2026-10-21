-- PAL Evaluation: isolated initial schema. No identifiable child records are collected.
create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'volunteer' check (role in ('super_admin','programme_admin','volunteer')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.programmes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.programmes(id),
  name text not null,
  status text not null default 'active' check (status in ('active','completed','paused')),
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  unique(programme_id, name),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create table public.cohort_members (
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (cohort_id, user_id)
);
create table public.session_reports (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id),
  reporter_id uuid not null references public.profiles(id),
  session_date date not null,
  outcome text not null check (outcome in ('completed','partial','cancelled')),
  enrolled_count integer not null check (enrolled_count >= 0),
  attended_count integer not null check (attended_count >= 0 and attended_count <= enrolled_count),
  topic text not null check (char_length(topic) between 1 and 160),
  progress text not null check (progress in ('on_track','needs_support','not_assessed')),
  summary text not null check (char_length(summary) between 1 and 4000),
  challenges text not null default '',
  next_steps text not null default '',
  co_facilitators text not null default '',
  created_at timestamptz not null default now(),
  check (session_date <= current_date + 1)
);
create index on public.cohorts (programme_id);
create index on public.cohort_members (user_id);
create index on public.session_reports (session_date desc);
create index on public.session_reports (cohort_id,session_date desc);
create index on public.session_reports (reporter_id,session_date desc);

create or replace function private.is_active_user() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active);
$$;
create or replace function private.is_super_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active and p.role = 'super_admin');
$$;
create or replace function private.is_cohort_member(target_cohort uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cohort_members cm join public.profiles p on p.id = cm.user_id
    where cm.user_id = (select auth.uid()) and cm.cohort_id = target_cohort and p.active
  );
$$;
-- Private helpers are used inside RLS; their schema is NOT exposed as an API schema.
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on function private.is_active_user() from public;
revoke all on function private.is_super_admin() from public;
revoke all on function private.is_cohort_member(uuid) from public;
grant execute on function private.is_active_user(),private.is_super_admin(),private.is_cohort_member(uuid) to authenticated;

-- A new Auth identity starts inactive, and is activated only by an authorized invitation.
create or replace function private.create_profile_for_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id,email,full_name,role,active)
  values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'name',''), 'volunteer', false)
  on conflict (id) do nothing;
  return new;
end; $$;
revoke all on function private.create_profile_for_auth_user() from public;
create trigger pal_new_auth_user after insert on auth.users
for each row execute function private.create_profile_for_auth_user();

alter table public.profiles enable row level security;
alter table public.programmes enable row level security;
alter table public.cohorts enable row level security;
alter table public.cohort_members enable row level security;
alter table public.session_reports enable row level security;

-- Enforce grants as well as row policies. No anonymous access to data.
revoke all on public.profiles,public.programmes,public.cohorts,public.cohort_members,public.session_reports from anon,authenticated;
grant select,update on public.profiles to authenticated;
grant select,insert,update on public.programmes,public.cohorts,public.cohort_members to authenticated;
grant delete on public.cohort_members to authenticated;
grant select,insert on public.session_reports to authenticated;

create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_super_admin()));
create policy profiles_update_admin on public.profiles for update to authenticated
using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy programmes_read on public.programmes for select to authenticated
using ((select private.is_active_user()));
create policy programmes_insert_admin on public.programmes for insert to authenticated
with check ((select private.is_super_admin()));
create policy programmes_update_admin on public.programmes for update to authenticated
using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy cohorts_read on public.cohorts for select to authenticated
using ((select private.is_super_admin()) or (select private.is_cohort_member(id)));
create policy cohorts_insert_admin on public.cohorts for insert to authenticated
with check ((select private.is_super_admin()));
create policy cohorts_update_admin on public.cohorts for update to authenticated
using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy membership_read on public.cohort_members for select to authenticated
using ((select private.is_super_admin()) or (user_id = (select auth.uid()) and (select private.is_active_user())));
create policy membership_insert_admin on public.cohort_members for insert to authenticated
with check ((select private.is_super_admin()));
create policy membership_update_admin on public.cohort_members for update to authenticated
using ((select private.is_super_admin())) with check ((select private.is_super_admin()));
create policy membership_delete_admin on public.cohort_members for delete to authenticated
using ((select private.is_super_admin()));

create policy reports_read on public.session_reports for select to authenticated
using ((select private.is_super_admin()) or (reporter_id = (select auth.uid()) and (select private.is_active_user())));
create policy reports_insert_member on public.session_reports for insert to authenticated
with check (reporter_id = (select auth.uid()) and (select private.is_cohort_member(cohort_id)));

insert into public.programmes(name,description) values
('PAL Tech','Digital and technology learning'),
('Girl Empowerment','Girl empowerment and mentorship'),
('Mobile Library','Reading and mobile library initiatives')
on conflict (name) do nothing;