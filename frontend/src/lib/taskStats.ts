/**
 * Статистика задач для «Аналитики» — одни правила для всех цифр блока и
 * KPI «Выполнено задач»:
 *
 *   в работе     — сейчас не выполнены (todo / in_progress / review);
 *   просрочено   — не выполнены и срок раньше сегодня;
 *   выполнено    — переведены в «Выполнено» внутри периода. Момент берётся
 *                  из истории задачи (task_events, status_changed → done),
 *                  если записи нет — по updated_at;
 *   вовремя      — из выполненных за период: закрыты не позже дня срока.
 */
import { supabase } from '@/lib/supabase'
import { taskDueDateToYmd, type TaskRow, type TaskStatus } from '@/lib/tasksSupabase'

/** Когда задачу последний раз перевели в «Выполнено»: task_id → ISO. */
export async function loadTaskDoneMoments(sinceISO: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!supabase) return out
  const { data, error } = await supabase
    .from('task_events')
    .select('task_id, created_at, payload')
    .eq('event_type', 'status_changed')
    .gte('created_at', sinceISO)
    .order('created_at', { ascending: true })
    .limit(5000)
  if (error) throw error
  for (const r of data ?? []) {
    const to = (r.payload as { to?: string } | null)?.to
    if (to === 'done') out.set(r.task_id as string, r.created_at as string)
  }
  return out
}

const ymdLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export type AssigneeTaskStats = {
  assigneeId: string
  open: number
  overdue: number
  done: number
  onTime: number
}

export type TaskStats = {
  open: number
  overdue: number
  done: number
  onTimePct: number | null
  byStatus: { status: Exclude<TaskStatus, 'done'>; count: number }[]
  byAssignee: AssigneeTaskStats[]
  attention: { task: TaskRow; overdueDays: number }[]
}

export function computeTaskStats(
  tasks: TaskRow[],
  doneMoments: Map<string, string>,
  range: { start: Date; end: Date },
  assigneeId: string | null,
  now = new Date(),
): TaskStats {
  const today = ymdLocal(now)
  const list = assigneeId ? tasks.filter((t) => t.assignee_id === assigneeId) : tasks
  const t0 = range.start.getTime()
  const t1 = range.end.getTime()

  const status = { todo: 0, in_progress: 0, review: 0 }
  const per = new Map<string, AssigneeTaskStats>()
  const row = (id: string) => {
    let r = per.get(id)
    if (!r) per.set(id, (r = { assigneeId: id, open: 0, overdue: 0, done: 0, onTime: 0 }))
    return r
  }
  let open = 0
  let overdue = 0
  let done = 0
  let onTime = 0
  const attention: { task: TaskRow; overdueDays: number }[] = []

  for (const t of list) {
    const due = taskDueDateToYmd(t.due_date)
    if (t.status !== 'done') {
      open += 1
      status[t.status] += 1
      const isOver = Boolean(due && due < today)
      if (isOver) {
        overdue += 1
        const days = Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${due}T12:00:00`)) / 86_400_000)
        attention.push({ task: t, overdueDays: days })
      }
      if (t.assignee_id) {
        const r = row(t.assignee_id)
        r.open += 1
        if (isOver) r.overdue += 1
      }
      continue
    }
    const at = Date.parse(doneMoments.get(t.id) ?? t.updated_at)
    if (Number.isNaN(at) || at < t0 || at > t1) continue
    done += 1
    const inTime = !due || ymdLocal(new Date(at)) <= due
    if (inTime) onTime += 1
    if (t.assignee_id) {
      const r = row(t.assignee_id)
      r.done += 1
      if (inTime) r.onTime += 1
    }
  }

  attention.sort((a, b) => b.overdueDays - a.overdueDays)
  return {
    open,
    overdue,
    done,
    onTimePct: done ? Math.round((onTime / done) * 100) : null,
    byStatus: (['todo', 'in_progress', 'review'] as const).map((s) => ({ status: s, count: status[s] })),
    byAssignee: [...per.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open || b.done - a.done),
    attention: attention.slice(0, 5),
  }
}
