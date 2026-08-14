import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { StoredDowntime } from '@/lib/downtimeStorage'
import type { StoredOperation } from '@/lib/operationStorage'

// Если в БД/Schema cache ещё нет колонки `equipment_fuel_left_percent`,
// то запросы с ней будут падать (PGRST204 / 42703) и портить UI.
// После первого обнаружения помечаем как "отсутствует" и перестаём её запрашивать.
let fuelLeftColumnAvailable: boolean | null = null

export type DowntimeRow = {
  id: number
  user_id: string | null
  employee: string
  reason: string
  category: string
  start_iso: string
  end_iso: string
  duration_minutes: number
  field_id: string | null
  field_name: string | null
  operation: string | null
  notes: string | null
}

export type OperationRow = {
  id: number
  user_id: string | null
  employee: string
  field_id: string | null
  field_name: string | null
  operation: string | null
  start_iso: string
  end_iso: string
  duration_minutes: number
  notes: string | null
  equipment_id?: string | null
  equipment_fuel_percent?: number | null
  equipment_fuel_left_percent?: number | null
  equipment_condition_value?: number | null
  equipment_condition_label?: string | null
  equipment_repair_notes?: string | null
  planned_hectares?: number | null
  processed_hectares?: number | null
}

export type EquipmentOperationHistoryRow = {
  id: number
  employee: string
  operation: string | null
  startISO: string
  endISO: string
  durationMinutes: number
  notes?: string | null
  equipmentId?: string | null
  equipmentFuelPercent?: number | null
  equipmentFuelLeftPercent?: number | null
  equipmentConditionValue?: number | null
  equipmentConditionLabel?: string | null
  equipmentRepairNotes?: string | null
  fieldName?: string | null
  plannedHectares?: number | null
  processedHectares?: number | null
}

export type EquipmentOperationHistoryPage = {
  rows: EquipmentOperationHistoryRow[]
  total: number
}

export type FieldOperationHistoryRow = {
  id: number
  employee: string
  operation: string | null
  startISO: string
  endISO: string
  durationMinutes: number
  notes?: string | null
  equipmentId?: string | null
  equipmentLabel?: string | null
  plannedHectares?: number | null
  processedHectares?: number | null
}

export type FieldOperationHistoryPage = {
  rows: FieldOperationHistoryRow[]
  total: number
}

function isMissingColumnError(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  const code = e?.code
  const message = (e?.message ?? '').toLowerCase()

  // 42703: postgres undefined_column
  if (code === '42703') return true

  // PGRST204: postgrest schema cache missing column (как у тебя)
  if (code === 'PGRST204') return true

  if (/column .* does not exist/i.test(e?.message ?? '')) return true
  if (message.includes('could not find') && message.includes('column')) return true

  return false
}

function isFuelLeftColumnMissingError(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  const msg = (e?.message ?? '').toLowerCase()
  if (!isMissingColumnError(err)) return false
  return msg.includes('equipment_fuel_left_percent')
}

function rowToDowntime(r: DowntimeRow): StoredDowntime {
  return {
    id: r.id,
    employee: r.employee,
    reason: r.reason,
    category: r.category as StoredDowntime['category'],
    startISO: r.start_iso,
    endISO: r.end_iso,
    durationMinutes: r.duration_minutes,
    fieldId: r.field_id ?? undefined,
    fieldName: r.field_name ?? undefined,
    operation: r.operation ?? undefined,
    notes: r.notes ?? undefined,
  }
}

function rowToOperation(r: OperationRow): StoredOperation {
  return {
    id: r.id,
    employee: r.employee,
    fieldId: r.field_id ?? undefined,
    fieldName: r.field_name ?? undefined,
    operation: r.operation ?? undefined,
    startISO: r.start_iso,
    endISO: r.end_iso,
    durationMinutes: r.duration_minutes,
    notes: r.notes ?? undefined,
    equipmentId: r.equipment_id ?? undefined,
    equipmentFuelPercent: r.equipment_fuel_percent ?? undefined,
    equipmentFuelLeftPercent: r.equipment_fuel_left_percent ?? undefined,
    equipmentConditionValue: r.equipment_condition_value ?? undefined,
    equipmentConditionLabel: r.equipment_condition_label ?? undefined,
    equipmentRepairNotes: r.equipment_repair_notes ?? undefined,
    plannedHectares: r.planned_hectares ?? undefined,
    processedHectares: r.processed_hectares ?? undefined,
  }
}

