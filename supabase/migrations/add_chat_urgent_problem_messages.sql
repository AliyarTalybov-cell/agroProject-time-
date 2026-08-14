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
