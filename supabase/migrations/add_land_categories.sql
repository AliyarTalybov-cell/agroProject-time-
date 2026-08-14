-- Справочник "Категории земли"

create table if not exists public.land_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.land_categories enable row level security;
drop policy if exists "Allow all for land_categories" on public.land_categories;
create policy "Allow all for land_categories"
  on public.land_categories
  for all using (true) with check (true);
