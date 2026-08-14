-- Поступления валового сбора в конкретное место хранения.

create table if not exists public.storage_intakes (
  id uuid primary key default gen_random_uuid(),
  storage_location_id uuid not null references public.storage_locations (id) on delete cascade,
  received_at timestamptz not null default now(),
  field_id uuid references public.fields (id) on delete set null,
  crop_key text references public.crops (key) on update cascade on delete set null,
  gross_mass_tons numeric not null check (gross_mass_tons > 0),
  moisture_percent numeric not null check (moisture_percent >= 0 and moisture_percent <= 100),
  net_mass_tons numeric not null check (net_mass_tons >= 0),
  comment text,
  batch_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_storage_intakes_storage_location_id
  on public.storage_intakes (storage_location_id, received_at desc);

create index if not exists idx_storage_intakes_field_id
  on public.storage_intakes (field_id);

alter table public.storage_intakes enable row level security;

drop policy if exists storage_intakes_select_all on public.storage_intakes;
create policy storage_intakes_select_all
  on public.storage_intakes for select using (true);

drop policy if exists storage_intakes_insert_all on public.storage_intakes;
create policy storage_intakes_insert_all
  on public.storage_intakes for insert with check (true);

drop policy if exists storage_intakes_update_all on public.storage_intakes;
create policy storage_intakes_update_all
  on public.storage_intakes for update using (true) with check (true);

drop policy if exists storage_intakes_delete_manager_only on public.storage_intakes;
create policy storage_intakes_delete_manager_only
  on public.storage_intakes for delete using (public.is_manager_role());
