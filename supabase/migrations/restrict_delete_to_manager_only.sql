-- Архитектурное ограничение:
-- удаление любых записей в справочниках/сущностях разрешено только роли manager.

create or replace function public.is_manager_role()
returns boolean
language sql
stable
as $$
  select
    coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
$$;

grant execute on function public.is_manager_role() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array ARRAY[
    'fields',
    'field_photos',
    'equipment',
    'equipment_implements',
    'equipment_type_refs',
    'equipment_condition_refs',
    'equipment_photos',
    'tasks',
    'task_files',
    'calendar_tasks',
    'calendar_task_assignees',
    'calendar_task_files',
    'operator_status',
    'downtime_reasons',
    'work_operations',
    'land_types',
    'land_categories',
    'crops',
    'land_actual_use_options',
    'lands',
    'land_rights',
    'land_right_ownership_forms',
    'land_right_types',
    'land_right_document_types',
    'land_right_holder_types',
    'land_right_holders',
    'land_users',
    'land_crop_rotations',
    'land_melioration_types',
    'land_melioration_subtypes',
    'land_melioration_event_types',
    'land_melioration_entries',
    'land_real_estate_objects',
    'news_posts',
    'chat_messages'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Allow all for %s" on public.%I', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_select_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_manager_only', t);

    execute format('create policy %I on public.%I for select using (true)', t || '_select_all', t);
    execute format('create policy %I on public.%I for insert with check (true)', t || '_insert_all', t);
    execute format('create policy %I on public.%I for update using (true) with check (true)', t || '_update_all', t);
    execute format(
      'create policy %I on public.%I for delete using (public.is_manager_role())',
      t || '_delete_manager_only',
      t
    );
  end loop;
end $$;

