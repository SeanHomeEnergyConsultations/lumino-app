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

alter table public.app_users
add column if not exists default_organization_id uuid references public.organizations(id) on delete set null;

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

alter table public.import_batches
add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.leads
add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.route_drafts
add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.route_runs
add column if not exists organization_id uuid references public.organizations(id) on delete set null;

alter table public.saved_filters
add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

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
create index if not exists idx_import_batches_org_id on public.import_batches(organization_id);
create index if not exists idx_leads_organization_id on public.leads(organization_id);
create index if not exists idx_route_drafts_org_id on public.route_drafts(organization_id);
create index if not exists idx_route_runs_org_id on public.route_runs(organization_id);
create index if not exists idx_saved_filters_org_id on public.saved_filters(organization_id);
create index if not exists idx_usage_events_org_id on public.usage_events(organization_id);
create index if not exists idx_usage_events_user_id on public.usage_events(user_id);
create index if not exists idx_usage_events_event_group on public.usage_events(event_group);
create index if not exists idx_usage_events_occurred_at on public.usage_events(occurred_at);

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists set_organization_members_updated_at on public.organization_members;
create trigger set_organization_members_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();
