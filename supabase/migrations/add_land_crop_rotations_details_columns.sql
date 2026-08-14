alter table public.land_crop_rotations
  add column if not exists season text,
  add column if not exists rotation_type text,
  add column if not exists crop_key text,
  add column if not exists seed_material_name text,
  add column if not exists area_for_crops_ha numeric,
  add column if not exists area_with_improved_products_ha numeric,
  add column if not exists area_for_organic_ha numeric,
  add column if not exists area_for_selection_seed_ha numeric,
  add column if not exists produced_products_info text,
  add column if not exists produced_crop_mass_tons numeric;

alter table public.land_crop_rotations
  drop constraint if exists chk_land_crop_rotations_area_for_crops_ha_nonnegative,
  add constraint chk_land_crop_rotations_area_for_crops_ha_nonnegative check (area_for_crops_ha is null or area_for_crops_ha >= 0),
  drop constraint if exists chk_land_crop_rotations_area_with_improved_products_ha_nonnegative,
  add constraint chk_land_crop_rotations_area_with_improved_products_ha_nonnegative check (area_with_improved_products_ha is null or area_with_improved_products_ha >= 0),
  drop constraint if exists chk_land_crop_rotations_area_for_organic_ha_nonnegative,
  add constraint chk_land_crop_rotations_area_for_organic_ha_nonnegative check (area_for_organic_ha is null or area_for_organic_ha >= 0),
  drop constraint if exists chk_land_crop_rotations_area_for_selection_seed_ha_nonnegative,
  add constraint chk_land_crop_rotations_area_for_selection_seed_ha_nonnegative check (area_for_selection_seed_ha is null or area_for_selection_seed_ha >= 0),
  drop constraint if exists chk_land_crop_rotations_produced_crop_mass_tons_nonnegative,
  add constraint chk_land_crop_rotations_produced_crop_mass_tons_nonnegative check (produced_crop_mass_tons is null or produced_crop_mass_tons >= 0);
