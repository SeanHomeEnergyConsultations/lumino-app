-- Lumino production schema
-- This schema is designed around:
-- 1. a shared lead pool
-- 2. route drafts for planning
-- 3. route runs for live execution from rep geolocation
-- 4. field outcomes and re-optimization

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (
    external_auth_id,
    email,
    full_name
  )
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (external_auth_id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.app_users.full_name),
        updated_at = now();

  return new;
end;
$$;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.app_users
  where external_auth_id = auth.uid()
  limit 1;
$$;

create or replace function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where user_id = public.current_app_user_id()
    and is_active = true;
$$;

create or replace function public.has_org_role(org_id uuid, roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = org_id
      and om.user_id = public.current_app_user_id()
      and om.is_active = true
      and (roles is null or om.role = any(roles))
  );
$$;

create or replace function public.bootstrap_organization_for_email(
  user_email text,
  organization_name text,
  organization_slug text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  new_org_id uuid;
begin
  select id
  into target_user_id
  from public.app_users
  where lower(email) = lower(user_email)
  order by created_at asc
  limit 1;

  if target_user_id is null then
    raise exception 'No app_users row exists yet for email %', user_email;
  end if;

  insert into public.organizations (name, slug)
  values (organization_name, organization_slug)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, target_user_id, 'owner')
  on conflict (organization_id, user_id)
  do update set role = excluded.role, is_active = true, updated_at = now();

  update public.app_users
  set default_organization_id = new_org_id,
      role = 'admin',
      updated_at = now()
  where id = target_user_id;

  return new_org_id;
