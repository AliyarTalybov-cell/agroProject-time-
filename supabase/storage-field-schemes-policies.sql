-- Политики для бакета "field-schemes" (схемы полей).
-- Выполни в Supabase: SQL Editor → New query → вставь этот блок → Run.
-- Бакет должен быть создан вручную: Storage → New bucket → имя "field-schemes", Public = true.

drop policy if exists "field-schemes: allow insert" on storage.objects;
drop policy if exists "field-schemes: allow select" on storage.objects;
drop policy if exists "field-schemes: allow update" on storage.objects;
drop policy if exists "field-schemes: allow delete" on storage.objects;

-- Разрешить загрузку файлов (authenticated и anon, чтобы работало и до входа)
create policy "field-schemes: allow insert"
on storage.objects for insert
with check (bucket_id = 'field-schemes');

-- Разрешить чтение (публичный бакет — объекты доступны по URL и так, но для API может понадобиться)
create policy "field-schemes: allow select"
on storage.objects for select
using (bucket_id = 'field-schemes');

-- Разрешить обновление/удаление (для замены файла схемы)
create policy "field-schemes: allow update"
on storage.objects for update
using (bucket_id = 'field-schemes');

create policy "field-schemes: allow delete"
on storage.objects for delete
using (bucket_id = 'field-schemes');
