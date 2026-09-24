-- =====================================================================
-- Бэкенд переехал с agro-project.duckdns.org на 7207239-sp280358.twc1.net.
--
-- Ссылки на файлы Storage сохраняются в таблицах целиком, вместе с адресом
-- бэкенда. Старые ссылки переписаны на новый адрес, после чего duckdns
-- убран из Caddy.
--
-- Применено на боевой базе 2026-09-24: 68 значений в колонках ниже.
-- Копия таблиц до правки: /root/backups/before-duckdns-urls-20260924.sql.gz
-- на сервере базы. В auth.users и storage.objects ссылок с duckdns не было.
--
-- Миграция идемпотентна: повторный запуск ничего не меняет.
-- =====================================================================

begin;

update public.news_posts set cover_image_url = replace(cover_image_url, 'https://agro-project.duckdns.org', 'https://7207239-sp280358.twc1.net') where cover_image_url like '%agro-project.duckdns.org%';
update public.news_posts set content = replace(content, 'https://agro-project.duckdns.org', 'https://7207239-sp280358.twc1.net') where content like '%agro-project.duckdns.org%';
update public.news_posts set gallery_urls = replace(gallery_urls::text, 'https://agro-project.duckdns.org', 'https://7207239-sp280358.twc1.net')::jsonb where gallery_urls::text like '%agro-project.duckdns.org%';
update public.equipment_photos set file_url = replace(file_url, 'https://agro-project.duckdns.org', 'https://7207239-sp280358.twc1.net') where file_url like '%agro-project.duckdns.org%';
update public.equipment_documents set file_url = replace(file_url, 'https://agro-project.duckdns.org', 'https://7207239-sp280358.twc1.net') where file_url like '%agro-project.duckdns.org%';
update public.field_photos set file_url = replace(file_url, 'https://agro-project.duckdns.org', 'https://7207239-sp280358.twc1.net') where file_url like '%agro-project.duckdns.org%';
update public.fields set scheme_file_url = replace(scheme_file_url, 'https://agro-project.duckdns.org', 'https://7207239-sp280358.twc1.net') where scheme_file_url like '%agro-project.duckdns.org%';
update public.profiles set avatar_url = replace(avatar_url, 'https://agro-project.duckdns.org', 'https://7207239-sp280358.twc1.net') where avatar_url like '%agro-project.duckdns.org%';
update public.land_rights set supporting_documents = replace(supporting_documents, 'https://agro-project.duckdns.org', 'https://7207239-sp280358.twc1.net') where supporting_documents like '%agro-project.duckdns.org%';
update public.land_users set supporting_documents = replace(supporting_documents, 'https://agro-project.duckdns.org', 'https://7207239-sp280358.twc1.net') where supporting_documents like '%agro-project.duckdns.org%';

-- Если ссылки с duckdns где-то остались, вся правка откатывается.
do $$
declare r record; n int; total int := 0;
begin
  for r in select table_name t, column_name c from information_schema.columns
           where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb')
  loop
    execute format('select count(*) from public.%I where %I::text like %L', r.t, r.c, '%duckdns%') into n;
    total := total + n;
  end loop;
  if total > 0 then raise exception 'осталось % ссылок с duckdns, откат', total; end if;
end $$;

insert into public.applied_migrations (filename, note)
values ('20260924_replace_duckdns_urls.sql', 'ссылки на файлы переведены с agro-project.duckdns.org на 7207239-sp280358.twc1.net')
on conflict (filename) do nothing;

commit;
