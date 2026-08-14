-- Номер задачи (человеко-читаемый идентификатор), генерируется на стороне БД
create sequence if not exists public.tasks_number_seq;

alter table public.tasks
  add column if not exists number bigint;

-- Проставляем номера для уже существующих записей по дате создания (старые — меньшие номера)
with numbered as (
  select id, row_number() over (order by created_at asc, id asc) as rn
  from public.tasks
)
update public.tasks t
set number = n.rn
from numbered n
where t.id = n.id
  and t.number is null;

-- Настраиваем sequence на максимальное значение
select setval('public.tasks_number_seq', coalesce((select max(number) from public.tasks), 0));

alter table public.tasks
  alter column number set default nextval('public.tasks_number_seq'),
  alter column number set not null;

create unique index if not exists tasks_number_key on public.tasks (number);

