<script setup lang="ts">
import StatusDonutChart from '@/components/ui/charts/StatusDonutChart.vue'
import CountBarChart from '@/components/ui/charts/CountBarChart.vue'
import { Button } from '@/components/ui/shadcn/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/shadcn/toggle-group'
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon, RefreshCcwIcon } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Progress } from '@/components/ui/shadcn/progress'
import PageToolbar from '@/components/ui/layout/PageToolbar.vue'
import UiBadge, { type UiBadgeTone } from '@/components/ui/UiBadge.vue'
import UiDatePicker from '@/components/ui/UiDatePicker.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, onMounted, onActivated, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useSupabaseCheck } from '@/composables/useSupabaseCheck'
import { useAuth } from '@/stores/auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  loadProfiles,
  loadTasksFromSupabase,
  taskDueDateToYmd,
  type ProfileRow,
  type TaskRow,
  type TaskStatus,
} from '@/lib/tasksSupabase'
import {
  loadDowntimesFromSupabase,
  loadOperationsFromSupabase,
  fetchOperationEmployeeStatsPage,
  loadOperationsForEmployeeInDateRange,
} from '@/lib/analyticsSupabase'
import { loadOperatorStatusesFromSupabase, type OperatorStatusRow } from '@/lib/operatorStatusSupabase'
import { loadEquipment, type EquipmentRow } from '@/lib/equipmentSupabase'
import { loadFields, type FieldRow } from '@/lib/fieldsSupabase'
import { avatarColorByPosition } from '@/lib/avatarColors'
import type { StoredOperation } from '@/lib/operationStorage'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UserAvatar from '@/components/UserAvatar.vue'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isLikelyUuid(s: string): boolean {
  return UUID_RE.test(s)
}

const { status: supabaseStatus, errorMessage: supabaseError, check: checkSupabase } = useSupabaseCheck()
const auth = useAuth()
const isManager = computed(() => auth.userRole.value === 'manager')

const loading = ref(true)
const profiles = ref<ProfileRow[]>([])
const tasks = ref<TaskRow[]>([])
const operatorStatuses = ref<OperatorStatusRow[]>([])
const equipmentList = ref<EquipmentRow[]>([])
const downtimes = ref<Awaited<ReturnType<typeof loadDowntimesFromSupabase>>>([])
const operations = ref<Awaited<ReturnType<typeof loadOperationsFromSupabase>>>([])
const fieldsCatalog = ref<FieldRow[]>([])

const periodPreset = ref<'today' | 'week' | 'month'>('today')
const dateFrom = ref('')
const dateTo = ref('')
const selectedEmployeeId = ref<string>('')

const liveTick = ref(0)
let liveTimer: ReturnType<typeof setInterval> | null = null

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseYmd(s: string): Date {
  const [y, m, day] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, day || 1, 12, 0, 0)
}

function applyPeriodPreset() {
  const now = new Date()
  if (periodPreset.value === 'today') {
    dateFrom.value = toYmd(now)
    dateTo.value = toYmd(now)
  } else if (periodPreset.value === 'week') {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    dateFrom.value = toYmd(start)
    dateTo.value = toYmd(end)
  } else {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12, 0, 0)
    dateFrom.value = toYmd(start)
    dateTo.value = toYmd(end)
  }
}


const rangeBounds = computed(() => {
  const start = parseYmd(dateFrom.value || toYmd(new Date()))
  start.setHours(0, 0, 0, 0)
  const end = parseYmd(dateTo.value || dateFrom.value || toYmd(new Date()))
  end.setHours(23, 59, 59, 999)
  return { start, end }
})

/** Предыдущий интервал той же длины (для сравнения простоев) */
const previousRangeBounds = computed(() => {
  const { start, end } = rangeBounds.value
  const ms = end.getTime() - start.getTime()
  const prevEnd = new Date(start.getTime() - 1)
  const prevStart = new Date(prevEnd.getTime() - ms)
  return { start: prevStart, end: prevEnd }
})

/** Для блока Live и KPI «из N работников» — без руководителей */
const workerProfiles = computed(() =>
  profiles.value.filter((p) => p.role !== 'manager'),
)

/** Карточки Live: работники + все, кто указан исполнителем в загруженных задачах (даже если роль «руководитель»). */
const profilesForLiveBoard = computed(() => {
  const dayAgoTs = Date.now() - 24 * 60 * 60 * 1000
  const isRecent = (p: ProfileRow) => {
    const raw = p.last_activity_at
    if (!raw) return false
    const ts = new Date(raw).getTime()
    return Number.isFinite(ts) && ts >= dayAgoTs
  }

  const byId = new Map<string, ProfileRow>()
  for (const p of workerProfiles.value) {
    if (isRecent(p)) byId.set(p.id, p)
  }
  for (const t of tasks.value) {
    if (!t.assignee_id) continue
    const p = profileById.value.get(t.assignee_id)
    if (p && isRecent(p)) byId.set(p.id, p)
  }
  return Array.from(byId.values()).sort((a, b) => {
    const na = (a.display_name || a.email).toLowerCase()
    const nb = (b.display_name || b.email).toLowerCase()
    return na.localeCompare(nb, 'ru')
  })
})

function resolveFieldIdByTaskField(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  for (const f of fieldsCatalog.value) {
    if (f.name === t) return f.id
  }
  const norm = t.toLowerCase()
  for (const f of fieldsCatalog.value) {
    const longForm = `поле №${f.number} — ${f.name}`.toLowerCase()
    if (norm === longForm || norm.includes(f.name.toLowerCase())) return f.id
  }
  return null
}

/** Ссылка на карточку поля: uuid из оператора или сопоставление по названию из справочника полей. */
function resolveFieldRouteId(fieldIdText: string | null | undefined, fieldName: string | null | undefined): string | null {
  if (fieldIdText && isLikelyUuid(fieldIdText)) return fieldIdText
  const name = fieldName?.trim()
  if (name) {
    const byName = resolveFieldIdByTaskField(name)
    if (byName) return byName
  }
  if (fieldIdText?.trim()) {
    const byRaw = resolveFieldIdByTaskField(fieldIdText)
    if (byRaw) return byRaw
  }
  return null
}

function fieldDetailLinkForStatus(st: OperatorStatusRow | undefined): string | null {
  if (!st) return null
  return resolveFieldRouteId(st.field_id, st.field_name)
}

function displayFieldLabelForStatus(st: OperatorStatusRow): string {
  const id = resolveFieldRouteId(st.field_id, st.field_name)
  if (id) {
    const f = fieldsCatalog.value.find((x) => x.id === id)
    if (f) return `Поле №${f.number} — ${f.name}`
  }
  return st.field_name?.trim() || 'Поле'
}

const profilesForEmployeeFilter = computed(() =>
  [...profiles.value].sort((a, b) => {
    const na = (a.display_name || a.email).toLowerCase()
    const nb = (b.display_name || b.email).toLowerCase()
    return na.localeCompare(nb, 'ru')
  }),
)

