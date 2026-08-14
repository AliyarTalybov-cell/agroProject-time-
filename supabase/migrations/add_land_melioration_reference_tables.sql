create table if not exists public.land_melioration_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.land_melioration_subtypes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.land_melioration_types enable row level security;
alter table public.land_melioration_subtypes enable row level security;

drop policy if exists "Allow all for land_melioration_types" on public.land_melioration_types;
create policy "Allow all for land_melioration_types" on public.land_melioration_types
  for all using (true) with check (true);

drop policy if exists "Allow all for land_melioration_subtypes" on public.land_melioration_subtypes;
create policy "Allow all for land_melioration_subtypes" on public.land_melioration_subtypes
  for all using (true) with check (true);
