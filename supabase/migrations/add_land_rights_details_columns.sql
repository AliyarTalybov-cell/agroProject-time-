alter table public.land_rights
  add column if not exists holder_mode text,
  add column if not exists holder_kpp text,
  add column if not exists holder_ogrn text,
  add column if not exists cadastral_number text,
  add column if not exists ownership_form text,
  add column if not exists document_type text,
  add column if not exists supporting_documents text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'land_rights_holder_mode_check'
  ) then
    alter table public.land_rights
      add constraint land_rights_holder_mode_check
      check (holder_mode in ('manual', 'reference') or holder_mode is null);
  end if;
end $$;
