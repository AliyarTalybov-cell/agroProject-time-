-- Расширение lands под структуру ЕФГИС ЗСН:
-- шапка карточки + вкладка "Сведения об участке".

alter table public.lands
  add column if not exists land_category text,                         -- Категория земель
  add column if not exists region text,                                -- Регион
  add column if not exists permitted_use_docs text,                    -- Вид разрешенного использования по документам
  add column if not exists efgis_zsn_field_number text,                -- Номер поля ЕФГИС ЗСН (внешний идентификатор)
  add column if not exists document_area_ha numeric,                   -- Площадь по документам, га
  add column if not exists coordinate_area_ha numeric,                 -- Площадь по координатам, га
  add column if not exists is_agri_land boolean,                       -- Отнесение к сельхозугодьям
  add column if not exists agri_land_area_ha numeric,                  -- Площадь сельхозугодий, га
  add column if not exists is_valuable_agri_land boolean,              -- Отнесение к особо ценным продуктивным угодьям
  add column if not exists irrigated_area_ha numeric,                  -- Фактически орошаемая площадь, га
  add column if not exists drained_area_ha numeric,                    -- Фактически осушаемая площадь, га
  add column if not exists actual_use_status text,                     -- Фактическое использование участка
  add column if not exists breeding_use boolean,                       -- Использование для племенного животноводства/селекции/семеноводства
  add column if not exists other_use_info text;                        -- Иные сведения об использовании

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lands_document_area_ha_check') then
    alter table public.lands
      add constraint lands_document_area_ha_check
      check (document_area_ha is null or document_area_ha >= 0);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lands_coordinate_area_ha_check') then
    alter table public.lands
      add constraint lands_coordinate_area_ha_check
      check (coordinate_area_ha is null or coordinate_area_ha >= 0);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lands_agri_land_area_ha_check') then
    alter table public.lands
      add constraint lands_agri_land_area_ha_check
      check (agri_land_area_ha is null or agri_land_area_ha >= 0);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lands_irrigated_area_ha_check') then
    alter table public.lands
      add constraint lands_irrigated_area_ha_check
      check (irrigated_area_ha is null or irrigated_area_ha >= 0);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lands_drained_area_ha_check') then
    alter table public.lands
      add constraint lands_drained_area_ha_check
      check (drained_area_ha is null or drained_area_ha >= 0);
  end if;
end $$;

create index if not exists idx_lands_region on public.lands(region);
create index if not exists idx_lands_efgis_zsn_field_number on public.lands(efgis_zsn_field_number);
