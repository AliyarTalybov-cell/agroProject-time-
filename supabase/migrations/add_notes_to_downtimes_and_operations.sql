-- Список дел при завершении простоя или операции (журнал работ, аналитика)
alter table public.downtimes add column if not exists notes text;
alter table public.operations add column if not exists notes text;
