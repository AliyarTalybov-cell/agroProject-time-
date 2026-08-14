-- Выполни в Supabase: SQL Editor → New query → вставь этот код → Run

-- 1) Поле "Адрес" в таблице полей
alter table public.fields add column if not exists address text;

-- 2) Таблица для фото полей (медиафайлы и схемы)
create table if not exists public.field_photos (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields(id) on delete cascade,
  file_url text not null,
  title text,
  description text,
  created_at timestamptz default now()
);

alter table public.field_photos enable row level security;
drop policy if exists "Allow all for field_photos" on public.field_photos;
create policy "Allow all for field_photos" on public.field_photos for all using (true) with check (true);
