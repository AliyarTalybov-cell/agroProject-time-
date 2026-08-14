-- Добавляет в таблицу операций поля для техники:
-- equipment_id, топливо%, состояние, и заметки починки

alter table public.operations
  add column if not exists equipment_id uuid references public.equipment(id) on delete set null;

alter table public.operations
  add column if not exists equipment_fuel_percent int;

alter table public.operations
  add column if not exists equipment_condition_value int;

alter table public.operations
  add column if not exists equipment_condition_label text;

alter table public.operations
  add column if not exists equipment_repair_notes text;

