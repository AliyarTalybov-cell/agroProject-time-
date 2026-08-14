alter table public.fields
  add column if not exists municipality text,
  add column if not exists region text;

create table if not exists public.field_municipalities_refs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.field_municipalities_refs enable row level security;

drop policy if exists "Allow all for field_municipalities_refs" on public.field_municipalities_refs;
drop policy if exists field_municipalities_refs_select_all on public.field_municipalities_refs;
drop policy if exists field_municipalities_refs_insert_all on public.field_municipalities_refs;
drop policy if exists field_municipalities_refs_update_all on public.field_municipalities_refs;
drop policy if exists field_municipalities_refs_delete_manager_only on public.field_municipalities_refs;

create policy field_municipalities_refs_select_all
  on public.field_municipalities_refs
  for select
  using (true);

create policy field_municipalities_refs_insert_all
  on public.field_municipalities_refs
  for insert
  with check (true);

create policy field_municipalities_refs_update_all
  on public.field_municipalities_refs
  for update
  using (true)
  with check (true);

create policy field_municipalities_refs_delete_manager_only
  on public.field_municipalities_refs
  for delete
  using (
    coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
  );
