alter table public.equipment
  add column if not exists factory_number text,
  add column if not exists epsm_psm text,
  add column if not exists svr_number text,
  add column if not exists registration_certificate text,
  add column if not exists registration_date date,
  add column if not exists deregistration_date date;
