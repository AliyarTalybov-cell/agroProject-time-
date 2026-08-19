-- =====================================================================
-- Исправление модели доступа. Закрывает находки 1–4 аудита.
--
-- ВАЖНО: применять вместе с правкой фронтенда из той же ветки
-- (ProfilePage перестаёт отправлять role/email при сохранении профиля).
-- Если применить только миграцию — сохранение профиля начнёт падать
-- с ошибкой прав на колонку role.
--
-- Миграция идемпотентна: безопасно выполнять повторно.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Роль определяется по таблице profiles, а не по JWT
--
-- user_metadata редактируется владельцем аккаунта клиентским вызовом
-- supabase.auth.updateUser({ data: { role: 'manager' } }), поэтому
-- опираться на неё в проверках прав нельзя. Переопределяем функцию,
-- которую уже вызывает большинство политик, — этого достаточно, чтобы
-- починить их все разом.
-- ---------------------------------------------------------------------

create or replace function public.is_manager_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'manager'
      and p.active
  );
$$;

grant execute on function public.is_manager_role() to authenticated;
revoke execute on function public.is_manager_role() from anon;


-- ---------------------------------------------------------------------
-- 2. Таблица profiles: чтение всем вошедшим, запись — только своей
--    строки и только безопасных колонок
--
-- role и active остаются доступны исключительно service_role,
-- то есть Edge Functions admin-*. Ограничение делается грантами на
-- колонки: RLS-политика не может сравнить новое значение со старым.
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "Allow all for profiles" on public.profiles;
drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

create policy profiles_select_authenticated
  on public.profiles
  for select
  to authenticated
  using (true);

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Строки создаёт триггер синхронизации с auth.users, а не клиент.
-- INSERT и DELETE остаются только у service_role.
revoke insert, delete on public.profiles from authenticated, anon;

-- Раз клиент больше не может создать себе строку профиля — добираем тех,
-- кто зарегистрировался до появления триггера sync_profile_from_auth_user.
insert into public.profiles (id, email, display_name, role, active, created_at, updated_at)
select
  u.id,
  u.email,
  nullif(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''), ''),
  'worker',
  true,
  coalesce(u.created_at, now()),
  now()
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

revoke update on public.profiles from authenticated, anon;
grant update (display_name, phone, position, additional_info, avatar_url, updated_at)
  on public.profiles to authenticated;

revoke select on public.profiles from anon;
grant select on public.profiles to authenticated;


-- ---------------------------------------------------------------------
-- 3. Чат: снять открытые политики, наложенные поверх приватных
--
-- restrict_delete_to_manager_only.sql добавил к chat_messages политики
-- вида using (true). Разрешающие политики в Postgres объединяются через
-- OR, поэтому открытая перекрывала «только участники потока»:
-- любой вошедший читал все личные диалоги и мог править чужие сообщения.
-- ---------------------------------------------------------------------

drop policy if exists chat_messages_select_all on public.chat_messages;
drop policy if exists chat_messages_insert_all on public.chat_messages;
drop policy if exists chat_messages_update_all on public.chat_messages;
drop policy if exists "Allow all for chat_messages" on public.chat_messages;

-- UPDATE сообщений из клиента не предусмотрен: правка чужих сообщений
-- была побочным эффектом открытой политики.
revoke update on public.chat_messages from authenticated, anon;

