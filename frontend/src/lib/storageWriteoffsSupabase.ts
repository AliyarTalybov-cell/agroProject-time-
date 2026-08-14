import { supabase } from '@/lib/supabase'
import { recalculateStorageBatchTotals } from '@/lib/storageBatchesSupabase'
import { syncStorageLocationFillStatusFromIntakes } from '@/lib/storageLocationsSupabase'

export type StorageWriteoffType = 'sale' | 'processing' | 'spoilage' | 'feed'

export type StorageWriteoffBatchOption = {
  id: string
  code: string
  cropKey: string | null
  cropLabel: string
  massTons: number
}

export type StorageWriteoffRow = {
  id: string
  storage_location_id: string
  batch_id: string
  crop_key: string | null
  writeoff_type: StorageWriteoffType
  mass_tons: number
  operation_date: string
  counterparty: string | null
  comment: string | null
  created_by: string | null
  created_at: string
  batches?: { id: string; code: string } | null
  crops?: { key: string; label: string } | null
}

export function storageWriteoffTypeLabel(type: StorageWriteoffType): string {
  if (type === 'sale') return 'Реализация'
  if (type === 'processing') return 'Переработка'
  if (type === 'spoilage') return 'Порча'
  return 'Корма'
}

function joinOne<T>(x: T | T[] | null | undefined): T | null {
  if (!x) return null
  return Array.isArray(x) ? x[0] ?? null : x
}

