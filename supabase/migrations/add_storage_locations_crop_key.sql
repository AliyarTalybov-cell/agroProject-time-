-- Культура места хранения (справочник public.crops), по аналогии с crop_key у полей.

alter table public.storage_locations
  add column if not exists crop_key text references public.crops (key) on update cascade on delete set null;