export async function insertDowntime(
  event: StoredDowntime,
  userId: string | null,
): Promise<void> {
  if (!supabase) return
  await supabase.from('downtimes').insert({
    user_id: userId,
    employee: event.employee,
    reason: event.reason,
    category: event.category,
    start_iso: event.startISO,
    end_iso: event.endISO,
    duration_minutes: event.durationMinutes,
    field_id: event.fieldId ?? null,
    field_name: event.fieldName ?? null,
    operation: event.operation ?? null,
    notes: event.notes?.trim() || null,
  })
}

export async function insertOperation(
  op: StoredOperation,
  userId: string | null,
): Promise<void> {
  if (!supabase) return
  const basePayload = {
    user_id: userId,
    employee: op.employee,
    field_id: op.fieldId ?? null,
    field_name: op.fieldName ?? null,
    operation: op.operation ?? null,
    start_iso: op.startISO,
    end_iso: op.endISO,
    duration_minutes: op.durationMinutes,
    notes: op.notes?.trim() || null,
  }

  const payloadWithEquipment = {
    ...basePayload,
    equipment_id: op.equipmentId ?? null,
    equipment_fuel_percent: op.equipmentFuelPercent ?? null,
    equipment_condition_value: op.equipmentConditionValue ?? null,
    equipment_condition_label: op.equipmentConditionLabel ?? null,
    equipment_repair_notes: op.equipmentRepairNotes?.trim() || null,
    planned_hectares: op.plannedHectares ?? null,
    processed_hectares: op.processedHectares ?? null,
  }

  const payloadWithFuelLeft = {
    ...payloadWithEquipment,
    equipment_fuel_left_percent: op.equipmentFuelLeftPercent ?? null,
  }

  try {
    if (fuelLeftColumnAvailable === false) {
      await supabase.from('operations').insert(payloadWithEquipment)
      return
    }
    await supabase.from('operations').insert(payloadWithFuelLeft)
  } catch (e: unknown) {
    console.error('insertOperation: payloadWithFuelLeft failed', e, payloadWithFuelLeft)
    if (isFuelLeftColumnMissingError(e)) fuelLeftColumnAvailable = false
    if (!isMissingColumnError(e)) throw e
    // Если не существует только `equipment_fuel_left_percent`, всё равно сохраним привязку к технике и старые equipment-поля.
    try {
      await supabase.from('operations').insert(payloadWithEquipment)
    } catch (e2: unknown) {
      console.error('insertOperation: payloadWithEquipment fallback failed', e2, payloadWithEquipment)
      if (isFuelLeftColumnMissingError(e2)) fuelLeftColumnAvailable = false
      if (!isMissingColumnError(e2)) throw e2
      // Если БД ещё не содержит вообще колонок под технику — пишем только базовые поля.
      try {
        await supabase.from('operations').insert(basePayload)
      } catch (e3: unknown) {
        console.error('insertOperation: basePayload fallback failed', e3, basePayload)
        throw e3
      }
    }
  }
}

