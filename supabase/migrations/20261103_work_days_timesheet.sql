-- Табель рабочего времени.
--
-- Сотрудник отмечает на экране оператора начало и конец рабочего дня и
-- перерывы. Операции и простои внутри дня подтягиваются сами (см.
-- list_work_days): видно, сколько из отработанного ушло на работу в поле,
-- сколько на простой и сколько на остальное.
--
--   work_days        — один день сотрудника (work_date — дата начала по Москве;
--                      ночная смена заканчивается на следующие сутки);
--   work_day_breaks  — перерывы внутри дня;
--   work_day_edits   — журнал исправлений: кто, когда, почему, было → стало.
--
-- Писать в таблицы напрямую нельзя (гранты отозваны) — только функциями
-- workday_*. Так исправление без причины и без записи в журнал невозможно.
-- Читать: свои дни — сотрудник, все — руководитель (is_manager_role()).
--
-- Идемпотентно: можно выполнить повторно.

begin;

-- 1. Таблицы ---------------------------------------------------------------

create table if not exists public.work_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  -- После исправления перерыв задаётся итогом в минутах, а не отрезками.
  break_minutes_manual int,
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_days_user_date_uniq unique (user_id, work_date),
  constraint work_days_end_after_start check (ended_at is null or ended_at > started_at),
  constraint work_days_max_24h check (ended_at is null or ended_at - started_at <= interval '24 hours'),
  constraint work_days_break_manual_range check (break_minutes_manual is null or break_minutes_manual between 0 and 1440)
);
create index if not exists work_days_date_idx on public.work_days (work_date);

create table if not exists public.work_day_breaks (
  id uuid primary key default gen_random_uuid(),
  work_day_id uuid not null references public.work_days(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  constraint work_day_breaks_end_after_start check (ended_at is null or ended_at >= started_at)
);
create index if not exists work_day_breaks_day_idx on public.work_day_breaks (work_day_id);

create table if not exists public.work_day_edits (
  id uuid primary key default gen_random_uuid(),
  work_day_id uuid not null references public.work_days(id) on delete cascade,
  edited_by uuid references auth.users(id) on delete set null,
  edited_at timestamptz not null default now(),
  reason text not null,
  before jsonb,
  after jsonb not null,
  constraint work_day_edits_reason_len check (length(btrim(reason)) between 3 and 500)
);
create index if not exists work_day_edits_day_idx on public.work_day_edits (work_day_id, edited_at desc);

-- 2. Доступ: только чтение, запись — функциями -------------------------------

alter table public.work_days enable row level security;
alter table public.work_day_breaks enable row level security;
alter table public.work_day_edits enable row level security;

revoke all on public.work_days, public.work_day_breaks, public.work_day_edits from anon;
revoke insert, update, delete, truncate on public.work_days, public.work_day_breaks, public.work_day_edits from authenticated;
grant select on public.work_days, public.work_day_breaks, public.work_day_edits to authenticated;

drop policy if exists "work_days_select_own_or_manager" on public.work_days;
create policy "work_days_select_own_or_manager"
  on public.work_days for select to authenticated
  using (user_id = auth.uid() or public.is_manager_role());

drop policy if exists "work_day_breaks_select_own_or_manager" on public.work_day_breaks;
create policy "work_day_breaks_select_own_or_manager"
  on public.work_day_breaks for select to authenticated
  using (exists (
    select 1 from public.work_days d
    where d.id = work_day_id and (d.user_id = auth.uid() or public.is_manager_role())
  ));

drop policy if exists "work_day_edits_select_own_or_manager" on public.work_day_edits;
create policy "work_day_edits_select_own_or_manager"
  on public.work_day_edits for select to authenticated
  using (exists (
    select 1 from public.work_days d
    where d.id = work_day_id and (d.user_id = auth.uid() or public.is_manager_role())
  ));

-- 3. Служебное -------------------------------------------------------------

create or replace function public._workday_moscow_date(p_ts timestamptz)
returns date language sql immutable as $$
  select (p_ts at time zone 'Europe/Moscow')::date
$$;

-- Идущий день сотрудника: не закрыт и начат не раньше суток назад.
create or replace function public._workday_current(p_uid uuid)
returns public.work_days
language sql stable security definer set search_path = public as $$
  select d.* from public.work_days d
  where d.user_id = p_uid and d.ended_at is null and d.started_at > now() - interval '24 hours'
  order by d.started_at desc
  limit 1
$$;
revoke all on function public._workday_current(uuid) from public, anon, authenticated;

-- Перерыв дня в минутах: исправленный итог или сумма отрезков.
create or replace function public._workday_break_minutes(p_day public.work_days)
returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    p_day.break_minutes_manual,
    (select coalesce(sum(extract(epoch from (coalesce(b.ended_at, least(coalesce(p_day.ended_at, now()), now())) - b.started_at)) / 60), 0)::int
       from public.work_day_breaks b where b.work_day_id = p_day.id)
  )
