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
