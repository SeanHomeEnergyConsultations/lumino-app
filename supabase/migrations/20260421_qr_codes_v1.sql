create table if not exists public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references public.app_users(id) on delete cascade,
  territory_id uuid references public.territories(id) on delete set null,
  label text not null,
  slug text not null unique,
  code_type text not null default 'contact_card'
    check (code_type in ('contact_card', 'campaign_tracker')),
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists qr_codes_organization_owner_idx
  on public.qr_codes (organization_id, owner_user_id, created_at desc);

create index if not exists qr_codes_organization_territory_idx
  on public.qr_codes (organization_id, territory_id, created_at desc);

create table if not exists public.qr_code_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  qr_code_id uuid not null references public.qr_codes(id) on delete cascade,
  event_type text not null
    check (event_type in (
      'scan',
      'call_click',
      'text_click',
      'email_click',
      'website_click',
      'book_click',
      'save_contact',
      'appointment_booked'
    )),
  ip_address text,
  user_agent text,
  device text,
  browser text,
  country text,
  region text,
  city text,
  postal_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists qr_code_events_code_created_idx
  on public.qr_code_events (qr_code_id, created_at desc);

create index if not exists qr_code_events_org_type_created_idx
  on public.qr_code_events (organization_id, event_type, created_at desc);

alter table if exists public.appointments
  add column if not exists appointment_type text
    check (appointment_type in ('phone_call', 'in_person_consult'));

alter table if exists public.qr_codes enable row level security;
alter table if exists public.qr_code_events enable row level security;
