export type StoredOperation = {
  id: number
  employee: string
  /** Кто отметил (только в копии браузера; в базе — user_id). */
  userId?: string | null
  /** Запись уже в базе. undefined — запись из старой версии, проверяется при синхронизации. */
  synced?: boolean
  taskId?: string | null
  taskTitle?: string | null
  taskNumber?: number | null
  fieldId?: string
  fieldName?: string
  operation?: string
  startISO: string
  endISO: string
  durationMinutes: number
  notes?: string
  equipmentId?: string | null
  equipmentFuelPercent?: number | null
  equipmentFuelLeftPercent?: number | null
  equipmentConditionValue?: number | null
  equipmentConditionLabel?: string | null
  equipmentRepairNotes?: string | null
  plannedHectares?: number | null
  processedHectares?: number | null
}

export type ActiveOperation = {
  startISO: string
  pausedAt?: string | null
  accumulatedPauseSeconds?: number
  taskId?: string | null
  taskTitle?: string | null
  taskNumber?: number | null
  operatorNote?: string | null
  fieldId?: string
  fieldName?: string
  operation?: string
  employee: string
  equipmentId?: string | null
  equipmentFuelPercent?: number | null
  equipmentFuelLeftPercent?: number | null
  equipmentConditionValue?: number | null
  equipmentConditionLabel?: string | null
  equipmentRepairNotes?: string | null
  plannedHectares?: number | null
  processedHectares?: number | null
}

const OPERATIONS_KEY = 'agro_ctrl:operations'
const ACTIVE_OPERATION_KEY = 'agro_ctrl:active_operation'

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function loadOperations(): StoredOperation[] {
  if (!isBrowser()) return []
  const raw = window.localStorage.getItem(OPERATIONS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as StoredOperation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Повреждённый localStorage равнозначен пустому списку операций.
    return []
  }
}

export function saveOperations(operations: StoredOperation[]) {
  if (!isBrowser()) return
  window.localStorage.setItem(OPERATIONS_KEY, JSON.stringify(operations))
}

export function appendOperation(event: StoredOperation) {
  const existing = loadOperations()
  existing.push(event)
  saveOperations(pruneSynced(existing))
}

/** Отметить операции отправленными в базу. */
export function markOperationsSynced(ids: number[]) {
  if (!ids.length) return
  const set = new Set(ids)
  saveOperations(pruneSynced(loadOperations().map((o) => (set.has(o.id) ? { ...o, synced: true } : o))))
}

/** Отправленные держим недолго: источник истины — база. Неотправленные не трогаем. */
function pruneSynced<T extends { synced?: boolean }>(list: T[], keep = 30): T[] {
  const synced = list.filter((x) => x.synced === true)
  if (synced.length <= keep) return list
  const drop = new Set(synced.slice(0, synced.length - keep))
  return list.filter((x) => !drop.has(x))
}

export function loadActiveOperation(): ActiveOperation | null {
  if (!isBrowser()) return null
  const raw = window.localStorage.getItem(ACTIVE_OPERATION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ActiveOperation
    return parsed?.startISO ? parsed : null
  } catch {
    // Испорченная запись об активной операции равнозначна её отсутствию.
    return null
  }
}

export function saveActiveOperation(active: ActiveOperation | null) {
  if (!isBrowser()) return
  if (!active) {
    window.localStorage.removeItem(ACTIVE_OPERATION_KEY)
    return
  }
  window.localStorage.setItem(ACTIVE_OPERATION_KEY, JSON.stringify(active))
}
