const fs = require('fs');

// -------------------------------------------------------
// Reads a file, returns its content or empty string + warning
// -------------------------------------------------------
function read(f) {
  if (!fs.existsSync(f)) {
    console.warn(`WARNING: Missing file: ${f}`);
    return '';
  }
  return fs.readFileSync(f, 'utf8');
}

function section(title, sql) {
  return `\n\n-- ==========================================\n-- ${title}\n-- ==========================================\n\n${sql}`;
}

let out = '-- AGRO PORTAL DB INIT SCRIPT (dependency-ordered)\n\n';

// ------------------------------------------------------------------
// STEP 1: equipment_implements (no deps)
// ------------------------------------------------------------------
out += section('TABLE: equipment_implements', `
create table if not exists public.equipment_implements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  purpose text,
  description text,
  "condition" text not null default 'operational' check ("condition" in ('operational', 'repair', 'decommissioned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.equipment_implements enable row level security;

drop policy if exists "Allow all for equipment_implements" on public.equipment_implements;
create policy "Allow all for equipment_implements" on public.equipment_implements
  for all using (true) with check (true);
`);

// ------------------------------------------------------------------
// STEP 2: equipment (depends on equipment_implements)
// ------------------------------------------------------------------
out += section('TABLE: equipment', `
create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  license_plate text not null,
  model text,
  equipment_type text,
  year int check (year is null or (year >= 1900 and year <= 2100)),
  purpose_crop text,
  implement_id uuid references public.equipment_implements(id) on delete set null,
  "condition" text not null default 'operational' check ("condition" in ('operational', 'repair', 'decommissioned')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.equipment enable row level security;

drop policy if exists "Allow all for equipment" on public.equipment;
create policy "Allow all for equipment" on public.equipment
  for all using (true) with check (true);
`);

// ------------------------------------------------------------------
// STEP 3: land_types, crops (no deps)
// ------------------------------------------------------------------
out += section('TABLE: land_types + crops', `
create table if not exists public.land_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create table if not exists public.crops (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

alter table public.land_types enable row level security;
alter table public.crops enable row level security;
drop policy if exists "Allow all for land_types" on public.land_types;
create policy "Allow all for land_types" on public.land_types for all using (true) with check (true);
drop policy if exists "Allow all for crops" on public.crops;
create policy "Allow all for crops" on public.crops for all using (true) with check (true);

-- Seed dictionaries
insert into public.land_types (name, sort_order) values
  ('Пашня', 1), ('Залежь', 2), ('Сенокос', 3), ('Пастбище', 4)
on conflict (name) do nothing;

insert into public.crops (key, label, sort_order) values
  ('wheat', 'Пшеница', 1), ('corn', 'Кукуруза', 2), ('soy', 'Соя', 3),
  ('sunflower', 'Подсолнечник', 4), ('none', 'Нет (пар)', 5), ('meadow', 'Многолетние травы', 6)
on conflict (key) do nothing;
`);

// ------------------------------------------------------------------
// STEP 4: profiles (depends on auth.users)
// ------------------------------------------------------------------
out += section('TABLE: profiles', `
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text check (role in ('worker', 'manager')),
  phone text,
  position text,
  additional_info text,
  last_activity_at timestamptz,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;
drop policy if exists "Allow all for profiles" on public.profiles;
create policy "Allow all for profiles" on public.profiles
  for all using (true) with check (true);
`);

// ------------------------------------------------------------------
// STEP 5: employee_positions
// ------------------------------------------------------------------
out += section('TABLE: employee_positions', `
create table if not exists public.employee_positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

alter table public.employee_positions enable row level security;
drop policy if exists "Allow all for employee_positions" on public.employee_positions;
create policy "Allow all for employee_positions" on public.employee_positions
  for all using (true) with check (true);

insert into public.employee_positions (name, sort_order) values
  ('Главный агроном', 1), ('Агроном', 2), ('Механик', 3), ('Инженер', 4),
  ('Тракторист', 5), ('Логист', 6), ('HR специалист', 7), ('Диспетчер', 8)
on conflict (name) do nothing;
`);

