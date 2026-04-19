create table if not exists public.platform_datasets (
  id uuid primary key default gen_random_uuid(),
  source_organization_id uuid not null references public.organizations(id) on delete cascade,
  source_batch_id uuid not null references public.import_batches(id) on delete cascade unique,
  name text not null,
  description text,
  list_type text not null
    check (list_type in ('general_canvass_list', 'homeowner_leads', 'sold_properties', 'solar_permits', 'roofing_permits', 'custom')),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_dataset_access (
  id uuid primary key default gen_random_uuid(),
  platform_dataset_id uuid not null references public.platform_datasets(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  visibility_scope text not null default 'organization'
    check (visibility_scope in ('organization', 'team', 'assigned_user')),
  assigned_team_id uuid references public.teams(id) on delete set null,
  assigned_user_id uuid references public.app_users(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused')),
  granted_by uuid references public.app_users(id) on delete set null,
  last_released_batch_id uuid references public.import_batches(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_dataset_id, organization_id)
);

create index if not exists idx_platform_datasets_source_org
  on public.platform_datasets (source_organization_id, created_at desc);

create index if not exists idx_dataset_access_org
  on public.organization_dataset_access (organization_id, granted_at desc);

drop trigger if exists set_platform_datasets_updated_at on public.platform_datasets;
create trigger set_platform_datasets_updated_at
before update on public.platform_datasets
for each row execute function public.set_updated_at();

drop trigger if exists set_dataset_access_updated_at on public.organization_dataset_access;
create trigger set_dataset_access_updated_at
before update on public.organization_dataset_access
for each row execute function public.set_updated_at();
