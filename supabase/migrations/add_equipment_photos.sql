-- Выполни в Supabase: SQL Editor → New query → вставь код → Run
-- Добавляет таблицу фото техники + storage bucket политики.
--
-- Перед выполнением создай в Supabase Dashboard:
-- Storage → New bucket → имя "equipment-photos" → (Public = true, чтобы работали getPublicUrl без доп. ключей)

-- 1) Таблица фото техники
create table if not exists public.equipment_photos (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  file_url text not null,
  file_path text,
  title text,
  description text,
  created_at timestamptz default now()
);

alter table public.equipment_photos enable row level security;
drop policy if exists "Allow all for equipment_photos" on public.equipment_photos;
create policy "Allow all for equipment_photos" on public.equipment_photos
  for all using (true) with check (true);

-- 2) Storage policies для бакета "equipment-photos"
-- (если политика уже существует — она будет переопределена через drop policy)
drop policy if exists "equipment-photos: allow insert" on storage.objects;
drop policy if exists "equipment-photos: allow select" on storage.objects;
drop policy if exists "equipment-photos: allow update" on storage.objects;
drop policy if exists "equipment-photos: allow delete" on storage.objects;

create policy "equipment-photos: allow insert"
on storage.objects for insert
with check (bucket_id = 'equipment-photos');

create policy "equipment-photos: allow select"
on storage.objects for select
using (bucket_id = 'equipment-photos');

create policy "equipment-photos: allow update"
on storage.objects for update
using (bucket_id = 'equipment-photos');

create policy "equipment-photos: allow delete"
on storage.objects for delete
using (bucket_id = 'equipment-photos');

