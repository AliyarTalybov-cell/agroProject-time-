import { supabase } from '@/lib/supabase'
import { addStorageIntake } from '@/lib/storageIntakesSupabase'
import { recalculateStorageBatchTotals } from '@/lib/storageBatchesSupabase'
import { syncStorageLocationFillStatusFromIntakes } from '@/lib/storageLocationsSupabase'

export type StorageTransferRow = {
  id: string
  from_storage_location_id: string
  to_storage_location_id: string
  crop_key: string | null
  mass_tons: number
  batch_id: string | null
  transferred_at: string
  comment: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  from_location?: { id: string; name: string } | { id: string; name: string }[] | null
  to_location?: { id: string; name: string } | { id: string; name: string }[] | null
  crops?: { key: string; label: string } | { key: string; label: string }[] | null
  storage_batches?: { id: string; code: string } | { id: string; code: string }[] | null
}

export type StorageLocationInventory = {
  locationId: string
  totalMassTons: number
  availableMassTons: number
  cropKey: string | null
  cropLabel: string | null
}

export type StorageOpenBatchOption = {
  id: string
  code: string
  totalNetTons: number
  cropKey: string | null
}

export type StorageCropBalance = {
  cropKey: string
  cropLabel: string
  massTons: number
}

export type StorageLocationSummary = {
  totalMassTons: number
  availableMassTons: number
  reservedTons: number
  spoiledTons: number
  cropKey: string | null
  cropLabel: string | null
  occupancyPercent: number
  lastOperationAt: string | null
  lastOperationLabel: string | null
}

/** Доступно для перемещения = общая масса минус резерв и брак. */
export function computeAvailableForTransferMass(
  totalMassTons: number,
  reservedTons = 0,
  spoiledTons = 0,
): number {
  const total = Math.max(0, Number(totalMassTons) || 0)
  const blocked = Math.min(total, Math.max(0, Number(reservedTons) || 0) + Math.max(0, Number(spoiledTons) || 0))
  return Number(Math.max(0, total - blocked).toFixed(3))
}

const TRANSFERS_TABLE = 'storage_transfers'
const TRANSFERS_SELECT =
  'id, from_storage_location_id, to_storage_location_id, crop_key, mass_tons, batch_id, transferred_at, comment, created_by, created_at, updated_at, from_location:storage_locations!storage_transfers_from_storage_location_id_fkey ( id, name ), to_location:storage_locations!storage_transfers_to_storage_location_id_fkey ( id, name ), crops ( key, label ), storage_batches ( id, code )'

const MASS_EPS = 0.0001

function coalesceJoin<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null
  if (Array.isArray(x)) return x[0] ?? null
  return x
}

export function storageTransferFromName(row: StorageTransferRow): string {
  return coalesceJoin(row.from_location)?.name?.trim() || '—'
}

export function storageTransferToName(row: StorageTransferRow): string {
  return coalesceJoin(row.to_location)?.name?.trim() || '—'
}

export function storageTransferCropLabel(row: StorageTransferRow): string {
  return coalesceJoin(row.crops)?.label?.trim() || '—'
}

type IntakeLite = {
  id: string
  storage_location_id: string
  received_at: string
  crop_key: string | null
  gross_mass_tons: number
  moisture_percent: number
  net_mass_tons: number
  batch_id: string | null
}

async function reloadIntakeBatchIds(storageLocationId: string): Promise<Array<{ batch_id: string | null }>> {
  if (!supabase) return []
  const { data, error } = await supabase.from('storage_intakes').select('batch_id').eq('storage_location_id', storageLocationId)
  if (error) throw error
  return (data ?? []) as Array<{ batch_id: string | null }>
}

async function loadLocationIntakes(storageLocationId: string, batchId?: string | null): Promise<IntakeLite[]> {
  if (!supabase) return []
  let req = supabase
    .from('storage_intakes')
    .select('id, storage_location_id, received_at, crop_key, gross_mass_tons, moisture_percent, net_mass_tons, batch_id')
    .eq('storage_location_id', storageLocationId)
    .order('received_at', { ascending: true })
  if (batchId) req = req.eq('batch_id', batchId)
  const { data, error } = await req
  if (error) throw error
  return (data ?? []) as IntakeLite[]
}

