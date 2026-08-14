-- Культура для поля "Отнесение к сельхозугодьям" (связь со справочником crops по key).

alter table public.lands
  add column if not exists agri_land_crop_key text;

create index if not exists idx_lands_agri_land_crop_key on public.lands(agri_land_crop_key);
