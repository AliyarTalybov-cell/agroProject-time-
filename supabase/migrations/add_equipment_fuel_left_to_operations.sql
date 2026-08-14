-- Добавляет в таблицу операций поле для топлива "остаток" после остановки операции:
-- equipment_fuel_left_percent

alter table public.operations
  add column if not exists equipment_fuel_left_percent int;

