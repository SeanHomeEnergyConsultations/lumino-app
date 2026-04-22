alter table public.performance_competitions
add column if not exists scope text not null default 'individual'
  check (scope in ('individual', 'team'));

comment on column public.performance_competitions.scope is
  'Whether the competition ranks individual reps or aggregated org teams.';
