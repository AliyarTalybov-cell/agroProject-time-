<script setup lang="ts">
import { Input } from '@/components/ui/shadcn/input'
import { Button } from '@/components/ui/shadcn/button'
import { Textarea } from '@/components/ui/shadcn/textarea'
import { Label } from '@/components/ui/shadcn/label'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Spinner } from '@/components/ui/shadcn/spinner'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import PageToolbar from '@/components/ui/layout/PageToolbar.vue'
import FormGrid from '@/components/ui/layout/FormGrid.vue'
import FormField from '@/components/ui/layout/FormField.vue'
import UiBadge, { type UiBadgeTone } from '@/components/ui/UiBadge.vue'
import { toast } from 'vue-sonner'
import UiPersonPicker from '@/components/ui/UiPersonPicker.vue'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/shadcn/toggle-group'
import { RadioGroup, RadioGroupItem } from '@/components/ui/shadcn/radio-group'
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon, FileIcon, FileTextIcon, PaperclipIcon, PlusIcon, XIcon } from '@lucide/vue'
import CalendarDeleteDialog from '@/components/ui/dialogs/CalendarDeleteDialog.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiDatePicker from '@/components/ui/UiDatePicker.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { askConfirm } from '@/composables/useConfirm'
import { useAuth } from '@/stores/auth'
import {
  loadCalendarTasks,
  loadBusyCalendarTasks,
  loadCalendarTasksPage,
  loadTaskAssignees,
  updateTaskAssigneeStatus,
  removeTaskAssignee,
  loadTaskFiles,
  uploadTaskFile,
  deleteTaskFile,
  getTaskFilePublicUrl,
  insertCalendarTask,
  updateCalendarTask,
  deleteCalendarTask,
  isSupabaseConfigured,
  type CalendarTaskRow,
  type CalendarTaskFileRow,
  type CalendarTaskAssigneeStatus,
} from '@/lib/calendarTasksSupabase'
import { loadProfiles, type ProfileRow } from '@/lib/tasksSupabase'
import { avatarColorByPosition } from '@/lib/avatarColors'
import UserAvatar from '@/components/UserAvatar.vue'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import UiSuccessModal from '@/components/UiSuccessModal.vue'

type CalendarTask = {
  id: string
  userId: string | null
  date: string
  title: string
  description: string
  startTime: string | null
  endTime: string | null
  priority: 'low' | 'normal' | 'high'
  assignee: string | null
  completedAt: string | null
  createdAt: string
}

type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
type RepeatEndMode = 'never' | 'after' | 'on_date'
type RepeatApplyMode = 'only_this' | 'this_and_following'

function rowToTask(r: CalendarTaskRow): CalendarTask {
  return {
    id: r.id,
    userId: r.user_id ?? null,
    date: r.date,
    title: r.title,
    description: r.description ?? '',
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    priority: (r.priority as CalendarTask['priority']) || 'normal',
    assignee: r.assignee ?? null,
    completedAt: r.completed_at ?? null,
    createdAt: r.created_at,
  }
}

const auth = useAuth()
const isManager = computed(() => auth.userRole.value === 'manager')

/** Для руководителя: чей календарь показывать (uuid). Пустая строка → свой. */
/** Сообщение о неудавшейся загрузке. Пустая строка — сообщения нет. */
const loadError = ref('')
const managerCalendarUserId = ref('')

const effectiveCalendarUserId = computed(() => {
  const me = auth.user.value?.id
  if (!me) return null
  if (!isManager.value) return me
  return managerCalendarUserId.value || me
})

const managerCalendarOptions = computed(() => {
  const me = auth.user.value?.id
  const map = new Map<string, string>()
  if (me) {
    const selfProfile = profiles.value.find((p) => p.id === me)
    map.set(me, selfProfile ? profileLabel(selfProfile) : auth.user.value?.email ?? 'Я')
  }
  for (const p of profiles.value) {
    if (!map.has(p.id)) map.set(p.id, profileLabel(p))
  }
  return [...map.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'))
})

const today = new Date()
const currentYear = ref(today.getFullYear())
const currentMonth = ref(today.getMonth())
const selectedDate = ref(formatDateKey(today))
const calendarViewMode = ref<'day' | 'week' | 'month' | 'schedule'>('day')

const tasks = ref<CalendarTask[]>([])
const tasksLoading = ref(false)
const profiles = ref<ProfileRow[]>([])

const isTaskModalOpen = ref(false)
const editingTaskId = ref<string | null>(null)
const taskSaveLoading = ref(false)
const showDeleteConfirm = ref(false)
const deleteInProgress = ref(false)
const deleteScope = ref<'only_this' | 'this_and_following'>('only_this')
const deleteAudienceScope = ref<'all' | 'only_me'>('all')
const successModalOpen = ref(false)
const successModalTitle = ref('Операция выполнена')
const successModalMessage = ref('')
/** Ошибка в окне события: сохранение, конфликт времени, файлы, участие. */
const modalError = ref('')

const taskTitle = ref('')
const taskDescription = ref('')
const taskStartDate = ref('')
const taskStartTime = ref('09:00')
const taskEndTime = ref('11:30')
const taskPriority = ref<'low' | 'normal' | 'high'>('normal')
const taskRepeatRule = ref<RepeatRule>('none')
const taskRepeatEvery = ref(1)
const taskRepeatEndMode = ref<RepeatEndMode>('after')
const taskRepeatCount = ref(10)
const taskRepeatUntil = ref('')
const taskRepeatWeekDays = ref<number[]>([])
const taskRepeatApplyMode = ref<RepeatApplyMode>('only_this')
const taskAssignees = ref<string[]>([])
const taskFiles = ref<CalendarTaskFileRow[]>([])
const fileUploading = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const taskAssigneeIdsByTaskId = ref<Record<string, string[]>>({})
const taskAssigneeStatusByTaskId = ref<Record<string, Record<string, CalendarTaskAssigneeStatus>>>({})
const dayEventsScrollRef = ref<HTMLElement | null>(null)
const monthDragTaskId = ref<string | null>(null)
const monthDropTargetDate = ref<string | null>(null)
const monthExpandedDate = ref<string | null>(null)
const monthReorderTargetTaskId = ref<string | null>(null)
const weekDragTaskId = ref<string | null>(null)
const weekDragDurationMinutes = ref(60)
const weekDragPriority = ref<CalendarTask['priority']>('normal')
const dayDragTaskId = ref<string | null>(null)
const dayDragDurationMinutes = ref(60)
const dayDragPriority = ref<CalendarTask['priority']>('normal')
const dayDragPreview = ref<{
  start: number
  end: number
  top: number
  height: number
} | null>(null)
const weekDragPreview = ref<{
  dayIndex: number
  start: number
  end: number
  top: number
  height: number
} | null>(null)
const scheduleTasks = ref<CalendarTask[]>([])
const scheduleLoading = ref(false)
const scheduleLoadingMore = ref(false)
const scheduleHasMore = ref(true)
const schedulePage = ref(1)
const scheduleListRef = ref<HTMLElement | null>(null)
const schedulePageSize = 30

function profileLabel(p: ProfileRow): string {
  return (p.display_name?.trim() || p.email) ?? ''
}

function profileById(uid: string): ProfileRow | undefined {
  return profiles.value.find((x) => x.id === uid)
}

function assigneeInitials(p: ProfileRow): string {
  const name = (p.display_name || p.email || '').trim()
  if (!name) return '?'
  const parts = name.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2)
  return name.slice(0, 2).toUpperCase()
}

function assigneeAvatarStyle(p: ProfileRow): Record<string, string> {
  return { background: avatarColorByPosition(p.position) }
}

const profilesNotAssigned = computed(() =>
  profiles.value.filter((p) => !taskAssignees.value.includes(p.id)),
)

const monthsShort = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

const weekdaysShort = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
/** Ширина колонки с часами слева от сетки дня и недели, px. */
const gridGutter = 64
const dayStartHour = 8
const dayEndHour = 22
const dayViewportEndHour = 16
const daySlotMinutes = 30
const daySlotHeight = 44
const dayGridTopPadding = 14
const dayGridBottomPadding = 10
const nowMarkerMinutes = ref<number | null>(null)
const nowMarkerLabel = ref('')
let nowMarkerTimer: ReturnType<typeof setInterval> | null = null

function formatDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function weekdayMon1Sun7(dateKey: string): number {
  const d = new Date(dateKey + 'T12:00:00')
  const day = d.getDay()
  return day === 0 ? 7 : day
}

function addDaysToKey(dateKey: string, days: number): string {
  const d = new Date(dateKey + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return formatDateKey(d)
}

function addMonthsToKey(dateKey: string, months: number): string {
  const d = new Date(dateKey + 'T12:00:00')
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, maxDay))
  return formatDateKey(d)
}

function buildRecurringDates(
  startDate: string,
  rule: RepeatRule,
  every: number,
  endMode: RepeatEndMode,
  count: number,
  untilDate: string,
  weekDays: number[],
): string[] {
  if (rule === 'none') return [startDate]
  const safeEvery = Math.max(1, Math.min(365, Math.floor(every || 1)))
  const safeCount = Math.max(1, Math.min(500, Math.floor(count || 1)))
  const maxOccurrences = endMode === 'never' ? 120 : endMode === 'after' ? safeCount : 500
  const dates: string[] = []
  const startWeekday = weekdayMon1Sun7(startDate)
  const weeklyDays = weekDays.length ? [...new Set(weekDays)].sort((a, b) => a - b) : [startWeekday]

  if (rule === 'daily' || rule === 'monthly' || rule === 'yearly') {
    let cursor = startDate
    while (dates.length < maxOccurrences) {
      if (endMode === 'on_date' && untilDate && cursor > untilDate) break
      dates.push(cursor)
      if (rule === 'daily') cursor = addDaysToKey(cursor, safeEvery)
      else if (rule === 'monthly') cursor = addMonthsToKey(cursor, safeEvery)
      else cursor = addMonthsToKey(cursor, safeEvery * 12)
    }
    return dates
  }

  // Weekly: by selected weekdays and weekly interval
  const startMonday = addDaysToKey(startDate, 1 - startWeekday)
  let cursor = startDate
  let guard = 0
  while (dates.length < maxOccurrences && guard < 5000) {
    guard += 1
    const cursorWeekday = weekdayMon1Sun7(cursor)
    const weekDiff = Math.floor((parseDateKey(cursor).getTime() - parseDateKey(startMonday).getTime()) / (7 * 24 * 3600 * 1000))
    const inInterval = weekDiff % safeEvery === 0
    const allowedDay = weeklyDays.includes(cursorWeekday)
    if (cursor >= startDate && inInterval && allowedDay) {
      if (endMode === 'on_date' && untilDate && cursor > untilDate) break
      dates.push(cursor)
    }
    cursor = addDaysToKey(cursor, 1)
    if (endMode === 'on_date' && untilDate && cursor > untilDate) break
  }
  return dates
}

const todayKey = formatDateKey(today)

const currentMonthLabel = computed(
  () => `${monthsShort[currentMonth.value]} ${currentYear.value}`,
)

const calendarWeeks = computed(() => {
  const year = currentYear.value
  const month = currentMonth.value
  const firstDay = new Date(year, month, 1)
  const firstWeekday = (firstDay.getDay() || 7)
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const days: {
    key: string
    date: number
    inCurrentMonth: boolean
    isToday: boolean
    isSelected: boolean
    hasTasks: boolean
  }[] = []

  const prevDaysCount = firstWeekday - 1
  if (prevDaysCount > 0) {
    const prevMonth = month === 0 ? 11 : month - 1
    const prevYear = month === 0 ? year - 1 : year
    const prevMonthDays = new Date(prevYear, prevMonth + 1, 0).getDate()
    for (let i = prevMonthDays - prevDaysCount + 1; i <= prevMonthDays; i += 1) {
      const d = new Date(prevYear, prevMonth, i)
      const key = formatDateKey(d)
      days.push({
        key,
        date: i,
        inCurrentMonth: false,
        isToday: key === todayKey,
        isSelected: key === selectedDate.value,
        hasTasks: tasks.value.some((t) => t.date === key),
      })
    }
  }

  for (let i = 1; i <= daysInMonth; i += 1) {
    const d = new Date(year, month, i)
    const key = formatDateKey(d)
    days.push({
      key,
      date: i,
      inCurrentMonth: true,
      isToday: key === todayKey,
      isSelected: key === selectedDate.value,
      hasTasks: tasks.value.some((t) => t.date === key),
    })
  }

  const totalCells = Math.ceil(days.length / 7) * 7
  const nextDaysCount = totalCells - days.length
  if (nextDaysCount > 0) {
    const nextMonth = month === 11 ? 0 : month + 1
    const nextYear = month === 11 ? year + 1 : year
    for (let i = 1; i <= nextDaysCount; i += 1) {
      const d = new Date(nextYear, nextMonth, i)
      const key = formatDateKey(d)
      days.push({
        key,
        date: i,
        inCurrentMonth: false,
        isToday: key === todayKey,
        isSelected: key === selectedDate.value,
        hasTasks: tasks.value.some((t) => t.date === key),
      })
    }
  }

  const weeks: typeof days[] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }
  return weeks
})

