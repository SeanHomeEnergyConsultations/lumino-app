create table if not exists public.task_calendar_syncs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  provider text not null default 'google_calendar' check (provider = 'google_calendar'),
  calendar_id text not null default 'primary',
  external_event_id text,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'synced', 'error', 'deleted')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, task_id, provider)
);

create index if not exists task_calendar_syncs_user_idx
  on public.task_calendar_syncs (user_id, provider, sync_status);
