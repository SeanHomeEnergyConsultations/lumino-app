create table if not exists public.performance_competitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.app_users(id) on delete cascade,
  title text not null check (char_length(title) <= 160),
  description text check (description is null or char_length(description) <= 1000),
  metric text not null check (metric in ('knocks', 'opportunities', 'appointments', 'doorhangers')),
  period_type text not null check (period_type in ('day', 'week', 'custom')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (end_at > start_at)
);

create index if not exists performance_competitions_org_status_idx
  on public.performance_competitions (organization_id, status, start_at desc);

alter table public.performance_competitions enable row level security;

drop policy if exists "org members read performance competitions" on public.performance_competitions;
create policy "org members read performance competitions"
on public.performance_competitions
for select
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager', 'rep', 'setter']));

drop policy if exists "org managers manage performance competitions" on public.performance_competitions;
create policy "org managers manage performance competitions"
on public.performance_competitions
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

comment on table public.performance_competitions is
  'Manager-created competitions used in the shared rep performance hub.';

comment on column public.performance_competitions.metric is
  'Visit outcome metric used to rank reps in the competition.';

comment on column public.performance_competitions.period_type is
  'Human-friendly period used when the competition was created.';
