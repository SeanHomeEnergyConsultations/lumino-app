create table if not exists public.user_google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'google_calendar' check (provider = 'google_calendar'),
  calendar_id text not null default 'primary',
  calendar_email text,
  access_token text,
  refresh_token text not null,
  token_scope text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider)
);

create index if not exists user_google_calendar_connections_user_idx
  on public.user_google_calendar_connections (user_id, provider);

create table if not exists public.google_calendar_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'google_calendar' check (provider = 'google_calendar'),
  state_token text not null unique,
  redirect_path text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists google_calendar_oauth_states_lookup_idx
  on public.google_calendar_oauth_states (state_token, provider);

create table if not exists public.appointment_calendar_syncs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  provider text not null default 'google_calendar' check (provider = 'google_calendar'),
  calendar_id text not null default 'primary',
  external_event_id text,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'synced', 'error', 'deleted')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, lead_id, provider)
);

create index if not exists appointment_calendar_syncs_user_idx
  on public.appointment_calendar_syncs (user_id, provider, sync_status);
