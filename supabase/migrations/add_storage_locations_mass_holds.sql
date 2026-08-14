-- Резерв под отгрузку и испорченное зерно (не доступно для перемещения).

alter table public.storage_locations
  add column if not exists reserved_tons numeric not null default 0 check (reserved_tons >= 0),
  add column if not exists spoiled_tons numeric not null default 0 check (spoiled_tons >= 0);

comment on column public.storage_locations.reserved_tons is 'Масса, зарезервированная под отгрузку (т), не доступна для перемещения';
comment on column public.storage_locations.spoiled_tons is 'Масса испорченного зерна (т), не доступна для перемещения';