export async function loadDowntimesFromSupabase(
  onlyCurrentUser: boolean,
  userId: string | null,
): Promise<StoredDowntime[]> {
  if (!supabase) return []
  let q = supabase
    .from('downtimes')
    .select('id, user_id, employee, reason, category, start_iso, end_iso, duration_minutes, field_id, field_name, operation, notes')
    .order('start_iso', { ascending: false })
  if (onlyCurrentUser && userId) {
    q = q.eq('user_id', userId)
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((r) => rowToDowntime(r as DowntimeRow))
}

export async function loadOperationsFromSupabase(
  onlyCurrentUser: boolean,
  userId: string | null,
): Promise<StoredOperation[]> {
  if (!supabase) return []
  const sb = supabase
  const baseSelect = 'id, user_id, employee, field_id, field_name, operation, start_iso, end_iso, duration_minutes, notes'
  const equipmentSelect = 'equipment_id, equipment_fuel_percent, equipment_condition_value, equipment_condition_label, equipment_repair_notes, planned_hectares, processed_hectares'
  const equipmentFuelLeftSelect = 'equipment_fuel_left_percent'

  const attempt = async (select: string): Promise<StoredOperation[]> => {
    let q = sb
      .from('operations')
      .select(select)
      .order('start_iso', { ascending: false })
    if (onlyCurrentUser && userId) q = q.eq('user_id', userId)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []).map((r) => rowToOperation(r as unknown as OperationRow))
  }

  try {
    if (fuelLeftColumnAvailable === false) {
      return await attempt(`${baseSelect}, ${equipmentSelect}`)
    }
    return await attempt(`${baseSelect}, ${equipmentSelect}, ${equipmentFuelLeftSelect}`)
  } catch (e: unknown) {
    if (!isMissingColumnError(e)) throw e
    if (isFuelLeftColumnMissingError(e)) fuelLeftColumnAvailable = false
    // Сначала пробуем без `equipment_fuel_left_percent`, но с остальными equipment-полями.
    try {
      return await attempt(`${baseSelect}, ${equipmentSelect}`)
    } catch (e2: unknown) {
      if (!isMissingColumnError(e2)) throw e2
      if (isFuelLeftColumnMissingError(e2)) fuelLeftColumnAvailable = false
      // Последний fallback: без equipment-колонок.
      return attempt(baseSelect)
    }
  }
}

/** Строка сводки по одному сотруднику (ответ RPC). */
export type OperationEmployeeStatSummaryRow = {
  employee: string
  operation_count: number
  distinct_fields: number
  total_duration_minutes: number
  latest_end_iso: string
  total_groups: number
}

/** Постраничная сводка операций по сотрудникам за интервал [end_from, end_to] по дате окончания. */
export async function fetchOperationEmployeeStatsPage(params: {
  endFromIso: string
  endToIso: string
  onlyMine: boolean
  userId: string | null
  employeeFilter: string | null
  sort: 'employee' | 'operation' | 'field' | 'duration' | 'ended'
  desc: boolean
  page: number
  pageSize: number
}): Promise<{ rows: OperationEmployeeStatSummaryRow[]; total: number }> {
  if (!supabase) return { rows: [], total: 0 }
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize)))
  const page = Math.max(1, Math.floor(params.page))
  const offset = (page - 1) * pageSize

  const { data, error } = await supabase.rpc('operation_stats_employees_page', {
    p_end_from: params.endFromIso,
    p_end_to: params.endToIso,
    p_only_mine: params.onlyMine,
    p_user_id: params.onlyMine ? params.userId : null,
    p_employee_filter: params.employeeFilter?.trim() || null,
    p_sort: params.sort,
    p_desc: params.desc,
    p_limit: pageSize,
    p_offset: offset,
  })

  if (error) {
    console.warn('operation_stats_employees_page', error.message ?? error)
    return { rows: [], total: 0 }
  }

  type RpcRow = {
    employee: string
    operation_count: number | string
    distinct_fields: number | string
    total_duration_minutes: number | string
    latest_end_iso: string
    total_groups: number | string
  }

  const raw = (data ?? []) as RpcRow[]
  const rows: OperationEmployeeStatSummaryRow[] = raw.map((r) => ({
    employee: r.employee,
    operation_count: Number(r.operation_count),
    distinct_fields: Number(r.distinct_fields),
    total_duration_minutes: Number(r.total_duration_minutes),
    latest_end_iso: r.latest_end_iso,
    total_groups: Number(r.total_groups),
  }))
  const total = rows.length > 0 ? rows[0]!.total_groups : 0
  return { rows, total }
}

