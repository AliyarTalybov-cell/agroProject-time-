export type DowntimeCategory = 'breakdown' | 'rain' | 'fuel' | 'waiting'

export type StoredDowntime = {
  id: number
  employee: string
  /** Кто отметил (только в копии браузера; в базе — user_id). */
  userId?: string | null
  /** Запись уже в базе. undefined — запись из старой версии, проверяется при синхронизации. */
  synced?: boolean
  reason: string
  category: DowntimeCategory
  startISO: string
  endISO: string
  durationMinutes: number
  fieldId?: string
  fieldName?: string
  operation?: string
  notes?: string
}

export type ActiveDowntime = {
  id: number
  employee: string
  reason: string
  category: DowntimeCategory
  startISO: string
  fieldId?: string
  fieldName?: string
  operation?: string
}

const EVENTS_KEY = 'agro_ctrl:downtimes'
const ACTIVE_KEY = 'agro_ctrl:downtime_active'

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function loadEvents(): StoredDowntime[] {
  if (!isBrowser()) return []
  const raw = window.localStorage.getItem(EVENTS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as StoredDowntime[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Повреждённый localStorage: считаем, что записей нет. Сообщать не о чем —
    // данные пользователь не терял, они и не сохранились.
    return []
  }
}

export function saveEvents(events: StoredDowntime[]) {
  if (!isBrowser()) return
  window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events))
}

export function loadActive(): ActiveDowntime | null {
  if (!isBrowser()) return null
  const raw = window.localStorage.getItem(ACTIVE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ActiveDowntime
    return parsed && parsed.startISO ? parsed : null
  } catch {
    // То же самое: испорченная запись равнозначна её отсутствию.
    return null
  }
}

export function saveActive(active: ActiveDowntime | null) {
  if (!isBrowser()) return
  if (!active) {
    window.localStorage.removeItem(ACTIVE_KEY)
    return
  }
  window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(active))
}

export function appendEvent(event: StoredDowntime) {
  const existing = loadEvents()
  existing.push(event)
  saveEvents(pruneSynced(existing))
}

/** Отметить простои отправленными в базу. */
export function markDowntimesSynced(ids: number[]) {
  if (!ids.length) return
  const set = new Set(ids)
  saveEvents(pruneSynced(loadEvents().map((d) => (set.has(d.id) ? { ...d, synced: true } : d))))
}

/** Отправленные держим недолго: источник истины — база. Неотправленные не трогаем. */
function pruneSynced<T extends { synced?: boolean }>(list: T[], keep = 30): T[] {
  const synced = list.filter((x) => x.synced === true)
  if (synced.length <= keep) return list
  const drop = new Set(synced.slice(0, synced.length - keep))
  return list.filter((x) => !drop.has(x))
}

