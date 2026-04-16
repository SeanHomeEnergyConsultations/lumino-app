create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (
    external_auth_id,
    email,
    full_name
  )
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (external_auth_id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.app_users.full_name),
        updated_at = now();

  return new;
end;
$$;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.app_users
  where external_auth_id = auth.uid()
  limit 1;
$$;

create or replace function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where user_id = public.current_app_user_id()
    and is_active = true;
$$;

create or replace function public.has_org_role(org_id uuid, roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = org_id
      and om.user_id = public.current_app_user_id()
      and om.is_active = true
      and (roles is null or om.role = any(roles))
  );
$$;

create or replace function public.bootstrap_organization_for_email(
  user_email text,
  organization_name text,
  organization_slug text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  new_org_id uuid;
begin
  select id
  into target_user_id
  from public.app_users
  where lower(email) = lower(user_email)
  order by created_at asc
  limit 1;

  if target_user_id is null then
    raise exception 'No app_users row exists yet for email %', user_email;
  end if;

  insert into public.organizations (name, slug)
  values (organization_name, organization_slug)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, target_user_id, 'owner')
  on conflict (organization_id, user_id)
  do update set role = excluded.role, is_active = true, updated_at = now();

  update public.app_users
  set default_organization_id = new_org_id,
      role = 'admin',
      updated_at = now()
  where id = target_user_id;

  return new_org_id;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.organizations enable row level security;
alter table public.app_users enable row level security;
alter table public.organization_members enable row level security;
alter table public.import_batches enable row level security;
alter table public.leads enable row level security;
alter table public.lead_analysis enable row level security;
alter table public.lead_neighbors enable row level security;
alter table public.route_drafts enable row level security;
alter table public.route_draft_stops enable row level security;
alter table public.route_runs enable row level security;
alter table public.route_run_stops enable row level security;
alter table public.route_run_events enable row level security;
alter table public.saved_filters enable row level security;
alter table public.usage_events enable row level security;

drop policy if exists "org members can view organizations" on public.organizations;
create policy "org members can view organizations"
on public.organizations
for select
using (id in (select public.current_org_ids()));

drop policy if exists "org owners admins can update organizations" on public.organizations;
create policy "org owners admins can update organizations"
on public.organizations
for update
using (public.has_org_role(id, array['owner', 'admin']))
with check (public.has_org_role(id, array['owner', 'admin']));

drop policy if exists "users can view same org profiles" on public.app_users;
create policy "users can view same org profiles"
on public.app_users
for select
using (
  id = public.current_app_user_id()
  or exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on mine.organization_id = theirs.organization_id
    where mine.user_id = public.current_app_user_id()
      and mine.is_active = true
      and theirs.user_id = public.app_users.id
      and theirs.is_active = true
  )
);

drop policy if exists "users can update own profile" on public.app_users;
create policy "users can update own profile"
on public.app_users
for update
using (id = public.current_app_user_id())
with check (id = public.current_app_user_id());

