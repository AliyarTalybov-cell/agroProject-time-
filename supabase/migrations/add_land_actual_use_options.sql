-- Справочник "Фактическое использование участка"

create table if not exists public.land_actual_use_options (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.land_actual_use_options enable row level security;
drop policy if exists "Allow all for land_actual_use_options" on public.land_actual_use_options;
create policy "Allow all for land_actual_use_options"
  on public.land_actual_use_options
  for all using (true) with check (true);
