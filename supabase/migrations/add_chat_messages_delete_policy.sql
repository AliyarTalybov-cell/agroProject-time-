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
