-- Реестр мест хранения: склады, силосы, тока и бурты.

create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_type text not null,
  address text not null,
  fgis_grain_code text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_storage_locations_sort_order on public.storage_locations(sort_order);
create index if not exists idx_storage_locations_name on public.storage_locations(name);
create index if not exists idx_storage_locations_fgis_grain_code on public.storage_locations(fgis_grain_code);

alter table public.storage_locations enable row level security;

create or replace function public.is_manager_role()
returns boolean
language sql
stable
as $$
  select
    coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
$$;

grant execute on function public.is_manager_role() to authenticated;

drop policy if exists storage_locations_select_all on public.storage_locations;
create policy storage_locations_select_all
  on public.storage_locations
  for select
  using (true);

drop policy if exists storage_locations_insert_all on public.storage_locations;
create policy storage_locations_insert_all
  on public.storage_locations
  for insert
  with check (true);

drop policy if exists storage_locations_update_all on public.storage_locations;
create policy storage_locations_update_all
  on public.storage_locations
  for update
  using (true)
  with check (true);

drop policy if exists storage_locations_delete_manager_only on public.storage_locations;
create policy storage_locations_delete_manager_only
  on public.storage_locations
  for delete
  using (public.is_manager_role());
