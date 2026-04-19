alter table public.app_users
  add column if not exists platform_role text
    check (platform_role in ('platform_owner', 'platform_support'));

create index if not exists idx_app_users_platform_role
  on public.app_users (platform_role);