const profileById = computed(() => new Map(profiles.value.map((p) => [p.id, p])))

const equipmentById = computed(() => new Map(equipmentList.value.map((e) => [e.id, e])))

function equipmentTitle(id: string | null | undefined): string {
  if (!id) return 'Техника не назначена'
  const e = equipmentById.value.get(id)
  if (!e) return 'Техника'
  const m = e.model?.trim()
  return m ? `${e.brand} ${m}` : `${e.brand} ${e.license_plate}`
}

function initials(p: ProfileRow): string {
  const name = (p.display_name || '').trim()
  const email = p.email || ''
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase()
    return parts[0][0].toUpperCase()
  }
  const local = email.split('@')[0]
  return local.length >= 2 ? local.slice(0, 2).toUpperCase() : local[0]?.toUpperCase() || '?'
}

function shortName(p: ProfileRow): string {
  const name = (p.display_name || '').trim()
  if (!name) return p.email.split('@')[0] || '—'
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]} ${parts[1][0]}.`
  return name
}

function avatarBg(p: ProfileRow): string {
  if (p.position?.trim()) return avatarColorByPosition(p.position)
  return avatarColorByPosition(p.email || p.id)
}

const statusByUserId = computed(() => {
  const m = new Map<string, OperatorStatusRow>()
  for (const s of operatorStatuses.value) {
    m.set(s.user_id, s)
  }
  return m
})

const filteredWorkersForLive = computed(() => {
  if (selectedEmployeeId.value) {
    const one = profiles.value.find((p) => p.id === selectedEmployeeId.value)
    return one ? [one] : []
  }
  return profilesForLiveBoard.value
})

const kpiInOperationCount = computed(() => {
  let rows = operatorStatuses.value.filter((s) => s.kind === 'operation')
  if (selectedEmployeeId.value) {
    rows = rows.filter((s) => s.user_id === selectedEmployeeId.value)
  }
  return rows.length
})

const kpiTotalWorkers = computed(() => {
  if (selectedEmployeeId.value) return 1
  return Math.max(profilesForLiveBoard.value.length, 1)
})

const kpiEquipmentInUse = computed(() => {
  const set = new Set<string>()
  for (const s of operatorStatuses.value) {
    if (s.kind === 'operation' && s.equipment_id) {
      if (selectedEmployeeId.value && s.user_id !== selectedEmployeeId.value) continue
      set.add(s.equipment_id)
    }
  }
  return set.size
})

const kpiTotalEquipment = computed(() => equipmentList.value.length)

function downtimeMinutesInRange(
  start: Date,
  end: Date,
  list: typeof downtimes.value,
): number {
  let sum = 0
  for (const e of list) {
    const t = new Date(e.startISO).getTime()
    if (t >= start.getTime() && t <= end.getTime()) {
      sum += e.durationMinutes
    }
  }
  return sum
}

const kpiDowntimeHours = computed(() => {
  const { start, end } = rangeBounds.value
  let list = downtimes.value
  if (selectedEmployeeId.value) {
    const p = profileById.value.get(selectedEmployeeId.value)
    const label = p ? (p.display_name || p.email).trim() : ''
    if (label) {
      list = list.filter((d) => d.employee === label || d.employee.includes(label))
    }
  }
  return downtimeMinutesInRange(start, end, list) / 60
})

const kpiDowntimeTrend = computed(() => {
  const cur = kpiDowntimeHours.value
  const { start, end } = previousRangeBounds.value
  let list = downtimes.value
  if (selectedEmployeeId.value) {
    const p = profileById.value.get(selectedEmployeeId.value)
    const label = p ? (p.display_name || p.email).trim() : ''
    if (label) list = list.filter((d) => d.employee === label || d.employee.includes(label))
  }
  const prevH = downtimeMinutesInRange(start, end, list) / 60
  if (prevH <= 0 && cur <= 0) return null
  if (prevH <= 0) return { pct: 100, up: true }
  const pct = Math.round(((cur - prevH) / prevH) * 100)
  return { pct: Math.abs(pct), up: pct >= 0 }
})

/**
 * Выполненные задачи по сроку (due_date):
 * — если в фильтре один день (С = По): все со сроком **не позже** этой даты (накопительно «до даты»);
 * — если интервал: срок строго внутри «С»–«По» включительно.
 */
const tasksCompletedDueInFilter = computed(() => {
  const from = dateFrom.value
  const to = dateTo.value
  if (!to) return 0
  const singleDay = Boolean(from && from === to)
  return tasks.value.filter((t) => {
    const dueYmd = taskDueDateToYmd(t.due_date)
    if (!dueYmd) return false
    if (t.status !== 'done') return false
    if (singleDay) {
      if (dueYmd > to) return false
    } else {
      if (!from || dueYmd < from || dueYmd > to) return false
    }
    if (selectedEmployeeId.value && t.assignee_id !== selectedEmployeeId.value) return false
    return true
  }).length
})

const tasksKpiTitle = computed(() => 'Задачи по сроку (выполненные)')

const tasksKpiRangeHint = computed(() => {
  if (!dateTo.value) return ''
  if (dateFrom.value && dateFrom.value === dateTo.value) {
    const d = parseYmd(dateTo.value)
    return `срок не позже ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
  }
  const ru = (ymd: string) => parseYmd(ymd).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  if (dateFrom.value) {
    return `срок с ${ru(dateFrom.value)} по ${ru(dateTo.value)}`
  }
  return `срок до ${ru(dateTo.value)}`
})

/** Для одного дня — на странице задач открываем фильтр «до даты» без нижней границы по сроку. */
const tasksKpiLinkQuery = computed(() => {
  const from = dateFrom.value
  const to = dateTo.value
  if (from && to && from === to) {
    return { due_to: to, due_upto: '1', kpi_completed_due: '1' }
  }
  return { due_from: from, due_to: to, kpi_completed_due: '1' }
})

const tasksInRange = computed(() => {
  const { start, end } = rangeBounds.value
  return tasks.value.filter((t) => {
    if (selectedEmployeeId.value && t.assignee_id !== selectedEmployeeId.value) return false
    const u = new Date(t.updated_at).getTime()
    return u >= start.getTime() && u <= end.getTime()
  })
})

const taskStatusLabels: Record<TaskStatus, string> = {
  done: 'Выполнено',
  in_progress: 'В процессе',
  review: 'На проверке',
  todo: 'К выполнению',
}

