create table if not exists public.property_source_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  source_type text not null check (
    source_type in ('csv_import', 'spreadsheet_import', 'crm_import', 'manual_entry', 'api_ingest', 'other')
  ),
  source_name text,
  source_batch_id text,
  source_record_id text,
  source_url text,
  record_date date,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists property_source_records_property_idx
  on public.property_source_records (property_id, created_at desc);

create index if not exists property_source_records_org_type_idx
  on public.property_source_records (organization_id, source_type, created_at desc);

create index if not exists property_source_records_payload_gin_idx
  on public.property_source_records using gin (payload);
