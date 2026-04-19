alter table public.properties
  add column if not exists solar_fit_score integer,
  add column if not exists roof_capacity_score integer,
  add column if not exists roof_complexity_score integer,
  add column if not exists estimated_system_capacity_kw numeric,
  add column if not exists estimated_yearly_energy_kwh numeric,
  add column if not exists solar_imagery_quality text,
  add column if not exists property_priority_score integer,
  add column if not exists property_priority_label text,
  add column if not exists priority_last_computed_at timestamptz;
