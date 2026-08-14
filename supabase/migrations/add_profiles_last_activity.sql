-- Последняя активность в приложении (редкие обновления с клиента, без вебсокетов).
alter table public.profiles
  add column if not exists last_activity_at timestamptz;

comment on column public.profiles.last_activity_at is
  'Время последней активности в веб-приложении; обновляется клиентом с throttling (см. touch_my_last_activity).';

-- Один лёгкий UPDATE на вызов, только своя строка.
create or replace function public.touch_my_last_activity ()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set last_activity_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.touch_my_last_activity () to authenticated;
