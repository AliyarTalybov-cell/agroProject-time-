-- "Отнесение к сельхозугодьям" = ссылка на тип земли

alter table public.lands
  add column if not exists agri_land_type_id uuid references public.land_types(id) on delete set null;

create index if not exists idx_lands_agri_land_type_id on public.lands(agri_land_type_id);
