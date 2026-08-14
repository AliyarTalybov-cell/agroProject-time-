create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  excerpt text null,
  cover_image_url text null,
  content text not null,
  gallery_urls jsonb not null default '[]'::jsonb,
  published_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_news_posts_published_at on public.news_posts(published_at desc);

alter table public.news_posts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'news_posts'
      and policyname = 'news_posts_select_all'
  ) then
    create policy news_posts_select_all
      on public.news_posts
      for select
      to authenticated
      using (true);
  end if;
end $$;

insert into storage.buckets (id, name, public)
select 'news-files', 'news-files', true
where not exists (select 1 from storage.buckets where id = 'news-files');

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'news_files_read_all'
  ) then
    create policy news_files_read_all
      on storage.objects
      for select
      to authenticated
      using (bucket_id = 'news-files');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'news_files_write_manager'
  ) then
    create policy news_files_write_manager
      on storage.objects
      for all
      to authenticated
      using (bucket_id = 'news-files' and (auth.jwt() ->> 'role') = 'manager')
      with check (bucket_id = 'news-files' and (auth.jwt() ->> 'role') = 'manager');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'news_posts'
      and policyname = 'news_posts_insert_manager'
  ) then
    create policy news_posts_insert_manager
      on public.news_posts
      for insert
      to authenticated
      with check ((auth.jwt() ->> 'role') = 'manager');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'news_posts'
      and policyname = 'news_posts_update_manager'
  ) then
    create policy news_posts_update_manager
      on public.news_posts
      for update
      to authenticated
      using ((auth.jwt() ->> 'role') = 'manager')
      with check ((auth.jwt() ->> 'role') = 'manager');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'news_posts'
      and policyname = 'news_posts_delete_manager'
  ) then
    create policy news_posts_delete_manager
      on public.news_posts
      for delete
      to authenticated
      using ((auth.jwt() ->> 'role') = 'manager');
  end if;
end $$;
