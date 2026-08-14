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