/** Остатки по культурам на складе (только то, что реально есть). */
export async function loadStorageCropBalances(storageLocationId: string): Promise<StorageCropBalance[]> {
  const intakes = await loadLocationIntakes(storageLocationId)
  const sums = new Map<string, number>()
  for (const row of intakes) {
    const key = row.crop_key?.trim()
    if (!key) continue
    const net = Number(row.net_mass_tons || 0)
    if (net <= MASS_EPS) continue
    sums.set(key, (sums.get(key) ?? 0) + net)
  }
  if (!sums.size || !supabase) return []
  const keys = Array.from(sums.keys())
  const { data: crops } = await supabase.from('crops').select('key, label').in('key', keys)
  const byKey = new Map<string, string>()
  for (const c of (crops ?? []) as Array<{ key: string; label: string }>) byKey.set(c.key, c.label)
  return keys
    .map((k) => ({
      cropKey: k,
      cropLabel: byKey.get(k) || k,
      massTons: Number((sums.get(k) ?? 0).toFixed(3)),
    }))
    .sort((a, b) => a.cropLabel.localeCompare(b.cropLabel, 'ru'))
}

function sumIntakeMassTons(intakes: ReadonlyArray<IntakeLite>): number {
  return Number(
    intakes
      .reduce((sum, row) => {
        const net = Number(row.net_mass_tons || 0)
        return net > MASS_EPS ? sum + net : sum
      }, 0)
      .toFixed(3),
  )
}

/** Доступная и общая масса по месту хранения. */
export async function getStorageLocationInventory(storageLocationId: string): Promise<StorageLocationInventory> {
  const intakes = await loadLocationIntakes(storageLocationId)
  const total = sumIntakeMassTons(intakes)
  let reserved = 0
  let spoiled = 0
  if (supabase) {
    const { data: loc } = await supabase
      .from('storage_locations')
      .select('reserved_tons, spoiled_tons')
      .eq('id', storageLocationId)
      .maybeSingle()
    if (loc) {
      reserved = Number((loc as { reserved_tons?: number }).reserved_tons || 0)
      spoiled = Number((loc as { spoiled_tons?: number }).spoiled_tons || 0)
    }
  }
  let cropKey: string | null = null
  for (const row of intakes) {
    if (!cropKey && row.crop_key) cropKey = row.crop_key
  }
  let cropLabel: string | null = null
  if (cropKey && supabase) {
    const { data } = await supabase.from('crops').select('label').eq('key', cropKey).maybeSingle()
    cropLabel = (data as { label?: string } | null)?.label?.trim() || cropKey
  }
  return {
    locationId: storageLocationId,
    totalMassTons: total,
    availableMassTons: computeAvailableForTransferMass(total, reserved, spoiled),
    cropKey,
    cropLabel,
  }
}

/** Партии с остатком для выбора при перемещении. */
export async function loadOpenBatchesForTransfer(storageLocationId: string): Promise<StorageOpenBatchOption[]> {
  if (!supabase || !storageLocationId) return []
  const { data, error } = await supabase
    .from('storage_batches')
    .select('id, code, total_net_tons, crop_key')
    .eq('storage_location_id', storageLocationId)
    .gt('total_net_tons', 0)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; code: string; total_net_tons: number; crop_key: string | null }>).map((b) => ({
    id: b.id,
    code: b.code,
    totalNetTons: Number(b.total_net_tons || 0),
    cropKey: b.crop_key,
  }))
}

async function consumeStorageMass(payload: {
  storageLocationId: string
  massTons: number
  cropKey?: string | null
  batchId?: string | null
}): Promise<{ cropKey: string | null; avgMoisture: number }> {
  if (!supabase) throw new Error('Supabase не настроен')
  const sourceIntakes = await loadLocationIntakes(payload.storageLocationId, payload.batchId)
  const intakes =
    payload.cropKey && !payload.batchId
      ? sourceIntakes.filter((x) => (x.crop_key || '') === payload.cropKey)
      : sourceIntakes
  let remaining = payload.massTons
  let cropKey: string | null = null
  let moistureSum = 0
  let moistureWeight = 0
  const touchedBatchIds = new Set<string>()
  const nowIso = new Date().toISOString()

  for (const row of intakes) {
    if (remaining <= MASS_EPS) break
    const net = Number(row.net_mass_tons || 0)
    if (net <= MASS_EPS) continue
    if (!cropKey && row.crop_key) cropKey = row.crop_key

    const take = Math.min(remaining, net)
    const ratio = take / net
    const newNet = Number((net - take).toFixed(3))
    const newGross = Number((Number(row.gross_mass_tons || 0) * (1 - ratio)).toFixed(3))

    moistureSum += Number(row.moisture_percent || 0) * take
    moistureWeight += take

    if (row.batch_id) touchedBatchIds.add(row.batch_id)

    if (newNet <= MASS_EPS) {
      const { error } = await supabase.from('storage_intakes').delete().eq('id', row.id)
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('storage_intakes')
        .update({ net_mass_tons: newNet, gross_mass_tons: Math.max(newGross, newNet), updated_at: nowIso })
        .eq('id', row.id)
      if (error) throw error
    }
    remaining = Number((remaining - take).toFixed(3))
  }

  if (remaining > MASS_EPS) {
    throw new Error('Недостаточно доступной массы на складе-отправителе')
  }

  for (const batchId of touchedBatchIds) {
    await recalculateStorageBatchTotals(batchId)
  }

  const avgMoisture = moistureWeight > 0 ? Number((moistureSum / moistureWeight).toFixed(2)) : 14
  return { cropKey, avgMoisture }
}

