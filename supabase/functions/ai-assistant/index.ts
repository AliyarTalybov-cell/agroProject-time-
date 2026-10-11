// Supabase Edge Function: ai-assistant
// Мини-помощник на вкладке «Обзор». Собирает короткую сводку из базы от имени
// самого пользователя (его JWT — значит, действуют те же RLS, что и в портале)
// и отправляет её вместе с вопросом в OpenRouter.
//
// Секреты сервера:
//   OPENROUTER_API_KEY — ключ OpenRouter (обязателен, во фронтенд не попадает);
//   OPENROUTER_MODEL   — модель, по умолчанию anthropic/claude-haiku-5.5.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5'
const MAX_QUESTION = 1000
const MAX_HISTORY = 8
const MAX_ANSWER_TOKENS = 700
/** Не больше стольких вопросов в час от одного человека (на экземпляр функции). */
const HOURLY_LIMIT = 40
/** Сводку из базы держим недолго: несколько вопросов подряд не перечитывают таблицы. */
const CONTEXT_TTL_MS = 2 * 60 * 1000

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type Weather = {
  city?: string
  now?: string
  days?: string[]
}

type Payload = {
  accessToken?: string
  question?: string
  history?: ChatMessage[]
  /** Дата и время у пользователя: сервер живёт в UTC. */
  today?: string
  now?: string
  /** Date.getTimezoneOffset() у пользователя, минуты. */
  tzOffset?: number
  weather?: Weather | null
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-headers', 'authorization, x-client-info, apikey, content-type')
  headers.set('access-control-allow-methods', 'POST, OPTIONS')
  return new Response(JSON.stringify(data), { ...init, headers })
}

const hits = new Map<string, number[]>()
function overLimit(userId: string): boolean {
  const now = Date.now()
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 3600_000)
  recent.push(now)
  hits.set(userId, recent)
  return recent.length > HOURLY_LIMIT
}

const contextCache = new Map<string, { at: number; text: string }>()

function dueYmd(raw: string | null): string | null {
  if (!raw) return null
  const s = raw.trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!dmy) return null
  return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
}

