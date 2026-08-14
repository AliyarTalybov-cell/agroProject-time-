create table if not exists public.land_crop_rotation_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

insert into public.land_crop_rotation_types (name, sort_order)
values
  ('Полевой', 10),
  ('Кормовой', 20),
  ('Специальный', 30)
on conflict (name) do nothing;

alter table public.land_crop_rotation_types enable row level security;

drop policy if exists "Allow all for land_crop_rotation_types" on public.land_crop_rotation_types;

create policy "Allow all for land_crop_rotation_types"
  on public.land_crop_rotation_types
  for all
  using (true)
  with check (true);

