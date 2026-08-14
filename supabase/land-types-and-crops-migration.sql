-- Миграция: справочники «Тип земли» и «Культура». Выполни один раз в SQL Editor.

-- Таблицы (если ещё не созданы)
create table if not exists public.land_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create table if not exists public.crops (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  base_moisture_percent numeric not null default 14 check (base_moisture_percent >= 0 and base_moisture_percent < 100),
  sort_order int not null default 0,
  created_at timestamptz default now()
);

alter table public.land_types enable row level security;
alter table public.crops enable row level security;
drop policy if exists "Allow all for land_types" on public.land_types;
create policy "Allow all for land_types" on public.land_types for all using (true) with check (true);
drop policy if exists "Allow all for crops" on public.crops;
create policy "Allow all for crops" on public.crops for all using (true) with check (true);

-- Снять CHECK с fields (имена ограничений могут отличаться)
alter table public.fields drop constraint if exists fields_land_type_check;
alter table public.fields drop constraint if exists fields_crop_key_check;

-- Наполнить справочники
insert into public.land_types (name, sort_order) values
  ('Пашня', 1), ('Залежь', 2), ('Сенокос', 3), ('Пастбище', 4)
on conflict (name) do nothing;

insert into public.crops (key, label, sort_order) values
  ('wheat', 'Пшеница', 1), ('corn', 'Кукуруза', 2), ('soy', 'Соя', 3),
  ('sunflower', 'Подсолнечник', 4), ('none', 'Нет (пар)', 5), ('meadow', 'Многолетние травы', 6)
on conflict (key) do nothing;
