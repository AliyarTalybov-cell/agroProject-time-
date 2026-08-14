-- Исполнитель задачи необязателен; при удалении пользователя задача остаётся без исполнителя.

alter table public.tasks
  drop constraint if exists tasks_assignee_id_fkey;

alter table public.tasks
  alter column assignee_id drop not null;

alter table public.tasks
  add constraint tasks_assignee_id_fkey
  foreign key (assignee_id) references auth.users (id) on delete set null;
