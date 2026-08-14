-- Статусы приглашений участников событий календаря.
alter table public.calendar_task_assignees
  add column if not exists status text;

-- Backfill для существующих связей: считаем их подтвержденными.
update public.calendar_task_assignees
set status = 'accepted'
where status is null;

-- Ограничиваем допустимые значения.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'calendar_task_assignees_status_check'
  ) then
    alter table public.calendar_task_assignees
      add constraint calendar_task_assignees_status_check
      check (status in ('pending', 'accepted', 'declined'));
  end if;
end $$;

alter table public.calendar_task_assignees
  alter column status set default 'pending',
  alter column status set not null;

create index if not exists idx_calendar_task_assignees_task_status
  on public.calendar_task_assignees(task_id, status);
