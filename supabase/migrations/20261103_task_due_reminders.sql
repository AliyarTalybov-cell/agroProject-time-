-- Напоминания о сроках задач в центре уведомлений.
--
--   task_due_soon — «скоро срок»: срок завтра или сегодня;
--   task_overdue  — «задача просрочена»: срок прошёл (не позже трёх дней
--                   назад — чтобы при запуске не засыпать людей старыми
--                   просрочками, которых в базе десятки).
--
-- Кому: исполнителю задачи, а если исполнителя нет — автору.
-- Задачи со статусом done не напоминаются.
--
-- Как создаются: отдельного планировщика нет — портал при открытии и дальше
-- раз в несколько минут вызывает generate_my_task_reminders(), и функция
-- создаёт недостающие напоминания только для вошедшего. Уведомления у нас
-- только внутри портала, поэтому это то же самое, что ночная рассылка:
-- человек видит напоминание, как только открывает портал.
--
-- Дубли исключает уникальный индекс: одно напоминание каждого вида на
-- задачу, человека и срок. Перенесли срок — придёт новое.
--
-- Сутки считаются по Москве (Курская область — тот же часовой пояс).
-- Идемпотентно: можно выполнить повторно.

begin;

-- 1. Новые виды уведомлений
alter table public.user_notifications drop constraint if exists user_notifications_type_check;
alter table public.user_notifications
  add constraint user_notifications_type_check
  check (type in (
    'task_assigned',
    'calendar_invited',
    'task_status_changed',
    'task_comment_added',
    'task_participant_added',
    'task_due_soon',
    'task_overdue'
  ));

-- 2. Без дублей: вид + человек + задача + срок
create unique index if not exists user_notifications_task_reminder_uidx
  on public.user_notifications (user_id, task_id, type, (payload ->> 'due_date'))
  where type in ('task_due_soon', 'task_overdue');

-- 3. Создать недостающие напоминания для вошедшего пользователя
create or replace function public.generate_my_task_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_count int := 0;
  v_part int := 0;
begin
  if v_uid is null then
    return 0;
  end if;

  insert into public.user_notifications (user_id, type, task_id, payload)
  select v_uid, 'task_due_soon', t.id,
         jsonb_build_object('task_number', t.number, 'due_date', t.due_date_norm::text)
  from public.tasks t
  where coalesce(t.assignee_id, t.created_by) = v_uid
    and t.status <> 'done'
    and t.due_date_norm between v_today and v_today + 1
  on conflict do nothing;
  get diagnostics v_part = row_count;
  v_count := v_count + v_part;

  insert into public.user_notifications (user_id, type, task_id, payload)
  select v_uid, 'task_overdue', t.id,
         jsonb_build_object('task_number', t.number, 'due_date', t.due_date_norm::text)
  from public.tasks t
  where coalesce(t.assignee_id, t.created_by) = v_uid
    and t.status <> 'done'
    and t.due_date_norm between v_today - 3 and v_today - 1
  on conflict do nothing;
  get diagnostics v_part = row_count;
  v_count := v_count + v_part;

  return v_count;
end;
$$;

revoke all on function public.generate_my_task_reminders() from public, anon;
grant execute on function public.generate_my_task_reminders() to authenticated;

-- 4. Список уведомлений отдаёт и срок из напоминания (тип результата
--    меняется — функцию нужно пересоздать).
drop function if exists public.list_my_notifications(text, int, int);
create function public.list_my_notifications(
  p_filter text default 'all',
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  type text,
  is_read boolean,
  created_at timestamptz,
  task_id uuid,
  task_number bigint,
  task_title text,
  calendar_task_id uuid,
  calendar_title text,
  calendar_date text,
  actor_name text,
  due_date text
)
language sql
security definer
set search_path = public
as $$
  select
    n.id,
    n.type,
    n.is_read,
    n.created_at,
    n.task_id,
    t.number as task_number,
    t.title as task_title,
    n.calendar_task_id,
    ct.title as calendar_title,
    ct.date as calendar_date,
    coalesce(nullif(trim(p.display_name), ''), p.email, 'Система') as actor_name,
    n.payload ->> 'due_date' as due_date
  from public.user_notifications n
  left join public.tasks t on t.id = n.task_id
  left join public.calendar_tasks ct on ct.id = n.calendar_task_id
  left join public.profiles p on p.id = n.actor_user_id
  where n.user_id = auth.uid()
    and (
      p_filter = 'all'
      or (p_filter = 'unread' and n.is_read = false)
      or (p_filter = 'read' and n.is_read = true)
    )
  order by n.created_at desc, n.id desc
  limit greatest(1, least(100, coalesce(p_limit, 20)))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.list_my_notifications(text, int, int) from public, anon;
grant execute on function public.list_my_notifications(text, int, int) to authenticated;

insert into public.applied_migrations (filename, note)
values ('20261103_task_due_reminders.sql', 'напоминания о сроках задач: скоро срок и просрочка')
on conflict do nothing;

commit;
