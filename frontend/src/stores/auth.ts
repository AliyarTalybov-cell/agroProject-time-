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

/**
 * Роль текущего пользователя из таблицы `profiles` — единственный источник истины.
 *
 * Раньше роль брали из `user_metadata`, но это поле владелец аккаунта редактирует
 * сам вызовом `auth.updateUser`, поэтому доверять ему нельзя. На сервере проверки
 * переведены на `profiles.role` миграцией 20260819_fix_access_control.sql, здесь —
 * то же самое, чтобы интерфейс и база считали одинаково.
 */
const profileRole = ref<'worker' | 'manager'>('worker')

/**
 * Читает роль из БД. Возвращает `null`, если прочитать не удалось: ошибка
 * запроса, таймаут или отсутствие клиента. Это намеренно отличается от
 * честно прочитанного `worker` — см. `refreshProfileRole`.
 */
async function readProfileRole(): Promise<'worker' | 'manager' | null> {
  const current = user.value
  if (!current || !supabase) return null
  try {
    const query = supabase.from('profiles').select('role').eq('id', current.id).maybeSingle()
    const timeout = new Promise<{ data: null; error: unknown }>((resolve) => {
      setTimeout(() => resolve({ data: null, error: new Error('timeout') }), AUTH_INIT_TIMEOUT_MS)
    })
    // `error` разбирается наравне с `data`: раньше его отбрасывали, и любой
    // временный сбой выглядел как «роль прочитана, там worker».
    const { data, error } = await Promise.race([query, timeout])
    if (error) return null
    return (data as { role?: string } | null)?.role === 'manager' ? 'manager' : 'worker'
  } catch {
    return null
  }
}

/**
 * Перечитывает роль из БД.
 *
 * Неудачное чтение роль не меняет. Прежняя версия в этом случае ставила
 * `worker`, и руководитель, у которого протух токен или моргнула сеть,
 * молча превращался в работника до перезагрузки страницы. Понижать роль
 * ради безопасности здесь незачем: реальные ограничения стоят на стороне
 * БД (RLS и гранты из 20260819_fix_access_control.sql), а `profileRole`
 * управляет только тем, что показать в интерфейсе.
 */
async function refreshProfileRole(): Promise<void> {
  if (!user.value || !supabase) {
    profileRole.value = 'worker'
    return
  }
  const role = await readProfileRole()
  if (role === null) return
  profileRole.value = role
}

/**
 * Откладывает перечитывание роли за пределы текущего колбэка.
 *
 * Запрос к базе изнутри `onAuthStateChange` виснет — это описанная в
 * документации Supabase взаимная блокировка supabase-js: вызов не
 * возвращается, а следующий запрос тем же клиентом встаёт за ним.
 * `setTimeout` уводит запрос из колбэка, и блокировки не возникает.
 */
function scheduleProfileRoleRefresh(): void {
  setTimeout(() => {
    void refreshProfileRole()
  }, 0)
}

/** Тот же приём для выхода: колбэк должен оставаться синхронным. */
function scheduleSignOut(): void {
  setTimeout(async () => {
    if (!supabase) return
    userInitiatedSignOut = true
    try {
      await supabase.auth.signOut()
    } finally {
      userInitiatedSignOut = false
    }
  }, 0)
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
      // Роль должна быть известна до того, как роутер снимет ожидание:
      // на ней построен гейт managerOnly.
      await refreshProfileRole()
      loading.value = false
    }
  }

  function startAuthListener() {
    if (!supabase) return
    // Колбэк намеренно синхронный и без запросов к базе: всё, что ходит
    // в сеть, откладывается наружу (см. scheduleProfileRoleRefresh).
    supabase!.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // Если это НЕ наш logout и локальная сессия ещё на месте — это транзиентный сбой
        // (недоступная БД / неудачный refresh из-за сети). Не выкидываем пользователя.
        if (!userInitiatedSignOut && readPersistedUser()) return
        user.value = null
        profileCache.value = null
        profileRole.value = 'worker'
        return
      }
      const nextUser = session?.user ?? null
      // Игнорируем «пустые» события без сессии, если у нас уже есть активный пользователь
      // (иначе сетевые сбои refresh-токена сбрасывали бы вход).
      if (!nextUser && user.value) return
      if (nextUser?.id !== user.value?.id) {
        profileCache.value = null
        // Роль прежнего пользователя не должна достаться следующему.
        profileRole.value = 'worker'
      }
      if (nextUser && !isUserActive(nextUser)) {
        user.value = null
        profileRole.value = 'worker'
        scheduleSignOut()
        return
      }
      user.value = nextUser
      scheduleProfileRoleRefresh()
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
    await refreshProfileRole()
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
    profileRole.value = 'worker'
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

  const userRole = computed<'worker' | 'manager'>(() => profileRole.value)

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

/** Роль текущего пользователя для кода вне компонентов (роутер, проверки прав). */
export function getUserRole(): 'worker' | 'manager' {
  return profileRole.value
}

/** Принудительно перечитать роль — например, после смены роли руководителем. */
export async function reloadUserRole(): Promise<void> {
  await refreshProfileRole()
}

export function isAuthLoading(): boolean {
  return loading.value
}
