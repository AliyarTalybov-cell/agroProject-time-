/**
 * Складской учёт зерна на журнале движений (миграция 20260924_stock_ledger.sql).
 *
 * Остатки читаются только из представлений stock_balances / stock_batch_totals /
 * stock_cell_totals, а записываются только функциями stock_post_* и
 * stock_cancel_document — каждая выполняется в базе одной транзакцией и сама
 * проверяет остаток, вместимость и смешение культур. Поэтому здесь нет ни
 * пересчётов, ни проверок массы: сообщение об ошибке приходит из базы.
 */
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Справочные значения
// ---------------------------------------------------------------------------

export type StockDocType =
  | 'opening'
  | 'intake'
  | 'processing'
  | 'transfer'
  | 'sale'
  | 'seeding'
  | 'consumption'
  | 'writeoff'
  | 'inventory'
  | 'storno'

export type StockOutgoingType = 'sale' | 'seeding' | 'consumption' | 'writeoff'
/** Ключ из справочника stock_batch_purposes. */
export type StockPurpose = string
export type StockBatchOrigin = 'field' | 'purchase' | 'opening'
export type StorageCellKind = 'main' | 'cell'
export type CounterpartyKind = 'buyer' | 'supplier' | 'both'

const DOC_TYPE_LABELS: Record<StockDocType, string> = {
  opening: 'Ввод остатков',
  intake: 'Приёмка',
  processing: 'Подработка',
  transfer: 'Перемещение',
  sale: 'Продажа',
  seeding: 'На посев',
  consumption: 'Переработка / корм',
  writeoff: 'Списание',
  inventory: 'Инвентаризация',
  storno: 'Сторно',
}

/** Встроенные назначения — на случай, если справочник ещё не загружен. */
const PURPOSE_LABELS: Record<string, string> = {
  food: 'Продовольственное',
  feed: 'Фуражное',
  seed: 'Семенное',
  processing: 'На переработку',
  export: 'На экспорт',
}

const ORIGIN_LABELS: Record<StockBatchOrigin, string> = {
  field: 'С поля',
  purchase: 'Закупка',
  opening: 'Перенесена из прежнего учёта',
}

const COUNTERPARTY_KIND_LABELS: Record<CounterpartyKind, string> = {
  buyer: 'Покупатель',
  supplier: 'Поставщик',
  both: 'Покупатель и поставщик',
}

export const COUNTERPARTY_KINDS = Object.keys(COUNTERPARTY_KIND_LABELS) as CounterpartyKind[]

export function stockDocTypeLabel(t: string): string {
  return DOC_TYPE_LABELS[t as StockDocType] ?? t
}
/** Подписи из справочников; заполняются при загрузке справочников. */
const refLabels = {
  purposes: new Map<string, string>(Object.entries(PURPOSE_LABELS)),
  targets: new Map<string, string>([
    ['feed', 'На корм'],
    ['processing', 'На переработку'],
  ]),
}

export function stockPurposeLabel(p: string): string {
  return refLabels.purposes.get(p) ?? p
}
export function consumptionTargetLabel(t: string): string {
  return refLabels.targets.get(t) ?? t
}
export function stockOriginLabel(o: string): string {
  return ORIGIN_LABELS[o as StockBatchOrigin] ?? o
}
export function counterpartyKindLabel(k: string): string {
  return COUNTERPARTY_KIND_LABELS[k as CounterpartyKind] ?? k
}

/** Приход — документ, который добавляет зерно (для цвета и знака в журнале). */
export function isIncomingDocType(t: string): boolean {
  return t === 'intake' || t === 'opening'
}

// ---------------------------------------------------------------------------
// Зачётный вес — та же формула, что была в форме приёмки WarehouseCellPage
// ---------------------------------------------------------------------------

export type CreditedWeightInput = {
  /** Масса зерна брутто, т (весовая: полный вес машины − тара). */
  massTons: number | null
  moisturePercent: number | null
  baseMoisturePercent: number
  weedImpurityPercent: number | null
  grainImpurityPercent: number | null
}

export type CreditedWeight = {
  /** Масса после приведения к базовой влажности, т. */
  dryMassTons: number
  /** Потери на сорной и зерновой примеси, т. */
  impurityLossTons: number
  /** Зачётный вес, т — идёт в журнал. */
  netTons: number
}

