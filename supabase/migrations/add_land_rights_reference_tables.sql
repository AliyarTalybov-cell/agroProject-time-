create table if not exists public.land_right_ownership_forms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.land_right_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.land_right_document_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.land_right_holder_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.land_right_holders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  holder_type_id uuid references public.land_right_holder_types(id) on delete set null,
  inn text,
  kpp text,
  ogrn text,
  created_at timestamptz not null default now()
);

create index if not exists idx_land_right_holders_holder_type_id on public.land_right_holders(holder_type_id);

alter table public.land_right_ownership_forms enable row level security;
alter table public.land_right_types enable row level security;
alter table public.land_right_document_types enable row level security;
alter table public.land_right_holder_types enable row level security;
alter table public.land_right_holders enable row level security;

drop policy if exists "Allow all for land_right_ownership_forms" on public.land_right_ownership_forms;
create policy "Allow all for land_right_ownership_forms" on public.land_right_ownership_forms
  for all using (true) with check (true);

drop policy if exists "Allow all for land_right_types" on public.land_right_types;
create policy "Allow all for land_right_types" on public.land_right_types
  for all using (true) with check (true);

drop policy if exists "Allow all for land_right_document_types" on public.land_right_document_types;
create policy "Allow all for land_right_document_types" on public.land_right_document_types
  for all using (true) with check (true);

drop policy if exists "Allow all for land_right_holder_types" on public.land_right_holder_types;
create policy "Allow all for land_right_holder_types" on public.land_right_holder_types
  for all using (true) with check (true);

drop policy if exists "Allow all for land_right_holders" on public.land_right_holders;
create policy "Allow all for land_right_holders" on public.land_right_holders
  for all using (true) with check (true);
