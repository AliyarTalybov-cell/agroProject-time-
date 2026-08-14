import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { assertCanDelete } from '@/lib/deletePermissions'
import { assertPhotoSize } from '@/lib/uploadLimits'

export type EquipmentCondition = string

export type EquipmentRow = {
  id: string
  brand: string
  license_plate: string
  factory_number: string | null
  epsm_psm: string | null
  svr_number: string | null
  registration_certificate: string | null
  registration_date: string | null
  deregistration_date: string | null
  model: string | null
  equipment_type: string | null
  year: number | null
  purpose_crop: string | null
  implement_id: string | null
  condition: EquipmentCondition
  responsible_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type EquipmentImplementCondition = EquipmentCondition

export type EquipmentImplementRow = {
  id: string
  name: string
  purpose: string | null
  description: string | null
  condition: EquipmentImplementCondition
  created_at: string
  updated_at: string
}

export type EquipmentImplementPage = {
  rows: EquipmentImplementRow[]
  total: number
}

export type EquipmentTypeRefRow = {
  id: string
  code: string
  name: string
  sort_order: number
  created_at: string
}

export type EquipmentConditionRefRow = {
  code: string
  name: string
  sort_order: number
  created_at: string
}

const EQUIPMENT_TABLE = 'equipment'
const EQUIPMENT_IMPLEMENTS_TABLE = 'equipment_implements'
const EQUIPMENT_TYPES_REF_TABLE = 'equipment_type_refs'
const EQUIPMENT_CONDITIONS_REF_TABLE = 'equipment_condition_refs'
const EQUIPMENT_PHOTOS_TABLE = 'equipment_photos'
const EQUIPMENT_PHOTOS_BUCKET = 'equipment-photos'
const EQUIPMENT_DOCUMENTS_TABLE = 'equipment_documents'
const EQUIPMENT_DOCUMENTS_BUCKET = 'equipment-documents'

export type EquipmentPhotoRow = {
  id: string
  equipment_id: string
  file_url: string
  file_path?: string | null
  title: string | null
  description: string | null
  created_at: string
}

export type EquipmentDocumentRow = {
  id: string
  equipment_id: string
  file_url: string
  file_path?: string | null
  file_name: string
  file_size: number | null
  mime_type: string | null
  created_at: string
}

export async function getEquipmentById(id: string): Promise<EquipmentRow | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from(EQUIPMENT_TABLE)
    .select('id, brand, license_plate, factory_number, epsm_psm, svr_number, registration_certificate, registration_date, deregistration_date, model, equipment_type, year, purpose_crop, implement_id, condition, responsible_id, notes, created_at, updated_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as EquipmentRow | null
}

export async function loadEquipment(): Promise<EquipmentRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(EQUIPMENT_TABLE)
    .select('id, brand, license_plate, factory_number, epsm_psm, svr_number, registration_certificate, registration_date, deregistration_date, model, equipment_type, year, purpose_crop, implement_id, condition, responsible_id, notes, created_at, updated_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EquipmentRow[]
}

export type EquipmentPageResult = { rows: EquipmentRow[]; total: number }

const EQUIPMENT_SELECT =
  'id, brand, license_plate, factory_number, epsm_psm, svr_number, registration_certificate, registration_date, deregistration_date, model, equipment_type, year, purpose_crop, implement_id, condition, responsible_id, notes, created_at, updated_at'

/** Серверная пагинация техники с поиском по марке/госномеру/модели/типу. */
export async function loadEquipmentPage(params: {
  search?: string
  page?: number
  pageSize?: number
}): Promise<EquipmentPageResult> {
  if (!supabase) return { rows: [], total: 0 }
  const page = Math.max(1, Math.trunc(params.page ?? 1) || 1)
  const pageSize = Math.max(1, Math.trunc(params.pageSize ?? 10) || 10)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let q = supabase
    .from(EQUIPMENT_TABLE)
    .select(EQUIPMENT_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)
  const s = (params.search ?? '').replace(/[(),*]/g, ' ').trim()
  if (s) {
    q = q.or(`brand.ilike.*${s}*,license_plate.ilike.*${s}*,model.ilike.*${s}*,equipment_type.ilike.*${s}*`)
  }
  const { data, count, error } = await q
  if (error) throw error
  return { rows: (data ?? []) as EquipmentRow[], total: Number(count ?? 0) }
}

export async function insertEquipment(payload: {
  brand: string
  license_plate: string
  factory_number?: string | null
  epsm_psm?: string | null
  svr_number?: string | null
  registration_certificate?: string | null
  registration_date?: string | null
  deregistration_date?: string | null
  model?: string | null
  equipment_type?: string | null
  year?: number | null
  purpose_crop?: string | null
  implement_id?: string | null
  condition?: EquipmentCondition
  responsible_id?: string | null
  notes?: string | null
}): Promise<EquipmentRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(EQUIPMENT_TABLE)
    .insert({
      brand: payload.brand.trim(),
      license_plate: payload.license_plate.trim(),
      factory_number: payload.factory_number?.trim() || null,
      epsm_psm: payload.epsm_psm?.trim() || null,
      svr_number: payload.svr_number?.trim() || null,
      registration_certificate: payload.registration_certificate?.trim() || null,
      registration_date: payload.registration_date || null,
      deregistration_date: payload.deregistration_date || null,
      model: payload.model?.trim() || null,
      equipment_type: payload.equipment_type || null,
      year: payload.year ?? null,
      purpose_crop: payload.purpose_crop?.trim() || null,
      implement_id: payload.implement_id ?? null,
      condition: payload.condition ?? 'operational',
      responsible_id: payload.responsible_id ?? null,
      notes: payload.notes?.trim() || null,
      updated_at: now,
    })
    .select()
    .single()
  if (error) throw error
  return data as EquipmentRow
}

