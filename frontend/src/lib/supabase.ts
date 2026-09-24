import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Ключ, под которым supabase-js хранит сессию в localStorage. Он зависит от
 * адреса бэкенда (`sb-<первая часть хоста>-auth-token`), поэтому при смене
 * адреса старая сессия остаётся под прежним ключом и клиенту не видна.
 * Задаём его явно и читаем только его — см. readPersistedUser в stores/auth.ts.
 */
export const supabaseStorageKey = supabaseUrl
  ? `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  : null

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, { auth: { storageKey: supabaseStorageKey! } })
    : null

/** Есть ли настроенное подключение к Supabase */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey)
}