const tasksForSelectedDate = computed(() =>
  tasks.value
    .filter((t) => t.date === selectedDate.value)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')),
)

const isDayView = computed(() => calendarViewMode.value === 'day')
const isWeekView = computed(() => calendarViewMode.value === 'week')
const isMonthView = computed(() => calendarViewMode.value === 'month')
const isScheduleView = computed(() => calendarViewMode.value === 'schedule')
const myUserId = computed(() => auth.user.value?.id ?? null)
const editingTask = computed(() => tasks.value.find((t) => t.id === editingTaskId.value) ?? null)

function canManageTask(task: CalendarTask | null): boolean {
  if (!task) return false
  if (isManager.value) return true
  return !!myUserId.value && task.userId === myUserId.value
}

const canEditCurrentTask = computed(() => {
  if (!editingTaskId.value) return true
  return canManageTask(editingTask.value)
})

const canDeleteCurrentTask = computed(() => {
  if (!editingTaskId.value) return false
  return canDeleteForAll.value || canDeleteOnlyForMe.value
})

const deleteSeriesCandidates = computed(() => {
  const base = editingTask.value
  if (!base) return [] as CalendarTask[]
  const titleKey = base.title.trim().toLowerCase()
  return tasks.value
    .filter((t) => {
      if (t.userId !== base.userId) return false
      if (t.title.trim().toLowerCase() !== titleKey) return false
      if ((t.startTime || '') !== (base.startTime || '')) return false
      if ((t.endTime || '') !== (base.endTime || '')) return false
      return true
    })
    .sort((a, b) => a.date.localeCompare(b.date))
})

const canDeleteAsSeries = computed(() => {
  const base = editingTask.value
  if (!base) return false
  return deleteSeriesCandidates.value.filter((t) => t.date >= base.date).length > 1
})

const canDeleteOnlyForMe = computed(() => {
  const me = myUserId.value
  const task = editingTask.value
  if (!me || !task) return false
  if (currentTaskParticipationStatus.value !== 'declined') return false
  const hasAssigneeRecord = taskAssignees.value.includes(me)
  const hasParticipationStatus = currentTaskParticipationStatus.value !== null
  return (hasAssigneeRecord || hasParticipationStatus) && taskAssignees.value.length > 1
})

const canDeleteForAll = computed(() => {
  const me = myUserId.value
  const task = editingTask.value
  if (!me || !task) return false
  if (isManager.value) return true
  return task.userId === me
})

const showDeleteAudienceChoice = computed(
  () => taskAssignees.value.length > 1 && (canDeleteForAll.value || canDeleteOnlyForMe.value),
)
const currentTaskParticipationStatus = computed<CalendarTaskAssigneeStatus | null>(() => {
  const me = myUserId.value
  const task = editingTask.value
  if (!me || !task) return null
  const byUser = taskAssigneeStatusByTaskId.value[task.id] ?? {}
  return byUser[me] ?? null
})

const modalTaskOwnerLabel = computed(() => {
  const ownerId = editingTask.value?.userId ?? effectiveCalendarUserId.value ?? myUserId.value
  if (!ownerId) return 'Не указан'
  const profile = profileById(ownerId)
  if (profile) return profileLabel(profile)
  if (ownerId === myUserId.value) return 'Вы'
  return ownerId
})

function assigneeStatusForModal(uid: string): CalendarTaskAssigneeStatus {
  const task = editingTask.value
  const map = (task ? taskAssigneeStatusByTaskId.value[task.id] : undefined) ?? {}
  return map[uid] ?? 'pending'
}

function assigneeStatusLabel(status: CalendarTaskAssigneeStatus): string {
  if (status === 'accepted') return 'Принял'
  if (status === 'declined') return 'Отказался'
  return 'Ожидает'
}

const scheduleGroups = computed(() => {
  const map = new Map<string, CalendarTask[]>()
  for (const task of scheduleTasks.value) {
    const list = map.get(task.date) ?? []
    list.push(task)
    map.set(task.date, list)
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, dayTasks]) => ({
      date,
      label: new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        weekday: 'long',
      }),
      tasks: [...dayTasks].sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99')),
    }))
})

