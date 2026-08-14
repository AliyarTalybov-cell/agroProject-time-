-- Базовые сущности для учета земель:
-- lands (земли) -> fields (поля, опциональная привязка)
-- + права владения и землепользователи.

create table if not exists public.land_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.land_types
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.lands (
  id uuid primary key default gen_random_uuid(),
  number int not null default 1,
  name text not null,
  land_type_id uuid null references public.land_types(id) on delete set null,
  area numeric not null default 0 check (area >= 0),
  cadastral_number text,
  address text,
  location_description text,
  geometry_mode text not null default 'polygon',
  contour_geojson jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lands
  add column if not exists number int not null default 1,
  add column if not exists name text,
  add column if not exists land_type_id uuid null references public.land_types(id) on delete set null,
  add column if not exists area numeric not null default 0 check (area >= 0),
  add column if not exists cadastral_number text,
  add column if not exists address text,
  add column if not exists location_description text,
  add column if not exists geometry_mode text not null default 'polygon',
  add column if not exists contour_geojson jsonb,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lands_geometry_mode_check'
  ) then
    alter table public.lands
      add constraint lands_geometry_mode_check
      check (geometry_mode in ('point', 'polygon'));
  end if;
end $$;

create index if not exists idx_lands_land_type_id on public.lands(land_type_id);
create index if not exists idx_lands_number on public.lands(number);
create index if not exists idx_lands_cadastral_number on public.lands(cadastral_number);

create table if not exists public.land_rights (
  id uuid primary key default gen_random_uuid(),
  land_id uuid not null references public.lands(id) on delete cascade,
  right_type text not null,
  holder_name text not null,
  holder_inn text,
  document_name text,
  document_number text,
  document_date date,
  starts_at date,
  ends_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_land_rights_land_id on public.land_rights(land_id);
create index if not exists idx_land_rights_type on public.land_rights(right_type);

create table if not exists public.land_users (
  id uuid primary key default gen_random_uuid(),
  land_id uuid not null references public.lands(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete set null,
  organization_name text,
  person_name text,
  inn text,
  basis text,
  starts_at date,
  ends_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_land_users_land_id on public.land_users(land_id);
create index if not exists idx_land_users_user_id on public.land_users(user_id);

alter table public.fields
  add column if not exists land_id uuid null references public.lands(id) on delete set null;

create index if not exists idx_fields_land_id on public.fields(land_id);

alter table public.lands enable row level security;
alter table public.land_rights enable row level security;
alter table public.land_users enable row level security;

drop policy if exists "Allow all for lands" on public.lands;
create policy "Allow all for lands" on public.lands
  for all using (true) with check (true);

drop policy if exists "Allow all for land_rights" on public.land_rights;
create policy "Allow all for land_rights" on public.land_rights
  for all using (true) with check (true);

drop policy if exists "Allow all for land_users" on public.land_users;
create policy "Allow all for land_users" on public.land_users
  for all using (true) with check (true);
