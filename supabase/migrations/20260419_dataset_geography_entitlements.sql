create table if not exists public.organization_dataset_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dataset_type text not null
    check (dataset_type in ('sold_properties', 'solar_permits', 'roofing_permits')),
  geography_type text not null
    check (geography_type in ('city', 'zip')),
  geography_value text not null,
  geography_value_normalized text not null,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dataset_type, geography_type, geography_value_normalized)
);

create index if not exists idx_org_dataset_entitlements_org
  on public.organization_dataset_entitlements (organization_id, dataset_type, geography_type, status);

drop trigger if exists set_organization_dataset_entitlements_updated_at on public.organization_dataset_entitlements;
create trigger set_organization_dataset_entitlements_updated_at
before update on public.organization_dataset_entitlements
for each row execute function public.set_updated_at();
