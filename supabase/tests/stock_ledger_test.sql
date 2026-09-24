-- Сценарии складского журнала (20260924_stock_ledger.sql).
-- Запускать на ТЕСТОВОЙ копии: всё выполняется в транзакции и откатывается.
--   psql -v ON_ERROR_STOP=1 -v manager_email="'test.manager@24agro.local'" -f stock_ledger_test.sql
-- Каждая проверка печатает «OK …»; первая неудача прерывает прогон с «FAIL …».

begin;

-- Действуем от имени руководителя, как это делает PostgREST.
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users where email = :manager_email), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  v_loc uuid;
  v_cell_a uuid;
  v_cell_b uuid;
  v_field uuid;
  v_buyer uuid;
  v_reason uuid;
  r jsonb;
  v_batch uuid;
  v_doc uuid;
  v_bal numeric;
begin
  -- Отдельный склад с двумя ячейками по 100 т, чтобы не зависеть от данных.
  insert into public.storage_locations (name, address, capacity_tons, location_type_id, location_status_id, fill_status_id)
  select 'ТЕСТ склад журнала', 'тест', 150,
         (select id from public.storage_location_types limit 1),
         (select id from public.storage_location_statuses limit 1),
         (select id from public.storage_fill_statuses limit 1)
  returning id into v_loc;
  select id into v_cell_a from public.storage_cells where storage_location_id = v_loc and kind = 'main';
  if v_cell_a is null then raise exception 'FAIL: у нового склада нет ячейки «Основная»'; end if;
  update public.storage_cells set capacity_tons = 100 where id = v_cell_a;
  insert into public.storage_cells (storage_location_id, name, kind, capacity_tons) values (v_loc, 'Силос 2', 'silo', 100)
  returning id into v_cell_b;
  raise notice 'OK новый склад получил ячейку «Основная»';

  select id into v_field from public.fields limit 1;
  insert into public.counterparties (name, kind, inn) values ('ТЕСТ Покупатель', 'buyer', '7701234567') returning id into v_buyer;
  select id into v_reason from public.stock_writeoff_reasons where name = 'Порча';

  -- Приёмка с поля: 80 т пшеницы в «Основную».
  r := public.stock_post_intake(jsonb_build_object(
    'cell_id', v_cell_a, 'net_tons', 80, 'vehicle_plate', 'А123ВС46', 'waybill_number', 'ТТН-1',
    'weights', jsonb_build_object('gross', 95, 'tare', 14, 'net', 81),
    'quality', jsonb_build_object('moisture', 15.2, 'weed_impurity', 1.1),
    'batch', jsonb_build_object('crop_key', 'wheat', 'origin', 'field', 'field_id', v_field, 'harvest_year', 2026)));
  v_batch := (r ->> 'batch_id')::uuid;
  if public.stock_balance(v_batch, v_cell_a) <> 80 then raise exception 'FAIL: после приёмки остаток не 80'; end if;
  raise notice 'OK приёмка 80 т';

  -- Переполнение ячейки: ещё 30 т в ячейку на 100 т.
  begin
    perform public.stock_post_intake(jsonb_build_object('cell_id', v_cell_a, 'net_tons', 30, 'batch_id', v_batch));
    raise exception 'FAIL: ячейку удалось переполнить';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%переполнена%' then raise exception 'FAIL: не та ошибка при переполнении: %', sqlerrm; end if;
  end;
  raise notice 'OK переполнение ячейки запрещено';

  -- Другая культура в ту же ячейку.
  begin
    perform public.stock_post_intake(jsonb_build_object('cell_id', v_cell_a, 'net_tons', 5,
      'batch', jsonb_build_object('crop_key', 'corn', 'origin', 'field', 'field_id', v_field)));
    raise exception 'FAIL: культуры смешались в ячейке';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%другая культура%' then raise exception 'FAIL: не та ошибка при смешении: %', sqlerrm; end if;
  end;
  raise notice 'OK смешивать культуры в ячейке нельзя';

  -- Перемещение 30 т в «Силос 2» с потерей 0,5 т в пути.
  perform public.stock_post_transfer(jsonb_build_object('batch_id', v_batch, 'from_cell_id', v_cell_a, 'to_cell_id', v_cell_b,
    'tons', 30, 'loss_tons', 0.5));
  if public.stock_balance(v_batch, v_cell_a) <> 50 or public.stock_balance(v_batch, v_cell_b) <> 29.5 then
    raise exception 'FAIL: после перемещения остатки не 50 / 29,5';
  end if;
  raise notice 'OK перемещение с потерями';

  -- Подработка: из 50 т после сушки 48 т, качество обновляется.
  perform public.stock_post_processing(jsonb_build_object('batch_id', v_batch, 'cell_id', v_cell_a,
    'tons_before', 50, 'tons_after', 48, 'quality', jsonb_build_object('moisture', 13.5)));
  if public.stock_balance(v_batch, v_cell_a) <> 48 then raise exception 'FAIL: после подработки остаток не 48'; end if;
  if (select quality ->> 'moisture' from public.stock_batches where id = v_batch) <> '13.5' then
    raise exception 'FAIL: влажность партии не обновилась';
  end if;
  raise notice 'OK подработка: усушка учтена, качество обновлено';

  -- Продажа из двух ячеек одним документом, сумма считается по цене.
  r := public.stock_post_outgoing('sale', jsonb_build_object('counterparty_id', v_buyer, 'price_per_ton', 15000,
    'sdiz_number', 'СДИЗ-1', 'lines', jsonb_build_array(
      jsonb_build_object('batch_id', v_batch, 'cell_id', v_cell_a, 'tons', 8),
      jsonb_build_object('batch_id', v_batch, 'cell_id', v_cell_b, 'tons', 2))));
  v_doc := (r ->> 'document_id')::uuid;
  if (select amount from public.stock_documents where id = v_doc) <> 150000 then raise exception 'FAIL: сумма продажи не 150000'; end if;
  raise notice 'OK продажа 10 т на 150 000 ₽';

  -- Продать больше, чем есть.
  begin
    perform public.stock_post_outgoing('sale', jsonb_build_object('counterparty_id', v_buyer,
      'lines', jsonb_build_array(jsonb_build_object('batch_id', v_batch, 'cell_id', v_cell_b, 'tons', 1000))));
    raise exception 'FAIL: удалось уйти в минус';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%Недостаточно зерна%' then raise exception 'FAIL: не та ошибка при минусе: %', sqlerrm; end if;
  end;
  raise notice 'OK уйти в минус нельзя';

  -- Продажа без покупателя, посев без поля, списание без причины.
  begin
    perform public.stock_post_outgoing('sale', jsonb_build_object('lines',
      jsonb_build_array(jsonb_build_object('batch_id', v_batch, 'cell_id', v_cell_a, 'tons', 1))));
    raise exception 'FAIL: продажа без покупателя прошла';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.stock_post_outgoing('seeding', jsonb_build_object('lines',
      jsonb_build_array(jsonb_build_object('batch_id', v_batch, 'cell_id', v_cell_a, 'tons', 1))));
    raise exception 'FAIL: посев без поля прошёл';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.stock_post_outgoing('writeoff', jsonb_build_object('lines',
      jsonb_build_array(jsonb_build_object('batch_id', v_batch, 'cell_id', v_cell_a, 'tons', 1))));
    raise exception 'FAIL: списание без причины прошло';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'OK обязательные поля расхода проверяются';

  -- Посев, списание порчи, расход на корм.
  perform public.stock_post_outgoing('seeding', jsonb_build_object('field_id', v_field,
    'lines', jsonb_build_array(jsonb_build_object('batch_id', v_batch, 'cell_id', v_cell_a, 'tons', 5))));
  perform public.stock_post_outgoing('writeoff', jsonb_build_object('writeoff_reason_id', v_reason, 'act_number', 'А-1',
    'lines', jsonb_build_array(jsonb_build_object('batch_id', v_batch, 'cell_id', v_cell_a, 'tons', 1))));
  perform public.stock_post_outgoing('consumption', jsonb_build_object('consumption_target', 'feed',
    'lines', jsonb_build_array(jsonb_build_object('batch_id', v_batch, 'cell_id', v_cell_a, 'tons', 2))));
  -- 48 − 8 − 5 − 1 − 2 = 32; порча вычтена один раз.
  if public.stock_balance(v_batch, v_cell_a) <> 32 then raise exception 'FAIL: после расходов в «Основной» не 32 т'; end if;
  raise notice 'OK посев, списание и корм; порча учтена один раз';

  -- Инвентаризация: фактически 31,4 т.
  perform public.stock_post_inventory(jsonb_build_object('cell_id', v_cell_a, 'act_number', 'И-1',
    'lines', jsonb_build_array(jsonb_build_object('batch_id', v_batch, 'actual_tons', 31.4))));
  if public.stock_balance(v_batch, v_cell_a) <> 31.4 then raise exception 'FAIL: инвентаризация не привела к 31,4'; end if;
  raise notice 'OK инвентаризация';

  -- Отмена продажи возвращает зерно; повторная отмена запрещена.
  perform public.stock_cancel_document(v_doc, 'ошибка в весе');
  if public.stock_balance(v_batch, v_cell_a) <> 39.4 or public.stock_balance(v_batch, v_cell_b) <> 29.5 then
    raise exception 'FAIL: сторно продажи не вернуло 8 и 2 т';
  end if;
  begin
    perform public.stock_cancel_document(v_doc, 'ещё раз');
    raise exception 'FAIL: документ отменён дважды';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'OK отмена документа сторно';

  -- Напрямую в журнал писать нельзя.
  begin
    insert into public.stock_movements (document_id, batch_id, cell_id, delta_tons) values (v_doc, v_batch, v_cell_a, 1000);
    raise exception 'FAIL: запись в журнал в обход функций';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.stock_batches set crop_key = 'corn' where id = v_batch;
    raise exception 'FAIL: культуру партии поменяли напрямую';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK журнал и культура партии защищены от прямой записи';

  -- Итог по партии в представлении совпадает с журналом.
  select tons into v_bal from public.stock_batch_totals where batch_id = v_batch;
  if v_bal <> 68.9 then raise exception 'FAIL: итог партии % вместо 68,9', v_bal; end if;
  raise notice 'OK итог партии 68,9 т совпадает с журналом';
end $$;

-- Работник не может отменять документы.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select p.id from public.profiles p where p.role = 'worker' and p.active limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.stock_cancel_document((select id from public.stock_documents where doc_type = 'intake' limit 1), 'попытка');
  raise exception 'FAIL: работник отменил документ';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'OK работник не может отменять документы';
end $$;

-- Аноним не видит складские таблицы.
reset role;
set local role anon;
do $$
begin
  perform 1 from public.stock_batches limit 1;
  raise exception 'FAIL: аноним читает партии';
exception when insufficient_privilege then
  raise notice 'OK аноним не видит складские таблицы';
end $$;

rollback;