// ------------------------------------------------------------------
// STEP 6: fields (depends on auth.users, crops, land_types)
// ------------------------------------------------------------------
out += section('TABLE: fields', `
create table if not exists public.fields (
  id uuid primary key default gen_random_uuid(),
  number int not null default 1,
  name text not null,
  area numeric not null check (area >= 0),
  cadastral_number text,
  address text,
  location_description text,
  land_type text not null,
  sowing_year int check (sowing_year is null or (sowing_year >= 2000 and sowing_year <= 2100)),
  responsible_id uuid references auth.users(id) on delete set null,
  crop_key text not null,
  scheme_file_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.fields enable row level security;
drop policy if exists "Allow all for fields" on public.fields;
create policy "Allow all for fields" on public.fields
  for all using (true) with check (true);

-- Drop old check constraints if they exist
alter table public.fields drop constraint if exists fields_land_type_check;
alter table public.fields drop constraint if exists fields_crop_key_check;
`);

// ------------------------------------------------------------------
// STEP 7: field_photos (depends on fields)
// ------------------------------------------------------------------
out += section('TABLE: field_photos', `
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
`);

// ------------------------------------------------------------------
// STEP 8: equipment_photos (depends on equipment)
// ------------------------------------------------------------------
out += section('TABLE: equipment_photos', `
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
`);

// ------------------------------------------------------------------
// STEP 9: tasks (depends on auth.users)
// ------------------------------------------------------------------
out += section('TABLE: tasks', `
create sequence if not exists public.tasks_number_seq;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  number bigint not null default nextval('public.tasks_number_seq'),
  assignee_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  field text not null,
  due_date text,
  status text not null check (status in ('todo', 'in_progress', 'review', 'done')),
  work_type text,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists tasks_number_key on public.tasks (number);

alter table public.tasks enable row level security;
drop policy if exists "Allow all for tasks" on public.tasks;
create policy "Allow all for tasks" on public.tasks
  for all using (true) with check (true);
`);

// ------------------------------------------------------------------
// STEP 10: downtimes (depends on auth.users; NO equipment ref — added via alter later)
// ------------------------------------------------------------------
out += section('TABLE: downtimes', `
create table if not exists public.downtimes (
  id bigint primary key default (extract(epoch from now()) * 1000)::bigint,
  user_id uuid references auth.users(id),
  employee text not null,
  reason text not null,
  category text not null check (category in ('breakdown', 'rain', 'fuel', 'waiting')),
  start_iso timestamptz not null,
  end_iso timestamptz not null,
  duration_minutes int not null,
  field_id text,
  field_name text,
  operation text,
  notes text,
  created_at timestamptz default now()
);

alter table public.downtimes enable row level security;
drop policy if exists "Allow all for downtimes" on public.downtimes;
create policy "Allow all for downtimes" on public.downtimes
  for all using (true) with check (true);
`);

// ------------------------------------------------------------------
// STEP 11: operations (depends on auth.users + equipment)
// ------------------------------------------------------------------
out += section('TABLE: operations', `
create table if not exists public.operations (
  id bigint primary key default (extract(epoch from now()) * 1000)::bigint,
  user_id uuid references auth.users(id),
  employee text not null,
  field_id text,
  field_name text,
  operation text,
  equipment_id uuid references public.equipment(id) on delete set null,
  equipment_fuel_percent int,
  equipment_fuel_left_percent int,
  equipment_condition_value int,
  equipment_condition_label text,
  equipment_repair_notes text,
  planned_hectares numeric(10,2),
  processed_hectares numeric(10,2),
  notes text,
  start_iso timestamptz not null,
  end_iso timestamptz not null,
  duration_minutes int not null,
  created_at timestamptz default now()
);

create index if not exists operations_end_iso_idx on public.operations (end_iso);

alter table public.operations enable row level security;
drop policy if exists "Allow all for operations" on public.operations;
create policy "Allow all for operations" on public.operations
  for all using (true) with check (true);
`);

