-- Списания зерна по партиям.

create table if not exists public.storage_writeoffs (
  id uuid primary key default gen_random_uuid(),
  storage_location_id uuid not null references public.storage_locations (id) on delete cascade,
  batch_id uuid not null references public.storage_batches (id) on delete restrict,
  crop_key text references public.crops (key) on update cascade on delete set null,
  writeoff_type text not null check (writeoff_type in ('sale', 'processing', 'spoilage', 'feed')),
  mass_tons numeric not null check (mass_tons > 0),
  operation_date date not null,
  counterparty text,
  comment text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_storage_writeoffs_location_date
  on public.storage_writeoffs (storage_location_id, operation_date desc, created_at desc);

create index if not exists idx_storage_writeoffs_batch
  on public.storage_writeoffs (batch_id, created_at desc);

alter table public.storage_writeoffs enable row level security;

drop policy if exists storage_writeoffs_select_all on public.storage_writeoffs;
create policy storage_writeoffs_select_all
  on public.storage_writeoffs for select using (true);

drop policy if exists storage_writeoffs_insert_all on public.storage_writeoffs;
create policy storage_writeoffs_insert_all
  on public.storage_writeoffs for insert with check (true);

drop policy if exists storage_writeoffs_update_all on public.storage_writeoffs;
create policy storage_writeoffs_update_all
  on public.storage_writeoffs for update using (true) with check (true);

drop policy if exists storage_writeoffs_delete_manager_only on public.storage_writeoffs;
create policy storage_writeoffs_delete_manager_only
  on public.storage_writeoffs for delete using (public.is_manager_role());
