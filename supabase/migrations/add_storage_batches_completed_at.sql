-- Завершение партии (ФГИС / учёт): после completed_at партия считается закрытой для редактирования состава.
alter table public.storage_batches
  add column if not exists completed_at timestamptz;
