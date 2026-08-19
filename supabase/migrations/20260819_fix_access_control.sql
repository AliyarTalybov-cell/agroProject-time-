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

do $$
declare
  t text;
  tables text[] := ARRAY[
    'fields', 'field_photos', 'field_municipalities_refs',
    'equipment', 'equipment_implements', 'equipment_type_refs',
    'equipment_condition_refs', 'equipment_photos', 'equipment_documents',
    'tasks', 'task_files',
    'calendar_tasks', 'calendar_task_assignees', 'calendar_task_files',
    'operator_status', 'downtime_reasons', 'work_operations',
    'land_types', 'land_categories', 'crops', 'land_actual_use_options',
    'lands', 'land_rights', 'land_right_ownership_forms', 'land_right_types',
    'land_right_document_types', 'land_right_holder_types', 'land_right_holders',
    'land_users', 'land_crop_rotations',
    'land_melioration_types', 'land_melioration_subtypes',
    'land_melioration_event_types', 'land_melioration_entries',
    'land_real_estate_objects',
    'storage_locations', 'storage_batches', 'storage_intakes',
    'storage_writeoffs', 'storage_fill_statuses',
    'news_posts'
  ];
begin
  foreach t in array tables loop
    -- пропускаем таблицы, которых нет в этой базе
    if to_regclass('public.' || quote_ident(t)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_manager_only', t);
    execute format('drop policy if exists "Allow all for %s" on public.%I', t, t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_select_all', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (true)',
      t || '_insert_all', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (true) with check (true)',
      t || '_update_all', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_manager_role())',
      t || '_delete_manager_only', t
    );

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 5. Политики, где проверка роли была вписана в тело политики
--
-- Эти пять политик не вызывали is_manager_role(), а сравнивали
-- auth.jwt() -> 'user_metadata' напрямую, поэтому пункт 1 их не чинит.
-- ---------------------------------------------------------------------

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

drop policy if exists field_municipalities_refs_delete_manager_only
  on public.field_municipalities_refs;
create policy field_municipalities_refs_delete_manager_only
  on public.field_municipalities_refs
  for delete
  to authenticated
  using (public.is_manager_role());


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
