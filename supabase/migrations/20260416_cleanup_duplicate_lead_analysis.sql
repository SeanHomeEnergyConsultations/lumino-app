with ranked_analysis as (
  select
    id,
    lead_id,
    row_number() over (
      partition by lead_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_rank
  from public.lead_analysis
  where lead_id is not null
),
duplicate_analysis as (
  select id
  from ranked_analysis
  where row_rank > 1
)
delete from public.lead_neighbors
where lead_analysis_id in (select id from duplicate_analysis);

with ranked_analysis as (
  select
    id,
    lead_id,
    row_number() over (
      partition by lead_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_rank
  from public.lead_analysis
  where lead_id is not null
)
delete from public.lead_analysis
where id in (
  select id
  from ranked_analysis
  where row_rank > 1
);

create unique index if not exists idx_lead_analysis_unique_lead_id
on public.lead_analysis(lead_id);

create or replace view public.open_lead_pool as
select
  l.*,
  a.sale_price,
  a.price_display,
  a.sqft,
  a.sqft_display,
  a.beds,
  a.baths,
  a.sold_date,
  a.permit_pulled,
  a.priority_score,
  a.priority_label,
  a.category,
  a.sun_hours,
  a.sun_hours_display,
  a.solar_details,
  a.doors_to_knock
from public.leads l
left join lateral (
  select *
  from public.lead_analysis a
  where a.lead_id = l.id
  order by a.updated_at desc nulls last, a.created_at desc nulls last, a.id desc
  limit 1
) a on true
where l.status = 'open'
  and l.assignment_status = 'unassigned';
