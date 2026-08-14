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
