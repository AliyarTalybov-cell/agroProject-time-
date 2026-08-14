create table if not exists public.land_crop_rotations (
  id uuid primary key default gen_random_uuid(),
  land_id uuid not null references public.lands(id) on delete cascade,
  field_id uuid not null references public.fields(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_land_crop_rotations_unique_pair
  on public.land_crop_rotations(land_id, field_id);

create index if not exists idx_land_crop_rotations_land on public.land_crop_rotations(land_id);
create index if not exists idx_land_crop_rotations_field on public.land_crop_rotations(field_id);

alter table public.land_crop_rotations enable row level security;
drop policy if exists "Allow all for land_crop_rotations" on public.land_crop_rotations;
create policy "Allow all for land_crop_rotations"
  on public.land_crop_rotations
  for all using (true) with check (true);
