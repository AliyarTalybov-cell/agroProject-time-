-- Sync all auth users into public.profiles and keep it updated.

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    display_name,
    role,
    active,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.email,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ''),
    'worker',
    true,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_profile_from_auth_user on auth.users;
create trigger trg_sync_profile_from_auth_user
after insert or update of email, raw_user_meta_data
on auth.users
for each row
execute function public.sync_profile_from_auth_user();

-- Backfill: create missing profiles for all already registered users.
insert into public.profiles (
  id,
  email,
  display_name,
  role,
  active,
  created_at,
  updated_at
)
select
  u.id,
  u.email,
  nullif(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''), '') as display_name,
  'worker' as role,
  true as active,
  coalesce(u.created_at, now()) as created_at,
  now() as updated_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
