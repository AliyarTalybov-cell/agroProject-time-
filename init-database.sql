-- AGRO PORTAL DB INIT SCRIPT (dependency-ordered)



-- ==========================================
-- TABLE: equipment_implements
-- ==========================================


create table if not exists public.equipment_implements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  purpose text,
  description text,
  "condition" text not null default 'operational' check ("condition" in ('operational', 'repair', 'decommissioned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.equipment_implements enable row level security;

drop policy if exists "Allow all for equipment_implements" on public.equipment_implements;
create policy "Allow all for equipment_implements" on public.equipment_implements
  for all using (true) with check (true);


-- ==========================================
-- TABLE: equipment
-- ==========================================


create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  license_plate text not null,
  model text,
  equipment_type text,
  year int check (year is null or (year >= 1900 and year <= 2100)),
  purpose_crop text,
  implement_id uuid references public.equipment_implements(id) on delete set null,
  "condition" text not null default 'operational' check ("condition" in ('operational', 'repair', 'decommissioned')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.equipment enable row level security;

drop policy if exists "Allow all for equipment" on public.equipment;
create policy "Allow all for equipment" on public.equipment
  for all using (true) with check (true);


-- ==========================================
-- TABLE: land_types + crops
-- ==========================================


create table if not exists public.land_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create table if not exists public.crops (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

alter table public.land_types enable row level security;
alter table public.crops enable row level security;
drop policy if exists "Allow all for land_types" on public.land_types;
create policy "Allow all for land_types" on public.land_types for all using (true) with check (true);
drop policy if exists "Allow all for crops" on public.crops;
create policy "Allow all for crops" on public.crops for all using (true) with check (true);

-- Seed dictionaries
insert into public.land_types (name, sort_order) values
  ('Пашня', 1), ('Залежь', 2), ('Сенокос', 3), ('Пастбище', 4)
on conflict (name) do nothing;

insert into public.crops (key, label, sort_order) values
  ('wheat', 'Пшеница', 1), ('corn', 'Кукуруза', 2), ('soy', 'Соя', 3),
  ('sunflower', 'Подсолнечник', 4), ('none', 'Нет (пар)', 5), ('meadow', 'Многолетние травы', 6)
on conflict (key) do nothing;


-- ==========================================
-- TABLE: profiles
-- ==========================================


create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text check (role in ('worker', 'manager')),
  phone text,
  position text,
  additional_info text,
  last_activity_at timestamptz,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;
drop policy if exists "Allow all for profiles" on public.profiles;
create policy "Allow all for profiles" on public.profiles
  for all using (true) with check (true);


-- ==========================================
-- TABLE: employee_positions
-- ==========================================


create table if not exists public.employee_positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

alter table public.employee_positions enable row level security;
drop policy if exists "Allow all for employee_positions" on public.employee_positions;
create policy "Allow all for employee_positions" on public.employee_positions
  for all using (true) with check (true);

insert into public.employee_positions (name, sort_order) values
  ('Главный агроном', 1), ('Агроном', 2), ('Механик', 3), ('Инженер', 4),
  ('Тракторист', 5), ('Логист', 6), ('HR специалист', 7), ('Диспетчер', 8)
on conflict (name) do nothing;


-- ==========================================
-- TABLE: fields
-- ==========================================


create table if not exists public.fields (
  id uuid primary key default gen_random_uuid(),
  number int not null default 1,
  name text not null,
  area numeric not null check (area >= 0),
  cadastral_number text,
  address text,
  location_description text,
  land_type text not null,
  sowing_year int check (sowing_year is null or (sowing_year >= 2000 and sowing_year <= 2100)),
  responsible_id uuid references auth.users(id) on delete set null,
  crop_key text not null,
  scheme_file_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.fields enable row level security;
drop policy if exists "Allow all for fields" on public.fields;
create policy "Allow all for fields" on public.fields
  for all using (true) with check (true);

-- Drop old check constraints if they exist
alter table public.fields drop constraint if exists fields_land_type_check;
alter table public.fields drop constraint if exists fields_crop_key_check;


-- ==========================================
-- TABLE: field_photos
-- ==========================================


create table if not exists public.field_photos (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields(id) on delete cascade,
  file_url text not null,
  title text,
  description text,
  created_at timestamptz default now()
);

alter table public.field_photos enable row level security;
drop policy if exists "Allow all for field_photos" on public.field_photos;
create policy "Allow all for field_photos" on public.field_photos for all using (true) with check (true);


-- ==========================================
-- TABLE: equipment_photos
-- ==========================================


create table if not exists public.equipment_photos (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  file_url text not null,
  file_path text,
  title text,
  description text,
  created_at timestamptz default now()
);

alter table public.equipment_photos enable row level security;
drop policy if exists "Allow all for equipment_photos" on public.equipment_photos;
create policy "Allow all for equipment_photos" on public.equipment_photos
  for all using (true) with check (true);


-- ==========================================
-- TABLE: tasks
-- ==========================================


create sequence if not exists public.tasks_number_seq;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  number bigint not null default nextval('public.tasks_number_seq'),
  assignee_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  field text not null,
  due_date text,
  status text not null check (status in ('todo', 'in_progress', 'review', 'done')),
  work_type text,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists tasks_number_key on public.tasks (number);

alter table public.tasks enable row level security;
drop policy if exists "Allow all for tasks" on public.tasks;
create policy "Allow all for tasks" on public.tasks
  for all using (true) with check (true);


-- ==========================================
-- TABLE: downtimes
-- ==========================================


create table if not exists public.downtimes (
  id bigint primary key default (extract(epoch from now()) * 1000)::bigint,
  user_id uuid references auth.users(id),
  employee text not null,
  reason text not null,
  category text not null check (category in ('breakdown', 'rain', 'fuel', 'waiting')),
  start_iso timestamptz not null,
  end_iso timestamptz not null,
  duration_minutes int not null,
  field_id text,
  field_name text,
  operation text,
  notes text,
  created_at timestamptz default now()
);

alter table public.downtimes enable row level security;
drop policy if exists "Allow all for downtimes" on public.downtimes;
create policy "Allow all for downtimes" on public.downtimes
  for all using (true) with check (true);


-- ==========================================
-- TABLE: operations
-- ==========================================


create table if not exists public.operations (
  id bigint primary key default (extract(epoch from now()) * 1000)::bigint,
  user_id uuid references auth.users(id),
  employee text not null,
  field_id text,
  field_name text,
  operation text,
  equipment_id uuid references public.equipment(id) on delete set null,
  equipment_fuel_percent int,
  equipment_fuel_left_percent int,
  equipment_condition_value int,
  equipment_condition_label text,
  equipment_repair_notes text,
  planned_hectares numeric(10,2),
  processed_hectares numeric(10,2),
  notes text,
  start_iso timestamptz not null,
  end_iso timestamptz not null,
  duration_minutes int not null,
  created_at timestamptz default now()
);

create index if not exists operations_end_iso_idx on public.operations (end_iso);

alter table public.operations enable row level security;
drop policy if exists "Allow all for operations" on public.operations;
create policy "Allow all for operations" on public.operations
  for all using (true) with check (true);


-- ==========================================
-- TABLE: operator_status
-- ==========================================


create table if not exists public.operator_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kind text not null check (kind in ('operation', 'downtime')),
  employee text not null,
  started_at timestamptz not null,
  field_id text,
  field_name text,
  operation text,
  downtime_category text,
  downtime_reason text,
  equipment_id uuid references public.equipment(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists operator_status_equipment_id_idx on public.operator_status (equipment_id);

alter table public.operator_status enable row level security;
drop policy if exists "Allow all for operator_status" on public.operator_status;
create policy "Allow all for operator_status" on public.operator_status
  for all using (true) with check (true);


-- ==========================================
-- TABLE: downtime_reasons + work_operations
-- ==========================================


create table if not exists public.downtime_reasons (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  description text,
  category text not null check (category in ('breakdown', 'rain', 'fuel', 'waiting')),
  created_at timestamptz default now(),
  created_by text
);

create table if not exists public.work_operations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now(),
  created_by text
);

alter table public.downtime_reasons enable row level security;
alter table public.work_operations enable row level security;
drop policy if exists "Allow all for downtime_reasons" on public.downtime_reasons;
drop policy if exists "Allow all for work_operations" on public.work_operations;
create policy "Allow all for downtime_reasons" on public.downtime_reasons for all using (true) with check (true);
create policy "Allow all for work_operations" on public.work_operations for all using (true) with check (true);


-- ==========================================
-- TABLE: calendar_tasks + assignees + files
-- ==========================================


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
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.calendar_tasks enable row level security;
drop policy if exists "Allow all for calendar_tasks" on public.calendar_tasks;
create policy "Allow all for calendar_tasks" on public.calendar_tasks for all using (true) with check (true);

create table if not exists public.calendar_task_assignees (
  task_id uuid not null references public.calendar_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (task_id, user_id)
);

create index if not exists idx_calendar_task_assignees_user_id on public.calendar_task_assignees(user_id);

alter table public.calendar_task_assignees enable row level security;
drop policy if exists "Allow all for calendar_task_assignees" on public.calendar_task_assignees;
create policy "Allow all for calendar_task_assignees" on public.calendar_task_assignees for all using (true) with check (true);

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


-- ==========================================
-- MIGRATIONS: Chat (threads, members, messages)
-- ==========================================

-- Чат: директ и группы, сообщения, непрочитанные (last_read_at), RLS и RPC.
-- Выполнить в Supabase (CLI: supabase db push / SQL Editor).

-- ——— Таблицы ———

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  title text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_thread_members (
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists chat_thread_members_user_id_idx on public.chat_thread_members (user_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text,
  attachment_bucket text,
  attachment_path text,
  attachment_name text,
  attachment_size bigint,
  created_at timestamptz not null default now(),
  constraint chat_messages_body_or_file check (
    (body is not null and btrim(body) <> '')
    or (attachment_path is not null and btrim(attachment_path) <> '')
  )
);

create index if not exists chat_messages_thread_created_idx on public.chat_messages (thread_id, created_at desc);

-- ——— Триггер: обновление updated_at у потока при новом сообщении ———

create or replace function public.chat_touch_thread_on_message ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_threads
  set updated_at = now()
  where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists chat_messages_touch_thread on public.chat_messages;
create trigger chat_messages_touch_thread
  after insert on public.chat_messages
  for each row
  execute function public.chat_touch_thread_on_message ();

-- ——— Вспомогательные функции ———

create or replace function public.is_current_user_manager ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'manager'
  );
$$;

grant execute on function public.is_current_user_manager () to authenticated;

-- Создать или вернуть директ между текущим пользователем и p_other_user
create or replace function public.get_or_create_dm_thread (p_other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tid uuid;
begin
  if p_other_user is null or p_other_user = auth.uid() then
    raise exception 'invalid_peer';
  end if;

  if not exists (select 1 from public.profiles pr where pr.id = p_other_user) then
    raise exception 'user_not_found';
  end if;

  select t.id
  into v_tid
  from public.chat_threads t
  where t.kind = 'direct'
    and exists (
      select 1 from public.chat_thread_members m
      where m.thread_id = t.id and m.user_id = auth.uid()
    )
    and exists (
      select 1 from public.chat_thread_members m
      where m.thread_id = t.id and m.user_id = p_other_user
    )
  limit 1;

  if v_tid is not null then
    return v_tid;
  end if;

  insert into public.chat_threads (kind, created_by)
  values ('direct', auth.uid())
  returning id into v_tid;

  insert into public.chat_thread_members (thread_id, user_id)
  values
    (v_tid, auth.uid()),
    (v_tid, p_other_user);

  return v_tid;
end;
$$;

grant execute on function public.get_or_create_dm_thread (uuid) to authenticated;

-- Групповой чат («Команды») — только руководитель
create or replace function public.create_group_thread (p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tid uuid;
  v_members uuid[] := array[]::uuid[];
  u uuid;
  raw uuid[];
begin
  if not public.is_current_user_manager() then
    raise exception 'forbidden';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'title_required';
  end if;

  raw := coalesce(p_member_ids, array[]::uuid[]) || auth.uid();
  foreach u in array raw loop
    if u is null then
      continue;
    end if;
    if not u = any (v_members) then
      v_members := array_append(v_members, u);
    end if;
  end loop;

  if array_length(v_members, 1) is null or array_length(v_members, 1) < 2 then
    raise exception 'need_at_least_two_members';
  end if;

  foreach u in array v_members loop
    if not exists (select 1 from public.profiles pr where pr.id = u) then
      raise exception 'unknown_member';
    end if;
  end loop;

  insert into public.chat_threads (kind, title, created_by)
  values ('group', btrim(p_title), auth.uid())
  returning id into v_tid;

  insert into public.chat_thread_members (thread_id, user_id)
  select v_tid, m
  from unnest(v_members) as m;

  return v_tid;
end;
$$;

grant execute on function public.create_group_thread (text, uuid[]) to authenticated;

-- Список диалогов с превью и непрочитанными
create or replace function public.list_my_chat_threads ()
returns table (
  thread_id uuid,
  kind text,
  title text,
  updated_at timestamptz,
  last_message_body text,
  last_message_at timestamptz,
  last_sender_id uuid,
  unread_count bigint,
  peer_user_id uuid,
  peer_display_name text,
  peer_email text,
  peer_position text
)
language sql
stable
security definer
set search_path = public
as $$
  with my_threads as (
    select ctm.thread_id, ctm.last_read_at
    from public.chat_thread_members ctm
    where ctm.user_id = auth.uid()
  ),
  last_msg as (
    select distinct on (m.thread_id)
      m.thread_id,
      m.body,
      m.created_at as msg_at,
      m.sender_id,
      m.attachment_name
    from public.chat_messages m
    inner join my_threads t on t.thread_id = m.thread_id
    order by m.thread_id, m.created_at desc
  ),
  unread as (
    select m.thread_id, count(*)::bigint as n
    from public.chat_messages m
    inner join my_threads t on t.thread_id = m.thread_id
    where m.sender_id is distinct from auth.uid()
      and (t.last_read_at is null or m.created_at > t.last_read_at)
    group by m.thread_id
  ),
  peer as (
    select ctm.thread_id, ctm.user_id as peer_uid
    from public.chat_thread_members ctm
    inner join public.chat_threads th on th.id = ctm.thread_id and th.kind = 'direct'
    where ctm.user_id <> auth.uid()
  )
  select
    th.id,
    th.kind,
    th.title,
    th.updated_at,
    case
      when lm.attachment_name is not null
        and (lm.body is null or btrim(lm.body) = '')
      then 'Файл: ' || lm.attachment_name
      else coalesce(lm.body, '')
    end,
    lm.msg_at,
    lm.sender_id,
    coalesce(u.n, 0)::bigint,
    p.peer_uid,
    prof.display_name,
    prof.email,
    prof.position
  from public.chat_threads th
  inner join my_threads mt on mt.thread_id = th.id
  left join last_msg lm on lm.thread_id = th.id
  left join unread u on u.thread_id = th.id
  left join peer p on p.thread_id = th.id and th.kind = 'direct'
  left join public.profiles prof on prof.id = p.peer_uid
  order by coalesce(lm.msg_at, th.updated_at) desc nulls last;
$$;

grant execute on function public.list_my_chat_threads () to authenticated;

-- Всего непрочитанных (бейдж в меню)
create or replace function public.chat_total_unread ()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(x.cnt), 0)::bigint
  from (
    select count(*)::bigint as cnt
    from public.chat_messages m
    inner join public.chat_thread_members ctm
      on ctm.thread_id = m.thread_id
     and ctm.user_id = auth.uid()
    where m.sender_id is distinct from auth.uid()
      and (ctm.last_read_at is null or m.created_at > ctm.last_read_at)
    group by m.thread_id
  ) x;
$$;

grant execute on function public.chat_total_unread () to authenticated;

-- Проверка членства без рекурсии RLS (подзапрос внутри политики к chat_thread_members → бесконечная рекурсия)
create or replace function public.user_is_member_of_chat_thread (p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_thread_members m
    where m.thread_id = p_thread
      and m.user_id = auth.uid()
  );
$$;

grant execute on function public.user_is_member_of_chat_thread (uuid) to authenticated;

-- ——— RLS ———

alter table public.chat_threads enable row level security;
alter table public.chat_thread_members enable row level security;
alter table public.chat_messages enable row level security;

-- Поток: видеть только участники
create policy chat_threads_select_member
  on public.chat_threads
  for select
  using (public.user_is_member_of_chat_thread (id));

-- Участники: видеть всех в своих потоках; обновлять только свою строку (прочитано)
create policy chat_thread_members_select
  on public.chat_thread_members
  for select
  using (public.user_is_member_of_chat_thread (thread_id));

create policy chat_thread_members_update_own
  on public.chat_thread_members
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Сообщения: читать/писать только в своих потоках
create policy chat_messages_select
  on public.chat_messages
  for select
  using (public.user_is_member_of_chat_thread (thread_id));

create policy chat_messages_insert
  on public.chat_messages
  for insert
  with check (
    sender_id = auth.uid()
    and public.user_is_member_of_chat_thread (thread_id)
  );

-- Прямые INSERT в chat_threads / chat_thread_members запрещены — только через RPC (definer обходит RLS)

grant select on public.chat_threads to authenticated;
grant select, update on public.chat_thread_members to authenticated;
grant select, insert on public.chat_messages to authenticated;

-- Пометить диалог прочитанным (надёжнее прямого UPDATE из PostgREST при RLS)
create or replace function public.mark_chat_thread_read (p_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_thread_members
  set last_read_at = now()
  where thread_id = p_thread
    and user_id = auth.uid();
end;
$$;

grant execute on function public.mark_chat_thread_read (uuid) to authenticated;

-- ——— Realtime (новые сообщения в клиенте) ———
-- Если публикация уже содержит таблицу, команда может выдать ошибку — тогда пропустите вручную.
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception
  when duplicate_object then
    null;
  when others then
    raise notice 'Could not add chat_messages to supabase_realtime: %', sqlerrm;
end;
$$;

alter table public.chat_messages replica identity full;


-- ==========================================
-- MIGRATION: fix_chat_thread_members_rls_recursion
-- ==========================================

-- Исправление: infinite recursion detected in policy for relation "chat_thread_members"
-- Причина: политика SELECT на chat_thread_members делала подзапрос к той же таблице.
-- Решение: проверка членства в SECURITY DEFINER-функции (чтение members обходит RLS).

create or replace function public.user_is_member_of_chat_thread (p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_thread_members m
    where m.thread_id = p_thread
      and m.user_id = auth.uid()
  );
$$;

grant execute on function public.user_is_member_of_chat_thread (uuid) to authenticated;

drop policy if exists chat_threads_select_member on public.chat_threads;
drop policy if exists chat_thread_members_select on public.chat_thread_members;
drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_insert on public.chat_messages;

create policy chat_threads_select_member
  on public.chat_threads
  for select
  using (public.user_is_member_of_chat_thread (id));

create policy chat_thread_members_select
  on public.chat_thread_members
  for select
  using (public.user_is_member_of_chat_thread (thread_id));

create policy chat_messages_select
  on public.chat_messages
  for select
  using (public.user_is_member_of_chat_thread (thread_id));

create policy chat_messages_insert
  on public.chat_messages
  for insert
  with check (
    sender_id = auth.uid()
    and public.user_is_member_of_chat_thread (thread_id)
  );


-- ==========================================
-- MIGRATION: add_mark_chat_thread_read_rpc
-- ==========================================

-- Пометить диалог прочитанным (обходит типичные проблемы PostgREST + RLS на UPDATE).
-- Выполните, если при открытии чата в UI ошибка, а список диалогов загружается.

create or replace function public.mark_chat_thread_read (p_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_thread_members
  set last_read_at = now()
  where thread_id = p_thread
    and user_id = auth.uid();
end;
$$;

grant execute on function public.mark_chat_thread_read (uuid) to authenticated;


-- ==========================================
-- MIGRATION: add_list_chat_messages_page_rpc
-- ==========================================

-- Постраничная выдача сообщений чата (последние N, затем старее по курсору).
-- Снижает нагрузку: не отдаём всю историю одним запросом.

create or replace function public.list_chat_messages_page (
  p_thread uuid,
  p_limit int default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  thread_id uuid,
  sender_id uuid,
  body text,
  attachment_bucket text,
  attachment_path text,
  attachment_name text,
  attachment_size bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.thread_id,
    m.sender_id,
    m.body,
    m.attachment_bucket,
    m.attachment_path,
    m.attachment_name,
    m.attachment_size,
    m.created_at
  from public.chat_messages m
  where m.thread_id = p_thread
    and public.user_is_member_of_chat_thread (p_thread)
    and (
      p_before_created_at is null
      or p_before_id is null
      or (
        m.created_at < p_before_created_at
        or (m.created_at = p_before_created_at and m.id < p_before_id)
      )
    )
  order by m.created_at desc, m.id desc
  limit greatest(1, least(coalesce(nullif(p_limit, 0), 30), 100));
$$;

revoke all on function public.list_chat_messages_page (uuid, int, timestamptz, uuid) from public;
grant execute on function public.list_chat_messages_page (uuid, int, timestamptz, uuid) to authenticated;


-- ==========================================
-- MIGRATION: extend_list_my_chat_threads_peer_last_activity
-- ==========================================

-- Для отображения «в сети» по profiles.last_activity_at в списке диалогов.
-- Требует колонку profiles.last_activity_at (миграция add_profiles_last_activity).

-- Postgres не меняет RETURNS TABLE через CREATE OR REPLACE — сначала удаляем функцию.
drop function if exists public.list_my_chat_threads ();

create function public.list_my_chat_threads ()
returns table (
  thread_id uuid,
  kind text,
  title text,
  updated_at timestamptz,
  last_message_body text,
  last_message_at timestamptz,
  last_sender_id uuid,
  unread_count bigint,
  peer_user_id uuid,
  peer_display_name text,
  peer_email text,
  peer_position text,
  peer_last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with my_threads as (
    select ctm.thread_id, ctm.last_read_at
    from public.chat_thread_members ctm
    where ctm.user_id = auth.uid()
  ),
  last_msg as (
    select distinct on (m.thread_id)
      m.thread_id,
      m.body,
      m.created_at as msg_at,
      m.sender_id,
      m.attachment_name
    from public.chat_messages m
    inner join my_threads t on t.thread_id = m.thread_id
    order by m.thread_id, m.created_at desc
  ),
  unread as (
    select m.thread_id, count(*)::bigint as n
    from public.chat_messages m
    inner join my_threads t on t.thread_id = m.thread_id
    where m.sender_id is distinct from auth.uid()
      and (t.last_read_at is null or m.created_at > t.last_read_at)
    group by m.thread_id
  ),
  peer as (
    select ctm.thread_id, ctm.user_id as peer_uid
    from public.chat_thread_members ctm
    inner join public.chat_threads th on th.id = ctm.thread_id and th.kind = 'direct'
    where ctm.user_id <> auth.uid()
  )
  select
    th.id,
    th.kind,
    th.title,
    th.updated_at,
    case
      when lm.attachment_name is not null
        and (lm.body is null or btrim(lm.body) = '')
      then 'Файл: ' || lm.attachment_name
      else coalesce(lm.body, '')
    end,
    lm.msg_at,
    lm.sender_id,
    coalesce(u.n, 0)::bigint,
    p.peer_uid,
    prof.display_name,
    prof.email,
    prof.position,
    prof.last_activity_at
  from public.chat_threads th
  inner join my_threads mt on mt.thread_id = th.id
  left join last_msg lm on lm.thread_id = th.id
  left join unread u on u.thread_id = th.id
  left join peer p on p.thread_id = th.id and th.kind = 'direct'
  left join public.profiles prof on prof.id = p.peer_uid
  order by coalesce(lm.msg_at, th.updated_at) desc nulls last;
$$;

grant execute on function public.list_my_chat_threads () to authenticated;


-- ==========================================
-- MIGRATION: add_chat_messages_body_max_length
-- ==========================================

-- Ограничение длины текста сообщения (и подписи к файлу): 300 символов.

update public.chat_messages
set body = left(body, 300)
where body is not null
  and char_length(body) > 300;

alter table public.chat_messages
  drop constraint if exists chat_messages_body_max_len;

alter table public.chat_messages
  add constraint chat_messages_body_max_len check (
    body is null
    or char_length(body) <= 300
  );


-- ==========================================
-- MIGRATION: add_chat_messages_delete_policy
-- ==========================================

-- Удаление своих сообщений в чате (отправитель + участник потока).

drop policy if exists chat_messages_delete_own on public.chat_messages;

create policy chat_messages_delete_own
  on public.chat_messages
  for delete
  to authenticated
  using (
    sender_id = auth.uid()
    and public.user_is_member_of_chat_thread (thread_id)
  );

grant delete on public.chat_messages to authenticated;


-- ==========================================
-- MIGRATION: add_chat_urgent_problem_messages
-- ==========================================

-- Важные сообщения в чате (проблемные сообщения оператора):
-- - флаг важности у сообщения
-- - приоритет диалогов с непрочитанными важными сообщениями
-- - отдача признака важности в пагинации сообщений

alter table public.chat_messages
  add column if not exists is_urgent boolean not null default false,
  add column if not exists urgent_kind text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_urgent_kind_check'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_urgent_kind_check
      check (
        urgent_kind is null
        or urgent_kind in ('problem_report')
      );
  end if;
end;
$$;

create index if not exists chat_messages_thread_unread_urgent_idx
  on public.chat_messages (thread_id, created_at desc)
  where is_urgent = true;

-- Возвращаем признак важности в пагинации сообщений.
drop function if exists public.list_chat_messages_page (uuid, int, timestamptz, uuid);

create function public.list_chat_messages_page (
  p_thread uuid,
  p_limit int default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  thread_id uuid,
  sender_id uuid,
  body text,
  attachment_bucket text,
  attachment_path text,
  attachment_name text,
  attachment_size bigint,
  is_urgent boolean,
  urgent_kind text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.thread_id,
    m.sender_id,
    m.body,
    m.attachment_bucket,
    m.attachment_path,
    m.attachment_name,
    m.attachment_size,
    m.is_urgent,
    m.urgent_kind,
    m.created_at
  from public.chat_messages m
  where m.thread_id = p_thread
    and public.user_is_member_of_chat_thread (p_thread)
    and (
      p_before_created_at is null
      or p_before_id is null
      or (
        m.created_at < p_before_created_at
        or (m.created_at = p_before_created_at and m.id < p_before_id)
      )
    )
  order by m.created_at desc, m.id desc
  limit greatest(1, least(coalesce(nullif(p_limit, 0), 30), 100));
$$;

revoke all on function public.list_chat_messages_page (uuid, int, timestamptz, uuid) from public;
grant execute on function public.list_chat_messages_page (uuid, int, timestamptz, uuid) to authenticated;

-- Добавляем unread_urgent_count и сортировку по приоритету.
drop function if exists public.list_my_chat_threads ();

create function public.list_my_chat_threads ()
returns table (
  thread_id uuid,
  kind text,
  title text,
  updated_at timestamptz,
  last_message_body text,
  last_message_at timestamptz,
  last_sender_id uuid,
  unread_count bigint,
  unread_urgent_count bigint,
  peer_user_id uuid,
  peer_display_name text,
  peer_email text,
  peer_position text,
  peer_last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with my_threads as (
    select ctm.thread_id, ctm.last_read_at
    from public.chat_thread_members ctm
    where ctm.user_id = auth.uid()
  ),
  last_msg as (
    select distinct on (m.thread_id)
      m.thread_id,
      m.body,
      m.created_at as msg_at,
      m.sender_id,
      m.attachment_name,
      m.is_urgent
    from public.chat_messages m
    inner join my_threads t on t.thread_id = m.thread_id
    order by m.thread_id, m.created_at desc
  ),
  unread as (
    select
      m.thread_id,
      count(*)::bigint as n,
      count(*) filter (where m.is_urgent = true)::bigint as urgent_n
    from public.chat_messages m
    inner join my_threads t on t.thread_id = m.thread_id
    where m.sender_id is distinct from auth.uid()
      and (t.last_read_at is null or m.created_at > t.last_read_at)
    group by m.thread_id
  ),
  peer as (
    select ctm.thread_id, ctm.user_id as peer_uid
    from public.chat_thread_members ctm
    inner join public.chat_threads th on th.id = ctm.thread_id and th.kind = 'direct'
    where ctm.user_id <> auth.uid()
  )
  select
    th.id,
    th.kind,
    th.title,
    th.updated_at,
    case
      when lm.attachment_name is not null
        and (lm.body is null or btrim(lm.body) = '')
      then 'Файл: ' || lm.attachment_name
      when lm.is_urgent = true
      then 'Важно: ' || coalesce(lm.body, 'Проблемное сообщение')
      else coalesce(lm.body, '')
    end,
    lm.msg_at,
    lm.sender_id,
    coalesce(u.n, 0)::bigint,
    coalesce(u.urgent_n, 0)::bigint,
    p.peer_uid,
    prof.display_name,
    prof.email,
    prof.position,
    prof.last_activity_at
  from public.chat_threads th
  inner join my_threads mt on mt.thread_id = th.id
  left join last_msg lm on lm.thread_id = th.id
  left join unread u on u.thread_id = th.id
  left join peer p on p.thread_id = th.id and th.kind = 'direct'
  left join public.profiles prof on prof.id = p.peer_uid
  order by
    coalesce(u.urgent_n, 0) desc,
    coalesce(lm.msg_at, th.updated_at) desc nulls last;
$$;

grant execute on function public.list_my_chat_threads () to authenticated;


-- ==========================================
-- MIGRATION: sync_profiles_with_auth_users
-- ==========================================

-- Sync all auth users into public.profiles and keep it updated.

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    display_name,
    role,
    active,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.email,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ''),
    'worker',
    true,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_profile_from_auth_user on auth.users;
create trigger trg_sync_profile_from_auth_user
after insert or update of email, raw_user_meta_data
on auth.users
for each row
execute function public.sync_profile_from_auth_user();

-- Backfill: create missing profiles for all already registered users.
insert into public.profiles (
  id,
  email,
  display_name,
  role,
  active,
  created_at,
  updated_at
)
select
  u.id,
  u.email,
  nullif(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''), '') as display_name,
  'worker' as role,
  true as active,
  coalesce(u.created_at, now()) as created_at,
  now() as updated_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;


-- ==========================================
-- MIGRATION: add_profiles_last_activity
-- ==========================================

-- Последняя активность в приложении (редкие обновления с клиента, без вебсокетов).
alter table public.profiles
  add column if not exists last_activity_at timestamptz;

comment on column public.profiles.last_activity_at is
  'Время последней активности в веб-приложении; обновляется клиентом с throttling (см. touch_my_last_activity).';

-- Один лёгкий UPDATE на вызов, только своя строка.
create or replace function public.touch_my_last_activity ()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set last_activity_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.touch_my_last_activity () to authenticated;


-- ==========================================
-- MIGRATION: add_delete_my_account_rpc
-- ==========================================

-- Удаление собственного аккаунта (self-service) с очисткой ссылок на пользователя.
-- Вызывается из клиента: select public.delete_my_account();

create or replace function public.delete_my_account ()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Поля: снимаем ответственного, чтобы запись поля сохранилась.
  update public.fields
  set responsible_id = null
  where responsible_id = v_uid;

  -- История операций/простоев: отвязываем пользователя, чтобы журнал сохранялся.
  update public.operations
  set user_id = null
  where user_id = v_uid;

  update public.downtimes
  set user_id = null
  where user_id = v_uid;

  -- Задачи, где пользователь был автором: сохраняем задачу, убираем автора.
  update public.tasks
  set created_by = null
  where created_by = v_uid;

  -- Задачи, назначенные на пользователя: удаляем (в схеме assignee_id not null).
  delete from public.tasks
  where assignee_id = v_uid;

  -- Финальное удаление пользователя из auth.users.
  -- Остальные зависимости очищаются по on delete (profiles/chat/operator_status/calendar и т.д.).
  delete from auth.users
  where id = v_uid;
end;
$$;

grant execute on function public.delete_my_account () to authenticated;


-- ==========================================
-- MIGRATION: operation_stats_employees_page
-- ==========================================

-- Постраничная сводка операций по сотрудникам (аналитика) + индекс по end_iso
create index if not exists operations_end_iso_idx on public.operations (end_iso);

create or replace function public.operation_stats_employees_page(
  p_end_from timestamptz,
  p_end_to timestamptz,
  p_only_mine boolean,
  p_user_id uuid,
  p_employee_filter text,
  p_sort text,
  p_desc boolean,
  p_limit int,
  p_offset int
)
returns table (
  employee text,
  operation_count bigint,
  distinct_fields bigint,
  total_duration_minutes bigint,
  latest_end_iso timestamptz,
  total_groups bigint
)
language plpgsql
stable
set search_path = public
as $$
declare
  ord text;
  lim int;
  off int;
begin
  if p_sort is null or p_sort not in ('employee', 'operation', 'field', 'duration', 'ended') then
    p_sort := 'ended';
  end if;
  lim := greatest(coalesce(p_limit, 15), 1);
  off := greatest(coalesce(p_offset, 0), 0);
  ord := case
    when p_sort = 'employee' and p_desc then 'c.employee desc'
    when p_sort = 'employee' and not p_desc then 'c.employee asc'
    when p_sort = 'operation' and p_desc then 'c.operation_count desc'
    when p_sort = 'operation' and not p_desc then 'c.operation_count asc'
    when p_sort = 'field' and p_desc then 'c.distinct_fields desc'
    when p_sort = 'field' and not p_desc then 'c.distinct_fields asc'
    when p_sort = 'duration' and p_desc then 'c.total_duration_minutes desc'
    when p_sort = 'duration' and not p_desc then 'c.total_duration_minutes asc'
    when p_sort = 'ended' and p_desc then 'c.latest_end_iso desc nulls last'
    else 'c.latest_end_iso asc nulls last'
  end;

  return query execute format(
    $q$
    with filtered as (
      select o.*
      from public.operations o
      where o.end_iso >= $1
        and o.end_iso <= $2
        and ($3 = false or o.user_id = $4)
        and (
          $5::text is null
          or trim($5::text) = ''
          or o.employee = trim($5::text)
          or o.employee ilike ('%%' || trim($5::text) || '%%')
          or trim($5::text) ilike ('%%' || o.employee || '%%')
        )
    ),
    agg as (
      select
        f.employee,
        count(*)::bigint as operation_count,
        count(
          distinct coalesce(
            nullif(trim(f.field_id), ''),
            nullif(trim(f.field_name), ''),
            '-'
          )
        )::bigint as distinct_fields,
        coalesce(sum(f.duration_minutes), 0)::bigint as total_duration_minutes,
        max(f.end_iso) as latest_end_iso
      from filtered f
      group by f.employee
    ),
    counted as (
      select
        a.*,
        count(*) over ()::bigint as total_groups
      from agg a
    )
    select
      c.employee,
      c.operation_count,
      c.distinct_fields,
      c.total_duration_minutes,
      c.latest_end_iso,
      c.total_groups
    from counted c
    order by %s
    limit $6
    offset $7
    $q$,
    ord
  )
  using p_end_from, p_end_to, p_only_mine, p_user_id, p_employee_filter, lim, off;
end;
$$;

grant execute on function public.operation_stats_employees_page(
  timestamptz,
  timestamptz,
  boolean,
  uuid,
  text,
  text,
  boolean,
  int,
  int
) to anon, authenticated;


-- ==========================================
-- STORAGE: Create buckets
-- ==========================================


insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('field-schemes',      'field-schemes',      true, null, null),
  ('field-photos',       'field-photos',       true, null, null),
  ('equipment-photos',   'equipment-photos',   true, null, null),
  ('task-attachments',   'task-attachments',   true, null, null),
  ('chat-attachments',   'chat-attachments',   true, 10485760, null)
on conflict (id) do nothing;


-- ==========================================
-- STORAGE: field-schemes policies
-- ==========================================

-- Политики для бакета "field-schemes" (схемы полей).
-- Выполни в Supabase: SQL Editor → New query → вставь этот блок → Run.
-- Бакет должен быть создан вручную: Storage → New bucket → имя "field-schemes", Public = true.

drop policy if exists "field-schemes: allow insert" on storage.objects;
drop policy if exists "field-schemes: allow select" on storage.objects;
drop policy if exists "field-schemes: allow update" on storage.objects;
drop policy if exists "field-schemes: allow delete" on storage.objects;

-- Разрешить загрузку файлов (authenticated и anon, чтобы работало и до входа)
create policy "field-schemes: allow insert"
on storage.objects for insert
with check (bucket_id = 'field-schemes');

-- Разрешить чтение (публичный бакет — объекты доступны по URL и так, но для API может понадобиться)
create policy "field-schemes: allow select"
on storage.objects for select
using (bucket_id = 'field-schemes');

-- Разрешить обновление/удаление (для замены файла схемы)
create policy "field-schemes: allow update"
on storage.objects for update
using (bucket_id = 'field-schemes');

create policy "field-schemes: allow delete"
on storage.objects for delete
using (bucket_id = 'field-schemes');


-- ==========================================
-- STORAGE: chat-attachments policies
-- ==========================================

-- Если бакет chat-attachments уже создан в Dashboard — выполни только этот файл.
-- Иначе используй add_chat_attachments_storage.sql целиком.

drop policy if exists "chat-attachments: allow insert" on storage.objects;
drop policy if exists "chat-attachments: allow select" on storage.objects;
drop policy if exists "chat-attachments: allow delete" on storage.objects;

create policy "chat-attachments: allow insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments');

create policy "chat-attachments: allow select"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments');

create policy "chat-attachments: allow delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-attachments');


-- ==========================================
-- STORAGE: task-attachments policies
-- ==========================================


drop policy if exists "task-attachments: allow insert" on storage.objects;
drop policy if exists "task-attachments: allow select" on storage.objects;
drop policy if exists "task-attachments: allow update" on storage.objects;
drop policy if exists "task-attachments: allow delete" on storage.objects;
create policy "task-attachments: allow insert" on storage.objects for insert with check (bucket_id = 'task-attachments');
create policy "task-attachments: allow select" on storage.objects for select using (bucket_id = 'task-attachments');
create policy "task-attachments: allow update" on storage.objects for update using (bucket_id = 'task-attachments');
create policy "task-attachments: allow delete" on storage.objects for delete using (bucket_id = 'task-attachments');


-- ==========================================
-- STORAGE: equipment-photos policies
-- ==========================================


drop policy if exists "equipment-photos: allow insert" on storage.objects;
drop policy if exists "equipment-photos: allow select" on storage.objects;
drop policy if exists "equipment-photos: allow update" on storage.objects;
drop policy if exists "equipment-photos: allow delete" on storage.objects;
create policy "equipment-photos: allow insert" on storage.objects for insert with check (bucket_id = 'equipment-photos');
create policy "equipment-photos: allow select" on storage.objects for select using (bucket_id = 'equipment-photos');
create policy "equipment-photos: allow update" on storage.objects for update using (bucket_id = 'equipment-photos');
create policy "equipment-photos: allow delete" on storage.objects for delete using (bucket_id = 'equipment-photos');


-- ==========================================
-- STORAGE: field-photos policies
-- ==========================================


drop policy if exists "field-photos: allow insert" on storage.objects;
drop policy if exists "field-photos: allow select" on storage.objects;
drop policy if exists "field-photos: allow update" on storage.objects;
drop policy if exists "field-photos: allow delete" on storage.objects;
create policy "field-photos: allow insert" on storage.objects for insert with check (bucket_id = 'field-photos');
create policy "field-photos: allow select" on storage.objects for select using (bucket_id = 'field-photos');
create policy "field-photos: allow update" on storage.objects for update using (bucket_id = 'field-photos');
create policy "field-photos: allow delete" on storage.objects for delete using (bucket_id = 'field-photos');