export async function loadStorageWriteoffsForLocation(storageLocationId: string): Promise<Array<StorageWriteoffRow & { actorName: string }>> {
  if (!supabase || !storageLocationId) return []
  const { data, error } = await supabase
    .from('storage_writeoffs')
    .select('id, storage_location_id, batch_id, crop_key, writeoff_type, mass_tons, operation_date, counterparty, comment, created_by, created_at, batches:storage_batches ( id, code ), crops ( key, label )')
    .eq('storage_location_id', storageLocationId)
    .order('operation_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) {
    if (/storage_writeoffs|does not exist|relation/i.test(error.message || '')) return []
    throw error
  }
  const rows = (data ?? []) as Array<{
    id: string
    storage_location_id: string
    batch_id: string
    crop_key: string | null
    writeoff_type: StorageWriteoffType
    mass_tons: number
    operation_date: string
    counterparty: string | null
    comment: string | null
    created_by: string | null
    created_at: string
    batches?: { id: string; code: string }[] | null
    crops?: { key: string; label: string }[] | null
  }>
  const actorIds = Array.from(new Set(rows.map((x) => x.created_by).filter((x): x is string => Boolean(x))))
  const names = new Map<string, string>()
  if (actorIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, display_name, email').in('id', actorIds)
    for (const p of (profiles ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) {
      names.set(p.id, p.display_name?.trim() || p.email?.trim() || '—')
    }
  }
  return rows.map((row) => ({
    ...row,
    batches: joinOne(row.batches),
    crops: joinOne(row.crops),
    actorName: row.created_by ? names.get(row.created_by) || row.created_by : '—',
  }))
}

export type StorageWriteoffWithLocationRow = StorageWriteoffRow & {
  actorName: string
  storageName: string
}

/** Списания по всем складам (для общего реестра «Учёт зерна»). */
export async function loadAllStorageWriteoffs(): Promise<StorageWriteoffWithLocationRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('storage_writeoffs')
    .select('id, storage_location_id, batch_id, crop_key, writeoff_type, mass_tons, operation_date, counterparty, comment, created_by, created_at, batches:storage_batches ( id, code ), crops ( key, label ), storage_locations ( id, name )')
    .order('operation_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) {
    if (/storage_writeoffs|does not exist|relation/i.test(error.message || '')) return []
    throw error
  }
  const rows = (data ?? []) as Array<{
    id: string
    storage_location_id: string
    batch_id: string
    crop_key: string | null
    writeoff_type: StorageWriteoffType
    mass_tons: number
    operation_date: string
    counterparty: string | null
    comment: string | null
    created_by: string | null
    created_at: string
    batches?: { id: string; code: string }[] | { id: string; code: string } | null
    crops?: { key: string; label: string }[] | { key: string; label: string } | null
    storage_locations?: { id: string; name: string }[] | { id: string; name: string } | null
  }>
  const actorIds = Array.from(new Set(rows.map((x) => x.created_by).filter((x): x is string => Boolean(x))))
  const names = new Map<string, string>()
  if (actorIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, display_name, email').in('id', actorIds)
    for (const p of (profiles ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) {
      names.set(p.id, p.display_name?.trim() || p.email?.trim() || '—')
    }
  }
  return rows.map((row) => {
    const loc = joinOne(row.storage_locations)
    return {
      ...row,
      batches: joinOne(row.batches),
      crops: joinOne(row.crops),
      actorName: row.created_by ? names.get(row.created_by) || row.created_by : '—',
      storageName: loc?.name?.trim() || '—',
    }
  })
}

export type StorageWriteoffsPage = { rows: StorageWriteoffWithLocationRow[]; total: number }

function sanitizeOrValue(value: string): string {
  return value.replace(/[(),*]/g, ' ').trim()
}

/** Постраничная загрузка списаний по всем складам с серверным поиском и фильтром по складу. */
export async function loadStorageWriteoffsPage(params: {
  search?: string
  storageLocationId?: string
  page?: number
  pageSize?: number
}): Promise<StorageWriteoffsPage> {
  if (!supabase) return { rows: [], total: 0 }
  const page = Math.max(1, Number(params.page || 1))
  const pageSize = Math.max(1, Number(params.pageSize || 10))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('storage_writeoffs')
    .select(
      'id, storage_location_id, batch_id, crop_key, writeoff_type, mass_tons, operation_date, counterparty, comment, created_by, created_at, batches:storage_batches ( id, code ), crops ( key, label ), storage_locations ( id, name )',
      { count: 'exact' },
    )
    .order('operation_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (params.storageLocationId && params.storageLocationId !== 'all') {
    query = query.eq('storage_location_id', params.storageLocationId)
  }
  const search = sanitizeOrValue(String(params.search || ''))
  if (search) {
    query = query.or(`counterparty.ilike.*${search}*,comment.ilike.*${search}*`)
  }

  const { data, error, count } = await query.range(from, to)
  if (error) {
    if (/storage_writeoffs|does not exist|relation/i.test(error.message || '')) return { rows: [], total: 0 }
    throw error
  }
  const rows = (data ?? []) as Array<{
    id: string
    storage_location_id: string
    batch_id: string
    crop_key: string | null
    writeoff_type: StorageWriteoffType
    mass_tons: number
    operation_date: string
    counterparty: string | null
    comment: string | null
    created_by: string | null
    created_at: string
    batches?: { id: string; code: string }[] | { id: string; code: string } | null
    crops?: { key: string; label: string }[] | { key: string; label: string } | null
    storage_locations?: { id: string; name: string }[] | { id: string; name: string } | null
  }>
  const actorIds = Array.from(new Set(rows.map((x) => x.created_by).filter((x): x is string => Boolean(x))))
  const names = new Map<string, string>()
  if (actorIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, display_name, email').in('id', actorIds)
    for (const p of (profiles ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) {
      names.set(p.id, p.display_name?.trim() || p.email?.trim() || '—')
    }
  }
  return {
    rows: rows.map((row) => {
      const loc = joinOne(row.storage_locations)
      return {
        ...row,
        batches: joinOne(row.batches),
        crops: joinOne(row.crops),
        actorName: row.created_by ? names.get(row.created_by) || row.created_by : '—',
        storageName: loc?.name?.trim() || '—',
      }
    }),
    total: Number(count || 0),
  }
}

export async function loadStorageWriteoffTotalsByBatch(
  storageLocationId: string,
): Promise<Record<string, number>> {
  if (!supabase || !storageLocationId) return {}
  const { data, error } = await supabase
    .from('storage_writeoffs')
    .select('batch_id, mass_tons')
    .eq('storage_location_id', storageLocationId)
  if (error) {
    if (/storage_writeoffs|does not exist|relation/i.test(error.message || '')) return {}
    throw error
  }
  const totals: Record<string, number> = {}
  for (const row of (data ?? []) as Array<{ batch_id: string | null; mass_tons: number }>) {
    if (!row.batch_id) continue
    totals[row.batch_id] = Number(((totals[row.batch_id] ?? 0) + Number(row.mass_tons || 0)).toFixed(3))
  }
  return totals
}

const MASS_EPS = 0.0001

type IntakeLite = {
  id: string
  net_mass_tons: number
  gross_mass_tons: number
  moisture_percent: number
}

export async function loadStorageWriteoffBatchOptionById(
  batchId: string,
): Promise<StorageWriteoffBatchOption | null> {
  if (!supabase || !batchId) return null
  const { data, error } = await supabase
    .from('storage_batches')
    .select('id, code, crop_key, total_net_tons, crops ( key, label )')
    .eq('id', batchId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as {
    id: string
    code: string
    crop_key: string | null
    total_net_tons: number
    crops?: { key: string; label: string } | { key: string; label: string }[] | null
  }
  const cropJoin = Array.isArray(row.crops) ? row.crops[0] : row.crops
  return {
    id: row.id,
    code: row.code,
    cropKey: row.crop_key,
    cropLabel: cropJoin?.label ?? row.crop_key ?? '—',
    massTons: Number(row.total_net_tons || 0),
  }
}

export async function loadStorageWriteoffBatchOptions(
  storageLocationId: string,
): Promise<StorageWriteoffBatchOption[]> {
  if (!supabase || !storageLocationId) return []
  const { data, error } = await supabase
    .from('storage_batches')
    .select('id, code, crop_key, total_net_tons, crops ( key, label )')
    .eq('storage_location_id', storageLocationId)
    .gt('total_net_tons', 0)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Array<{
    id: string
    code: string
    crop_key: string | null
    total_net_tons: number
    crops?: { key: string; label: string } | { key: string; label: string }[] | null
  }>).map((row) => {
    const cropJoin = Array.isArray(row.crops) ? row.crops[0] : row.crops
    return {
      id: row.id,
      code: row.code,
      cropKey: row.crop_key,
      cropLabel: cropJoin?.label?.trim() || row.crop_key || '—',
      massTons: Number(row.total_net_tons || 0),
    }
  })
}

async function consumeBatchMass(storageLocationId: string, batchId: string, massTons: number): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from('storage_intakes')
    .select('id, net_mass_tons, gross_mass_tons, moisture_percent')
    .eq('storage_location_id', storageLocationId)
    .eq('batch_id', batchId)
    .order('received_at', { ascending: true })
  if (error) throw error

  const intakes = (data ?? []) as IntakeLite[]
  let remaining = massTons
  const nowIso = new Date().toISOString()

  for (const row of intakes) {
    if (remaining <= MASS_EPS) break
    const net = Number(row.net_mass_tons || 0)
    if (net <= MASS_EPS) continue

    const take = Math.min(remaining, net)
    const ratio = take / net
    const newNet = Number((net - take).toFixed(3))
    const newGross = Number((Number(row.gross_mass_tons || 0) * (1 - ratio)).toFixed(3))

    if (newNet <= MASS_EPS) {
      const { error: delErr } = await supabase.from('storage_intakes').delete().eq('id', row.id)
      if (delErr) throw delErr
    } else {
      const { error: upErr } = await supabase
        .from('storage_intakes')
        .update({ net_mass_tons: newNet, gross_mass_tons: Math.max(newGross, newNet), updated_at: nowIso })
        .eq('id', row.id)
      if (upErr) throw upErr
    }
    remaining = Number((remaining - take).toFixed(3))
  }

  if (remaining > MASS_EPS) {
    throw new Error('Недостаточно массы в выбранной партии')
  }
}

export async function executeStorageWriteoff(payload: {
  storageLocationId: string
  batchId: string
  writeoffType: StorageWriteoffType
  massTons: number
  operationDate: string
  counterparty?: string | null
  comment?: string | null
}): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  if (!payload.batchId) throw new Error('Выберите партию')
  if (!Number.isFinite(payload.massTons) || payload.massTons <= 0) throw new Error('Укажите массу списания больше нуля')
  if (!payload.operationDate) throw new Error('Укажите дату операции')
  if (payload.writeoffType === 'sale' && !payload.counterparty?.trim()) {
    throw new Error('Для реализации укажите контрагента')
  }

  const { data: batch, error: batchErr } = await supabase
    .from('storage_batches')
    .select('id, storage_location_id, crop_key, total_net_tons')
    .eq('id', payload.batchId)
    .maybeSingle()
  if (batchErr) throw batchErr
  if (!batch) throw new Error('Партия не найдена')
  if (batch.storage_location_id !== payload.storageLocationId) {
    throw new Error('Партия не относится к выбранному складу')
  }
  const batchMass = Number(batch.total_net_tons || 0)
  if (payload.massTons > batchMass + MASS_EPS) {
    throw new Error(`Масса списания не может превышать остаток партии (${batchMass.toLocaleString('ru-RU')} т)`)
  }

  await consumeBatchMass(payload.storageLocationId, payload.batchId, payload.massTons)
  await recalculateStorageBatchTotals(payload.batchId)

  if (payload.writeoffType === 'spoilage') {
    const { data: loc, error: locErr } = await supabase
      .from('storage_locations')
      .select('spoiled_tons')
      .eq('id', payload.storageLocationId)
      .maybeSingle()
    if (locErr) throw locErr
    const spoiled = Number((loc as { spoiled_tons?: number } | null)?.spoiled_tons || 0)
    const { error: locUpErr } = await supabase
      .from('storage_locations')
      .update({ spoiled_tons: Number((spoiled + payload.massTons).toFixed(3)), updated_at: new Date().toISOString() })
      .eq('id', payload.storageLocationId)
    if (locUpErr) throw locUpErr
  }

  const { data: userData } = await supabase.auth.getUser()
  const { error: wrErr } = await supabase
    .from('storage_writeoffs')
    .insert({
      storage_location_id: payload.storageLocationId,
      batch_id: payload.batchId,
      crop_key: batch.crop_key,
      writeoff_type: payload.writeoffType,
      mass_tons: Number(payload.massTons.toFixed(3)),
      operation_date: payload.operationDate,
      counterparty: payload.writeoffType === 'sale' ? payload.counterparty?.trim() || null : null,
      comment: payload.comment?.trim() || null,
      created_by: userData.user?.id ?? null,
      updated_at: new Date().toISOString(),
    })
  if (wrErr) throw wrErr

  const { data: intakeRows, error: re } = await supabase
    .from('storage_intakes')
    .select('batch_id')
    .eq('storage_location_id', payload.storageLocationId)
  if (re) throw re
  await syncStorageLocationFillStatusFromIntakes(payload.storageLocationId, (intakeRows ?? []) as { batch_id: string | null }[])
}
