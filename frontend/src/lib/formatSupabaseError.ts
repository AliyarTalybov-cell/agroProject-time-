/**
 * PostgrestError / AuthError от @supabase/supabase-js часто не являются instanceof Error,
 * из‑за этого в catch теряется текст — показываем message/details/hint.
 */
export function formatSupabaseError(err: unknown): string {
  if (err == null) return 'Неизвестная ошибка'
  if (err instanceof Error) return err.message
  if (typeof err !== 'object') return String(err)
  const o = err as Record<string, unknown>
  const msg = typeof o.message === 'string' ? o.message : ''
  const details = typeof o.details === 'string' ? o.details : ''
  const hint = typeof o.hint === 'string' ? o.hint : ''
  const code = typeof o.code === 'string' ? o.code : ''
  const parts = [msg, details, hint].filter((s) => s.length > 0)
  if (parts.length) return parts.join(' — ')
  if (code) return `Код: ${code}`
  try {
    return JSON.stringify(err)
  } catch {
    return 'Ошибка запроса'
  }
}