export async function updateEquipment(
  id: string,
  updates: Partial<{
    brand: string
    license_plate: string
    factory_number: string | null
    epsm_psm: string | null
    svr_number: string | null
    registration_certificate: string | null
    registration_date: string | null
    deregistration_date: string | null
    model: string | null
    equipment_type: string | null
    year: number | null
    purpose_crop: string | null
    implement_id: string | null
    condition: EquipmentCondition
    responsible_id: string | null
    notes: string | null
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase
    .from(EQUIPMENT_TABLE)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteEquipment(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(EQUIPMENT_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function loadEquipmentImplementsOptions(): Promise<EquipmentImplementRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(EQUIPMENT_IMPLEMENTS_TABLE)
    .select('id, name, purpose, description, condition, created_at, updated_at')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as EquipmentImplementRow[]
}

export async function loadEquipmentImplementsPage(
  page = 1,
  pageSize = 10,
  search = '',
): Promise<EquipmentImplementPage> {
  if (!supabase) return { rows: [], total: 0 }
  const safePage = Math.max(1, Math.trunc(page) || 1)
  const safePageSize = Math.max(1, Math.trunc(pageSize) || 10)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1
  let q = supabase
    .from(EQUIPMENT_IMPLEMENTS_TABLE)
    .select('id, name, purpose, description, condition, created_at, updated_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)
  const s = search.trim()
  if (s) q = q.or(`name.ilike.%${s}%,purpose.ilike.%${s}%`)
  const { data, count, error } = await q
  if (error) throw error
  return {
    rows: (data ?? []) as EquipmentImplementRow[],
    total: Number(count ?? 0),
  }
}

export async function insertEquipmentImplement(payload: {
  name: string
  purpose?: string | null
  description?: string | null
  condition?: EquipmentImplementCondition
}): Promise<EquipmentImplementRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(EQUIPMENT_IMPLEMENTS_TABLE)
    .insert({
      name: payload.name.trim(),
      purpose: payload.purpose?.trim() || null,
      description: payload.description?.trim() || null,
      condition: payload.condition ?? 'operational',
      updated_at: now,
    })
    .select('id, name, purpose, description, condition, created_at, updated_at')
    .single()
  if (error) throw error
  return data as EquipmentImplementRow
}

export async function updateEquipmentImplement(
  id: string,
  updates: Partial<{
    name: string
    purpose: string | null
    description: string | null
    condition: EquipmentImplementCondition
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase
    .from(EQUIPMENT_IMPLEMENTS_TABLE)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteEquipmentImplement(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(EQUIPMENT_IMPLEMENTS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function loadEquipmentTypeRefs(): Promise<EquipmentTypeRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(EQUIPMENT_TYPES_REF_TABLE)
    .select('id, code, name, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as EquipmentTypeRefRow[]
}

export async function addEquipmentTypeRef(payload: {
  code: string
  name: string
  sort_order?: number
}): Promise<EquipmentTypeRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from(EQUIPMENT_TYPES_REF_TABLE)
    .insert({
      code: payload.code.trim(),
      name: payload.name.trim(),
      sort_order: payload.sort_order ?? 0,
    })
    .select('id, code, name, sort_order, created_at')
    .single()
  if (error) throw error
  return data as EquipmentTypeRefRow
}

export async function updateEquipmentTypeRef(
  id: string,
  updates: Partial<{ code: string; name: string; sort_order: number }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase
    .from(EQUIPMENT_TYPES_REF_TABLE)
    .update({
      ...updates,
      code: updates.code?.trim(),
      name: updates.name?.trim(),
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteEquipmentTypeRef(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(EQUIPMENT_TYPES_REF_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function loadEquipmentConditionRefs(): Promise<EquipmentConditionRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(EQUIPMENT_CONDITIONS_REF_TABLE)
    .select('code, name, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as EquipmentConditionRefRow[]
}

export async function addEquipmentConditionRef(payload: {
  code: string
  name: string
  sort_order?: number
}): Promise<EquipmentConditionRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from(EQUIPMENT_CONDITIONS_REF_TABLE)
    .insert({
      code: payload.code,
      name: payload.name.trim(),
      sort_order: payload.sort_order ?? 0,
    })
    .select('code, name, sort_order, created_at')
    .single()
  if (error) throw error
  return data as EquipmentConditionRefRow
}

export async function updateEquipmentConditionRef(
  code: string,
  updates: Partial<{ name: string; sort_order: number }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase
    .from(EQUIPMENT_CONDITIONS_REF_TABLE)
    .update({
      ...updates,
      name: updates.name?.trim(),
    })
    .eq('code', code)
  if (error) throw error
}

export async function deleteEquipmentConditionRef(code: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(EQUIPMENT_CONDITIONS_REF_TABLE).delete().eq('code', code)
  if (error) throw error
}

export async function loadEquipmentPhotos(equipmentId: string): Promise<EquipmentPhotoRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(EQUIPMENT_PHOTOS_TABLE)
    .select('id, equipment_id, file_url, file_path, title, description, created_at')
    .eq('equipment_id', equipmentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EquipmentPhotoRow[]
}

export async function addEquipmentPhoto(
  equipmentId: string,
  file: File,
  title?: string,
  description?: string,
): Promise<EquipmentPhotoRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertPhotoSize(file)
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const baseName = file.name.replace(/\.[^.]+$/, '')
  const safeBase = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const path = `${equipmentId}/${Date.now()}-${safeBase}.${ext}`

  const { data: uploadData, error: uploadError } = await supabase.storage.from(EQUIPMENT_PHOTOS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  })
  if (uploadError) throw uploadError

  const { data: urlData } = supabase.storage.from(EQUIPMENT_PHOTOS_BUCKET).getPublicUrl(uploadData.path)

  const { data: row, error: rowError } = await supabase
    .from(EQUIPMENT_PHOTOS_TABLE)
    .insert({
      equipment_id: equipmentId,
      file_url: urlData.publicUrl,
      file_path: uploadData.path,
      title: title?.trim() || null,
      description: description?.trim() || null,
    })
    .select()
    .single()
  if (rowError) throw rowError
  return row as EquipmentPhotoRow
}

export async function deleteEquipmentPhoto(photoId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()

  // Сначала пробуем получить file_path (если колонки нет — просто удалим запись)
  let filePath: string | null = null
  try {
    const { data: row, error: fetchError } = await supabase
      .from(EQUIPMENT_PHOTOS_TABLE)
      .select('id, file_path')
      .eq('id', photoId)
      .maybeSingle()
    if (fetchError) throw fetchError
    filePath = (row as { file_path?: string | null } | null)?.file_path ?? null
  } catch {
    filePath = null
  }

  const { error: delError } = await supabase.from(EQUIPMENT_PHOTOS_TABLE).delete().eq('id', photoId)
  if (delError) throw delError

  if (filePath) {
    await supabase.storage.from(EQUIPMENT_PHOTOS_BUCKET).remove([filePath])
  }
}

export async function loadEquipmentDocuments(equipmentId: string): Promise<EquipmentDocumentRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(EQUIPMENT_DOCUMENTS_TABLE)
    .select('id, equipment_id, file_url, file_path, file_name, file_size, mime_type, created_at')
    .eq('equipment_id', equipmentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EquipmentDocumentRow[]
}

export async function addEquipmentDocument(equipmentId: string, file: File): Promise<EquipmentDocumentRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const baseName = file.name.replace(/\.[^.]+$/, '')
  const safeBase = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  const path = `${equipmentId}/${Date.now()}-${safeBase}.${ext}`

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(EQUIPMENT_DOCUMENTS_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || undefined,
    })
  if (uploadError) throw uploadError

  const { data: urlData } = supabase.storage.from(EQUIPMENT_DOCUMENTS_BUCKET).getPublicUrl(uploadData.path)
  const { data: row, error: rowError } = await supabase
    .from(EQUIPMENT_DOCUMENTS_TABLE)
    .insert({
      equipment_id: equipmentId,
      file_url: urlData.publicUrl,
      file_path: uploadData.path,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || null,
    })
    .select('id, equipment_id, file_url, file_path, file_name, file_size, mime_type, created_at')
    .single()
  if (rowError) throw rowError
  return row as EquipmentDocumentRow
}

export async function deleteEquipmentDocument(documentId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()

  let filePath: string | null = null
  try {
    const { data: row, error: fetchError } = await supabase
      .from(EQUIPMENT_DOCUMENTS_TABLE)
      .select('id, file_path')
      .eq('id', documentId)
      .maybeSingle()
    if (fetchError) throw fetchError
    filePath = (row as { file_path?: string | null } | null)?.file_path ?? null
  } catch {
    filePath = null
  }

  const { error: delError } = await supabase.from(EQUIPMENT_DOCUMENTS_TABLE).delete().eq('id', documentId)
  if (delError) throw delError
  if (filePath) {
    await supabase.storage.from(EQUIPMENT_DOCUMENTS_BUCKET).remove([filePath])
  }
}

export { isSupabaseConfigured }
