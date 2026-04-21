alter table public.organizations
add column if not exists theme_config jsonb not null default '{}'::jsonb;

comment on column public.organizations.theme_config is
  'Organization-managed visual theme tokens for shell background and surface styling.';
