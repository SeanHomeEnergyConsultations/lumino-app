create table if not exists public.organization_features (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enrichment_enabled boolean,
  priority_scoring_enabled boolean,
  advanced_imports_enabled boolean,
  security_console_enabled boolean,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organization_features_updated_by
  on public.organization_features (updated_by);

drop trigger if exists set_organization_features_updated_at on public.organization_features;
create trigger set_organization_features_updated_at
before update on public.organization_features
for each row execute function public.set_updated_at();
