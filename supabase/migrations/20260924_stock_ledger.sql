-- =====================================================================
-- Складской учёт зерна на журнале движений.
--
-- Было: остаток склада = сумма нетто приёмок, а расход (продажа, перемещение,
-- списание) правил и удалял записи приёмок. История терялась, порча
-- вычиталась дважды, партии смешивали культуры, операции шли из браузера
-- несколькими запросами без транзакции.
--
-- Стало:
--   склад (storage_locations) → ячейки (storage_cells);
--   партия (stock_batches) — одна культура, происхождение, качество;
--   документ (stock_documents) — приёмка, подработка, перемещение, продажа,
--     посев, расход на переработку/корм, списание, инвентаризация, сторно;
--   журнал (stock_movements) — «+/− тонны, партия, ячейка, документ».
--     Остатки считаются только из журнала, записи не удаляются и не
--     правятся: ошибка исправляется отменой документа (сторно).
--
-- Писать в документы и журнал можно только функциями stock_post_* и
-- stock_cancel_document: каждая выполняется одной транзакцией, блокирует
-- затронутые партии и не даёт уйти в минус, переполнить ячейку или склад
-- и смешать культуры в одной ячейке.
--
-- Старые таблицы (storage_intakes, storage_batches, storage_transfers,
-- storage_writeoffs) не меняются — прежние экраны работают, пока их не
-- заменят новые. Текущие остатки переносятся документом «Ввод остатков»;
-- при переносе смешанные партии делятся по культурам, поле spoiled_tons
-- (двойной учёт порчи) не используется.
--
-- Миграция идемпотентна.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Культуры: какие из них — зерно
-- ---------------------------------------------------------------------

alter table public.crops add column if not exists is_grain boolean not null default false;

update public.crops set is_grain = true
 where key in ('wheat', 'corn', 'soy', 'sunflower', 'ozimaya_pshenitsa', 'ozimyy_yachmen', 'pshenitsa_myagkaya_ozimaya')
   and not is_grain;

comment on column public.crops.is_grain is
  'Культура учитывается на складе (зерно, масличные, семена). Пар и травы — нет.';


-- ---------------------------------------------------------------------
-- 1. Ячейки склада
-- ---------------------------------------------------------------------

create table if not exists public.storage_cells (
  id uuid primary key default gen_random_uuid(),
  storage_location_id uuid not null references public.storage_locations(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  kind text not null default 'section'
    check (kind in ('main', 'silo', 'bunker', 'section', 'floor', 'pile')),
  capacity_tons numeric(14, 3) check (capacity_tons is null or capacity_tons > 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_location_id, name)
);

comment on table public.storage_cells is
  'Ячейки склада: силос, бункер, секция, площадка, бурт. У каждого склада есть ячейка «Основная».';

create index if not exists storage_cells_location_idx on public.storage_cells (storage_location_id);

create or replace function public.storage_cells_add_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storage_cells (storage_location_id, name, kind, sort_order)
  values (new.id, 'Основная', 'main', 0)
  on conflict (storage_location_id, name) do nothing;
  return new;
end;
$$;

revoke all on function public.storage_cells_add_default() from public, anon, authenticated;

drop trigger if exists storage_locations_add_default_cell on public.storage_locations;
create trigger storage_locations_add_default_cell
  after insert on public.storage_locations
  for each row execute function public.storage_cells_add_default();

insert into public.storage_cells (storage_location_id, name, kind, sort_order)
select l.id, 'Основная', 'main', 0 from public.storage_locations l
on conflict (storage_location_id, name) do nothing;


-- ---------------------------------------------------------------------
-- 2. Контрагенты, договоры, причины списания
-- ---------------------------------------------------------------------

create table if not exists public.counterparties (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  kind text not null default 'both' check (kind in ('buyer', 'supplier', 'both')),
  inn text check (inn is null or inn ~ '^\d{10}(\d{2})?$'),
  kpp text check (kpp is null or kpp ~ '^\d{9}$'),
  address text,
  phone text,
  email text,
  contact_person text,
  comment text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists counterparties_inn_uidx on public.counterparties (inn) where inn is not null;

comment on table public.counterparties is 'Покупатели и поставщики зерна и семян.';

create table if not exists public.counterparty_contracts (
  id uuid primary key default gen_random_uuid(),
  counterparty_id uuid not null references public.counterparties(id) on delete restrict,
  kind text not null check (kind in ('sale', 'purchase')),
  number text not null check (length(btrim(number)) > 0),
  contract_date date,
  crop_key text references public.crops(key) on update cascade on delete restrict,
  price_per_ton numeric(14, 2) check (price_per_ton is null or price_per_ton >= 0),
  volume_tons numeric(14, 3) check (volume_tons is null or volume_tons > 0),
  valid_until date,
  comment text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (counterparty_id, number)
);

comment on table public.counterparty_contracts is 'Договоры продажи и закупки: цена, объём, культура.';

create table if not exists public.stock_writeoff_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.stock_writeoff_reasons (name, sort_order) values
  ('Порча', 10),
  ('Самосогревание', 20),
  ('Вредители', 30),
  ('Недостача', 40),
  ('Потери при транспортировке', 50),
  ('Прочее', 100)
on conflict (name) do nothing;


-- ---------------------------------------------------------------------
-- 3. Партии
-- ---------------------------------------------------------------------

create sequence if not exists public.stock_batch_seq;

create table if not exists public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    default ('П-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.stock_batch_seq')::text, 4, '0')),
  crop_key text not null references public.crops(key) on update cascade on delete restrict,
  variety text,
  harvest_year integer check (harvest_year is null or harvest_year between 2000 and 2100),
  origin text not null default 'field' check (origin in ('field', 'purchase', 'opening')),
  field_id uuid references public.fields(id) on delete set null,
  supplier_id uuid references public.counterparties(id) on delete set null,
  purpose text not null default 'food' check (purpose in ('food', 'feed', 'seed', 'processing', 'export')),
  quality jsonb not null default '{}'::jsonb,
  fgis_batch_number text,
  comment text,
  legacy_batch_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stock_batches is
  'Партия зерна: одна культура, происхождение и качество. Может лежать частями в нескольких ячейках.';
