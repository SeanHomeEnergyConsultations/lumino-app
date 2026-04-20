create table if not exists public.platform_dataset_records (
  id uuid primary key default gen_random_uuid(),
  platform_dataset_id uuid not null references public.platform_datasets(id) on delete cascade,
  source_batch_item_id uuid not null references public.import_batch_items(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  normalized_address text,
  raw_address text,
  city text,
  state text,
  postal_code text,
  lat double precision,
  lng double precision,
  source_payload jsonb not null default '{}'::jsonb,
  analysis_payload jsonb,
  property_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_dataset_id, source_batch_item_id)
);

create index if not exists idx_platform_dataset_records_dataset
  on public.platform_dataset_records (platform_dataset_id, created_at desc);

create index if not exists idx_platform_dataset_records_property
  on public.platform_dataset_records (property_id);

drop trigger if exists set_platform_dataset_records_updated_at on public.platform_dataset_records;
create trigger set_platform_dataset_records_updated_at
before update on public.platform_dataset_records
for each row execute function public.set_updated_at();

alter table public.organization_dataset_access
  drop constraint if exists organization_dataset_access_status_check;

alter table public.organization_dataset_access
  add constraint organization_dataset_access_status_check
  check (status in ('active', 'paused', 'revoked'));

create table if not exists public.organization_dataset_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  platform_dataset_id uuid not null references public.platform_datasets(id) on delete cascade,
  platform_dataset_record_id uuid not null references public.platform_dataset_records(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  visibility_scope text not null default 'organization'
    check (visibility_scope in ('organization', 'team', 'assigned_user')),
  assigned_team_id uuid references public.teams(id) on delete set null,
  assigned_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, platform_dataset_record_id)
);

create index if not exists idx_organization_dataset_targets_org
  on public.organization_dataset_targets (organization_id, created_at desc);

create index if not exists idx_organization_dataset_targets_property
  on public.organization_dataset_targets (organization_id, property_id);

drop trigger if exists set_organization_dataset_targets_updated_at on public.organization_dataset_targets;
create trigger set_organization_dataset_targets_updated_at
before update on public.organization_dataset_targets
for each row execute function public.set_updated_at();
