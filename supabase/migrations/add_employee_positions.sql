-- Employee positions dictionary (for Employees page dropdowns)
create table if not exists public.employee_positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

alter table public.employee_positions enable row level security;

create policy "Allow all for employee_positions" on public.employee_positions
  for all using (true) with check (true);

-- Optional seed (idempotent):
-- insert into public.employee_positions (name, sort_order) values
-- ('Главный агроном', 1),
-- ('Агроном', 2),
-- ('Механик', 3),
-- ('Инженер', 4),
-- ('Тракторист', 5),
-- ('Логист', 6),
-- ('HR специалист', 7)
-- on conflict (name) do nothing;

