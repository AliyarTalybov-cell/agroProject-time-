-- Документы техники (PDF/DOC и др.) + Storage bucket "equipment-documents".
-- Бакет создать в Dashboard: Storage -> New bucket -> "equipment-documents" (Public = true).

create table if not exists public.equipment_documents (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  file_url text not null,
  file_path text,
  file_name text not null,
  file_size bigint,
  mime_type text,
  created_at timestamptz not null default now()
);

create index if not exists idx_equipment_documents_equipment_id
  on public.equipment_documents(equipment_id);

create or replace function public.is_manager_role()
returns boolean
language sql
stable
as $$
  select
    coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'manager'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
$$;

grant execute on function public.is_manager_role() to authenticated;

alter table public.equipment_documents enable row level security;

drop policy if exists "equipment_documents_select_all" on public.equipment_documents;
drop policy if exists "equipment_documents_insert_all" on public.equipment_documents;
drop policy if exists "equipment_documents_update_all" on public.equipment_documents;
drop policy if exists "equipment_documents_delete_manager_only" on public.equipment_documents;

create policy "equipment_documents_select_all"
  on public.equipment_documents for select
  using (true);

create policy "equipment_documents_insert_all"
  on public.equipment_documents for insert
  with check (true);

create policy "equipment_documents_update_all"
  on public.equipment_documents for update
  using (true)
  with check (true);

create policy "equipment_documents_delete_manager_only"
  on public.equipment_documents for delete
  using (public.is_manager_role());

drop policy if exists "equipment-documents: allow insert" on storage.objects;
drop policy if exists "equipment-documents: allow select" on storage.objects;
drop policy if exists "equipment-documents: allow update" on storage.objects;
drop policy if exists "equipment-documents: allow delete" on storage.objects;

create policy "equipment-documents: allow insert"
on storage.objects for insert
with check (bucket_id = 'equipment-documents');

create policy "equipment-documents: allow select"
on storage.objects for select
using (bucket_id = 'equipment-documents');

create policy "equipment-documents: allow update"
on storage.objects for update
using (bucket_id = 'equipment-documents');

create policy "equipment-documents: allow delete"
on storage.objects for delete
using (
  bucket_id = 'equipment-documents'
  and public.is_manager_role()
);

