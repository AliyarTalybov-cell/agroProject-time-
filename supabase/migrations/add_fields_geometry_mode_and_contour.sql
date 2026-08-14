-- Режим геометрии поля и контур (GeoJSON Polygon).
alter table public.fields
  add column if not exists geometry_mode text not null default 'point',
  add column if not exists contour_geojson jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fields_geometry_mode_check'
  ) then
    alter table public.fields
      add constraint fields_geometry_mode_check
      check (geometry_mode in ('point', 'polygon'));
  end if;
end $$;

