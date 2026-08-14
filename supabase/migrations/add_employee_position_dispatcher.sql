-- Add "Dispatcher" position to employees dictionary
insert into public.employee_positions (name, sort_order)
values ('Диспетчер', 8)
on conflict (name) do nothing;

