alter table public.land_melioration_entries
  add column if not exists melioration_type text,
  add column if not exists melioration_subtype text,
  add column if not exists description_location text,
  add column if not exists cadastral_number text,
  add column if not exists commissioned_at date,
  add column if not exists irrigated_area_ha numeric(14,4),
  add column if not exists forest_area_ha numeric(14,4),
  add column if not exists forest_characteristics text,
  add column if not exists forest_year_created integer,
  add column if not exists reconstruction_info text,
  add column if not exists event_type text,
  add column if not exists event_date date,
  add column if not exists project_approval text;