$$;
revoke all on function public._workday_break_minutes(public.work_days) from public, anon, authenticated;

-- 4. Действия сотрудника ---------------------------------------------------

-- Начать день. Уже идёт — вернуть его. Сегодняшний день уже закрыт —
-- продолжить его: время между концом и новым началом уходит в перерыв.
create or replace function public.workday_start()
returns public.work_days
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day public.work_days;
begin
  if v_uid is null then raise exception 'Нужно войти в систему'; end if;

  v_day := public._workday_current(v_uid);
  if v_day.id is not null then return v_day; end if;

  select * into v_day from public.work_days
   where user_id = v_uid and work_date = public._workday_moscow_date(now());
  if v_day.id is not null then
    if now() - v_day.started_at > interval '24 hours' then
      raise exception 'Этот день уже нельзя продолжить — прошло больше суток с начала';
    end if;
    insert into public.work_day_breaks (work_day_id, started_at, ended_at)
    values (v_day.id, v_day.ended_at, now());
    update public.work_days set ended_at = null, updated_at = now()
     where id = v_day.id returning * into v_day;
    return v_day;
  end if;

  insert into public.work_days (user_id, work_date, started_at)
  values (v_uid, public._workday_moscow_date(now()), now())
  returning * into v_day;
  return v_day;
end;
$$;

create or replace function public.workday_break_start()
returns public.work_days
language plpgsql security definer set search_path = public as $$
declare
  v_day public.work_days := public._workday_current(auth.uid());
begin
  if v_day.id is null then raise exception 'Рабочий день не начат'; end if;
  if not exists (select 1 from public.work_day_breaks where work_day_id = v_day.id and ended_at is null) then
    insert into public.work_day_breaks (work_day_id, started_at) values (v_day.id, now());
  end if;
  return v_day;
end;
$$;

create or replace function public.workday_break_end()
returns public.work_days
language plpgsql security definer set search_path = public as $$
declare
  v_day public.work_days := public._workday_current(auth.uid());
begin
  if v_day.id is null then raise exception 'Рабочий день не начат'; end if;
  update public.work_day_breaks set ended_at = now()
   where work_day_id = v_day.id and ended_at is null;
  return v_day;
end;
$$;

create or replace function public.workday_finish()
returns public.work_days
language plpgsql security definer set search_path = public as $$
declare
  v_day public.work_days := public._workday_current(auth.uid());
begin
  if v_day.id is null then raise exception 'Рабочий день не начат'; end if;
  update public.work_day_breaks set ended_at = now()
   where work_day_id = v_day.id and ended_at is null;
  update public.work_days set ended_at = now(), updated_at = now()
   where id = v_day.id returning * into v_day;
  return v_day;
end;
$$;

-- 5. Исправление и забытый день ---------------------------------------------
--
-- p_day_id = null — добавить день, который забыли отметить (p_work_date).
-- Иначе — исправить существующий. Свой день правит сотрудник, любой —
-- руководитель. Причина обязательна, в журнал пишется было → стало.
create or replace function public.workday_correct(
  p_day_id uuid,
  p_work_date date,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_break_minutes int,
  p_reason text
)
returns public.work_days
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day public.work_days;
  v_before jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_breaks int := coalesce(p_break_minutes, 0);
begin
  if v_uid is null then raise exception 'Нужно войти в систему'; end if;
  if length(v_reason) < 3 then raise exception 'Укажите причину исправления'; end if;
  if p_started_at is null or p_ended_at is null then raise exception 'Укажите начало и конец дня'; end if;
  if p_ended_at <= p_started_at then raise exception 'Конец дня должен быть позже начала'; end if;
  if p_ended_at - p_started_at > interval '24 hours' then raise exception 'Рабочий день не может быть длиннее суток'; end if;
  if p_ended_at > now() + interval '5 minutes' then raise exception 'Конец дня не может быть в будущем'; end if;
  if v_breaks < 0 or v_breaks * interval '1 minute' >= p_ended_at - p_started_at then
    raise exception 'Перерыв должен быть меньше длительности дня';
  end if;

  if p_day_id is null then
    if p_work_date is null then raise exception 'Укажите дату'; end if;
    if public._workday_moscow_date(p_started_at) <> p_work_date then
      raise exception 'Начало дня должно быть в выбранную дату';
    end if;
    if exists (select 1 from public.work_days where user_id = v_uid and work_date = p_work_date) then
      raise exception 'За эту дату день уже есть — исправьте его';
    end if;
    insert into public.work_days (user_id, work_date, started_at, ended_at, break_minutes_manual, edited)
    values (v_uid, p_work_date, p_started_at, p_ended_at, v_breaks, true)
    returning * into v_day;
    v_before := null;
  else
    select * into v_day from public.work_days where id = p_day_id for update;
    if v_day.id is null then raise exception 'День не найден'; end if;
    if v_day.user_id <> v_uid and not public.is_manager_role() then
      raise exception 'Можно исправлять только свои дни';
    end if;
    if public._workday_moscow_date(p_started_at) <> v_day.work_date then
      raise exception 'Начало дня должно остаться в дате %', to_char(v_day.work_date, 'DD.MM.YYYY');
    end if;
    v_before := jsonb_build_object(
      'started_at', v_day.started_at,
      'ended_at', v_day.ended_at,
      'break_minutes', public._workday_break_minutes(v_day)
    );
    update public.work_day_breaks set ended_at = least(p_ended_at, now())
     where work_day_id = v_day.id and ended_at is null;
    update public.work_days
       set started_at = p_started_at, ended_at = p_ended_at,
           break_minutes_manual = v_breaks, edited = true, updated_at = now()
     where id = v_day.id
    returning * into v_day;
  end if;

  insert into public.work_day_edits (work_day_id, edited_by, reason, before, after)
  values (v_day.id, v_uid, v_reason, v_before, jsonb_build_object(
    'started_at', v_day.started_at, 'ended_at', v_day.ended_at, 'break_minutes', v_breaks
  ));
  return v_day;
