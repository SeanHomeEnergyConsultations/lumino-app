create table if not exists public.security_rate_limits (
  id uuid primary key default gen_random_uuid(),
  bucket_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_key, window_started_at)
);

create index if not exists idx_security_rate_limits_expires_at
  on public.security_rate_limits (expires_at);

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.app_users(id) on delete set null,
  target_user_id uuid references public.app_users(id) on delete set null,
  event_type text not null,
  severity text not null default 'info'
    check (severity in ('info', 'low', 'medium', 'high')),
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_events_org_created_at
  on public.security_events (organization_id, created_at desc);

create index if not exists idx_security_events_actor_created_at
  on public.security_events (actor_user_id, created_at desc);
