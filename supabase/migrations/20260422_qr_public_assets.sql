insert into storage.buckets (id, name, public)
select 'qr-public-assets', 'qr-public-assets', true
where not exists (
  select 1 from storage.buckets where id = 'qr-public-assets'
);