comment on column public.stock_batches.quality is
  'Качество: moisture, weed_impurity, grain_impurity, nature, gluten, protein, class — в процентах / г/л.';
comment on column public.stock_batches.legacy_batch_id is 'storage_batches.id, из которой партия перенесена.';


-- ---------------------------------------------------------------------
-- 4. Документы и журнал движений
-- ---------------------------------------------------------------------

create sequence if not exists public.stock_document_seq;

create table if not exists public.stock_documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in (
    'opening', 'intake', 'processing', 'transfer', 'sale', 'seeding', 'consumption', 'writeoff', 'inventory', 'storno'
  )),
  number text not null unique
    default (to_char(now(), 'YYYY') || '-' || lpad(nextval('public.stock_document_seq')::text, 5, '0')),
  doc_date timestamptz not null default now(),
  status text not null default 'posted' check (status in ('posted', 'cancelled')),
  counterparty_id uuid references public.counterparties(id) on delete restrict,
  contract_id uuid references public.counterparty_contracts(id) on delete restrict,
  field_id uuid references public.fields(id) on delete set null,
  writeoff_reason_id uuid references public.stock_writeoff_reasons(id) on delete restrict,
  consumption_target text check (consumption_target is null or consumption_target in ('processing', 'feed')),
  vehicle_plate text,
  driver_name text,
  waybill_number text,
  sdiz_number text,
  act_number text,
  price_per_ton numeric(14, 2) check (price_per_ton is null or price_per_ton >= 0),
  amount numeric(16, 2) check (amount is null or amount >= 0),
  vat_percent numeric(5, 2) check (vat_percent is null or vat_percent between 0 and 100),
  weights jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  comment text,
  cancels_document_id uuid references public.stock_documents(id) on delete restrict,
  cancel_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz
);

comment on table public.stock_documents is 'Складские документы. Пишутся только функциями stock_post_* / stock_cancel_document.';
comment on column public.stock_documents.weights is 'Весовая: gross, tare, net (т); у продажи — ещё buyer_net, вес у покупателя.';

create index if not exists stock_documents_type_date_idx on public.stock_documents (doc_type, doc_date desc);
create index if not exists stock_documents_counterparty_idx on public.stock_documents (counterparty_id);

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.stock_documents(id) on delete restrict,
  batch_id uuid not null references public.stock_batches(id) on delete restrict,
  cell_id uuid not null references public.storage_cells(id) on delete restrict,
  delta_tons numeric(14, 3) not null check (delta_tons <> 0),
  created_at timestamptz not null default now()
);

comment on table public.stock_movements is 'Журнал движений: + приход, − расход. Единственный источник остатков.';