// ------------------------------------------------------------------
// STEP 12: operator_status (depends on auth.users + equipment)
// ------------------------------------------------------------------
out += section('TABLE: operator_status', `
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
drop policy if exists "Allow all for operator_status" on public.operator_status;
create policy "Allow all for operator_status" on public.operator_status
  for all using (true) with check (true);
`);

// ------------------------------------------------------------------
// STEP 13: downtime_reasons + work_operations
// ------------------------------------------------------------------
out += section('TABLE: downtime_reasons + work_operations', `
create table if not exists public.downtime_reasons (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  description text,
  category text not null check (category in ('breakdown', 'rain', 'fuel', 'waiting')),
  created_at timestamptz default now(),
  created_by text
);

create table if not exists public.work_operations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now(),
  created_by text
);

alter table public.downtime_reasons enable row level security;
alter table public.work_operations enable row level security;
drop policy if exists "Allow all for downtime_reasons" on public.downtime_reasons;
drop policy if exists "Allow all for work_operations" on public.work_operations;
create policy "Allow all for downtime_reasons" on public.downtime_reasons for all using (true) with check (true);
create policy "Allow all for work_operations" on public.work_operations for all using (true) with check (true);
`);

// ------------------------------------------------------------------
// STEP 14: calendar_tasks + assignees + files
// ------------------------------------------------------------------
out += section('TABLE: calendar_tasks + assignees + files', `
create table if not exists public.calendar_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  date text not null,
  title text not null,
  description text,
  start_time text,
  end_time text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assignee text,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.calendar_tasks enable row level security;
drop policy if exists "Allow all for calendar_tasks" on public.calendar_tasks;
create policy "Allow all for calendar_tasks" on public.calendar_tasks for all using (true) with check (true);

create table if not exists public.calendar_task_assignees (
  task_id uuid not null references public.calendar_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (task_id, user_id)
);

create index if not exists idx_calendar_task_assignees_user_id on public.calendar_task_assignees(user_id);

alter table public.calendar_task_assignees enable row level security;
drop policy if exists "Allow all for calendar_task_assignees" on public.calendar_task_assignees;
create policy "Allow all for calendar_task_assignees" on public.calendar_task_assignees for all using (true) with check (true);

create table if not exists public.calendar_task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.calendar_tasks(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_size bigint,
  created_at timestamptz default now()
);

create index if not exists idx_calendar_task_files_task_id on public.calendar_task_files(task_id);

alter table public.calendar_task_files enable row level security;
drop policy if exists "Allow all for calendar_task_files" on public.calendar_task_files;
create policy "Allow all for calendar_task_files" on public.calendar_task_files for all using (true) with check (true);
`);

// ------------------------------------------------------------------
// STEP 15: chat tables
// ------------------------------------------------------------------
out += section('MIGRATIONS: Chat (threads, members, messages)', read('supabase/migrations/add_chat_threads_and_messages.sql'));
out += section('MIGRATION: fix_chat_thread_members_rls_recursion', read('supabase/migrations/fix_chat_thread_members_rls_recursion.sql'));
out += section('MIGRATION: add_mark_chat_thread_read_rpc', read('supabase/migrations/add_mark_chat_thread_read_rpc.sql'));
out += section('MIGRATION: add_list_chat_messages_page_rpc', read('supabase/migrations/add_list_chat_messages_page_rpc.sql'));
out += section('MIGRATION: extend_list_my_chat_threads_peer_last_activity', read('supabase/migrations/extend_list_my_chat_threads_peer_last_activity.sql'));
out += section('MIGRATION: add_chat_messages_body_max_length', read('supabase/migrations/add_chat_messages_body_max_length.sql'));
out += section('MIGRATION: add_chat_messages_delete_policy', read('supabase/migrations/add_chat_messages_delete_policy.sql'));
out += section('MIGRATION: add_chat_urgent_problem_messages', read('supabase/migrations/add_chat_urgent_problem_messages.sql'));