end;
$$;

revoke all on function public.workday_start() from public, anon;
revoke all on function public.workday_break_start() from public, anon;
revoke all on function public.workday_break_end() from public, anon;
revoke all on function public.workday_finish() from public, anon;
revoke all on function public.workday_correct(uuid, date, timestamptz, timestamptz, int, text) from public, anon;
grant execute on function public.workday_start() to authenticated;
grant execute on function public.workday_break_start() to authenticated;
grant execute on function public.workday_break_end() to authenticated;
grant execute on function public.workday_finish() to authenticated;
grant execute on function public.workday_correct(uuid, date, timestamptz, timestamptz, int, text) to authenticated;

-- 6. Чтение табеля ---------------------------------------------------------
--
-- Дни за период с итогами. p_user_id = null — все, кого вызывающему видно
-- (сотруднику — только он сам: работает RLS, функция security invoker).
-- Открытый день считается по текущий момент.
drop function if exists public.list_work_days(date, date, uuid);
create function public.list_work_days(p_from date, p_to date, p_user_id uuid default null)
returns table (
  id uuid,
  user_id uuid,
  work_date date,
  started_at timestamptz,
  ended_at timestamptz,
  is_open boolean,
  on_break boolean,
  break_minutes int,
  worked_minutes int,
  operation_minutes int,
  downtime_minutes int,
  edited boolean,
  last_edit_reason text
)
language sql stable security invoker set search_path = public as $$
  with d as (
    select w.*, coalesce(w.ended_at, now()) as end_eff
    from public.work_days w
    where w.work_date between p_from and p_to
      and (p_user_id is null or w.user_id = p_user_id)
  ),
  br as (
    select d.id,
      coalesce(d.break_minutes_manual,
        (select coalesce(sum(extract(epoch from (coalesce(b.ended_at, d.end_eff) - b.started_at)) / 60), 0)
           from public.work_day_breaks b where b.work_day_id = d.id)::int) as minutes,
      exists (select 1 from public.work_day_breaks b where b.work_day_id = d.id and b.ended_at is null) as on_break
    from d
  )
  select
    d.id, d.user_id, d.work_date, d.started_at, d.ended_at,
    d.ended_at is null as is_open,
    br.on_break and d.ended_at is null as on_break,
    br.minutes as break_minutes,
    greatest(0, (extract(epoch from (d.end_eff - d.started_at)) / 60)::int - br.minutes) as worked_minutes,
    (select coalesce(sum(extract(epoch from (least(o.end_iso, d.end_eff) - greatest(o.start_iso, d.started_at))) / 60), 0)::int
       from public.operations o
      where o.user_id = d.user_id and o.start_iso < d.end_eff and o.end_iso > d.started_at) as operation_minutes,
    (select coalesce(sum(extract(epoch from (least(t.end_iso, d.end_eff) - greatest(t.start_iso, d.started_at))) / 60), 0)::int
       from public.downtimes t
      where t.user_id = d.user_id and t.start_iso < d.end_eff and t.end_iso > d.started_at) as downtime_minutes,
    d.edited,
    (select e.reason from public.work_day_edits e where e.work_day_id = d.id order by e.edited_at desc limit 1) as last_edit_reason
  from d join br on br.id = d.id
  order by d.work_date desc, d.started_at desc
$$;

revoke all on function public.list_work_days(date, date, uuid) from public, anon;
grant execute on function public.list_work_days(date, date, uuid) to authenticated;

insert into public.applied_migrations (filename, note)
values ('20261103_work_days_timesheet.sql', 'табель: рабочие дни, перерывы, журнал исправлений')
on conflict do nothing;

commit;
