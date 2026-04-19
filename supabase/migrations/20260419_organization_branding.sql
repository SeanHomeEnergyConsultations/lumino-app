alter table public.organizations
  add column if not exists brand_name text,
  add column if not exists logo_url text,
  add column if not exists primary_color text,
  add column if not exists accent_color text;
