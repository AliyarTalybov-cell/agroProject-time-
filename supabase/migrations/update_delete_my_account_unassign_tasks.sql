-- Актуализация RPC: при удалении аккаунта задачи не удаляются, снимается исполнитель.

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

  update public.fields
  set responsible_id = null
  where responsible_id = v_uid;

  update public.operations
  set user_id = null
  where user_id = v_uid;

  update public.downtimes
  set user_id = null
  where user_id = v_uid;

  update public.tasks
  set created_by = null
  where created_by = v_uid;

  update public.tasks
  set assignee_id = null
  where assignee_id = v_uid;

  delete from auth.users
  where id = v_uid;
end;
$$;
