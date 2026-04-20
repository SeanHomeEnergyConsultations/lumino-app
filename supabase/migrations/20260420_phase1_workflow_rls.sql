alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.territories enable row level security;
alter table public.property_territories enable row level security;
alter table public.visits enable row level security;
alter table public.tasks enable row level security;
alter table public.appointments enable row level security;
alter table public.activities enable row level security;
alter table public.property_source_records enable row level security;
alter table public.property_enrichments enable row level security;

drop policy if exists "org members view teams" on public.teams;
create policy "org members view teams"
on public.teams
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers manage teams" on public.teams;
create policy "org managers manage teams"
on public.teams
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view team memberships" on public.team_memberships;
create policy "org members view team memberships"
on public.team_memberships
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers manage team memberships" on public.team_memberships;
create policy "org managers manage team memberships"
on public.team_memberships
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view territories" on public.territories;
create policy "org members view territories"
on public.territories
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers manage territories" on public.territories;
create policy "org managers manage territories"
on public.territories
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view property territories" on public.property_territories;
create policy "org members view property territories"
on public.property_territories
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers manage property territories" on public.property_territories;
create policy "org managers manage property territories"
on public.property_territories
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view visits" on public.visits;
create policy "org members view visits"
on public.visits
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org members create visits" on public.visits;
create policy "org members create visits"
on public.visits
for insert
with check (
  organization_id in (select public.current_org_ids())
  and user_id = public.current_app_user_id()
);

drop policy if exists "org managers update visits" on public.visits;
create policy "org managers update visits"
on public.visits
for update
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view tasks" on public.tasks;
create policy "org members view tasks"
on public.tasks
for select
using (
  public.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  or assigned_to = public.current_app_user_id()
  or created_by = public.current_app_user_id()
);

drop policy if exists "org members create tasks" on public.tasks;
create policy "org members create tasks"
on public.tasks
for insert
with check (
  organization_id in (select public.current_org_ids())
  and created_by = public.current_app_user_id()
  and (
    assigned_to is null
    or assigned_to = public.current_app_user_id()
    or public.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  )
);

drop policy if exists "org members update visible tasks" on public.tasks;
create policy "org members update visible tasks"
on public.tasks
for update
using (
  public.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  or assigned_to = public.current_app_user_id()
  or created_by = public.current_app_user_id()
)
with check (
  organization_id in (select public.current_org_ids())
  and (
    public.has_org_role(organization_id, array['owner', 'admin', 'manager'])
    or assigned_to = public.current_app_user_id()
    or created_by = public.current_app_user_id()
  )
);

drop policy if exists "org members view appointments" on public.appointments;
create policy "org members view appointments"
on public.appointments
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org members manage appointments" on public.appointments;
create policy "org members manage appointments"
on public.appointments
for all
using (organization_id in (select public.current_org_ids()))
with check (organization_id in (select public.current_org_ids()));

drop policy if exists "org members view activities" on public.activities;
create policy "org members view activities"
on public.activities
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org members insert activities" on public.activities;
create policy "org members insert activities"
on public.activities
for insert
with check (
  organization_id in (select public.current_org_ids())
  and (
    actor_user_id is null
    or actor_user_id = public.current_app_user_id()
    or public.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  )
);

drop policy if exists "org managers delete activities" on public.activities;
create policy "org managers delete activities"
on public.activities
for delete
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view property source records" on public.property_source_records;
create policy "org members view property source records"
on public.property_source_records
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers manage property source records" on public.property_source_records;
create policy "org managers manage property source records"
on public.property_source_records
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "org members view property enrichments" on public.property_enrichments;
create policy "org members view property enrichments"
on public.property_enrichments
for select
using (organization_id in (select public.current_org_ids()));

drop policy if exists "org managers manage property enrichments" on public.property_enrichments;
create policy "org managers manage property enrichments"
on public.property_enrichments
for all
using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'manager']));