function ru(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}.${m}.${y}`
}

const STATUS: Record<string, string> = { todo: 'к выполнению', in_progress: 'в работе', review: 'на проверке', done: 'выполнена' }
const PRIORITY: Record<string, string> = { high: 'высокий', medium: 'средний', low: 'низкий' }
const tons = (n: number) => `${Math.round(n * 10) / 10} т`

/** Короткая сводка — только то, что помогает ответить «что важно сейчас». */
async function buildContext(db: SupabaseClient, userId: string, isManager: boolean, today: string, tzOffset: number): Promise<string> {
  const lines: string[] = []
  const safe = async <T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> => {
    try {
      const { data, error } = await p
      return error ? null : data
    } catch {
      return null
    }
  }

  const [myTasks, assigneeRows, crops] = await Promise.all([
    safe(db.from('tasks').select('number, title, priority, field, due_date, status').eq('assignee_id', userId).neq('status', 'done').limit(60)),
    safe(db.from('calendar_task_assignees').select('task_id').eq('user_id', userId)),
    safe(db.from('crops').select('key, label')),
  ])
  const cropLabel = new Map(((crops ?? []) as { key: string; label: string }[]).map((c) => [c.key, c.label]))

  // Задачи
  type T = { number: number; title: string; priority: string; field: string | null; due_date: string | null; status: string }
  const tasks = ((myTasks ?? []) as T[]).map((t) => ({ ...t, due: dueYmd(t.due_date) }))
  const fmtTask = (t: (typeof tasks)[number]) =>
    `#${t.number} «${t.title}»${t.field ? `, ${t.field}` : ''}; срок ${t.due ? ru(t.due) : 'не указан'}; ${STATUS[t.status] ?? t.status}; приоритет ${PRIORITY[t.priority] ?? t.priority}`
  const overdue = tasks.filter((t) => t.due && t.due < today)
  const dueToday = tasks.filter((t) => t.due === today)
  const soon = tasks
    .filter((t) => t.due && t.due > today)
    .sort((a, b) => a.due!.localeCompare(b.due!))
    .slice(0, 5)
  const noDue = tasks.filter((t) => !t.due)
  lines.push(`МОИ ОТКРЫТЫЕ ЗАДАЧИ: ${tasks.length}`)
  if (overdue.length) lines.push('Просрочены:', ...overdue.slice(0, 10).map((t) => `- ${fmtTask(t)}`))
  if (dueToday.length) lines.push('Срок сегодня:', ...dueToday.slice(0, 10).map((t) => `- ${fmtTask(t)}`))
  if (soon.length) lines.push('Ближайшие:', ...soon.map((t) => `- ${fmtTask(t)}`))
  if (noDue.length) lines.push(`Без срока: ${noDue.length} (${noDue.slice(0, 3).map((t) => `#${t.number} «${t.title}»`).join(', ')})`)

  // Календарь на сегодня
  const ids = ((assigneeRows ?? []) as { task_id: string }[]).map((r) => r.task_id)
  let calQ = db.from('calendar_tasks').select('title, start_time, end_time, completed_at').eq('date', today)
  calQ = ids.length ? calQ.or(`user_id.eq.${userId},id.in.(${ids.join(',')})`) : calQ.eq('user_id', userId)
  const events = ((await safe(calQ.order('start_time', { ascending: true }).limit(20))) ?? []) as {
    title: string
    start_time: string | null
    end_time: string | null
    completed_at: string | null
  }[]
  lines.push(`КАЛЕНДАРЬ НА СЕГОДНЯ: ${events.length ? '' : 'событий нет'}`)
  for (const e of events) {
    const time = e.start_time ? `${e.start_time.slice(0, 5)}${e.end_time ? `–${e.end_time.slice(0, 5)}` : ''}` : 'весь день'
    lines.push(`- ${time} ${e.title}${e.completed_at ? ' (отмечено выполненным)' : ''}`)
  }

  // Поля — компактно: культура и площадь
  const fields = ((await safe(db.from('fields').select('number, name, area, crop_key').order('number').limit(80))) ?? []) as {
    number: number
    name: string
    area: number
    crop_key: string | null
  }[]
  if (fields.length) {
    const total = fields.reduce((s, f) => s + Number(f.area || 0), 0)
    lines.push(`ПОЛЯ: ${fields.length}, всего ${Math.round(total * 10) / 10} га`)
    lines.push(
      fields.map((f) => `№${f.number} ${f.name} — ${cropLabel.get(f.crop_key ?? '') ?? 'без культуры'}, ${f.area} га`).join('; '),
    )
  }

  if (isManager) {
    const [review, statuses, cellTotals, locations] = await Promise.all([
      safe(db.from('tasks').select('number, title').eq('status', 'review').limit(20)),
      safe(db.from('operator_status').select('kind, employee, field_name, operation, downtime_reason, started_at')),
      safe(db.from('stock_cell_totals').select('storage_location_id, tons, crop_key')),
      safe(db.from('storage_locations').select('id, name, capacity_tons')),
    ])
    const rv = (review ?? []) as { number: number; title: string }[]
    lines.push(`ЗАДАЧИ НА ПРОВЕРКЕ (ждут решения руководителя): ${rv.length}${rv.length ? ' — ' + rv.slice(0, 8).map((t) => `#${t.number} «${t.title}»`).join(', ') : ''}`)

    const st = (statuses ?? []) as { kind: string; employee: string; field_name: string | null; operation: string | null; downtime_reason: string | null; started_at: string }[]
    lines.push(`СЕЙЧАС НА СМЕНЕ: ${st.length || 'никого'}`)
    for (const s of st) {
      const since = new Date(new Date(s.started_at).getTime() - tzOffset * 60_000).toISOString().slice(11, 16)
      lines.push(
        s.kind === 'operation'
          ? `- ${s.employee}: ${s.operation ?? 'работа'}${s.field_name ? ` на ${s.field_name}` : ''}, с ${since}`
          : `- ${s.employee}: простой${s.downtime_reason ? ` (${s.downtime_reason})` : ''}, с ${since}`,
      )
    }

    const totals = (cellTotals ?? []) as { storage_location_id: string; tons: number; crop_key: string | null }[]
    if (totals.length) {
      const byCrop = new Map<string, number>()
      const byLoc = new Map<string, number>()
      for (const t of totals) {
        const n = Number(t.tons || 0)
        byCrop.set(t.crop_key ?? '', (byCrop.get(t.crop_key ?? '') ?? 0) + n)
        byLoc.set(t.storage_location_id, (byLoc.get(t.storage_location_id) ?? 0) + n)
      }
      const all = [...byLoc.values()].reduce((s, n) => s + n, 0)
      lines.push(`ЗЕРНО НА СКЛАДАХ: ${tons(all)}`)
      lines.push(
        'По культурам: ' +
          [...byCrop.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${cropLabel.get(k) ?? 'без культуры'} ${tons(n)}`).join(', '),
      )
      const locs = (locations ?? []) as { id: string; name: string; capacity_tons: number | null }[]
      lines.push(
        'По складам: ' +
          locs.map((l) => `${l.name} ${tons(byLoc.get(l.id) ?? 0)}${l.capacity_tons ? ` из ${tons(Number(l.capacity_tons))}` : ''}`).join(', '),
      )
    }
  }

  return lines.join('\n')
}

const SYSTEM_PROMPT = `Ты — помощник в портале агронома «Агросистема». Отвечаешь сотруднику хозяйства по-русски.
Правила:
- Опирайся только на сводку данных ниже. Чего в сводке нет — так и скажи и подскажи раздел портала, где это посмотреть (Задачи, Календарь, Поля и культуры, Склады, Погода, Экран оператора, Аналитика).
- Ничего не выдумывай: номера задач, поля, цифры — только из сводки.
- Отвечай коротко и по делу: 2–6 строк или короткий список через «- ». Сначала самое важное (просрочено, срок сегодня, высокий приоритет).
- Без заголовков, таблиц и разметки, кроме списков через «- ».
- О погоде: оценивай пригодность для полевых работ (опрыскивание нежелательно при ветре сильнее 4–5 м/с и перед дождём; уборка — по сухой погоде).
- Даты пиши как ДД.ММ.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  const model = Deno.env.get('OPENROUTER_MODEL') || DEFAULT_MODEL
  if (!url || !anonKey) return json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' }, { status: 500 })
  if (!apiKey) return json({ error: 'Помощник не настроен: на сервере нет ключа OPENROUTER_API_KEY' }, { status: 503 })

  let body: Payload
  try {
    body = (await req.json()) as Payload
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const token = body.accessToken ? String(body.accessToken) : ''
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 })
  // Клиент от имени пользователя: читает ровно то, что ему разрешают политики.
  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userErr } = await db.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, { status: 401 })
  const userId = userData.user.id

  const { data: profile } = await db.from('profiles').select('display_name, role, position, active').eq('id', userId).maybeSingle()
  if (profile?.active === false) return json({ error: 'Forbidden' }, { status: 403 })
  const isManager = profile?.role === 'manager'

  const question = String(body.question ?? '').trim().slice(0, MAX_QUESTION)
  if (!question) return json({ error: 'Пустой вопрос' }, { status: 400 })
  if (overLimit(userId)) return json({ error: 'Слишком много вопросов подряд. Попробуйте через несколько минут.' }, { status: 429 })

  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today)) ? String(body.today) : new Date().toISOString().slice(0, 10)

  const tzOffset = Number.isFinite(Number(body.tzOffset)) ? Math.max(-840, Math.min(840, Number(body.tzOffset))) : -180
  const cacheKey = `${userId}:${today}`
  let context = contextCache.get(cacheKey)
  if (!context || Date.now() - context.at > CONTEXT_TTL_MS) {
    context = { at: Date.now(), text: await buildContext(db, userId, isManager, today, tzOffset) }
    contextCache.set(cacheKey, context)
  }

  const w = body.weather
  const weatherText = w && (w.now || w.days?.length)
    ? [`ПОГОДА${w.city ? ` (${String(w.city).slice(0, 60)})` : ''}:`, w.now ? `Сейчас: ${String(w.now).slice(0, 300)}` : '', ...(w.days ?? []).slice(0, 5).map((d) => `- ${String(d).slice(0, 200)}`)]
        .filter(Boolean)
        .join('\n')
    : 'ПОГОДА: нет данных (страница не смогла её получить).'

  const who = `Пользователь: ${profile?.display_name || 'сотрудник'}${profile?.position ? `, ${profile.position}` : ''}; роль — ${isManager ? 'руководитель' : 'сотрудник'}.`
  const nowText = `Сегодня ${ru(today)}${body.now ? `, время у пользователя ${String(body.now).slice(0, 5)}` : ''}.`

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'x-title': 'Agrosystem',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_ANSWER_TOKENS,
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\n${who}\n${nowText}\n\nСВОДКА ДАННЫХ:\n${context.text}\n\n${weatherText}` },
        ...history,
        { role: 'user', content: question },
      ],
    }),
  }).catch(() => null)

  if (!res) return json({ error: 'Сервис ИИ недоступен. Попробуйте позже.' }, { status: 502 })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    console.error('openrouter', res.status, JSON.stringify(data)?.slice(0, 500))
    return json({ error: 'Сервис ИИ не ответил. Попробуйте позже.' }, { status: 502 })
  }
  const answer = String(data?.choices?.[0]?.message?.content ?? '').trim()
  if (!answer) return json({ error: 'Пустой ответ сервиса ИИ' }, { status: 502 })
  return json({ answer })
})
