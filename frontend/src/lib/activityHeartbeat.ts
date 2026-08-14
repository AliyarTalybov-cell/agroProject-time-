import { supabase, isSupabaseConfigured } from '@/lib/supabase'

/**
 * Редкое обновление last_activity_at в profiles через RPC (без сокетов и кронов).
 * Нагрузка: не чаще чем раз в MIN_INTERVAL_MS на пользователя (throttle в localStorage).
 */
const STORAGE_PREFIX = 'agri:last_activity_ms:'
/** Интервал между успешными пингами (и период фонового таймера) */
export const ACTIVITY_HEARTBEAT_MIN_MS = 5 * 60 * 1000

let intervalId: ReturnType<typeof setInterval> | null = null
let visibilityHandler: (() => void) | null = null
let focusHandler: (() => void) | null = null

function storageKey(userId: string): string {
  return STORAGE_PREFIX + userId
}

/**
 * Вызывает RPC, если с прошлого успешного вызова прошло достаточно времени.
 */
export async function pingLastActivityIfDue(userId: string): Promise<void> {
  if (!isSupabaseConfigured() || !supabase || !userId) return
  const now = Date.now()
  let last = 0
  try {
    last = Number.parseInt(localStorage.getItem(storageKey(userId)) || '0', 10) || 0
  } catch {
    /* ignore */
  }
  if (now - last < ACTIVITY_HEARTBEAT_MIN_MS) return

  const { error } = await supabase.rpc('touch_my_last_activity')
  if (error) {
    console.warn('touch_my_last_activity', error.message)
    return
  }
  try {
    localStorage.setItem(storageKey(userId), String(now))
  } catch {
    /* ignore */
  }
}

/**
 * Запуск фонового пинга и пинг при возврате на вкладку / фокусе окна.
 */
export function startActivityHeartbeat(userId: string): void {
  stopActivityHeartbeat()
  if (!userId) return

  const tick = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    void pingLastActivityIfDue(userId)
  }

  void pingLastActivityIfDue(userId)
  intervalId = setInterval(tick, ACTIVITY_HEARTBEAT_MIN_MS)

  visibilityHandler = () => {
    if (document.visibilityState === 'visible') void pingLastActivityIfDue(userId)
  }
  focusHandler = () => void pingLastActivityIfDue(userId)

  document.addEventListener('visibilitychange', visibilityHandler)
  window.addEventListener('focus', focusHandler)
}

export function stopActivityHeartbeat(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
  if (focusHandler) {
    window.removeEventListener('focus', focusHandler)
    focusHandler = null
  }
}
