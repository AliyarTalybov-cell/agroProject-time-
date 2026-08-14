-- Add implements dictionary and link it to equipment
create table if not exists public.equipment_implements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  purpose text,
  description text,
  "condition" text not null default 'operational' check ("condition" in ('operational', 'repair', 'decommissioned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.equipment_implements enable row level security;

drop policy if exists "Allow all for equipment_implements" on public.equipment_implements;
create policy "Allow all for equipment_implements" on public.equipment_implements
  for all using (true) with check (true);

alter table public.equipment
  add column if not exists implement_id uuid references public.equipment_implements(id) on delete set null;

create index if not exists equipment_implement_id_idx on public.equipment (implement_id);
