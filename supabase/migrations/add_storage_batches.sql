-- Партии зерна, сформированные из валовых сборов по месту хранения.

create table if not exists public.storage_batches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  storage_location_id uuid not null references public.storage_locations (id) on delete cascade,
  crop_key text references public.crops (key) on update cascade on delete set null,
  purpose text not null default 'export',
  use_goal text not null default 'food',
  quality jsonb not null default '{}'::jsonb,
  total_net_tons numeric not null default 0 check (total_net_tons >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.storage_intakes
  add column if not exists batch_id uuid references public.storage_batches (id) on delete set null;

create index if not exists idx_storage_batches_storage_location_id
  on public.storage_batches (storage_location_id, created_at desc);

create index if not exists idx_storage_intakes_batch_id
  on public.storage_intakes (batch_id);

alter table public.storage_batches enable row level security;

drop policy if exists storage_batches_select_all on public.storage_batches;
create policy storage_batches_select_all
  on public.storage_batches for select using (true);

drop policy if exists storage_batches_insert_all on public.storage_batches;
create policy storage_batches_insert_all
  on public.storage_batches for insert with check (true);

drop policy if exists storage_batches_update_all on public.storage_batches;
create policy storage_batches_update_all
  on public.storage_batches for update using (true) with check (true);

drop policy if exists storage_batches_delete_manager_only on public.storage_batches;
create policy storage_batches_delete_manager_only
  on public.storage_batches for delete using (public.is_manager_role());
