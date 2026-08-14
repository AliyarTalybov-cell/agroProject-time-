-- Исправление проверки роли в RLS для новостей.
-- Роль хранится в JWT в user_metadata.role, а не в auth.jwt()->>'role'.

drop policy if exists news_posts_insert_manager on public.news_posts;
create policy news_posts_insert_manager
  on public.news_posts
  for insert
  to authenticated
  with check (
    coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
  );

drop policy if exists news_posts_update_manager on public.news_posts;
create policy news_posts_update_manager
  on public.news_posts
  for update
  to authenticated
  using (
    coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
  )
  with check (
    coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
  );

drop policy if exists news_posts_delete_manager on public.news_posts;
create policy news_posts_delete_manager
  on public.news_posts
  for delete
  to authenticated
  using (
    coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
  );

drop policy if exists news_files_write_manager on storage.objects;
create policy news_files_write_manager
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'news-files'
    and (
      coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
    )
  )
  with check (
    bucket_id = 'news-files'
    and (
      coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
    )
  );