export type EmployeeOperationsPageResult = {
  rows: StoredOperation[]
  total: number
}

/** Детальные операции одного сотрудника за период (по дате окончания), с пагинацией. */
export async function loadOperationsForEmployeeInDateRange(
  employeeExact: string,
  endFromIso: string,
  endToIso: string,
  onlyCurrentUser: boolean,
  userId: string | null,
  options?: { limit?: number; offset?: number },
): Promise<EmployeeOperationsPageResult> {
  if (!supabase) return { rows: [], total: 0 }
  const sb = supabase
  const baseSelect =
    'id, user_id, employee, field_id, field_name, operation, start_iso, end_iso, duration_minutes, notes'
  const equipmentSelect =
    'equipment_id, equipment_fuel_percent, equipment_condition_value, equipment_condition_label, equipment_repair_notes, planned_hectares, processed_hectares'
  const equipmentFuelLeftSelect = 'equipment_fuel_left_percent'

  const limit = Math.min(100, Math.max(1, Math.floor(options?.limit ?? 10)))
  const offset = Math.max(0, Math.floor(options?.offset ?? 0))
  const rangeTo = offset + limit - 1

  const attempt = async (select: string): Promise<EmployeeOperationsPageResult> => {
    let q = sb
      .from('operations')
      .select(select, { count: 'exact' })
      .eq('employee', employeeExact)
      .gte('end_iso', endFromIso)
      .lte('end_iso', endToIso)
      .order('end_iso', { ascending: false })
      .range(offset, rangeTo)
    if (onlyCurrentUser && userId) q = q.eq('user_id', userId)
    const { data, error, count } = await q
    if (error) throw error
    const rows = (data ?? []).map((r) => rowToOperation(r as unknown as OperationRow))
    return { rows, total: count ?? rows.length }
  }

  try {
    if (fuelLeftColumnAvailable === false) {
      return await attempt(`${baseSelect}, ${equipmentSelect}`)
    }
    return await attempt(`${baseSelect}, ${equipmentSelect}, ${equipmentFuelLeftSelect}`)
  } catch (e: unknown) {
    if (!isMissingColumnError(e)) throw e
    if (isFuelLeftColumnMissingError(e)) fuelLeftColumnAvailable = false
    try {
      return await attempt(`${baseSelect}, ${equipmentSelect}`)
    } catch (e2: unknown) {
      if (!isMissingColumnError(e2)) throw e2
      if (isFuelLeftColumnMissingError(e2)) fuelLeftColumnAvailable = false
      return attempt(baseSelect)
    }
  }
}

