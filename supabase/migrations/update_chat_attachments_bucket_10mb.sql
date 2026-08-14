-- Если бакет chat-attachments уже был с лимитом 50 МБ — обновить до 10 МБ.
update storage.buckets
set file_size_limit = 10485760
where id = 'chat-attachments';
