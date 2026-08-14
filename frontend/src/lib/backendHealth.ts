import { isSupabaseConfigured, supabase } from '@/lib/supabase'

export const BACKEND_PING_TIMEOUT_MS = 6000

export type BackendPingResult = {
  ok: boolean
  message: string | null
}

function normalizeBackendError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const lower = raw.toLowerCase()
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Не удалось связаться с сервером. Проверьте интернет или доступность базы данных.'
  }
  if (lower.includes('timeout') || lower.includes('ожидан') || lower.includes('aborted')) {
    return 'Сервер не отвечает в отведённое время. Попробуйте позже.'
  }
  return raw || 'База данных временно недоступна.'
}

/** Лёгкий ping к Supabase/Postgres (не блокирует UI при вызове с таймаутом). */
export async function pingBackend(timeoutMs = BACKEND_PING_TIMEOUT_MS): Promise<BackendPingResult> {
  if (!isSupabaseConfigured() || !supabase) {
    return {
      ok: false,
      message:
        'Supabase не настроен. Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в frontend/.env.local.',
    }
  }

  const query = supabase.from('downtimes').select('id').limit(1)
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Превышено время ожидания ответа сервера')), timeoutMs)
  })

  try {
    const { error } = await Promise.race([query, timeout])
    if (error) throw error
    return { ok: true, message: null }
  } catch (e) {
    return { ok: false, message: normalizeBackendError(e) }
  }
}