const taskDonut = computed(() => {
  const list = tasksInRange.value
  const done = list.filter((t) => t.status === 'done').length
  const prog = list.filter((t) => t.status === 'in_progress').length
  const review = list.filter((t) => t.status === 'review').length
  const todo = list.filter((t) => t.status === 'todo').length
  const total = list.length
  if (!total) {
    return { total: 0, slices: [] as { key: string; label: string; count: number; pct: number; color: string }[] }
  }
  const slices = [
    { key: 'done', label: taskStatusLabels.done, count: done, pct: (done / total) * 100, color: 'var(--chart-5)' },
    { key: 'in_progress', label: taskStatusLabels.in_progress, count: prog, pct: (prog / total) * 100, color: 'var(--chart-2)' },
    { key: 'review', label: taskStatusLabels.review, count: review, pct: (review / total) * 100, color: 'var(--chart-3)' },
    { key: 'todo', label: taskStatusLabels.todo, count: todo, pct: (todo / total) * 100, color: 'var(--chart-4)' },
  ].filter((s) => s.count > 0)
  return { total, slices }
})

const taskDonutGradient = computed(() => {
  const { slices } = taskDonut.value
  if (!slices.length) return { background: 'var(--donut-inner-bg)' }
  let acc = 0
  const parts = slices.map((s) => {
    const start = acc
    acc += s.pct
    return `${s.color} ${start}% ${acc}%`
  })
  return { background: `conic-gradient(${parts.join(', ')})` }
})

/** Вертикальные столбцы: высота = только «Выполнено»; шкала Y — по максимуму активных задач в периоде (не done), чтобы видеть объём активной работы. */
const taskEmployeeBarChart = computed(() => {
  const { start, end } = rangeBounds.value
  const t0 = start.getTime()
  const t1 = end.getTime()

  const activeByAssignee = new Map<string, number>()
  for (const t of tasks.value) {
    if (!t.assignee_id) continue
    if (selectedEmployeeId.value && t.assignee_id !== selectedEmployeeId.value) continue
    if (t.status === 'done') continue
    const u = new Date(t.updated_at).getTime()
    if (u < t0 || u > t1) continue
    activeByAssignee.set(t.assignee_id, (activeByAssignee.get(t.assignee_id) ?? 0) + 1)
  }
  const maxActive = activeByAssignee.size ? Math.max(...activeByAssignee.values()) : 0

  const doneMap = new Map<string, { id: string; label: string; count: number }>()
  for (const t of tasks.value) {
    if (!t.assignee_id) continue
    if (t.status !== 'done') continue
    if (selectedEmployeeId.value && t.assignee_id !== selectedEmployeeId.value) continue
    const u = new Date(t.updated_at).getTime()
    if (u < t0 || u > t1) continue
    const existing = doneMap.get(t.assignee_id)
    const p = profileById.value.get(t.assignee_id)
    doneMap.set(t.assignee_id, {
      id: t.assignee_id,
      label: p ? shortName(p) : '—',
      count: (existing?.count ?? 0) + 1,
    })
  }
  const rows = Array.from(doneMap.values())
    .filter((r) => r.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.label.localeCompare(b.label, 'ru')
    })
    .slice(0, 8)

  const maxDone = rows.length ? Math.max(...rows.map((r) => r.count)) : 0
  const scaleRaw = Math.max(1, maxActive, maxDone)
  const roughStep = Math.max(1, Math.ceil(scaleRaw / 4))
  const niceSteps = [1, 2, 5, 10, 15, 20, 25, 50, 100]
  const niceStep = niceSteps.find((n) => n >= roughStep) ?? Math.ceil(roughStep / 10) * 10
  const yTop = Math.max(niceStep, Math.ceil(scaleRaw / niceStep) * niceStep)
  const yTicks: number[] = []
  for (let v = yTop; v >= 0; v -= niceStep) yTicks.push(v)
  return { rows, yTop, yTicks }
})

function categoryLabelRu(cat: string | null | undefined): string {
  const c = (cat || '').toLowerCase()
  if (c === 'breakdown') return 'Поломка техники'
  if (c === 'rain') return 'Погода'
  if (c === 'fuel') return 'Нет топлива'
  if (c === 'waiting') return 'Ожидание'
  return cat || 'Простой'
}

