alter table public.leads
drop constraint if exists leads_normalized_address_key;

create unique index if not exists idx_leads_org_normalized_address
on public.leads(organization_id, normalized_address);

alter table public.lead_analysis
drop constraint if exists lead_analysis_cache_key_key;

create index if not exists idx_lead_analysis_cache_key
on public.lead_analysis(cache_key);

create unique index if not exists idx_lead_analysis_unique_lead_id
on public.lead_analysis(lead_id);