-- Восстанавливаем приватные политики на случай, если они были снесены.
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select
  on public.chat_messages
  for select
  to authenticated
  using (public.user_is_member_of_chat_thread (thread_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert
  on public.chat_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.user_is_member_of_chat_thread (thread_id)
  );


-- ---------------------------------------------------------------------
-- 4. Ограничить открытые политики ролью authenticated
--
-- Политики создавались без предложения TO, что в Postgres означает
-- TO PUBLIC — включая роль anon. Anon-ключ публичен (лежит в бандле),
-- поэтому такие таблицы были доступны без входа в систему.
--
-- Пересоздаём те же политики с явным to authenticated и отзываем
-- гранты у anon.
-- ---------------------------------------------------------------------

-- Главный рычаг — гранты, а не политики: без права на таблицу роль anon
-- ничего не сделает, какой бы ни была политика. Списком таблицы не
-- перечисляем: в проекте 81 миграция, и что-нибудь обязательно забудется.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Чтобы новые таблицы не открывались для anon автоматически.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Проверка доступности БД (баннер «сервер не отвечает») выполняется на
-- странице входа, то есть от имени anon. Раньше она читала таблицу
-- downtimes — теперь для этого есть функция, не дающая доступа к данным.
create or replace function public.health_check()
returns boolean
language sql
stable
as $$ select true $$;

grant execute on function public.health_check() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. Политики, где проверка роли была вписана в тело политики
--
-- Эти пять политик не вызывали is_manager_role(), а сравнивали
-- auth.jwt() -> 'user_metadata' напрямую, поэтому пункт 1 их не чинит.
-- ---------------------------------------------------------------------

-- Новости: читают все вошедшие, пишет только руководитель.
-- Снимаем открытые политики, которые ставил restrict_delete_to_manager_only.sql,
-- иначе они объединились бы с manager-политиками через OR.
alter table public.news_posts enable row level security;

drop policy if exists news_posts_select_all on public.news_posts;
drop policy if exists news_posts_insert_all on public.news_posts;
drop policy if exists news_posts_update_all on public.news_posts;
drop policy if exists news_posts_delete_manager_only on public.news_posts;
drop policy if exists "Allow all for news_posts" on public.news_posts;

create policy news_posts_select_all
  on public.news_posts
  for select
  to authenticated
  using (true);

revoke all on public.news_posts from anon;
grant select, insert, update, delete on public.news_posts to authenticated;

drop policy if exists news_posts_insert_manager on public.news_posts;
create policy news_posts_insert_manager
  on public.news_posts
  for insert
  to authenticated
  with check (public.is_manager_role());

drop policy if exists news_posts_update_manager on public.news_posts;
create policy news_posts_update_manager
  on public.news_posts
  for update
  to authenticated
  using (public.is_manager_role())
  with check (public.is_manager_role());

drop policy if exists news_posts_delete_manager on public.news_posts;
create policy news_posts_delete_manager
  on public.news_posts
  for delete
  to authenticated
  using (public.is_manager_role());

drop policy if exists news_files_write_manager on storage.objects;
create policy news_files_write_manager
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'news-files' and public.is_manager_role())
  with check (bucket_id = 'news-files' and public.is_manager_role());


-- ---------------------------------------------------------------------
-- 6. Сузить до authenticated все оставшиеся политики без предложения TO
--
-- Политика без TO создаётся как TO PUBLIC, то есть распространяется и на
-- anon. Перечислять такие таблицы руками ненадёжно — их создавали десятки
-- миграций. Поэтому находим их запросом к каталогу и пересоздаём с тем же
-- именем и той же логикой, добавив только to authenticated.
--
-- Идёт последним: политики, созданные выше, уже имеют явное TO и под
-- выборку не попадут.
-- ---------------------------------------------------------------------

do $$
declare
  r record;
  cmd text;
  sql text;
begin
  for r in
    select
      c.relname as tbl,
      p.polname as pol,
      p.polcmd as pcmd,
      pg_get_expr(p.polqual, p.polrelid) as qual,
      pg_get_expr(p.polwithcheck, p.polrelid) as wcheck
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and p.polpermissive          -- ограничивающие политики трогать незачем
      and 0 = any (p.polroles)     -- 0 = PUBLIC, то есть включая anon
  loop
    cmd := case r.pcmd
             when 'r' then 'select'
             when 'a' then 'insert'
             when 'w' then 'update'
             when 'd' then 'delete'
             else 'all'
           end;

    execute format('drop policy %I on public.%I', r.pol, r.tbl);

    sql := format('create policy %I on public.%I for %s to authenticated', r.pol, r.tbl, cmd);
    if r.qual is not null then
      sql := sql || format(' using (%s)', r.qual);
    end if;
    if r.wcheck is not null then
      sql := sql || format(' with check (%s)', r.wcheck);
    end if;

    execute sql;
    raise notice 'политика % на %: сужена до authenticated', r.pol, r.tbl;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- Проверка результата
--
-- 1) Политик, доступных anon, быть не должно:
--
--    select schemaname, tablename, policyname, roles
--    from pg_policies
--    where schemaname = 'public' and 'anon' = any(roles);
--
-- 2) Грантов у anon в public быть не должно (кроме осознанно оставленных):
--
--    select table_name, privilege_type
--    from information_schema.role_table_grants
--    where grantee = 'anon' and table_schema = 'public'
--    order by table_name;
--
-- 3) Проверок роли по JWT в политиках остаться не должно:
--
--    select policyname, tablename
--    from pg_policies
--    where qual like '%user_metadata%' or with_check like '%user_metadata%';
--
-- 4) ОБЯЗАТЕЛЬНО: сверьте список руководителей глазами. До этой миграции
--    роль в profiles заполнялась из user_metadata, которую пользователь
--    редактирует сам, поэтому текущие значения могли быть подменены:
--
--    select p.email, p.role, p.active,
--           u.raw_user_meta_data ->> 'role' as role_v_metadata
--    from public.profiles p
--    join auth.users u on u.id = p.id
--    where p.role = 'manager' or u.raw_user_meta_data ->> 'role' = 'manager'
--    order by p.email;
--
--    Лишним ролям — снять вручную:
--    update public.profiles set role = 'worker' where email = '...';
-- ---------------------------------------------------------------------
