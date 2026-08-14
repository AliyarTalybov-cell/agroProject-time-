-- Участники задач (отдельно от единственного исполнителя assignee_id)

create table if not exists public.task_participants (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists idx_task_participants_user_id on public.task_participants(user_id);

alter table public.task_participants enable row level security;

drop policy if exists "Allow all for task_participants" on public.task_participants;
create policy "Allow all for task_participants"
  on public.task_participants for all using (true) with check (true);

-- Тип уведомления: добавлен участником задачи
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'user_notifications_type_check'
      and conrelid = 'public.user_notifications'::regclass
  ) then
    alter table public.user_notifications drop constraint user_notifications_type_check;
  end if;
  alter table public.user_notifications
    add constraint user_notifications_type_check
    check (type in (
      'task_assigned',
      'calendar_invited',
      'task_status_changed',
      'task_comment_added',
      'task_participant_added'
    ));
exception when duplicate_object then
  null;
end $$;

create or replace function public.notify_task_participant_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task_owner uuid;
  task_created_at timestamptz;
begin
  if new.user_id is null then
    return new;
  end if;

  select t.created_by, t.created_at
  into task_owner, task_created_at
  from public.tasks t
  where t.id = new.task_id;

  -- Не дублируем уведомление исполнителю (у него отдельное task_assigned)
  if exists (
    select 1 from public.tasks t
    where t.id = new.task_id and t.assignee_id = new.user_id
  ) then
    return new;
  end if;

  insert into public.user_notifications (
    user_id,
    type,
    task_id,
    actor_user_id,
    payload,
    created_at
  )
  values (
    new.user_id,
    'task_participant_added',
    new.task_id,
    task_owner,
    jsonb_build_object(
      'task_number', (select number from public.tasks where id = new.task_id)
    ),
    coalesce(task_created_at, now())
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_task_participant_added on public.task_participants;
create trigger trg_notify_task_participant_added
after insert on public.task_participants
for each row
execute function public.notify_task_participant_added();
