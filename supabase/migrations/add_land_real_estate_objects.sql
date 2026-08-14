create table if not exists public.land_real_estate_objects (
  id uuid primary key default gen_random_uuid(),
  land_id uuid not null references public.lands(id) on delete cascade,
  field_id uuid null references public.fields(id) on delete set null,
  cadastral_number text not null,
  name text null,
  location_description text null,
  area_sqm numeric null,
  permitted_use text null,
  purpose text null,
  address text null,
  depth_m numeric null,
  height_m numeric null,
  length_m numeric null,
  volume_m3 numeric null,
  burial_depth_m numeric null,
  development_plan text null,
  floors text null,
  underground_floors text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_land_real_estate_objects_land on public.land_real_estate_objects(land_id);
create index if not exists idx_land_real_estate_objects_field on public.land_real_estate_objects(field_id);

alter table public.land_real_estate_objects
  drop constraint if exists chk_land_real_estate_objects_area_sqm_nonnegative,
  add constraint chk_land_real_estate_objects_area_sqm_nonnegative check (area_sqm is null or area_sqm >= 0),
  drop constraint if exists chk_land_real_estate_objects_depth_m_nonnegative,
  add constraint chk_land_real_estate_objects_depth_m_nonnegative check (depth_m is null or depth_m >= 0),
  drop constraint if exists chk_land_real_estate_objects_height_m_nonnegative,
  add constraint chk_land_real_estate_objects_height_m_nonnegative check (height_m is null or height_m >= 0),
  drop constraint if exists chk_land_real_estate_objects_length_m_nonnegative,
  add constraint chk_land_real_estate_objects_length_m_nonnegative check (length_m is null or length_m >= 0),
  drop constraint if exists chk_land_real_estate_objects_volume_m3_nonnegative,
  add constraint chk_land_real_estate_objects_volume_m3_nonnegative check (volume_m3 is null or volume_m3 >= 0),
  drop constraint if exists chk_land_real_estate_objects_burial_depth_m_nonnegative,
  add constraint chk_land_real_estate_objects_burial_depth_m_nonnegative check (burial_depth_m is null or burial_depth_m >= 0);

alter table public.land_real_estate_objects enable row level security;
drop policy if exists "Allow all for land_real_estate_objects" on public.land_real_estate_objects;
create policy "Allow all for land_real_estate_objects"
  on public.land_real_estate_objects
  for all using (true) with check (true);