/**
 * Зачётный вес:
 *   после сушки = масса × (100 − влажность) / (100 − базовая влажность);
 *   потери на примеси = масса × (сорная + зерновая) / 100;
 *   зачётный = после сушки − потери, не меньше нуля.
 * Каждый шаг округляется до 0,01 т — как в прежней форме.
 */
export function computeCreditedWeight(input: CreditedWeightInput): CreditedWeight | null {
  const { massTons, moisturePercent, baseMoisturePercent, weedImpurityPercent, grainImpurityPercent } = input
  if (massTons == null || moisturePercent == null || weedImpurityPercent == null || grainImpurityPercent == null) return null
  if (massTons < 0 || moisturePercent < 0 || moisturePercent >= 100) return null
  if (baseMoisturePercent < 0 || baseMoisturePercent >= 100) return null
  if (weedImpurityPercent < 0 || grainImpurityPercent < 0) return null
  const dryMassTons = Number(((massTons * (100 - moisturePercent)) / (100 - baseMoisturePercent)).toFixed(2))
  const impurityLossTons = Number(((massTons * (weedImpurityPercent + grainImpurityPercent)) / 100).toFixed(2))
  const netTons = Math.max(0, Number((dryMassTons - impurityLossTons).toFixed(2)))
  return { dryMassTons, impurityLossTons, netTons }
}

/** Разбирает число из поля ввода: «12,5» и «12.5»; пусто или мусор — null. */
export function parseDecimalInput(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const s = raw.replace(/\s/g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Тонны для таблиц: «1 217,16 т». */
export function formatTons(value: number | null | undefined, digits = 2): string {
  const n = Number(value ?? 0)
  return `${n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits })} т`
}

/** Деньги: «150 000 ₽». */
export function formatRub(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
}

// ---------------------------------------------------------------------------
// Типы строк
// ---------------------------------------------------------------------------

type One<T> = T | T[] | null | undefined
function one<T>(x: One<T>): T | null {
  if (x == null) return null
  return Array.isArray(x) ? x[0] ?? null : x
}

export type StorageCell = {
  id: string
  storage_location_id: string
  name: string
  kind: StorageCellKind
  location_type_id: string | null
  /** Тип ячейки из справочника «Типы мест хранения»; у «Основной» — пусто. */
  typeName: string | null
  capacity_tons: number | null
  sort_order: number
  active: boolean
}

export type CellWithStock = StorageCell & {
  /** Сколько лежит, т. */
  tons: number
  /** Культура, которая сейчас в ячейке (в ячейке всегда одна). */
  cropKey: string | null
  cropLabel: string | null
}

export type WarehouseOverview = {
  id: string
  name: string
  address: string
  capacityTons: number | null
  fgisCode: string | null
  typeName: string
  statusName: string
  inactive: boolean
  cells: CellWithStock[]
  tons: number
  /** Культуры на складе с массой, по убыванию массы. */
  crops: { key: string; label: string; tons: number }[]
  lastDocument: { type: string; date: string } | null
}

export type StockBatch = {
  id: string
  code: string
  crop_key: string
  cropLabel: string
  variety: string | null
  harvest_year: number | null
  origin: StockBatchOrigin
  field_id: string | null
  fieldName: string | null
  supplier_id: string | null
  supplierName: string | null
  purpose: StockPurpose
  purposeLabel: string
  quality: Record<string, unknown>
  fgis_batch_number: string | null
  comment: string | null
  created_at: string
  tons: number
  reservedTons: number
  firstInAt: string | null
  lastMovementAt: string | null
}

/** Где лежит партия: ячейка, склад, сколько. */
export type BatchPlacement = {
  batchId: string
  cellId: string
  cellName: string
  locationId: string
  locationName: string
  tons: number
}

export type StockDocument = {
  id: string
  doc_type: StockDocType
  number: string
  doc_date: string
  status: 'posted' | 'cancelled'
  counterpartyName: string | null
  fieldName: string | null
  reasonName: string | null
  consumption_target: string | null
  consumptionTargetName: string | null
  vehicle_plate: string | null
  driver_name: string | null
  waybill_number: string | null
  sdiz_number: string | null
  act_number: string | null
  price_per_ton: number | null
  amount: number | null
  weights: Record<string, unknown>
  quality: Record<string, unknown>
  comment: string | null
  cancel_reason: string | null
  cancels_document_id: string | null
  createdByName: string | null
  created_at: string
  movements: StockMovement[]
}

export type StockMovement = {
  id: number
  batch_id: string
  batchCode: string
  cropLabel: string
  cell_id: string
  cellName: string
  locationId: string
  locationName: string
  delta_tons: number
}

export type Counterparty = {
  id: string
  name: string
  kind: CounterpartyKind
  inn: string | null
  kpp: string | null
  address: string | null
  phone: string | null
  email: string | null
  contact_person: string | null
  comment: string | null
  active: boolean
}

export type WriteoffReason = { id: string; name: string }
/** Строка простого справочника: причины списания, назначения, направления расхода. */
export type SimpleRefRow = { id: string; label: string; sort_order: number; active: boolean }
export type SimpleRefTable = 'stock_writeoff_reasons' | 'stock_batch_purposes' | 'stock_consumption_targets'
export type GrainCrop = { key: string; label: string; base_moisture_percent: number }
export type FieldOption = { id: string; name: string; number: string | null }

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------

function db() {
  if (!supabase) throw new Error('Supabase не настроен')
  return supabase
}

export async function loadGrainCrops(): Promise<GrainCrop[]> {
  const { data, error } = await db()
    .from('crops')
    .select('key, label, base_moisture_percent')
    .eq('is_grain', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as GrainCrop[]
}

export async function loadFieldOptions(): Promise<FieldOption[]> {
  const { data, error } = await db().from('fields').select('id, name, number').order('number')
  if (error) throw error
  return (data ?? []) as FieldOption[]
}

export function fieldOptionLabel(f: { name: string; number: string | null }): string {
  return f.number ? `${f.number} — ${f.name}` : f.name
}

/** Простой справочник: id/key, подпись, порядок. У причин списания колонка — name. */
export async function loadSimpleRef(table: SimpleRefTable, onlyActive = false): Promise<SimpleRefRow[]> {
  const idCol = table === 'stock_writeoff_reasons' ? 'id' : 'key'
  const labelCol = table === 'stock_writeoff_reasons' ? 'name' : 'label'
  let req = db().from(table).select(`${idCol}, ${labelCol}, sort_order, active`).order('sort_order').order(labelCol)
  if (onlyActive) req = req.eq('active', true)
  const { data, error } = await req
  if (error) throw error
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r[idCol]),
    label: String(r[labelCol]),
    sort_order: Number(r.sort_order ?? 100),
    active: r.active !== false,
  }))
  if (table === 'stock_batch_purposes') for (const r of rows) refLabels.purposes.set(r.id, r.label)
  if (table === 'stock_consumption_targets') for (const r of rows) refLabels.targets.set(r.id, r.label)
  return rows
}

