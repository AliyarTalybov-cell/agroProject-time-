create table if not exists public.land_melioration_event_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.land_melioration_event_types enable row level security;

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

drop policy if exists "land_melioration_event_types_select_all" on public.land_melioration_event_types;
drop policy if exists "land_melioration_event_types_insert_all" on public.land_melioration_event_types;
drop policy if exists "land_melioration_event_types_update_all" on public.land_melioration_event_types;
drop policy if exists "land_melioration_event_types_delete_manager_only" on public.land_melioration_event_types;

create policy "land_melioration_event_types_select_all"
  on public.land_melioration_event_types for select
  using (true);

create policy "land_melioration_event_types_insert_all"
  on public.land_melioration_event_types for insert
  with check (true);

create policy "land_melioration_event_types_update_all"
  on public.land_melioration_event_types for update
  using (true)
  with check (true);

create policy "land_melioration_event_types_delete_manager_only"
  on public.land_melioration_event_types for delete
  using (public.is_manager_role());

