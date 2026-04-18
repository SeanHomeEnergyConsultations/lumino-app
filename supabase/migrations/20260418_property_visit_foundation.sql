create extension if not exists postgis;
create extension if not exists pg_trgm;

alter table public.properties
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists country text default 'US',
  add column if not exists household_status text,
  add column if not exists current_lead_id uuid,
  add column if not exists last_visit_at timestamptz,
  add column if not exists last_outcome text,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists visit_count integer not null default 0;

update public.properties
set
  address_line_1 = coalesce(address_line_1, raw_address),
  postal_code = coalesce(postal_code, zipcode)
where address_line_1 is null or postal_code is null;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  manager_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create table if not exists public.territories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  geojson jsonb,
  geom geometry(MultiPolygon, 4326),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists territories_geom_idx
  on public.territories using gist (geom);

create table if not exists public.property_territories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (property_id, territory_id)
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  primary_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id)
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists people_phone_idx on public.people (phone);
create index if not exists people_email_idx on public.people (email);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  user_id uuid not null references public.app_users(id) on delete set null,
  route_run_id uuid references public.route_runs(id) on delete set null,
  outcome text not null check (outcome in (
    'no_answer',
    'not_home',
    'contact_made',
    'interested',
    'callback_requested',
    'not_interested',
    'appointment_set',
    'tenant_not_owner',
    'already_customer',
    'competitor_customer',
    'vacant',
    'do_not_knock',
    'bad_address',
    'gate_no_access'
  )),
  interest_level text check (interest_level in ('low', 'medium', 'high')),
  notes text,
  captured_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

create index if not exists visits_property_idx
  on public.visits (property_id, captured_at desc);

create index if not exists visits_user_idx
  on public.visits (user_id, captured_at desc);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  assigned_to uuid references public.app_users(id) on delete set null,
  created_by uuid references public.app_users(id) on delete set null,
  type text not null check (type in ('call', 'text', 'revisit', 'appointment_confirm', 'manager_review', 'custom')),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled', 'overdue', 'blocked')),
  due_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_assigned_status_due_idx
  on public.tasks (assigned_to, status, due_at);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  assigned_rep_id uuid references public.app_users(id) on delete set null,
  scheduled_at timestamptz not null,
  status text not null check (status in ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('property', 'lead', 'task', 'appointment', 'visit', 'territory', 'user')),
  entity_id uuid not null,
  actor_user_id uuid references public.app_users(id) on delete set null,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activities_entity_idx
  on public.activities (entity_type, entity_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.kpi_fact_daily_rep (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  metric_date date not null,
  doors_knocked integer not null default 0,
  contacts integer not null default 0,
  interested integer not null default 0,
  leads_created integer not null default 0,
  qualified_leads integer not null default 0,
  appointments_set integer not null default 0,
  overdue_tasks integer not null default 0,
  unique (organization_id, user_id, metric_date)
);

create table if not exists public.kpi_fact_daily_territory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  territory_id uuid not null references public.territories(id) on delete cascade,
  metric_date date not null,
  doors_knocked integer not null default 0,
  contacts integer not null default 0,
  leads_created integer not null default 0,
  appointments_set integer not null default 0,
  wins integer not null default 0,
  unique (organization_id, territory_id, metric_date)
);

alter table public.leads
  add column if not exists property_id uuid,
  add column if not exists person_id uuid,
  add column if not exists owner_id uuid,
  add column if not exists source_visit_id uuid,
  add column if not exists last_stage_changed_at timestamptz not null default now(),
  add column if not exists is_closed boolean not null default false,
  add column if not exists interest_level text,
  add column if not exists status_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_property_id_fkey'
  ) then
    alter table public.leads
      add constraint leads_property_id_fkey
      foreign key (property_id) references public.properties(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'leads_person_id_fkey'
  ) then
    alter table public.leads
      add constraint leads_person_id_fkey
      foreign key (person_id) references public.people(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'leads_owner_id_fkey'
  ) then
    alter table public.leads
      add constraint leads_owner_id_fkey
      foreign key (owner_id) references public.app_users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'leads_source_visit_id_fkey'
  ) then
    alter table public.leads
      add constraint leads_source_visit_id_fkey
      foreign key (source_visit_id) references public.visits(id) on delete set null;
  end if;
end $$;

update public.leads l
set property_id = p.id
from public.properties p
where l.property_id is null
  and l.normalized_address = p.normalized_address;

update public.leads
set owner_id = assigned_to
where owner_id is null
  and assigned_to is not null;

update public.leads
set is_closed = true
where lead_status in ('Closed Won', 'Closed Lost', 'Do Not Contact');

create index if not exists leads_property_id_idx on public.leads (property_id);
create index if not exists leads_owner_id_idx on public.leads (owner_id);
create index if not exists leads_source_visit_id_idx on public.leads (source_visit_id);

