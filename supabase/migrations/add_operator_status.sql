-- Текущее состояние экрана оператора (для дашборда аналитики / руководителя).
-- Обновляется при старте/остановке операции или простоя; строка удаляется, когда сессия завершена.

create table if not exists public.operator_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kind text not null check (kind in ('operation', 'downtime')),
  employee text not null,
  started_at timestamptz not null,
  field_id text,
  field_name text,
  operation text,
  downtime_category text,
  downtime_reason text,
  equipment_id uuid references public.equipment(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists operator_status_equipment_id_idx on public.operator_status (equipment_id);

alter table public.operator_status enable row level security;

create policy "Allow all for operator_status" on public.operator_status
  for all using (true) with check (true);
