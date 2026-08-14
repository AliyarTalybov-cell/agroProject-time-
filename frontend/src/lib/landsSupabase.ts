import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { assertCanDelete } from '@/lib/deletePermissions'

export type LandTypeRow = {
  id: string
  name: string
  sort_order: number
  created_at: string
}

export type LandRow = {
  id: string
  number: number
  name: string
  land_type_id: string | null
  area: number
  cadastral_number: string | null
  address: string | null
  land_category: string | null
  region: string | null
  permitted_use_docs: string | null
  efgis_zsn_field_number: string | null
  center_lat: number | null
  center_lon: number | null
  location_description: string | null
  geometry_mode: 'point' | 'polygon'
  contour_geojson: Record<string, unknown> | null
  document_area_ha: number | null
  coordinate_area_ha: number | null
  is_agri_land: boolean | null
  agri_land_type_id: string | null
  agri_land_area_ha: number | null
  is_valuable_agri_land: boolean | null
  irrigated_area_ha: number | null
  drained_area_ha: number | null
  actual_use_status: string | null
  breeding_use: boolean | null
  other_use_info: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type LandRightRow = {
  id: string
  land_id: string
  holder_mode: 'manual' | 'reference' | null
  right_type: string
  holder_name: string
  holder_inn: string | null
  holder_kpp: string | null
  holder_ogrn: string | null
  cadastral_number: string | null
  ownership_form: string | null
  document_type: string | null
  supporting_documents: string | null
  document_name: string | null
  document_number: string | null
  document_date: string | null
  starts_at: string | null
  ends_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type LandUserRow = {
  id: string
  land_id: string
  user_id: string | null
  holder_mode: 'manual' | 'reference' | null
  right_holder_id: string | null
  holder_name: string | null
  holder_inn: string | null
  holder_kpp: string | null
  holder_ogrn: string | null
  right_type: string | null
  document_type: string | null
  supporting_documents: string | null
  usage_area_ha: number | null
  organization_name: string | null
  person_name: string | null
  inn: string | null
  basis: string | null
  starts_at: string | null
  ends_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type LandCropRotationRow = {
  id: string
  land_id: string
  field_id: string
  season: string | null
  rotation_type: string | null
  crop_key: string | null
  seed_material_name: string | null
  area_for_crops_ha: number | null
  area_with_improved_products_ha: number | null
  area_for_organic_ha: number | null
  area_for_selection_seed_ha: number | null
  produced_products_info: string | null
  produced_crop_mass_tons: number | null
  created_at: string
  updated_at: string
}

export type LandRealEstateObjectRow = {
  id: string
  land_id: string
  field_id: string | null
  cadastral_number: string
  name: string | null
  location_description: string | null
  area_sqm: number | null
  permitted_use: string | null
  purpose: string | null
  address: string | null
  depth_m: number | null
  height_m: number | null
  length_m: number | null
  volume_m3: number | null
  burial_depth_m: number | null
  development_plan: string | null
  floors: string | null
  underground_floors: string | null
  created_at: string
  updated_at: string
}

export type LandMeliorationEntryRow = {
  id: string
  land_id: string | null
  field_id: string | null
  crop_key: string | null
  area_ha: number | null
  melioration_kind: string
  melioration_type: string | null
  melioration_subtype: string | null
  description_location: string | null
  cadastral_number: string | null
  commissioned_at: string | null
  irrigated_area_ha: number | null
  forest_area_ha: number | null
  forest_characteristics: string | null
  forest_year_created: number | null
  reconstruction_info: string | null
  event_type: string | null
  event_date: string | null
  project_approval: string | null
  created_at: string
  updated_at: string
}

export type LandRightRefRow = {
  id: string
  name: string
  sort_order: number
  created_at: string
}

export type LandRightHolderRow = {
  id: string
  name: string
  holder_type_id: string | null
  inn: string | null
  kpp: string | null
  ogrn: string | null
  created_at: string
}

export type LandCropRotationTypeRefRow = {
  id: string
  name: string
  sort_order: number
  created_at: string
}

const LAND_TYPES_TABLE = 'land_types'
const LANDS_TABLE = 'lands'
const LAND_RIGHTS_TABLE = 'land_rights'
const LAND_USERS_TABLE = 'land_users'
const LAND_CROP_ROTATIONS_TABLE = 'land_crop_rotations'
const LAND_REAL_ESTATE_OBJECTS_TABLE = 'land_real_estate_objects'
const LAND_MELIORATION_ENTRIES_TABLE = 'land_melioration_entries'
const LAND_RIGHTS_FILES_BUCKET = 'land-rights-files'
const LAND_RIGHT_OWNERSHIP_FORMS_TABLE = 'land_right_ownership_forms'
const LAND_RIGHT_TYPES_TABLE = 'land_right_types'
const LAND_RIGHT_DOCUMENT_TYPES_TABLE = 'land_right_document_types'
const LAND_RIGHT_HOLDER_TYPES_TABLE = 'land_right_holder_types'
const LAND_RIGHT_HOLDERS_TABLE = 'land_right_holders'
const LAND_MELIORATION_TYPES_TABLE = 'land_melioration_types'
const LAND_MELIORATION_SUBTYPES_TABLE = 'land_melioration_subtypes'
const LAND_MELIORATION_EVENT_TYPES_TABLE = 'land_melioration_event_types'
const LAND_CROP_ROTATION_TYPES_TABLE = 'land_crop_rotation_types'
const LAND_TYPES_COLUMNS = 'id, name, sort_order, created_at'
const LANDS_COLUMNS =
  'id, number, name, land_type_id, area, cadastral_number, address, land_category, region, permitted_use_docs, efgis_zsn_field_number, center_lat, center_lon, location_description, geometry_mode, contour_geojson, document_area_ha, coordinate_area_ha, is_agri_land, agri_land_type_id, agri_land_area_ha, is_valuable_agri_land, irrigated_area_ha, drained_area_ha, actual_use_status, breeding_use, other_use_info, notes, created_at, updated_at'
const LAND_RIGHTS_COLUMNS =
  'id, land_id, holder_mode, right_type, holder_name, holder_inn, holder_kpp, holder_ogrn, cadastral_number, ownership_form, document_type, supporting_documents, document_name, document_number, document_date, starts_at, ends_at, notes, created_at, updated_at'
const LAND_RIGHT_REF_COLUMNS = 'id, name, sort_order, created_at'
const LAND_RIGHT_HOLDERS_COLUMNS = 'id, name, holder_type_id, inn, kpp, ogrn, created_at'
const LAND_USERS_COLUMNS =
  'id, land_id, user_id, holder_mode, right_holder_id, holder_name, holder_inn, holder_kpp, holder_ogrn, right_type, document_type, supporting_documents, usage_area_ha, organization_name, person_name, inn, basis, starts_at, ends_at, notes, created_at, updated_at'
const LAND_CROP_ROTATIONS_COLUMNS =
  'id, land_id, field_id, season, rotation_type, crop_key, seed_material_name, area_for_crops_ha, area_with_improved_products_ha, area_for_organic_ha, area_for_selection_seed_ha, produced_products_info, produced_crop_mass_tons, created_at, updated_at'
const LAND_REAL_ESTATE_OBJECTS_COLUMNS =
  'id, land_id, field_id, cadastral_number, name, location_description, area_sqm, permitted_use, purpose, address, depth_m, height_m, length_m, volume_m3, burial_depth_m, development_plan, floors, underground_floors, created_at, updated_at'
const LAND_MELIORATION_ENTRIES_COLUMNS =
  'id, land_id, field_id, crop_key, area_ha, melioration_kind, melioration_type, melioration_subtype, description_location, cadastral_number, commissioned_at, irrigated_area_ha, forest_area_ha, forest_characteristics, forest_year_created, reconstruction_info, event_type, event_date, project_approval, created_at, updated_at'

function normalizeLandRow(row: Record<string, unknown>): LandRow {
  return {
    id: String(row.id),
    number: Number(row.number ?? 1),
    name: String(row.name ?? ''),
    land_type_id: row.land_type_id == null ? null : String(row.land_type_id),
    area: Number(row.area ?? 0),
    cadastral_number: row.cadastral_number == null ? null : String(row.cadastral_number),
    address: row.address == null ? null : String(row.address),
    land_category: row.land_category == null ? null : String(row.land_category),
    region: row.region == null ? null : String(row.region),
    permitted_use_docs: row.permitted_use_docs == null ? null : String(row.permitted_use_docs),
    efgis_zsn_field_number: row.efgis_zsn_field_number == null ? null : String(row.efgis_zsn_field_number),
    center_lat: row.center_lat == null ? null : Number(row.center_lat),
    center_lon: row.center_lon == null ? null : Number(row.center_lon),
    location_description: row.location_description == null ? null : String(row.location_description),
    geometry_mode: row.geometry_mode === 'point' ? 'point' : 'polygon',
    contour_geojson: (row.contour_geojson as Record<string, unknown> | null) ?? null,
    document_area_ha: row.document_area_ha == null ? null : Number(row.document_area_ha),
    coordinate_area_ha: row.coordinate_area_ha == null ? null : Number(row.coordinate_area_ha),
    is_agri_land: row.is_agri_land == null ? null : Boolean(row.is_agri_land),
    agri_land_type_id: row.agri_land_type_id == null ? null : String(row.agri_land_type_id),
    agri_land_area_ha: row.agri_land_area_ha == null ? null : Number(row.agri_land_area_ha),
    is_valuable_agri_land: row.is_valuable_agri_land == null ? null : Boolean(row.is_valuable_agri_land),
    irrigated_area_ha: row.irrigated_area_ha == null ? null : Number(row.irrigated_area_ha),
    drained_area_ha: row.drained_area_ha == null ? null : Number(row.drained_area_ha),
    actual_use_status: row.actual_use_status == null ? null : String(row.actual_use_status),
    breeding_use: row.breeding_use == null ? null : Boolean(row.breeding_use),
    other_use_info: row.other_use_info == null ? null : String(row.other_use_info),
    notes: row.notes == null ? null : String(row.notes),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  }
}

export async function loadLandTypes(): Promise<LandTypeRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(LAND_TYPES_TABLE).select(LAND_TYPES_COLUMNS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandTypeRow[]
}

export async function loadLands(searchQuery = ''): Promise<LandRow[]> {
  if (!supabase) return []
  let req = supabase.from(LANDS_TABLE).select(LANDS_COLUMNS).order('number', { ascending: true })
  const query = searchQuery.trim()
  if (query) req = req.or(`cadastral_number.ilike.%${query}%,address.ilike.%${query}%`)
  const { data, error } = await req
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeLandRow)
}

export type LandsPageResult = { rows: LandRow[]; total: number }

/** Серверная пагинация земель для реестра: поиск по кадастру/адресу, сортировка по номеру. */
export async function loadLandsPage(params: {
  search?: string
  page?: number
  pageSize?: number
}): Promise<LandsPageResult> {
  if (!supabase) return { rows: [], total: 0 }
  const page = Math.max(1, Math.trunc(params.page ?? 1) || 1)
  const pageSize = Math.max(1, Math.trunc(params.pageSize ?? 10) || 10)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let req = supabase
    .from(LANDS_TABLE)
    .select(LANDS_COLUMNS, { count: 'exact' })
    .order('number', { ascending: true })
    .range(from, to)
  const query = (params.search ?? '').replace(/[(),*]/g, ' ').trim()
  if (query) req = req.or(`cadastral_number.ilike.*${query}*,address.ilike.*${query}*`)
  const { data, error, count } = await req
  if (error) throw error
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(normalizeLandRow), total: Number(count ?? 0) }
}

/** Максимальный номер участка (подсказка номера новой записи при серверной пагинации). */
export async function loadMaxLandNumber(): Promise<number> {
  if (!supabase) return 0
  const { data, error } = await supabase
    .from(LANDS_TABLE)
    .select('number')
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return 0
  return Number((data as { number?: number } | null)?.number ?? 0)
}

export async function addLand(payload: {
  number: number
  name: string
  land_type_id?: string | null
  area?: number
  cadastral_number?: string | null
  address?: string | null
  land_category?: string | null
  region?: string | null
  permitted_use_docs?: string | null
  efgis_zsn_field_number?: string | null
  center_lat?: number | null
  center_lon?: number | null
  location_description?: string | null
  geometry_mode?: 'point' | 'polygon'
  contour_geojson?: Record<string, unknown> | null
  document_area_ha?: number | null
  coordinate_area_ha?: number | null
  is_agri_land?: boolean | null
  agri_land_type_id?: string | null
  agri_land_area_ha?: number | null
  is_valuable_agri_land?: boolean | null
  irrigated_area_ha?: number | null
  drained_area_ha?: number | null
  actual_use_status?: string | null
  breeding_use?: boolean | null
  other_use_info?: string | null
  notes?: string | null
}): Promise<LandRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const now = new Date().toISOString()
  const insertPayload = {
    number: payload.number,
    name: payload.name.trim(),
    land_type_id: payload.land_type_id || null,
    area: Number(payload.area ?? 0),
    cadastral_number: payload.cadastral_number?.trim() || null,
    address: payload.address?.trim() || null,
    land_category: payload.land_category?.trim() || null,
    region: payload.region?.trim() || null,
    permitted_use_docs: payload.permitted_use_docs?.trim() || null,
    efgis_zsn_field_number: payload.efgis_zsn_field_number?.trim() || null,
    center_lat: payload.center_lat ?? null,
    center_lon: payload.center_lon ?? null,
    location_description: payload.location_description?.trim() || null,
    geometry_mode: payload.geometry_mode ?? 'polygon',
    contour_geojson: payload.contour_geojson ?? null,
    document_area_ha: payload.document_area_ha ?? null,
    coordinate_area_ha: payload.coordinate_area_ha ?? null,
    is_agri_land: payload.is_agri_land ?? null,
    agri_land_type_id: payload.agri_land_type_id || null,
    agri_land_area_ha: payload.agri_land_area_ha ?? null,
    is_valuable_agri_land: payload.is_valuable_agri_land ?? null,
    irrigated_area_ha: payload.irrigated_area_ha ?? null,
    drained_area_ha: payload.drained_area_ha ?? null,
    actual_use_status: payload.actual_use_status?.trim() || null,
    breeding_use: payload.breeding_use ?? null,
    other_use_info: payload.other_use_info?.trim() || null,
    notes: payload.notes?.trim() || null,
    updated_at: now,
  }
  const { data, error } = await supabase.from(LANDS_TABLE).insert(insertPayload).select(LANDS_COLUMNS).single()
  if (error) throw error
  return normalizeLandRow(data as Record<string, unknown>)
}

