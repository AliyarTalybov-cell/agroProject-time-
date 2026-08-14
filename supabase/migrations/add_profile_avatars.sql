-- Аватары профиля: колонка avatar_url + публичный бакет Storage + политики.
-- Путь объекта: {user_id}/{uuid}_{имя_файла}

-- 1) Колонка для ссылки на аватар в профиле
alter table public.profiles add column if not exists avatar_url text;

-- 2) Публичный бакет (20 МБ, только изображения)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  20971520,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 3) Политики доступа: читать может кто угодно (бакет публичный),
--    а изменять/удалять — только свой каталог ({user_id}/...).
drop policy if exists "avatars: public read" on storage.objects;
drop policy if exists "avatars: user insert own folder" on storage.objects;
drop policy if exists "avatars: user update own folder" on storage.objects;
drop policy if exists "avatars: user delete own folder" on storage.objects;

create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: user insert own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "avatars: user update own folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "avatars: user delete own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
