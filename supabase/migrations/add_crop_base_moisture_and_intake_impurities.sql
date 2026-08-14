alter table public.crops
  add column if not exists base_moisture_percent numeric not null default 14
  check (base_moisture_percent >= 0 and base_moisture_percent < 100);

alter table public.storage_intakes
  add column if not exists base_moisture_percent numeric not null default 14
  check (base_moisture_percent >= 0 and base_moisture_percent < 100),
  add column if not exists weed_impurity_percent numeric not null default 0
  check (weed_impurity_percent >= 0 and weed_impurity_percent <= 100),
  add column if not exists grain_impurity_percent numeric not null default 0
  check (grain_impurity_percent >= 0 and grain_impurity_percent <= 100);
