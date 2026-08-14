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
