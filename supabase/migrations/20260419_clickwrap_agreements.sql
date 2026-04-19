create table if not exists public.agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  agreement_hash text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists agreements_user_version_idx
  on public.agreements (user_id, version);

create index if not exists agreements_user_id_idx
  on public.agreements (user_id);
