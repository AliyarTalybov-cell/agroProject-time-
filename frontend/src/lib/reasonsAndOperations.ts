import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { assertCanDelete } from '@/lib/deletePermissions'

export type DowntimeCategory = 'breakdown' | 'rain' | 'fuel' | 'waiting'

export type DowntimeReasonRow = {
  id: string
  label: string
  description: string | null
  category: DowntimeCategory
  created_at: string
  created_by: string | null
}

export type WorkOperationRow = {
  id: string
  name: string
  created_at: string
  created_by: string | null
}

export async function loadDowntimeReasons(): Promise<DowntimeReasonRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('downtime_reasons')
    .select('id, label, description, category, created_at, created_by')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DowntimeReasonRow[]
}

export async function addDowntimeReason(
  label: string,
  description: string,
  category: DowntimeCategory,
  createdBy: string | null,
): Promise<DowntimeReasonRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from('downtime_reasons')
    .insert({ label, description: description || null, category, created_by: createdBy })
    .select('id, label, description, category, created_at, created_by')
    .single()
  if (error) throw error
  return data as DowntimeReasonRow
}

export async function deleteDowntimeReason(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from('downtime_reasons').delete().eq('id', id)
  if (error) throw error
}

export async function loadWorkOperations(): Promise<WorkOperationRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('work_operations')
    .select('id, name, created_at, created_by')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as WorkOperationRow[]
}

export async function addWorkOperation(name: string, createdBy: string | null): Promise<WorkOperationRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from('work_operations')
    .insert({ name, created_by: createdBy })
    .select('id, name, created_at, created_by')
    .single()
  if (error) throw error
  return data as WorkOperationRow
}

export async function deleteWorkOperation(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from('work_operations').delete().eq('id', id)
  if (error) throw error
}

export { isSupabaseConfigured }
