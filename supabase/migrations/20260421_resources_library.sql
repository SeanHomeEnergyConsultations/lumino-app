insert into storage.buckets (id, name, public)
select 'organization-resources', 'organization-resources', false
where not exists (
  select 1 from storage.buckets where id = 'organization-resources'
);

create table if not exists public.organization_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  territory_id uuid references public.territories(id) on delete set null,
  uploaded_by_user_id uuid not null references public.app_users(id) on delete restrict,
  title text not null,
  description text,
  resource_type text not null
    check (resource_type in ('document', 'video', 'printable')),
  storage_bucket text not null default 'organization-resources',
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organization_resources_org_created_idx
  on public.organization_resources (organization_id, created_at desc);

create index if not exists organization_resources_org_type_idx
  on public.organization_resources (organization_id, resource_type, created_at desc);

create index if not exists organization_resources_org_territory_idx
  on public.organization_resources (organization_id, territory_id, created_at desc);

alter table if exists public.organization_resources enable row level security;
