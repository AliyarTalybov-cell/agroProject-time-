-- Геоточка земли (центр/опорная точка) в явном виде: широта/долгота.

alter table public.lands
  add column if not exists center_lat double precision,
  add column if not exists center_lon double precision;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lands_center_lat_check') then
    alter table public.lands
      add constraint lands_center_lat_check
      check (center_lat is null or (center_lat >= -90 and center_lat <= 90));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lands_center_lon_check') then
    alter table public.lands
      add constraint lands_center_lon_check
      check (center_lon is null or (center_lon >= -180 and center_lon <= 180));
  end if;
end $$;

create index if not exists idx_lands_center_lat_lon on public.lands(center_lat, center_lon);
