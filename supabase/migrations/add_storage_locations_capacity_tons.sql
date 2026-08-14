-- Номинальная вместимость места хранения по массе зерна (тонны).

alter table public.storage_locations
  add column if not exists capacity_tons numeric(14, 3);

comment on column public.storage_locations.capacity_tons is 'Максимальная масса зерна, которую можно разместить, т';