export async function executeStorageTransfer(payload: {
  fromStorageLocationId: string
  toStorageLocationId: string
  massTons: number
  cropKey: string | null
  batchId?: string | null
  transferredAt: string
  comment?: string | null
}): Promise<StorageTransferRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  if (payload.fromStorageLocationId === payload.toStorageLocationId) {
    throw new Error('Склад-отправитель и склад-получатель должны отличаться')
  }
  if (!Number.isFinite(payload.massTons) || payload.massTons <= 0) {
    throw new Error('Укажите массу перемещения больше нуля')
  }

  const inventory = await getStorageLocationInventory(payload.fromStorageLocationId)
  if (!payload.cropKey) throw new Error('Выберите культуру для перемещения')
  const cropBalances = await loadStorageCropBalances(payload.fromStorageLocationId)
  const selectedCrop = cropBalances.find((x) => x.cropKey === payload.cropKey)
  if (!selectedCrop || selectedCrop.massTons <= MASS_EPS) {
    throw new Error('На складе нет доступного остатка по выбранной культуре')
  }
  if (payload.batchId) {
    const batches = await loadOpenBatchesForTransfer(payload.fromStorageLocationId)
    const batch = batches.find((b) => b.id === payload.batchId)
    if (!batch) throw new Error('Партия не найдена или не содержит массы')
    if (batch.cropKey && batch.cropKey !== payload.cropKey) {
      throw new Error('Выбранная партия содержит другую культуру')
    }
    if (payload.massTons > batch.totalNetTons + MASS_EPS) {
      throw new Error(`Масса не может превышать массу партии (${batch.totalNetTons.toLocaleString('ru-RU')} т)`)
    }
  } else if (payload.massTons > selectedCrop.massTons + MASS_EPS) {
    throw new Error(
      `Масса не может превышать остаток по культуре (${selectedCrop.massTons.toLocaleString('ru-RU')} т)`,
    )
  } else if (payload.massTons > inventory.availableMassTons + MASS_EPS) {
    throw new Error(`Масса не может превышать доступный остаток (${inventory.availableMassTons.toLocaleString('ru-RU')} т)`)
  }

  const { data: fromLoc } = await supabase.from('storage_locations').select('name').eq('id', payload.fromStorageLocationId).maybeSingle()
  const fromName = (fromLoc as { name?: string } | null)?.name?.trim() || 'склад'

  const { cropKey: consumedCrop, avgMoisture } = await consumeStorageMass({
    storageLocationId: payload.fromStorageLocationId,
    massTons: payload.massTons,
    cropKey: payload.cropKey,
    batchId: payload.batchId,
  })

  const cropKey = payload.cropKey || consumedCrop || inventory.cropKey
  const commentParts = [`Перемещение из «${fromName}»`]
  if (payload.comment?.trim()) commentParts.push(payload.comment.trim())
  const destComment = commentParts.join('. ')

  await addStorageIntake({
    storage_location_id: payload.toStorageLocationId,
    received_at: payload.transferredAt,
    field_id: null,
    crop_key: cropKey,
    gross_mass_tons: payload.massTons,
    moisture_percent: avgMoisture,
    base_moisture_percent: 14,
    weed_impurity_percent: 0,
    grain_impurity_percent: 0,
    net_mass_tons: payload.massTons,
    comment: destComment,
  })

  const { data: userData } = await supabase.auth.getUser()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from(TRANSFERS_TABLE)
    .insert({
      from_storage_location_id: payload.fromStorageLocationId,
      to_storage_location_id: payload.toStorageLocationId,
      crop_key: cropKey,
      mass_tons: Number(payload.massTons.toFixed(3)),
      batch_id: payload.batchId || null,
      transferred_at: payload.transferredAt,
      comment: payload.comment?.trim() || null,
      created_by: userData.user?.id ?? null,
      updated_at: nowIso,
    })
    .select(TRANSFERS_SELECT)
    .single()
  if (error) throw error

  for (const locId of [payload.fromStorageLocationId, payload.toStorageLocationId]) {
    const rows = await reloadIntakeBatchIds(locId)
    await syncStorageLocationFillStatusFromIntakes(locId, rows)
  }

  return data as StorageTransferRow
}

