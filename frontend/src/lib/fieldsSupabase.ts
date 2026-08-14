import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { assertCanDelete } from '@/lib/deletePermissions'
import { assertPhotoSize } from '@/lib/uploadLimits'

export type FieldRow = {
  id: string
  number: number
  name: string
  area: number
  cadastral_number: string | null
  efis_zsn_number: string | null
  address: string | null
  location_description: string | null
  extra_info: string | null
  geolocation: string | null
  municipality: string | null
  region: string | null
  geometry_mode: 'point' | 'polygon'
  contour_geojson: Record<string, unknown> | null
  land_id: string | null
  land_type: string
  sowing_year: number | null
  responsible_id: string | null
  crop_key: string
  scheme_file_url: string | null
  created_at: string
  updated_at: string
}

export type FieldPhotoRow = {
  id: string
  field_id: string
  file_url: string
  file_path?: string | null
  title: string | null
  description: string | null
  created_at: string
}

const FIELDS_TABLE = 'fields'
const FIELD_PHOTOS_TABLE = 'field_photos'
const FIELD_MUNICIPALITIES_REF_TABLE = 'field_municipalities_refs'
const STORAGE_BUCKET = 'field-schemes'
const FIELDS_SELECT_BASE =
  'id, number, name, area, cadastral_number, efis_zsn_number, address, location_description, extra_info, geolocation, land_id, land_type, sowing_year, responsible_id, crop_key, scheme_file_url, created_at, updated_at'
const FIELDS_SELECT_WITH_OPTIONAL = `${FIELDS_SELECT_BASE}, municipality, region, geometry_mode, contour_geojson`

function isMissingGeometryColumnError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? '')
  return message.includes('geometry_mode')
    || message.includes('contour_geojson')
    || message.includes('municipality')
    || message.includes('region')
    || message.includes('efis_zsn_number')
}

function normalizeFieldRow<T extends Record<string, unknown>>(row: T): FieldRow {
  return {
    ...(row as unknown as FieldRow),
    efis_zsn_number: (row.efis_zsn_number as string | null | undefined) ?? null,
    municipality: (row.municipality as string | null | undefined) ?? null,
    region: (row.region as string | null | undefined) ?? null,
    geometry_mode: (row.geometry_mode as 'point' | 'polygon' | null) ?? 'point',
    contour_geojson: (row.contour_geojson as Record<string, unknown> | null) ?? null,
  }
}

export async function loadFields(nameQuery?: string): Promise<FieldRow[]> {
  if (!supabase) return []
  const query = (nameQuery ?? '').trim()
  let req = supabase
    .from(FIELDS_TABLE)
    .select(FIELDS_SELECT_WITH_OPTIONAL)
    .order('number', { ascending: true })
  if (query) req = req.ilike('name', `%${query}%`)
  const { data, error } = await req
  if (!error) return ((data ?? []) as Record<string, unknown>[]).map(normalizeFieldRow)
  if (!isMissingGeometryColumnError(error)) throw error
  let fallbackReq = supabase.from(FIELDS_TABLE).select(FIELDS_SELECT_BASE).order('number', { ascending: true })
  if (query) fallbackReq = fallbackReq.ilike('name', `%${query}%`)
  const fallback = await fallbackReq
  if (fallback.error) throw fallback.error
  return ((fallback.data ?? []) as Record<string, unknown>[]).map(normalizeFieldRow)
}

export type FieldsServerSortKey =
  | 'number'
  | 'name'
  | 'cadastral_number'
  | 'area'
  | 'crop_key'
  | 'land_type'
  | 'location_description'
  | 'responsible_id'

export type FieldsPageParams = {
  search?: string
  cropKey?: string
  sortKey?: FieldsServerSortKey
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export type FieldsPageResult = { rows: FieldRow[]; total: number }

/** Серверная пагинация полей: поиск по названию, фильтр по культуре, сортировка по колонкам БД. */
export async function loadFieldsPage(params: FieldsPageParams = {}): Promise<FieldsPageResult> {
  if (!supabase) return { rows: [], total: 0 }
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 10)))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const sortCol: FieldsServerSortKey = params.sortKey ?? 'number'
  const asc = (params.sortDir ?? 'asc') === 'asc'
  const search = (params.search ?? '').trim()
  const cropKey = params.cropKey && params.cropKey !== 'all' ? params.cropKey : null

  const build = (select: string) => {
    let q = supabase!.from(FIELDS_TABLE).select(select, { count: 'exact' }).order(sortCol, { ascending: asc })
    if (sortCol !== 'number') q = q.order('number', { ascending: true })
    if (search) q = q.ilike('name', `%${search}%`)
    if (cropKey) q = q.eq('crop_key', cropKey)
    return q.range(from, to)
  }

  const { data, error, count } = await build(FIELDS_SELECT_WITH_OPTIONAL)
  if (!error) {
    return { rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(normalizeFieldRow), total: Number(count ?? 0) }
  }
  if (!isMissingGeometryColumnError(error)) throw error
  const fallback = await build(FIELDS_SELECT_BASE)
  if (fallback.error) throw fallback.error
  return { rows: ((fallback.data ?? []) as unknown as Record<string, unknown>[]).map(normalizeFieldRow), total: Number(fallback.count ?? 0) }
}

