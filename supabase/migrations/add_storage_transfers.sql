-- Перемещения зерна между местами хранения.

create table if not exists public.storage_transfers (
  id uuid primary key default gen_random_uuid(),
  from_storage_location_id uuid not null references public.storage_locations (id) on delete restrict,
  to_storage_location_id uuid not null references public.storage_locations (id) on delete restrict,
  crop_key text references public.crops (key) on update cascade on delete set null,
  mass_tons numeric not null check (mass_tons > 0),
  batch_id uuid references public.storage_batches (id) on delete set null,
  transferred_at timestamptz not null default now(),
  comment text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint storage_transfers_from_to_distinct check (from_storage_location_id <> to_storage_location_id)
);

create index if not exists idx_storage_transfers_from_location
  on public.storage_transfers (from_storage_location_id, transferred_at desc);

create index if not exists idx_storage_transfers_to_location
  on public.storage_transfers (to_storage_location_id, transferred_at desc);

create index if not exists idx_storage_transfers_transferred_at
  on public.storage_transfers (transferred_at desc);

alter table public.storage_transfers enable row level security;

drop policy if exists storage_transfers_select_all on public.storage_transfers;
create policy storage_transfers_select_all
  on public.storage_transfers for select using (true);

drop policy if exists storage_transfers_insert_all on public.storage_transfers;
create policy storage_transfers_insert_all
  on public.storage_transfers for insert with check (true);

drop policy if exists storage_transfers_update_all on public.storage_transfers;
create policy storage_transfers_update_all
  on public.storage_transfers for update using (true) with check (true);

drop policy if exists storage_transfers_delete_manager_only on public.storage_transfers;
create policy storage_transfers_delete_manager_only
  on public.storage_transfers for delete using (public.is_manager_role());
