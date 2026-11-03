/**
 * История работ по полю или единице техники — общий источник для блока
 * «История взаимодействия» на карточках поля и техники.
 *
 * Строки — таблица operations (их пишет «Экран оператора»). Страница строк
 * грузится с сервера постранично; сводка и списки для фильтров — отдельным
 * лёгким запросом по всем строкам объекта (операций на одно поле —
 * десятки-сотни, это дёшево).
 */
import { supabase } from '@/lib/supabase'

export type OperationHistoryScope = 'field' | 'equipment'

export type OperationHistoryRow = {
  id: number
  userId: string | null
  employee: string
  operation: string | null
  startISO: string
  endISO: string
  durationMinutes: number
  notes: string | null
  fieldId: string | null
  fieldName: string | null
  equipmentId: string | null
  equipmentLabel: string | null
  fuelStart: number | null
  fuelLeft: number | null
  conditionLabel: string | null
  repairNotes: string | null
  processedHectares: number | null
}

export type OperationHistoryFilter = {
  /** Только операции этого пользователя (не руководителю — свои). */
  userId?: string | null
  operation?: string | null
}

export type OperationHistorySummary = {
  count: number
  minutes: number
  hectares: number
  lastISO: string | null
  operations: string[]
  employees: { userId: string; employee: string }[]
}

const scopeColumn = (scope: OperationHistoryScope) => (scope === 'field' ? 'field_id' : 'equipment_id')

function applyFilter<Q extends { eq: (c: string, v: string) => Q }>(q: Q, f: OperationHistoryFilter): Q {
  let out = q
  if (f.userId) out = out.eq('user_id', f.userId)
  if (f.operation) out = out.eq('operation', f.operation)
  return out
}

const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

export async function loadOperationHistoryPage(
  scope: OperationHistoryScope,
  id: string,
  filter: OperationHistoryFilter,
  page: number,
  pageSize: number,
): Promise<{ rows: OperationHistoryRow[]; total: number }> {
  if (!supabase) return { rows: [], total: 0 }
  const from = (Math.max(1, page) - 1) * pageSize
  const select =
    'id, user_id, employee, operation, start_iso, end_iso, duration_minutes, notes, field_id, field_name, equipment_id, ' +
    'equipment_fuel_percent, equipment_fuel_left_percent, equipment_condition_label, equipment_repair_notes, processed_hectares, ' +
    'equipment:equipment_id(brand, model, license_plate)'
  const q = applyFilter(
    supabase.from('operations').select(select, { count: 'exact' }).eq(scopeColumn(scope), id),
    filter,
  )
  const { data, count, error } = await q.order('start_iso', { ascending: false }).range(from, from + pageSize - 1)
  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []).map((r: any): OperationHistoryRow => {
    const eq = r.equipment as { brand?: string | null; model?: string | null; license_plate?: string | null } | null
    const eqLabel = eq ? [eq.brand, eq.model].filter(Boolean).join(' ') + (eq.license_plate ? ` · ${eq.license_plate}` : '') : ''
    return {
      id: r.id,
      userId: r.user_id ?? null,
      employee: r.employee ?? '',
      operation: r.operation ?? null,
      startISO: r.start_iso,
      endISO: r.end_iso,
      durationMinutes: Number(r.duration_minutes ?? 0),
      notes: r.notes?.trim() || null,
      fieldId: r.field_id ?? null,
      fieldName: r.field_name ?? null,
      equipmentId: r.equipment_id ?? null,
      equipmentLabel: eqLabel.trim() || null,
      fuelStart: num(r.equipment_fuel_percent),
      fuelLeft: num(r.equipment_fuel_left_percent),
      conditionLabel: r.equipment_condition_label?.trim() || null,
      repairNotes: r.equipment_repair_notes?.trim() || null,
      processedHectares: num(r.processed_hectares),
    }
  })
  return { rows, total: Number(count ?? 0) }
}

export async function loadOperationHistorySummary(
  scope: OperationHistoryScope,
  id: string,
  filter: OperationHistoryFilter,
): Promise<OperationHistorySummary> {
  const empty: OperationHistorySummary = { count: 0, minutes: 0, hectares: 0, lastISO: null, operations: [], employees: [] }
  if (!supabase) return empty
  const base = supabase
    .from('operations')
    .select('user_id, employee, operation, start_iso, duration_minutes, processed_hectares')
    .eq(scopeColumn(scope), id)
  const { data, error } = await (filter.userId ? base.eq('user_id', filter.userId) : base)
    .order('start_iso', { ascending: false })
    .limit(5000)
  if (error) throw error
  const rows = data ?? []
  const ops = new Set<string>()
  const people = new Map<string, string>()
  let minutes = 0
  let hectares = 0
  let count = 0
  let lastISO: string | null = null
  for (const r of rows) {
    if (r.operation) ops.add(r.operation)
    if (r.user_id && !people.has(r.user_id)) people.set(r.user_id, r.employee ?? '')
    // Сводка — по тем же строкам, что и таблица под ней.
    if (filter.operation && r.operation !== filter.operation) continue
    count += 1
    minutes += Number(r.duration_minutes ?? 0)
    hectares += Number(r.processed_hectares ?? 0) || 0
    lastISO ??= r.start_iso
  }
  return {
    count,
    minutes,
    hectares,
    lastISO,
    operations: [...ops].sort((a, b) => a.localeCompare(b, 'ru')),
    employees: [...people].map(([userId, employee]) => ({ userId, employee })),
  }
}

/** «45 мин», «2 ч», «3 ч 05 мин». */
export function formatDurationMinutes(total: number): string {
  const m = Math.max(0, Math.round(total))
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} ч ${String(rest).padStart(2, '0')} мин` : `${h} ч`
}

const haFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
export const formatHectares = (v: number) => haFormat.format(v)
