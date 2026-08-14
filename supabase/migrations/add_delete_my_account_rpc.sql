-- Удаление собственного аккаунта (self-service) с очисткой ссылок на пользователя.
-- Вызывается из клиента: select public.delete_my_account();

create or replace function public.delete_my_account ()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Поля: снимаем ответственного, чтобы запись поля сохранилась.
  update public.fields
  set responsible_id = null
  where responsible_id = v_uid;

  -- История операций/простоев: отвязываем пользователя, чтобы журнал сохранялся.
  update public.operations
  set user_id = null
  where user_id = v_uid;

  update public.downtimes
  set user_id = null
  where user_id = v_uid;

  -- Задачи, где пользователь был автором: сохраняем задачу, убираем автора.
  update public.tasks
  set created_by = null
  where created_by = v_uid;

  -- Задачи, назначенные на пользователя: оставляем, снимаем исполнителя.
  update public.tasks
  set assignee_id = null
  where assignee_id = v_uid;

  -- Финальное удаление пользователя из auth.users.
  -- Остальные зависимости очищаются по on delete (profiles/chat/operator_status/calendar и т.д.).
  delete from auth.users
  where id = v_uid;
end;
$$;

grant execute on function public.delete_my_account () to authenticated;
