import { supabase } from '@/lib/supabase'
import { assertCanDelete } from '@/lib/deletePermissions'

export type StorageLocationTypeRow = {
  id: string
  name: string
  sort_order: number
  created_at: string
}

export type StorageLocationStatusRow = {
  id: string
  name: string
  marks_inactive: boolean
  sort_order: number
  created_at: string
}

export type StorageFillStatusRow = {
  id: string
  name: string
  code: string | null
  sort_order: number
  created_at: string
}

const TYPES_TABLE = 'storage_location_types'
const STATUSES_TABLE = 'storage_location_statuses'
const FILL_STATUSES_TABLE = 'storage_fill_statuses'
const TYPE_COLS = 'id, name, sort_order, created_at'
const STATUS_COLS = 'id, name, marks_inactive, sort_order, created_at'
const FILL_COLS = 'id, name, code, sort_order, created_at'

export async function loadStorageLocationTypes(): Promise<StorageLocationTypeRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(TYPES_TABLE).select(TYPE_COLS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as StorageLocationTypeRow[]
}

export async function loadStorageLocationStatuses(): Promise<StorageLocationStatusRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(STATUSES_TABLE).select(STATUS_COLS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as StorageLocationStatusRow[]
}

export async function loadStorageFillStatuses(): Promise<StorageFillStatusRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(FILL_STATUSES_TABLE).select(FILL_COLS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as StorageFillStatusRow[]
}

export async function addStorageLocationType(name: string): Promise<StorageLocationTypeRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.from(TYPES_TABLE).insert({ name: name.trim() }).select(TYPE_COLS).single()
  if (error) throw error
  return data as StorageLocationTypeRow
}

export async function updateStorageLocationType(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(TYPES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function deleteStorageLocationType(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(TYPES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function addStorageLocationStatus(payload: {
  name: string
  marks_inactive?: boolean
}): Promise<StorageLocationStatusRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from(STATUSES_TABLE)
    .insert({
      name: payload.name.trim(),
      marks_inactive: payload.marks_inactive ?? false,
    })
    .select(STATUS_COLS)
    .single()
  if (error) throw error
  return data as StorageLocationStatusRow
}

export async function updateStorageLocationStatus(
  id: string,
  payload: Partial<{ name: string; marks_inactive: boolean }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const updates: Record<string, unknown> = {}
  if (payload.name !== undefined) updates.name = payload.name.trim()
  if (payload.marks_inactive !== undefined) updates.marks_inactive = payload.marks_inactive
  const { error } = await supabase.from(STATUSES_TABLE).update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteStorageLocationStatus(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(STATUSES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function addStorageFillStatus(name: string): Promise<StorageFillStatusRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from(FILL_STATUSES_TABLE)
    .insert({ name: name.trim(), code: null })
    .select(FILL_COLS)
    .single()
  if (error) throw error
  return data as StorageFillStatusRow
}

export async function updateStorageFillStatus(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(FILL_STATUSES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function deleteStorageFillStatus(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(FILL_STATUSES_TABLE).delete().eq('id', id)
  if (error) throw error
}
