/**
 * Журнал смены: источник истины — таблицы operations и downtimes. Браузер хранит
 * только то, что ещё не удалось отправить (нет связи в поле и т. п.), и досылает
 * это при открытии экрана оператора и при появлении сети.
 */
import { supabase } from '@/lib/supabase'
import { insertDowntime, insertOperation } from '@/lib/analyticsSupabase'
import { loadOperations, markOperationsSynced, type StoredOperation } from '@/lib/operationStorage'
import { loadEvents, markDowntimesSynced, type StoredDowntime } from '@/lib/downtimeStorage'

/** Записи старой версии без отметки «отправлено» проверяем только за этот срок. */
const LEGACY_WINDOW_MS = 14 * 24 * 3600_000

type Local = StoredOperation | StoredDowntime

/** Чья запись: новая — по userId, старая (без него) — по имени в журнале. */
function isMine(x: Local, userId: string, employee: string): boolean {
  return x.userId ? x.userId === userId : x.employee === employee
}

/** Неотправленные записи текущего пользователя. */
export function pendingOperations(userId: string, employee: string): StoredOperation[] {
  return loadOperations().filter((o) => o.synced !== true && isMine(o, userId, employee))
}

export function pendingDowntimes(userId: string, employee: string): StoredDowntime[] {
  return loadEvents().filter((d) => d.synced !== true && isMine(d, userId, employee))
}

/** Начала записей, которые уже лежат в базе (для старых записей без отметки). */
async function startsInDb(table: 'operations' | 'downtimes', userId: string, fromIso: string): Promise<Set<number> | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from(table).select('start_iso').eq('user_id', userId).gte('start_iso', fromIso)
  if (error) return null
  return new Set((data ?? []).map((r: { start_iso: string }) => new Date(r.start_iso).getTime()))
}

async function syncList<T extends Local>(
  table: 'operations' | 'downtimes',
  list: T[],
  userId: string,
  send: (x: T) => Promise<void>,
  mark: (ids: number[]) => void,
): Promise<{ sent: number; failed: number }> {
  const now = Date.now()
  // Старые записи: если такая уже есть в базе — просто отмечаем; слишком старые не трогаем.
  const legacy = list.filter((x) => x.synced === undefined)
  let candidates = list.filter((x) => x.synced === false)
  if (legacy.length) {
    const recent = legacy.filter((x) => now - new Date(x.startISO).getTime() < LEGACY_WINDOW_MS)
    const minStart = recent.reduce((m, x) => Math.min(m, new Date(x.startISO).getTime()), now)
    const inDb = recent.length ? await startsInDb(table, userId, new Date(minStart - 1000).toISOString()) : new Set<number>()
    if (!inDb) return { sent: 0, failed: list.length } // база недоступна — попробуем позже
    const already = legacy.filter((x) => !recent.includes(x) || inDb.has(new Date(x.startISO).getTime()))
    mark(already.map((x) => x.id))
    candidates = candidates.concat(recent.filter((x) => !inDb.has(new Date(x.startISO).getTime())))
  }

  let sent = 0
  let failed = 0
  for (const x of candidates) {
    try {
      await send(x)
      mark([x.id])
      sent++
    } catch (e) {
      console.warn(`shiftSync: ${table} не отправлено`, e)
      failed++
      break // скорее всего, нет связи — остальное дошлём в следующий раз
    }
  }
  return { sent, failed: failed ? candidates.length - sent : 0 }
}

let running: Promise<{ sent: number; failed: number }> | null = null

/** Дослать неотправленные операции и простои. Параллельные вызовы ждут один прогон. */
export function syncPendingShift(userId: string, employee: string): Promise<{ sent: number; failed: number }> {
  if (running) return running
  running = (async () => {
    const ops = await syncList('operations', pendingOperations(userId, employee), userId, (o) => insertOperation(o, userId), markOperationsSynced)
    const downs = await syncList('downtimes', pendingDowntimes(userId, employee), userId, (d) => insertDowntime(d, userId), markDowntimesSynced)
    return { sent: ops.sent + downs.sent, failed: ops.failed + downs.failed }
  })().finally(() => {
    running = null
  })
  return running
}