function elapsedLabel(startedAt: string): string {
  void liveTick.value
  const start = new Date(startedAt).getTime()
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}ч ${m}м`
  return `${m} мин`
}

function shiftProgressForUser(userId: string): number {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  let minutes = 0
  for (const o of operations.value) {
    if (new Date(o.startISO) < startOfDay) continue
    const p = profileById.value.get(userId)
    const name = p ? (p.display_name || p.email).trim() : ''
    if (name && o.employee === name) minutes += o.durationMinutes
  }
  const st = statusByUserId.value.get(userId)
  void liveTick.value
  if (st?.kind === 'operation') {
    const extra = Math.max(0, (Date.now() - new Date(st.started_at).getTime()) / 60000)
    minutes += extra
  }
  const target = 8 * 60
  return Math.min(100, Math.round((minutes / target) * 100))
}

/** Активные поля: только строки operator_status с реальной операцией на поле (не задачи из календаря). */
const activeFieldsRows = computed(() => {
  const rows = operatorStatuses.value.filter((s) => {
    if (s.kind !== 'operation') return false
    if (selectedEmployeeId.value && s.user_id !== selectedEmployeeId.value) return false
    const hasField = !!(s.field_id?.trim() || s.field_name?.trim())
    return hasField
  })
  return [...rows]
    .sort((a, b) => {
      const la = displayFieldLabelForStatus(a)
      const lb = displayFieldLabelForStatus(b)
      const cmp = la.localeCompare(lb, 'ru')
      if (cmp !== 0) return cmp
      return a.employee.localeCompare(b.employee, 'ru')
    })
    .slice(0, 24)
    .map((st) => ({
      st,
      fieldLabel: displayFieldLabelForStatus(st),
      fieldDetailId: resolveFieldRouteId(st.field_id, st.field_name),
      assigneeName: st.employee?.trim() || '—',
      progress: shiftProgressForUser(st.user_id),
    }))
})

function equipmentUsageLabel(eqId: string): 'work' | 'idle' {
  for (const s of operatorStatuses.value) {
    if (s.kind === 'operation' && s.equipment_id === eqId) return 'work'
  }
  return 'idle'
}

function equipmentConditionBadge(eq: EquipmentRow): { text: string; tone: 'ok' | 'warn' | 'muted' | 'active' } {
  if (eq.condition === 'repair') {
    return { text: 'В ремонте', tone: 'warn' }
  }
  if (eq.condition === 'decommissioned') {
    return { text: 'Выведена', tone: 'muted' }
  }
  if (equipmentUsageLabel(eq.id) === 'work') {
    return { text: 'В работе', tone: 'active' }
  }
  return { text: 'Исправна', tone: 'ok' }
}

function equipmentRowSortPriority(tone: 'ok' | 'warn' | 'muted' | 'active'): number {
  if (tone === 'active') return 0
  if (tone === 'warn') return 1
  if (tone === 'muted') return 2
  return 3
}

/** Последние замеры топлива и состояния из завершённых операций (по дате окончания). */
type EquipmentLastOpMetrics = {
  fuelPct: number | null
  conditionPct: number | null
  conditionLabel: string | null
  /** Время окончания операции, по которой взяты замеры (для сортировки «по взаимодействию»). */
  lastEndedAtMs: number
}

const latestEquipmentOpMetrics = computed(() => {
  const m = new Map<string, EquipmentLastOpMetrics>()
  const sorted = [...operations.value]
    .filter((o) => o.equipmentId)
    .sort((a, b) => new Date(b.endISO).getTime() - new Date(a.endISO).getTime())
  for (const o of sorted) {
    const id = o.equipmentId as string
    if (m.has(id)) continue
    const left = o.equipmentFuelLeftPercent
    const start = o.equipmentFuelPercent
    let fuelPct: number | null = null
    if (left != null && !Number.isNaN(Number(left))) fuelPct = Math.round(Number(left))
    else if (start != null && !Number.isNaN(Number(start))) fuelPct = Math.round(Number(start))
    const cv = o.equipmentConditionValue
    const conditionPct =
      cv != null && !Number.isNaN(Number(cv)) ? Math.round(Number(cv)) : null
    const endMs = new Date(o.endISO).getTime()
    m.set(id, {
      fuelPct,
      conditionPct,
      conditionLabel: o.equipmentConditionLabel?.trim() || null,
      lastEndedAtMs: Number.isNaN(endMs) ? 0 : endMs,
    })
  }
  return m
})

/** Для сортировки: «в работе» — по последней активности статуса; иначе — по последней завершённой операции. */
function equipmentInteractionTimestampMs(
  eqId: string,
  badgeTone: 'ok' | 'warn' | 'muted' | 'active',
  metrics: EquipmentLastOpMetrics | undefined,
): number {
  if (badgeTone === 'active') {
    let best = 0
    for (const s of operatorStatuses.value) {
      if (s.equipment_id !== eqId || s.kind !== 'operation') continue
      const st = new Date(s.started_at).getTime()
      if (!Number.isNaN(st)) best = Math.max(best, st)
      if (s.updated_at) {
        const u = new Date(s.updated_at).getTime()
        if (!Number.isNaN(u)) best = Math.max(best, u)
      }
    }
    return best
  }
  return metrics?.lastEndedAtMs ?? 0
}

function equipmentCatalogStateLabel(eq: EquipmentRow): string {
  if (eq.condition === 'repair') return 'В ремонте'
  if (eq.condition === 'decommissioned') return 'Выведена'
  return 'Исправна'
}

function equipmentDashFuelText(metrics: EquipmentLastOpMetrics | undefined): string {
  if (metrics?.fuelPct != null) return `${metrics.fuelPct}%`
  return '—'
}

function equipmentDashStateText(eq: EquipmentRow, metrics: EquipmentLastOpMetrics | undefined): string {
  if (metrics?.conditionLabel) return metrics.conditionLabel
  if (metrics?.conditionPct != null) return `${metrics.conditionPct}%`
  return equipmentCatalogStateLabel(eq)
}

function fuelBarClass(pct: number): string {
  if (pct < 34) return 'bg-red-500'
  if (pct < 67) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function equipmentBadgeTone(tone: 'ok' | 'warn' | 'muted' | 'active'): UiBadgeTone {
  return ({ ok: 'success', warn: 'danger', muted: 'neutral', active: 'info' } as const)[tone]
}

/** Часы по-русски: «0,0», «12,5». */
function formatHours(h: number): string {
  return h.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

const equipmentRows = computed(() => {
  const metricsMap = latestEquipmentOpMetrics.value
  const rows = equipmentList.value.map((eq) => {
    let operatorName = '—'
    for (const s of operatorStatuses.value) {
      if (s.equipment_id === eq.id && s.kind === 'operation') {
        operatorName = s.employee
        break
      }
    }
    const badge = equipmentConditionBadge(eq)
    const metrics = metricsMap.get(eq.id)
    return { eq, operatorName, badge, metrics }
  })
  rows.sort((a, b) => {
    const pa = equipmentRowSortPriority(a.badge.tone)
    const pb = equipmentRowSortPriority(b.badge.tone)
    if (pa !== pb) return pa - pb
    const ta = equipmentInteractionTimestampMs(a.eq.id, a.badge.tone, a.metrics)
    const tb = equipmentInteractionTimestampMs(b.eq.id, b.badge.tone, b.metrics)
    if (tb !== ta) return tb - ta
    const na = `${a.eq.brand} ${a.eq.model || a.eq.license_plate}`.trim()
    const nb = `${b.eq.brand} ${b.eq.model || b.eq.license_plate}`.trim()
    return na.localeCompare(nb, 'ru')
  })
  return rows
})

type OperationStatSortKey = 'ended' | 'duration' | 'employee' | 'field' | 'operation'

type OperationStatRow = {
  id: number
  employee: string
  fieldLabel: string
  fieldRouteId: string | null
  operationLabel: string
  durationMinutes: number
  endedAt: string
}

type OperationStatGroup = {
  key: string
  employee: string
  totalMinutes: number
  operationCount: number
  fieldsCount: number
  latestEndedAt: string
}

function fieldLabelForOperationRow(op: StoredOperation): string {
  if (op.fieldName?.trim()) return op.fieldName.trim()
  if (op.fieldId && isLikelyUuid(op.fieldId)) {
    const f = fieldsCatalog.value.find((x) => x.id === op.fieldId)
    if (f) return `Поле №${f.number} — ${f.name}`
    return 'Поле'
  }
  return '—'
}

function fieldRouteIdForOperation(op: StoredOperation): string | null {
  if (op.fieldId && isLikelyUuid(op.fieldId)) return op.fieldId
  const name = op.fieldName?.trim()
  if (name) {
    const id = resolveFieldIdByTaskField(name)
    if (id) return id
  }
  return null
}

function formatDurationMinutesShort(m: number): string {
  const n = Math.max(0, Math.floor(m))
  if (n < 60) return `${n} мин`
  const h = Math.floor(n / 60)
  const min = n % 60
  if (min === 0) return `${h} ч`
  return `${h} ч ${min} мин`
}

function formatOperationEndedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function operationsCountLabelRu(n: number): string {
  const k = Math.abs(n) % 100
  const k1 = k % 10
  if (k >= 11 && k <= 14) return `${n} операций`
  if (k1 === 1) return `${n} операция`
  if (k1 >= 2 && k1 <= 4) return `${n} операции`
  return `${n} операций`
}

function fieldsCountLabelRu(n: number): string {
  const k = Math.abs(n) % 100
  const k1 = k % 10
  if (k >= 11 && k <= 14) return `${n} полей`
  if (k1 === 1) return `${n} поле`
  if (k1 >= 2 && k1 <= 4) return `${n} поля`
  return `${n} полей`
}

const operationStatsSortKey = ref<OperationStatSortKey>('ended')
const OPERATION_SORT_OPTIONS: { key: OperationStatSortKey; label: string }[] = [
  { key: 'employee', label: 'Сотрудник' },
  { key: 'operation', label: 'Число операций' },
  { key: 'field', label: 'Полей' },
  { key: 'duration', label: 'Время' },
  { key: 'ended', label: 'Последняя' },
]
const operationStatsSortDir = ref<'asc' | 'desc'>('desc')

function setOperationStatsSort(key: OperationStatSortKey) {
  if (operationStatsSortKey.value === key) {
    operationStatsSortDir.value = operationStatsSortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    operationStatsSortKey.value = key
    operationStatsSortDir.value = key === 'ended' || key === 'duration' ? 'desc' : 'asc'
  }
  operationStatsPage.value = 1
}

function operationStatsSortMark(key: OperationStatSortKey): string {
  if (operationStatsSortKey.value !== key) return ''
  return operationStatsSortDir.value === 'asc' ? '↑' : '↓'
}

const operationStatsSummaries = ref<OperationStatGroup[]>([])
const operationStatsTotal = ref(0)
const operationStatsPage = ref(1)
const operationStatsPageSize = ref(15)
const operationStatsListLoading = ref(false)
const operationStatsDetailByEmployee = ref<Record<string, OperationStatRow[]>>({})
const operationStatsDetailTotalByEmployee = ref<Record<string, number>>({})
const operationStatsDetailLoading = ref<Record<string, boolean>>({})
const operationStatsDetailLoadingMore = ref<Record<string, boolean>>({})

/** Размер порции при раскрытии сводки по сотруднику (операции по полям). */
const OPERATION_DETAIL_PAGE_SIZE = 10

const operationStatsTotalPages = computed(() =>
  Math.max(1, Math.ceil(operationStatsTotal.value / operationStatsPageSize.value)),
)

const expandedOperationGroupKey = ref<string | null>(null)

async function loadOperationStatsSummariesPage() {
  operationStatsListLoading.value = true
  try {
    if (!isSupabaseConfigured() || !auth.user.value) {
      operationStatsSummaries.value = []
      operationStatsTotal.value = 0
      return
    }
    const { start, end } = rangeBounds.value
    const uid = auth.user.value.id
    const onlyMine = !isManager.value
    let empFilter: string | null = null
    if (selectedEmployeeId.value) {
      const p = profileById.value.get(selectedEmployeeId.value)
      empFilter = p ? (p.display_name || p.email).trim() || null : null
    }
    const { rows, total } = await fetchOperationEmployeeStatsPage({
      endFromIso: start.toISOString(),
      endToIso: end.toISOString(),
      onlyMine,
      userId: uid,
      employeeFilter: empFilter,
      sort: operationStatsSortKey.value,
      desc: operationStatsSortDir.value === 'desc',
      page: operationStatsPage.value,
      pageSize: operationStatsPageSize.value,
    })
    operationStatsTotal.value = total
    operationStatsSummaries.value = rows.map((r) => ({
      key: r.employee,
      employee: r.employee,
      totalMinutes: r.total_duration_minutes,
      operationCount: r.operation_count,
      fieldsCount: r.distinct_fields,
      latestEndedAt: r.latest_end_iso,
    }))
  } finally {
    operationStatsListLoading.value = false
  }
}

function clearOperationStatsExpansion() {
  expandedOperationGroupKey.value = null
  operationStatsDetailByEmployee.value = {}
  operationStatsDetailTotalByEmployee.value = {}
  operationStatsDetailLoading.value = {}
  operationStatsDetailLoadingMore.value = {}
}

function operationDetailRemaining(employeeKey: string): number {
  const loaded = operationStatsDetailByEmployee.value[employeeKey]?.length ?? 0
  const total = operationStatsDetailTotalByEmployee.value[employeeKey] ?? 0
  return Math.max(0, total - loaded)
}

async function loadOperationDetailsPage(employeeKey: string, reset: boolean) {
  if (!isSupabaseConfigured() || !auth.user.value) return
  const prev = operationStatsDetailByEmployee.value[employeeKey] ?? []
  const offset = reset ? 0 : prev.length

  if (reset) {
    operationStatsDetailLoading.value = { ...operationStatsDetailLoading.value, [employeeKey]: true }
  } else {
    operationStatsDetailLoadingMore.value = {
      ...operationStatsDetailLoadingMore.value,
      [employeeKey]: true,
    }
  }
  try {
    const { start, end } = rangeBounds.value
    const uid = auth.user.value.id
    const onlyMine = !isManager.value
    const { rows: ops, total } = await loadOperationsForEmployeeInDateRange(
      employeeKey,
      start.toISOString(),
      end.toISOString(),
      onlyMine,
      uid,
      { limit: OPERATION_DETAIL_PAGE_SIZE, offset },
    )
    const mapped: OperationStatRow[] = ops.map((o) => ({
      id: o.id,
      employee: (o.employee || '—').trim(),
      fieldLabel: fieldLabelForOperationRow(o),
      fieldRouteId: fieldRouteIdForOperation(o),
      operationLabel: (o.operation || '—').trim(),
      durationMinutes: o.durationMinutes,
      endedAt: o.endISO,
    }))
    operationStatsDetailByEmployee.value = {
      ...operationStatsDetailByEmployee.value,
      [employeeKey]: reset ? mapped : [...prev, ...mapped],
    }
    operationStatsDetailTotalByEmployee.value = {
      ...operationStatsDetailTotalByEmployee.value,
      [employeeKey]: total,
    }
  } finally {
    if (reset) {
      const next = { ...operationStatsDetailLoading.value }
      delete next[employeeKey]
      operationStatsDetailLoading.value = next
    } else {
      const next = { ...operationStatsDetailLoadingMore.value }
      delete next[employeeKey]
      operationStatsDetailLoadingMore.value = next
    }
  }
}

async function toggleOperationGroup(employeeKey: string) {
  if (expandedOperationGroupKey.value === employeeKey) {
    expandedOperationGroupKey.value = null
    return
  }
  expandedOperationGroupKey.value = employeeKey
  if ((operationStatsDetailByEmployee.value[employeeKey]?.length ?? 0) > 0) return
  await loadOperationDetailsPage(employeeKey, true)
}

function goOperationStatsPage(delta: number) {
  const next = operationStatsPage.value + delta
  if (next < 1 || next > operationStatsTotalPages.value) return
  operationStatsPage.value = next
}

watch(
  [operationStatsPage, operationStatsSortKey, operationStatsSortDir, dateFrom, dateTo, selectedEmployeeId],
  () => {
    clearOperationStatsExpansion()
    void loadOperationStatsSummariesPage()
  },
)

async function loadDashboard() {
  loading.value = true
  try {
    if (!isSupabaseConfigured() || !auth.user.value) {
      profiles.value = []
      tasks.value = []
      operatorStatuses.value = []
      equipmentList.value = []
      downtimes.value = []
      operations.value = []
      fieldsCatalog.value = []
      operationStatsSummaries.value = []
      operationStatsTotal.value = 0
      return
    }
    const uid = auth.user.value.id
    const onlyMine = !isManager.value
    const [prof, tsk, st, eq, down, ops, flds] = await Promise.all([
      loadProfiles(),
      loadTasksFromSupabase(onlyMine, uid),
      loadOperatorStatusesFromSupabase(onlyMine, uid),
      loadEquipment(),
      loadDowntimesFromSupabase(onlyMine, uid),
      loadOperationsFromSupabase(onlyMine, uid),
      loadFields(),
    ])
    profiles.value = prof
    tasks.value = tsk
    operatorStatuses.value = st
    equipmentList.value = eq
    downtimes.value = down
    operations.value = ops
    fieldsCatalog.value = flds
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
    void loadOperationStatsSummariesPage()
  }
}

onMounted(() => {
  applyPeriodPreset()
  loadDashboard()
  liveTimer = setInterval(() => {
    liveTick.value += 1
  }, 30000)
})
onActivated(() => loadDashboard())
onUnmounted(() => {
  if (liveTimer) clearInterval(liveTimer)
})

</script>

<template>
  <section class="tw-scope flex min-w-0 flex-col gap-6">
    <Alert v-if="supabaseStatus === 'error'" variant="destructive">
      <AlertDescription class="flex flex-wrap items-center gap-2">
        Нет связи с сервером: {{ supabaseError }}
        <Button variant="outline" size="sm" type="button" @click="checkSupabase">Повторить</Button>
      </AlertDescription>
    </Alert>

    <PageToolbar>
      <UiSelect
        v-if="isManager"
        v-model="selectedEmployeeId"
        block
        class="sm:w-56"
        :options="[{ value: '', label: 'Все сотрудники' }, ...profilesForEmployeeFilter.map((p) => ({ value: p.id, label: `${p.display_name || p.email}${p.role === 'manager' ? ' (руководитель)' : ''}` }))]"
        aria-label="Сотрудник"
      />
      <ToggleGroup
        type="single"
        variant="outline"
        aria-label="Период"
        :model-value="periodPreset"
        @update:model-value="(v) => { if (v === 'today' || v === 'week' || v === 'month') { periodPreset = v; applyPeriodPreset() } }"
      >
        <ToggleGroupItem value="today" class="px-3">Сегодня</ToggleGroupItem>
        <ToggleGroupItem value="week" class="px-3">Неделя</ToggleGroupItem>
        <ToggleGroupItem value="month" class="px-3">Месяц</ToggleGroupItem>
      </ToggleGroup>
      <div class="flex items-center gap-2">
        <UiDatePicker v-model="dateFrom" aria-label="Начало периода" />
        <span class="text-sm text-muted-foreground">—</span>
        <UiDatePicker v-model="dateTo" aria-label="Конец периода" />
      </div>
      <template #actions>
        <Button variant="outline" type="button" :disabled="loading" @click="loadDashboard">
          <RefreshCcwIcon :class="{ 'animate-spin': loading }" />
          Обновить
        </Button>
      </template>
    </PageToolbar>

    <div class="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <div class="grid content-start gap-1 rounded-xl border bg-card p-4 shadow-xs md:p-6">
        <span class="text-sm text-muted-foreground">Люди в полях</span>
        <span class="text-2xl font-semibold tabular-nums">{{ kpiInOperationCount }} <span class="text-sm font-normal text-muted-foreground">из {{ kpiTotalWorkers }}</span></span>
      </div>
      <div class="grid content-start gap-1 rounded-xl border bg-card p-4 shadow-xs md:p-6">
        <span class="text-sm text-muted-foreground">Техника в работе</span>
        <span class="text-2xl font-semibold tabular-nums">{{ kpiEquipmentInUse }} <span class="text-sm font-normal text-muted-foreground">из {{ kpiTotalEquipment }}</span></span>
      </div>
      <div class="grid content-start gap-1 rounded-xl border bg-card p-4 shadow-xs md:p-6">
        <span class="text-sm text-muted-foreground">Простои за период</span>
        <span class="flex flex-wrap items-baseline gap-x-2 text-2xl font-semibold tabular-nums">
          <span>{{ formatHours(kpiDowntimeHours) }} <span class="text-sm font-normal text-muted-foreground">ч</span></span>
          <UiBadge v-if="kpiDowntimeTrend" :tone="kpiDowntimeTrend.up ? 'danger' : 'success'">
            {{ kpiDowntimeTrend.up ? '↑' : '↓' }} {{ kpiDowntimeTrend.pct }}%
          </UiBadge>
        </span>
      </div>
      <RouterLink
        class="grid content-start gap-1 rounded-xl border bg-card p-4 text-foreground no-underline shadow-xs transition-colors hover:bg-muted/40 md:p-6"
        :to="{ name: 'task-management', query: tasksKpiLinkQuery }"
      >
        <span class="text-sm text-muted-foreground">Выполнено задач</span>
        <span class="text-2xl font-semibold tabular-nums">{{ tasksCompletedDueInFilter }}</span>
        <span class="text-xs text-muted-foreground">{{ tasksKpiRangeHint }}</span>
      </RouterLink>
    </div>

    <section class="flex flex-col gap-4">
      <h2 class="text-base font-semibold">Статус работы сотрудников</h2>
      <p v-if="!isSupabaseConfigured()" class="text-sm text-muted-foreground">Подключите базу, чтобы видеть статусы с экрана оператора.</p>
      <UiLoadingBar v-else-if="loading" size="md" />
      <div v-else-if="filteredWorkersForLive.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="p in filteredWorkersForLive"
          :key="p.id"
          class="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6"
          :class="{
            'border-t-4 border-t-emerald-500': statusByUserId.get(p.id)?.kind === 'operation',
            'border-t-4 border-t-destructive': statusByUserId.get(p.id)?.kind === 'downtime',
          }"
        >
          <div class="flex min-w-0 items-center gap-3">
            <UserAvatar class="size-9 text-sm font-medium text-white" :style="{ background: avatarBg(p) }" :url="p.avatar_url" :initials="initials(p)" />
            <div class="grid min-w-0 gap-1">
              <h3 class="truncate text-sm font-medium">{{ p.display_name || p.email }}</h3>
              <UiBadge v-if="statusByUserId.get(p.id)?.kind === 'operation'" tone="success" class="w-fit">В работе</UiBadge>
              <UiBadge v-else-if="statusByUserId.get(p.id)?.kind === 'downtime'" tone="danger" class="w-fit">Простой</UiBadge>
              <UiBadge v-else tone="neutral" class="w-fit">Ожидание задачи</UiBadge>
            </div>
          </div>

          <template v-if="statusByUserId.get(p.id)?.kind === 'operation'">
            <component
              :is="fieldDetailLinkForStatus(statusByUserId.get(p.id)) ? RouterLink : 'div'"
              v-bind="fieldDetailLinkForStatus(statusByUserId.get(p.id)) ? { to: { name: 'field-details', params: { id: fieldDetailLinkForStatus(statusByUserId.get(p.id))! } } } : {}"
              class="grid gap-0.5 rounded-lg bg-muted/60 p-3 text-foreground no-underline"
            >
              <span class="text-xs text-muted-foreground">{{ statusByUserId.get(p.id)?.field_name || 'Поле' }}</span>
              <span class="text-sm font-medium">{{ statusByUserId.get(p.id)?.operation || 'Операция' }}</span>
            </component>
            <div class="grid gap-2">
              <div class="flex justify-between text-xs text-muted-foreground">
                <span>Прогресс смены (оценка)</span>
                <span class="tabular-nums">{{ shiftProgressForUser(p.id) }}%</span>
              </div>
              <Progress :model-value="shiftProgressForUser(p.id)" class="h-1.5" />
            </div>
            <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <RouterLink
                v-if="statusByUserId.get(p.id)?.equipment_id"
                :to="{ name: 'equipment-details', params: { id: statusByUserId.get(p.id)!.equipment_id! } }"
                class="truncate text-primary no-underline hover:underline dark:text-ring"
              >
                {{ equipmentTitle(statusByUserId.get(p.id)?.equipment_id) }}
              </RouterLink>
              <span v-else class="truncate">{{ equipmentTitle(statusByUserId.get(p.id)?.equipment_id) }}</span>
              <span class="flex shrink-0 items-center gap-1 tabular-nums"><ClockIcon class="size-3.5" aria-hidden="true" />{{ elapsedLabel(statusByUserId.get(p.id)!.started_at) }}</span>
            </div>
          </template>

          <template v-else-if="statusByUserId.get(p.id)?.kind === 'downtime'">
            <component
              :is="fieldDetailLinkForStatus(statusByUserId.get(p.id)) ? RouterLink : 'div'"
              v-bind="fieldDetailLinkForStatus(statusByUserId.get(p.id)) ? { to: { name: 'field-details', params: { id: fieldDetailLinkForStatus(statusByUserId.get(p.id))! } } } : {}"
              class="grid gap-0.5 rounded-lg bg-destructive/10 p-3 text-foreground no-underline"
            >
              <span class="text-xs text-destructive">{{ categoryLabelRu(statusByUserId.get(p.id)?.downtime_category) }}</span>
              <span class="text-sm font-medium">{{ statusByUserId.get(p.id)?.downtime_reason || '—' }}</span>
            </component>
            <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span class="truncate">{{ statusByUserId.get(p.id)?.field_name || 'База' }}</span>
              <span class="flex shrink-0 items-center gap-1 text-destructive tabular-nums"><ClockIcon class="size-3.5" aria-hidden="true" />{{ elapsedLabel(statusByUserId.get(p.id)!.started_at) }}</span>
            </div>
          </template>

          <template v-else>
            <p class="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Нет активной операции</p>
            <div class="grid gap-2">
              <div class="flex justify-between text-xs text-muted-foreground">
                <span>Прогресс смены</span>
                <span class="tabular-nums">{{ shiftProgressForUser(p.id) }}%</span>
              </div>
              <Progress :model-value="shiftProgressForUser(p.id)" class="h-1.5" />
            </div>
          </template>
        </div>
      </div>
      <p v-else-if="isManager && isSupabaseConfigured()" class="text-sm text-muted-foreground">
        Сотрудников с ролью «Сотрудник» и исполнителей задач пока нет.
      </p>
    </section>

    <div class="grid items-start gap-6 lg:grid-cols-2">
      <div class="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-base font-semibold">Активные поля</h2>
          <RouterLink to="/fields" class="text-sm font-medium text-primary no-underline hover:underline dark:text-ring">Все поля</RouterLink>
        </div>
        <ul v-if="activeFieldsRows.length" class="grid divide-y divide-border">
          <li v-for="row in activeFieldsRows" :key="row.st.user_id" class="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem] sm:items-center sm:gap-4">
            <div class="grid min-w-0 gap-0.5">
              <RouterLink
                v-if="row.fieldDetailId"
                :to="{ name: 'field-details', params: { id: row.fieldDetailId } }"
                class="truncate text-sm font-medium text-foreground no-underline hover:underline"
              >
                {{ row.fieldLabel }}
              </RouterLink>
              <span v-else class="truncate text-sm font-medium">{{ row.fieldLabel }}</span>
              <span class="truncate text-xs text-muted-foreground">{{ row.assigneeName }}</span>
            </div>
            <span class="truncate text-sm">{{ row.st.operation || 'Операция' }}</span>
            <div class="flex items-center gap-2">
              <Progress :model-value="row.progress" class="h-1.5 flex-1" />
              <span class="w-9 text-right text-xs tabular-nums">{{ row.progress }}%</span>
            </div>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">Нет активных операций на полях.</p>
      </div>

      <div class="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
        <h2 class="text-base font-semibold">Статус техники</h2>
        <ul v-if="equipmentRows.length" class="grid max-h-[28rem] divide-y divide-border overflow-y-auto">
          <li v-for="{ eq, operatorName, badge, metrics } in equipmentRows" :key="eq.id" class="py-3 first:pt-0 last:pb-0">
            <RouterLink :to="{ name: 'equipment-details', params: { id: eq.id } }" class="grid gap-2 rounded-md text-foreground no-underline">
              <div class="flex items-start justify-between gap-2">
                <div class="grid min-w-0 gap-0.5">
                  <span class="truncate text-sm font-medium hover:underline">{{ eq.brand }} {{ eq.model || eq.license_plate }}</span>
                  <span class="truncate text-xs text-muted-foreground">
                    {{ eq.license_plate }}<template v-if="operatorName && operatorName !== '—'"> · {{ operatorName }}</template>
                  </span>
                </div>
                <UiBadge :tone="equipmentBadgeTone(badge.tone)" class="shrink-0">{{ badge.text }}</UiBadge>
              </div>
              <div class="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs">
                <span class="text-muted-foreground">Топливо</span>
                <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    v-if="metrics?.fuelPct != null"
                    class="h-full rounded-full"
                    :class="fuelBarClass(metrics.fuelPct)"
                    :style="{ width: `${Math.min(100, Math.max(0, metrics.fuelPct))}%` }"
                  />
                </div>
                <span class="text-right tabular-nums">{{ equipmentDashFuelText(metrics) }}</span>
                <span class="text-muted-foreground">Состояние</span>
                <span class="col-span-2 truncate">{{ equipmentDashStateText(eq, metrics) }}</span>
              </div>
              <p v-if="eq.condition === 'repair' && eq.notes" class="text-xs text-destructive">{{ eq.notes }}</p>
            </RouterLink>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">Техника не заведена в справочнике.</p>
      </div>
    </div>

    <section class="flex flex-col gap-4">
      <h2 class="text-base font-semibold">Статистика задач</h2>
      <div class="grid items-start gap-6 lg:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
          <h3 class="text-sm font-medium">По статусам</h3>
          <div v-if="taskDonut.total" class="grid items-center gap-4 sm:grid-cols-[minmax(0,220px)_1fr]">
            <StatusDonutChart :slices="taskDonut.slices" :total="taskDonut.total" total-label="Всего задач" />
            <ul class="grid gap-2 text-sm">
              <li v-for="sl in taskDonut.slices" :key="sl.key" class="flex items-center gap-2">
                <span class="size-2.5 shrink-0 rounded-sm" :style="{ background: sl.color }" />
                <span class="flex-1 text-muted-foreground">{{ sl.label }}</span>
                <span class="font-medium tabular-nums">{{ sl.count }}</span>
              </li>
            </ul>
          </div>
          <p v-else class="text-sm text-muted-foreground">Нет задач в выбранном периоде.</p>
        </div>
        <div class="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
          <div class="grid gap-1">
            <h3 class="text-sm font-medium">Выполнено по сотрудникам</h3>
            <p class="text-xs text-muted-foreground">Сколько задач каждый закрыл за период.</p>
          </div>
          <CountBarChart v-if="taskEmployeeBarChart.rows.length" :rows="taskEmployeeBarChart.rows" series-label="Выполнено" color="var(--chart-5)" />
          <p v-else class="text-sm text-muted-foreground">Нет завершённых задач в периоде.</p>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4" aria-labelledby="dash-ops-stats-title">
      <div class="grid gap-1">
        <h2 id="dash-ops-stats-title" class="text-base font-semibold">Операции на полях</h2>
        <p class="text-sm text-muted-foreground">Завершённые за период. Нажмите на сотрудника, чтобы увидеть его операции по полям.</p>
      </div>

      <UiLoadingBar v-if="operationStatsListLoading && !operationStatsSummaries.length" size="md" />

      <template v-else-if="operationStatsSummaries.length">
        <div class="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Сортировка">
          <span class="text-sm text-muted-foreground">Сортировка:</span>
          <Button
            v-for="opt in OPERATION_SORT_OPTIONS"
            :key="opt.key"
            variant="outline"
            size="sm"
            type="button"
            :class="operationStatsSortKey === opt.key ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
            :aria-pressed="operationStatsSortKey === opt.key"
            @click="setOperationStatsSort(opt.key)"
          >
            {{ opt.label }}
            <span v-if="operationStatsSortMark(opt.key)" class="tabular-nums">{{ operationStatsSortMark(opt.key) }}</span>
          </Button>
        </div>

        <div class="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div v-for="(g, gi) in operationStatsSummaries" :key="g.key" class="border-b last:border-b-0">
            <button
              :id="'dash-ops-head-' + gi"
              type="button"
              class="flex w-full items-center gap-4 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 md:px-6"
              :aria-expanded="expandedOperationGroupKey === g.key"
              :aria-controls="'dash-ops-detail-' + gi"
              @click="toggleOperationGroup(g.key)"
            >
              <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground transition-transform" :class="{ 'rotate-90': expandedOperationGroupKey === g.key }" />
              <span class="grid min-w-0 flex-1 gap-0.5">
                <span class="truncate text-sm font-medium">{{ g.employee }}</span>
                <span class="text-xs text-muted-foreground">
                  {{ operationsCountLabelRu(g.operationCount) }} · {{ fieldsCountLabelRu(g.fieldsCount) }} · {{ formatDurationMinutesShort(g.totalMinutes) }}
                </span>
              </span>
              <span class="hidden shrink-0 text-right text-xs text-muted-foreground sm:grid">
                <span>Последняя</span>
                <span class="text-foreground tabular-nums">{{ formatOperationEndedAt(g.latestEndedAt) }}</span>
              </span>
            </button>
            <div
              v-show="expandedOperationGroupKey === g.key"
              :id="'dash-ops-detail-' + gi"
              class="border-t bg-muted/20 px-4 py-3 md:px-6"
              role="region"
              :aria-labelledby="'dash-ops-head-' + gi"
            >
              <p v-if="operationStatsDetailLoading[g.key]" class="text-sm text-muted-foreground">Загрузка операций…</p>
              <template v-else>
                <ul v-if="(operationStatsDetailByEmployee[g.key]?.length ?? 0) > 0" class="grid divide-y divide-border">
                  <li
                    v-for="row in operationStatsDetailByEmployee[g.key] || []"
                    :key="row.id"
                    class="grid gap-1 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_9rem] sm:items-center sm:gap-4"
                  >
                    <RouterLink
                      v-if="row.fieldRouteId"
                      :to="{ name: 'field-details', params: { id: row.fieldRouteId } }"
                      class="truncate font-medium text-foreground no-underline hover:underline"
                      @click.stop
                    >
                      {{ row.fieldLabel }}
                    </RouterLink>
                    <span v-else class="truncate font-medium">{{ row.fieldLabel }}</span>
                    <span class="truncate text-muted-foreground">{{ row.operationLabel }}</span>
                    <span class="tabular-nums">{{ formatDurationMinutesShort(row.durationMinutes) }}</span>
                    <span class="text-xs text-muted-foreground tabular-nums sm:text-right">{{ formatOperationEndedAt(row.endedAt) }}</span>
                  </li>
                </ul>
                <p v-else-if="operationStatsDetailTotalByEmployee[g.key] === 0" class="text-sm text-muted-foreground">Нет операций в выбранном периоде.</p>
                <div v-if="operationDetailRemaining(g.key) > 0" class="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    :disabled="!!operationStatsDetailLoadingMore[g.key]"
                    @click="loadOperationDetailsPage(g.key, false)"
                  >
                    {{ operationStatsDetailLoadingMore[g.key] ? 'Загрузка…' : `Показать ещё ${Math.min(OPERATION_DETAIL_PAGE_SIZE, operationDetailRemaining(g.key))}` }}
                  </Button>
                  <span class="text-xs text-muted-foreground">
                    Показано {{ operationStatsDetailByEmployee[g.key]?.length ?? 0 }} из {{ operationStatsDetailTotalByEmployee[g.key] ?? 0 }}
                  </span>
                </div>
              </template>
            </div>
          </div>
        </div>

        <div v-if="operationStatsTotalPages > 1" class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm text-muted-foreground">Страница {{ operationStatsPage }} из {{ operationStatsTotalPages }} · всего {{ operationStatsTotal }}</span>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" type="button" :disabled="operationStatsPage <= 1 || operationStatsListLoading" @click="goOperationStatsPage(-1)">
              <ChevronLeftIcon />
              Назад
            </Button>
            <Button variant="outline" size="sm" type="button" :disabled="operationStatsPage >= operationStatsTotalPages || operationStatsListLoading" @click="goOperationStatsPage(1)">
              Вперёд
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </template>
      <p v-else-if="!operationStatsListLoading" class="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Нет завершённых операций за выбранный период.
      </p>
    </section>
  </section>
</template>

