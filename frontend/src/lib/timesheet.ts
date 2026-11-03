/**
 * Табель рабочего времени (миграция 20261103_work_days_timesheet.sql).
 *
 * Писать — только функциями workday_*: они сами проверяют время и пишут
 * исправления в журнал. Читать — list_work_days (итоги дня вместе с
 * операциями и простоями внутри него) и work_day_edits (история правок).
 */
import { supabase } from '@/lib/supabase'

export type WorkDay = {
  id: string
  user_id: string
  work_date: string
  started_at: string
  ended_at: string | null
  is_open: boolean
  on_break: boolean
  break_minutes: number
  worked_minutes: number
  operation_minutes: number
  downtime_minutes: number
  edited: boolean
  last_edit_reason: string | null
}

export type WorkDayEdit = {
  id: string
  work_day_id: string
  edited_by: string | null
  edited_at: string
  reason: string
  before: { started_at: string | null; ended_at: string | null; break_minutes: number } | null
  after: { started_at: string; ended_at: string; break_minutes: number }
}

function client() {
  if (!supabase) throw new Error('Supabase не настроен')
  return supabase
}

/** Дата по Москве в виде ГГГГ-ММ-ДД — так считаются сутки в базе. */
export function moscowDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export async function listWorkDays(from: string, to: string, userId: string | null = null): Promise<WorkDay[]> {
  const { data, error } = await client().rpc('list_work_days', { p_from: from, p_to: to, p_user_id: userId })
  if (error) throw error
  return (data ?? []) as WorkDay[]
}

/** Сегодняшний (или идущий ночной) день вошедшего сотрудника. */
export async function loadMyCurrentDay(userId: string): Promise<WorkDay | null> {
  const today = moscowDate()
  const yesterday = moscowDate(new Date(Date.now() - 86_400_000))
  const days = await listWorkDays(yesterday, today, userId)
  return days.find((d) => d.is_open && Date.now() - Date.parse(d.started_at) < 86_400_000) ?? days.find((d) => d.work_date === today) ?? null
}

async function call(fn: 'workday_start' | 'workday_break_start' | 'workday_break_end' | 'workday_finish') {
  const { error } = await client().rpc(fn)
  if (error) throw error
}

export const startWorkDay = () => call('workday_start')
export const startBreak = () => call('workday_break_start')
export const endBreak = () => call('workday_break_end')
export const finishWorkDay = () => call('workday_finish')

export async function correctWorkDay(input: {
  dayId: string | null
  workDate: string
  startedAt: string
  endedAt: string
  breakMinutes: number
  reason: string
}): Promise<void> {
  const { error } = await client().rpc('workday_correct', {
    p_day_id: input.dayId,
    p_work_date: input.workDate,
    p_started_at: input.startedAt,
    p_ended_at: input.endedAt,
    p_break_minutes: input.breakMinutes,
    p_reason: input.reason,
  })
  if (error) throw error
}

export async function loadWorkDayEdits(dayId: string): Promise<WorkDayEdit[]> {
  const { data, error } = await client()
    .from('work_day_edits')
    .select('id, work_day_id, edited_by, edited_at, reason, before, after')
    .eq('work_day_id', dayId)
    .order('edited_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as WorkDayEdit[]
}

/** Функции табеля ещё не в базе (миграция не применена). */
export function isTimesheetMissing(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  return code === 'PGRST202' || code === '42883' || code === '42P01' || code === 'PGRST205'
}

/** «7 ч 45 мин», «45 мин», «0 мин». */
export function formatWorkMinutes(total: number): string {
  const m = Math.max(0, Math.round(total))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (!h) return `${rest} мин`
  return rest ? `${h} ч ${String(rest).padStart(2, '0')} мин` : `${h} ч`
}

/** «7:45» — для таблиц табеля, где важна плотность. */
export function formatHoursShort(total: number): string {
  const m = Math.max(0, Math.round(total))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

export function timeHM(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(iso))
}
