create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('task_assigned', 'calendar_invited', 'task_status_changed', 'task_comment_added')),
  task_id uuid references public.tasks(id) on delete cascade,
  calendar_task_id uuid references public.calendar_tasks(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

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
    check (type in ('task_assigned', 'calendar_invited', 'task_status_changed', 'task_comment_added'));
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_user_notifications_user_created_at
  on public.user_notifications(user_id, created_at desc);

create index if not exists idx_user_notifications_user_read
  on public.user_notifications(user_id, is_read);

create index if not exists idx_user_notifications_task_id
  on public.user_notifications(task_id);

create index if not exists idx_user_notifications_calendar_task_id
  on public.user_notifications(calendar_task_id);

alter table public.user_notifications enable row level security;

drop policy if exists "user_notifications_select_own" on public.user_notifications;
create policy "user_notifications_select_own"
  on public.user_notifications for select
  using (auth.uid() = user_id);

drop policy if exists "user_notifications_update_own" on public.user_notifications;
create policy "user_notifications_update_own"
  on public.user_notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_notifications_insert_own" on public.user_notifications;
create policy "user_notifications_insert_own"
  on public.user_notifications for insert
  with check (auth.uid() = user_id);

create or replace function public.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignee_id is null then
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
    new.assignee_id,
    'task_assigned',
    new.id,
    new.created_by,
    jsonb_build_object('task_number', new.number),
    coalesce(new.created_at, now())
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_task_assigned on public.tasks;
create trigger trg_notify_task_assigned
after insert on public.tasks
for each row
execute function public.notify_task_assigned();

create or replace function public.notify_task_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
begin
  if new.assignee_id is null then
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  actor_id := coalesce(auth.uid(), new.created_by, old.created_by);

  insert into public.user_notifications (
    user_id,
    type,
    task_id,
    actor_user_id,
    payload,
    created_at
  )
  values (
    new.assignee_id,
    'task_status_changed',
    new.id,
    actor_id,
    jsonb_build_object(
      'task_number', new.number,
      'from', old.status,
      'to', new.status
    ),
    now()
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_task_status_changed on public.tasks;
create trigger trg_notify_task_status_changed
after update of status on public.tasks
for each row
execute function public.notify_task_status_changed();

create or replace function public.notify_task_comment_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assignee_id uuid;
  task_creator_id uuid;
begin
  if new.event_type is distinct from 'comment_added' then
    return new;
  end if;

  select t.assignee_id, t.created_by
  into assignee_id, task_creator_id
  from public.tasks t
  where t.id = new.task_id;

  if assignee_id is not null and assignee_id is distinct from new.user_id then
    insert into public.user_notifications (
      user_id,
      type,
      task_id,
      actor_user_id,
      payload,
      created_at
    )
    values (
      assignee_id,
      'task_comment_added',
      new.task_id,
      new.user_id,
      '{}'::jsonb,
      coalesce(new.created_at, now())
    );
  end if;

  if task_creator_id is not null
     and task_creator_id is distinct from assignee_id
     and task_creator_id is distinct from new.user_id then
    insert into public.user_notifications (
      user_id,
      type,
      task_id,
      actor_user_id,
      payload,
      created_at
    )
    values (
      task_creator_id,
      'task_comment_added',
      new.task_id,
      new.user_id,
      '{}'::jsonb,
      coalesce(new.created_at, now())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_task_comment_added on public.task_events;
create trigger trg_notify_task_comment_added
after insert on public.task_events
for each row
execute function public.notify_task_comment_added();

create or replace function public.notify_calendar_invited()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  calendar_owner uuid;
  calendar_created_at timestamptz;
begin
  select user_id, created_at
  into calendar_owner, calendar_created_at
  from public.calendar_tasks
  where id = new.task_id;

  insert into public.user_notifications (
    user_id,
    type,
    calendar_task_id,
    actor_user_id,
    payload,
    created_at
  )
  values (
    new.user_id,
    'calendar_invited',
    new.task_id,
    calendar_owner,
    '{}'::jsonb,
    coalesce(calendar_created_at, now())
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_calendar_invited on public.calendar_task_assignees;
create trigger trg_notify_calendar_invited
after insert on public.calendar_task_assignees
for each row
execute function public.notify_calendar_invited();

insert into public.user_notifications (user_id, type, task_id, actor_user_id, payload, created_at)
select
  t.assignee_id,
  'task_assigned',
  t.id,
  t.created_by,
  jsonb_build_object('task_number', t.number),
  coalesce(t.created_at, now())
from public.tasks t
where t.assignee_id is not null
  and not exists (
    select 1
    from public.user_notifications n
    where n.type = 'task_assigned'
      and n.user_id = t.assignee_id
      and n.task_id = t.id
  );

insert into public.user_notifications (user_id, type, calendar_task_id, actor_user_id, payload, created_at)
select
  a.user_id,
  'calendar_invited',
  a.task_id,
  t.user_id,
  '{}'::jsonb,
  coalesce(t.created_at, now())
from public.calendar_task_assignees a
join public.calendar_tasks t on t.id = a.task_id
where not exists (
  select 1
  from public.user_notifications n
  where n.type = 'calendar_invited'
    and n.user_id = a.user_id
    and n.calendar_task_id = a.task_id
);

insert into public.user_notifications (user_id, type, task_id, actor_user_id, payload, created_at)
select
  t.assignee_id,
  'task_comment_added',
  e.task_id,
  e.user_id,
  '{}'::jsonb,
  coalesce(e.created_at, now())
from public.task_events e
join public.tasks t on t.id = e.task_id
where e.event_type = 'comment_added'
  and t.assignee_id is not null
  and t.assignee_id is distinct from e.user_id
  and not exists (
    select 1
    from public.user_notifications n
    where n.type = 'task_comment_added'
      and n.user_id = t.assignee_id
      and n.task_id = e.task_id
      and n.actor_user_id is not distinct from e.user_id
      and n.created_at = e.created_at
  );

insert into public.user_notifications (user_id, type, task_id, actor_user_id, payload, created_at)
select
  t.created_by,
  'task_comment_added',
  e.task_id,
  e.user_id,
  '{}'::jsonb,
  coalesce(e.created_at, now())
from public.task_events e
join public.tasks t on t.id = e.task_id
where e.event_type = 'comment_added'
  and t.created_by is not null
  and t.created_by is distinct from t.assignee_id
  and t.created_by is distinct from e.user_id
  and not exists (
    select 1
    from public.user_notifications n
    where n.type = 'task_comment_added'
      and n.user_id = t.created_by
      and n.task_id = e.task_id
      and n.actor_user_id is not distinct from e.user_id
      and n.created_at = e.created_at
  );

create or replace function public.list_my_notifications(
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
  actor_name text
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
    coalesce(nullif(trim(p.display_name), ''), p.email, 'Система') as actor_name
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

grant execute on function public.list_my_notifications(text, int, int) to authenticated;

create or replace function public.mark_my_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    update public.user_notifications n
      set is_read = true,
          read_at = now()
    where n.user_id = auth.uid()
      and n.is_read = false;
  else
    update public.user_notifications n
      set is_read = true,
          read_at = now()
    where n.user_id = auth.uid()
      and n.is_read = false
      and n.id = any(p_ids);
  end if;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.mark_my_notifications_read(uuid[]) to authenticated;
