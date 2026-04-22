insert into storage.buckets (id, name, public)
select 'organization-brand-assets', 'organization-brand-assets', true
where not exists (
  select 1
  from storage.buckets
  where id = 'organization-brand-assets'
);
