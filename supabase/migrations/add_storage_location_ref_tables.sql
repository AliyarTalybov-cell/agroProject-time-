-- Справочники мест хранения: типы и статусы. Связь с storage_locations по FK.

create table if not exists public.storage_location_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  constraint storage_location_types_name_unique unique (name)
);

create table if not exists public.storage_location_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  marks_inactive boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  constraint storage_location_statuses_name_unique unique (name)
);

insert into public.storage_location_types (name, sort_order)
values
  ('Склад', 10),
  ('Силос', 20),
  ('Ток', 30),
  ('Бурт', 40)
on conflict (name) do nothing;

insert into public.storage_location_statuses (name, marks_inactive, sort_order)
values
  ('Активен', false, 10),
  ('Не используется', true, 20)
on conflict (name) do nothing;

-- Добавить в справочник типов все фактические значения из существующих строк
insert into public.storage_location_types (name, sort_order)
select distinct trim(sl.location_type), 200
from public.storage_locations sl
where trim(sl.location_type) <> ''
  and not exists (
    select 1 from public.storage_location_types t where t.name = trim(sl.location_type)
  );

alter table public.storage_locations
  add column if not exists location_type_id uuid references public.storage_location_types (id),
  add column if not exists location_status_id uuid references public.storage_location_statuses (id);

update public.storage_locations sl
set location_type_id = t.id
from public.storage_location_types t
where sl.location_type_id is null
  and trim(sl.location_type) = t.name;

update public.storage_locations sl
set location_status_id = s.id
from public.storage_location_statuses s
where sl.location_status_id is null
  and s.name = case when sl.is_active then 'Активен' else 'Не используется' end;

-- Если тип из данных не сопоставился — первый тип по sort_order
update public.storage_locations
set location_type_id = (select id from public.storage_location_types order by sort_order, name limit 1)
where location_type_id is null;

update public.storage_locations
set location_status_id = (select id from public.storage_location_statuses where marks_inactive = false order by sort_order limit 1)
where location_status_id is null;

alter table public.storage_locations
  alter column location_type_id set not null,
  alter column location_status_id set not null;

alter table public.storage_locations
  drop column if exists location_type,
  drop column if exists is_active;

-- RLS справочников (как у storage_locations: удаление только менеджеру)
alter table public.storage_location_types enable row level security;
alter table public.storage_location_statuses enable row level security;

drop policy if exists storage_location_types_select_all on public.storage_location_types;
create policy storage_location_types_select_all
  on public.storage_location_types for select using (true);

drop policy if exists storage_location_types_insert_all on public.storage_location_types;
create policy storage_location_types_insert_all
  on public.storage_location_types for insert with check (true);

drop policy if exists storage_location_types_update_all on public.storage_location_types;
create policy storage_location_types_update_all
  on public.storage_location_types for update using (true) with check (true);

drop policy if exists storage_location_types_delete_manager_only on public.storage_location_types;
create policy storage_location_types_delete_manager_only
  on public.storage_location_types for delete using (public.is_manager_role());

drop policy if exists storage_location_statuses_select_all on public.storage_location_statuses;
create policy storage_location_statuses_select_all
  on public.storage_location_statuses for select using (true);

drop policy if exists storage_location_statuses_insert_all on public.storage_location_statuses;
create policy storage_location_statuses_insert_all
  on public.storage_location_statuses for insert with check (true);

drop policy if exists storage_location_statuses_update_all on public.storage_location_statuses;
create policy storage_location_statuses_update_all
  on public.storage_location_statuses for update using (true) with check (true);

drop policy if exists storage_location_statuses_delete_manager_only on public.storage_location_statuses;
create policy storage_location_statuses_delete_manager_only
  on public.storage_location_statuses for delete using (public.is_manager_role());
