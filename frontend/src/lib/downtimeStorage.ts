export type DowntimeCategory = 'breakdown' | 'rain' | 'fuel' | 'waiting'

export type StoredDowntime = {
  id: number
  employee: string
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
  saveEvents(existing)
}