export async function saveSimpleRef(table: SimpleRefTable, id: string | null, label: string): Promise<void> {
  const labelCol = table === 'stock_writeoff_reasons' ? 'name' : 'label'
  const idCol = table === 'stock_writeoff_reasons' ? 'id' : 'key'
  const clean = label.trim()
  const { error } = id
    ? await db().from(table).update({ [labelCol]: clean }).eq(idCol, id)
    : await db().from(table).insert({ [labelCol]: clean })
  if (error) throw error
}

export async function setSimpleRefActive(table: SimpleRefTable, id: string, active: boolean): Promise<void> {
  const idCol = table === 'stock_writeoff_reasons' ? 'id' : 'key'
  const { error } = await db().from(table).update({ active }).eq(idCol, id)
  if (error) throw error
}

export async function deleteSimpleRef(table: SimpleRefTable, id: string): Promise<void> {
  const idCol = table === 'stock_writeoff_reasons' ? 'id' : 'key'
  const { error } = await db().from(table).delete().eq(idCol, id)
  if (error) throw error
}

export type LocationTypeOption = { id: string; name: string }

export async function loadLocationTypes(): Promise<LocationTypeOption[]> {
  const { data, error } = await db().from('storage_location_types').select('id, name').order('sort_order')
  if (error) throw error
  return (data ?? []) as LocationTypeOption[]
}