const recurringScheduleSignatures = computed(() => {
  const counts = new Map<string, number>()
  for (const task of scheduleTasks.value) {
    const key = `${task.title.trim().toLowerCase()}|${task.startTime || ''}|${task.endTime || ''}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key))
})

function isTaskRecurringInSchedule(task: CalendarTask): boolean {
  const key = `${task.title.trim().toLowerCase()}|${task.startTime || ''}|${task.endTime || ''}`
  return recurringScheduleSignatures.value.has(key)
}

/** Цвет события по приоритету: полоса слева и фон карточки. */
function eventToneClass(priority: CalendarTask['priority']): string {
  if (priority === 'high') return 'border-l-red-500 bg-red-50 hover:bg-red-100 dark:bg-red-950/50 dark:hover:bg-red-950/80'
  if (priority === 'low') return 'border-l-sky-500 bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/50 dark:hover:bg-sky-950/80'
  return 'border-l-primary bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-950/80'
}

function eventDotClass(priority: CalendarTask['priority']): string {
  if (priority === 'high') return 'bg-red-500'
  if (priority === 'low') return 'bg-sky-500'
  return 'bg-primary'
}

function priorityLabel(priority: CalendarTask['priority']): string {
  if (priority === 'high') return 'Высокий'
  if (priority === 'low') return 'Низкий'
  return 'Обычный'
}

function priorityTone(priority: CalendarTask['priority']): UiBadgeTone {
  if (priority === 'high') return 'danger'
  if (priority === 'low') return 'neutral'
  return 'primary'
}

/**
 * Раскладка пересекающихся по времени событий по колонкам, как в Google Календаре:
 * событие встаёт в первую свободную колонку, ширина делится на число колонок в группе.
 */
function layoutLanes<T extends { start: number; end: number }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const result: (T & { lane: number; lanes: number })[] = []
  let group: (T & { lane: number; lanes: number })[] = []
  let laneEnds: number[] = []
  let groupEnd = -1
  const closeGroup = () => {
    for (const item of group) item.lanes = laneEnds.length
    result.push(...group)
    group = []
    laneEnds = []
  }
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) closeGroup()
    let lane = laneEnds.findIndex((end) => end <= item.start)
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(item.end)
    } else {
      laneEnds[lane] = item.end
    }
    group.push({ ...item, lane, lanes: 1 })
    groupEnd = Math.max(groupEnd, item.end)
  }
  closeGroup()
  return result
}

function parseDateKey(value: string): Date {
  return new Date(value + 'T12:00:00')
}

function isWeekendDateKey(value: string): boolean {
  const day = parseDateKey(value).getDay()
  return day === 0 || day === 6
}

const weekDays = computed(() => {
  const anchor = parseDateKey(selectedDate.value)
  const day = anchor.getDay()
  const monOffset = day === 0 ? -6 : 1 - day
  const mon = new Date(anchor)
  mon.setDate(anchor.getDate() + monOffset)
  return Array.from({ length: 7 }, (_, idx) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + idx)
    const key = formatDateKey(d)
    return {
      key,
      date: d.getDate(),
      weekDay: weekdaysShort[idx],
      isToday: key === todayKey,
      isSelected: key === selectedDate.value,
      isWeekend: isWeekendDateKey(key),
    }
  })
})

const tasksForSelectedWeek = computed(() => {
  const keys = new Set(weekDays.value.map((x) => x.key))
  return tasks.value
    .filter((t) => keys.has(t.date))
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
})

const weekEventsTimed = computed(() => {
  const start = dayStartHour * 60
  const end = dayEndHour * 60
  const timed = tasksForSelectedWeek.value
    .filter((task) => !!task.startTime)
    .map((task) => {
      const dayIndex = weekDays.value.findIndex((d) => d.key === task.date)
      if (dayIndex < 0) return null
      const rawStart = hhmmToMinutes(task.startTime)
      const rawEnd = hhmmToMinutes(task.endTime)
      if (rawStart == null) return null
      const eventStart = Math.max(start, Math.min(end - 15, rawStart))
      const fallbackEnd = eventStart + 60
      const eventEnd = Math.max(eventStart + 30, Math.min(end, rawEnd ?? fallbackEnd))
      const top = dayGridTopPadding + ((eventStart - start) / daySlotMinutes) * daySlotHeight
      const height = Math.max(36, ((eventEnd - eventStart) / daySlotMinutes) * daySlotHeight - 4)
      return { task, dayIndex, top, height, start: eventStart, end: eventEnd }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  return weekDays.value.flatMap((_, idx) => layoutLanes(timed.filter((e) => e.dayIndex === idx)))
})

const tasksByDate = computed(() => {
  const map = new Map<string, CalendarTask[]>()
  for (const task of tasks.value) {
    const list = map.get(task.date) ?? []
    list.push(task)
    map.set(task.date, list)
  }
  for (const [k, list] of map.entries()) {
    map.set(
      k,
      list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')),
    )
  }
  return map
})

const monthCells = computed(() =>
  calendarWeeks.value.flat().map((day, idx) => {
    const dayTasks = tasksByDate.value.get(day.key) ?? []
    return {
      ...day,
      rowIndex: Math.floor(idx / 7),
      allTasks: dayTasks,
      tasks: dayTasks.slice(0, 3),
      more: Math.max(0, dayTasks.length - 3),
      isWeekend: isWeekendDateKey(day.key),
    }
  }),
)

const monthExpandedRowIndex = computed(() => {
  if (!monthExpandedDate.value) return null
  const target = monthCells.value.find((c) => c.key === monthExpandedDate.value)
  return target ? target.rowIndex : null
})

function toggleMonthMore(dateKey: string) {
  monthExpandedDate.value = monthExpandedDate.value === dateKey ? null : dateKey
}

const tasksForCurrentMonth = computed(() => {
  const monthPrefix = `${currentYear.value}-${String(currentMonth.value + 1).padStart(2, '0')}-`
  return tasks.value.filter((t) => t.date.startsWith(monthPrefix))
})

const visibleTasksForAssignees = computed(() => {
  if (isScheduleView.value) return scheduleTasks.value
  if (isMonthView.value) return tasksForCurrentMonth.value
  if (isWeekView.value) return tasksForSelectedWeek.value
  return tasksForSelectedDate.value
})

const visibleTaskIdsKey = computed(() =>
  visibleTasksForAssignees.value
    .map((t) => t.id)
    .sort()
    .join(','),
)

type CalendarView = 'day' | 'week' | 'month' | 'schedule'

function setCalendarView(mode: CalendarView) {
  calendarViewMode.value = mode
  monthExpandedDate.value = null
}

/** «Назад» / «Вперёд» в шапке: на день, неделю или месяц в зависимости от режима. */
function shiftPeriod(direction: 1 | -1) {
  monthExpandedDate.value = null
  if (isMonthView.value) selectedDate.value = addMonthsToKey(selectedDate.value, direction)
  else selectedDate.value = addDaysToKey(selectedDate.value, isWeekView.value ? 7 * direction : direction)
}

function goToday() {
  monthExpandedDate.value = null
  selectedDate.value = todayKey
}

const monthsGenitive = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

const periodTitle = computed(() => {
  if (isScheduleView.value) return 'Ближайшие события'
  if (isMonthView.value) return currentMonthLabel.value
  if (isWeekView.value) {
    const first = parseDateKey(weekDays.value[0].key)
    const last = parseDateKey(weekDays.value[6].key)
    const lastPart = `${last.getDate()} ${monthsGenitive[last.getMonth()]} ${last.getFullYear()}`
    if (first.getMonth() === last.getMonth()) return `${first.getDate()}–${lastPart}`
    return `${first.getDate()} ${monthsGenitive[first.getMonth()]} – ${lastPart}`
  }
  return parseDateKey(selectedDate.value).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
})

function pluralEvents(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'событие'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'события'
  return 'событий'
}

const periodEventsCount = computed(() => visibleTasksForAssignees.value.length)

const repeatUnitLabel = computed(() => {
  if (taskRepeatRule.value === 'daily') return 'дн.'
  if (taskRepeatRule.value === 'weekly') return 'нед.'
  if (taskRepeatRule.value === 'monthly') return 'мес.'
  return 'г.'
})

async function loadSchedulePage(append: boolean) {
  const uid = effectiveCalendarUserId.value
  if (!isSupabaseConfigured() || !uid) {
    scheduleTasks.value = []
    scheduleHasMore.value = false
    return
  }
  const pageToLoad = append ? schedulePage.value + 1 : 1
  if (append && (!scheduleHasMore.value || scheduleLoadingMore.value)) return
  if (!append && scheduleLoading.value) return
  if (append) scheduleLoadingMore.value = true
  else scheduleLoading.value = true
  try {
    const rows = await loadCalendarTasksPage({
      userId: uid,
      fromDate: todayKey,
      page: pageToLoad,
      pageSize: schedulePageSize,
    })
    const nextTasks = rows.map(rowToTask)
    if (append) {
      const byId = new Map(scheduleTasks.value.map((t) => [t.id, t] as const))
      for (const task of nextTasks) byId.set(task.id, task)
      scheduleTasks.value = Array.from(byId.values()).sort((a, b) => {
        const d = a.date.localeCompare(b.date)
        if (d !== 0) return d
        return (a.startTime || '99:99').localeCompare(b.startTime || '99:99')
      })
    } else {
      scheduleTasks.value = nextTasks
    }
    schedulePage.value = pageToLoad
    scheduleHasMore.value = rows.length === schedulePageSize
  } catch (err) {
    if (!append) scheduleTasks.value = []
    scheduleHasMore.value = false
    loadError.value = formatSupabaseError(err) || 'Не удалось загрузить расписание'
  } finally {
    if (append) scheduleLoadingMore.value = false
    else scheduleLoading.value = false
  }
}

function onScheduleScroll() {
  const el = scheduleListRef.value
  if (!el || scheduleLoading.value || scheduleLoadingMore.value || !scheduleHasMore.value) return
  const distanceToBottom = el.scrollHeight - (el.scrollTop + el.clientHeight)
  if (distanceToBottom < 220) {
    void loadSchedulePage(true)
  }
}

function onMonthCellClick(dateKey: string) {
  selectedDate.value = dateKey
  const dayTasks = tasksByDate.value.get(dateKey) ?? []
  if (dayTasks.length > 0) {
    monthExpandedDate.value = monthExpandedDate.value === dateKey ? null : dateKey
    return
  }
  openNewTaskModal('09:00')
}

function onMonthEventDragStart(taskId: string, e: DragEvent) {
  monthDragTaskId.value = taskId
  monthReorderTargetTaskId.value = null
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }
}

function onMonthEventDragEnd() {
  monthDragTaskId.value = null
  monthDropTargetDate.value = null
  monthReorderTargetTaskId.value = null
}

function onMonthCellDragOver(dateKey: string, e: DragEvent) {
  if (!monthDragTaskId.value) return
  e.preventDefault()
  monthDropTargetDate.value = dateKey
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onMonthCellDragLeave(dateKey: string) {
  if (monthDropTargetDate.value === dateKey) monthDropTargetDate.value = null
}

function getTaskParticipantIds(task: CalendarTask): string[] {
  const raw = taskAssigneeIdsByTaskId.value[task.id] ?? []
  if (raw.length > 0) return raw
  return [task.userId].filter((x): x is string => !!x)
}

async function findFreeSlotBackwardForDay(args: {
  date: string
  durationMinutes: number
  participantIds: string[]
  excludeTaskId?: string | null
  fromStartMinutes: number
}): Promise<{ start: string; end: string } | null> {
  const duration = Math.max(daySlotMinutes, args.durationMinutes)
  const minStart = dayStartHour * 60
  const maxStart = dayEndHour * 60 - duration
  let cursor = Math.max(minStart, Math.min(maxStart, args.fromStartMinutes))
  cursor = cursor - (cursor % daySlotMinutes)
  for (let start = cursor; start >= minStart; start -= daySlotMinutes) {
    const end = start + duration
    const conflicts = await findParticipantConflicts({
      participantIds: args.participantIds,
      dates: [args.date],
      startTime: minutesToHhmm(start),
      endTime: minutesToHhmm(end),
      excludeTaskId: args.excludeTaskId ?? null,
    })
    if (conflicts.length === 0) {
      return { start: minutesToHhmm(start), end: minutesToHhmm(end) }
    }
  }
  return null
}

function onMonthEventReorderOver(dateKey: string, targetTaskId: string, e: DragEvent) {
  if (!monthDragTaskId.value || monthDragTaskId.value === targetTaskId) return
  const dragged = tasks.value.find((t) => t.id === monthDragTaskId.value)
  if (!dragged) return
  if (dragged.date !== dateKey) {
    // Если тянем в другой день и курсор над карточкой, даем сработать сценарию междневного переноса.
    e.preventDefault()
    monthDropTargetDate.value = dateKey
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    return
  }
  e.preventDefault()
  e.stopPropagation()
  monthReorderTargetTaskId.value = targetTaskId
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onMonthEventReorderLeave(targetTaskId: string) {
  if (monthReorderTargetTaskId.value === targetTaskId) monthReorderTargetTaskId.value = null
}

async function onMonthEventReorderDrop(dateKey: string, targetTaskId: string, e: DragEvent) {
  if (!monthDragTaskId.value) return
  e.preventDefault()
  const draggedId = monthDragTaskId.value
  monthReorderTargetTaskId.value = null
  if (draggedId === targetTaskId || !isSupabaseConfigured()) return
  const draggedTask = tasks.value.find((t) => t.id === draggedId)
  const targetTask = tasks.value.find((t) => t.id === targetTaskId)
  if (!draggedTask || !targetTask) return
  if (draggedTask.date !== dateKey || targetTask.date !== dateKey) {
    // Дропнули на карточку в другом дне: обрабатываем как междневный перенос.
    await onMonthCellDrop(dateKey, e)
    return
  }
  e.stopPropagation()

  const draggedStart = hhmmToMinutes(draggedTask.startTime) ?? dayStartHour * 60
  const draggedEnd = hhmmToMinutes(draggedTask.endTime) ?? draggedStart + 60
  const duration = Math.max(daySlotMinutes, draggedEnd - draggedStart)
  const targetStart = hhmmToMinutes(targetTask.startTime) ?? draggedStart
  const preferredStart = Math.max(dayStartHour * 60, targetStart - duration)
  const freeSlot = await findFreeSlotBackwardForDay({
    date: dateKey,
    durationMinutes: duration,
    participantIds: getTaskParticipantIds(draggedTask),
    excludeTaskId: draggedTask.id,
    fromStartMinutes: preferredStart,
  })
  if (!freeSlot) {
    successModalTitle.value = 'Нет свободного времени'
    successModalMessage.value = 'Не удалось поднять слот выше: нет подходящего свободного времени в этом дне.'
    successModalOpen.value = true
    return
  }

  const prevStart = draggedTask.startTime
  const prevEnd = draggedTask.endTime
  draggedTask.startTime = freeSlot.start
  draggedTask.endTime = freeSlot.end
  try {
    await updateCalendarTask(draggedTask.id, { start_time: freeSlot.start, end_time: freeSlot.end })
  } catch (err) {
    draggedTask.startTime = prevStart
    draggedTask.endTime = prevEnd
    toast.error('Не удалось перенести событие', { description: formatSupabaseError(err) })
  }
}

async function findFirstFreeSlotForDay(args: {
  date: string
  durationMinutes: number
  participantIds: string[]
  excludeTaskId?: string | null
  preferredStartMinutes?: number
}): Promise<{ start: string; end: string } | null> {
  const duration = Math.max(daySlotMinutes, args.durationMinutes)
  const minStart = dayStartHour * 60
  const maxStart = dayEndHour * 60 - duration
  if (maxStart < minStart) return null

  const preferred = Math.max(minStart, Math.min(maxStart, args.preferredStartMinutes ?? minStart))
  const orderedStarts: number[] = []
  for (let m = preferred; m <= maxStart; m += daySlotMinutes) orderedStarts.push(m)
  for (let m = minStart; m < preferred; m += daySlotMinutes) orderedStarts.push(m)

  for (const start of orderedStarts) {
    const end = start + duration
    const conflicts = await findParticipantConflicts({
      participantIds: args.participantIds,
      dates: [args.date],
      startTime: minutesToHhmm(start),
      endTime: minutesToHhmm(end),
      excludeTaskId: args.excludeTaskId ?? null,
    })
    if (conflicts.length === 0) {
      return { start: minutesToHhmm(start), end: minutesToHhmm(end) }
    }
  }
  return null
}

async function onMonthCellDrop(dateKey: string, e: DragEvent) {
  e.preventDefault()
  const taskId = monthDragTaskId.value || e.dataTransfer?.getData('text/plain')
  monthDropTargetDate.value = null
  monthDragTaskId.value = null
  if (!taskId || !isSupabaseConfigured()) return
  const task = tasks.value.find((t) => t.id === taskId)
  if (!task) return

  const prevStart = hhmmToMinutes(task.startTime) ?? dayStartHour * 60
  const prevEnd = hhmmToMinutes(task.endTime) ?? prevStart + 60
  const duration = Math.max(daySlotMinutes, prevEnd - prevStart)

  const participantIds = getTaskParticipantIds(task)
  const nextStart = minutesToHhmm(prevStart)
  const nextEnd = minutesToHhmm(Math.min(dayEndHour * 60, prevStart + duration))
  const noConflicts = await ensureNoParticipantConflicts({
    participantIds,
    dates: [dateKey],
    startTime: nextStart,
    endTime: nextEnd,
    excludeTaskId: taskId,
  })
  if (!noConflicts) {
    successModalTitle.value = 'Диапазон занят'
    successModalMessage.value = 'Перенос не выполнен: в выбранном дне этот временной диапазон уже занят у участников.'
    successModalOpen.value = true
    return
  }

  if (task.date === dateKey && (task.startTime || '') === nextStart && (task.endTime || '') === nextEnd) return

  const prevDate = task.date
  const prevStartTime = task.startTime
  const prevEndTime = task.endTime
  // Оптимистично обновляем локально, чтобы не было резкого мигания сетки.
  task.date = dateKey
  task.startTime = nextStart
  task.endTime = nextEnd
  try {
    await updateCalendarTask(taskId, { date: dateKey, start_time: nextStart, end_time: nextEnd })
  } catch (err) {
    task.date = prevDate
    task.startTime = prevStartTime
    task.endTime = prevEndTime
    toast.error('Не удалось перенести событие', { description: formatSupabaseError(err) })
  }
}

function onWeekEventDragStart(taskId: string, start: number, end: number, priority: CalendarTask['priority'], e: DragEvent) {
  weekDragTaskId.value = taskId
  weekDragDurationMinutes.value = Math.max(daySlotMinutes, end - start)
  weekDragPriority.value = priority || 'normal'
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }
}

function onWeekEventDragEnd() {
  weekDragTaskId.value = null
  weekDragPriority.value = 'normal'
  weekDragPreview.value = null
}

function getWeekDropPreviewFromEvent(e: DragEvent) {
  const grid = e.currentTarget as HTMLElement | null
  if (!grid) return null
  const rect = grid.getBoundingClientRect()
  const relativeX = e.clientX - rect.left
  const relativeY = e.clientY - rect.top
  const weekLabelWidth = gridGutter
  const usableWidth = Math.max(1, rect.width - weekLabelWidth)
  const dayWidth = usableWidth / 7
  const dayIndex = Math.max(0, Math.min(6, Math.floor((relativeX - weekLabelWidth) / dayWidth)))
  const dayStartMinutes = dayStartHour * 60
  const dayEndMinutes = dayEndHour * 60
  const snappedStart = dayStartMinutes + Math.round((relativeY - dayGridTopPadding) / daySlotHeight) * daySlotMinutes
  const maxStart = dayEndMinutes - daySlotMinutes
  const start = Math.max(dayStartMinutes, Math.min(maxStart, snappedStart))
  const duration = Math.max(daySlotMinutes, weekDragDurationMinutes.value)
  const end = Math.min(dayEndMinutes, start + duration)
  const adjustedStart = Math.max(dayStartMinutes, end - duration)
  const top = dayGridTopPadding + ((adjustedStart - dayStartMinutes) / daySlotMinutes) * daySlotHeight
  const height = Math.max(36, ((end - adjustedStart) / daySlotMinutes) * daySlotHeight - 4)
  return { dayIndex, start: adjustedStart, end, top, height }
}

function onWeekGridDragOver(e: DragEvent) {
  if (!weekDragTaskId.value) return
  e.preventDefault()
  const preview = getWeekDropPreviewFromEvent(e)
  if (!preview) return
  weekDragPreview.value = preview
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

async function onWeekGridDrop(e: DragEvent) {
  e.preventDefault()
  const taskId = weekDragTaskId.value || e.dataTransfer?.getData('text/plain')
  const preview = getWeekDropPreviewFromEvent(e) || weekDragPreview.value
  weekDragTaskId.value = null
  weekDragPriority.value = 'normal'
  weekDragPreview.value = null
  if (!taskId || !preview || !isSupabaseConfigured()) return
  const targetDay = weekDays.value[preview.dayIndex]
  if (!targetDay) return
  const task = tasks.value.find((t) => t.id === taskId)
  if (!task) return
  const nextDate = targetDay.key
  const nextStart = minutesToHhmm(preview.start)
  const nextEnd = minutesToHhmm(preview.end)
  if (task.date === nextDate && (task.startTime || '') === nextStart && (task.endTime || '') === nextEnd) return

  const participantIdsRaw = taskAssigneeIdsByTaskId.value[taskId] ?? []
  const participantIds = participantIdsRaw.length > 0
    ? participantIdsRaw
    : [task.userId].filter((x): x is string => !!x)
  const noConflicts = await ensureNoParticipantConflicts({
    participantIds,
    dates: [nextDate],
    startTime: nextStart,
    endTime: nextEnd,
    excludeTaskId: taskId,
  })
  if (!noConflicts) return

  const prev = { date: task.date, startTime: task.startTime, endTime: task.endTime }
  task.date = nextDate
  task.startTime = nextStart
  task.endTime = nextEnd
  try {
    await updateCalendarTask(taskId, { date: nextDate, start_time: nextStart, end_time: nextEnd })
  } catch (err) {
    task.date = prev.date
    task.startTime = prev.startTime
    task.endTime = prev.endTime
    toast.error('Не удалось перенести событие', { description: formatSupabaseError(err) })
  }
}

function onDayEventDragStart(taskId: string, start: number, end: number, priority: CalendarTask['priority'], e: DragEvent) {
  dayDragTaskId.value = taskId
  dayDragDurationMinutes.value = Math.max(daySlotMinutes, end - start)
  dayDragPriority.value = priority || 'normal'
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }
}

function onDayEventDragEnd() {
  dayDragTaskId.value = null
  dayDragPriority.value = 'normal'
  dayDragPreview.value = null
}

function getDayDropPreviewFromEvent(e: DragEvent) {
  const grid = e.currentTarget as HTMLElement | null
  if (!grid) return null
  const rect = grid.getBoundingClientRect()
  const relativeY = e.clientY - rect.top
  const dayStartMinutes = dayStartHour * 60
  const dayEndMinutes = dayEndHour * 60
  const snappedStart = dayStartMinutes + Math.round((relativeY - dayGridTopPadding) / daySlotHeight) * daySlotMinutes
  const duration = Math.max(daySlotMinutes, dayDragDurationMinutes.value)
  const maxStart = dayEndMinutes - duration
  const start = Math.max(dayStartMinutes, Math.min(maxStart, snappedStart))
  const end = Math.min(dayEndMinutes, start + duration)
  const adjustedStart = Math.max(dayStartMinutes, end - duration)
  const top = dayGridTopPadding + ((adjustedStart - dayStartMinutes) / daySlotMinutes) * daySlotHeight
  const height = Math.max(36, ((end - adjustedStart) / daySlotMinutes) * daySlotHeight - 4)
  return { start: adjustedStart, end, top, height }
}

function onDayGridDragOver(e: DragEvent) {
  if (!dayDragTaskId.value) return
  e.preventDefault()
  const preview = getDayDropPreviewFromEvent(e)
  if (!preview) return
  dayDragPreview.value = preview
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

async function onDayGridDrop(e: DragEvent) {
  e.preventDefault()
  const taskId = dayDragTaskId.value || e.dataTransfer?.getData('text/plain')
  const preview = getDayDropPreviewFromEvent(e) || dayDragPreview.value
  dayDragTaskId.value = null
  dayDragPriority.value = 'normal'
  dayDragPreview.value = null
  if (!taskId || !preview || !isSupabaseConfigured()) return
  const task = tasks.value.find((t) => t.id === taskId)
  if (!task) return
  const nextDate = selectedDate.value
  const nextStart = minutesToHhmm(preview.start)
  const nextEnd = minutesToHhmm(preview.end)
  if (task.date === nextDate && (task.startTime || '') === nextStart && (task.endTime || '') === nextEnd) return

  const participantIdsRaw = taskAssigneeIdsByTaskId.value[taskId] ?? []
  const participantIds = participantIdsRaw.length > 0
    ? participantIdsRaw
    : [task.userId].filter((x): x is string => !!x)
  const noConflicts = await ensureNoParticipantConflicts({
    participantIds,
    dates: [nextDate],
    startTime: nextStart,
    endTime: nextEnd,
    excludeTaskId: taskId,
  })
  if (!noConflicts) return

  const prev = { date: task.date, startTime: task.startTime, endTime: task.endTime }
  task.date = nextDate
  task.startTime = nextStart
  task.endTime = nextEnd
  try {
    await updateCalendarTask(taskId, { date: nextDate, start_time: nextStart, end_time: nextEnd })
  } catch (err) {
    task.date = prev.date
    task.startTime = prev.startTime
    task.endTime = prev.endTime
    toast.error('Не удалось перенести событие', { description: formatSupabaseError(err) })
  }
}

function hhmmToMinutes(value: string | null): number | null {
  if (!value) return null
  const match = value.match(/^(\d{2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function minutesToHhmm(value: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, value))
  const h = String(Math.floor(clamped / 60)).padStart(2, '0')
  const m = String(clamped % 60).padStart(2, '0')
  return `${h}:${m}`
}

function timeRangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

async function findParticipantConflicts(args: {
  participantIds: string[]
  dates: string[]
  startTime: string | null
  endTime: string | null
  excludeTaskId?: string | null
}): Promise<Array<{ userId: string; label: string; date: string; title: string; start: string; end: string }>> {
  const start = hhmmToMinutes(args.startTime)
  const end = hhmmToMinutes(args.endTime)
  if (start == null || end == null || end <= start) return []
  const datesSet = new Set(args.dates.filter(Boolean))
  if (datesSet.size === 0) return []

  const uniqueParticipants = [...new Set(args.participantIds.filter(Boolean))]
  if (uniqueParticipants.length === 0) return []

  const rows = await Promise.all(
    uniqueParticipants.map(async (uid) => {
      const userTasks = await loadBusyCalendarTasks(uid)
      return { uid, userTasks }
    }),
  )

  const conflicts: Array<{ userId: string; label: string; date: string; title: string; start: string; end: string }> = []
  for (const { uid, userTasks } of rows) {
    for (const task of userTasks) {
      if (!datesSet.has(task.date)) continue
      if (args.excludeTaskId && task.id === args.excludeTaskId) continue
      const taskStart = hhmmToMinutes(task.start_time)
      const taskEnd = hhmmToMinutes(task.end_time)
      if (taskStart == null || taskEnd == null || taskEnd <= taskStart) continue
      if (!timeRangesOverlap(start, end, taskStart, taskEnd)) continue
      const profile = profileById(uid)
      conflicts.push({
        userId: uid,
        label: profile ? profileLabel(profile) : uid,
        date: task.date,
        title: task.title,
        start: task.start_time || '',
        end: task.end_time || '',
      })
      break
    }
  }
  return conflicts
}

async function ensureNoParticipantConflicts(args: {
  participantIds: string[]
  dates: string[]
  startTime: string | null
  endTime: string | null
  excludeTaskId?: string | null
}): Promise<boolean> {
  const conflicts = await findParticipantConflicts(args)
  if (conflicts.length === 0) return true
  const lines = conflicts.map((c) => `• ${c.label} — занято ${c.date.split('-').reverse().join('.')} ${c.start}–${c.end} (${c.title})`)
  const text = 'У участников уже есть события в это время:\n' + lines.join('\n')
  if (isTaskModalOpen.value) modalError.value = text
  else toast.error('Не удалось перенести событие', { description: text })
  return false
}

const daySlots = computed(() => {
  const start = dayStartHour * 60
  const end = dayEndHour * 60
  const slots: { key: string; label: string; minutes: number }[] = []
  for (let m = start; m <= end; m += daySlotMinutes) {
    slots.push({ key: `slot-${m}`, label: minutesToHhmm(m), minutes: m })
  }
  return slots
})

const dayEventsTimed = computed(() => {
  const start = dayStartHour * 60
  const end = dayEndHour * 60
  const timed = tasksForSelectedDate.value
    .filter((task) => !!task.startTime)
    .map((task) => {
      const rawStart = hhmmToMinutes(task.startTime)
      const rawEnd = hhmmToMinutes(task.endTime)
      if (rawStart == null) return null
      const eventStart = Math.max(start, Math.min(end - 15, rawStart))
      const fallbackEnd = eventStart + 60
      const eventEnd = Math.max(eventStart + 30, Math.min(end, rawEnd ?? fallbackEnd))
      const top = dayGridTopPadding + ((eventStart - start) / daySlotMinutes) * daySlotHeight
      const height = Math.max(36, ((eventEnd - eventStart) / daySlotMinutes) * daySlotHeight - 4)
      return { task, top, height, start: eventStart, end: eventEnd }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  return layoutLanes(timed)
})

const dayEventsUntimed = computed(() =>
  tasksForSelectedDate.value.filter((task) => !task.startTime),
)

const dayGridHeight = computed(
  () => dayGridTopPadding + (daySlots.value.length - 1) * daySlotHeight + dayGridBottomPadding,
)

const dayGridViewportHeight = computed(
  () =>
    dayGridTopPadding +
    ((dayViewportEndHour * 60 - dayStartHour * 60) / daySlotMinutes) * daySlotHeight +
    dayGridBottomPadding,
)

const showNowMarker = computed(() => {
  if (isDayView.value && selectedDate.value !== todayKey) return false
  if (isWeekView.value && !weekDays.value.some((d) => d.key === todayKey)) return false
  const now = nowMarkerMinutes.value
  if (now == null) return false
  return now >= dayStartHour * 60 && now <= dayEndHour * 60
})

const nowMarkerTop = computed(() => {
  const now = nowMarkerMinutes.value ?? dayStartHour * 60
  return dayGridTopPadding + ((now - dayStartHour * 60) / daySlotMinutes) * daySlotHeight
})

function refreshNowMarker() {
  const now = new Date()
  nowMarkerMinutes.value = now.getHours() * 60 + now.getMinutes()
  nowMarkerLabel.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function scrollDayViewportToNow(force = false) {
  const container = dayEventsScrollRef.value
  if (!container) return
  const showsToday = isWeekView.value ? weekDays.value.some((d) => d.key === todayKey) : selectedDate.value === todayKey
  if (!showsToday) {
    if (force) container.scrollTop = 0
    return
  }
  const now = nowMarkerMinutes.value
  if (now == null) return
  const top = dayGridTopPadding + ((now - dayStartHour * 60) / daySlotMinutes) * daySlotHeight
  const target = Math.max(0, top - container.clientHeight * 0.35)
  container.scrollTo({ top: target, behavior: force ? 'auto' : 'smooth' })
}

function selectDay(key: string) {
  selectedDate.value = key
}

async function loadAssigneesForVisibleTasks() {
  const ids = visibleTasksForAssignees.value.map((t) => t.id)
  if (ids.length === 0 || !isSupabaseConfigured()) {
    taskAssigneeIdsByTaskId.value = {}
    taskAssigneeStatusByTaskId.value = {}
    return
  }
  const next: Record<string, string[]> = {}
  const nextStatus: Record<string, Record<string, CalendarTaskAssigneeStatus>> = {}
  await Promise.all(
    ids.map(async (taskId) => {
      try {
        const rows = await loadTaskAssignees(taskId)
        next[taskId] = rows.map((r) => r.user_id)
        nextStatus[taskId] = rows.reduce<Record<string, CalendarTaskAssigneeStatus>>((acc, row) => {
          acc[row.user_id] = row.status
          return acc
        }, {})
      } catch (e) {
        console.error('Исполнители задачи', e)
        next[taskId] = []
        nextStatus[taskId] = {}
      }
    }),
  )
  taskAssigneeIdsByTaskId.value = next
  taskAssigneeStatusByTaskId.value = nextStatus
}

function dayEventAssignees(taskId: string): ProfileRow[] {
  const ids = taskAssigneeIdsByTaskId.value[taskId] ?? []
  return ids
    .map((id) => profileById(id))
    .filter((p): p is ProfileRow => !!p)
}

function taskParticipationStatus(taskId: string): CalendarTaskAssigneeStatus | null {
  const me = myUserId.value
  if (!me) return null
  return taskAssigneeStatusByTaskId.value[taskId]?.[me] ?? null
}

function taskParticipationLabel(taskId: string): string {
  const status = taskParticipationStatus(taskId)
  if (status === 'pending') return 'Ожидает ответа'
  if (status === 'declined') return 'Отклонено'
  if (status === 'accepted') return 'Принято'
  return ''
}

function participationTone(status: CalendarTaskAssigneeStatus | null | undefined): UiBadgeTone {
  if (status === 'accepted') return 'success'
  if (status === 'declined') return 'danger'
  return 'warning'
}

/** Участники события строкой — подсказка при наведении на аватары. */
function taskAssigneesTitle(taskId: string): string {
  const names = dayEventAssignees(taskId).map((p) => profileLabel(p)).filter(Boolean)
  return names.length ? `Участники: ${names.join(', ')}` : ''
}

function buildAssigneeStatusPayload(taskId: string | null): Record<string, CalendarTaskAssigneeStatus> {
  const existing = (taskId ? taskAssigneeStatusByTaskId.value[taskId] : undefined) ?? {}
  const next: Record<string, CalendarTaskAssigneeStatus> = {}
  for (const uid of taskAssignees.value) {
    next[uid] = existing[uid] ?? 'pending'
  }
  const owner = effectiveCalendarUserId.value ?? auth.user.value?.id ?? null
  if (owner && next[owner]) next[owner] = 'accepted'
  return next
}

function prevMonth() {
  monthExpandedDate.value = null
  if (currentMonth.value === 0) {
    currentMonth.value = 11
    currentYear.value -= 1
  } else {
    currentMonth.value -= 1
  }
}

function nextMonth() {
  monthExpandedDate.value = null
  if (currentMonth.value === 11) {
    currentMonth.value = 0
    currentYear.value += 1
  } else {
    currentMonth.value += 1
  }
}

async function loadTasksFromDb() {
  const uid = effectiveCalendarUserId.value
  if (!isSupabaseConfigured() || !uid) {
    tasks.value = []
    return
  }
  tasksLoading.value = true
  try {
    const rows = await loadCalendarTasks(uid)
    loadError.value = ''
    tasks.value = rows.map(rowToTask)
  } catch (e) {
    loadError.value = formatSupabaseError(e) || 'Не удалось загрузить задачи календаря'
    tasks.value = []
  } finally {
    tasksLoading.value = false
  }
}

async function loadProfilesOnce() {
  if (!isSupabaseConfigured()) return
  try {
    profiles.value = await loadProfiles()
  } catch (e) {
    console.error('Список сотрудников', e)
    profiles.value = []
  }
}

watch(
  () => [visibleTaskIdsKey.value, selectedDate.value, calendarViewMode.value] as const,
  () => {
    void loadAssigneesForVisibleTasks()
    void nextTick(() => scrollDayViewportToNow(true))
  },
  { immediate: true },
)

// Месяц мини-календаря и режима «Месяц» следует за выбранным днём.
watch(selectedDate, (key) => {
  const d = parseDateKey(key)
  currentYear.value = d.getFullYear()
  currentMonth.value = d.getMonth()
})

watch(taskRepeatRule, (rule) => {
  if (rule !== 'weekly') return
  if (taskRepeatWeekDays.value.length > 0) return
  const base = taskStartDate.value || selectedDate.value
  taskRepeatWeekDays.value = [weekdayMon1Sun7(base)]
})

watch(
  () => [auth.user.value?.id, isManager.value] as const,
  ([uid, mgr]) => {
    if (!uid || !mgr) return
    if (!managerCalendarUserId.value) managerCalendarUserId.value = uid
  },
  { immediate: true },
)

watch(
  effectiveCalendarUserId,
  (uid) => {
    if (!uid) {
      tasks.value = []
      scheduleTasks.value = []
      return
    }
    void loadTasksFromDb()
    if (isScheduleView.value) void loadSchedulePage(false)
  },
  { immediate: true },
)

watch(
  isScheduleView,
  (active) => {
    if (!active) return
    void loadSchedulePage(false)
  },
)

watch(editingTaskId, () => {
  deleteScope.value = 'only_this'
  deleteAudienceScope.value = 'all'
})

onMounted(() => {
  loadProfilesOnce()
  refreshNowMarker()
  nowMarkerTimer = setInterval(refreshNowMarker, 30_000)
  void nextTick(() => scrollDayViewportToNow(true))
})

onUnmounted(() => {
  if (nowMarkerTimer) clearInterval(nowMarkerTimer)
})

function openNewTaskModal(startTime?: string) {
  editingTaskId.value = null
  taskTitle.value = ''
  taskDescription.value = ''
  taskStartDate.value = selectedDate.value
  taskStartTime.value = startTime ?? '09:00'
  taskEndTime.value = minutesToHhmm((hhmmToMinutes(taskStartTime.value) ?? 540) + 60)
  taskPriority.value = 'normal'
  taskRepeatRule.value = 'none'
  taskRepeatEvery.value = 1
  taskRepeatEndMode.value = 'after'
  taskRepeatCount.value = 10
  taskRepeatUntil.value = selectedDate.value
  taskRepeatWeekDays.value = [weekdayMon1Sun7(selectedDate.value)]
  taskRepeatApplyMode.value = 'only_this'
  const owner = effectiveCalendarUserId.value
  taskAssignees.value = owner ? [owner] : auth.user.value?.id ? [auth.user.value.id] : []
  taskFiles.value = []
  modalError.value = ''
  isTaskModalOpen.value = true
}

function onDayGridClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (target?.closest('.day-event-card')) return
  const grid = e.currentTarget as HTMLElement | null
  if (!grid) return
  const rect = grid.getBoundingClientRect()
  const y = Math.max(dayGridTopPadding, Math.min(grid.scrollHeight, e.clientY - rect.top))
  const minutesFromStart = Math.floor((y - dayGridTopPadding) / daySlotHeight) * daySlotMinutes
  const startMinutes = dayStartHour * 60 + minutesFromStart
  if (isWeekView.value) {
    const gutter = gridGutter
    const usableWidth = Math.max(1, rect.width - gutter)
    const relativeX = Math.max(0, Math.min(usableWidth - 1, e.clientX - rect.left - gutter))
    const dayIndex = Math.max(0, Math.min(6, Math.floor((relativeX / usableWidth) * 7)))
    const pickedDay = weekDays.value[dayIndex]
    if (pickedDay) selectedDate.value = pickedDay.key
  }
  openNewTaskModal(minutesToHhmm(startMinutes))
}

async function openEditTaskModal(task: CalendarTask) {
  editingTaskId.value = task.id
  taskTitle.value = task.title
  taskDescription.value = task.description
  taskStartDate.value = task.date
  taskStartTime.value = task.startTime ?? '09:00'
  taskEndTime.value = task.endTime ?? '11:30'
  taskPriority.value = task.priority
  taskRepeatRule.value = 'none'
  taskRepeatEvery.value = 1
  taskRepeatEndMode.value = 'after'
  taskRepeatCount.value = 10
  taskRepeatUntil.value = task.date
  taskRepeatWeekDays.value = [weekdayMon1Sun7(task.date)]
  taskRepeatApplyMode.value = 'only_this'
  taskFiles.value = []
  modalError.value = ''
  isTaskModalOpen.value = true
  if (isSupabaseConfigured()) {
    try {
      const rows = await loadTaskAssignees(task.id)
      taskAssignees.value = rows.map((r) => r.user_id)
      taskAssigneeStatusByTaskId.value = {
        ...taskAssigneeStatusByTaskId.value,
        [task.id]: rows.reduce<Record<string, CalendarTaskAssigneeStatus>>((acc, row) => {
          acc[row.user_id] = row.status
          return acc
        }, {}),
      }
      taskFiles.value = await loadTaskFiles(task.id)
    } catch (e) {
      modalError.value = formatSupabaseError(e) || 'Не удалось загрузить участников и файлы события'
      taskAssignees.value = []
      taskAssigneeStatusByTaskId.value = {
        ...taskAssigneeStatusByTaskId.value,
        [task.id]: {},
      }
    }
  } else {
    taskAssignees.value = []
  }
}

function removeAssignee(uid: string) {
  taskAssignees.value = taskAssignees.value.filter((id) => id !== uid)
}

function addAssignee(uid: string) {
  if (!taskAssignees.value.includes(uid)) taskAssignees.value = [...taskAssignees.value, uid]
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !editingTaskId.value || !isSupabaseConfigured()) return
  fileUploading.value = true
  try {
    const row = await uploadTaskFile(editingTaskId.value, file)
    taskFiles.value = [row, ...taskFiles.value]
  } catch (err) {
    modalError.value = `Файл не прикрепился: ${formatSupabaseError(err) || 'ошибка загрузки'}`
  } finally {
    fileUploading.value = false
    input.value = ''
  }
}

function triggerFileInput() {
  if (editingTaskId.value) fileInputRef.value?.click()
}

async function removeFile(fileRow: CalendarTaskFileRow) {
  if (!isSupabaseConfigured()) return
  if (!(await askConfirm('Удалить файл?', `«${fileRow.file_name}» будет удалён из события.`))) return
  try {
    await deleteTaskFile(fileRow.id)
    taskFiles.value = taskFiles.value.filter((f) => f.id !== fileRow.id)
  } catch (err) {
    modalError.value = `Файл не удалён: ${formatSupabaseError(err) || 'ошибка'}`
  }
}

async function setMyParticipationStatus(status: CalendarTaskAssigneeStatus) {
  const me = myUserId.value
  const task = editingTask.value
  if (!me || !task || !isSupabaseConfigured()) return
  try {
    await updateTaskAssigneeStatus(task.id, me, status)
    taskAssigneeStatusByTaskId.value = {
      ...taskAssigneeStatusByTaskId.value,
      [task.id]: {
        ...(taskAssigneeStatusByTaskId.value[task.id] ?? {}),
        [me]: status,
      },
    }
    await loadTasksFromDb()
    if (isScheduleView.value) await loadSchedulePage(false)
    void loadAssigneesForVisibleTasks()
    if (status === 'accepted') {
      successModalTitle.value = 'Приглашение принято'
      successModalMessage.value = 'Вы подтвердили участие в событии.'
    } else if (status === 'declined') {
      successModalTitle.value = 'Приглашение отклонено'
      successModalMessage.value = 'Событие останется в календаре с меткой «Отклонено».'
    }
    successModalOpen.value = true
  } catch (err) {
    modalError.value = formatSupabaseError(err) || 'Не удалось изменить участие'
  }
}

function closeTaskModal() {
  isTaskModalOpen.value = false
}

async function onSubmitTask() {
  const title = taskTitle.value.trim()
  if (!title) return

  if (!isSupabaseConfigured()) return

  modalError.value = ''
  taskSaveLoading.value = true
  try {
    const id = editingTaskId.value
    const date = taskStartDate.value || selectedDate.value
    const startTime = taskStartTime.value?.trim() || null
    const endTime = taskEndTime.value?.trim() || null
    const participantIds = [...new Set(taskAssignees.value.filter(Boolean))]
    if (id && !canEditCurrentTask.value) {
      modalError.value = 'Редактировать событие может только его постановщик или руководитель.'
      return
    }
    if (id) {
      const assigneeStatusPayload = buildAssigneeStatusPayload(id)
      if (taskRepeatRule.value === 'none' || taskRepeatApplyMode.value === 'only_this') {
        const ok = await ensureNoParticipantConflicts({
          participantIds,
          dates: [date],
          startTime,
          endTime,
          excludeTaskId: id,
        })
        if (!ok) return
        await updateCalendarTask(id, {
          date,
          title,
          description: taskDescription.value.trim() || null,
          start_time: startTime,
          end_time: endTime,
          priority: taskPriority.value,
          assignee_ids: taskAssignees.value,
          assignee_status_by_user_id: assigneeStatusPayload,
        })
      } else {
        const repeatUntil = taskRepeatUntil.value || date
        const plannedDates = buildRecurringDates(
          date,
          taskRepeatRule.value,
          taskRepeatEvery.value,
          taskRepeatEndMode.value,
          taskRepeatCount.value,
          repeatUntil,
          taskRepeatWeekDays.value,
        )
        const ok = await ensureNoParticipantConflicts({
          participantIds,
          dates: plannedDates,
          startTime,
          endTime,
          excludeTaskId: id,
        })
        if (!ok) return
        await updateCalendarTask(id, {
          date,
          title,
          description: taskDescription.value.trim() || null,
          start_time: startTime,
          end_time: endTime,
          priority: taskPriority.value,
          assignee_ids: taskAssignees.value,
          assignee_status_by_user_id: assigneeStatusPayload,
        })
        for (const plannedDate of plannedDates.slice(1)) {
          await insertCalendarTask({
            user_id: effectiveCalendarUserId.value ?? auth.user.value?.id ?? null,
            date: plannedDate,
            title,
            description: taskDescription.value.trim() || null,
            start_time: startTime,
            end_time: endTime,
            priority: taskPriority.value,
            assignee_ids: taskAssignees.value,
            assignee_status_by_user_id: buildAssigneeStatusPayload(null),
          })
        }
      }
    } else {
      const repeatRule = taskRepeatRule.value
      if (repeatRule === 'weekly' && taskRepeatWeekDays.value.length === 0) {
        modalError.value = 'Выберите хотя бы один день недели для повтора.'
        return
      }
      const repeatUntil = taskRepeatUntil.value || date
      const plannedDates = buildRecurringDates(
        date,
        repeatRule,
        taskRepeatEvery.value,
        taskRepeatEndMode.value,
        taskRepeatCount.value,
        repeatUntil,
        taskRepeatWeekDays.value,
      )
      const ok = await ensureNoParticipantConflicts({
        participantIds,
        dates: plannedDates,
        startTime,
        endTime,
      })
      if (!ok) return
      for (const plannedDate of plannedDates) {
        await insertCalendarTask({
          user_id: effectiveCalendarUserId.value ?? auth.user.value?.id ?? null,
          date: plannedDate,
          title,
          description: taskDescription.value.trim() || null,
          start_time: startTime,
          end_time: endTime,
          priority: taskPriority.value,
          assignee_ids: taskAssignees.value,
          assignee_status_by_user_id: buildAssigneeStatusPayload(null),
        })
      }
    }
    await loadTasksFromDb()
    if (isScheduleView.value) await loadSchedulePage(false)
    isTaskModalOpen.value = false
    successModalTitle.value = editingTaskId.value ? 'Изменения сохранены' : 'Событие создано'
    successModalMessage.value = editingTaskId.value
      ? taskRepeatRule.value !== 'none' && taskRepeatApplyMode.value === 'this_and_following'
        ? 'Событие обновлено, а следующие встречи созданы по новому правилу.'
        : 'Данные события успешно обновлены.'
      : taskRepeatRule.value === 'none'
        ? 'Новое событие успешно добавлено.'
        : 'Серия событий успешно добавлена.'
    successModalOpen.value = true
  } catch (e) {
    modalError.value = formatSupabaseError(e) || 'Не удалось сохранить событие'
  } finally {
    taskSaveLoading.value = false
  }
}

async function deleteTask(id: string) {
  await deleteCalendarTask(id)
  await loadTasksFromDb()
  if (isScheduleView.value) await loadSchedulePage(false)
}

function openDeleteConfirm() {
  if (!canDeleteCurrentTask.value) {
    modalError.value = 'Удалять событие может руководитель, постановщик или участник события (только у себя).'
    return
  }
  deleteScope.value = 'only_this'
  deleteAudienceScope.value = canDeleteForAll.value ? 'all' : 'only_me'
  showDeleteConfirm.value = true
}

function closeDeleteConfirm() {
  if (!deleteInProgress.value) showDeleteConfirm.value = false
}

async function confirmDeleteTask() {
  const currentId = editingTaskId.value
  const currentTask = editingTask.value
  if (!currentId || !currentTask) return
  if (!canDeleteCurrentTask.value) {
    closeDeleteConfirm()
    modalError.value = 'Удалять событие может руководитель, постановщик или участник события (только у себя).'
    return
  }
  deleteInProgress.value = true
  try {
    if (deleteAudienceScope.value === 'only_me' && canDeleteOnlyForMe.value && myUserId.value) {
      // "Удалить только у меня" после отказа: убираем связь участника, чтобы слот пропал из моего календаря.
      await removeTaskAssignee(currentId, myUserId.value)
      await loadTasksFromDb()
      if (isScheduleView.value) await loadSchedulePage(false)
    } else if (deleteAudienceScope.value === 'all' && !canDeleteForAll.value) {
      showDeleteConfirm.value = false
      modalError.value = 'Удалять у всех может только постановщик события или руководитель.'
      return
    } else if (deleteScope.value === 'this_and_following' && canDeleteAsSeries.value) {
      const ids = deleteSeriesCandidates.value
        .filter((t) => t.date >= currentTask.date)
        .map((t) => t.id)
      await Promise.all(ids.map((id) => deleteCalendarTask(id)))
      await loadTasksFromDb()
      if (isScheduleView.value) await loadSchedulePage(false)
    } else {
      await deleteTask(currentId)
    }
    showDeleteConfirm.value = false
    closeTaskModal()
    toast.success('Событие удалено')
  } catch (e) {
    showDeleteConfirm.value = false
    modalError.value = formatSupabaseError(e) || 'Не удалось удалить событие'
  } finally {
    deleteInProgress.value = false
  }
}
</script>

<template>
  <section class="tw-scope flex flex-col gap-6">
    <Alert v-if="loadError" variant="destructive">
      <AlertDescription>{{ loadError }}</AlertDescription>
    </Alert>

    <PageToolbar>
      <ToggleGroup
        type="single"
        variant="outline"
        aria-label="Режим календаря"
        :model-value="calendarViewMode"
        @update:model-value="(v) => v && setCalendarView(v as CalendarView)"
      >
        <ToggleGroupItem value="day" class="px-3">День</ToggleGroupItem>
        <ToggleGroupItem value="week" class="px-3">Неделя</ToggleGroupItem>
        <ToggleGroupItem value="month" class="px-3">Месяц</ToggleGroupItem>
        <ToggleGroupItem value="schedule" class="px-3">Расписание</ToggleGroupItem>
      </ToggleGroup>
      <div v-if="isManager" class="w-full sm:w-64">
        <UiSelect
          v-model="managerCalendarUserId"
          block
          aria-label="Чей календарь показать"
          :options="managerCalendarOptions.map((opt) => ({ value: opt.id, label: `${opt.label}${opt.id === auth.user.value?.id ? ' (я)' : ''}` }))"
        />
      </div>
      <template #actions>
        <Button type="button" @click="openNewTaskModal()">
          <PlusIcon />
          Создать событие
        </Button>
      </template>
    </PageToolbar>

    <div class="grid items-start gap-6" :class="isDayView ? 'lg:grid-cols-[16rem_minmax(0,1fr)]' : ''">
      <!-- Мини-календарь (режим «День») -->
      <section v-if="isDayView" class="hidden rounded-xl border bg-card p-4 lg:block" aria-label="Выбор дня">
        <div class="mb-3 flex items-center justify-between gap-2">
          <Button variant="ghost" size="icon-sm" type="button" aria-label="Предыдущий месяц" @click="prevMonth">
            <ChevronLeftIcon />
          </Button>
          <span class="text-sm font-medium">{{ currentMonthLabel }}</span>
          <Button variant="ghost" size="icon-sm" type="button" aria-label="Следующий месяц" @click="nextMonth">
            <ChevronRightIcon />
          </Button>
        </div>
        <div class="grid grid-cols-7 gap-y-1 text-center">
          <span v-for="day in weekdaysShort" :key="day" class="pb-1 text-xs text-muted-foreground">{{ day }}</span>
          <button
            v-for="day in calendarWeeks.flat()"
            :key="day.key"
            type="button"
            class="relative mx-auto flex size-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors"
            :class="[
              day.isSelected
                ? 'bg-primary font-medium text-primary-foreground'
                : day.isToday
                  ? 'font-semibold text-primary hover:bg-muted'
                  : 'hover:bg-muted',
              !day.inCurrentMonth && !day.isSelected ? 'text-muted-foreground/60' : '',
            ]"
            :aria-pressed="day.isSelected"
            @click="selectDay(day.key)"
          >
            {{ day.date }}
            <span
              v-if="day.hasTasks"
              class="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full"
              :class="day.isSelected ? 'bg-primary-foreground' : 'bg-primary'"
            />
          </button>
        </div>
      </section>

      <section class="min-w-0 overflow-hidden rounded-xl border bg-card">
        <header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
          <div v-if="!isScheduleView" class="flex items-center gap-1">
            <Button variant="outline" size="sm" type="button" @click="goToday">Сегодня</Button>
            <Button variant="ghost" size="icon-sm" type="button" :aria-label="isMonthView ? 'Предыдущий месяц' : isWeekView ? 'Предыдущая неделя' : 'Предыдущий день'" @click="shiftPeriod(-1)">
              <ChevronLeftIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" type="button" :aria-label="isMonthView ? 'Следующий месяц' : isWeekView ? 'Следующая неделя' : 'Следующий день'" @click="shiftPeriod(1)">
              <ChevronRightIcon />
            </Button>
          </div>
          <h2 class="text-base font-semibold first-letter:uppercase">{{ periodTitle }}</h2>
          <span class="ml-auto text-sm text-muted-foreground tabular-nums">
            {{ periodEventsCount ? `${periodEventsCount} ${pluralEvents(periodEventsCount)}` : 'Нет событий' }}
          </span>
        </header>

        <div v-if="tasksLoading" class="grid gap-3 p-4" aria-busy="true">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-2/3" />
          <Skeleton class="h-10 w-5/6" />
        </div>

        <!-- Неделя -->
        <div v-else-if="isWeekView" class="overflow-x-auto">
          <div class="min-w-[44rem]">
            <div class="grid border-b" :style="{ gridTemplateColumns: `${gridGutter}px repeat(7, minmax(0, 1fr))` }">
              <span />
              <button
                v-for="day in weekDays"
                :key="day.key"
                type="button"
                class="flex flex-col items-center gap-0.5 border-l py-2 transition-colors hover:bg-muted/50"
                :class="day.isWeekend ? 'bg-muted/30' : ''"
                @click="selectDay(day.key)"
              >
                <span class="text-xs text-muted-foreground">{{ day.weekDay }}</span>
                <span
                  class="flex size-7 items-center justify-center rounded-full text-sm tabular-nums"
                  :class="day.isToday ? 'bg-primary font-semibold text-primary-foreground' : day.isSelected ? 'bg-muted font-semibold' : ''"
                >{{ day.date }}</span>
              </button>
            </div>
            <div ref="dayEventsScrollRef" class="overflow-y-auto overscroll-contain" :style="{ height: `${dayGridViewportHeight}px` }">
              <div
                class="relative cursor-cell"
                :style="{ height: `${dayGridHeight}px` }"
                @click="onDayGridClick"
                @dragover="onWeekGridDragOver"
                @drop="onWeekGridDrop"
              >
                <div
                  v-for="(day, idx) in weekDays"
                  :key="`col-${day.key}`"
                  class="pointer-events-none absolute inset-y-0 border-l"
                  :class="day.isWeekend ? 'bg-muted/30' : ''"
                  :style="{ left: `calc(${gridGutter}px + ${idx} * ((100% - ${gridGutter}px) / 7))`, width: `calc((100% - ${gridGutter}px) / 7)` }"
                />
                <div
                  v-for="slot in daySlots.slice(0, -1)"
                  :key="`week-${slot.key}`"
                  class="pointer-events-none absolute inset-x-0 h-0"
                  :style="{ top: `${dayGridTopPadding + ((slot.minutes - dayStartHour * 60) / daySlotMinutes) * daySlotHeight}px` }"
                >
                  <span v-if="slot.minutes % 60 === 0" class="absolute left-0 -translate-y-1/2 pr-2 text-right text-xs text-muted-foreground tabular-nums" :style="{ width: `${gridGutter}px` }">{{ slot.label }}</span>
                  <span class="absolute right-0 border-t" :class="slot.minutes % 60 === 0 ? '' : 'opacity-40'" :style="{ left: `${gridGutter}px` }" />
                </div>
                <article
                  v-for="event in weekEventsTimed"
                  :key="`week-ev-${event.task.id}`"
                  class="day-event-card absolute flex cursor-pointer flex-col overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-xs shadow-xs transition-colors"
                  :class="eventToneClass(event.task.priority)"
                  draggable="true"
                  role="button"
                  tabindex="0"
                  :title="taskAssigneesTitle(event.task.id) || undefined"
                  :style="{
                    top: `${event.top}px`,
                    height: `${event.height}px`,
                    left: `calc(${gridGutter}px + ${event.dayIndex} * ((100% - ${gridGutter}px) / 7) + 2px + ${event.lane} * (((100% - ${gridGutter}px) / 7 - 4px) / ${event.lanes}))`,
                    width: `calc(((100% - ${gridGutter}px) / 7 - 4px) / ${event.lanes} - 2px)`,
                  }"
                  @click.stop="openEditTaskModal(event.task)"
                  @keydown.enter="openEditTaskModal(event.task)"
                  @dragstart="onWeekEventDragStart(event.task.id, event.start, event.end, event.task.priority, $event)"
                  @dragend="onWeekEventDragEnd"
                >
                  <span v-if="event.height < 56" class="truncate leading-snug">
                    <span class="text-muted-foreground tabular-nums">{{ minutesToHhmm(event.start) }}</span>
                    <span class="font-medium text-foreground"> {{ event.task.title || 'Без названия' }}</span>
                  </span>
                  <template v-else>
                    <span class="line-clamp-2 font-medium leading-snug text-foreground">{{ event.task.title || 'Без названия' }}</span>
                    <span class="truncate text-muted-foreground tabular-nums">{{ minutesToHhmm(event.start) }}<template v-if="event.task.endTime">–{{ event.task.endTime }}</template></span>
                  </template>
                </article>
                <div
                  v-if="weekDragPreview"
                  class="pointer-events-none absolute rounded-md border border-dashed border-primary bg-primary/10 px-1.5 py-1 text-xs text-primary tabular-nums"
                  :style="{
                    top: `${weekDragPreview.top}px`,
                    height: `${weekDragPreview.height}px`,
                    left: `calc(${gridGutter}px + ${weekDragPreview.dayIndex} * ((100% - ${gridGutter}px) / 7) + 2px)`,
                    width: `calc((100% - ${gridGutter}px) / 7 - 4px)`,
                  }"
                >
                  {{ minutesToHhmm(weekDragPreview.start) }}–{{ minutesToHhmm(weekDragPreview.end) }}
                </div>
                <div v-if="showNowMarker" class="pointer-events-none absolute right-0 z-10 h-px bg-red-500" :style="{ top: `${nowMarkerTop}px`, left: `${gridGutter}px` }" aria-hidden="true">
                  <span class="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Месяц -->
        <div v-else-if="isMonthView" class="overflow-x-auto">
          <div class="min-w-[44rem]">
            <div class="grid grid-cols-7 border-b bg-muted/40">
              <span v-for="day in weekdaysShort" :key="`m-${day}`" class="px-2 py-2 text-xs font-medium text-muted-foreground">{{ day }}</span>
            </div>
            <div class="grid grid-cols-7">
              <div
                v-for="cell in monthCells"
                :key="`m-cell-${cell.key}`"
                role="button"
                tabindex="0"
                class="flex min-h-28 min-w-0 cursor-pointer flex-col gap-1 border-b border-r p-1.5 text-left transition-colors hover:bg-muted/40 [&:nth-child(7n)]:border-r-0"
                :class="[
                  cell.isWeekend ? 'bg-muted/30' : '',
                  monthDropTargetDate === cell.key ? 'bg-primary/10 ring-2 ring-inset ring-primary' : '',
                ]"
                @click="onMonthCellClick(cell.key)"
                @keydown.enter.self="onMonthCellClick(cell.key)"
                @dragover="onMonthCellDragOver(cell.key, $event)"
                @dragleave="onMonthCellDragLeave(cell.key)"
                @drop="onMonthCellDrop(cell.key, $event)"
              >
                <span
                  class="flex size-6 items-center justify-center rounded-full text-xs tabular-nums"
                  :class="[
                    cell.isToday ? 'bg-primary font-semibold text-primary-foreground' : cell.isSelected ? 'bg-muted font-semibold' : '',
                    !cell.inCurrentMonth && !cell.isToday ? 'text-muted-foreground/60' : '',
                  ]"
                >{{ cell.date }}</span>
                <div class="grid min-w-0 gap-0.5">
                  <button
                    v-for="t in ((monthExpandedRowIndex !== null && monthExpandedRowIndex === cell.rowIndex) ? cell.allTasks : cell.tasks)"
                    :key="t.id"
                    type="button"
                    class="flex min-w-0 items-center gap-1 rounded border-l-2 px-1.5 py-0.5 text-left text-xs transition-colors"
                    :class="[eventToneClass(t.priority), monthReorderTargetTaskId === t.id ? 'ring-2 ring-primary' : '']"
                    draggable="true"
                    @click.stop="openEditTaskModal(t)"
                    @dragstart="onMonthEventDragStart(t.id, $event)"
                    @dragend="onMonthEventDragEnd"
                    @dragover="onMonthEventReorderOver(cell.key, t.id, $event)"
                    @dragleave="onMonthEventReorderLeave(t.id)"
                    @drop="onMonthEventReorderDrop(cell.key, t.id, $event)"
                  >
                    <span v-if="t.startTime" class="shrink-0 text-muted-foreground tabular-nums">{{ t.startTime }}</span>
                    <span class="truncate">{{ t.title }}</span>
                  </button>
                </div>
                <button
                  v-if="cell.more > 0 || monthExpandedDate === cell.key"
                  type="button"
                  class="self-start rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  @click.stop="toggleMonthMore(cell.key)"
                >
                  {{ monthExpandedDate === cell.key ? 'Свернуть' : `Ещё ${cell.more}` }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Расписание -->
        <div v-else-if="isScheduleView" ref="scheduleListRef" class="max-h-[70vh] overflow-y-auto overscroll-contain" @scroll.passive="onScheduleScroll">
          <div v-if="scheduleLoading" class="grid gap-3 p-4">
            <Skeleton v-for="i in 4" :key="i" class="h-10 w-full" />
          </div>
          <template v-else>
            <section v-for="group in scheduleGroups" :key="group.date">
              <h3 class="sticky top-0 z-10 border-b bg-muted/80 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur first-letter:uppercase">
                {{ group.label }}
              </h3>
              <ul>
                <li v-for="task in group.tasks" :key="task.id" class="border-b last:border-b-0">
                  <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50" @click="openEditTaskModal(task)">
                    <span class="w-24 shrink-0 text-sm text-muted-foreground tabular-nums">
                      {{ task.startTime ? `${task.startTime}${task.endTime ? `–${task.endTime}` : ''}` : 'Весь день' }}
                    </span>
                    <span class="size-2 shrink-0 rounded-full" :class="eventDotClass(task.priority)" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ task.title }}</span>
                    <UiBadge v-if="isTaskRecurringInSchedule(task)" tone="neutral" class="hidden sm:inline-flex">Повторяется</UiBadge>
                    <UiBadge v-if="taskParticipationLabel(task.id)" :tone="participationTone(taskParticipationStatus(task.id))">
                      {{ taskParticipationLabel(task.id) }}
                    </UiBadge>
                    <span v-if="dayEventAssignees(task.id).length" class="hidden shrink-0 -space-x-1.5 sm:flex" :title="taskAssigneesTitle(task.id)">
                      <UserAvatar
                        v-for="p in dayEventAssignees(task.id).slice(0, 3)"
                        :key="`s-${task.id}-${p.id}`"
                        class="size-6 text-[10px] font-medium text-white ring-2 ring-card"
                        :style="assigneeAvatarStyle(p)"
                        :url="p.avatar_url"
                        :initials="assigneeInitials(p)"
                      />
                    </span>
                  </button>
                </li>
              </ul>
            </section>
            <div v-if="scheduleLoadingMore" class="flex justify-center p-4">
              <Spinner class="size-4 text-muted-foreground" />
            </div>
            <p v-else-if="!scheduleHasMore && scheduleTasks.length" class="px-4 py-3 text-center text-xs text-muted-foreground">Больше событий нет</p>
            <Empty v-if="!scheduleTasks.length" class="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon"><CalendarDaysIcon /></EmptyMedia>
                <EmptyTitle>Событий нет</EmptyTitle>
                <EmptyDescription>Запланированные события появятся здесь списком по дням.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </template>
        </div>

        <!-- День -->
        <div v-else class="flex flex-col lg:flex-row">
          <div class="min-w-0 flex-1">
            <div ref="dayEventsScrollRef" class="overflow-y-auto overscroll-contain" :style="{ height: `${dayGridViewportHeight}px` }">
              <div
                class="relative cursor-cell"
                :style="{ height: `${dayGridHeight}px` }"
                @click.self="onDayGridClick"
                @dragover="onDayGridDragOver"
                @drop="onDayGridDrop"
              >
                <div
                  v-for="slot in daySlots.slice(0, -1)"
                  :key="slot.key"
                  class="pointer-events-none absolute inset-x-0 h-0"
                  :style="{ top: `${dayGridTopPadding + ((slot.minutes - dayStartHour * 60) / daySlotMinutes) * daySlotHeight}px` }"
                >
                  <span v-if="slot.minutes % 60 === 0" class="absolute left-0 -translate-y-1/2 pr-2 text-right text-xs text-muted-foreground tabular-nums" :style="{ width: `${gridGutter}px` }">{{ slot.label }}</span>
                  <span class="absolute right-0 border-t" :class="slot.minutes % 60 === 0 ? '' : 'opacity-40'" :style="{ left: `${gridGutter}px` }" />
                </div>
                <article
                  v-for="event in dayEventsTimed"
                  :key="event.task.id"
                  class="day-event-card absolute flex cursor-pointer flex-col gap-0.5 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-xs shadow-xs transition-colors"
                  :class="[eventToneClass(event.task.priority), { 'opacity-60': event.task.completedAt, 'opacity-40': dayDragTaskId === event.task.id }]"
                  :style="{
                    top: `${event.top}px`,
                    height: `${event.height}px`,
                    left: `calc(${gridGutter}px + ${event.lane} * ((100% - ${gridGutter}px - 8px) / ${event.lanes}))`,
                    width: `calc((100% - ${gridGutter}px - 8px) / ${event.lanes} - 4px)`,
                  }"
                  role="button"
                  tabindex="0"
                  draggable="true"
                  @click.stop="openEditTaskModal(event.task)"
                  @keydown.enter="openEditTaskModal(event.task)"
                  @dragstart="onDayEventDragStart(event.task.id, event.start, event.end, event.task.priority, $event)"
                  @dragend="onDayEventDragEnd"
                >
                  <div class="flex min-w-0 items-baseline gap-2">
                    <span class="truncate text-sm font-medium text-foreground">{{ event.task.title || 'Без названия' }}</span>
                    <span class="shrink-0 text-muted-foreground tabular-nums">{{ minutesToHhmm(event.start) }}<template v-if="event.task.endTime">–{{ event.task.endTime }}</template></span>
                  </div>
                  <div v-if="event.height >= 64" class="flex min-w-0 items-center gap-2">
                    <UiBadge v-if="taskParticipationLabel(event.task.id)" :tone="participationTone(taskParticipationStatus(event.task.id))">
                      {{ taskParticipationLabel(event.task.id) }}
                    </UiBadge>
                    <span v-if="dayEventAssignees(event.task.id).length" class="flex -space-x-1.5" :title="taskAssigneesTitle(event.task.id)">
                      <UserAvatar
                        v-for="p in dayEventAssignees(event.task.id).slice(0, 4)"
                        :key="p.id"
                        class="size-5 text-[9px] font-medium text-white ring-2 ring-card"
                        :style="assigneeAvatarStyle(p)"
                        :url="p.avatar_url"
                        :initials="assigneeInitials(p)"
                      />
                    </span>
                    <span v-if="dayEventAssignees(event.task.id).length > 4" class="text-muted-foreground">+{{ dayEventAssignees(event.task.id).length - 4 }}</span>
                  </div>
                </article>
                <div
                  v-if="dayDragPreview"
                  class="pointer-events-none absolute rounded-md border border-dashed border-primary bg-primary/10 px-2 py-1 text-xs text-primary tabular-nums"
                  :style="{ top: `${dayDragPreview.top}px`, height: `${dayDragPreview.height}px`, left: `${gridGutter}px`, right: '8px' }"
                >
                  {{ minutesToHhmm(dayDragPreview.start) }}–{{ minutesToHhmm(dayDragPreview.end) }}
                </div>
                <div v-if="showNowMarker" class="pointer-events-none absolute right-0 z-10 h-px bg-red-500" :style="{ top: `${nowMarkerTop}px`, left: `${gridGutter}px` }" aria-hidden="true">
                  <span class="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
                </div>
              </div>
            </div>
            <p v-if="!tasksForSelectedDate.length" class="border-t px-4 py-3 text-sm text-muted-foreground">
              На этот день событий нет. Нажмите на время в сетке, чтобы создать событие.
            </p>
          </div>
          <aside v-if="dayEventsUntimed.length" class="grid content-start gap-2 border-t p-4 lg:w-64 lg:border-l lg:border-t-0">
            <h3 class="text-sm font-medium">Без времени</h3>
            <button
              v-for="task in dayEventsUntimed"
              :key="task.id"
              type="button"
              class="grid gap-1 rounded-md border-l-[3px] px-3 py-2 text-left text-sm transition-colors"
              :class="eventToneClass(task.priority)"
              @click="openEditTaskModal(task)"
            >
              <span class="font-medium">{{ task.title }}</span>
              <span class="text-xs text-muted-foreground">Приоритет: {{ priorityLabel(task.priority).toLowerCase() }}</span>
            </button>
          </aside>
        </div>
      </section>
    </div>

    <UiModal
      v-if="isTaskModalOpen"
      :title="editingTaskId ? 'Событие' : 'Новое событие'"
      :description="`Постановщик: ${modalTaskOwnerLabel}`"
      :max-width="672"
      :close-disabled="taskSaveLoading"
      @close="closeTaskModal"
    >
      <form id="calendar-task-form" class="tw-scope" :aria-busy="taskSaveLoading" @submit.prevent="onSubmitTask">
        <fieldset :disabled="taskSaveLoading" class="m-0 min-w-0 border-0 p-0">
          <FormGrid :cols="2">
            <Alert v-if="modalError" variant="destructive" class="sm:col-span-full">
              <AlertDescription class="whitespace-pre-line">{{ modalError }}</AlertDescription>
            </Alert>

            <FormField label="Название" for="cal-title" wide>
              <Input id="cal-title" v-model="taskTitle" type="text" placeholder="Например, планёрка с агрономами" required />
            </FormField>

            <FormField label="Описание" for="cal-description" wide>
              <Textarea id="cal-description" v-model="taskDescription" rows="3" placeholder="Детали, место, что подготовить" />
            </FormField>

            <FormField label="Дата">
              <UiDatePicker v-model="taskStartDate" block aria-label="Дата события" />
            </FormField>

            <FormField label="Время" for="cal-start">
              <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <Input id="cal-start" v-model="taskStartTime" type="time" aria-label="Начало" />
                <span class="text-muted-foreground">–</span>
                <Input v-model="taskEndTime" type="time" aria-label="Окончание" />
              </div>
            </FormField>

            <FormField label="Приоритет">
              <UiSelect
                v-model="taskPriority"
                block
                aria-label="Приоритет"
                :options="[{ value: 'normal', label: 'Обычный' }, { value: 'high', label: 'Высокий' }, { value: 'low', label: 'Низкий' }]"
              />
            </FormField>

            <FormField label="Повтор">
              <UiSelect
                v-model="taskRepeatRule"
                block
                aria-label="Повтор"
                :options="[{ value: 'none', label: 'Не повторяется' }, { value: 'daily', label: 'Каждый день' }, { value: 'weekly', label: 'Каждую неделю' }, { value: 'monthly', label: 'Каждый месяц' }, { value: 'yearly', label: 'Каждый год' }]"
              />
            </FormField>

            <template v-if="taskRepeatRule !== 'none'">
              <FormField label="Интервал" for="cal-repeat-every">
                <div class="flex items-center gap-2 text-sm">
                  <span>Каждые</span>
                  <Input id="cal-repeat-every" v-model.number="taskRepeatEvery" type="number" min="1" max="365" class="w-20 tabular-nums" />
                  <span class="text-muted-foreground">{{ repeatUnitLabel }}</span>
                </div>
              </FormField>

              <FormField v-if="taskRepeatRule === 'weekly'" label="Дни недели">
                <ToggleGroup v-model="taskRepeatWeekDays" type="multiple" variant="outline" size="sm" class="w-full" aria-label="Дни недели">
                  <ToggleGroupItem v-for="(d, idx) in weekdaysShort" :key="d" :value="idx + 1" :aria-label="d" class="flex-1">{{ d }}</ToggleGroupItem>
                </ToggleGroup>
              </FormField>

              <FormField label="Окончание повтора" wide>
                <RadioGroup v-model="taskRepeatEndMode" class="gap-3">
                  <div class="flex items-center gap-2">
                    <RadioGroupItem id="cal-end-never" value="never" />
                    <Label for="cal-end-never" class="font-normal">Никогда</Label>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <RadioGroupItem id="cal-end-after" value="after" />
                    <Label for="cal-end-after" class="font-normal">После</Label>
                    <Input v-model.number="taskRepeatCount" type="number" min="1" max="500" class="h-8 w-20 tabular-nums" aria-label="Число повторений" :disabled="taskRepeatEndMode !== 'after'" />
                    <span class="text-sm text-muted-foreground">повторений</span>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <RadioGroupItem id="cal-end-date" value="on_date" />
                    <Label for="cal-end-date" class="font-normal">До даты</Label>
                    <div class="w-40">
                      <UiDatePicker v-model="taskRepeatUntil" block aria-label="Дата окончания повтора" :min="taskStartDate || selectedDate" :disabled="taskRepeatEndMode !== 'on_date'" />
                    </div>
                  </div>
                </RadioGroup>
              </FormField>

              <FormField v-if="editingTaskId" label="Применить изменения" wide hint="«К этому и следующим» создаст новые встречи по выбранному правилу начиная с даты события.">
                <RadioGroup v-model="taskRepeatApplyMode" class="gap-3">
                  <div class="flex items-center gap-2">
                    <RadioGroupItem id="cal-apply-one" value="only_this" />
                    <Label for="cal-apply-one" class="font-normal">Только к этому событию</Label>
                  </div>
                  <div class="flex items-center gap-2">
                    <RadioGroupItem id="cal-apply-next" value="this_and_following" />
                    <Label for="cal-apply-next" class="font-normal">К этому и следующим</Label>
                  </div>
                </RadioGroup>
              </FormField>
            </template>

            <FormField label="Участники" wide :hint="taskAssignees.length ? undefined : 'Участники увидят событие в своём календаре и смогут принять или отклонить приглашение.'">
              <template #label-actions>
                <UiPersonPicker
                  :options="profilesNotAssigned.map((p) => ({ id: p.id, label: profileLabel(p) + (p.id === auth.user.value?.id ? ' (Вы)' : ''), initials: assigneeInitials(p), url: p.avatar_url, avatarStyle: assigneeAvatarStyle(p) }))"
                  :all-added="profilesNotAssigned.length === 0"
                  @pick="addAssignee"
                />
              </template>
              <ul v-if="taskAssignees.length" class="flex flex-wrap gap-2">
                <li v-for="uid in taskAssignees" :key="uid" class="inline-flex h-8 max-w-full items-center gap-2 rounded-full border bg-muted/40 pl-1 pr-1 text-sm">
                  <UserAvatar
                    class="size-6 shrink-0 text-[10px] font-medium text-white"
                    :style="profileById(uid) ? assigneeAvatarStyle(profileById(uid)!) : undefined"
                    :url="profileById(uid)?.avatar_url ?? null"
                    :initials="profileById(uid) ? assigneeInitials(profileById(uid)!) : '?'"
                  />
                  <span class="min-w-0 truncate">{{ profileById(uid) ? profileLabel(profileById(uid)!) : uid }}</span>
                  <UiBadge v-if="editingTaskId" :tone="participationTone(assigneeStatusForModal(uid))" class="shrink-0">{{ assigneeStatusLabel(assigneeStatusForModal(uid)) }}</UiBadge>
                  <Button variant="ghost" size="icon-sm" type="button" class="size-6 shrink-0 rounded-full text-muted-foreground hover:text-destructive" :aria-label="`Убрать ${profileById(uid) ? profileLabel(profileById(uid)!) : ''}`" @click="removeAssignee(uid)">
                    <XIcon class="size-3.5" />
                  </Button>
                </li>
              </ul>
            </FormField>

            <FormField v-if="editingTaskId && currentTaskParticipationStatus" label="Моё участие" wide>
              <div class="flex flex-wrap items-center gap-2">
                <UiBadge :tone="participationTone(currentTaskParticipationStatus)">{{ taskParticipationLabel(editingTaskId) }}</UiBadge>
                <span class="flex-1" />
                <Button v-if="currentTaskParticipationStatus !== 'declined'" variant="outline" size="sm" type="button" @click="setMyParticipationStatus('declined')">
                  {{ currentTaskParticipationStatus === 'accepted' ? 'Отказаться' : 'Отклонить' }}
                </Button>
                <Button v-if="currentTaskParticipationStatus !== 'accepted'" size="sm" type="button" @click="setMyParticipationStatus('accepted')">
                  {{ currentTaskParticipationStatus === 'declined' ? 'Принять снова' : 'Принять' }}
                </Button>
              </div>
            </FormField>

            <FormField label="Файлы" wide>
              <template v-if="editingTaskId && taskFiles.length" #label-actions>
                <Button variant="outline" size="sm" type="button" :disabled="fileUploading" @click="triggerFileInput">
                  <Spinner v-if="fileUploading" />
                  <PaperclipIcon v-else />
                  Добавить
                </Button>
              </template>
              <ul v-if="taskFiles.length" class="grid gap-2 sm:grid-cols-2">
                <li v-for="f in taskFiles" :key="f.id" class="min-w-0">
                  <a
                    :href="getTaskFilePublicUrl(f.file_path)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex min-w-0 items-center gap-3 rounded-lg border p-2 text-inherit no-underline transition-colors hover:bg-muted/50"
                  >
                    <span class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                      <img v-if="/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.file_name)" class="size-full object-cover" :src="getTaskFilePublicUrl(f.file_path)" :alt="f.file_name" loading="lazy" />
                      <FileTextIcon v-else-if="/\.pdf$/i.test(f.file_name)" class="size-4" />
                      <FileIcon v-else class="size-4" />
                    </span>
                    <span class="grid min-w-0 flex-1">
                      <span class="truncate text-sm font-medium">{{ f.file_name }}</span>
                      <span class="text-xs text-muted-foreground">{{ formatFileSize(f.file_size) }}</span>
                    </span>
                    <UiDeleteButton size="xs" @click.prevent="removeFile(f)" />
                  </a>
                </li>
              </ul>
              <button
                v-else-if="editingTaskId"
                type="button"
                class="flex h-16 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
                :disabled="fileUploading"
                @click="triggerFileInput"
              >
                <Spinner v-if="fileUploading" />
                <PaperclipIcon v-else class="size-4" />
                {{ fileUploading ? 'Загрузка…' : 'Прикрепить файл' }}
              </button>
              <p v-else class="text-sm text-muted-foreground">Файлы можно прикрепить после сохранения события.</p>
            </FormField>
          </FormGrid>
        </fieldset>
      </form>
      <input ref="fileInputRef" type="file" class="hidden" accept="image/*,.pdf,.doc,.docx" @change="onFileSelect" />
      <template #actions>
        <UiButton v-if="editingTaskId && canDeleteCurrentTask" variant="danger-quiet" class="sm:mr-auto" :disabled="taskSaveLoading" @click="openDeleteConfirm">Удалить</UiButton>
        <UiButton :disabled="taskSaveLoading" @click="closeTaskModal">Отмена</UiButton>
        <UiButton variant="primary" type="submit" form="calendar-task-form" :disabled="taskSaveLoading || (!!editingTaskId && !canEditCurrentTask)">
          {{ taskSaveLoading ? 'Сохранение…' : (editingTaskId ? 'Сохранить' : 'Создать событие') }}
        </UiButton>
      </template>
    </UiModal>

    <CalendarDeleteDialog
      v-if="showDeleteConfirm"
      v-model:audience="deleteAudienceScope"
      v-model:scope="deleteScope"
      :busy="deleteInProgress"
      :as-series="canDeleteAsSeries"
      :audience-choice="showDeleteAudienceChoice"
      :can-for-all="canDeleteForAll"
      :can-only-for-me="canDeleteOnlyForMe"
      @cancel="closeDeleteConfirm"
      @confirm="confirmDeleteTask"
    />

    <UiSuccessModal
      :open="successModalOpen"
      :title="successModalTitle"
      :message="successModalMessage"
      @close="successModalOpen = false"
    />
  </section>
</template>