export async function loadStorageTransfersForLocation(storageLocationId: string): Promise<StorageTransferRow[]> {
  if (!supabase || !storageLocationId) return []
  const { data, error } = await supabase
    .from(TRANSFERS_TABLE)
    .select(TRANSFERS_SELECT)
    .or(`from_storage_location_id.eq.${storageLocationId},to_storage_location_id.eq.${storageLocationId}`)
    .order('transferred_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as StorageTransferRow[]
}

/** Сводка по всем местам хранения для карточек «Склады». */
export async function loadStorageLocationSummaries(
  places: ReadonlyArray<{
    id: string
    capacity_tons: number | null
    crop_key: string | null
    reserved_tons?: number | null
    spoiled_tons?: number | null
    crops?: { key: string; label: string } | { key: string; label: string }[] | null
  }>,
): Promise<Record<string, StorageLocationSummary>> {
  if (!supabase || !places.length) return {}

  const ids = places.map((p) => p.id)
  const { data: intakeRows, error: intakeError } = await supabase
    .from('storage_intakes')
    .select('storage_location_id, received_at, crop_key, net_mass_tons, batch_id')
    .in('storage_location_id', ids)
  if (intakeError) throw intakeError

  let transferRows: Array<{
    from_storage_location_id: string
    to_storage_location_id: string
    transferred_at: string
    mass_tons: number
  }> = []
  const { data: transferData, error: transferError } = await supabase
    .from(TRANSFERS_TABLE)
    .select('from_storage_location_id, to_storage_location_id, transferred_at, mass_tons')
    .or(`from_storage_location_id.in.(${ids.join(',')}),to_storage_location_id.in.(${ids.join(',')})`)
    .order('transferred_at', { ascending: false })
  if (transferError) {
    // Таблица перемещений может быть ещё не применена миграцией — не ломаем карточки складов.
    if (!/storage_transfers|does not exist|relation/i.test(transferError.message || '')) throw transferError
  } else {
    transferRows = (transferData ?? []) as typeof transferRows
  }

  const result: Record<string, StorageLocationSummary> = {}
  for (const place of places) {
    const cropJoin = coalesceJoin(place.crops)
    result[place.id] = {
      totalMassTons: 0,
      availableMassTons: 0,
      reservedTons: Number(place.reserved_tons || 0),
      spoiledTons: Number(place.spoiled_tons || 0),
      cropKey: place.crop_key,
      cropLabel: cropJoin?.label?.trim() || null,
      occupancyPercent: 0,
      lastOperationAt: null,
      lastOperationLabel: null,
    }
  }

  for (const row of (intakeRows ?? []) as Array<IntakeLite & { storage_location_id: string }>) {
    const locId = row.storage_location_id
    const summary = result[locId]
    if (!summary) continue
    const net = Number(row.net_mass_tons || 0)
    if (net <= 0) continue
    summary.totalMassTons += net
    if (!summary.cropKey && row.crop_key) summary.cropKey = row.crop_key
    const at = row.received_at
    if (!summary.lastOperationAt || new Date(at).getTime() > new Date(summary.lastOperationAt).getTime()) {
      summary.lastOperationAt = at
      summary.lastOperationLabel = 'Приёмка'
    }
  }

  for (const tr of transferRows) {
    for (const locId of [tr.from_storage_location_id, tr.to_storage_location_id]) {
      const summary = result[locId]
      if (!summary) continue
      const at = tr.transferred_at
      if (!summary.lastOperationAt || new Date(at).getTime() > new Date(summary.lastOperationAt).getTime()) {
        summary.lastOperationAt = at
        summary.lastOperationLabel =
          locId === tr.from_storage_location_id ? 'Перемещение (исход.)' : 'Перемещение (приход)'
      }
    }
  }

  for (const place of places) {
    const summary = result[place.id]
    if (!summary) continue
    summary.totalMassTons = Number(summary.totalMassTons.toFixed(3))
    summary.availableMassTons = computeAvailableForTransferMass(
      summary.totalMassTons,
      summary.reservedTons,
      summary.spoiledTons,
    )
    const cap = place.capacity_tons
    if (cap != null && Number.isFinite(Number(cap)) && Number(cap) > 0) {
      summary.occupancyPercent = Math.min(100, Math.round((summary.totalMassTons / Number(cap)) * 100))
    } else {
      summary.occupancyPercent = summary.totalMassTons > 0 ? 100 : 0
    }
    if (!summary.cropLabel && summary.cropKey) summary.cropLabel = summary.cropKey
  }

  return result
}
