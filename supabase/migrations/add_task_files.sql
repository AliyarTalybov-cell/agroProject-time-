-- Вложения для обычных задач (фото/документы).
-- Используется существующий бакет Storage "task-attachments".
create table if not exists public.task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_size bigint,
  created_at timestamptz default now()
);

create index if not exists idx_task_files_task_id on public.task_files(task_id);

alter table public.task_files enable row level security;
drop policy if exists "Allow all for task_files" on public.task_files;
create policy "Allow all for task_files" on public.task_files for all using (true) with check (true);