export async function loadOperationsByEquipmentFromSupabase(
  equipmentId: string,
  onlyCurrentUser: boolean,
  userId: string | null,
  page = 1,
  pageSize = 5,
): Promise<EquipmentOperationHistoryPage> {
  if (!supabase) return { rows: [], total: 0 }

  const sb = supabase
  const baseSelect = 'id, user_id, employee, field_name, operation, start_iso, end_iso, duration_minutes, notes'
  const equipmentSelect = 'equipment_id, equipment_fuel_percent, equipment_condition_value, equipment_condition_label, equipment_repair_notes, planned_hectares, processed_hectares'
  const equipmentFuelLeftSelect = 'equipment_fuel_left_percent'
  const safePage = Math.max(1, Math.floor(page))
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  const attempt = async (select: string): Promise<EquipmentOperationHistoryPage> => {
    let q = sb
      .from('operations')
      .select(select, { count: 'exact' })
      .eq('equipment_id', equipmentId)
      .order('start_iso', { ascending: false })
      .range(from, to)

    if (onlyCurrentUser && userId) q = q.eq('user_id', userId)

    const { data, count, error } = await q
    if (error) throw error

    const rows = (data ?? []).map((r: any) => ({
      id: r.id as number,
      employee: r.employee as string,
      operation: (r.operation ?? null) as string | null,
      startISO: r.start_iso as string,
      endISO: r.end_iso as string,
      durationMinutes: r.duration_minutes as number,
      notes: r.notes ?? undefined,
      equipmentId: r.equipment_id ?? undefined,
      equipmentFuelPercent: r.equipment_fuel_percent ?? undefined,
      equipmentFuelLeftPercent: r.equipment_fuel_left_percent ?? undefined,
      equipmentConditionValue: r.equipment_condition_value ?? undefined,
      equipmentConditionLabel: r.equipment_condition_label ?? undefined,
      equipmentRepairNotes: r.equipment_repair_notes ?? undefined,
      fieldName: r.field_name ?? undefined,
      plannedHectares: r.planned_hectares ?? undefined,
      processedHectares: r.processed_hectares ?? undefined,
    }))
    return { rows, total: Number(count ?? 0) }
  }

  try {
    if (fuelLeftColumnAvailable === false) {
      return await attempt(`${baseSelect}, ${equipmentSelect}`)
    }
    return await attempt(`${baseSelect}, ${equipmentSelect}, ${equipmentFuelLeftSelect}`)
  } catch (e: unknown) {
    if (!isMissingColumnError(e)) throw e
    if (isFuelLeftColumnMissingError(e)) fuelLeftColumnAvailable = false
    try {
      // Сначала без `equipment_fuel_left_percent`, но с остальными equipment-полями.
      return await attempt(`${baseSelect}, ${equipmentSelect}`)
    } catch (e2: unknown) {
      if (!isMissingColumnError(e2)) throw e2
      if (isFuelLeftColumnMissingError(e2)) fuelLeftColumnAvailable = false
      return attempt(baseSelect)
    }
  }
}

export async function loadOperationsByFieldFromSupabase(
  fieldId: string,
  onlyCurrentUser: boolean,
  userId: string | null,
  page = 1,
  pageSize = 5,
): Promise<FieldOperationHistoryPage> {
  if (!supabase) return { rows: [], total: 0 }

  const sb = supabase
  const baseSelectWithHectares =
    'id, user_id, employee, operation, start_iso, end_iso, duration_minutes, notes, equipment_id, planned_hectares, processed_hectares'
  const baseSelectLegacy = 'id, user_id, employee, operation, start_iso, end_iso, duration_minutes, notes, equipment_id'
  const equipmentJoin = 'equipment:equipment_id(id, brand, model, license_plate)'
  const safePage = Math.max(1, Math.floor(page))
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  const runSelect = async (baseSelect: string): Promise<FieldOperationHistoryPage> => {
    let q = sb
      .from('operations')
      .select(`${baseSelect}, ${equipmentJoin}`, { count: 'exact' })
      .eq('field_id', fieldId)
      .order('start_iso', { ascending: false })
      .range(from, to)

    if (onlyCurrentUser && userId) q = q.eq('user_id', userId)

    const { data, count, error } = await q
    if (error) throw error

    const rows = (data ?? []).map((r: any) => {
      const eq = r.equipment as { brand?: string | null; model?: string | null; license_plate?: string | null } | null
      const equipmentLabel =
        eq && (eq.brand || eq.model || eq.license_plate)
          ? [eq.brand, eq.model, eq.license_plate].filter(Boolean).join(' • ')
          : null
      return {
        id: r.id as number,
        employee: r.employee as string,
        operation: (r.operation ?? null) as string | null,
        startISO: r.start_iso as string,
        endISO: r.end_iso as string,
        durationMinutes: r.duration_minutes as number,
        notes: (r.notes ?? null) as string | null,
        equipmentId: (r.equipment_id ?? null) as string | null,
        plannedHectares: (r.planned_hectares ?? null) as number | null,
        processedHectares: (r.processed_hectares ?? null) as number | null,
        equipmentLabel,
      }
    })
    return { rows, total: Number(count ?? 0) }
  }

  try {
    return await runSelect(baseSelectWithHectares)
  } catch (e: unknown) {
    if (!isMissingColumnError(e)) throw e
    // Если миграция с planned/processed_hectares ещё не применена — показываем историю в legacy-режиме.
    return runSelect(baseSelectLegacy)
  }
}

export { isSupabaseConfigured }