drop policy if exists "org members can view memberships" on public.organization_members;
create policy "org members can view memberships"
on public.organization_members
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org owners admins manage memberships" on public.organization_members;
create policy "org owners admins manage memberships"
on public.organization_members
for all
using (public.has_org_role(organization_id, array['owner', 'admin']))
with check (public.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists "org members view import batches" on public.import_batches;
create policy "org members view import batches"
on public.import_batches
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers create import batches" on public.import_batches;
create policy "org managers create import batches"
on public.import_batches
for insert
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org managers update import batches" on public.import_batches;
create policy "org managers update import batches"
on public.import_batches
for update
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view leads" on public.leads;
create policy "org members view leads"
on public.leads
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers manage leads" on public.leads;
create policy "org managers manage leads"
on public.leads
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view lead analysis" on public.lead_analysis;
create policy "org members view lead analysis"
on public.lead_analysis
for select
using (
  exists (
    select 1
    from public.leads l
    where l.id = public.lead_analysis.lead_id
      and l.organization_id in (select public.current_org_ids())
  )
);

drop policy if exists "org managers manage lead analysis" on public.lead_analysis;
create policy "org managers manage lead analysis"
on public.lead_analysis
for all
using (
  exists (
    select 1
    from public.leads l
    where l.id = public.lead_analysis.lead_id
      and public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
  )
)
with check (
  exists (
    select 1
    from public.leads l
    where l.id = public.lead_analysis.lead_id
      and public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
  )
);

drop policy if exists "org members view lead neighbors" on public.lead_neighbors;
create policy "org members view lead neighbors"
on public.lead_neighbors
for select
using (
  exists (
    select 1
    from public.lead_analysis la
    join public.leads l on l.id = la.lead_id
    where la.id = public.lead_neighbors.lead_analysis_id
      and l.organization_id in (select public.current_org_ids())
  )
);

drop policy if exists "org managers manage lead neighbors" on public.lead_neighbors;
create policy "org managers manage lead neighbors"
on public.lead_neighbors
for all
using (
  exists (
    select 1
    from public.lead_analysis la
    join public.leads l on l.id = la.lead_id
    where la.id = public.lead_neighbors.lead_analysis_id
      and public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
  )
)
with check (
  exists (
    select 1
    from public.lead_analysis la
    join public.leads l on l.id = la.lead_id
    where la.id = public.lead_neighbors.lead_analysis_id
      and public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
  )
);

drop policy if exists "org members view route drafts" on public.route_drafts;
create policy "org members view route drafts"
on public.route_drafts
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers manage route drafts" on public.route_drafts;
create policy "org managers manage route drafts"
on public.route_drafts
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view route draft stops" on public.route_draft_stops;
create policy "org members view route draft stops"
on public.route_draft_stops
for select
using (
  exists (
    select 1
    from public.route_drafts rd
    where rd.id = public.route_draft_stops.route_draft_id
      and rd.organization_id in (select public.current_org_ids())
  )
);

drop policy if exists "org managers manage route draft stops" on public.route_draft_stops;
create policy "org managers manage route draft stops"
on public.route_draft_stops
for all
using (
  exists (
    select 1
    from public.route_drafts rd
    where rd.id = public.route_draft_stops.route_draft_id
      and public.has_org_role(rd.organization_id, array['owner', 'admin', 'manager'])
  )
)
with check (
  exists (
    select 1
    from public.route_drafts rd
    where rd.id = public.route_draft_stops.route_draft_id
      and public.has_org_role(rd.organization_id, array['owner', 'admin', 'manager'])
  )
);

drop policy if exists "org members view route runs" on public.route_runs;
create policy "org members view route runs"
on public.route_runs
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org members create route runs" on public.route_runs;
create policy "org members create route runs"
on public.route_runs
for insert
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager', 'rep']));

drop policy if exists "org members update route runs" on public.route_runs;
create policy "org members update route runs"
on public.route_runs
for update
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager', 'rep']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager', 'rep']));

drop policy if exists "org members view route run stops" on public.route_run_stops;
create policy "org members view route run stops"
on public.route_run_stops
for select
using (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_stops.route_run_id
      and rr.organization_id in (select public.current_org_ids())
  )
);

drop policy if exists "org members manage route run stops" on public.route_run_stops;
create policy "org members manage route run stops"
on public.route_run_stops
for all
using (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_stops.route_run_id
      and public.has_org_role(rr.organization_id, array['owner', 'admin', 'manager', 'rep'])
  )
)
with check (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_stops.route_run_id
      and public.has_org_role(rr.organization_id, array['owner', 'admin', 'manager', 'rep'])
  )
);

drop policy if exists "org members view route run events" on public.route_run_events;
create policy "org members view route run events"
on public.route_run_events
for select
using (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_events.route_run_id
      and rr.organization_id in (select public.current_org_ids())
  )
);

drop policy if exists "org members manage route run events" on public.route_run_events;
create policy "org members manage route run events"
on public.route_run_events
for all
using (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_events.route_run_id
      and public.has_org_role(rr.organization_id, array['owner', 'admin', 'manager', 'rep'])
  )
)
with check (
  exists (
    select 1
    from public.route_runs rr
    where rr.id = public.route_run_events.route_run_id
      and public.has_org_role(rr.organization_id, array['owner', 'admin', 'manager', 'rep'])
  )
);

drop policy if exists "users view own saved filters" on public.saved_filters;
create policy "users view own saved filters"
on public.saved_filters
for select
using (
  owner_id = public.current_app_user_id()
  and organization_id in (select public.current_org_ids())
);

drop policy if exists "users manage own saved filters" on public.saved_filters;
create policy "users manage own saved filters"
on public.saved_filters
for all
using (
  owner_id = public.current_app_user_id()
  and organization_id in (select public.current_org_ids())
)
with check (
  owner_id = public.current_app_user_id()
  and organization_id in (select public.current_org_ids())
);

drop policy if exists "org admins view usage events" on public.usage_events;
create policy "org admins view usage events"
on public.usage_events
for select
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members create usage events" on public.usage_events;
create policy "org members create usage events"
on public.usage_events
for insert
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager', 'rep']));
