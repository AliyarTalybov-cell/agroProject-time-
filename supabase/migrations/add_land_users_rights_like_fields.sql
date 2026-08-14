alter table public.land_users
  add column if not exists holder_mode text,
  add column if not exists right_holder_id uuid references public.land_right_holders(id) on delete set null,
  add column if not exists holder_name text,
  add column if not exists holder_inn text,
  add column if not exists holder_kpp text,
  add column if not exists holder_ogrn text,
  add column if not exists right_type text,
  add column if not exists document_type text,
  add column if not exists supporting_documents text,
  add column if not exists usage_area_ha numeric(12,2);

create index if not exists idx_land_users_right_holder_id on public.land_users(right_holder_id);
