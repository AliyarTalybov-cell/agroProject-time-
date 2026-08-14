alter table if exists public.operations
  add column if not exists planned_hectares numeric(10,2);

alter table if exists public.operations
  add column if not exists processed_hectares numeric(10,2);
