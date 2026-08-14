import { ref, computed } from 'vue'
import type { User } from '@supabase/supabase-js'
import type { ProfileRow } from '@/lib/tasksSupabase'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

/** Максимальное ожидание getSession при старте — чтобы UI не зависал при недоступной БД */
export const AUTH_INIT_TIMEOUT_MS = 5000

const user = ref<User | null>(null)
const loading = ref(true)
/** Кэш профиля текущего пользователя (ФИО, телефон, должность и т.д.), чтобы не сбрасывать форму при переходах */
const profileCache = ref<ProfileRow | null>(null)

function isUserActive(u: User | null): boolean {
  if (!u) return false
  // By default user is active unless explicitly disabled.
  return u.user_metadata?.active !== false
}

/** Признак, что текущий logout инициирован самим пользователем (а не сбоем сети/БД). */
let userInitiatedSignOut = false

/**
 * Читает сохранённую сессию Supabase напрямую из localStorage (ключ `sb-<ref>-auth-token`).
 * Нужна, чтобы при недоступной БД не выкидывать недавнего пользователя из кабинета.
 */
function readPersistedUser(): User | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as { currentSession?: { user?: User }; user?: User } | null
      const sessionUser = parsed?.currentSession?.user ?? parsed?.user ?? null
      if (sessionUser) return sessionUser as User
    }
  } catch {
    /* повреждённый/недоступный storage — игнорируем */
  }
  return null
}

export function useAuth() {
  const isLoggedIn = computed(() => Boolean(user.value))

  async function init() {
    if (!supabase) {
      loading.value = false
      return
    }
    // Сохранённый пользователь из localStorage: показываем сразу, чтобы при недоступной
    // БД недавнего пользователя не выкидывало на экран входа.
    const persistedUser = readPersistedUser()
    if (persistedUser && isUserActive(persistedUser)) {
      user.value = persistedUser
    }
    try {
      const result = await Promise.race([
        (async () => {
          const { data: { session }, error } = await supabase!.auth.getSession()
          return { kind: 'session' as const, session, error }
        })(),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          setTimeout(() => resolve({ kind: 'timeout' as const }), AUTH_INIT_TIMEOUT_MS)
        }),
      ])

      if (result.kind === 'session') {
        const nextUser = result.session?.user ?? null
        if (nextUser) {
          if (!isUserActive(nextUser)) {
            userInitiatedSignOut = true
            try { await supabase!.auth.signOut() } finally { userInitiatedSignOut = false }
            user.value = null
          } else {
            user.value = nextUser
          }
        } else if (!result.error && !persistedUser) {
          // Сессии действительно нет (и локально тоже) — пользователь не вошёл.
          user.value = null
        }
        // Если session=null из-за сбоя сети/БД, но локальная сессия есть — оставляем persistedUser.
      }
      // timeout: оставляем persistedUser (если был) — кабинет откроется в офлайн-режиме.
    } catch {
      /* сеть/БД недоступны — оставляем сохранённого пользователя, если он есть */
    } finally {
      loading.value = false
    }
  }

  function startAuthListener() {
    if (!supabase) return
    supabase!.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        // Если это НЕ наш logout и локальная сессия ещё на месте — это транзиентный сбой
        // (недоступная БД / неудачный refresh из-за сети). Не выкидываем пользователя.
        if (!userInitiatedSignOut && readPersistedUser()) return
        user.value = null
        profileCache.value = null
        return
      }
      const nextUser = session?.user ?? null
      // Игнорируем «пустые» события без сессии, если у нас уже есть активный пользователь
      // (иначе сетевые сбои refresh-токена сбрасывали бы вход).
      if (!nextUser && user.value) return
      if (nextUser?.id !== user.value?.id) {
        profileCache.value = null
      }
      if (nextUser && !isUserActive(nextUser)) {
        userInitiatedSignOut = true
        try { await supabase!.auth.signOut() } finally { userInitiatedSignOut = false }
        user.value = null
        return
      }
      user.value = nextUser
    })
  }

  async function login(email: string, password: string) {
    if (!supabase) throw new Error('Supabase не настроен')
    const { data, error } = await supabase!.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (data.user && !isUserActive(data.user)) {
      await supabase!.auth.signOut()
      user.value = null
      throw new Error('Аккаунт отключён. Обратитесь к администратору.')
    }
    user.value = data.user
    return data
  }

  async function register(email: string, password: string) {
    if (!supabase) throw new Error('Supabase не настроен')
    const { data, error } = await supabase!.auth.signUp({
      email,
      password,
      options: { data: { role: 'worker' } },
    })
    if (error) throw error
    user.value = data.user
    return data
  }

  async function logout() {
    if (!supabase) return
    userInitiatedSignOut = true
    try {
      await supabase!.auth.signOut()
    } finally {
      userInitiatedSignOut = false
    }
    user.value = null
    profileCache.value = null
    try {
      localStorage.removeItem('agro:profile')
    } catch {
      /* ignore */
    }
  }

  /** Смена пароля: проверка текущего и установка нового */
  async function updatePassword(currentPassword: string, newPassword: string) {
    if (!supabase) throw new Error('Supabase не настроен')
    const email = user.value?.email
    if (!email) throw new Error('Пользователь не найден')
    const { error: signInError } = await supabase!.auth.signInWithPassword({ email, password: currentPassword })
    if (signInError) throw new Error('Неверный текущий пароль')
    const { error: updateError } = await supabase!.auth.updateUser({ password: newPassword })
    if (updateError) throw updateError
  }

  const userRole = computed<'worker' | 'manager'>(() => {
    const role = user.value?.user_metadata?.role
    return role === 'manager' ? 'manager' : 'worker'
  })

  return {
    user,
    loading,
    isLoggedIn,
    isAuthConfigured: isSupabaseConfigured,
    userRole,
    profileCache,
    init,
    startAuthListener,
    login,
    register,
    logout,
    updatePassword,
  }
}

export function getAuthUser(): User | null {
  return user.value
}

export function isAuthLoading(): boolean {
  return loading.value
}
