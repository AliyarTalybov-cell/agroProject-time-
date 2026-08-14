-- Add active flag for employees/profiles.
alter table public.profiles
add column if not exists active boolean not null default true;

-- Backfill for existing rows (in case column existed nullable before).
update public.profiles set active = true where active is null;

