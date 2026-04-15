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

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  external_auth_id uuid unique,
  email text,
  full_name text,
  role text not null default 'solo_rep'
    check (role in ('solo_rep', 'manager', 'rep', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
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
  import_batch_id uuid references public.import_batches(id) on delete set null,
  normalized_address text not null unique,
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
  cache_key text not null unique,
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
  owner_id uuid not null references public.app_users(id) on delete cascade,
  name text not null,
  scope text not null default 'lead_pool'
    check (scope in ('lead_pool', 'route_planning', 'rep_view')),
  filter_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_assignment_status on public.leads(assignment_status);
create index if not exists idx_leads_assigned_to on public.leads(assigned_to);
create index if not exists idx_leads_zipcode on public.leads(zipcode);
create index if not exists idx_leads_lat_lng on public.leads(lat, lng);
create index if not exists idx_lead_analysis_lead_id on public.lead_analysis(lead_id);
create index if not exists idx_lead_neighbors_analysis_id on public.lead_neighbors(lead_analysis_id);
create index if not exists idx_route_drafts_assigned_rep_id on public.route_drafts(assigned_rep_id);
create index if not exists idx_route_draft_stops_draft_id on public.route_draft_stops(route_draft_id);
create index if not exists idx_route_runs_rep_id on public.route_runs(rep_id);
create index if not exists idx_route_runs_status on public.route_runs(status);
create index if not exists idx_route_run_stops_run_id on public.route_run_stops(route_run_id);
create index if not exists idx_route_run_stops_status on public.route_run_stops(stop_status);
create index if not exists idx_route_run_events_run_id on public.route_run_events(route_run_id);
create index if not exists idx_lead_status_history_lead_id on public.lead_status_history(lead_id);

drop trigger if exists set_app_users_updated_at on public.app_users;
create trigger set_app_users_updated_at
before update on public.app_users
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
comment on table public.route_drafts is 'Planning artifact: selected stops before live route execution.';
comment on table public.route_runs is 'Execution artifact: created when a rep starts from live location.';
comment on table public.route_run_stops is 'Live stops that can be completed, skipped, or added ad hoc in the field.';
