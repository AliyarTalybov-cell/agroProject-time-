-- Постраничная сводка операций по сотрудникам (аналитика) + индекс по end_iso
create index if not exists operations_end_iso_idx on public.operations (end_iso);

create or replace function public.operation_stats_employees_page(
  p_end_from timestamptz,
  p_end_to timestamptz,
  p_only_mine boolean,
  p_user_id uuid,
  p_employee_filter text,
  p_sort text,
  p_desc boolean,
  p_limit int,
  p_offset int
)
returns table (
  employee text,
  operation_count bigint,
  distinct_fields bigint,
  total_duration_minutes bigint,
  latest_end_iso timestamptz,
  total_groups bigint
)
language plpgsql
stable
set search_path = public
as $$
declare
  ord text;
  lim int;
  off int;
begin
  if p_sort is null or p_sort not in ('employee', 'operation', 'field', 'duration', 'ended') then
    p_sort := 'ended';
  end if;
  lim := greatest(coalesce(p_limit, 15), 1);
  off := greatest(coalesce(p_offset, 0), 0);
  ord := case
    when p_sort = 'employee' and p_desc then 'c.employee desc'
    when p_sort = 'employee' and not p_desc then 'c.employee asc'
    when p_sort = 'operation' and p_desc then 'c.operation_count desc'
    when p_sort = 'operation' and not p_desc then 'c.operation_count asc'
    when p_sort = 'field' and p_desc then 'c.distinct_fields desc'
    when p_sort = 'field' and not p_desc then 'c.distinct_fields asc'
    when p_sort = 'duration' and p_desc then 'c.total_duration_minutes desc'
    when p_sort = 'duration' and not p_desc then 'c.total_duration_minutes asc'
    when p_sort = 'ended' and p_desc then 'c.latest_end_iso desc nulls last'
    else 'c.latest_end_iso asc nulls last'
  end;

  return query execute format(
    $q$
    with filtered as (
      select o.*
      from public.operations o
      where o.end_iso >= $1
        and o.end_iso <= $2
        and ($3 = false or o.user_id = $4)
        and (
          $5::text is null
          or trim($5::text) = ''
          or o.employee = trim($5::text)
          or o.employee ilike ('%%' || trim($5::text) || '%%')
          or trim($5::text) ilike ('%%' || o.employee || '%%')
        )
    ),
    agg as (
      select
        f.employee,
        count(*)::bigint as operation_count,
        count(
          distinct coalesce(
            nullif(trim(f.field_id), ''),
            nullif(trim(f.field_name), ''),
            '-'
          )
        )::bigint as distinct_fields,
        coalesce(sum(f.duration_minutes), 0)::bigint as total_duration_minutes,
        max(f.end_iso) as latest_end_iso
      from filtered f
      group by f.employee
    ),
    counted as (
      select
        a.*,
        count(*) over ()::bigint as total_groups
      from agg a
    )
    select
      c.employee,
      c.operation_count,
      c.distinct_fields,
      c.total_duration_minutes,
      c.latest_end_iso,
      c.total_groups
    from counted c
    order by %s
    limit $6
    offset $7
    $q$,
    ord
  )
  using p_end_from, p_end_to, p_only_mine, p_user_id, p_employee_filter, lim, off;
end;
$$;

grant execute on function public.operation_stats_employees_page(
  timestamptz,
  timestamptz,
  boolean,
  uuid,
  text,
  text,
  boolean,
  int,
  int
) to anon, authenticated;
