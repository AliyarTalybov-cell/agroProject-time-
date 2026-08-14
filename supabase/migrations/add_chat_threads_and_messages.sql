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
