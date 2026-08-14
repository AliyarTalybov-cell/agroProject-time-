alter table public.news_posts
  add column if not exists cover_excerpt_position text not null default 'left-bottom';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'news_posts_cover_excerpt_position_check'
  ) then
    alter table public.news_posts
      add constraint news_posts_cover_excerpt_position_check
      check (cover_excerpt_position in ('left-top', 'right-top', 'left-bottom', 'right-bottom'));
  end if;
end $$;
