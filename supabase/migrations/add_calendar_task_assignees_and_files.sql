-- Несколько исполнителей на задачу (задача показывается в календаре у каждого) и файлы к задачам.
-- Перед применением: в Supabase Dashboard → Storage → New bucket → имя "task-attachments" (Public по желанию).
create table if not exists public.calendar_task_assignees (
  task_id uuid not null references public.calendar_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (task_id, user_id)
);

create index if not exists idx_calendar_task_assignees_user_id on public.calendar_task_assignees(user_id);

alter table public.calendar_task_assignees enable row level security;
drop policy if exists "Allow all for calendar_task_assignees" on public.calendar_task_assignees;
create policy "Allow all for calendar_task_assignees" on public.calendar_task_assignees for all using (true) with check (true);

-- Файлы задач (фото/документы). Бакет "task-attachments" создать вручную: Storage → New bucket → "task-attachments", Public по желанию
create table if not exists public.calendar_task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.calendar_tasks(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_size bigint,
  created_at timestamptz default now()
);

create index if not exists idx_calendar_task_files_task_id on public.calendar_task_files(task_id);

alter table public.calendar_task_files enable row level security;
drop policy if exists "Allow all for calendar_task_files" on public.calendar_task_files;
create policy "Allow all for calendar_task_files" on public.calendar_task_files for all using (true) with check (true);

-- Политики Storage для бакета "task-attachments" (создать вручную: Storage → New bucket → "task-attachments")
drop policy if exists "task-attachments: allow insert" on storage.objects;
drop policy if exists "task-attachments: allow select" on storage.objects;
drop policy if exists "task-attachments: allow update" on storage.objects;
drop policy if exists "task-attachments: allow delete" on storage.objects;
create policy "task-attachments: allow insert" on storage.objects for insert with check (bucket_id = 'task-attachments');
create policy "task-attachments: allow select" on storage.objects for select using (bucket_id = 'task-attachments');
create policy "task-attachments: allow update" on storage.objects for update using (bucket_id = 'task-attachments');
create policy "task-attachments: allow delete" on storage.objects for delete using (bucket_id = 'task-attachments');
