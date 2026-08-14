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
