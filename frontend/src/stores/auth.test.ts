import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Роль руководителя молча слетала до `worker`, если открытая вкладка долго
 * висела без перезагрузки. Причин было две, обе воспроизводятся ниже:
 *
 *   1. Перечитывание роли шло запросом к базе прямо из `onAuthStateChange`.
 *      Такой запрос виснет — это описанная в документации Supabase взаимная
 *      блокировка supabase-js. Гонка с таймаутом отдавала пустой результат.
 *   2. Пустой результат трактовался как «роль прочитана, там worker», потому
 *      что `error` в разборе ответа игнорировался.
 *
 * Событие `TOKEN_REFRESHED` приходит по истечении срока токена, `SIGNED_IN` —
 * в том числе при возврате фокуса на вкладку, так что ловилось это регулярно.
 */

const h = vi.hoisted(() => {
  const listeners: Array<(event: string, session: unknown) => void> = []
  const maybeSingle = vi.fn()
  return {
    listeners,
    maybeSingle,
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
    signOut: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    signInWithPassword: vi.fn(),
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: h.from,
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.listeners.push(cb)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: h.signOut,
      getSession: h.getSession,
      signInWithPassword: h.signInWithPassword,
    },
  },
  isSupabaseConfigured: () => true,
  supabaseStorageKey: 'sb-current-auth-token',
}))

const MANAGER = { id: 'u-1', user_metadata: {} }
const OTHER_USER = { id: 'u-2', user_metadata: {} }

/** Свежий модуль: состояние роли в нём глобальное на модуль. */
async function freshAuth() {
  vi.resetModules()
  h.listeners.length = 0
  h.from.mockClear()
  h.maybeSingle.mockReset()
  const mod = await import('./auth')
  mod.useAuth().startAuthListener()
  return mod
}