export async function loadWriteoffReasons(): Promise<WriteoffReason[]> {
  const { data, error } = await db().from('stock_writeoff_reasons').select('id, name').eq('active', true).order('sort_order')
  if (error) throw error
  return (data ?? []) as WriteoffReason[]
}

/** Склады с ячейками, остатками и последней операцией — для списка и карточки. */
export async function loadWarehousesOverview(locationId?: string): Promise<WarehouseOverview[]> {
  let locReq = db()
    .from('storage_locations')
    .select(
      'id, name, address, capacity_tons, fgis_grain_code, storage_location_types ( name ), storage_location_statuses ( name, marks_inactive )',
    )
    .order('sort_order')
    .order('created_at')
  if (locationId) locReq = locReq.eq('id', locationId)
  let cellReq = db().from('storage_cells').select('*, storage_location_types ( name )').order('sort_order').order('name')
  if (locationId) cellReq = cellReq.eq('storage_location_id', locationId)

  const [locRes, cellRes, totalsRes, cropsRes, lastRes] = await Promise.all([
    locReq,
    cellReq,
    db().from('stock_cell_totals').select('cell_id, storage_location_id, tons, crop_key'),
    db().from('crops').select('key, label'),
    db()
      .from('stock_movements')
      .select('cell_id, storage_cells!inner ( storage_location_id ), stock_documents!inner ( doc_type, doc_date )')
      .order('id', { ascending: false })
      .limit(500),
  ])
  for (const r of [locRes, cellRes, totalsRes, cropsRes, lastRes]) if (r.error) throw r.error

  const cropLabel = new Map((cropsRes.data ?? []).map((c: { key: string; label: string }) => [c.key, c.label]))
  const totals = new Map(
    (totalsRes.data ?? []).map((t: { cell_id: string; tons: number; crop_key: string | null }) => [t.cell_id, t]),
  )
  const lastByLocation = new Map<string, { type: string; date: string }>()
  for (const m of (lastRes.data ?? []) as unknown as Array<{
    storage_cells: One<{ storage_location_id: string }>
    stock_documents: One<{ doc_type: string; doc_date: string }>
  }>) {
    const loc = one(m.storage_cells)?.storage_location_id
    const doc = one(m.stock_documents)
    if (loc && doc && !lastByLocation.has(loc)) lastByLocation.set(loc, { type: doc.doc_type, date: doc.doc_date })
  }

  const cellsByLocation = new Map<string, CellWithStock[]>()
  for (const raw of (cellRes.data ?? []) as Array<StorageCell & { storage_location_types: One<{ name: string }> }>) {
    const { storage_location_types: typeRow, ...c } = raw
    const t = totals.get(c.id)
    const cropKey = t?.crop_key ?? null
    const cell: CellWithStock = {
      ...c,
      typeName: c.kind === 'main' ? 'Основная' : one(typeRow)?.name ?? null,
      capacity_tons: c.capacity_tons == null ? null : Number(c.capacity_tons),
      tons: Number(t?.tons ?? 0),
      cropKey,
      cropLabel: cropKey ? cropLabel.get(cropKey) ?? cropKey : null,
    }
    const list = cellsByLocation.get(c.storage_location_id) ?? []
    list.push(cell)
    cellsByLocation.set(c.storage_location_id, list)
  }

  return ((locRes.data ?? []) as unknown as Array<{
    id: string
    name: string
    address: string
    capacity_tons: number | null
    fgis_grain_code: string | null
    storage_location_types: One<{ name: string }>
    storage_location_statuses: One<{ name: string; marks_inactive: boolean }>
  }>).map((l) => {
    const cells = cellsByLocation.get(l.id) ?? []
    const byCrop = new Map<string, number>()
    for (const c of cells) if (c.cropKey && c.tons > 0) byCrop.set(c.cropKey, (byCrop.get(c.cropKey) ?? 0) + c.tons)
    const status = one(l.storage_location_statuses)
    return {
      id: l.id,
      name: l.name,
      address: l.address,
      capacityTons: l.capacity_tons == null ? null : Number(l.capacity_tons),
      fgisCode: l.fgis_grain_code,
      typeName: one(l.storage_location_types)?.name ?? '',
      statusName: status?.name ?? '',
      inactive: Boolean(status?.marks_inactive),
      cells,
      tons: Number(cells.reduce((s, c) => s + c.tons, 0).toFixed(3)),
      crops: Array.from(byCrop, ([key, tons]) => ({ key, label: cropLabel.get(key) ?? key, tons })).sort(
        (a, b) => b.tons - a.tons,
      ),
      lastDocument: lastByLocation.get(l.id) ?? null,
    }
  })
}

