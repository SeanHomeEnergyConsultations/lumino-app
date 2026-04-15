alter table public.lead_analysis
add column if not exists solar_details jsonb not null default '{}'::jsonb;

create or replace view public.open_lead_pool as
select
  l.*,
  a.priority_score,
  a.priority_label,
  a.category,
  a.sun_hours,
  a.sun_hours_display,
  a.solar_details,
  a.doors_to_knock
from public.leads l
left join public.lead_analysis a
  on a.lead_id = l.id
where l.status = 'open'
  and l.assignment_status = 'unassigned';
