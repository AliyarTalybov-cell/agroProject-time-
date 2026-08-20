-- Учёт применённых миграций.
--
-- Порядок применения 81 старой миграции по каталогу не восстанавливается:
-- имена без дат и номеров, а в git все они пришли одним коммитом 593097a.
-- Именно из-за этого возникла находка 4 аудита: открытая политика на
-- chat_messages победила приватную просто потому, что её применили позже.
--
-- Переименовывать старые файлы задним числом нельзя — мы не знаем их
-- настоящего порядка и закрепили бы выдумку. Поэтому источником истины
-- становится не каталог, а сама база: ниже журнал того, что в ней
-- действительно выполнено.
--
-- Как пользоваться: выполнив миграцию в SQL Editor, добавьте о ней запись:
--   insert into public.applied_migrations (filename, note)
--   values ('20260820_migration_ledger.sql', 'заведён журнал');
--
-- Миграция идемпотентна, повторное выполнение безопасно.

create table if not exists public.applied_migrations (
  filename text primary key,
  applied_at timestamptz not null default now(),
  applied_by text not null default current_user,
  note text
);

comment on table public.applied_migrations is
  'Журнал миграций, выполненных на этой базе. Заполняется вручную из SQL Editor.';

alter table public.applied_migrations enable row level security;

-- Читать журнал может любой вошедший: это не данные, а история изменений схемы.
drop policy if exists applied_migrations_select_authenticated on public.applied_migrations;
create policy applied_migrations_select_authenticated
  on public.applied_migrations
  for select
  to authenticated
  using (true);

-- Писать журнал клиент не должен ни при каких условиях: запись делает тот,
-- кто выполняет миграцию, из SQL Editor под ролью владельца базы.
-- Политика тут не помогла бы — ограничение ставится грантами.
revoke all on public.applied_migrations from anon;
revoke insert, update, delete on public.applied_migrations from authenticated, anon;
grant select on public.applied_migrations to authenticated;

-- Известное на момент заведения журнала: миграция контроля доступа
-- применена и проверена (health_check отвечает, is_manager_role доступна,
-- profiles и downtimes для anon дают permission denied).
insert into public.applied_migrations (filename, note)
values
  ('20260819_fix_access_control.sql', 'проверено на боевой базе 19.08.2026'),
  ('20260820_migration_ledger.sql', 'заведён журнал')
on conflict (filename) do nothing;