const BATCH_SELECT =
  'id, code, crop_key, variety, harvest_year, origin, field_id, supplier_id, purpose, quality, fgis_batch_number, comment, created_at, crops ( label ), fields ( name, number ), counterparties ( name ), stock_batch_purposes ( label )'

type BatchRow = Omit<StockBatch, 'cropLabel' | 'purposeLabel' | 'fieldName' | 'supplierName' | 'tons' | 'reservedTons' | 'firstInAt' | 'lastMovementAt'> & {
  crops: One<{ label: string }>
  stock_batch_purposes: One<{ label: string }>
  fields: One<{ name: string; number: string | null }>
  counterparties: One<{ name: string }>
}

function mapBatch(
  b: BatchRow,
  t: { tons: number; reserved_tons: number; first_in_at: string | null; last_movement_at: string | null } | undefined,
): StockBatch {
  const field = one(b.fields)
  return {
    id: b.id,
    code: b.code,
    crop_key: b.crop_key,
    cropLabel: one(b.crops)?.label ?? b.crop_key,
    variety: b.variety,
    harvest_year: b.harvest_year,
    origin: b.origin,
    field_id: b.field_id,
    fieldName: field ? fieldOptionLabel(field) : null,
    supplier_id: b.supplier_id,
    supplierName: one(b.counterparties)?.name ?? null,
    purpose: b.purpose,
    purposeLabel: one(b.stock_batch_purposes)?.label ?? stockPurposeLabel(b.purpose),
    quality: (b.quality ?? {}) as Record<string, unknown>,
    fgis_batch_number: b.fgis_batch_number,
    comment: b.comment,
    created_at: b.created_at,
    tons: Number(t?.tons ?? 0),
    reservedTons: Number(t?.reserved_tons ?? 0),
    firstInAt: t?.first_in_at ?? null,
    lastMovementAt: t?.last_movement_at ?? null,
  }
}

/** Все партии с остатками и местами хранения. Партий немного, фильтрация — на странице. */
export async function loadStockBatches(): Promise<{ batches: StockBatch[]; placements: BatchPlacement[] }> {
  const [bRes, tRes, pRes] = await Promise.all([
    db().from('stock_batches').select(BATCH_SELECT).order('created_at', { ascending: false }),
    db().from('stock_batch_totals').select('batch_id, tons, reserved_tons, first_in_at, last_movement_at'),
    loadPlacements(),
  ])
  if (bRes.error) throw bRes.error
  if (tRes.error) throw tRes.error
  const totals = new Map((tRes.data ?? []).map((t: { batch_id: string } & Record<string, unknown>) => [t.batch_id, t]))
  const batches = ((bRes.data ?? []) as unknown as BatchRow[]).map((b) =>
    mapBatch(b, totals.get(b.id) as Parameters<typeof mapBatch>[1]),
  )
  return { batches, placements: pRes }
}

export async function loadStockBatch(id: string): Promise<{ batch: StockBatch; placements: BatchPlacement[] } | null> {
  const [bRes, tRes, pRes] = await Promise.all([
    db().from('stock_batches').select(BATCH_SELECT).eq('id', id).maybeSingle(),
    db().from('stock_batch_totals').select('batch_id, tons, reserved_tons, first_in_at, last_movement_at').eq('batch_id', id).maybeSingle(),
    loadPlacements({ batchId: id }),
  ])
  if (bRes.error) throw bRes.error
  if (tRes.error) throw tRes.error
  if (!bRes.data) return null
  return {
    batch: mapBatch(bRes.data as unknown as BatchRow, (tRes.data ?? undefined) as Parameters<typeof mapBatch>[1]),
    placements: pRes,
  }
}

