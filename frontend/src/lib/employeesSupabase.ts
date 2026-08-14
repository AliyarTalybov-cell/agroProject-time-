import { supabase, isSupabaseConfigured } from '@/lib/supabase'

export type EmployeeRole = 'worker' | 'manager'
export type EmployeesPageResult = {
  rows: EmployeeRow[]
  total: number
}

export type EmployeeRow = {
  id: string
  email: string
  display_name: string | null
  role: string | null
  active: boolean | null
  phone: string | null
  position: string | null
  additional_info: string | null
  avatar_url?: string | null
  last_activity_at: string | null
  created_at: string
  updated_at: string
}

const EMPLOYEE_COLUMNS =
  'id, email, display_name, role, active, phone, position, additional_info, avatar_url, last_activity_at, created_at, updated_at'

function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ')
}

function escapeIlike(s: string): string {
  // Supabase/PostgREST: we can escape % and _ in LIKE patterns with backslash.
  // We'll keep it simple and just remove control characters; wildcard escaping is best-effort.
  return s.replace(/[%_\\]/g, (m) => `\\${m}`).replace(/[\u0000-\u001f]/g, '')
}

export async function loadEmployees(limit = 50, position: string | null = null): Promise<EmployeeRow[]> {
  if (!supabase) return []
  const safeLimit = Math.min(Math.max(limit, 1), 200)
  let q = supabase
    .from('profiles')
    .select(EMPLOYEE_COLUMNS)
  if (position) q = q.eq('position', position)
  const { data, error } = await q
    .order('updated_at', { ascending: false })
    .limit(safeLimit)
  if (error) throw error
  return (data ?? []) as EmployeeRow[]
}

/**
 * Поиск выполняется "на бэкенде": это запрос к Supabase (PostgREST).
 * Ищем по email / display_name / phone / position.
 */
export async function searchEmployees(query: string, limit = 50, position: string | null = null): Promise<EmployeeRow[]> {
  if (!supabase) return []
  const q = normalizeQuery(query)
  if (!q) return loadEmployees(limit, position)
  const safeLimit = Math.min(Math.max(limit, 1), 200)
  const pattern = `%${escapeIlike(q)}%`
  // or() принимает строку с условиями через запятую
  const or = [
    `email.ilike.${pattern}`,
    `display_name.ilike.${pattern}`,
    `phone.ilike.${pattern}`,
    `position.ilike.${pattern}`,
  ].join(',')
  let req = supabase
    .from('profiles')
    .select(EMPLOYEE_COLUMNS)
    .or(or)
  if (position) req = req.eq('position', position)
  const { data, error } = await req
    .order('updated_at', { ascending: false })
    .limit(safeLimit)
  if (error) throw error
  return (data ?? []) as EmployeeRow[]
}

export async function loadEmployeesPage(
  page = 1,
  pageSize = 12,
  position: string | null = null,
): Promise<EmployeesPageResult> {
  if (!supabase) return { rows: [], total: 0 }
  const safePage = Math.max(1, Math.floor(page))
  const safePageSize = Math.min(Math.max(1, Math.floor(pageSize)), 200)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1
  let q = supabase
    .from('profiles')
    .select(EMPLOYEE_COLUMNS, { count: 'exact' })
  if (position) q = q.eq('position', position)
  const { data, error, count } = await q
    .order('updated_at', { ascending: false })
    .range(from, to)
  if (error) throw error
  return { rows: (data ?? []) as EmployeeRow[], total: Number(count ?? 0) }
}

