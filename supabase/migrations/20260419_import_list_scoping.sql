alter table public.import_batches
  add column if not exists list_type text not null default 'general_canvass_list'
    check (list_type in ('general_canvass_list', 'homeowner_leads', 'sold_properties', 'solar_permits', 'roofing_permits', 'custom')),
  add column if not exists visibility_scope text not null default 'organization'
    check (visibility_scope in ('organization', 'team', 'assigned_user')),
  add column if not exists assigned_team_id uuid references public.teams(id) on delete set null,
  add column if not exists assigned_user_id uuid references public.app_users(id) on delete set null;

alter table public.leads
  add column if not exists list_type text not null default 'general_canvass_list'
    check (list_type in ('general_canvass_list', 'homeowner_leads', 'sold_properties', 'solar_permits', 'roofing_permits', 'custom')),
  add column if not exists visibility_scope text not null default 'organization'
    check (visibility_scope in ('organization', 'team', 'assigned_user')),
  add column if not exists team_id uuid references public.teams(id) on delete set null;

alter table public.property_source_records
  add column if not exists list_type text not null default 'general_canvass_list'
    check (list_type in ('general_canvass_list', 'homeowner_leads', 'sold_properties', 'solar_permits', 'roofing_permits', 'custom')),
  add column if not exists visibility_scope text not null default 'organization'
    check (visibility_scope in ('organization', 'team', 'assigned_user')),
  add column if not exists assigned_team_id uuid references public.teams(id) on delete set null,
  add column if not exists assigned_user_id uuid references public.app_users(id) on delete set null;

create index if not exists idx_import_batches_org_list_visibility
  on public.import_batches (organization_id, list_type, visibility_scope, created_at desc);

create index if not exists idx_import_batches_assigned_user
  on public.import_batches (assigned_user_id, created_at desc);

create index if not exists idx_import_batches_assigned_team
  on public.import_batches (assigned_team_id, created_at desc);

create index if not exists idx_leads_org_list_visibility
  on public.leads (organization_id, list_type, visibility_scope, created_at desc);

create index if not exists idx_leads_team_id
  on public.leads (team_id);

create index if not exists idx_property_source_records_list_visibility
  on public.property_source_records (organization_id, list_type, visibility_scope, created_at desc);