/** Остатки по партиям в ячейках (только положительные). */
export async function loadPlacements(filter: { batchId?: string; locationId?: string } = {}): Promise<BatchPlacement[]> {
  let req = db()
    .from('stock_balances')
    .select('batch_id, cell_id, tons, storage_cells!inner ( name, storage_location_id, storage_locations ( name ) )')
    .gt('tons', 0)
  if (filter.batchId) req = req.eq('batch_id', filter.batchId)
  if (filter.locationId) req = req.eq('storage_cells.storage_location_id', filter.locationId)
  const { data, error } = await req
  if (error) throw error
  return ((data ?? []) as unknown as Array<{
    batch_id: string
    cell_id: string
    tons: number
    storage_cells: One<{ name: string; storage_location_id: string; storage_locations: One<{ name: string }> }>
  }>).map((r) => {
    const cell = one(r.storage_cells)
    return {
      batchId: r.batch_id,
      cellId: r.cell_id,
      cellName: cell?.name ?? '',
      locationId: cell?.storage_location_id ?? '',
      locationName: one(cell?.storage_locations)?.name ?? '',
      tons: Number(r.tons),
    }
  })
}

const DOCUMENT_SELECT = `id, doc_type, number, doc_date, status, consumption_target, vehicle_plate, driver_name,
  waybill_number, sdiz_number, act_number, price_per_ton, amount, weights, quality, comment, cancel_reason,
  cancels_document_id, created_at, created_by,
  counterparties ( name ), fields ( name, number ), stock_writeoff_reasons ( name ), stock_consumption_targets ( label ),
  stock_movements ( id, batch_id, cell_id, delta_tons,
    stock_batches ( code, crops ( label ) ),
    storage_cells ( name, storage_location_id, storage_locations ( name ) ) )`

type DocumentRow = {
  id: string
  doc_type: StockDocType
  number: string
  doc_date: string
  status: 'posted' | 'cancelled'
  consumption_target: string | null
  vehicle_plate: string | null
  driver_name: string | null
  waybill_number: string | null
  sdiz_number: string | null
  act_number: string | null
  price_per_ton: number | null
  amount: number | null
  weights: Record<string, unknown> | null
  quality: Record<string, unknown> | null
  comment: string | null
  cancel_reason: string | null
  cancels_document_id: string | null
  created_at: string
  created_by: string | null
  counterparties: One<{ name: string }>
  fields: One<{ name: string; number: string | null }>
  stock_writeoff_reasons: One<{ name: string }>
  stock_consumption_targets: One<{ label: string }>
  stock_movements: Array<{
    id: number
    batch_id: string
    cell_id: string
    delta_tons: number
    stock_batches: One<{ code: string; crops: One<{ label: string }> }>
    storage_cells: One<{ name: string; storage_location_id: string; storage_locations: One<{ name: string }> }>
  }>
}

function mapDocument(d: DocumentRow, people: Map<string, string>): StockDocument {
  const field = one(d.fields)
  return {
    id: d.id,
    doc_type: d.doc_type,
    number: d.number,
    doc_date: d.doc_date,
    status: d.status,
    counterpartyName: one(d.counterparties)?.name ?? null,
    fieldName: field ? fieldOptionLabel(field) : null,
    reasonName: one(d.stock_writeoff_reasons)?.name ?? null,
    consumption_target: d.consumption_target,
    consumptionTargetName: one(d.stock_consumption_targets)?.label ?? null,
    vehicle_plate: d.vehicle_plate,
    driver_name: d.driver_name,
    waybill_number: d.waybill_number,
    sdiz_number: d.sdiz_number,
    act_number: d.act_number,
    price_per_ton: d.price_per_ton == null ? null : Number(d.price_per_ton),
    amount: d.amount == null ? null : Number(d.amount),
    weights: d.weights ?? {},
    quality: d.quality ?? {},
    comment: d.comment,
    cancel_reason: d.cancel_reason,
    cancels_document_id: d.cancels_document_id,
    createdByName: d.created_by ? people.get(d.created_by) ?? null : null,
    created_at: d.created_at,
    movements: (d.stock_movements ?? [])
      .map((m) => {
        const batch = one(m.stock_batches)
        const cell = one(m.storage_cells)
        return {
          id: m.id,
          batch_id: m.batch_id,
          batchCode: batch?.code ?? '',
          cropLabel: one(batch?.crops)?.label ?? '',
          cell_id: m.cell_id,
          cellName: cell?.name ?? '',
          locationId: cell?.storage_location_id ?? '',
          locationName: one(cell?.storage_locations)?.name ?? '',
          delta_tons: Number(m.delta_tons),
        }
      })
      .sort((a, b) => a.id - b.id),
  }
}

