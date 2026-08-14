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
