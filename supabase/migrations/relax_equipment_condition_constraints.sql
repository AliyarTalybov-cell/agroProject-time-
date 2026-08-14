do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'equipment'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%condition%'
  loop
    execute format('alter table public.equipment drop constraint %I', r.conname);
  end loop;

  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'equipment_implements'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%condition%'
  loop
    execute format('alter table public.equipment_implements drop constraint %I', r.conname);
  end loop;

  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'equipment_condition_refs'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%code%'
  loop
    execute format('alter table public.equipment_condition_refs drop constraint %I', r.conname);
  end loop;
end $$;
