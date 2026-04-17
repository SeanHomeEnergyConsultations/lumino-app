drop policy if exists "org members view leads" on public.leads;
create policy "org members view leads"
on public.leads
for select
using (
  public.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  or (
    public.has_org_role(organization_id, array['rep'])
    and (
      assigned_to = public.current_app_user_id()
      or created_by = public.current_app_user_id()
    )
  )
);

drop policy if exists "org members view lead analysis" on public.lead_analysis;
create policy "org members view lead analysis"
on public.lead_analysis
for select
using (
  exists (
    select 1
    from public.leads l
    where l.id = public.lead_analysis.lead_id
      and (
        public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
        or (
          public.has_org_role(l.organization_id, array['rep'])
          and (
            l.assigned_to = public.current_app_user_id()
            or l.created_by = public.current_app_user_id()
          )
        )
      )
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
      and (
        public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
        or (
          public.has_org_role(l.organization_id, array['rep'])
          and (
            l.assigned_to = public.current_app_user_id()
            or l.created_by = public.current_app_user_id()
          )
        )
      )
  )
);