/** Максимальный номер поля (для подсказки номера новой записи при серверной пагинации). */
export async function loadMaxFieldNumber(): Promise<number> {
  if (!supabase) return 0
  const { data, error } = await supabase
    .from(FIELDS_TABLE)
    .select('number')
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return 0
  return Number((data as { number?: number } | null)?.number ?? 0)
}

export async function getFieldById(id: string): Promise<FieldRow | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from(FIELDS_TABLE)
    .select(FIELDS_SELECT_WITH_OPTIONAL)
    .eq('id', id)
    .maybeSingle()
  if (!error) return data ? normalizeFieldRow(data as Record<string, unknown>) : null
  if (!isMissingGeometryColumnError(error)) throw error
  const fallback = await supabase
    .from(FIELDS_TABLE)
    .select(FIELDS_SELECT_BASE)
    .eq('id', id)
    .maybeSingle()
  if (fallback.error) throw fallback.error
  return fallback.data ? normalizeFieldRow(fallback.data as Record<string, unknown>) : null
}

export async function addField(payload: {
  number: number
  name: string
  area: number
  cadastral_number?: string | null
  efis_zsn_number?: string | null
  address?: string | null
  location_description?: string | null
  extra_info?: string | null
  geolocation?: string | null
  municipality?: string | null
  region?: string | null
  geometry_mode?: 'point' | 'polygon'
  contour_geojson?: Record<string, unknown> | null
  land_id?: string | null
  land_type: string
  sowing_year?: number | null
  responsible_id?: string | null
  crop_key: string
  scheme_file_url?: string | null
}): Promise<FieldRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const now = new Date().toISOString()
  const insertPayload = {
    number: payload.number,
    name: payload.name.trim(),
    area: Number(payload.area),
    cadastral_number: payload.cadastral_number?.trim() || null,
    efis_zsn_number: payload.efis_zsn_number?.trim() || null,
    address: payload.address?.trim() || null,
    location_description: payload.location_description?.trim() || null,
    extra_info: payload.extra_info?.trim() || null,
    geolocation: payload.geolocation?.trim() || null,
    municipality: payload.municipality?.trim() || null,
    region: payload.region?.trim() || null,
    geometry_mode: payload.geometry_mode ?? 'point',
    contour_geojson: payload.contour_geojson ?? null,
    land_id: payload.land_id || null,
    land_type: payload.land_type,
    sowing_year: payload.sowing_year ?? null,
    responsible_id: payload.responsible_id || null,
    crop_key: payload.crop_key,
    scheme_file_url: payload.scheme_file_url || null,
    updated_at: now,
  }
  const { data, error } = await supabase
    .from(FIELDS_TABLE)
    .insert(insertPayload)
    .select()
    .single()
  if (!error) return normalizeFieldRow(data as Record<string, unknown>)
  if (!isMissingGeometryColumnError(error)) throw error
  const fallbackInsert = { ...insertPayload } as Record<string, unknown>
  delete fallbackInsert.efis_zsn_number
  delete fallbackInsert.municipality
  delete fallbackInsert.region
  delete fallbackInsert.geometry_mode
  delete fallbackInsert.contour_geojson
  const fallback = await supabase.from(FIELDS_TABLE).insert(fallbackInsert).select().single()
  if (fallback.error) throw fallback.error
  return normalizeFieldRow(fallback.data as Record<string, unknown>)
}