export async function searchEmployeesPage(
  query: string,
  page = 1,
  pageSize = 12,
  position: string | null = null,
): Promise<EmployeesPageResult> {
  if (!supabase) return { rows: [], total: 0 }
  const q = normalizeQuery(query)
  if (!q) return loadEmployeesPage(page, pageSize, position)
  const safePage = Math.max(1, Math.floor(page))
  const safePageSize = Math.min(Math.max(1, Math.floor(pageSize)), 200)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1
  const pattern = `%${escapeIlike(q)}%`
  const or = [
    `email.ilike.${pattern}`,
    `display_name.ilike.${pattern}`,
    `phone.ilike.${pattern}`,
    `position.ilike.${pattern}`,
  ].join(',')
  let req = supabase
    .from('profiles')
    .select(EMPLOYEE_COLUMNS, { count: 'exact' })
    .or(or)
  if (position) req = req.eq('position', position)
  const { data, error, count } = await req
    .order('updated_at', { ascending: false })
    .range(from, to)
  if (error) throw error
  return { rows: (data ?? []) as EmployeeRow[], total: Number(count ?? 0) }
}

export type CreateEmployeePayload = {
  fullName: string
  email: string
  phone?: string | null
  position?: string | null
  additionalInfo?: string | null
  role: EmployeeRole
  password: string
}

export type PositionRow = {
  id: string
  name: string
  sort_order: number
}

export async function loadPositions(): Promise<PositionRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('employee_positions')
    .select('id, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as PositionRow[]
}

/**
 * Создание сотрудника с паролем нельзя безопасно делать напрямую из браузера,
 * поэтому вызываем Supabase Edge Function `admin-create-employee`.
 */
export async function createEmployee(payload: CreateEmployeePayload): Promise<{ id: string }> {
  if (!isSupabaseConfigured() || !supabase) throw new Error('Supabase не настроен')
  const {
    data: { session },
    error: sessionErr,
  } = await supabase.auth.getSession()
  if (sessionErr || !session?.access_token) throw new Error('Требуется авторизация')

  const { data, error } = await supabase.functions.invoke('admin-create-employee', {
    body: { ...payload, accessToken: session.access_token },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) throw error
  const backendError =
    data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
      ? String((data as Record<string, unknown>).error ?? '')
      : ''
  if (backendError) throw new Error(backendError)
  if (!data?.id) throw new Error('Не удалось создать сотрудника')
  return { id: String(data.id) }
}

export type UpdateEmployeePayload = {
  id: string
  fullName: string
  email: string
  phone?: string | null
  position?: string | null
  additionalInfo?: string | null
  role: EmployeeRole
  active: boolean
}

export async function updateEmployee(payload: UpdateEmployeePayload): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) throw new Error('Supabase не настроен')
  const {
    data: { session },
    error: sessionErr,
  } = await supabase.auth.getSession()
  if (sessionErr || !session?.access_token) throw new Error('Требуется авторизация')

  const { error } = await supabase.functions.invoke('admin-update-employee', {
    body: { ...payload, accessToken: session.access_token },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) {
    const anyErr = error as unknown as {
      message?: string
      context?: { status?: number; statusText?: string; body?: unknown }
    }
    const msg = anyErr?.message ?? (error instanceof Error ? error.message : String(error))
    const status = anyErr?.context?.status
    const statusText = anyErr?.context?.statusText
    const body = anyErr?.context?.body
    const bodyError =
      body && typeof body === 'object' && 'error' in (body as Record<string, unknown>) ? String((body as Record<string, unknown>).error) : null
    const details = bodyError || (typeof body === 'string' ? body : null)

    if (msg.includes('Failed to send a request to the Edge Function')) {
      throw new Error(
        'Не удалось вызвать Edge Function `admin-update-employee` (функция недоступна или не задеплоена). Проверьте деплой через Supabase CLI.',
      )
    }
    if (msg.includes('Edge Function returned a non-2xx status code')) {
      const tail = [status != null ? `HTTP ${status}` : null, statusText || null, details || null].filter(Boolean).join(' — ')
      throw new Error(`Ошибка Edge Function: ${tail || 'non-2xx'}`)
    }
    throw error
  }
}

export async function deleteEmployee(id: string): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) throw new Error('Supabase не настроен')
  const {
    data: { session },
    error: sessionErr,
  } = await supabase.auth.getSession()
  if (sessionErr || !session?.access_token) throw new Error('Требуется авторизация')

  const { error } = await supabase.functions.invoke('admin-delete-employee', {
    body: { id, accessToken: session.access_token },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) throw error
}

