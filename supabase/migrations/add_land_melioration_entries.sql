create table if not exists public.land_melioration_entries (
  id uuid primary key default gen_random_uuid(),
  land_id uuid not null references public.lands(id) on delete cascade,
  field_id uuid null references public.fields(id) on delete set null,
  crop_key text null,
  area_ha numeric(14,4) null,
  melioration_kind text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_land_melioration_entries_land_id on public.land_melioration_entries(land_id);
create index if not exists idx_land_melioration_entries_kind on public.land_melioration_entries(melioration_kind);

alter table public.land_melioration_entries enable row level security;

drop policy if exists "Allow all for land_melioration_entries" on public.land_melioration_entries;
create policy "Allow all for land_melioration_entries" on public.land_melioration_entries
  for all
  to public
  using (true)
  with check (true);