create index if not exists stock_movements_batch_cell_idx on public.stock_movements (batch_id, cell_id);
create index if not exists stock_movements_cell_idx on public.stock_movements (cell_id);
create index if not exists stock_movements_document_idx on public.stock_movements (document_id);


-- ---------------------------------------------------------------------
-- 5. Резервы под договоры
-- ---------------------------------------------------------------------

create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.counterparty_contracts(id) on delete restrict,
  batch_id uuid not null references public.stock_batches(id) on delete restrict,
  cell_id uuid references public.storage_cells(id) on delete restrict,
  tons numeric(14, 3) not null check (tons > 0),
  status text not null default 'active' check (status in ('active', 'fulfilled', 'cancelled')),
  comment text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stock_reservations is 'Зерно, отложенное под договор. Доступно = остаток − активные резервы.';


-- ---------------------------------------------------------------------
-- 6. Представления остатков
-- ---------------------------------------------------------------------

create or replace view public.stock_balances
with (security_invoker = true) as
select m.batch_id, m.cell_id, sum(m.delta_tons)::numeric(14, 3) as tons
from public.stock_movements m
group by m.batch_id, m.cell_id
having sum(m.delta_tons) <> 0;

comment on view public.stock_balances is 'Остаток партии в ячейке.';

create or replace view public.stock_batch_totals
with (security_invoker = true) as
select b.id as batch_id,
       coalesce(sum(m.delta_tons), 0)::numeric(14, 3) as tons,
       coalesce((select sum(r.tons) from public.stock_reservations r
                 where r.batch_id = b.id and r.status = 'active'), 0)::numeric(14, 3) as reserved_tons,
       min(d.doc_date) filter (where m.delta_tons > 0) as first_in_at,
       max(d.doc_date) as last_movement_at
from public.stock_batches b
left join public.stock_movements m on m.batch_id = b.id
left join public.stock_documents d on d.id = m.document_id
group by b.id;

comment on view public.stock_batch_totals is 'Остаток, резерв и даты по партии. Партия с нулевым остатком — закрыта.';

create or replace view public.stock_cell_totals
with (security_invoker = true) as
select c.id as cell_id,
       c.storage_location_id,
       coalesce(sum(bal.tons), 0)::numeric(14, 3) as tons,
       (select b.crop_key from public.stock_balances x join public.stock_batches b on b.id = x.batch_id
         where x.cell_id = c.id and x.tons > 0 limit 1) as crop_key
from public.storage_cells c
left join public.stock_balances bal on bal.cell_id = c.id
group by c.id;

comment on view public.stock_cell_totals is 'Сколько и какой культуры лежит в ячейке.';


-- ---------------------------------------------------------------------
-- 7. Служебные функции проведения
-- ---------------------------------------------------------------------

-- Кто проводит документ: вошедший и не отключённый сотрудник.
create or replace function public.stock_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Нужно войти в систему' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.active) then
    raise exception 'Учётная запись отключена' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- Остаток партии в ячейке.
create or replace function public.stock_balance(p_batch uuid, p_cell uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta_tons), 0) from public.stock_movements where batch_id = p_batch and cell_id = p_cell;
$$;

