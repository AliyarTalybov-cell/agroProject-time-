-- Справочник должностей (employee_positions) получил экран в «Справочниках
-- сотрудников». Раньше на таблице была одна политика «Allow all» без TO —
-- то есть любой вошедший мог и удалить, и переименовать любую должность.
--
-- Теперь как у остальных справочников: читать и добавлять может любой
-- вошедший сотрудник, менять и удалять — только руководитель
-- (public.is_manager_role() читает роль из profiles).
--
-- Идемпотентно: можно выполнить повторно.

begin;

alter table public.employee_positions enable row level security;

drop policy if exists "Allow all for employee_positions" on public.employee_positions;
drop policy if exists "employee_positions_select" on public.employee_positions;
drop policy if exists "employee_positions_insert" on public.employee_positions;
drop policy if exists "employee_positions_update_manager" on public.employee_positions;
drop policy if exists "employee_positions_delete_manager" on public.employee_positions;

create policy "employee_positions_select"
  on public.employee_positions for select to authenticated
  using (true);

create policy "employee_positions_insert"
  on public.employee_positions for insert to authenticated
  with check (true);

create policy "employee_positions_update_manager"
  on public.employee_positions for update to authenticated
  using (public.is_manager_role())
  with check (public.is_manager_role());

create policy "employee_positions_delete_manager"
  on public.employee_positions for delete to authenticated
  using (public.is_manager_role());

insert into public.applied_migrations (filename, note)
values ('20261103_employee_positions_policies.sql', 'должности: менять и удалять — только руководитель')
on conflict do nothing;

commit;
