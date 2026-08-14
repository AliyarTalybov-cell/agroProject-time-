import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { assertCanDelete } from '@/lib/deletePermissions'

export type LandTypeRow = {
  id: string
  name: string
  sort_order: number
  created_at: string
}

export type CropRow = {
  id: string
  key: string
  label: string
  base_moisture_percent: number
  sort_order: number
  created_at: string
}

export type LandActualUseOptionRow = {
  id: string
  name: string
  sort_order: number
  created_at: string
}

export type LandCategoryRow = {
  id: string
  name: string
  sort_order: number
  created_at: string
}

const LAND_TYPES_TABLE = 'land_types'
const LAND_CATEGORIES_TABLE = 'land_categories'
const CROPS_TABLE = 'crops'
const LAND_ACTUAL_USE_OPTIONS_TABLE = 'land_actual_use_options'

export async function loadLandTypes(): Promise<LandTypeRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(LAND_TYPES_TABLE)
    .select('id, name, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandTypeRow[]
}

export async function addLandType(name: string): Promise<LandTypeRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from(LAND_TYPES_TABLE)
    .insert({ name: name.trim(), sort_order: 999 })
    .select()
    .single()
  if (error) throw error
  return data as LandTypeRow
}

export async function updateLandType(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_TYPES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function deleteLandType(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_TYPES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function loadLandCategories(): Promise<LandCategoryRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(LAND_CATEGORIES_TABLE)
    .select('id, name, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandCategoryRow[]
}

export async function addLandCategory(name: string): Promise<LandCategoryRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from(LAND_CATEGORIES_TABLE)
    .insert({ name: name.trim(), sort_order: 999 })
    .select()
    .single()
  if (error) throw error
  return data as LandCategoryRow
}

export async function deleteLandCategory(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_CATEGORIES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandCategory(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_CATEGORIES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function loadCrops(): Promise<CropRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(CROPS_TABLE)
    .select('id, key, label, base_moisture_percent, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })
  if (error) throw error
  return (data ?? []) as CropRow[]
}

/** Генерирует ключ (латиница) из названия для хранения в БД — сотрудникам не показываем. */
function keyFromLabel(label: string): string {
  const tr: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  let s = label.trim().toLowerCase()
  s = s.replace(/[а-яё]/g, (c) => tr[c] ?? c)
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return s || `crop_${Date.now()}`
}

export async function addCrop(key: string, label: string): Promise<CropRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const k = key.trim().toLowerCase().replace(/\s+/g, '_')
  const { data, error } = await supabase
    .from(CROPS_TABLE)
    .insert({ key: k, label: label.trim(), sort_order: 999 })
    .select()
    .single()
  if (error) throw error
  return data as CropRow
}

/** Добавить культуру по одному названию — ключ создаётся автоматически. */
export async function addCropByLabel(label: string): Promise<CropRow> {
  const key = keyFromLabel(label)
  return addCrop(key, label.trim())
}

export async function updateCrop(id: string, key: string, label: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const k = key.trim().toLowerCase().replace(/\s+/g, '_')
  const { error } = await supabase.from(CROPS_TABLE).update({ key: k, label: label.trim() }).eq('id', id)
  if (error) throw error
}

export async function deleteCrop(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(CROPS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function loadLandActualUseOptions(): Promise<LandActualUseOptionRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(LAND_ACTUAL_USE_OPTIONS_TABLE)
    .select('id, name, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandActualUseOptionRow[]
}

export async function addLandActualUseOption(name: string): Promise<LandActualUseOptionRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from(LAND_ACTUAL_USE_OPTIONS_TABLE)
    .insert({ name: name.trim(), sort_order: 999 })
    .select()
    .single()
  if (error) throw error
  return data as LandActualUseOptionRow
}

export async function deleteLandActualUseOption(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_ACTUAL_USE_OPTIONS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandActualUseOption(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_ACTUAL_USE_OPTIONS_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export { isSupabaseConfigured }