async function loadPeople(ids: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  if (!uniq.length) return new Map()
  const { data, error } = await db().from('profiles').select('id, display_name, email').in('id', uniq)
  if (error) throw error
  return new Map(
    (data ?? []).map((p: { id: string; display_name: string | null; email: string }) => [p.id, p.display_name || p.email]),
  )
}

export type DocumentFilters = {
  types?: StockDocType[]
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

/** Журнал документов с движениями, новые сверху. */
export async function loadStockDocuments(filters: DocumentFilters = {}): Promise<{ rows: StockDocument[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.max(1, filters.pageSize ?? 20)
  let req = db()
    .from('stock_documents')
    .select(DOCUMENT_SELECT, { count: 'exact' })
    .order('doc_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)
  if (filters.types?.length) req = req.in('doc_type', filters.types)
  if (filters.from) req = req.gte('doc_date', filters.from)
  if (filters.to) req = req.lte('doc_date', filters.to)
  const { data, error, count } = await req
  if (error) throw error
  const rows = (data ?? []) as unknown as DocumentRow[]
  const people = await loadPeople(rows.map((r) => r.created_by ?? ''))
  return { rows: rows.map((r) => mapDocument(r, people)), total: count ?? rows.length }
}

/** Документы, затронувшие склад или партию (карточки). */
export async function loadStockDocumentsFor(filter: { locationId?: string; batchId?: string }): Promise<StockDocument[]> {
  let mReq = db().from('stock_movements').select('document_id, storage_cells!inner ( storage_location_id )')
  if (filter.batchId) mReq = mReq.eq('batch_id', filter.batchId)
  if (filter.locationId) mReq = mReq.eq('storage_cells.storage_location_id', filter.locationId)
  const { data: ids, error: idErr } = await mReq
  if (idErr) throw idErr
  const docIds = Array.from(new Set((ids ?? []).map((r: { document_id: string }) => r.document_id)))
  if (!docIds.length) return []
  const { data, error } = await db()
    .from('stock_documents')
    .select(DOCUMENT_SELECT)
    .in('id', docIds)
    .order('doc_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as unknown as DocumentRow[]
  const people = await loadPeople(rows.map((r) => r.created_by ?? ''))
  return rows.map((r) => mapDocument(r, people))
}

export async function loadCounterparties(kind?: 'buyer' | 'supplier'): Promise<Counterparty[]> {
  let req = db().from('counterparties').select('*').order('name')
  if (kind) req = req.in('kind', [kind, 'both'])
  const { data, error } = await req
  if (error) throw error
  return (data ?? []) as Counterparty[]
}

// ---------------------------------------------------------------------------
// Запись: справочники
// ---------------------------------------------------------------------------

export type CounterpartyInput = Omit<Counterparty, 'id' | 'active'> & { active?: boolean }

function cleanText(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s ? s : null
}

export async function saveCounterparty(id: string | null, input: CounterpartyInput): Promise<Counterparty> {
  const row = {
    name: input.name.trim(),
    kind: input.kind,
    inn: cleanText(input.inn),
    kpp: cleanText(input.kpp),
    address: cleanText(input.address),
    phone: cleanText(input.phone),
    email: cleanText(input.email),
    contact_person: cleanText(input.contact_person),
    comment: cleanText(input.comment),
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  }
  const q = id
    ? db().from('counterparties').update(row).eq('id', id).select('*').single()
    : db().from('counterparties').insert(row).select('*').single()
  const { data, error } = await q
  if (error) throw error
  return data as Counterparty
}

export async function deleteCounterparty(id: string): Promise<void> {
  const { error } = await db().from('counterparties').delete().eq('id', id)
  if (error) throw error
}

export type CellInput = { name: string; location_type_id: string | null; capacity_tons: number | null }

export async function saveStorageCell(id: string | null, locationId: string, input: CellInput): Promise<void> {
  const row = {
    name: input.name.trim(),
    location_type_id: input.location_type_id,
    capacity_tons: input.capacity_tons,
    updated_at: new Date().toISOString(),
  }
  const { error } = id
    ? await db().from('storage_cells').update(row).eq('id', id)
    : await db().from('storage_cells').insert({ ...row, storage_location_id: locationId })
  if (error) throw error
}

export async function deleteStorageCell(id: string): Promise<void> {
  const { error } = await db().from('storage_cells').delete().eq('id', id)
  if (error) throw error
}

export async function updateStockBatch(
  id: string,
  patch: Partial<Pick<StockBatch, 'variety' | 'harvest_year' | 'purpose' | 'quality' | 'fgis_batch_number' | 'comment'>>,
): Promise<void> {
  const { error } = await db()
    .from('stock_batches')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Запись: проведение документов — всё в базе, одной транзакцией
// ---------------------------------------------------------------------------

/** Общие поля шапки документа. Пустые строки уходят как null. */
export type DocumentHeader = {
  doc_date?: string
  counterparty_id?: string | null
  contract_id?: string | null
  field_id?: string | null
  writeoff_reason_id?: string | null
  consumption_target?: string | null
  vehicle_plate?: string | null
  driver_name?: string | null
  waybill_number?: string | null
  sdiz_number?: string | null
  act_number?: string | null
  price_per_ton?: number | null
  amount?: number | null
  vat_percent?: number | null
  weights?: Record<string, number | null>
  quality?: Record<string, number | string | null>
  comment?: string | null
}

function header(h: DocumentHeader): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(h)) {
    if (v == null) continue
    if (typeof v === 'string') {
      const s = v.trim()
      if (s) out[k] = s
    } else if (typeof v === 'object') {
      const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x != null && x !== ''))
      if (Object.keys(clean).length) out[k] = clean
    } else {
      out[k] = v
    }
  }
  return out
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args)
  if (error) throw error
  return data as T
}

