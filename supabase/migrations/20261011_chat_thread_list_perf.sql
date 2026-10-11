-- Список переписок без перебора всей истории.
--
-- Было: последнее сообщение искалось через DISTINCT ON по всем сообщениям всех
-- переписок пользователя — чем больше история, тем дольше; а список
-- перезапрашивается на каждое новое сообщение.
-- Стало: по одному последнему сообщению на переписку через LATERAL ... LIMIT 1
-- по индексу chat_messages_thread_created_idx (thread_id, created_at desc).
-- Непрочитанные считаются только среди сообщений после last_read_at (тот же индекс).
--
-- Сигнатура и столбцы те же, что в add_chat_urgent_problem_messages.sql —
-- фронтенд менять не нужно. Повторный запуск безопасен.

create index if not exists chat_messages_thread_created_idx
  on public.chat_messages (thread_id, created_at desc);

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
    lm.created_at,
    lm.sender_id,
    coalesce(u.n, 0)::bigint,
    coalesce(u.urgent_n, 0)::bigint,
    p.peer_uid,
    prof.display_name,
    prof.email,
    prof.position,
    prof.last_activity_at
  from public.chat_thread_members mt
  join public.chat_threads th on th.id = mt.thread_id
  left join lateral (
    select m.body, m.created_at, m.sender_id, m.attachment_name, m.is_urgent
    from public.chat_messages m
    where m.thread_id = mt.thread_id
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select
      count(*)::bigint as n,
      count(*) filter (where m.is_urgent = true)::bigint as urgent_n
    from public.chat_messages m
    where m.thread_id = mt.thread_id
      and m.sender_id is distinct from auth.uid()
      and (mt.last_read_at is null or m.created_at > mt.last_read_at)
  ) u on true
  left join lateral (
    select o.user_id as peer_uid
    from public.chat_thread_members o
    where th.kind = 'direct'
      and o.thread_id = mt.thread_id
      and o.user_id <> auth.uid()
    limit 1
  ) p on true
  left join public.profiles prof on prof.id = p.peer_uid
  where mt.user_id = auth.uid()
  order by
    coalesce(u.urgent_n, 0) desc,
    coalesce(lm.created_at, th.updated_at) desc nulls last;
$$;

grant execute on function public.list_my_chat_threads () to authenticated;

insert into public.applied_migrations (filename, note)
values ('20261011_chat_thread_list_perf.sql', 'список переписок: последнее сообщение и непрочитанные через индекс, без перебора всей истории')
on conflict (filename) do nothing;