create or replace view public.property_history_view as
with latest_lead as (
  select distinct on (l.property_id)
    l.property_id,
    l.id as lead_id,
    l.lead_status,
    l.status,
    l.owner_id,
    l.first_name,
    l.last_name,
    l.owner_name,
    l.phone,
    l.email,
    l.notes as lead_notes,
    l.next_follow_up_at,
    l.last_activity_at,
    l.last_activity_type,
    l.last_activity_outcome,
    l.appointment_at,
    l.updated_at
  from public.leads l
  where l.property_id is not null
  order by l.property_id, l.updated_at desc nulls last, l.created_at desc
),
latest_visit as (
  select distinct on (v.property_id)
    v.property_id,
    v.id as visit_id,
    v.user_id as last_visited_by,
    v.outcome as last_visit_outcome,
    v.notes as last_visit_notes,
    v.captured_at as last_visited_at
  from public.visits v
  order by v.property_id, v.captured_at desc, v.created_at desc
),
visit_rollup as (
  select
    v.property_id,
    count(*) as visit_count,
    max(v.captured_at) as most_recent_visit_at
  from public.visits v
  group by v.property_id
)
select
  p.id as property_id,
  p.normalized_address,
  p.raw_address,
  p.address_line_1,
  p.city,
  p.state,
  coalesce(p.postal_code, p.zipcode) as postal_code,
  p.lat,
  p.lng,
  p.household_status,
  p.current_lead_id,
  p.last_visit_at,
  p.last_outcome,
  p.next_follow_up_at,
  vr.visit_count,
  vr.most_recent_visit_at,
  lv.visit_id,
  lv.last_visited_by,
  lv.last_visited_at,
  lv.last_visit_outcome,
  lv.last_visit_notes,
  ll.lead_id,
  ll.lead_status,
  ll.status as lead_record_status,
  ll.owner_id,
  ll.first_name,
  ll.last_name,
  ll.owner_name,
  ll.phone,
  ll.email,
  ll.lead_notes,
  ll.next_follow_up_at as lead_next_follow_up_at,
  ll.last_activity_at,
  ll.last_activity_type,
  ll.last_activity_outcome,
  ll.appointment_at
from public.properties p
left join visit_rollup vr on vr.property_id = p.id
left join latest_visit lv on lv.property_id = p.id
left join latest_lead ll on ll.property_id = p.id;

create or replace view public.map_properties_view as
select
  phv.property_id,
  phv.normalized_address,
  phv.raw_address,
  phv.address_line_1,
  phv.city,
  phv.state,
  phv.postal_code,
  phv.lat,
  phv.lng,
  phv.household_status,
  phv.visit_count,
  phv.most_recent_visit_at,
  phv.last_visited_at,
  phv.last_visited_by,
  phv.last_visit_outcome,
  phv.last_visit_notes,
  phv.lead_id,
  phv.lead_status,
  phv.lead_record_status,
  phv.owner_id,
  phv.first_name,
  phv.last_name,
  phv.owner_name,
  phv.phone,
  phv.email,
  phv.lead_notes,
  phv.lead_next_follow_up_at,
  phv.last_activity_at,
  phv.last_activity_type,
  phv.last_activity_outcome,
  phv.appointment_at,
  case
    when phv.lead_next_follow_up_at is not null and phv.lead_next_follow_up_at < now() then 'overdue'
    when phv.lead_next_follow_up_at is not null and phv.lead_next_follow_up_at::date = now()::date then 'due_today'
    when phv.lead_next_follow_up_at is not null and phv.lead_next_follow_up_at > now() then 'scheduled_future'
    else 'none'
  end as follow_up_state,
  case
    when phv.last_visit_outcome = 'do_not_knock' then 'do_not_knock'
    when phv.lead_status = 'Closed Won' then 'customer'
    when phv.appointment_at is not null then 'appointment_set'
    when coalesce(phv.visit_count, 0) > 0 and phv.lead_next_follow_up_at is not null and phv.lead_next_follow_up_at < now() then 'follow_up_overdue'
    when phv.last_visit_outcome = 'interested' then 'interested'
    when phv.last_visit_outcome = 'callback_requested' then 'callback_requested'
    when phv.last_visit_outcome = 'not_interested' then 'not_interested'
    when coalesce(phv.visit_count, 0) > 0 and phv.lead_id is not null then 'canvassed_with_lead'
    when coalesce(phv.visit_count, 0) > 0 then 'canvassed'
    when phv.lead_id is not null then 'imported_target'
    else 'unworked_property'
  end as map_state
from public.property_history_view phv
where phv.lat is not null
  and phv.lng is not null;

create or replace function public.log_property_visit(
  p_organization_id uuid,
  p_property_id uuid,
  p_user_id uuid,
  p_outcome text,
  p_notes text default null,
  p_interest_level text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_captured_at timestamptz default now(),
  p_route_run_id uuid default null,
  p_follow_up_at timestamptz default null
)
returns uuid
language plpgsql
as $$
declare
  v_visit_id uuid;
begin
  insert into public.visits (
    organization_id,
    property_id,
    user_id,
    route_run_id,
    outcome,
    interest_level,
    notes,
    captured_at,
    lat,
    lng
  )
  values (
    p_organization_id,
    p_property_id,
    p_user_id,
    p_route_run_id,
    p_outcome,
    p_interest_level,
    p_notes,
    coalesce(p_captured_at, now()),
    p_lat,
    p_lng
  )
  returning id into v_visit_id;

  update public.properties
  set
    last_visit_at = coalesce(p_captured_at, now()),
    last_outcome = p_outcome,
    next_follow_up_at = coalesce(p_follow_up_at, next_follow_up_at),
    visit_count = coalesce(visit_count, 0) + 1,
    updated_at = now()
  where id = p_property_id;

  insert into public.activities (
    organization_id,
    entity_type,
    entity_id,
    actor_user_id,
    type,
    data
  )
  values (
    p_organization_id,
    'property',
    p_property_id,
    p_user_id,
    'visit_logged',
    jsonb_build_object(
      'visit_id', v_visit_id,
      'outcome', p_outcome,
      'notes', p_notes,
      'interest_level', p_interest_level,
      'captured_at', coalesce(p_captured_at, now()),
      'lat', p_lat,
      'lng', p_lng,
      'route_run_id', p_route_run_id,
      'follow_up_at', p_follow_up_at
    )
  );

  return v_visit_id;
end;
$$;