-- Проверки после записи движений документа: не в минус, культуры не
-- смешиваются в ячейке, вместимость ячейки и склада не превышена.
create or replace function public.stock_validate_document(p_document uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_crops int;
  v_cell_tons numeric;
  v_loc_tons numeric;
begin
  for r in
    select distinct m.batch_id, m.cell_id, b.code, c.name as cell_name
    from public.stock_movements m
    join public.stock_batches b on b.id = m.batch_id
    join public.storage_cells c on c.id = m.cell_id
    where m.document_id = p_document
  loop
    if public.stock_balance(r.batch_id, r.cell_id) < 0 then
      raise exception 'Недостаточно зерна: партия % в ячейке «%» уходит в минус', r.code, r.cell_name
        using errcode = 'P0001';
    end if;
  end loop;

  for r in
    select distinct m.cell_id, c.name as cell_name, c.capacity_tons, c.storage_location_id,
           l.name as location_name, l.capacity_tons as location_capacity
    from public.stock_movements m
    join public.storage_cells c on c.id = m.cell_id
    join public.storage_locations l on l.id = c.storage_location_id
    where m.document_id = p_document and m.delta_tons > 0
  loop
    select count(distinct b.crop_key) into v_crops
    from public.stock_balances bal join public.stock_batches b on b.id = bal.batch_id
    where bal.cell_id = r.cell_id and bal.tons > 0;
    if v_crops > 1 then
      raise exception 'В ячейке «%» склада «%» уже лежит другая культура', r.cell_name, r.location_name
        using errcode = 'P0001';
    end if;

    select coalesce(sum(tons), 0) into v_cell_tons from public.stock_balances where cell_id = r.cell_id;
    if r.capacity_tons is not null and v_cell_tons > r.capacity_tons then
      raise exception 'Ячейка «%» переполнена: % т при вместимости % т', r.cell_name, v_cell_tons, r.capacity_tons
        using errcode = 'P0001';
    end if;

    select coalesce(sum(bal.tons), 0) into v_loc_tons
    from public.stock_balances bal join public.storage_cells c2 on c2.id = bal.cell_id
    where c2.storage_location_id = r.storage_location_id;
    if r.location_capacity is not null and v_loc_tons > r.location_capacity then
      raise exception 'Склад «%» переполнен: % т при вместимости % т', r.location_name, v_loc_tons, r.location_capacity
        using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

-- Блокирует партии в одном порядке, чтобы параллельные документы не
-- обходили проверку остатка и не ловили взаимоблокировку.
create or replace function public.stock_lock_batches(p_batches uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  select 1 from public.stock_batches where id = any(p_batches) order by id for update;
$$;

create or replace function public.stock_num(p jsonb, p_key text)
returns numeric
language sql
immutable
as $$
  select nullif(btrim(p ->> p_key), '')::numeric;
$$;

create or replace function public.stock_text(p jsonb, p_key text)
returns text
language sql
immutable
as $$
  select nullif(btrim(p ->> p_key), '');
$$;

create or replace function public.stock_uuid(p jsonb, p_key text)
returns uuid
language sql
immutable
as $$
  select nullif(btrim(p ->> p_key), '')::uuid;
$$;

-- Шапка документа из общих полей запроса.
create or replace function public.stock_insert_document(p_type text, p jsonb, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.stock_documents (
    doc_type, doc_date, counterparty_id, contract_id, field_id, writeoff_reason_id, consumption_target,
    vehicle_plate, driver_name, waybill_number, sdiz_number, act_number,
    price_per_ton, amount, vat_percent, weights, quality, comment, created_by
  ) values (
    p_type,
    coalesce(nullif(p ->> 'doc_date', '')::timestamptz, now()),
    public.stock_uuid(p, 'counterparty_id'),
    public.stock_uuid(p, 'contract_id'),
    public.stock_uuid(p, 'field_id'),
    public.stock_uuid(p, 'writeoff_reason_id'),
    public.stock_text(p, 'consumption_target'),
    public.stock_text(p, 'vehicle_plate'),
    public.stock_text(p, 'driver_name'),
    public.stock_text(p, 'waybill_number'),
    public.stock_text(p, 'sdiz_number'),
    public.stock_text(p, 'act_number'),
    public.stock_num(p, 'price_per_ton'),
    public.stock_num(p, 'amount'),
    public.stock_num(p, 'vat_percent'),
    coalesce(p -> 'weights', '{}'::jsonb),
    coalesce(p -> 'quality', '{}'::jsonb),
    public.stock_text(p, 'comment'),
    p_actor
  ) returning id into v_id;
  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 8. Проведение документов
-- ---------------------------------------------------------------------

-- Приёмка: с поля или от поставщика. Новая партия (p.batch) или
-- досыпка в существующую (p.batch_id). Масса в журнал — зачётный вес net_tons.
create or replace function public.stock_post_intake(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.stock_actor();
  v_cell uuid := public.stock_uuid(p, 'cell_id');
  v_net numeric := public.stock_num(p, 'net_tons');
  v_batch uuid := public.stock_uuid(p, 'batch_id');
  v_b jsonb := coalesce(p -> 'batch', '{}'::jsonb);
  v_origin text;
  v_doc uuid;
begin
  if v_cell is null then raise exception 'Укажите ячейку склада'; end if;
  if v_net is null or v_net <= 0 then raise exception 'Зачётный вес должен быть больше нуля'; end if;

  if v_batch is null then
    v_origin := coalesce(public.stock_text(v_b, 'origin'), 'field');
    if v_origin not in ('field', 'purchase') then raise exception 'Происхождение партии: поле или закупка'; end if;
    if public.stock_text(v_b, 'crop_key') is null then raise exception 'Укажите культуру'; end if;
    if not exists (select 1 from public.crops where key = public.stock_text(v_b, 'crop_key') and is_grain) then
      raise exception 'Культура не учитывается на складе';
    end if;
    if v_origin = 'field' and public.stock_uuid(v_b, 'field_id') is null then
      raise exception 'Для приёмки с поля укажите поле';
    end if;
    if v_origin = 'purchase' and public.stock_uuid(p, 'counterparty_id') is null then
      raise exception 'Для закупки укажите поставщика';
    end if;
    insert into public.stock_batches (
      crop_key, variety, harvest_year, origin, field_id, supplier_id, purpose, quality, fgis_batch_number, comment, created_by
    ) values (
      public.stock_text(v_b, 'crop_key'),
      public.stock_text(v_b, 'variety'),
      coalesce(public.stock_num(v_b, 'harvest_year')::int, extract(year from now())::int),
      v_origin,
      case when v_origin = 'field' then public.stock_uuid(v_b, 'field_id') end,
      case when v_origin = 'purchase' then public.stock_uuid(p, 'counterparty_id') end,
      coalesce(public.stock_text(v_b, 'purpose'), 'food'),
      coalesce(p -> 'quality', '{}'::jsonb),
      public.stock_text(v_b, 'fgis_batch_number'),
      public.stock_text(v_b, 'comment'),
      v_actor
    ) returning id into v_batch;
  end if;

  perform public.stock_lock_batches(array[v_batch]);
  v_doc := public.stock_insert_document('intake', p, v_actor);
  insert into public.stock_movements (document_id, batch_id, cell_id, delta_tons) values (v_doc, v_batch, v_cell, v_net);
  perform public.stock_validate_document(v_doc);

  return jsonb_build_object('document_id', v_doc, 'batch_id', v_batch);
end;
$$;

-- Перемещение партии между ячейками (в том числе между складами).
-- loss_tons — потери в пути: уходит tons, приходит tons − loss_tons.
create or replace function public.stock_post_transfer(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.stock_actor();
  v_batch uuid := public.stock_uuid(p, 'batch_id');
  v_from uuid := public.stock_uuid(p, 'from_cell_id');
  v_to uuid := public.stock_uuid(p, 'to_cell_id');
  v_tons numeric := public.stock_num(p, 'tons');
  v_loss numeric := coalesce(public.stock_num(p, 'loss_tons'), 0);
  v_doc uuid;
begin
  if v_batch is null or v_from is null or v_to is null then raise exception 'Укажите партию, откуда и куда'; end if;
  if v_from = v_to then raise exception 'Ячейки отправления и назначения должны различаться'; end if;
  if v_tons is null or v_tons <= 0 then raise exception 'Масса должна быть больше нуля'; end if;
  if v_loss < 0 or v_loss >= v_tons then raise exception 'Потери в пути должны быть меньше перемещаемой массы'; end if;

  perform public.stock_lock_batches(array[v_batch]);
  v_doc := public.stock_insert_document('transfer', p, v_actor);
  insert into public.stock_movements (document_id, batch_id, cell_id, delta_tons) values
    (v_doc, v_batch, v_from, -v_tons),
    (v_doc, v_batch, v_to, v_tons - v_loss);
  perform public.stock_validate_document(v_doc);
  return jsonb_build_object('document_id', v_doc);
end;
$$;

-- Расход: продажа, посев, переработка/корм, списание. Строки
-- p.lines = [{batch_id, cell_id, tons}] — можно отгрузить из нескольких
-- партий и ячеек одним документом.
create or replace function public.stock_post_outgoing(p_type text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.stock_actor();
  v_doc uuid;
  v_line jsonb;
  v_total numeric := 0;
  v_batches uuid[];
begin
  if p_type not in ('sale', 'seeding', 'consumption', 'writeoff') then
    raise exception 'Неизвестный вид расхода: %', p_type;
  end if;
  if jsonb_typeof(p -> 'lines') is distinct from 'array' or jsonb_array_length(p -> 'lines') = 0 then
    raise exception 'Добавьте хотя бы одну строку: партия, ячейка, масса';
  end if;
  if p_type = 'sale' and public.stock_uuid(p, 'counterparty_id') is null then raise exception 'Укажите покупателя'; end if;
  if p_type = 'seeding' and public.stock_uuid(p, 'field_id') is null then raise exception 'Укажите поле для посева'; end if;
  if p_type = 'writeoff' and public.stock_uuid(p, 'writeoff_reason_id') is null then raise exception 'Укажите причину списания'; end if;
  if p_type = 'consumption' and public.stock_text(p, 'consumption_target') is null then
    raise exception 'Укажите, на что расход: переработка или корм';
  end if;

  select array_agg(distinct (l ->> 'batch_id')::uuid) into v_batches from jsonb_array_elements(p -> 'lines') l;
  perform public.stock_lock_batches(v_batches);

  v_doc := public.stock_insert_document(p_type, p, v_actor);
  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    if public.stock_uuid(v_line, 'batch_id') is null or public.stock_uuid(v_line, 'cell_id') is null then
      raise exception 'В каждой строке укажите партию и ячейку';
    end if;
    if coalesce(public.stock_num(v_line, 'tons'), 0) <= 0 then raise exception 'Масса в строке должна быть больше нуля'; end if;
    insert into public.stock_movements (document_id, batch_id, cell_id, delta_tons)
    values (v_doc, public.stock_uuid(v_line, 'batch_id'), public.stock_uuid(v_line, 'cell_id'), -public.stock_num(v_line, 'tons'));
    v_total := v_total + public.stock_num(v_line, 'tons');
  end loop;

  -- Сумма продажи считается сама, если указана цена, а сумма — нет.
  update public.stock_documents
     set amount = coalesce(amount, round(price_per_ton * v_total, 2))
   where id = v_doc and price_per_ton is not null;

  perform public.stock_validate_document(v_doc);
  return jsonb_build_object('document_id', v_doc, 'total_tons', v_total);
end;
$$;

-- Подработка (сушка, очистка): из tons_before остаётся tons_after, разница —
-- усушка и отходы. Качество партии обновляется показателями после подработки.
create or replace function public.stock_post_processing(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.stock_actor();
  v_batch uuid := public.stock_uuid(p, 'batch_id');
  v_cell uuid := public.stock_uuid(p, 'cell_id');
  v_before numeric := public.stock_num(p, 'tons_before');
  v_after numeric := public.stock_num(p, 'tons_after');
  v_doc uuid;
begin
  if v_batch is null or v_cell is null then raise exception 'Укажите партию и ячейку'; end if;
  if v_before is null or v_before <= 0 then raise exception 'Укажите массу до подработки'; end if;
  if v_after is null or v_after < 0 or v_after >= v_before then
    raise exception 'Масса после подработки должна быть меньше массы до неё';
  end if;

  perform public.stock_lock_batches(array[v_batch]);
  if public.stock_balance(v_batch, v_cell) < v_before then
    raise exception 'В ячейке меньше зерна этой партии, чем указано до подработки';
  end if;

  v_doc := public.stock_insert_document('processing', p || jsonb_build_object('weights',
             coalesce(p -> 'weights', '{}'::jsonb) || jsonb_build_object('before', v_before, 'after', v_after)), v_actor);
  insert into public.stock_movements (document_id, batch_id, cell_id, delta_tons) values (v_doc, v_batch, v_cell, v_after - v_before);

  if p ? 'quality' then
    update public.stock_batches set quality = quality || (p -> 'quality'), updated_at = now() where id = v_batch;
  end if;

  perform public.stock_validate_document(v_doc);
  return jsonb_build_object('document_id', v_doc, 'loss_tons', v_before - v_after);
end;
$$;

-- Инвентаризация ячейки: p.lines = [{batch_id, actual_tons}]. Разница
-- с учётом проводится корректировкой; партии, которых нет в строках, не трогаются.
create or replace function public.stock_post_inventory(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.stock_actor();
  v_cell uuid := public.stock_uuid(p, 'cell_id');
  v_doc uuid;
  v_line jsonb;
  v_batches uuid[];
  v_delta numeric;
  v_changed int := 0;
begin
  if v_cell is null then raise exception 'Укажите ячейку'; end if;
  if jsonb_typeof(p -> 'lines') is distinct from 'array' or jsonb_array_length(p -> 'lines') = 0 then
    raise exception 'Добавьте строки инвентаризации';
  end if;

  select array_agg(distinct (l ->> 'batch_id')::uuid) into v_batches from jsonb_array_elements(p -> 'lines') l;
  perform public.stock_lock_batches(v_batches);

  v_doc := public.stock_insert_document('inventory', p, v_actor);
  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    if public.stock_num(v_line, 'actual_tons') is null or public.stock_num(v_line, 'actual_tons') < 0 then
      raise exception 'Фактический остаток не может быть отрицательным';
    end if;
    v_delta := public.stock_num(v_line, 'actual_tons') - public.stock_balance(public.stock_uuid(v_line, 'batch_id'), v_cell);
    if v_delta <> 0 then
      insert into public.stock_movements (document_id, batch_id, cell_id, delta_tons)
      values (v_doc, public.stock_uuid(v_line, 'batch_id'), v_cell, v_delta);
      v_changed := v_changed + 1;
    end if;
  end loop;

  perform public.stock_validate_document(v_doc);
  return jsonb_build_object('document_id', v_doc, 'adjusted_lines', v_changed);
end;
$$;

-- Отмена документа — только руководитель. Создаётся сторно с обратными
-- движениями, исходный документ помечается отменённым. Удаления нет.
create or replace function public.stock_cancel_document(p_document uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.stock_actor();
  v_doc public.stock_documents%rowtype;
  v_storno uuid;
  v_batches uuid[];
begin
  if not public.is_manager_role() then raise exception 'Отменять документы может только руководитель'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Укажите причину отмены'; end if;

  select * into v_doc from public.stock_documents where id = p_document for update;
  if not found then raise exception 'Документ не найден'; end if;
  if v_doc.status = 'cancelled' then raise exception 'Документ уже отменён'; end if;
  if v_doc.doc_type in ('storno', 'opening') then raise exception 'Этот документ отменить нельзя'; end if;

  select array_agg(distinct batch_id) into v_batches from public.stock_movements where document_id = p_document;
  perform public.stock_lock_batches(v_batches);

  insert into public.stock_documents (doc_type, doc_date, cancels_document_id, comment, created_by)
  values ('storno', now(), p_document, btrim(p_reason), v_actor)
  returning id into v_storno;

  insert into public.stock_movements (document_id, batch_id, cell_id, delta_tons)
  select v_storno, batch_id, cell_id, -delta_tons from public.stock_movements where document_id = p_document;

  update public.stock_documents
     set status = 'cancelled', cancelled_by = v_actor, cancelled_at = now(), cancel_reason = btrim(p_reason)
   where id = p_document;

  -- Отмена прихода, из которого уже продали, увела бы остаток в минус.
  perform public.stock_validate_document(v_storno);
  return jsonb_build_object('storno_document_id', v_storno);
end;
$$;


-- ---------------------------------------------------------------------
-- 9. Права
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'storage_cells', 'counterparties', 'counterparty_contracts', 'stock_writeoff_reasons',
    'stock_batches', 'stock_documents', 'stock_movements', 'stock_reservations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
  end loop;
end $$;

revoke all on public.stock_balances, public.stock_batch_totals, public.stock_cell_totals from anon;
grant select on public.stock_balances, public.stock_batch_totals, public.stock_cell_totals to authenticated;

-- Справочники ведут все сотрудники, удаляет руководитель.
do $$
declare
  t text;
begin
  foreach t in array array['storage_cells', 'counterparties', 'counterparty_contracts', 'stock_writeoff_reasons', 'stock_reservations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_manager_role())', t || '_delete', t);
  end loop;
end $$;

-- Документы и журнал — только через функции.
revoke insert, update, delete on public.stock_documents, public.stock_movements from authenticated;

-- У партии правятся только описательные поля; культура, происхождение и
-- создание — через приёмку.
revoke insert, update, delete on public.stock_batches from authenticated;
grant update (variety, harvest_year, purpose, quality, fgis_batch_number, comment, updated_at)
  on public.stock_batches to authenticated;
drop policy if exists stock_batches_update on public.stock_batches;
create policy stock_batches_update on public.stock_batches for update to authenticated using (true) with check (true);

revoke usage on sequence public.stock_batch_seq, public.stock_document_seq from anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'stock_actor()', 'stock_validate_document(uuid)', 'stock_lock_batches(uuid[])',
    'stock_insert_document(text, jsonb, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'stock_post_intake(jsonb)', 'stock_post_transfer(jsonb)', 'stock_post_outgoing(text, jsonb)',
    'stock_post_processing(jsonb)', 'stock_post_inventory(jsonb)', 'stock_cancel_document(uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Остаток партии в ячейке — только чтение того, что и так видно в stock_balances.
  revoke all on function public.stock_balance(uuid, uuid) from public, anon;
  grant execute on function public.stock_balance(uuid, uuid) to authenticated;
end $$;


-- ---------------------------------------------------------------------
-- 10. Перенос текущих остатков из старого учёта
--
-- Старые приёмки после расходов уже содержат текущий остаток (расход их
-- уменьшал), поэтому переносятся одним документом «Ввод остатков» в
-- ячейку «Основная» своего склада. Партии со смешанными культурами
-- делятся по культурам. Повторный запуск ничего не делает.
-- ---------------------------------------------------------------------

do $$
declare
  v_doc uuid;
  r record;
  v_batch uuid;
  v_cell uuid;
  v_part int;
begin
  if exists (select 1 from public.stock_documents where doc_type = 'opening') then
    return;
  end if;

  insert into public.stock_documents (doc_type, doc_date, comment)
  values ('opening', now(), 'Ввод остатков из прежнего учёта (storage_intakes / storage_batches)')
  returning id into v_doc;

  for r in
    select i.storage_location_id,
           i.batch_id as legacy_batch_id,
           ob.code as legacy_code,
           ob.purpose as legacy_purpose,
           ob.quality as legacy_quality,
           i.crop_key,
           sum(i.net_mass_tons) as tons,
           min(i.received_at) as first_at,
           (array_agg(i.field_id) filter (where i.field_id is not null))[1] as field_id,
           count(distinct i.field_id) as fields_count,
           round(sum(i.moisture_percent * i.net_mass_tons) / nullif(sum(i.net_mass_tons), 0), 1) as moisture,
           round(sum(i.weed_impurity_percent * i.net_mass_tons) / nullif(sum(i.net_mass_tons), 0), 1) as weed,
           round(sum(i.grain_impurity_percent * i.net_mass_tons) / nullif(sum(i.net_mass_tons), 0), 1) as grain_imp,
           row_number() over (partition by i.batch_id order by i.crop_key) as part_no,
           count(*) over (partition by i.batch_id) as parts
    from public.storage_intakes i
    left join public.storage_batches ob on ob.id = i.batch_id
    where i.net_mass_tons > 0 and i.crop_key is not null
    group by i.storage_location_id, i.batch_id, ob.code, ob.purpose, ob.quality, i.crop_key
  loop
    update public.crops set is_grain = true where key = r.crop_key and not is_grain;

    v_part := case when r.legacy_batch_id is null then null else r.part_no end;
    insert into public.stock_batches (code, crop_key, harvest_year, origin, field_id, purpose, quality, comment, legacy_batch_id)
    values (
      case
        when r.legacy_code is null
          then 'П-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.stock_batch_seq')::text, 4, '0')
        when r.parts > 1 then r.legacy_code || '-' || v_part
        else r.legacy_code
      end,
      r.crop_key,
      extract(year from r.first_at)::int,
      'opening',
      case when r.fields_count = 1 then r.field_id end,
      case r.legacy_purpose when 'export' then 'export' when 'processing' then 'processing' else 'food' end,
      coalesce(r.legacy_quality, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object('moisture', r.moisture, 'weed_impurity', r.weed, 'grain_impurity', r.grain_imp)),
      case when r.parts > 1 then 'При переносе партия ' || r.legacy_code || ' разделена по культурам' end,
      r.legacy_batch_id
    ) returning id into v_batch;

    -- Одна культура на складе — в «Основную». Несколько — каждой свою
    -- ячейку с названием культуры: в одной ячейке культуры не смешиваются.
    if (select count(distinct crop_key) from public.storage_intakes
         where storage_location_id = r.storage_location_id and net_mass_tons > 0 and crop_key is not null) = 1 then
      select id into v_cell from public.storage_cells
       where storage_location_id = r.storage_location_id and kind = 'main';
    else
      insert into public.storage_cells (storage_location_id, name, kind, sort_order)
      select r.storage_location_id, cr.label, 'section', cr.sort_order + 1
      from public.crops cr where cr.key = r.crop_key
      on conflict (storage_location_id, name) do nothing;
      select c.id into v_cell from public.storage_cells c join public.crops cr on cr.label = c.name
       where c.storage_location_id = r.storage_location_id and cr.key = r.crop_key;
    end if;

    insert into public.stock_movements (document_id, batch_id, cell_id, delta_tons)
    values (v_doc, v_batch, v_cell, r.tons);
  end loop;
end $$;

commit;
