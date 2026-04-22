create table if not exists public.user_booking_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references public.app_users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organization_id, owner_user_id)
);

create index if not exists user_booking_profiles_owner_idx
  on public.user_booking_profiles (organization_id, owner_user_id);
