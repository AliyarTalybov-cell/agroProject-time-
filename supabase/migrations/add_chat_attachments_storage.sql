-- Файлы в чате: бакет Storage + политики (как у task-attachments).
-- Путь объекта: {thread_id}/{user_id}/{uuid}_{имя_файла}

-- 10 МБ = 10485760 байт
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', true, 10485760)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "chat-attachments: allow insert" on storage.objects;
drop policy if exists "chat-attachments: allow select" on storage.objects;
drop policy if exists "chat-attachments: allow delete" on storage.objects;

create policy "chat-attachments: allow insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments');

create policy "chat-attachments: allow select"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments');

-- Удалять может только автор объекта (первый сегмент пути = thread_id — не user_id; проще: любой authenticated для MVP)
create policy "chat-attachments: allow delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-attachments');