end;
$$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  status text not null default 'active'
    check (status in ('active', 'trialing', 'suspended', 'cancelled')),
  billing_plan text not null default 'starter'
    check (billing_plan in ('starter', 'pro', 'team', 'enterprise')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  external_auth_id uuid unique,
  default_organization_id uuid references public.organizations(id) on delete set null,
  email text,
  full_name text,
  role text not null default 'solo_rep'
    check (role in ('solo_rep', 'manager', 'rep', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null default 'rep'
    check (role in ('owner', 'admin', 'manager', 'rep')),
  is_active boolean not null default true,
  invited_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  created_by uuid references public.app_users(id) on delete set null,
  source_name text,
  source_type text not null default 'csv'
    check (source_type in ('csv', 'manual', 'api', 'field')),
  original_filename text,
  row_count integer not null default 0,
  valid_row_count integer not null default 0,
  skipped_row_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  normalized_address text not null,
  address text not null,
  zipcode text,
  lat double precision,
  lng double precision,
  status text not null default 'open'
    check (status in ('open', 'assigned', 'in_progress', 'completed', 'skipped', 'disqualified')),
  assignment_status text not null default 'unassigned'
    check (assignment_status in ('unassigned', 'assigned', 'accepted', 'released')),
  assigned_to uuid references public.app_users(id) on delete set null,
  owner_name text,
  first_name text,
  last_name text,
  phone text,
  email text,
  notes text,
  unqualified boolean,
  unqualified_reason text,
  listing_agent text,
  source text not null default 'imported',
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_analysis (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  cache_key text not null,
  sale_price numeric,
  price_display text,
  value_badge text,
  sqft double precision,
  sqft_display text,
  beds text,
  baths text,
  sold_date text,
  sun_hours double precision,
  sun_hours_display text,
  category text,
  solar_details jsonb not null default '{}'::jsonb,
  priority_score integer not null default 0,
  priority_label text,
  parking_address text,
  parking_ease text,
  doors_to_knock integer not null default 0,
  ideal_count integer not null default 0,
  good_count integer not null default 0,
  walkable_count integer not null default 0,
  street_view_link text,
  value_score integer not null default 0,
  sqft_score integer not null default 0,
  analysis_error text,
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_neighbors (
  id uuid primary key default gen_random_uuid(),
  lead_analysis_id uuid not null references public.lead_analysis(id) on delete cascade,
  address text not null,
  zipcode text,
  lat double precision,
  lng double precision,
  sun_hours double precision,
  sun_hours_display text,
  category text,
  priority_score integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.route_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  name text not null,
  created_by uuid references public.app_users(id) on delete set null,
  assigned_rep_id uuid references public.app_users(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'assigned', 'accepted', 'archived', 'cancelled')),
  selection_mode text not null default 'manual'
    check (selection_mode in ('manual', 'manager_assigned', 'self_selected', 'pool_selected')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.route_draft_stops (
  id uuid primary key default gen_random_uuid(),
  route_draft_id uuid not null references public.route_drafts(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete restrict,
  selected_by uuid references public.app_users(id) on delete set null,
  selection_reason text,
  priority_score integer,
  sort_order integer,
  created_at timestamptz not null default now(),
  unique (route_draft_id, lead_id)
);

create table if not exists public.route_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  route_draft_id uuid references public.route_drafts(id) on delete set null,
  rep_id uuid references public.app_users(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'cancelled')),
  optimization_mode text not null default 'drive_time'
    check (optimization_mode in ('drive_time', 'mileage')),
  started_from_lat double precision,
  started_from_lng double precision,
  started_from_label text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.route_run_stops (
  id uuid primary key default gen_random_uuid(),
  route_run_id uuid not null references public.route_runs(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  source_draft_stop_id uuid references public.route_draft_stops(id) on delete set null,
  is_ad_hoc boolean not null default false,
  address text not null,
  lat double precision,
  lng double precision,
  stop_status text not null default 'pending'
    check (stop_status in ('pending', 'completed', 'skipped', 'failed')),
  outcome text
    check (outcome in ('interested', 'callback', 'not_interested', 'not_home', 'bad_address', 'duplicate') or outcome is null),
  sequence_number integer,
  skipped_reason text,
  homeowner_name text,
  phone text,
  email text,
  best_follow_up_time text,
  interest_level text
    check (interest_level in ('hot', 'warm', 'cold') or interest_level is null),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.route_run_events (
  id uuid primary key default gen_random_uuid(),
  route_run_id uuid not null references public.route_runs(id) on delete cascade,
  route_run_stop_id uuid references public.route_run_stops(id) on delete cascade,
  event_type text not null
    check (event_type in ('run_started', 'stop_completed', 'stop_skipped', 'stop_added', 'route_reoptimized', 'run_paused', 'run_completed')),
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_status_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  old_status text,
  new_status text not null,
  reason text,
  changed_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.app_users(id) on delete cascade,
  name text not null,
  scope text not null default 'lead_pool'
    check (scope in ('lead_pool', 'route_planning', 'rep_view')),
  filter_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete set null,
  event_name text not null,
  event_group text not null default 'app'
    check (event_group in ('app', 'analysis', 'routing', 'export', 'auth', 'billing', 'admin')),
  quantity integer not null default 1,
  event_metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_organizations_slug on public.organizations(slug);
create index if not exists idx_app_users_default_org on public.app_users(default_organization_id);
create index if not exists idx_org_members_org_id on public.organization_members(organization_id);
create index if not exists idx_org_members_user_id on public.organization_members(user_id);
create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_assignment_status on public.leads(assignment_status);
create index if not exists idx_leads_assigned_to on public.leads(assigned_to);
create index if not exists idx_leads_organization_id on public.leads(organization_id);
create unique index if not exists idx_leads_org_normalized_address
on public.leads(organization_id, normalized_address);
create index if not exists idx_leads_zipcode on public.leads(zipcode);
create index if not exists idx_leads_lat_lng on public.leads(lat, lng);
create index if not exists idx_lead_analysis_lead_id on public.lead_analysis(lead_id);
create index if not exists idx_lead_analysis_cache_key on public.lead_analysis(cache_key);
create unique index if not exists idx_lead_analysis_unique_lead_id on public.lead_analysis(lead_id);
create index if not exists idx_lead_neighbors_analysis_id on public.lead_neighbors(lead_analysis_id);
create index if not exists idx_import_batches_org_id on public.import_batches(organization_id);
create index if not exists idx_route_drafts_org_id on public.route_drafts(organization_id);
create index if not exists idx_route_drafts_assigned_rep_id on public.route_drafts(assigned_rep_id);
create index if not exists idx_route_draft_stops_draft_id on public.route_draft_stops(route_draft_id);
create index if not exists idx_route_runs_org_id on public.route_runs(organization_id);
create index if not exists idx_route_runs_rep_id on public.route_runs(rep_id);
create index if not exists idx_route_runs_status on public.route_runs(status);
create index if not exists idx_route_run_stops_run_id on public.route_run_stops(route_run_id);
create index if not exists idx_route_run_stops_status on public.route_run_stops(stop_status);
create index if not exists idx_route_run_events_run_id on public.route_run_events(route_run_id);
create index if not exists idx_lead_status_history_lead_id on public.lead_status_history(lead_id);
create index if not exists idx_saved_filters_org_id on public.saved_filters(organization_id);
create index if not exists idx_usage_events_org_id on public.usage_events(organization_id);
create index if not exists idx_usage_events_user_id on public.usage_events(user_id);
create index if not exists idx_usage_events_event_group on public.usage_events(event_group);
create index if not exists idx_usage_events_occurred_at on public.usage_events(occurred_at);

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists set_app_users_updated_at on public.app_users;
create trigger set_app_users_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

drop trigger if exists set_organization_members_updated_at on public.organization_members;
create trigger set_organization_members_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

drop trigger if exists set_lead_analysis_updated_at on public.lead_analysis;
create trigger set_lead_analysis_updated_at
before update on public.lead_analysis
for each row execute function public.set_updated_at();

drop trigger if exists set_route_drafts_updated_at on public.route_drafts;
create trigger set_route_drafts_updated_at
before update on public.route_drafts
for each row execute function public.set_updated_at();

drop trigger if exists set_route_runs_updated_at on public.route_runs;
create trigger set_route_runs_updated_at
before update on public.route_runs
for each row execute function public.set_updated_at();

drop trigger if exists set_route_run_stops_updated_at on public.route_run_stops;
create trigger set_route_run_stops_updated_at
before update on public.route_run_stops
for each row execute function public.set_updated_at();

drop trigger if exists set_saved_filters_updated_at on public.saved_filters;
create trigger set_saved_filters_updated_at
before update on public.saved_filters
for each row execute function public.set_updated_at();

create or replace view public.open_lead_pool as
select
  l.*,
  a.priority_score,
  a.priority_label,
  a.category,
  a.sun_hours,
  a.sun_hours_display,
  a.solar_details,
  a.doors_to_knock
from public.leads l
left join public.lead_analysis a
  on a.lead_id = l.id
where l.status = 'open'
  and l.assignment_status = 'unassigned';

create or replace view public.active_route_stop_queue as
select
  rrs.*,
  rr.rep_id,
  rr.status as route_status,
  rr.started_at
from public.route_run_stops rrs
join public.route_runs rr
  on rr.id = rrs.route_run_id
where rr.status = 'active'
  and rrs.stop_status = 'pending';

comment on table public.leads is 'Master lead pool shared by managers, solo reps, and assigned reps.';
comment on table public.organizations is 'Sellable account boundary. All customer-owned data should eventually be scoped to an organization.';
comment on table public.organization_members is 'Role membership inside an organization, used by auth, assignment, and future row-level security.';
comment on table public.route_drafts is 'Planning artifact: selected stops before live route execution.';
comment on table public.route_runs is 'Execution artifact: created when a rep starts from live location.';
comment on table public.route_run_stops is 'Live stops that can be completed, skipped, or added ad hoc in the field.';
comment on table public.usage_events is 'Basic usage tracking for billing, support, and abuse prevention.';

alter table public.organizations enable row level security;
alter table public.app_users enable row level security;
alter table public.organization_members enable row level security;
alter table public.import_batches enable row level security;
alter table public.leads enable row level security;
alter table public.lead_analysis enable row level security;
alter table public.lead_neighbors enable row level security;
alter table public.route_drafts enable row level security;
alter table public.route_draft_stops enable row level security;
alter table public.route_runs enable row level security;
alter table public.route_run_stops enable row level security;
alter table public.route_run_events enable row level security;
alter table public.saved_filters enable row level security;
alter table public.usage_events enable row level security;

drop policy if exists "org members can view organizations" on public.organizations;
create policy "org members can view organizations"
on public.organizations
for select
using (id in (select public.current_org_ids()));

drop policy if exists "org owners admins can update organizations" on public.organizations;
create policy "org owners admins can update organizations"
on public.organizations
for update
using (public.has_org_role(id, array['owner', 'admin']))
with check (public.has_org_role(id, array['owner', 'admin']));

drop policy if exists "users can view same org profiles" on public.app_users;
create policy "users can view same org profiles"
on public.app_users
for select
using (
  id = public.current_app_user_id()
  or exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on mine.organization_id = theirs.organization_id
    where mine.user_id = public.current_app_user_id()
      and mine.is_active = true
      and theirs.user_id = public.app_users.id
      and theirs.is_active = true
  )
);

drop policy if exists "users can update own profile" on public.app_users;
create policy "users can update own profile"
on public.app_users
for update
using (id = public.current_app_user_id())
with check (id = public.current_app_user_id());

drop policy if exists "org members can view memberships" on public.organization_members;
create policy "org members can view memberships"
on public.organization_members
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org owners admins manage memberships" on public.organization_members;
create policy "org owners admins manage memberships"
on public.organization_members
for all
using (public.has_org_role(organization_id, array['owner', 'admin']))
with check (public.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists "org members view import batches" on public.import_batches;
create policy "org members view import batches"
on public.import_batches
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers create import batches" on public.import_batches;
create policy "org managers create import batches"
on public.import_batches
for insert
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org managers update import batches" on public.import_batches;
create policy "org managers update import batches"
on public.import_batches
for update
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view leads" on public.leads;
create policy "org members view leads"
on public.leads
for select
using (
  public.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  or (
    public.has_org_role(organization_id, array['rep'])
    and (
      assigned_to = public.current_app_user_id()
      or created_by = public.current_app_user_id()
    )
  )
);

drop policy if exists "org managers manage leads" on public.leads;
create policy "org managers manage leads"
on public.leads
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view lead analysis" on public.lead_analysis;
create policy "org members view lead analysis"
on public.lead_analysis
for select
using (
  exists (
    select 1
    from public.leads l
    where l.id = public.lead_analysis.lead_id
      and (
        public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
        or (
          public.has_org_role(l.organization_id, array['rep'])
          and (
            l.assigned_to = public.current_app_user_id()
            or l.created_by = public.current_app_user_id()
          )
        )
      )
  )
);

drop policy if exists "org managers manage lead analysis" on public.lead_analysis;
create policy "org managers manage lead analysis"
on public.lead_analysis
for all
using (
  exists (
    select 1
    from public.leads l
    where l.id = public.lead_analysis.lead_id
      and public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
  )
)
with check (
  exists (
    select 1
    from public.leads l
    where l.id = public.lead_analysis.lead_id
      and public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
  )
);

drop policy if exists "org members view lead neighbors" on public.lead_neighbors;
create policy "org members view lead neighbors"
on public.lead_neighbors
for select
using (
  exists (
    select 1
    from public.lead_analysis la
    join public.leads l on l.id = la.lead_id
    where la.id = public.lead_neighbors.lead_analysis_id
      and (
        public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
        or (
          public.has_org_role(l.organization_id, array['rep'])
          and (
            l.assigned_to = public.current_app_user_id()
            or l.created_by = public.current_app_user_id()
          )
        )
      )
  )
);

drop policy if exists "org managers manage lead neighbors" on public.lead_neighbors;
create policy "org managers manage lead neighbors"
on public.lead_neighbors
for all
using (
  exists (
    select 1
    from public.lead_analysis la
    join public.leads l on l.id = la.lead_id
    where la.id = public.lead_neighbors.lead_analysis_id
      and public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
  )
)
with check (
  exists (
    select 1
    from public.lead_analysis la
    join public.leads l on l.id = la.lead_id
    where la.id = public.lead_neighbors.lead_analysis_id
      and public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
  )
);

drop policy if exists "org members view route drafts" on public.route_drafts;
create policy "org members view route drafts"
on public.route_drafts
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers manage route drafts" on public.route_drafts;
create policy "org managers manage route drafts"
on public.route_drafts
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view route draft stops" on public.route_draft_stops;
create policy "org members view route draft stops"
on public.route_draft_stops
for select
using (
  exists (
    select 1
    from public.route_drafts rd
    where rd.id = public.route_draft_stops.route_draft_id
      and rd.organization_id in (select public.current_org_ids())
  )
);

drop policy if exists "org managers manage route draft stops" on public.route_draft_stops;
create policy "org managers manage route draft stops"
on public.route_draft_stops
for all
using (
  exists (
    select 1
    from public.route_drafts rd
    where rd.id = public.route_draft_stops.route_draft_id
      and public.has_org_role(rd.organization_id, array['owner', 'admin', 'manager'])
  )
)
with check (
  exists (
    select 1
    from public.route_drafts rd
    where rd.id = public.route_draft_stops.route_draft_id
      and public.has_org_role(rd.organization_id, array['owner', 'admin', 'manager'])
  )
);

drop policy if exists "org members view route runs" on public.route_runs;
create policy "org members view route runs"
on public.route_runs
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org members create route runs" on public.route_runs;
create policy "org members create route runs"
on public.route_runs
for insert
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager', 'rep']));

drop policy if exists "org members update route runs" on public.route_runs;
create policy "org members update route runs"
on public.route_runs
for update
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager', 'rep']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager', 'rep']));

drop policy if exists "org members view route run stops" on public.route_run_stops;
create policy "org members view route run stops"
on public.route_run_stops
for select
using (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_stops.route_run_id
      and rr.organization_id in (select public.current_org_ids())
  )
);

drop policy if exists "org members manage route run stops" on public.route_run_stops;
create policy "org members manage route run stops"
on public.route_run_stops
for all
using (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_stops.route_run_id
      and public.has_org_role(rr.organization_id, array['owner', 'admin', 'manager', 'rep'])
  )
)
with check (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_stops.route_run_id
      and public.has_org_role(rr.organization_id, array['owner', 'admin', 'manager', 'rep'])
  )
);

drop policy if exists "org members view route run events" on public.route_run_events;
create policy "org members view route run events"
on public.route_run_events
for select
using (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_events.route_run_id
      and rr.organization_id in (select public.current_org_ids())
  )
);

drop policy if exists "org members manage route run events" on public.route_run_events;
create policy "org members manage route run events"
on public.route_run_events
for all
using (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_events.route_run_id
      and public.has_org_role(rr.organization_id, array['owner', 'admin', 'manager', 'rep'])
  )
)
with check (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_events.route_run_id
      and public.has_org_role(rr.organization_id, array['owner', 'admin', 'manager', 'rep'])
  )
);

drop policy if exists "users view own saved filters" on public.saved_filters;
create policy "users view own saved filters"
on public.saved_filters
for select
using (
  owner_id = public.current_app_user_id()
  and organization_id in (select public.current_org_ids())
);

drop policy if exists "users manage own saved filters" on public.saved_filters;
create policy "users manage own saved filters"
on public.saved_filters
for all
using (
  owner_id = public.current_app_user_id()
  and organization_id in (select public.current_org_ids())
)
with check (
  owner_id = public.current_app_user_id()
  and organization_id in (select public.current_org_ids())
);

drop policy if exists "org admins view usage events" on public.usage_events;
create policy "org admins view usage events"
on public.usage_events
for select
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members create usage events" on public.usage_events;
create policy "org members create usage events"
on public.usage_events
for insert
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager', 'rep']));
