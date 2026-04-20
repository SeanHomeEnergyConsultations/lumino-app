alter table public.organizations
  drop constraint if exists organizations_billing_plan_check;

update public.organizations
set billing_plan = case
  when billing_plan = 'team' then 'pro'
  when billing_plan = 'enterprise' then 'intelligence'
  else billing_plan
end
where billing_plan in ('team', 'enterprise');

alter table public.organizations
  add constraint organizations_billing_plan_check
  check (billing_plan in ('free', 'starter', 'pro', 'intelligence'));

create table if not exists public.organization_upload_consents (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  consent_version text not null,
  accepted_at timestamptz not null default now(),
  accepted_by uuid not null references public.app_users(id) on delete restrict,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organization_upload_consents_accepted_by
  on public.organization_upload_consents (accepted_by);

drop trigger if exists set_organization_upload_consents_updated_at on public.organization_upload_consents;
create trigger set_organization_upload_consents_updated_at
before update on public.organization_upload_consents
for each row execute function public.set_updated_at();

alter table public.import_batches
  add column if not exists contribution_mode text not null default 'private'
    check (contribution_mode in ('private', 'contributed')),
  add column if not exists contribution_terms_version text,
  add column if not exists contribution_consented_at timestamptz,
  add column if not exists contribution_consented_by uuid references public.app_users(id) on delete set null;

create index if not exists idx_import_batches_contribution_mode
  on public.import_batches (organization_id, contribution_mode, created_at desc);