// ------------------------------------------------------------------
// STEP 16: sync profiles trigger + RPCs
// ------------------------------------------------------------------
out += section('MIGRATION: sync_profiles_with_auth_users', read('supabase/migrations/sync_profiles_with_auth_users.sql'));
out += section('MIGRATION: add_profiles_last_activity', read('supabase/migrations/add_profiles_last_activity.sql'));
out += section('MIGRATION: add_delete_my_account_rpc', read('supabase/migrations/add_delete_my_account_rpc.sql'));
out += section('MIGRATION: operation_stats_employees_page', read('supabase/migrations/operation_stats_employees_page.sql'));

// ------------------------------------------------------------------
// STEP 17: Storage buckets + policies
// ------------------------------------------------------------------
out += section('STORAGE: Create buckets', `
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('field-schemes',      'field-schemes',      true, null, null),
  ('field-photos',       'field-photos',       true, null, null),
  ('equipment-photos',   'equipment-photos',   true, null, null),
  ('task-attachments',   'task-attachments',   true, null, null),
  ('chat-attachments',   'chat-attachments',   true, 10485760, null)
on conflict (id) do nothing;
`);

out += section('STORAGE: field-schemes policies', read('supabase/storage-field-schemes-policies.sql'));
out += section('STORAGE: chat-attachments policies', read('supabase/migrations/add_chat_attachments_storage_policies_only.sql'));

// task-attachments policies (inline, они уже в calendar migration но добавим явно)
out += section('STORAGE: task-attachments policies', `
drop policy if exists "task-attachments: allow insert" on storage.objects;
drop policy if exists "task-attachments: allow select" on storage.objects;
drop policy if exists "task-attachments: allow update" on storage.objects;
drop policy if exists "task-attachments: allow delete" on storage.objects;
create policy "task-attachments: allow insert" on storage.objects for insert with check (bucket_id = 'task-attachments');
create policy "task-attachments: allow select" on storage.objects for select using (bucket_id = 'task-attachments');
create policy "task-attachments: allow update" on storage.objects for update using (bucket_id = 'task-attachments');
create policy "task-attachments: allow delete" on storage.objects for delete using (bucket_id = 'task-attachments');
`);

out += section('STORAGE: equipment-photos policies', `
drop policy if exists "equipment-photos: allow insert" on storage.objects;
drop policy if exists "equipment-photos: allow select" on storage.objects;
drop policy if exists "equipment-photos: allow update" on storage.objects;
drop policy if exists "equipment-photos: allow delete" on storage.objects;
create policy "equipment-photos: allow insert" on storage.objects for insert with check (bucket_id = 'equipment-photos');
create policy "equipment-photos: allow select" on storage.objects for select using (bucket_id = 'equipment-photos');
create policy "equipment-photos: allow update" on storage.objects for update using (bucket_id = 'equipment-photos');
create policy "equipment-photos: allow delete" on storage.objects for delete using (bucket_id = 'equipment-photos');
`);

out += section('STORAGE: field-photos policies', `
drop policy if exists "field-photos: allow insert" on storage.objects;
drop policy if exists "field-photos: allow select" on storage.objects;
drop policy if exists "field-photos: allow update" on storage.objects;
drop policy if exists "field-photos: allow delete" on storage.objects;
create policy "field-photos: allow insert" on storage.objects for insert with check (bucket_id = 'field-photos');
create policy "field-photos: allow select" on storage.objects for select using (bucket_id = 'field-photos');
create policy "field-photos: allow update" on storage.objects for update using (bucket_id = 'field-photos');
create policy "field-photos: allow delete" on storage.objects for delete using (bucket_id = 'field-photos');
`);

fs.writeFileSync('init-database.sql', out);
console.log('✅  init-database.sql rebuilt with correct dependency order!');
