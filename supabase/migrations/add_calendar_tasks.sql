-- Задачи календаря (страница «Календарь»): планирование дня, не связаны с tasks
create table if not exists public.calendar_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  date text not null,
  title text not null,
  description text,
  start_time text,
  end_time text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assignee text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.calendar_tasks enable row level security;

create policy "Allow all for calendar_tasks" on public.calendar_tasks
  for all using (true) with check (true);
