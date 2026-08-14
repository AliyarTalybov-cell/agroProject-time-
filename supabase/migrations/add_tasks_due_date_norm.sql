-- Нормализованная дата срока задачи для серверной фильтрации/сортировки.
-- tasks.due_date хранится текстом в смешанных форматах (ДД.ММ.ГГГГ, ISO, "—").
-- Добавляем due_date_norm (date) + функцию парсинга + триггер синхронизации + бэкофилл.

alter table public.tasks
  add column if not exists due_date_norm date;

create or replace function public.parse_task_due_date(raw text)
returns date
language plpgsql
immutable
as $$
declare
  trimmed text;
  m text[];
begin
  if raw is null then
    return null;
  end if;
  trimmed := btrim(raw);
  if trimmed = '' or trimmed ~ '^[—–-]+$' then
    return null;
  end if;
  -- ISO-префикс: YYYY-MM-DD...
  m := regexp_match(trimmed, '^(\d{4})-(\d{2})-(\d{2})');
  if m is not null then
    begin
      return make_date(m[1]::int, m[2]::int, m[3]::int);
    exception when others then
      return null;
    end;
  end if;
  -- ДД.ММ.ГГГГ
  m := regexp_match(trimmed, '^(\d{1,2})\.(\d{1,2})\.(\d{4})$');
  if m is not null then
    begin
      return make_date(m[3]::int, m[2]::int, m[1]::int);
    exception when others then
      return null;
    end;
  end if;
  return null;
end;
$$;

create or replace function public.tasks_sync_due_date_norm()
returns trigger
language plpgsql
as $$
begin
  new.due_date_norm := public.parse_task_due_date(new.due_date);
  return new;
end;
$$;

drop trigger if exists trg_tasks_sync_due_date_norm on public.tasks;
create trigger trg_tasks_sync_due_date_norm
  before insert or update of due_date on public.tasks
  for each row
  execute function public.tasks_sync_due_date_norm();

-- Бэкофилл существующих строк.
update public.tasks
set due_date_norm = public.parse_task_due_date(due_date)
where due_date_norm is distinct from public.parse_task_due_date(due_date);

create index if not exists idx_tasks_due_date_norm on public.tasks (due_date_norm);
