do $$
begin
  if to_regclass('public.land_crop_rotation_types') is null then
    return;
  end if;

  if to_regprocedure('public.is_manager_role()') is null then
    return;
  end if;

  alter table public.land_crop_rotation_types enable row level security;

  drop policy if exists "Allow all for land_crop_rotation_types" on public.land_crop_rotation_types;
  drop policy if exists land_crop_rotation_types_select_all on public.land_crop_rotation_types;
  drop policy if exists land_crop_rotation_types_insert_all on public.land_crop_rotation_types;
  drop policy if exists land_crop_rotation_types_update_all on public.land_crop_rotation_types;
  drop policy if exists land_crop_rotation_types_delete_manager_only on public.land_crop_rotation_types;

  create policy land_crop_rotation_types_select_all
    on public.land_crop_rotation_types
    for select
    using (true);

  create policy land_crop_rotation_types_insert_all
    on public.land_crop_rotation_types
    for insert
    with check (true);

  create policy land_crop_rotation_types_update_all
    on public.land_crop_rotation_types
    for update
    using (true)
    with check (true);

  create policy land_crop_rotation_types_delete_manager_only
    on public.land_crop_rotation_types
    for delete
    using (public.is_manager_role());
end $$;

