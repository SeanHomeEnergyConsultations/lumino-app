create table if not exists public.app_branding_settings (
  id text primary key default 'default',
  app_name text not null default 'Lumino',
  logo_url text null,
  primary_color text null,
  accent_color text null,
  theme_config jsonb not null default '{}'::jsonb,
  updated_by uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_branding_settings is
  'Platform-wide application branding defaults controlled by the platform owner.';

insert into public.app_branding_settings (id, app_name, primary_color, accent_color)
values ('default', 'Lumino', '#0b1220', '#94a3b8')
on conflict (id) do nothing;