export async function updateField(
  id: string,
  payload: Partial<{
    name: string
    area: number
    cadastral_number: string | null
    efis_zsn_number: string | null
    address: string | null
    location_description: string | null
    extra_info: string | null
    geolocation: string | null
    municipality: string | null
    region: string | null
    geometry_mode: 'point' | 'polygon'
    contour_geojson: Record<string, unknown> | null
    land_id: string | null
    land_type: string
    sowing_year: number | null
    responsible_id: string | null
    crop_key: string
    scheme_file_url: string | null
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const updates: Record<string, unknown> = { ...payload, updated_at: new Date().toISOString() }
  if (payload.name !== undefined) updates.name = payload.name.trim()
  if (payload.area !== undefined) updates.area = Number(payload.area)
  if (payload.cadastral_number !== undefined) updates.cadastral_number = payload.cadastral_number?.trim() || null
  if (payload.efis_zsn_number !== undefined) updates.efis_zsn_number = payload.efis_zsn_number?.trim() || null
  if (payload.address !== undefined) updates.address = payload.address?.trim() || null
  if (payload.location_description !== undefined) updates.location_description = payload.location_description?.trim() || null
  if (payload.extra_info !== undefined) updates.extra_info = payload.extra_info?.trim() || null
  if (payload.geolocation !== undefined) updates.geolocation = payload.geolocation?.trim() || null
  if (payload.municipality !== undefined) updates.municipality = payload.municipality?.trim() || null
  if (payload.region !== undefined) updates.region = payload.region?.trim() || null
  if (payload.geometry_mode !== undefined) updates.geometry_mode = payload.geometry_mode
  if (payload.contour_geojson !== undefined) updates.contour_geojson = payload.contour_geojson ?? null
  if (payload.land_id !== undefined) updates.land_id = payload.land_id || null
  if (payload.sowing_year !== undefined) updates.sowing_year = payload.sowing_year ?? null
  if (payload.responsible_id !== undefined) updates.responsible_id = payload.responsible_id || null
  if (payload.scheme_file_url !== undefined) updates.scheme_file_url = payload.scheme_file_url || null
  const { error } = await supabase.from(FIELDS_TABLE).update(updates).eq('id', id)
  if (!error) return
  if (!isMissingGeometryColumnError(error)) throw error
  delete updates.efis_zsn_number
  delete updates.municipality
  delete updates.region
  delete updates.geometry_mode
  delete updates.contour_geojson
  const fallback = await supabase.from(FIELDS_TABLE).update(updates).eq('id', id)
  if (fallback.error) throw fallback.error
}

/** Загружает файл схемы в Storage и возвращает публичный URL. Бакет "field-schemes" должен быть создан в Dashboard и быть публичным. */
export async function uploadFieldScheme(file: File, fieldId?: string): Promise<string> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertPhotoSize(file)
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const path = fieldId ? `${fieldId}/${Date.now()}-${safeName}` : `temp/${Date.now()}-${safeName}`
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  })
  if (error) throw error
  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(data.path)
  return urlData.publicUrl
}

export async function deleteField(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(FIELDS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function loadFieldPhotos(fieldId: string): Promise<FieldPhotoRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(FIELD_PHOTOS_TABLE)
    .select('id, field_id, file_url, title, description, created_at')
    .eq('field_id', fieldId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FieldPhotoRow[]
}

export async function addFieldPhoto(
  fieldId: string,
  file: File,
  title?: string,
  description?: string,
): Promise<FieldPhotoRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertPhotoSize(file)
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const path = `field-photos/${fieldId}/${Date.now()}-${safeName}`
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: true })
  if (uploadError) throw uploadError
  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(uploadData.path)
  const { data: row, error } = await supabase
    .from(FIELD_PHOTOS_TABLE)
    .insert({
      field_id: fieldId,
      file_url: urlData.publicUrl,
      file_path: uploadData.path,
      title: title?.trim() || null,
      description: description?.trim() || null,
    })
    .select()
    .single()
  if (error) throw error
  return row as FieldPhotoRow
}

export async function deleteFieldPhoto(photoId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { data: row, error: fetchError } = await supabase
    .from(FIELD_PHOTOS_TABLE)
    .select('id, file_url, file_path')
    .eq('id', photoId)
    .maybeSingle()
  if (fetchError || !row) throw fetchError || new Error('Фото не найдено')
  const storagePath = (row as { file_path?: string | null }).file_path ?? null
  const { error: delError } = await supabase.from(FIELD_PHOTOS_TABLE).delete().eq('id', photoId)
  if (delError) throw delError
  if (storagePath) {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath])
  }
}

export type FieldMunicipalityRefRow = {
  id: string
  name: string
  sort_order: number
  created_at: string
}

export async function loadFieldMunicipalitiesRefs(): Promise<FieldMunicipalityRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(FIELD_MUNICIPALITIES_REF_TABLE)
    .select('id, name, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as FieldMunicipalityRefRow[]
}

export async function addFieldMunicipalityRef(payload: {
  name: string
  sort_order?: number
}): Promise<FieldMunicipalityRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from(FIELD_MUNICIPALITIES_REF_TABLE)
    .insert({
      name: payload.name.trim(),
      sort_order: payload.sort_order ?? 0,
    })
    .select('id, name, sort_order, created_at')
    .single()
  if (error) throw error
  return data as FieldMunicipalityRefRow
}

export async function updateFieldMunicipalityRef(
  id: string,
  updates: Partial<{ name: string; sort_order: number }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase
    .from(FIELD_MUNICIPALITIES_REF_TABLE)
    .update({
      ...updates,
      name: updates.name?.trim(),
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteFieldMunicipalityRef(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(FIELD_MUNICIPALITIES_REF_TABLE).delete().eq('id', id)
  if (error) throw error
}

export { isSupabaseConfigured }