/** Приводит стор в состояние «вошёл руководитель». */
async function signInAsManager(mod: Awaited<ReturnType<typeof freshAuth>>) {
  h.maybeSingle.mockResolvedValue({ data: { role: 'manager' }, error: null })
  h.listeners[0]('SIGNED_IN', { user: MANAGER })
  await vi.advanceTimersByTimeAsync(0)
  expect(mod.getUserRole()).toBe('manager')
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('обновление роли по событиям авторизации', () => {
  it('не ходит в базу изнутри колбэка onAuthStateChange', async () => {
    const mod = await freshAuth()
    h.maybeSingle.mockResolvedValue({ data: { role: 'manager' }, error: null })

    h.listeners[0]('TOKEN_REFRESHED', { user: MANAGER })

    // Пока колбэк не завершился, запроса быть не должно: именно вызов
    // изнутри колбэка и приводил к блокировке.
    expect(h.from).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(0)
    expect(h.from).toHaveBeenCalledWith('profiles')
    expect(mod.getUserRole()).toBe('manager')
  })

  it('оставляет роль руководителя, если запрос завис', async () => {
    const mod = await freshAuth()
    await signInAsManager(mod)

    // Ровно то, что делала блокировка: обещание не разрешается никогда.
    h.maybeSingle.mockReturnValue(new Promise(() => {}))
    h.listeners[0]('TOKEN_REFRESHED', { user: MANAGER })
    await vi.advanceTimersByTimeAsync(30_000)

    expect(mod.getUserRole()).toBe('manager')
  })

  it('оставляет роль руководителя при ошибке запроса', async () => {
    const mod = await freshAuth()
    await signInAsManager(mod)

    h.maybeSingle.mockResolvedValue({ data: null, error: { message: 'network' } })
    h.listeners[0]('TOKEN_REFRESHED', { user: MANAGER })
    await vi.advanceTimersByTimeAsync(0)

    expect(mod.getUserRole()).toBe('manager')
  })

  it('понижает роль, если в базе она действительно стала worker', async () => {
    const mod = await freshAuth()
    await signInAsManager(mod)

    h.maybeSingle.mockResolvedValue({ data: { role: 'worker' }, error: null })
    h.listeners[0]('TOKEN_REFRESHED', { user: MANAGER })
    await vi.advanceTimersByTimeAsync(0)

    expect(mod.getUserRole()).toBe('worker')
  })

  it('не отдаёт роль прежнего пользователя следующему', async () => {
    const mod = await freshAuth()
    await signInAsManager(mod)

    // Роль сбрасывается сразу, ещё до ответа базы по новому пользователю.
    h.maybeSingle.mockReturnValue(new Promise(() => {}))
    h.listeners[0]('SIGNED_IN', { user: OTHER_USER })

    expect(mod.getUserRole()).toBe('worker')
  })

  it('сбрасывает роль при выходе пользователя', async () => {
    const mod = await freshAuth()
    await signInAsManager(mod)

    h.listeners[0]('SIGNED_OUT', null)

    expect(mod.getUserRole()).toBe('worker')
    expect(mod.getAuthUser()).toBeNull()
  })
})

describe('сохранённая сессия', () => {
  afterEach(() => localStorage.clear())

  it('не подхватывает сессию от прежнего адреса бэкенда', async () => {
    localStorage.setItem('sb-old-host-auth-token', JSON.stringify({ user: { id: 'u-old' } }))
    const mod = await freshAuth()
    vi.useRealTimers()
    await mod.useAuth().init()

    expect(mod.getAuthUser()).toBeNull()
  })

  it('подхватывает сессию текущего адреса', async () => {
    localStorage.setItem('sb-current-auth-token', JSON.stringify({ user: { id: 'u-cur' } }))
    const mod = await freshAuth()
    vi.useRealTimers()
    await mod.useAuth().init()

    expect(mod.getAuthUser()?.id).toBe('u-cur')
  })
})

/**
 * Отключённый сотрудник раньше отсекался только по `user_metadata.active`,
 * которое он правит сам. Теперь флаг читается из `profiles`, а заблокированную
 * учётную запись Auth не пускает на вход.
 */
describe('отключённый сотрудник', () => {
  it('выбрасывается из сессии, если в profiles active = false', async () => {
    const mod = await freshAuth()
    h.signOut.mockClear()
    // Метаданные говорят «активен» — именно их можно подделать.
    h.maybeSingle.mockResolvedValue({ data: { role: 'manager', active: false }, error: null })
    h.listeners[0]('SIGNED_IN', { user: { id: 'u-3', user_metadata: { active: true } } })
    // Чтение профиля и отложенный выход (scheduleSignOut) идут через setTimeout.
    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()

    expect(mod.getAuthUser()).toBeNull()
    expect(mod.getUserRole()).toBe('worker')
    expect(h.signOut).toHaveBeenCalled()
  })

  it('остаётся в сессии, если профиль прочитать не удалось', async () => {
    const mod = await freshAuth()
    const user = { id: 'u-4', user_metadata: {} }
    h.maybeSingle.mockResolvedValue({ data: null, error: { message: 'network' } })
    h.listeners[0]('SIGNED_IN', { user })
    await vi.advanceTimersByTimeAsync(0)

    expect(mod.getAuthUser()).toEqual(user)
  })

  it('при входе заблокированной учётки показывает понятное сообщение', async () => {
    const mod = await freshAuth()
    h.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'user_banned', message: 'User is banned' },
    })

    await expect(mod.useAuth().login('a@b.ru', 'x')).rejects.toThrow(mod.ACCOUNT_DISABLED_MESSAGE)
  })

  it('не пускает при входе, если в profiles active = false', async () => {
    const mod = await freshAuth()
    h.signOut.mockClear()
    h.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'u-5', user_metadata: { active: true } }, session: {} },
      error: null,
    })
    h.maybeSingle.mockResolvedValue({ data: { role: 'worker', active: false }, error: null })

    await expect(mod.useAuth().login('a@b.ru', 'x')).rejects.toThrow(mod.ACCOUNT_DISABLED_MESSAGE)
    expect(mod.getAuthUser()).toBeNull()
    expect(h.signOut).toHaveBeenCalled()
  })
})