export async function updateLand(
  id: string,
  payload: Partial<{
    number: number
    name: string
    land_type_id: string | null
    area: number
    cadastral_number: string | null
    address: string | null
    land_category: string | null
    region: string | null
    permitted_use_docs: string | null
    efgis_zsn_field_number: string | null
    center_lat: number | null
    center_lon: number | null
    location_description: string | null
    geometry_mode: 'point' | 'polygon'
    contour_geojson: Record<string, unknown> | null
    document_area_ha: number | null
    coordinate_area_ha: number | null
    is_agri_land: boolean | null
    agri_land_type_id: string | null
    agri_land_area_ha: number | null
    is_valuable_agri_land: boolean | null
    irrigated_area_ha: number | null
    drained_area_ha: number | null
    actual_use_status: string | null
    breeding_use: boolean | null
    other_use_info: string | null
    notes: string | null
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const updates: Record<string, unknown> = { ...payload, updated_at: new Date().toISOString() }
  if (payload.name !== undefined) updates.name = payload.name.trim()
  if (payload.area !== undefined) updates.area = Number(payload.area)
  if (payload.cadastral_number !== undefined) updates.cadastral_number = payload.cadastral_number?.trim() || null
  if (payload.address !== undefined) updates.address = payload.address?.trim() || null
  if (payload.land_category !== undefined) updates.land_category = payload.land_category?.trim() || null
  if (payload.region !== undefined) updates.region = payload.region?.trim() || null
  if (payload.permitted_use_docs !== undefined) updates.permitted_use_docs = payload.permitted_use_docs?.trim() || null
  if (payload.efgis_zsn_field_number !== undefined) updates.efgis_zsn_field_number = payload.efgis_zsn_field_number?.trim() || null
  if (payload.center_lat !== undefined) updates.center_lat = payload.center_lat ?? null
  if (payload.center_lon !== undefined) updates.center_lon = payload.center_lon ?? null
  if (payload.location_description !== undefined) updates.location_description = payload.location_description?.trim() || null
  if (payload.document_area_ha !== undefined) updates.document_area_ha = payload.document_area_ha ?? null
  if (payload.coordinate_area_ha !== undefined) updates.coordinate_area_ha = payload.coordinate_area_ha ?? null
  if (payload.is_agri_land !== undefined) updates.is_agri_land = payload.is_agri_land
  if (payload.agri_land_type_id !== undefined) updates.agri_land_type_id = payload.agri_land_type_id || null
  if (payload.agri_land_area_ha !== undefined) updates.agri_land_area_ha = payload.agri_land_area_ha ?? null
  if (payload.is_valuable_agri_land !== undefined) updates.is_valuable_agri_land = payload.is_valuable_agri_land
  if (payload.irrigated_area_ha !== undefined) updates.irrigated_area_ha = payload.irrigated_area_ha ?? null
  if (payload.drained_area_ha !== undefined) updates.drained_area_ha = payload.drained_area_ha ?? null
  if (payload.actual_use_status !== undefined) updates.actual_use_status = payload.actual_use_status?.trim() || null
  if (payload.breeding_use !== undefined) updates.breeding_use = payload.breeding_use
  if (payload.other_use_info !== undefined) updates.other_use_info = payload.other_use_info?.trim() || null
  if (payload.notes !== undefined) updates.notes = payload.notes?.trim() || null
  const { error } = await supabase.from(LANDS_TABLE).update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteLand(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LANDS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function loadLandRights(landId: string): Promise<LandRightRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(LAND_RIGHTS_TABLE)
    .select(LAND_RIGHTS_COLUMNS)
    .eq('land_id', landId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as LandRightRow[]
}

export async function addLandRight(payload: {
  land_id: string
  holder_mode?: 'manual' | 'reference' | null
  right_type: string
  holder_name: string
  holder_inn?: string | null
  holder_kpp?: string | null
  holder_ogrn?: string | null
  cadastral_number?: string | null
  ownership_form?: string | null
  document_type?: string | null
  supporting_documents?: string | null
  document_name?: string | null
  document_number?: string | null
  document_date?: string | null
  starts_at?: string | null
  ends_at?: string | null
  notes?: string | null
}): Promise<LandRightRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const now = new Date().toISOString()
  const insertPayload = {
    land_id: payload.land_id,
    holder_mode: payload.holder_mode ?? 'manual',
    right_type: payload.right_type.trim(),
    holder_name: payload.holder_name.trim(),
    holder_inn: payload.holder_inn?.trim() || null,
    holder_kpp: payload.holder_kpp?.trim() || null,
    holder_ogrn: payload.holder_ogrn?.trim() || null,
    cadastral_number: payload.cadastral_number?.trim() || null,
    ownership_form: payload.ownership_form?.trim() || null,
    document_type: payload.document_type?.trim() || null,
    supporting_documents: payload.supporting_documents?.trim() || null,
    document_name: payload.document_name?.trim() || null,
    document_number: payload.document_number?.trim() || null,
    document_date: payload.document_date || null,
    starts_at: payload.starts_at || null,
    ends_at: payload.ends_at || null,
    notes: payload.notes?.trim() || null,
    updated_at: now,
  }
  const { data, error } = await supabase.from(LAND_RIGHTS_TABLE).insert(insertPayload).select(LAND_RIGHTS_COLUMNS).single()
  if (error) throw error
  return data as LandRightRow
}

export async function deleteLandRight(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_RIGHTS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandRight(
  id: string,
  payload: Partial<{
    holder_mode: 'manual' | 'reference' | null
    right_type: string
    holder_name: string
    holder_inn: string | null
    holder_kpp: string | null
    holder_ogrn: string | null
    cadastral_number: string | null
    ownership_form: string | null
    document_type: string | null
    supporting_documents: string | null
    document_name: string | null
    document_number: string | null
    document_date: string | null
    starts_at: string | null
    ends_at: string | null
    notes: string | null
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (payload.holder_mode !== undefined) updates.holder_mode = payload.holder_mode
  if (payload.right_type !== undefined) updates.right_type = payload.right_type.trim()
  if (payload.holder_name !== undefined) updates.holder_name = payload.holder_name.trim()
  if (payload.holder_inn !== undefined) updates.holder_inn = payload.holder_inn?.trim() || null
  if (payload.holder_kpp !== undefined) updates.holder_kpp = payload.holder_kpp?.trim() || null
  if (payload.holder_ogrn !== undefined) updates.holder_ogrn = payload.holder_ogrn?.trim() || null
  if (payload.cadastral_number !== undefined) updates.cadastral_number = payload.cadastral_number?.trim() || null
  if (payload.ownership_form !== undefined) updates.ownership_form = payload.ownership_form?.trim() || null
  if (payload.document_type !== undefined) updates.document_type = payload.document_type?.trim() || null
  if (payload.supporting_documents !== undefined) updates.supporting_documents = payload.supporting_documents?.trim() || null
  if (payload.document_name !== undefined) updates.document_name = payload.document_name?.trim() || null
  if (payload.document_number !== undefined) updates.document_number = payload.document_number?.trim() || null
  if (payload.document_date !== undefined) updates.document_date = payload.document_date || null
  if (payload.starts_at !== undefined) updates.starts_at = payload.starts_at || null
  if (payload.ends_at !== undefined) updates.ends_at = payload.ends_at || null
  if (payload.notes !== undefined) updates.notes = payload.notes?.trim() || null
  const { error } = await supabase.from(LAND_RIGHTS_TABLE).update(updates).eq('id', id)
  if (error) throw error
}

export async function uploadLandRightFile(file: File, landId: string, rightId?: string): Promise<string> {
  if (!supabase) throw new Error('Supabase не настроен')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const folder = rightId ? `${landId}/${rightId}` : `${landId}/draft`
  const path = `${folder}/${Date.now()}-${safeName}`
  const { data, error } = await supabase.storage.from(LAND_RIGHTS_FILES_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || undefined,
  })
  if (error) throw error
  const { data: urlData } = supabase.storage.from(LAND_RIGHTS_FILES_BUCKET).getPublicUrl(data.path)
  return urlData.publicUrl
}

export async function loadLandRightOwnershipForms(): Promise<LandRightRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(LAND_RIGHT_OWNERSHIP_FORMS_TABLE).select(LAND_RIGHT_REF_COLUMNS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandRightRefRow[]
}

export async function addLandRightOwnershipForm(name: string): Promise<LandRightRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.from(LAND_RIGHT_OWNERSHIP_FORMS_TABLE).insert({ name: name.trim() }).select(LAND_RIGHT_REF_COLUMNS).single()
  if (error) throw error
  return data as LandRightRefRow
}

export async function deleteLandRightOwnershipForm(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_RIGHT_OWNERSHIP_FORMS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandRightOwnershipForm(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_RIGHT_OWNERSHIP_FORMS_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function loadLandRightTypes(): Promise<LandRightRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(LAND_RIGHT_TYPES_TABLE).select(LAND_RIGHT_REF_COLUMNS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandRightRefRow[]
}

export async function addLandRightType(name: string): Promise<LandRightRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.from(LAND_RIGHT_TYPES_TABLE).insert({ name: name.trim() }).select(LAND_RIGHT_REF_COLUMNS).single()
  if (error) throw error
  return data as LandRightRefRow
}

export async function deleteLandRightType(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_RIGHT_TYPES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandRightType(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_RIGHT_TYPES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function loadLandRightDocumentTypes(): Promise<LandRightRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(LAND_RIGHT_DOCUMENT_TYPES_TABLE).select(LAND_RIGHT_REF_COLUMNS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandRightRefRow[]
}

export async function addLandRightDocumentType(name: string): Promise<LandRightRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.from(LAND_RIGHT_DOCUMENT_TYPES_TABLE).insert({ name: name.trim() }).select(LAND_RIGHT_REF_COLUMNS).single()
  if (error) throw error
  return data as LandRightRefRow
}

export async function deleteLandRightDocumentType(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_RIGHT_DOCUMENT_TYPES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandRightDocumentType(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_RIGHT_DOCUMENT_TYPES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function loadLandRightHolderTypes(): Promise<LandRightRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(LAND_RIGHT_HOLDER_TYPES_TABLE).select(LAND_RIGHT_REF_COLUMNS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandRightRefRow[]
}

export async function addLandRightHolderType(name: string): Promise<LandRightRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.from(LAND_RIGHT_HOLDER_TYPES_TABLE).insert({ name: name.trim() }).select(LAND_RIGHT_REF_COLUMNS).single()
  if (error) throw error
  return data as LandRightRefRow
}

export async function deleteLandRightHolderType(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_RIGHT_HOLDER_TYPES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandRightHolderType(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_RIGHT_HOLDER_TYPES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function loadLandRightHolders(): Promise<LandRightHolderRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(LAND_RIGHT_HOLDERS_TABLE).select(LAND_RIGHT_HOLDERS_COLUMNS).order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandRightHolderRow[]
}

export async function loadLandMeliorationTypes(): Promise<LandRightRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(LAND_MELIORATION_TYPES_TABLE).select(LAND_RIGHT_REF_COLUMNS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandRightRefRow[]
}

export async function addLandMeliorationType(name: string): Promise<LandRightRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.from(LAND_MELIORATION_TYPES_TABLE).insert({ name: name.trim() }).select(LAND_RIGHT_REF_COLUMNS).single()
  if (error) throw error
  return data as LandRightRefRow
}

export async function deleteLandMeliorationType(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_MELIORATION_TYPES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandMeliorationType(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_MELIORATION_TYPES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function loadLandMeliorationSubtypes(): Promise<LandRightRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(LAND_MELIORATION_SUBTYPES_TABLE).select(LAND_RIGHT_REF_COLUMNS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandRightRefRow[]
}

export async function addLandMeliorationSubtype(name: string): Promise<LandRightRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.from(LAND_MELIORATION_SUBTYPES_TABLE).insert({ name: name.trim() }).select(LAND_RIGHT_REF_COLUMNS).single()
  if (error) throw error
  return data as LandRightRefRow
}

export async function deleteLandMeliorationSubtype(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_MELIORATION_SUBTYPES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandMeliorationSubtype(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_MELIORATION_SUBTYPES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function loadLandMeliorationEventTypes(): Promise<LandRightRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(LAND_MELIORATION_EVENT_TYPES_TABLE).select(LAND_RIGHT_REF_COLUMNS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandRightRefRow[]
}

export async function loadLandCropRotationTypes(): Promise<LandCropRotationTypeRefRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from(LAND_CROP_ROTATION_TYPES_TABLE).select(LAND_RIGHT_REF_COLUMNS).order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as LandCropRotationTypeRefRow[]
}

export async function addLandCropRotationType(name: string): Promise<LandCropRotationTypeRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.from(LAND_CROP_ROTATION_TYPES_TABLE).insert({ name: name.trim() }).select(LAND_RIGHT_REF_COLUMNS).single()
  if (error) throw error
  return data as LandCropRotationTypeRefRow
}

export async function deleteLandCropRotationType(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_CROP_ROTATION_TYPES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandCropRotationType(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_CROP_ROTATION_TYPES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function addLandMeliorationEventType(name: string): Promise<LandRightRefRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.from(LAND_MELIORATION_EVENT_TYPES_TABLE).insert({ name: name.trim() }).select(LAND_RIGHT_REF_COLUMNS).single()
  if (error) throw error
  return data as LandRightRefRow
}

export async function deleteLandMeliorationEventType(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_MELIORATION_EVENT_TYPES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandMeliorationEventType(id: string, name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.from(LAND_MELIORATION_EVENT_TYPES_TABLE).update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

export async function addLandRightHolder(payload: {
  name: string
  holder_type_id?: string | null
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
}): Promise<LandRightHolderRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from(LAND_RIGHT_HOLDERS_TABLE)
    .insert({
      name: payload.name.trim(),
      holder_type_id: payload.holder_type_id || null,
      inn: payload.inn?.trim() || null,
      kpp: payload.kpp?.trim() || null,
      ogrn: payload.ogrn?.trim() || null,
    })
    .select(LAND_RIGHT_HOLDERS_COLUMNS)
    .single()
  if (error) throw error
  return data as LandRightHolderRow
}

export async function deleteLandRightHolder(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_RIGHT_HOLDERS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandRightHolder(
  id: string,
  payload: Partial<{
    name: string
    holder_type_id: string | null
    inn: string | null
    kpp: string | null
    ogrn: string | null
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const updates: Record<string, unknown> = {}
  if (payload.name !== undefined) updates.name = payload.name.trim()
  if (payload.holder_type_id !== undefined) updates.holder_type_id = payload.holder_type_id || null
  if (payload.inn !== undefined) updates.inn = payload.inn?.trim() || null
  if (payload.kpp !== undefined) updates.kpp = payload.kpp?.trim() || null
  if (payload.ogrn !== undefined) updates.ogrn = payload.ogrn?.trim() || null
  const { error } = await supabase.from(LAND_RIGHT_HOLDERS_TABLE).update(updates).eq('id', id)
  if (error) throw error
}

export async function loadLandUsers(landId: string): Promise<LandUserRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(LAND_USERS_TABLE)
    .select(LAND_USERS_COLUMNS)
    .eq('land_id', landId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as LandUserRow[]
}

export async function addLandUser(payload: {
  land_id: string
  user_id?: string | null
  holder_mode?: 'manual' | 'reference' | null
  right_holder_id?: string | null
  holder_name?: string | null
  holder_inn?: string | null
  holder_kpp?: string | null
  holder_ogrn?: string | null
  right_type?: string | null
  document_type?: string | null
  supporting_documents?: string | null
  usage_area_ha?: number | null
  organization_name?: string | null
  person_name?: string | null
  inn?: string | null
  basis?: string | null
  starts_at?: string | null
  ends_at?: string | null
  notes?: string | null
}): Promise<LandUserRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const now = new Date().toISOString()
  const insertPayload = {
    land_id: payload.land_id,
    user_id: payload.user_id || null,
    holder_mode: payload.holder_mode ?? 'manual',
    right_holder_id: payload.right_holder_id || null,
    holder_name: payload.holder_name?.trim() || null,
    holder_inn: payload.holder_inn?.trim() || null,
    holder_kpp: payload.holder_kpp?.trim() || null,
    holder_ogrn: payload.holder_ogrn?.trim() || null,
    right_type: payload.right_type?.trim() || null,
    document_type: payload.document_type?.trim() || null,
    supporting_documents: payload.supporting_documents?.trim() || null,
    usage_area_ha: payload.usage_area_ha ?? null,
    organization_name: payload.organization_name?.trim() || null,
    person_name: payload.person_name?.trim() || null,
    inn: payload.inn?.trim() || null,
    basis: payload.basis?.trim() || null,
    starts_at: payload.starts_at || null,
    ends_at: payload.ends_at || null,
    notes: payload.notes?.trim() || null,
    updated_at: now,
  }
  const { data, error } = await supabase.from(LAND_USERS_TABLE).insert(insertPayload).select(LAND_USERS_COLUMNS).single()
  if (error) throw error
  return data as LandUserRow
}

export async function updateLandUser(
  id: string,
  payload: Partial<{
    holder_mode: 'manual' | 'reference' | null
    right_holder_id: string | null
    holder_name: string | null
    holder_inn: string | null
    holder_kpp: string | null
    holder_ogrn: string | null
    right_type: string | null
    document_type: string | null
    supporting_documents: string | null
    usage_area_ha: number | null
    starts_at: string | null
    ends_at: string | null
    organization_name: string | null
    person_name: string | null
    inn: string | null
    basis: string | null
    notes: string | null
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (payload.holder_mode !== undefined) updates.holder_mode = payload.holder_mode
  if (payload.right_holder_id !== undefined) updates.right_holder_id = payload.right_holder_id || null
  if (payload.holder_name !== undefined) updates.holder_name = payload.holder_name?.trim() || null
  if (payload.holder_inn !== undefined) updates.holder_inn = payload.holder_inn?.trim() || null
  if (payload.holder_kpp !== undefined) updates.holder_kpp = payload.holder_kpp?.trim() || null
  if (payload.holder_ogrn !== undefined) updates.holder_ogrn = payload.holder_ogrn?.trim() || null
  if (payload.right_type !== undefined) updates.right_type = payload.right_type?.trim() || null
  if (payload.document_type !== undefined) updates.document_type = payload.document_type?.trim() || null
  if (payload.supporting_documents !== undefined) updates.supporting_documents = payload.supporting_documents?.trim() || null
  if (payload.usage_area_ha !== undefined) updates.usage_area_ha = payload.usage_area_ha ?? null
  if (payload.starts_at !== undefined) updates.starts_at = payload.starts_at || null
  if (payload.ends_at !== undefined) updates.ends_at = payload.ends_at || null
  if (payload.organization_name !== undefined) updates.organization_name = payload.organization_name?.trim() || null
  if (payload.person_name !== undefined) updates.person_name = payload.person_name?.trim() || null
  if (payload.inn !== undefined) updates.inn = payload.inn?.trim() || null
  if (payload.basis !== undefined) updates.basis = payload.basis?.trim() || null
  if (payload.notes !== undefined) updates.notes = payload.notes?.trim() || null
  const { error } = await supabase.from(LAND_USERS_TABLE).update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteLandUser(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_USERS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function loadLandCropRotations(landId: string): Promise<LandCropRotationRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(LAND_CROP_ROTATIONS_TABLE)
    .select(LAND_CROP_ROTATIONS_COLUMNS)
    .eq('land_id', landId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as LandCropRotationRow[]
}

export async function addLandCropRotation(payload: {
  land_id: string
  field_id: string
  season?: string | null
  rotation_type?: string | null
  crop_key?: string | null
  seed_material_name?: string | null
  area_for_crops_ha?: number | null
  area_with_improved_products_ha?: number | null
  area_for_organic_ha?: number | null
  area_for_selection_seed_ha?: number | null
  produced_products_info?: string | null
  produced_crop_mass_tons?: number | null
}): Promise<LandCropRotationRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(LAND_CROP_ROTATIONS_TABLE)
    .insert({
      land_id: payload.land_id,
      field_id: payload.field_id,
      season: payload.season?.trim() || null,
      rotation_type: payload.rotation_type?.trim() || null,
      crop_key: payload.crop_key?.trim() || null,
      seed_material_name: payload.seed_material_name?.trim() || null,
      area_for_crops_ha: payload.area_for_crops_ha ?? null,
      area_with_improved_products_ha: payload.area_with_improved_products_ha ?? null,
      area_for_organic_ha: payload.area_for_organic_ha ?? null,
      area_for_selection_seed_ha: payload.area_for_selection_seed_ha ?? null,
      produced_products_info: payload.produced_products_info?.trim() || null,
      produced_crop_mass_tons: payload.produced_crop_mass_tons ?? null,
      updated_at: now,
    })
    .select(LAND_CROP_ROTATIONS_COLUMNS)
    .single()
  if (error) throw error
  return data as LandCropRotationRow
}

export async function updateLandCropRotation(
  id: string,
  payload: Partial<{
    field_id: string
    season: string | null
    rotation_type: string | null
    crop_key: string | null
    seed_material_name: string | null
    area_for_crops_ha: number | null
    area_with_improved_products_ha: number | null
    area_for_organic_ha: number | null
    area_for_selection_seed_ha: number | null
    produced_products_info: string | null
    produced_crop_mass_tons: number | null
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (payload.field_id !== undefined) updates.field_id = payload.field_id
  if (payload.season !== undefined) updates.season = payload.season?.trim() || null
  if (payload.rotation_type !== undefined) updates.rotation_type = payload.rotation_type?.trim() || null
  if (payload.crop_key !== undefined) updates.crop_key = payload.crop_key?.trim() || null
  if (payload.seed_material_name !== undefined) updates.seed_material_name = payload.seed_material_name?.trim() || null
  if (payload.area_for_crops_ha !== undefined) updates.area_for_crops_ha = payload.area_for_crops_ha ?? null
  if (payload.area_with_improved_products_ha !== undefined) updates.area_with_improved_products_ha = payload.area_with_improved_products_ha ?? null
  if (payload.area_for_organic_ha !== undefined) updates.area_for_organic_ha = payload.area_for_organic_ha ?? null
  if (payload.area_for_selection_seed_ha !== undefined) updates.area_for_selection_seed_ha = payload.area_for_selection_seed_ha ?? null
  if (payload.produced_products_info !== undefined) updates.produced_products_info = payload.produced_products_info?.trim() || null
  if (payload.produced_crop_mass_tons !== undefined) updates.produced_crop_mass_tons = payload.produced_crop_mass_tons ?? null
  const { error } = await supabase.from(LAND_CROP_ROTATIONS_TABLE).update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteLandCropRotation(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_CROP_ROTATIONS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function loadLandRealEstateObjects(landId: string): Promise<LandRealEstateObjectRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(LAND_REAL_ESTATE_OBJECTS_TABLE)
    .select(LAND_REAL_ESTATE_OBJECTS_COLUMNS)
    .eq('land_id', landId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as LandRealEstateObjectRow[]
}

export async function addLandRealEstateObject(payload: {
  land_id: string
  field_id?: string | null
  cadastral_number: string
  name?: string | null
  location_description?: string | null
  area_sqm?: number | null
  permitted_use?: string | null
  purpose?: string | null
  address?: string | null
  depth_m?: number | null
  height_m?: number | null
  length_m?: number | null
  volume_m3?: number | null
  burial_depth_m?: number | null
  development_plan?: string | null
  floors?: string | null
  underground_floors?: string | null
}): Promise<LandRealEstateObjectRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(LAND_REAL_ESTATE_OBJECTS_TABLE)
    .insert({
      land_id: payload.land_id,
      field_id: payload.field_id || null,
      cadastral_number: payload.cadastral_number.trim(),
      name: payload.name?.trim() || null,
      location_description: payload.location_description?.trim() || null,
      area_sqm: payload.area_sqm ?? null,
      permitted_use: payload.permitted_use?.trim() || null,
      purpose: payload.purpose?.trim() || null,
      address: payload.address?.trim() || null,
      depth_m: payload.depth_m ?? null,
      height_m: payload.height_m ?? null,
      length_m: payload.length_m ?? null,
      volume_m3: payload.volume_m3 ?? null,
      burial_depth_m: payload.burial_depth_m ?? null,
      development_plan: payload.development_plan?.trim() || null,
      floors: payload.floors?.trim() || null,
      underground_floors: payload.underground_floors?.trim() || null,
      updated_at: now,
    })
    .select(LAND_REAL_ESTATE_OBJECTS_COLUMNS)
    .single()
  if (error) throw error
  return data as LandRealEstateObjectRow
}

export async function updateLandRealEstateObject(
  id: string,
  payload: Partial<{
    field_id: string | null
    cadastral_number: string
    name: string | null
    location_description: string | null
    area_sqm: number | null
    permitted_use: string | null
    purpose: string | null
    address: string | null
    depth_m: number | null
    height_m: number | null
    length_m: number | null
    volume_m3: number | null
    burial_depth_m: number | null
    development_plan: string | null
    floors: string | null
    underground_floors: string | null
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (payload.field_id !== undefined) updates.field_id = payload.field_id || null
  if (payload.cadastral_number !== undefined) updates.cadastral_number = payload.cadastral_number.trim()
  if (payload.name !== undefined) updates.name = payload.name?.trim() || null
  if (payload.location_description !== undefined) updates.location_description = payload.location_description?.trim() || null
  if (payload.area_sqm !== undefined) updates.area_sqm = payload.area_sqm ?? null
  if (payload.permitted_use !== undefined) updates.permitted_use = payload.permitted_use?.trim() || null
  if (payload.purpose !== undefined) updates.purpose = payload.purpose?.trim() || null
  if (payload.address !== undefined) updates.address = payload.address?.trim() || null
  if (payload.depth_m !== undefined) updates.depth_m = payload.depth_m ?? null
  if (payload.height_m !== undefined) updates.height_m = payload.height_m ?? null
  if (payload.length_m !== undefined) updates.length_m = payload.length_m ?? null
  if (payload.volume_m3 !== undefined) updates.volume_m3 = payload.volume_m3 ?? null
  if (payload.burial_depth_m !== undefined) updates.burial_depth_m = payload.burial_depth_m ?? null
  if (payload.development_plan !== undefined) updates.development_plan = payload.development_plan?.trim() || null
  if (payload.floors !== undefined) updates.floors = payload.floors?.trim() || null
  if (payload.underground_floors !== undefined) updates.underground_floors = payload.underground_floors?.trim() || null
  const { error } = await supabase.from(LAND_REAL_ESTATE_OBJECTS_TABLE).update(updates).eq('id', id)
  if (error) throw error
}

export async function loadLandMeliorationEntries(landId: string): Promise<LandMeliorationEntryRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(LAND_MELIORATION_ENTRIES_TABLE)
    .select(LAND_MELIORATION_ENTRIES_COLUMNS)
    .eq('land_id', landId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as LandMeliorationEntryRow[]
}

export async function loadAllLandMeliorationEntries(): Promise<LandMeliorationEntryRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(LAND_MELIORATION_ENTRIES_TABLE)
    .select(LAND_MELIORATION_ENTRIES_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as LandMeliorationEntryRow[]
}

export type LandMeliorationEntriesPageResult = { rows: LandMeliorationEntryRow[]; total: number }

/** Серверная пагинация записей мелиорации по виду (systems / forest / events). */
export async function loadLandMeliorationEntriesPage(params: {
  melioration_kind: string
  search?: string
  page?: number
  pageSize?: number
}): Promise<LandMeliorationEntriesPageResult> {
  if (!supabase) return { rows: [], total: 0 }
  const kind = params.melioration_kind.trim()
  if (!kind) return { rows: [], total: 0 }
  const page = Math.max(1, Math.trunc(params.page ?? 1) || 1)
  const pageSize = Math.max(1, Math.min(100, Math.trunc(params.pageSize ?? 10) || 10))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let req = supabase
    .from(LAND_MELIORATION_ENTRIES_TABLE)
    .select(LAND_MELIORATION_ENTRIES_COLUMNS, { count: 'exact' })
    .eq('melioration_kind', kind)
    .order('created_at', { ascending: false })
    .range(from, to)
  const query = (params.search ?? '').replace(/[(),*]/g, ' ').trim()
  if (query) {
    req = req.or(
      `cadastral_number.ilike.*${query}*,melioration_type.ilike.*${query}*,melioration_subtype.ilike.*${query}*,description_location.ilike.*${query}*,event_type.ilike.*${query}*`,
    )
  }
  const { data, error, count } = await req
  if (error) throw error
  return { rows: (data ?? []) as LandMeliorationEntryRow[], total: Number(count ?? 0) }
}

export async function addLandMeliorationEntry(payload: {
  land_id?: string | null
  field_id?: string | null
  crop_key?: string | null
  area_ha?: number | null
  melioration_kind: string
  melioration_type?: string | null
  melioration_subtype?: string | null
  description_location?: string | null
  cadastral_number?: string | null
  commissioned_at?: string | null
  irrigated_area_ha?: number | null
  forest_area_ha?: number | null
  forest_characteristics?: string | null
  forest_year_created?: number | null
  reconstruction_info?: string | null
  event_type?: string | null
  event_date?: string | null
  project_approval?: string | null
}): Promise<LandMeliorationEntryRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from(LAND_MELIORATION_ENTRIES_TABLE)
    .insert({
      land_id: payload.land_id || null,
      field_id: payload.field_id || null,
      crop_key: payload.crop_key?.trim() || null,
      area_ha: payload.area_ha ?? null,
      melioration_kind: payload.melioration_kind.trim(),
      melioration_type: payload.melioration_type?.trim() || null,
      melioration_subtype: payload.melioration_subtype?.trim() || null,
      description_location: payload.description_location?.trim() || null,
      cadastral_number: payload.cadastral_number?.trim() || null,
      commissioned_at: payload.commissioned_at || null,
      irrigated_area_ha: payload.irrigated_area_ha ?? null,
      forest_area_ha: payload.forest_area_ha ?? null,
      forest_characteristics: payload.forest_characteristics?.trim() || null,
      forest_year_created: payload.forest_year_created ?? null,
      reconstruction_info: payload.reconstruction_info?.trim() || null,
      event_type: payload.event_type?.trim() || null,
      event_date: payload.event_date || null,
      project_approval: payload.project_approval?.trim() || null,
      updated_at: now,
    })
    .select(LAND_MELIORATION_ENTRIES_COLUMNS)
    .single()
  if (error) throw error
  return data as LandMeliorationEntryRow
}

export async function deleteLandMeliorationEntry(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_MELIORATION_ENTRIES_TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function updateLandMeliorationEntry(
  id: string,
  payload: Partial<{
    field_id: string | null
    crop_key: string | null
    area_ha: number | null
    melioration_kind: string
    melioration_type: string | null
    melioration_subtype: string | null
    description_location: string | null
    cadastral_number: string | null
    commissioned_at: string | null
    irrigated_area_ha: number | null
    forest_area_ha: number | null
    forest_characteristics: string | null
    forest_year_created: number | null
    reconstruction_info: string | null
    event_type: string | null
    event_date: string | null
    project_approval: string | null
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (payload.field_id !== undefined) updates.field_id = payload.field_id || null
  if (payload.crop_key !== undefined) updates.crop_key = payload.crop_key?.trim() || null
  if (payload.area_ha !== undefined) updates.area_ha = payload.area_ha ?? null
  if (payload.melioration_kind !== undefined) updates.melioration_kind = payload.melioration_kind.trim()
  if (payload.melioration_type !== undefined) updates.melioration_type = payload.melioration_type?.trim() || null
  if (payload.melioration_subtype !== undefined) updates.melioration_subtype = payload.melioration_subtype?.trim() || null
  if (payload.description_location !== undefined) updates.description_location = payload.description_location?.trim() || null
  if (payload.cadastral_number !== undefined) updates.cadastral_number = payload.cadastral_number?.trim() || null
  if (payload.commissioned_at !== undefined) updates.commissioned_at = payload.commissioned_at || null
  if (payload.irrigated_area_ha !== undefined) updates.irrigated_area_ha = payload.irrigated_area_ha ?? null
  if (payload.forest_area_ha !== undefined) updates.forest_area_ha = payload.forest_area_ha ?? null
  if (payload.forest_characteristics !== undefined) updates.forest_characteristics = payload.forest_characteristics?.trim() || null
  if (payload.forest_year_created !== undefined) updates.forest_year_created = payload.forest_year_created ?? null
  if (payload.reconstruction_info !== undefined) updates.reconstruction_info = payload.reconstruction_info?.trim() || null
  if (payload.event_type !== undefined) updates.event_type = payload.event_type?.trim() || null
  if (payload.event_date !== undefined) updates.event_date = payload.event_date || null
  if (payload.project_approval !== undefined) updates.project_approval = payload.project_approval?.trim() || null
  const { error } = await supabase.from(LAND_MELIORATION_ENTRIES_TABLE).update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteLandRealEstateObject(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(LAND_REAL_ESTATE_OBJECTS_TABLE).delete().eq('id', id)
  if (error) throw error
}

export { isSupabaseConfigured }
