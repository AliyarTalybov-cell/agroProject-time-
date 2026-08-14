create table if not exists public.equipment_type_refs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.equipment_condition_refs (
  code text primary key check (code in ('operational', 'repair', 'decommissioned')),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.equipment_type_refs (code, name, sort_order)
values
  ('tractor', 'Трактор', 10),
  ('combine', 'Комбайн', 20),
  ('sprayer', 'Опрыскиватель', 30),
  ('other', 'Другое', 40)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order;

insert into public.equipment_condition_refs (code, name, sort_order)
values
  ('operational', 'Исправна', 10),
  ('repair', 'В ремонте', 20),
  ('decommissioned', 'Выведена', 30)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order;

alter table public.equipment_type_refs enable row level security;
alter table public.equipment_condition_refs enable row level security;

drop policy if exists "Allow all for equipment_type_refs" on public.equipment_type_refs;
create policy "Allow all for equipment_type_refs" on public.equipment_type_refs
  for all using (true) with check (true);

drop policy if exists "Allow all for equipment_condition_refs" on public.equipment_condition_refs;
create policy "Allow all for equipment_condition_refs" on public.equipment_condition_refs
  for all using (true) with check (true);