export type NewBatchInput = {
  crop_key: string
  origin: 'field' | 'purchase'
  field_id?: string | null
  variety?: string | null
  harvest_year?: number | null
  purpose?: StockPurpose
  fgis_batch_number?: string | null
  comment?: string | null
}

export function postIntake(
  input: DocumentHeader & { cell_id: string; net_tons: number; batch_id?: string | null; batch?: NewBatchInput },
): Promise<{ document_id: string; batch_id: string }> {
  const { cell_id, net_tons, batch_id, batch, ...h } = input
  const p: Record<string, unknown> = { ...header(h), cell_id, net_tons }
  if (batch_id) p.batch_id = batch_id
  else if (batch) p.batch = header(batch as unknown as DocumentHeader)
  return rpc('stock_post_intake', { p })
}

export function postTransfer(
  input: DocumentHeader & { batch_id: string; from_cell_id: string; to_cell_id: string; tons: number; loss_tons?: number | null },
): Promise<{ document_id: string }> {
  const { batch_id, from_cell_id, to_cell_id, tons, loss_tons, ...h } = input
  return rpc('stock_post_transfer', {
    p: { ...header(h), batch_id, from_cell_id, to_cell_id, tons, ...(loss_tons ? { loss_tons } : {}) },
  })
}

export type OutgoingLine = { batch_id: string; cell_id: string; tons: number }

export function postOutgoing(
  type: StockOutgoingType,
  input: DocumentHeader & { lines: OutgoingLine[] },
): Promise<{ document_id: string; total_tons: number }> {
  const { lines, ...h } = input
  return rpc('stock_post_outgoing', { p_type: type, p: { ...header(h), lines } })
}

export function postProcessing(
  input: DocumentHeader & { batch_id: string; cell_id: string; tons_before: number; tons_after: number },
): Promise<{ document_id: string; loss_tons: number }> {
  const { batch_id, cell_id, tons_before, tons_after, ...h } = input
  return rpc('stock_post_processing', { p: { ...header(h), batch_id, cell_id, tons_before, tons_after } })
}

export function postInventory(
  input: DocumentHeader & { cell_id: string; lines: { batch_id: string; actual_tons: number }[] },
): Promise<{ document_id: string; adjusted_lines: number }> {
  const { cell_id, lines, ...h } = input
  return rpc('stock_post_inventory', { p: { ...header(h), cell_id, lines } })
}

export function cancelStockDocument(documentId: string, reason: string): Promise<{ storno_document_id: string }> {
  return rpc('stock_cancel_document', { p_document: documentId, p_reason: reason })
}
