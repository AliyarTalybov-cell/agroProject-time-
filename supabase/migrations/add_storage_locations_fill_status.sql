-- Справочник статусов заполнения (партия / зерно). Имя файла: после add_storage_location_ref_tables.sql

create table if not exists public.storage_fill_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  constraint storage_fill_statuses_name_unique unique (name),
  constraint storage_fill_statuses_code_check check (code is null or code in ('empty', 'filling', 'formed'))
);

create unique index if not exists storage_fill_statuses_code_unique
  on public.storage_fill_statuses (code)
  where code is not null;

insert into public.storage_fill_statuses (name, code, sort_order)
values
  ('Пусто', 'empty', 10),
  ('Наполняется', 'filling', 20),
  ('Сформировано', 'formed', 30)
on conflict (name) do nothing;

alter table public.storage_locations
  add column if not exists fill_status_id uuid references public.storage_fill_statuses (id);

update public.storage_locations sl
set fill_status_id = f.id
from public.storage_fill_statuses f
where sl.fill_status_id is null
  and f.code = 'empty';

alter table public.storage_locations
  alter column fill_status_id set not null;

alter table public.storage_fill_statuses enable row level security;

drop policy if exists storage_fill_statuses_select_all on public.storage_fill_statuses;
create policy storage_fill_statuses_select_all
  on public.storage_fill_statuses for select using (true);

drop policy if exists storage_fill_statuses_insert_all on public.storage_fill_statuses;
create policy storage_fill_statuses_insert_all
  on public.storage_fill_statuses for insert with check (true);

drop policy if exists storage_fill_statuses_update_all on public.storage_fill_statuses;
create policy storage_fill_statuses_update_all
  on public.storage_fill_statuses for update using (true) with check (true);

drop policy if exists storage_fill_statuses_delete_manager_only on public.storage_fill_statuses;
create policy storage_fill_statuses_delete_manager_only
  on public.storage_fill_statuses for delete using (public.is_manager_role());
