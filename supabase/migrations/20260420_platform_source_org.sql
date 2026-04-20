alter table public.organizations
  add column if not exists is_platform_source boolean not null default false;

update public.organizations
set is_platform_source = true
where id in (
  select distinct source_organization_id
  from public.platform_datasets
  where source_organization_id is not null
);

update public.organizations
set is_platform_source = true
where lower(name) in ('solariq', 'lumino')
  and not exists (
    select 1
    from public.organizations
    where is_platform_source
  );

with ranked as (
  select
    id,
    row_number() over (
      order by
        case when lower(name) = 'solariq' then 0 else 1 end,
        created_at asc,
        id asc
    ) as row_number
  from public.organizations
  where is_platform_source
)
update public.organizations
set is_platform_source = false
where id in (
  select id
  from ranked
  where row_number > 1
);

update public.organizations
set
  billing_plan = 'intelligence',
  status = 'active',
  updated_at = now()
where is_platform_source;

create unique index if not exists organizations_single_platform_source_idx
  on public.organizations (is_platform_source)
  where is_platform_source;
