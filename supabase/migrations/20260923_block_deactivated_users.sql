-- =====================================================================
-- Отключённый сотрудник не должен входить на портал и работать с данными.
--
-- Раньше флаг «сотрудник отключён» проверялся только в интерфейсе и
-- только по user_metadata.active. Это поле владелец аккаунта меняет сам
-- вызовом supabase.auth.updateUser({ data: { active: true } }), а правила
-- доступа в базе флаг не проверяли. Отключённый сотрудник мог одним
-- вызовом вернуть себе вход и доступ ко всем данным работника.
--
-- Теперь источник истины — profiles.active (колонка закрыта грантами,
-- менять её может только service_role, см. 20260819_fix_access_control.sql).
-- Триггер переносит этот флаг в сам Auth:
--   * active = false — учётная запись блокируется (auth.users.banned_until),
--     все её сессии удаляются. Войти заново нельзя, обновить токен тоже:
--     доступ пропадает не позже, чем истечёт текущий access-токен
--     (JWT_EXPIRY, по умолчанию 1 час);
--   * active = true — блокировка снимается.
--
-- Применять вместе с правкой фронтенда из той же ветки (stores/auth.ts
-- читает флаг из profiles и показывает понятное сообщение при входе).
-- Порядок не важен: миграция без фронтенда уже закрывает доступ, фронтенд
-- без миграции просто не пускает в интерфейс по profiles.active.
--
-- Миграция идемпотентна: безопасно выполнять повторно.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Синхронизация profiles.active → блокировка в Auth
-- ---------------------------------------------------------------------

create or replace function public.sync_profile_active_to_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'UPDATE' and new.active is not distinct from old.active then
    return new;
  end if;

  -- Дата вместо 'infinity': GoTrue читает banned_until как время, и
  -- бесконечность из Postgres в него не разбирается.
  update auth.users
     set banned_until = case when new.active then null
                             else timestamptz '2999-12-31 00:00:00+00' end
   where id = new.id;

  if not new.active then
    delete from auth.sessions where user_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_profile_active_to_auth() from public, anon, authenticated;

drop trigger if exists profiles_sync_active_to_auth on public.profiles;
create trigger profiles_sync_active_to_auth
  after insert or update of active on public.profiles
  for each row
  execute function public.sync_profile_active_to_auth();


-- ---------------------------------------------------------------------
-- 2. Уже отключённые сотрудники: заблокировать сейчас
--
-- Триггер срабатывает только на будущие изменения. Тех, кого отключили
-- раньше, блокируем разово.
-- ---------------------------------------------------------------------

update auth.users u
   set banned_until = timestamptz '2999-12-31 00:00:00+00'
  from public.profiles p
 where p.id = u.id
   and p.active = false
   and (u.banned_until is null or u.banned_until < now());

delete from auth.sessions s
 using public.profiles p
 where p.id = s.user_id
   and p.active = false;


-- ---------------------------------------------------------------------
-- 3. Проверка после применения
-- ---------------------------------------------------------------------
-- Все отключённые должны быть заблокированы, активные — нет. Запрос
-- должен вернуть ноль строк:
--
--   select p.email, p.active, u.banned_until
--   from public.profiles p
--   join auth.users u on u.id = p.id
--   where (p.active = false and (u.banned_until is null or u.banned_until < now()))
--      or (p.active = true and u.banned_until > now());
--
-- Запись в журнал:
--
--   insert into public.applied_migrations (filename, note)
--   values ('20260923_block_deactivated_users.sql',
--           'отключённые сотрудники блокируются в Auth по profiles.active');
