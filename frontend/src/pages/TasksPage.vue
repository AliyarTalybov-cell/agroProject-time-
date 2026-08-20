<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { useAuth } from '@/stores/auth'
import {
  loadCalendarTasks,
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
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
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

const calendarViewingOtherLabel = computed(() => {
  if (!isManager.value || !auth.user.value?.id) return ''
  const uid = effectiveCalendarUserId.value
  if (!uid || uid === auth.user.value.id) return ''
  const p = profileById(uid)
  return p ? profileLabel(p) : ''
})

const today = new Date()
const currentYear = ref(today.getFullYear())
const currentMonth = ref(today.getMonth())
const selectedDate = ref(formatDateKey(today))
const calendarViewMode = ref<'day' | 'week' | 'month' | 'schedule'>('day')

const tasks = ref<CalendarTask[]>([])
const tasksLoading = ref(false)
const filesLoading = ref(false)
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

const taskTitle = ref('')
const taskDescription = ref('')
const taskStartDate = ref('')
const taskEndDate = ref('')
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
const assigneePickerOpen = ref(false)
const assigneeSearch = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const taskFilesByTaskId = ref<Record<string, CalendarTaskFileRow[]>>({})
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
const assigneesTooltipVisible = ref(false)
const assigneesTooltipText = ref('')
const assigneesTooltipX = ref(0)
const assigneesTooltipY = ref(0)
const assigneesTooltipRef = ref<HTMLElement | null>(null)

function shortTaskId(id: string): string {
  return id.replace(/-/g, '').slice(-8).toUpperCase()
}

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

function weekCardTitle(title: string): string {
  const normalized = (title || '').replace(/\s+/g, ' ').trim()
  const maxChars = 36
  if (!normalized) return 'Без названия'
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

const profilesNotAssigned = computed(() =>
  profiles.value.filter((p) => !taskAssignees.value.includes(p.id)),
)

const assigneeSearchLower = computed(() => assigneeSearch.value.trim().toLowerCase())

const assigneeOptions = computed(() => {
  const q = assigneeSearchLower.value
  const base = profilesNotAssigned.value
  if (!q) return base
  return base.filter((p) => profileLabel(p).toLowerCase().includes(q))
})

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

const weekdaysShort = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']
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

function priorityClass(priority: CalendarTask['priority']): string {
  return `priority-${priority || 'normal'}`
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
  return tasksForSelectedWeek.value
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

function setCalendarView(mode: 'day' | 'week' | 'month' | 'schedule') {
  calendarViewMode.value = mode
  monthExpandedDate.value = null
}

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
    console.error(err)
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
    console.error(err)
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
    console.error(err)
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
  const weekLabelWidth = 66
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
    console.error(err)
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
    console.error(err)
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
      const userTasks = await loadCalendarTasks(uid)
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
  const lines = conflicts.map((c) => `• ${c.label} — занято ${c.date} ${c.start}-${c.end} (${c.title})`)
  successModalTitle.value = 'Конфликт слотов'
  successModalMessage.value =
    'Не удалось сохранить событие: у некоторых участников уже есть пересечение по времени.\n\n' + lines.join('\n')
  successModalOpen.value = true
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
  return tasksForSelectedDate.value
    .filter((task) => !!task.startTime)
    .map((task) => {
      const rawStart = hhmmToMinutes(task.startTime)
      const rawEnd = hhmmToMinutes(task.endTime)
      if (rawStart == null) return null
      const eventStart = Math.max(start, Math.min(end - 15, rawStart))
      const fallbackEnd = eventStart + 60
      const eventEnd = Math.max(eventStart + 30, Math.min(end, rawEnd ?? fallbackEnd))
      const top = dayGridTopPadding + ((eventStart - start) / daySlotMinutes) * daySlotHeight
      const height = Math.max(44, ((eventEnd - eventStart) / daySlotMinutes) * daySlotHeight - 6)
      return { task, top, height, start: eventStart, end: eventEnd }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
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
  if (selectedDate.value !== todayKey) {
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

async function loadFilesForVisibleTasks() {
  const ids = tasksForSelectedDate.value.map((t) => t.id)
  if (ids.length === 0 || !isSupabaseConfigured()) {
    taskFilesByTaskId.value = {}
    return
  }
  filesLoading.value = true
  const next: Record<string, CalendarTaskFileRow[]> = {}
  try {
    await Promise.all(
      ids.map(async (taskId) => {
        try {
          const files = await loadTaskFiles(taskId)
          next[taskId] = files
        } catch (e) {
          // Вложения одной задачи не должны ронять загрузку календаря целиком.
          console.error('Файлы задачи', e)
          next[taskId] = []
        }
      }),
    )
    taskFilesByTaskId.value = next
  } finally {
    filesLoading.value = false
  }
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

function taskAssigneesTitle(taskId: string): string {
  const names = dayEventAssignees(taskId).map((p) => profileLabel(p)).filter(Boolean)
  return names.length ? names.join(', ') : ''
}

function taskAssigneesTooltip(taskId: string): string {
  const names = taskAssigneesTitle(taskId)
  return names ? `Участники: ${names}` : ''
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

function taskParticipationClass(taskId: string): string {
  const status = taskParticipationStatus(taskId)
  return status ? `event-participation--${status}` : ''
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

function moveAssigneesTooltip(e: MouseEvent) {
  const offset = 14
  const pad = 8
  const tipWidth = assigneesTooltipRef.value?.offsetWidth ?? 260
  const tipHeight = assigneesTooltipRef.value?.offsetHeight ?? 86

  let x = e.clientX + offset
  let y = e.clientY + offset

  if (x + tipWidth + pad > window.innerWidth) {
    x = Math.max(pad, e.clientX - tipWidth - offset)
  }
  if (y + tipHeight + pad > window.innerHeight) {
    y = Math.max(pad, e.clientY - tipHeight - offset)
  }

  assigneesTooltipX.value = x
  assigneesTooltipY.value = y
}

function showTaskAssigneesTooltip(taskId: string, e: MouseEvent) {
  const text = taskAssigneesTooltip(taskId)
  if (!text) return
  assigneesTooltipText.value = text
  assigneesTooltipVisible.value = true
  moveAssigneesTooltip(e)
}

function hideTaskAssigneesTooltip() {
  assigneesTooltipVisible.value = false
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
    if (isDayView.value) void loadFilesForVisibleTasks()
    void loadAssigneesForVisibleTasks()
    void nextTick(() => scrollDayViewportToNow(true))
  },
  { immediate: true },
)

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
  taskEndDate.value = selectedDate.value
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
  assigneePickerOpen.value = false
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
    const gutter = 66
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
  taskEndDate.value = task.date
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
  assigneePickerOpen.value = false
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
      console.error('Исполнители и файлы выбранной задачи', e)
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
  assigneePickerOpen.value = false
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
    console.error(err)
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
  try {
    await deleteTaskFile(fileRow.id)
    taskFiles.value = taskFiles.value.filter((f) => f.id !== fileRow.id)
  } catch (err) {
    console.error(err)
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
    console.error(err)
  }
}

function closeTaskModal() {
  isTaskModalOpen.value = false
}

async function onSubmitTask() {
  const title = taskTitle.value.trim()
  if (!title) return

  if (!isSupabaseConfigured()) return

  taskSaveLoading.value = true
  try {
    const id = editingTaskId.value
    const date = taskStartDate.value || selectedDate.value
    const startTime = taskStartTime.value?.trim() || null
    const endTime = taskEndTime.value?.trim() || null
    const participantIds = [...new Set(taskAssignees.value.filter(Boolean))]
    if (id && !canEditCurrentTask.value) {
      successModalTitle.value = 'Недостаточно прав'
      successModalMessage.value = 'Редактировать событие может только его постановщик или руководитель.'
      successModalOpen.value = true
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
      if (repeatRule === 'weekly' && taskRepeatWeekDays.value.length === 0) return
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
    await loadFilesForVisibleTasks()
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
    console.error(e)
  } finally {
    taskSaveLoading.value = false
  }
}

async function deleteTask(id: string) {
  try {
    await deleteCalendarTask(id)
    await loadTasksFromDb()
    if (isScheduleView.value) await loadSchedulePage(false)
  } catch (e) {
    console.error(e)
  }
}

function openDeleteConfirm() {
  if (!canDeleteCurrentTask.value) {
    successModalTitle.value = 'Недостаточно прав'
    successModalMessage.value = 'Удалять событие может руководитель, постановщик или участник события (только у себя).'
    successModalOpen.value = true
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
    successModalTitle.value = 'Недостаточно прав'
    successModalMessage.value = 'Удалять событие может руководитель, постановщик или участник события (только у себя).'
    successModalOpen.value = true
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
      successModalTitle.value = 'Недостаточно прав'
      successModalMessage.value = 'Удалять у всех может только постановщик события или руководитель.'
      successModalOpen.value = true
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
  } catch (e) {
    console.error(e)
  } finally {
    deleteInProgress.value = false
  }
}
</script>

<template>
  <section class="calendar-page">
    <p v-if="loadError" class="page-load-error" role="alert">{{ loadError }}</p>
    <header class="calendar-header page-enter-item">
      <div class="calendar-header-text">
        <div class="type-label">Календарь</div>
        <div class="calendar-title-row">
          <h1 class="page-title">Планирование дня</h1>
          <div class="calendar-help" tabindex="0" aria-label="Подсказка по планированию">
            <span class="calendar-help-icon">?</span>
            <div class="calendar-help-tooltip">
              Планируйте задачи по дням, неделям и месяцам. Создавайте события кликом по слоту или кнопкой «Создать событие».
            </div>
          </div>
        </div>
        <div v-if="isManager" class="calendar-owner-card">
          <div class="calendar-owner-select-shell">
            <span class="calendar-owner-icon calendar-owner-icon--inline" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <select
              id="calendar-owner-select"
              v-model="managerCalendarUserId"
              class="calendar-owner-select"
            >
              <option v-for="opt in managerCalendarOptions" :key="opt.id" :value="opt.id">
                {{ opt.label }}{{ opt.id === auth.user.value?.id ? ' (я)' : '' }}
              </option>
            </select>
          </div>
        </div>
        <p v-if="calendarViewingOtherLabel" class="calendar-view-hint">
          <span class="calendar-view-hint-eyebrow" aria-hidden="true">Режим руководителя</span>
          Просмотр календаря: <strong>{{ calendarViewingOtherLabel }}</strong>
        </p>
      </div>
      <div class="calendar-header-actions">
        <div class="calendar-view-switch" role="tablist" aria-label="Режим календаря">
          <button
            type="button"
            class="calendar-view-switch-btn"
            :class="{ 'is-active': isDayView }"
            :aria-selected="isDayView"
            @click="setCalendarView('day')"
          >
            День
          </button>
          <button
            type="button"
            class="calendar-view-switch-btn"
            :class="{ 'is-active': isWeekView }"
            :aria-selected="isWeekView"
            @click="setCalendarView('week')"
          >
            Неделя
          </button>
          <button
            type="button"
            class="calendar-view-switch-btn"
            :class="{ 'is-active': isMonthView }"
            :aria-selected="isMonthView"
            @click="setCalendarView('month')"
          >
            Месяц
          </button>
          <button
            type="button"
            class="calendar-view-switch-btn"
            :class="{ 'is-active': isScheduleView }"
            :aria-selected="isScheduleView"
            @click="setCalendarView('schedule')"
          >
            Расписание
          </button>
        </div>
        <button type="button" class="calendar-add-btn" @click="openNewTaskModal()">
          <svg
            class="calendar-add-btn-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" x2="12" y1="5" y2="19" />
            <line x1="5" x2="19" y1="12" y2="12" />
          </svg>
          Создать событие
        </button>
      </div>
    </header>

    <div
      class="calendar-layout page-enter-item"
      :class="{ 'calendar-layout--manager': isManager, 'calendar-layout--week': isWeekView || isMonthView || isScheduleView }"
      style="--enter-delay: 60ms"
    >
      <Transition name="mini-calendar-slide">
      <section v-if="isDayView" class="calendar-card calendar-card-left">
        <div class="calendar-month-header">
          <button
            type="button"
            class="month-nav-btn"
            aria-label="Предыдущий месяц"
            @click="prevMonth"
          >
            ‹
          </button>
          <div class="month-label">
            {{ currentMonthLabel }}
          </div>
          <button
            type="button"
            class="month-nav-btn"
            aria-label="Следующий месяц"
            @click="nextMonth"
          >
            ›
          </button>
        </div>

        <div class="calendar-grid">
          <div v-for="day in weekdaysShort" :key="day" class="calendar-weekday">
            {{ day }}
          </div>
          <button
            v-for="day in calendarWeeks.flat()"
            :key="day.key"
            type="button"
            class="calendar-day"
            :class="{
              'calendar-day--muted': !day.inCurrentMonth,
              'calendar-day--today': day.isToday,
              'calendar-day--selected': day.isSelected,
            }"
            @click="selectDay(day.key)"
          >
            <span class="calendar-day-number">{{ day.date }}</span>
            <span v-if="day.hasTasks" class="calendar-day-dot" />
          </button>
        </div>
      </section>
      </Transition>

      <section class="calendar-card calendar-card-right">
        <header class="day-header">
          <div class="day-header-text">
            <div class="type-label">{{ isScheduleView ? 'Расписание событий' : isMonthView ? 'Задачи на месяц' : isWeekView ? 'Задачи на неделю' : 'Задачи на день' }}</div>
            <h2 class="day-title">
              {{
                isMonthView
                  ? `${monthsShort[currentMonth].toLowerCase()} ${currentYear}`
                  : isScheduleView
                  ? 'Ближайшие события'
                  : isWeekView
                  ? `${weekDays[0].weekDay.toLowerCase()}, ${weekDays[0].date} ${monthsShort[parseDateKey(weekDays[0].key).getMonth()].toLowerCase()} — ${weekDays[6].weekDay.toLowerCase()}, ${weekDays[6].date} ${monthsShort[parseDateKey(weekDays[6].key).getMonth()].toLowerCase()}`
                  : new Date(selectedDate + 'T12:00:00').toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                    weekday: 'long',
                  })
              }}
            </h2>
            <p class="day-header-summary">
              Запланировано
              {{ isScheduleView ? scheduleTasks.length : isMonthView ? tasksForCurrentMonth.length : isWeekView ? tasksForSelectedWeek.length : tasksForSelectedDate.length }}
              {{
                (isScheduleView ? scheduleTasks.length : isMonthView ? tasksForCurrentMonth.length : isWeekView ? tasksForSelectedWeek.length : tasksForSelectedDate.length) === 1
                  ? 'событие'
                  : (isScheduleView ? scheduleTasks.length : isMonthView ? tasksForCurrentMonth.length : isWeekView ? tasksForSelectedWeek.length : tasksForSelectedDate.length) < 5
                    ? 'события'
                    : 'событий'
              }}
            </p>
            <div v-if="filesLoading" class="day-header-loading">
              <UiLoadingBar size="md" />
            </div>
          </div>
        </header>

        <div v-if="tasksLoading" class="day-loading">
          <UiLoadingBar />
          <div class="day-loading-skeletons">
            <div class="day-loading-skeleton" />
            <div class="day-loading-skeleton day-loading-skeleton--short" />
            <div class="day-loading-skeleton day-loading-skeleton--medium" />
          </div>
        </div>
        <div v-else-if="isWeekView" class="week-view-wrap">
          <div class="week-view-header">
            <div class="week-view-gmt">GMT+3</div>
            <button
              v-for="day in weekDays"
              :key="day.key"
              type="button"
              class="week-view-day"
              :class="{ 'week-view-day--today': day.isToday, 'week-view-day--selected': day.isSelected, 'week-view-day--weekend': day.isWeekend }"
              @click="selectDay(day.key)"
            >
              <span class="week-view-day-label">{{ day.weekDay.toLowerCase() }}</span>
              <span class="week-view-day-num">{{ day.date }}</span>
            </button>
          </div>
          <div class="day-events-scroll week-view-scroll" :style="{ height: `${dayGridViewportHeight}px` }">
            <div
              class="day-events-grid week-view-grid"
              :style="{ height: `${dayGridHeight}px` }"
              @click="onDayGridClick"
              @dragover="onWeekGridDragOver"
              @drop="onWeekGridDrop"
            >
              <div
                v-for="slot in daySlots.slice(0, -1)"
                :key="`week-${slot.key}`"
                class="day-grid-line week-grid-line"
                :style="{ top: `${dayGridTopPadding + ((slot.minutes - dayStartHour * 60) / daySlotMinutes) * daySlotHeight}px` }"
              >
                <span class="day-grid-time">{{ slot.label }}</span>
              </div>
              <div class="week-view-cols">
                <div v-for="day in weekDays" :key="`col-${day.key}`" class="week-view-col" />
              </div>
              <article
                v-for="event in weekEventsTimed"
                :key="`week-ev-${event.task.id}`"
                class="day-event-card week-event-card"
                :class="[priorityClass(event.task.priority), { 'week-event-card--compact': event.height < 74 }]"
                draggable="true"
                :style="{
                  top: `${event.top}px`,
                  height: `${event.height}px`,
                  left: `calc(66px + ${event.dayIndex} * ((100% - 66px) / 7) + 4px)`,
                  width: 'calc((100% - 66px) / 7 - 8px)',
                }"
                @click="openEditTaskModal(event.task)"
                @dragstart="onWeekEventDragStart(event.task.id, event.start, event.end, event.task.priority, $event)"
                @dragend="onWeekEventDragEnd"
              >
                <div class="day-event-time">{{ minutesToHhmm(event.start) }}<span v-if="event.task.endTime"> – {{ event.task.endTime }}</span></div>
                <div class="day-event-title">{{ weekCardTitle(event.task.title) }}</div>
                <div
                  v-if="dayEventAssignees(event.task.id).length"
                  class="day-event-assignees"
                  @mouseenter.stop="showTaskAssigneesTooltip(event.task.id, $event)"
                  @mousemove.stop="moveAssigneesTooltip($event)"
                  @mouseleave.stop="hideTaskAssigneesTooltip"
                >
                  <UserAvatar
                    v-for="p in dayEventAssignees(event.task.id).slice(0, 3)"
                    :key="`w-${event.task.id}-${p.id}`"
                    class="day-event-assignee-avatar"
                    :style="assigneeAvatarStyle(p)"
                    :url="p.avatar_url"
                    :initials="assigneeInitials(p)"
                  />
                  <span v-if="dayEventAssignees(event.task.id).length > 3" class="day-event-assignee-more">
                    +{{ dayEventAssignees(event.task.id).length - 3 }}
                  </span>
                </div>
              </article>
              <article
                v-if="weekDragPreview"
                class="day-event-card week-event-card week-event-card--drag-preview"
                :class="priorityClass(weekDragPriority)"
                :style="{
                  top: `${weekDragPreview.top}px`,
                  height: `${weekDragPreview.height}px`,
                  left: `calc(66px + ${weekDragPreview.dayIndex} * ((100% - 66px) / 7) + 4px)`,
                  width: 'calc((100% - 66px) / 7 - 8px)',
                }"
              >
                <div class="day-event-time">{{ minutesToHhmm(weekDragPreview.start) }} – {{ minutesToHhmm(weekDragPreview.end) }}</div>
                <div class="day-event-title">Новый временной слот</div>
              </article>
              <div
                v-if="showNowMarker"
                class="day-now-line week-now-line"
                :style="{ top: `${nowMarkerTop}px` }"
              >
                <span class="day-now-label">{{ nowMarkerLabel }}</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="isMonthView" class="month-view-wrap">
          <div class="month-view-header">
            <button type="button" class="month-nav-btn" aria-label="Предыдущий месяц" @click="prevMonth">‹</button>
            <div class="month-label">{{ currentMonthLabel }}</div>
            <button type="button" class="month-nav-btn" aria-label="Следующий месяц" @click="nextMonth">›</button>
          </div>
          <div class="month-view-grid">
            <div v-for="day in weekdaysShort" :key="`m-${day}`" class="month-view-weekday">{{ day }}</div>
            <button
              v-for="cell in monthCells"
              :key="`m-cell-${cell.key}`"
              type="button"
              class="month-view-cell"
              :class="{
                'month-view-cell--muted': !cell.inCurrentMonth,
                'month-view-cell--today': cell.isToday,
                'month-view-cell--selected': cell.isSelected,
                'month-view-cell--weekend': cell.isWeekend,
                'month-view-cell--drop-target': monthDropTargetDate === cell.key,
              }"
              @click="onMonthCellClick(cell.key)"
              @dragover="onMonthCellDragOver(cell.key, $event)"
              @dragleave="onMonthCellDragLeave(cell.key)"
              @drop="onMonthCellDrop(cell.key, $event)"
            >
              <div class="month-view-date">{{ cell.date }}</div>
              <div
                class="month-view-events"
                :class="{ 'month-view-events--expanded': monthExpandedRowIndex !== null && monthExpandedRowIndex === cell.rowIndex }"
              >
                <button
                  v-for="t in ((monthExpandedRowIndex !== null && monthExpandedRowIndex === cell.rowIndex) ? cell.allTasks : cell.tasks)"
                  :key="t.id"
                  type="button"
                  class="month-view-event-pill"
                  :class="[priorityClass(t.priority), { 'month-view-event-pill--drop-target': monthReorderTargetTaskId === t.id }]"
                  draggable="true"
                  @click.stop="openEditTaskModal(t)"
                  @dragstart="onMonthEventDragStart(t.id, $event)"
                  @dragend="onMonthEventDragEnd"
                  @dragover="onMonthEventReorderOver(cell.key, t.id, $event)"
                  @dragleave="onMonthEventReorderLeave(t.id)"
                  @drop="onMonthEventReorderDrop(cell.key, t.id, $event)"
                >
                  <span class="month-view-event-title">{{ t.title }}</span>
                  <span v-if="t.startTime" class="month-view-event-time">{{ t.startTime }}</span>
                </button>
              </div>
              <button
                v-if="cell.more > 0 || monthExpandedDate === cell.key"
                type="button"
                class="month-view-event-more"
                @click.stop="toggleMonthMore(cell.key)"
              >
                {{ monthExpandedDate === cell.key ? 'Скрыть' : `Развернуть (+${cell.more})` }}
              </button>
            </button>
          </div>
        </div>
        <div v-else-if="isScheduleView" ref="scheduleListRef" class="schedule-view-wrap" @scroll.passive="onScheduleScroll">
          <div v-if="scheduleLoading" class="day-loading">
            <UiLoadingBar />
          </div>
          <template v-else>
            <section v-for="group in scheduleGroups" :key="group.date" class="schedule-day-group">
              <div class="schedule-day-head-wrap">
                <div class="schedule-day-head">{{ group.label }}</div>
              </div>
              <button
                v-for="task in group.tasks"
                :key="task.id"
                type="button"
                class="schedule-item"
                :class="priorityClass(task.priority)"
                @click="openEditTaskModal(task)"
              >
                <div class="schedule-item-timebox">
                  <div class="schedule-item-time">{{ task.startTime ? `${task.startTime}${task.endTime ? ` - ${task.endTime}` : ''}` : 'весь день' }}</div>
                  <div v-if="isTaskRecurringInSchedule(task)" class="schedule-item-repeat">Повторяемое событие</div>
                </div>
                <div class="schedule-item-main">
                  <span class="schedule-item-dot" :class="priorityClass(task.priority)" />
                  <span class="schedule-item-title">{{ task.title }}</span>
                </div>
                <div
                  v-if="taskParticipationLabel(task.id) || dayEventAssignees(task.id).length"
                  class="schedule-item-meta"
                >
                  <span
                    v-if="taskParticipationLabel(task.id)"
                    class="event-participation-pill schedule-item-status"
                    :class="taskParticipationClass(task.id)"
                  >
                    {{ taskParticipationLabel(task.id) }}
                  </span>
                  <div
                    v-if="dayEventAssignees(task.id).length"
                    class="schedule-item-assignees"
                    @mouseenter.stop="showTaskAssigneesTooltip(task.id, $event)"
                    @mousemove.stop="moveAssigneesTooltip($event)"
                    @mouseleave.stop="hideTaskAssigneesTooltip"
                  >
                    <UserAvatar
                      v-for="p in dayEventAssignees(task.id).slice(0, 3)"
                      :key="`s-${task.id}-${p.id}`"
                      class="day-event-assignee-avatar"
                      :style="assigneeAvatarStyle(p)"
                      :url="p.avatar_url"
                      :initials="assigneeInitials(p)"
                    />
                    <span v-if="dayEventAssignees(task.id).length > 3" class="day-event-assignee-more">
                      +{{ dayEventAssignees(task.id).length - 3 }}
                    </span>
                  </div>
                </div>
              </button>
            </section>
            <div v-if="scheduleLoadingMore" class="schedule-more-loader">
              <UiLoadingBar size="compact" />
            </div>
            <div v-else-if="!scheduleHasMore && scheduleTasks.length" class="schedule-end">Больше событий нет</div>
            <div v-if="!scheduleTasks.length" class="day-empty">
              <p>Событий в расписании пока нет.</p>
            </div>
          </template>
        </div>
        <div v-else class="day-events-layout" :class="{ 'day-events-layout--with-aside': dayEventsUntimed.length > 0 }">
          <div class="day-events-board">
            <div ref="dayEventsScrollRef" class="day-events-scroll" :style="{ height: `${dayGridViewportHeight}px` }">
              <div
                class="day-events-grid"
                :style="{ height: `${dayGridHeight}px` }"
                @click.self="onDayGridClick"
                @dragover="onDayGridDragOver"
                @drop="onDayGridDrop"
              >
                <div
                  v-for="slot in daySlots.slice(0, -1)"
                  :key="slot.key"
                  class="day-grid-line"
                  :style="{ top: `${dayGridTopPadding + ((slot.minutes - dayStartHour * 60) / daySlotMinutes) * daySlotHeight}px` }"
                >
                  <span class="day-grid-time">{{ slot.label }}</span>
                </div>
                <article
                  v-for="event in dayEventsTimed"
                  :key="event.task.id"
                  class="day-event-card"
                  :class="[
                    priorityClass(event.task.priority),
                    {
                      'day-event-card--completed': event.task.completedAt,
                      'day-event-card--compact': event.height < 64,
                      'day-event-card--dragging': dayDragTaskId === event.task.id,
                    },
                  ]"
                  :style="{ top: `${event.top}px`, height: `${event.height}px` }"
                  role="button"
                  tabindex="0"
                  draggable="true"
                  @click.stop="openEditTaskModal(event.task)"
                  @keydown.enter="openEditTaskModal(event.task)"
                  @dragstart="onDayEventDragStart(event.task.id, event.start, event.end, event.task.priority, $event)"
                  @dragend="onDayEventDragEnd"
                >
                  <div class="day-event-time">{{ minutesToHhmm(event.start) }}<span v-if="event.task.endTime"> – {{ event.task.endTime }}</span></div>
                  <div class="day-event-title">{{ event.task.title }}</div>
                  <div class="day-event-meta-row" :class="{ 'day-event-meta-row--compact': event.height < 64 }">
                    <div
                      v-if="taskParticipationLabel(event.task.id)"
                      class="event-participation-pill"
                      :class="taskParticipationClass(event.task.id)"
                    >
                      {{ taskParticipationLabel(event.task.id) }}
                    </div>
                    <div
                      v-if="dayEventAssignees(event.task.id).length"
                      class="day-event-assignees"
                      @mouseenter.stop="showTaskAssigneesTooltip(event.task.id, $event)"
                      @mousemove.stop="moveAssigneesTooltip($event)"
                      @mouseleave.stop="hideTaskAssigneesTooltip"
                    >
                      <UserAvatar
                        v-for="p in dayEventAssignees(event.task.id).slice(0, 3)"
                        :key="p.id"
                        class="day-event-assignee-avatar"
                        :style="assigneeAvatarStyle(p)"
                        :url="p.avatar_url"
                        :initials="assigneeInitials(p)"
                      />
                      <span v-if="dayEventAssignees(event.task.id).length > 3" class="day-event-assignee-more">
                        +{{ dayEventAssignees(event.task.id).length - 3 }}
                      </span>
                    </div>
                  </div>
                </article>
                <article
                  v-if="dayDragPreview"
                  class="day-event-card day-event-card--drag-preview"
                  :class="priorityClass(dayDragPriority)"
                  :style="{ top: `${dayDragPreview.top}px`, height: `${dayDragPreview.height}px` }"
                >
                  <div class="day-event-time">{{ minutesToHhmm(dayDragPreview.start) }} – {{ minutesToHhmm(dayDragPreview.end) }}</div>
                  <div class="day-event-title">Новый временной слот</div>
                </article>
                <div
                  v-if="showNowMarker"
                  class="day-now-line"
                  :style="{ top: `${nowMarkerTop}px` }"
                  aria-hidden="true"
                >
                  <span class="day-now-label">{{ nowMarkerLabel }}</span>
                </div>
              </div>
            </div>
            <div v-if="!tasksForSelectedDate.length" class="day-empty">
              <p>На этот день событий нет. Кликните на слот сетки или нажмите «Создать событие».</p>
            </div>
          </div>
          <aside v-if="dayEventsUntimed.length" class="day-unscheduled">
            <div class="day-unscheduled-title">Без времени</div>
            <button
              v-for="task in dayEventsUntimed"
              :key="task.id"
              type="button"
              class="day-unscheduled-item"
              @click="openEditTaskModal(task)"
            >
              <span>{{ task.title }}</span>
              <span class="day-unscheduled-item-meta">{{ task.priority === 'high' ? 'Высокий' : task.priority === 'low' ? 'Низкий' : 'Обычный' }}</span>
            </button>
          </aside>
        </div>
      </section>
    </div>

    <div
      v-if="isTaskModalOpen"
      class="modal-backdrop"
      @click="closeTaskModal"
    >
      <div class="modal modal-calendar" @click.stop>
        <!-- Шапка по макету: px-8 py-6, border-b, иконка 40x40 rounded-xl bg-green-50 -->
        <div class="modal-header modal-header--design">
          <div class="modal-header-main">
            <div class="modal-icon modal-icon--design">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </div>
            <div class="modal-header-text">
              <h2 class="modal-title modal-title--design">
                {{ editingTaskId ? 'Редактирование события' : 'Новое событие' }}
              </h2>
              <p v-if="editingTaskId" class="modal-task-id modal-task-id--design">ID: {{ shortTaskId(editingTaskId) }}</p>
              <p class="modal-task-owner modal-task-owner--design">Постановщик: {{ modalTaskOwnerLabel }}</p>
              <p v-if="!editingTaskId" class="modal-subtitle">
                {{ new Date((taskStartDate || selectedDate) + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' }) }}
              </p>
            </div>
          </div>
          <ModalCloseButton @click="closeTaskModal" />
        </div>

        <form class="modal-form modal-form--design" @submit.prevent="onSubmitTask" :aria-busy="taskSaveLoading">
          <fieldset class="modal-form-fieldset" :disabled="taskSaveLoading">
          <div class="modal-body">
            <label class="modal-field modal-field--design">
              <span class="modal-label modal-label--design">Название события</span>
              <input
                v-model="taskTitle"
                type="text"
                class="modal-input modal-input--design modal-input--title"
                placeholder="Введите название..."
                required
              />
            </label>

            <label class="modal-field modal-field--design">
              <span class="modal-label modal-label--design">Описание</span>
              <textarea
                v-model="taskDescription"
                class="modal-textarea modal-textarea--design"
                rows="4"
                placeholder="Добавьте детали события..."
              />
            </label>

            <!-- Сетка как в макете: Дата/время начала | Дата/время завершения -->
            <div class="modal-grid-2">
              <label class="modal-field modal-field--design">
                <span class="modal-label modal-label--design">Дата и время начала</span>
                <div class="modal-deadline-row modal-deadline-row--design">
                  <div class="modal-deadline-date">
                    <svg class="modal-input-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect width="18" height="18" x="3" y="4" rx="2" />
                      <line x1="16" x2="16" y1="2" y2="6" />
                      <line x1="8" x2="8" y1="2" y2="6" />
                      <line x1="3" x2="21" y1="10" y2="10" />
                    </svg>
                    <input v-model="taskStartDate" type="date" class="modal-input modal-input--design modal-input--with-icon" />
                  </div>
                  <div class="modal-deadline-time-range modal-deadline-time-range--single">
                    <div class="modal-deadline-time-start">
                      <svg class="modal-input-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l3 3" />
                      </svg>
                      <input v-model="taskStartTime" type="time" class="modal-input modal-input--design modal-input--with-icon" />
                    </div>
                  </div>
                </div>
              </label>
              <label class="modal-field modal-field--design">
                <span class="modal-label modal-label--design">Дата и время завершения</span>
                <div class="modal-deadline-row modal-deadline-row--design">
                  <div class="modal-deadline-date">
                    <svg class="modal-input-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect width="18" height="18" x="3" y="4" rx="2" />
                      <line x1="16" x2="16" y1="2" y2="6" />
                      <line x1="8" x2="8" y1="2" y2="6" />
                      <line x1="3" x2="21" y1="10" y2="10" />
                    </svg>
                    <input v-model="taskEndDate" type="date" class="modal-input modal-input--design modal-input--with-icon" />
                  </div>
                  <div class="modal-deadline-time-range modal-deadline-time-range--single">
                    <div class="modal-deadline-time-start">
                      <svg class="modal-input-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l3 3" />
                      </svg>
                      <input v-model="taskEndTime" type="time" class="modal-input modal-input--design modal-input--with-icon" />
                    </div>
                  </div>
                </div>
              </label>
            </div>

            <label class="modal-field modal-field--design">
              <span class="modal-label modal-label--design">Приоритет</span>
              <select v-model="taskPriority" class="modal-input modal-input--design modal-select modal-select--design">
                <option value="normal">Обычный</option>
                <option value="high">Высокий</option>
                <option value="low">Низкий</option>
              </select>
            </label>

            <div class="modal-grid-2">
              <label class="modal-field modal-field--design">
                <span class="modal-label modal-label--design">Повторяемость</span>
                <div class="repeat-row">
                <select v-model="taskRepeatRule" class="modal-input modal-input--design modal-select modal-select--design">
                  <option value="none">Не повторяется</option>
                  <option value="daily">Каждый день</option>
                  <option value="weekly">Каждую неделю</option>
                  <option value="monthly">Каждый месяц</option>
                  <option value="yearly">Каждый год</option>
                </select>
                <template v-if="taskRepeatRule !== 'none'">
                  <span class="repeat-inline-label">каждые</span>
                  <input
                    v-model.number="taskRepeatEvery"
                    type="number"
                    min="1"
                    max="365"
                    class="modal-input modal-input--design repeat-every-input"
                    :disabled="false"
                  />
                </template>
                </div>
                <Transition name="repeat-reveal">
                <div v-if="taskRepeatRule === 'weekly'" class="repeat-weekdays">
                  <label v-for="(d, idx) in weekdaysShort" :key="d" class="repeat-weekday-item">
                    <input
                      :checked="taskRepeatWeekDays.includes(idx + 1)"
                      type="checkbox"
                      :disabled="false"
                      @change="
                        taskRepeatWeekDays = taskRepeatWeekDays.includes(idx + 1)
                          ? taskRepeatWeekDays.filter((x) => x !== idx + 1)
                          : [...taskRepeatWeekDays, idx + 1]
                      "
                    />
                    <span>{{ d }}</span>
                  </label>
                </div>
                </Transition>
              </label>
              <Transition name="repeat-reveal">
              <label v-if="taskRepeatRule !== 'none'" class="modal-field modal-field--design">
                <span class="modal-label modal-label--design">Окончание</span>
                <div class="repeat-end">
                  <label class="repeat-end-item">
                    <input v-model="taskRepeatEndMode" type="radio" value="never" />
                    <span>Никогда</span>
                    <span class="repeat-end-spacer" aria-hidden="true"></span>
                  </label>
                  <label class="repeat-end-item repeat-end-item--after">
                    <input v-model="taskRepeatEndMode" type="radio" value="after" />
                    <span>После</span>
                    <span class="repeat-end-inline">
                      <input
                        v-model.number="taskRepeatCount"
                        type="number"
                        min="1"
                        max="500"
                        class="modal-input modal-input--design repeat-count-input"
                        :disabled="taskRepeatEndMode !== 'after'"
                      />
                      <span>повторений</span>
                    </span>
                  </label>
                  <label class="repeat-end-item repeat-end-item--date">
                    <input v-model="taskRepeatEndMode" type="radio" value="on_date" />
                    <span>Дата</span>
                    <input
                      v-model="taskRepeatUntil"
                      type="date"
                      class="modal-input modal-input--design repeat-date-input"
                      :min="taskStartDate || selectedDate"
                      :disabled="taskRepeatEndMode !== 'on_date'"
                    />
                  </label>
                </div>
              </label>
              </Transition>
            </div>

            <div v-if="editingTaskId && taskRepeatRule !== 'none'" class="repeat-apply-box">
              <div class="repeat-apply-title">Как применить изменения повторяемости</div>
              <label class="repeat-apply-option">
                <input v-model="taskRepeatApplyMode" type="radio" value="only_this" />
                <span>Только это событие</span>
              </label>
              <label class="repeat-apply-option">
                <input v-model="taskRepeatApplyMode" type="radio" value="this_and_following" />
                <span>Это событие и следующие</span>
              </label>
              <p class="repeat-apply-hint">
                При выборе «это и следующие» будут созданы новые встречи по выбранному правилу начиная с текущей даты.
              </p>
            </div>

            <!-- Ответственные: label + кнопка «Добавить» в одну строку, чипы как в макете -->
            <div class="modal-field modal-field--design">
              <div class="modal-label-row modal-label-row--design">
                <span class="modal-label modal-label--design">Ответственные специалисты</span>
                <div class="modal-assignee-picker">
                  <button
                    type="button"
                    class="modal-add-assignee-btn modal-add-assignee-btn--design"
                    @click="assigneePickerOpen = !assigneePickerOpen"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" x2="12" y1="8" y2="16" />
                      <line x1="8" x2="16" y1="12" y2="12" />
                    </svg>
                    Добавить
                  </button>
                  <div v-if="assigneePickerOpen" class="modal-assignee-dropdown">
                    <div class="modal-assignee-search">
                      <svg
                        class="modal-assignee-search-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <line x1="16.65" y1="16.65" x2="21" y2="21" />
                      </svg>
                      <input
                        v-model="assigneeSearch"
                        type="text"
                        class="modal-assignee-search-input"
                        placeholder="Поиск по имени или email"
                      />
                    </div>
                    <button
                      v-for="p in assigneeOptions"
                      :key="p.id"
                      type="button"
                      class="modal-assignee-option"
                      @click="addAssignee(p.id)"
                    >
                      <UserAvatar class="modal-assignee-option-avatar" :style="assigneeAvatarStyle(p)" :url="p.avatar_url" :initials="assigneeInitials(p)" />
                      <span class="modal-assignee-option-label">{{ profileLabel(p) }}{{ p.id === auth.user.value?.id ? ' (Вы)' : '' }}</span>
                    </button>
                    <p
                      v-if="assigneeOptions.length === 0"
                      class="modal-assignee-empty"
                    >
                      {{ profilesNotAssigned.length === 0 ? 'Все добавлены' : 'Ничего не найдено' }}
                    </p>
                  </div>
                </div>
              </div>
              <div class="modal-chips modal-chips--design">
                <div
                  v-for="uid in taskAssignees"
                  :key="uid"
                  class="modal-chip modal-chip--design"
                >
                  <UserAvatar
                    class="modal-chip-avatar modal-chip-avatar--design"
                    :style="profileById(uid) ? assigneeAvatarStyle(profileById(uid)!) : undefined"
                    :url="profileById(uid)?.avatar_url ?? null"
                    :initials="profileById(uid) ? assigneeInitials(profileById(uid)!) : '?'"
                  />
                  <span class="modal-chip-label">{{ profileById(uid) ? profileLabel(profileById(uid)!) : uid }}</span>
                  <span
                    class="modal-chip-status"
                    :class="`modal-chip-status--${assigneeStatusForModal(uid)}`"
                  >{{ assigneeStatusLabel(assigneeStatusForModal(uid)) }}</span>
                  <button type="button" class="modal-chip-remove" aria-label="Убрать" @click="removeAssignee(uid)">×</button>
                </div>
              </div>
            </div>

            <div v-if="editingTaskId && currentTaskParticipationStatus" class="modal-field modal-field--design">
              <span class="modal-label modal-label--design">Мое участие</span>
              <div class="participation-box">
                <span class="event-participation-pill" :class="taskParticipationClass(editingTaskId)">
                  {{ taskParticipationLabel(editingTaskId) }}
                </span>
                <div v-if="currentTaskParticipationStatus === 'pending'" class="participation-actions">
                  <button type="button" class="modal-btn-ghost modal-btn-ghost--design" @click="setMyParticipationStatus('declined')">
                    Отклонить
                  </button>
                  <button type="button" class="modal-btn modal-btn--design" @click="setMyParticipationStatus('accepted')">
                    Принять
                  </button>
                </div>
                <div v-else-if="currentTaskParticipationStatus === 'accepted'" class="participation-actions">
                  <button type="button" class="modal-btn-ghost modal-btn-ghost--design" @click="setMyParticipationStatus('declined')">
                    Отказаться
                  </button>
                </div>
                <div v-else-if="currentTaskParticipationStatus === 'declined'" class="participation-actions">
                  <button type="button" class="modal-btn modal-btn--design" @click="setMyParticipationStatus('accepted')">
                    Принять снова
                  </button>
                </div>
              </div>
            </div>

            <!-- Прикреплённые файлы: карточки как в макете (иконка в квадрате, имя, размер, корзина) -->
            <div class="modal-field modal-field--design">
              <span class="modal-label modal-label--design">Прикреплённые файлы</span>
              <div class="modal-files-grid modal-files-grid--design">
                <a
                  v-for="f in taskFiles"
                  :key="f.id"
                  :href="getTaskFilePublicUrl(f.file_path)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="modal-file-card modal-file-card--design"
                >
                  <div class="modal-file-icon-box">
                    <img
                      v-if="/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.file_name)"
                      class="modal-file-thumb"
                      :src="getTaskFilePublicUrl(f.file_path)"
                      :alt="f.file_name"
                      loading="lazy"
                    />
                    <svg v-else-if="/\.pdf$/i.test(f.file_name)" class="modal-file-icon-pdf" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                      <path d="M9 13h6" />
                      <path d="M9 17h6" />
                    </svg>
                    <svg v-else class="modal-file-icon-doc" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                  </div>
                  <div class="modal-file-info">
                    <span class="modal-file-name">{{ f.file_name }}</span>
                    <span class="modal-file-size">{{ formatFileSize(f.file_size) }}</span>
                  </div>
                  <UiDeleteButton size="xs" @click.prevent="removeFile(f)" />
                </a>
                <button
                  v-if="editingTaskId"
                  type="button"
                  class="modal-attach-placeholder modal-attach-placeholder--design"
                  :disabled="fileUploading"
                  @click="triggerFileInput"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span>{{ fileUploading ? 'Загрузка...' : 'Прикрепить файл' }}</span>
                </button>
                <div v-else class="modal-attach-placeholder modal-attach-placeholder--design modal-attach-placeholder--muted">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span>Сохраните задачу, чтобы прикрепить файлы</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Подвал по макету: bg-gray-50, border-t, Удалить слева, Отмена + Сохранить справа -->
          <div class="modal-actions modal-actions--design">
            <UiDeleteButton
              v-if="editingTaskId && canDeleteCurrentTask"
              size="md"
              wide
              :disabled="taskSaveLoading"
              @click="openDeleteConfirm"
            />
            <div class="modal-actions-right">
              <button type="button" class="modal-btn-ghost modal-btn-ghost--design" :disabled="taskSaveLoading" @click="closeTaskModal">Отмена</button>
              <button
                type="submit"
                class="modal-btn modal-btn--design"
                :disabled="taskSaveLoading || (!!editingTaskId && !canEditCurrentTask)"
              >
                <span v-if="taskSaveLoading" class="modal-btn-loading">
                  <span class="modal-btn-loading-scale">
                    <UiLoadingBar size="compact" />
                  </span>
                </span>
                <span v-else>{{ editingTaskId ? 'Сохранить изменения' : 'Создать событие' }}</span>
              </button>
            </div>
          </div>
          </fieldset>
        </form>
        <input ref="fileInputRef" type="file" class="modal-file-input-hidden" accept="image/*,.pdf,.doc,.docx" @change="onFileSelect" />
      </div>
    </div>

    <!-- Подтверждение удаления задачи -->
    <div
      v-if="showDeleteConfirm"
      class="modal-backdrop modal-backdrop--confirm"
      @click="closeDeleteConfirm"
    >
      <div class="modal modal-confirm" @click.stop>
        <h3 class="modal-confirm-title">Удалить событие?</h3>
        <p class="modal-confirm-text">
          {{ canDeleteAsSeries ? 'Выберите вариант удаления для повторяющихся событий.' : 'Событие будет удалено без возможности восстановления.' }}
        </p>
        <div v-if="showDeleteAudienceChoice" class="delete-scope-box">
          <div class="delete-scope-caption">Область удаления</div>
          <label class="delete-scope-option" :class="{ 'is-disabled': !canDeleteForAll }">
            <input v-model="deleteAudienceScope" type="radio" value="all" :disabled="!canDeleteForAll" />
            <span>Удалить у всех участников</span>
          </label>
          <label class="delete-scope-option" :class="{ 'is-disabled': !canDeleteOnlyForMe }">
            <input v-model="deleteAudienceScope" type="radio" value="only_me" :disabled="!canDeleteOnlyForMe" />
            <span>Удалить только у меня</span>
          </label>
          <p v-if="!canDeleteForAll || !canDeleteOnlyForMe" class="delete-scope-note">
            Удалить у всех может только постановщик или руководитель. Удалить у себя можно только после отказа от участия.
          </p>
        </div>
        <div v-if="canDeleteAsSeries" class="delete-scope-box">
          <label class="delete-scope-option">
            <input v-model="deleteScope" type="radio" value="only_this" />
            <span>Удалить только этот слот</span>
          </label>
          <label class="delete-scope-option">
            <input v-model="deleteScope" type="radio" value="this_and_following" />
            <span>Удалить этот и все последующие слоты</span>
          </label>
        </div>
        <div class="modal-confirm-actions">
          <button type="button" class="modal-btn-ghost modal-btn-ghost--design" :disabled="deleteInProgress" @click="closeDeleteConfirm">
            Отмена
          </button>
          <UiDeleteButton size="md" :loading="deleteInProgress" :disabled="deleteInProgress" @click="confirmDeleteTask" />
        </div>
      </div>
    </div>

    <UiSuccessModal
      :open="successModalOpen"
      :title="successModalTitle"
      :message="successModalMessage"
      button-text="Отлично"
      @close="successModalOpen = false"
    />
    <div
      v-if="assigneesTooltipVisible"
      ref="assigneesTooltipRef"
      class="assignees-tooltip-float"
      :style="{ left: `${assigneesTooltipX}px`, top: `${assigneesTooltipY}px` }"
    >
      {{ assigneesTooltipText }}
    </div>
  </section>
</template>

<style scoped src="./TasksPage.css"></style>

<style>
html[data-theme='dark'] .calendar-page .calendar-owner-card {
  background: linear-gradient(
    152deg,
    rgba(61, 92, 64, 0.22) 0%,
    rgba(28, 32, 30, 0.96) 55%,
    var(--bg-panel, #1c201e) 100%
  );
  border-color: rgba(255, 255, 255, 0.08);
}

html[data-theme='dark'] .calendar-page .calendar-owner-label {
  color: color-mix(in srgb, #fff 88%, var(--agro));
}

html[data-theme='dark'] .calendar-page .calendar-owner-select {
  background: rgba(0, 0, 0, 0.28);
  border-color: rgba(255, 255, 255, 0.1);
  color: var(--text-primary, #f3f4f3);
}

html[data-theme='dark'] .calendar-page .calendar-owner-select:hover {
  border-color: rgba(61, 92, 64, 0.45);
}

html[data-theme='dark'] .calendar-page .calendar-owner-select:focus {
  border-color: var(--agro);
  outline-color: var(--agro);
}

html[data-theme='dark'] .calendar-page .calendar-owner-select-shell::after {
  border-right-color: var(--agro-light, #4d7350);
  border-bottom-color: var(--agro-light, #4d7350);
}

html[data-theme='dark'] .calendar-page .calendar-view-hint {
  background: rgba(61, 92, 64, 0.15);
  border-color: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
}

html[data-theme='dark'] .calendar-page .calendar-view-hint strong {
  color: color-mix(in srgb, #fff 90%, var(--agro-light));
}

html[data-theme='dark'] .calendar-page .calendar-help {
  background: color-mix(in srgb, var(--bg-panel) 84%, #102119);
  border-color: color-mix(in srgb, var(--text-primary) 16%, transparent);
  color: color-mix(in srgb, #fff 78%, var(--agro-light));
}

html[data-theme='dark'] .calendar-page .calendar-help-tooltip {
  background: color-mix(in srgb, var(--bg-panel) 90%, #0d1b15);
  border-color: color-mix(in srgb, var(--text-primary) 14%, transparent);
  color: #eaf2ee;
}

html[data-theme='dark'] .calendar-page .schedule-day-head-wrap::before {
  background: color-mix(in srgb, var(--text-primary) 16%, transparent);
}

html[data-theme='dark'] .calendar-page .schedule-day-head {
  background: color-mix(in srgb, var(--bg-base) 86%, #132119);
  border-color: color-mix(in srgb, var(--text-primary) 14%, transparent);
  color: color-mix(in srgb, #fff 82%, var(--agro-light));
}

/* Усиливаем читаемость рабочих зон календаря в dark без смены общей палитры */
html[data-theme='dark'] .calendar-page .calendar-card-right {
  background: color-mix(in srgb, var(--bg-panel) 92%, #0f1714);
  border-color: color-mix(in srgb, var(--text-primary) 14%, transparent);
}

html[data-theme='dark'] .calendar-page .day-events-scroll,
html[data-theme='dark'] .calendar-page .week-view-wrap,
html[data-theme='dark'] .calendar-page .month-view-wrap,
html[data-theme='dark'] .calendar-page .schedule-view-wrap {
  background: color-mix(in srgb, var(--bg-base) 88%, #0d1512);
  border: 1px solid color-mix(in srgb, var(--text-primary) 14%, transparent);
  border-radius: 12px;
}

html[data-theme='dark'] .calendar-page .day-events-grid,
html[data-theme='dark'] .calendar-page .week-view-grid {
  background: color-mix(in srgb, var(--bg-panel) 90%, #101917);
}

html[data-theme='dark'] .calendar-page .day-grid-line,
html[data-theme='dark'] .calendar-page .week-grid-line {
  border-top-color: rgba(148, 163, 184, 0.26);
}

html[data-theme='dark'] .calendar-page .day-grid-time {
  color: color-mix(in srgb, #fff 70%, #9fb7cc);
}

html[data-theme='dark'] .calendar-page .week-view-header {
  background: color-mix(in srgb, var(--bg-panel) 90%, #121d19);
  border-color: color-mix(in srgb, var(--text-primary) 16%, transparent);
}

html[data-theme='dark'] .calendar-page .week-view-day {
  border-right-color: color-mix(in srgb, var(--text-primary) 14%, transparent);
}

html[data-theme='dark'] .calendar-page .week-view-col {
  border-right-color: color-mix(in srgb, var(--text-primary) 12%, transparent);
}

html[data-theme='dark'] .calendar-page .month-view-grid {
  background: color-mix(in srgb, var(--bg-panel) 90%, #0f1815);
  border-color: color-mix(in srgb, var(--text-primary) 14%, transparent);
}

html[data-theme='dark'] .calendar-page .month-view-weekday,
html[data-theme='dark'] .calendar-page .month-view-cell {
  border-color: color-mix(in srgb, var(--text-primary) 13%, transparent);
}

html[data-theme='dark'] .calendar-page .month-view-cell {
  background: color-mix(in srgb, var(--bg-panel) 86%, #121c18);
}

html[data-theme='dark'] .calendar-page .month-view-cell--muted {
  background: color-mix(in srgb, var(--bg-base) 82%, #0c1311);
}

html[data-theme='dark'] .calendar-page .month-view-cell--weekend {
  background: color-mix(in srgb, var(--bg-panel) 78%, #17231e);
}

html[data-theme='dark'] .calendar-page .month-view-cell--selected,
html[data-theme='dark'] .calendar-page .week-view-day--selected {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--agro-light) 46%, transparent);
}

html[data-theme='dark'] .calendar-page .priority-normal.day-event-card,
html[data-theme='dark'] .calendar-page .priority-normal.month-view-event-pill,
html[data-theme='dark'] .calendar-page .priority-normal.month-view-more-item,
html[data-theme='dark'] .calendar-page .priority-normal.schedule-item {
  background: #21455b;
  border-color: #356683;
}

html[data-theme='dark'] .calendar-page .priority-high.day-event-card,
html[data-theme='dark'] .calendar-page .priority-high.month-view-event-pill,
html[data-theme='dark'] .calendar-page .priority-high.month-view-more-item,
html[data-theme='dark'] .calendar-page .priority-high.schedule-item {
  background: #5b2e36;
  border-color: #8a4a56;
}

html[data-theme='dark'] .calendar-page .priority-low.day-event-card,
html[data-theme='dark'] .calendar-page .priority-low.month-view-event-pill,
html[data-theme='dark'] .calendar-page .priority-low.month-view-more-item,
html[data-theme='dark'] .calendar-page .priority-low.schedule-item {
  background: #2f3741;
  border-color: #4d5865;
}

/* В дневном фильтре делаем карточки темнее, чтобы не выбивались из фона */
html[data-theme='dark'] .calendar-page .day-events-grid:not(.week-view-grid) .priority-normal.day-event-card {
  background: #193746;
  border-color: #2a556c;
}

html[data-theme='dark'] .calendar-page .day-events-grid:not(.week-view-grid) .priority-high.day-event-card {
  background: #4a2730;
  border-color: #71404c;
}

html[data-theme='dark'] .calendar-page .day-events-grid:not(.week-view-grid) .priority-low.day-event-card {
  background: #252d37;
  border-color: #3d4a58;
}

html[data-theme='dark'] .calendar-page .day-event-time,
html[data-theme='dark'] .calendar-page .day-event-title,
html[data-theme='dark'] .calendar-page .month-view-event-title,
html[data-theme='dark'] .calendar-page .schedule-item-time,
html[data-theme='dark'] .calendar-page .schedule-item-title {
  color: #eef6ff;
}

html[data-theme='dark'] .calendar-page .day-events-grid:not(.week-view-grid) .day-event-time,
html[data-theme='dark'] .calendar-page .day-events-grid:not(.week-view-grid) .day-event-title {
  color: #deebf7;
}

html[data-theme='dark'] .calendar-page .month-view-event-time,
html[data-theme='dark'] .calendar-page .schedule-item-repeat {
  color: color-mix(in srgb, #fff 72%, #9fb7cc);
}

html[data-theme='dark'] .calendar-page .schedule-item-dot.priority-normal {
  background: #79bfeb;
}

html[data-theme='dark'] .calendar-page .schedule-item-dot.priority-high {
  background: #f1a2ad;
}

html[data-theme='dark'] .calendar-page .schedule-item-dot.priority-low {
  background: #b8c1cb;
}

html[data-theme='dark'] .calendar-page .day-event-assignee-more {
  background: rgba(8, 18, 28, 0.85);
  color: #d8e6f5;
}

html[data-theme='dark'] .calendar-page .event-participation--accepted {
  background: rgba(34, 197, 94, 0.24);
  color: #bbf7d0;
}

html[data-theme='dark'] .calendar-page .event-participation--pending {
  background: rgba(245, 158, 11, 0.26);
  color: #fde68a;
}

html[data-theme='dark'] .calendar-page .event-participation--declined {
  background: rgba(239, 68, 68, 0.24);
  color: #fecaca;
}

/* Модалка события в dark: повышаем читаемость без смены общей палитры */
html[data-theme='dark'] .calendar-page .modal-calendar {
  background: var(--bg-elevated);
  border-color: var(--border-color);
}

html[data-theme='dark'] .calendar-page .modal-calendar .modal-header--design {
  background: var(--bg-overlay);
  border-bottom-color: var(--border-color);
}

html[data-theme='dark'] .calendar-page .modal-calendar .modal-body {
  background: var(--bg-elevated);
}

html[data-theme='dark'] .calendar-page .modal-calendar .modal-label--design,
html[data-theme='dark'] .calendar-page .modal-calendar .modal-task-id--design,
html[data-theme='dark'] .calendar-page .modal-calendar .modal-task-owner--design,
html[data-theme='dark'] .calendar-page .modal-calendar .modal-subtitle {
  color: var(--text-secondary);
}

html[data-theme='dark'] .calendar-page .modal-calendar .modal-title--design {
  color: var(--text-primary);
}

html[data-theme='dark'] .calendar-page .modal-calendar .modal-input.modal-input--design,
html[data-theme='dark'] .calendar-page .modal-calendar .modal-select.modal-select--design,
html[data-theme='dark'] .calendar-page .modal-calendar .modal-textarea.modal-textarea--design {
  background: color-mix(in srgb, var(--bg-elevated) 84%, black);
  border-color: var(--border-color);
  color: var(--text-primary);
}

html[data-theme='dark'] .calendar-page .modal-calendar .modal-input.modal-input--design::placeholder,
html[data-theme='dark'] .calendar-page .modal-calendar .modal-textarea.modal-textarea--design::placeholder {
  color: var(--text-muted);
}

html[data-theme='dark'] .calendar-page .modal-calendar .repeat-apply-box,
html[data-theme='dark'] .calendar-page .modal-calendar .participation-box,
html[data-theme='dark'] .calendar-page .modal-calendar .assignee-status-column {
  background: color-mix(in srgb, var(--bg-elevated) 86%, black);
  border-color: var(--border-color);
}

html[data-theme='dark'] .calendar-page .modal-calendar .modal-attach-placeholder--design {
  background: color-mix(in srgb, var(--bg-elevated) 86%, black);
  border-color: var(--border-color);
}

html[data-theme='dark'] .calendar-page .modal-calendar .modal-actions.modal-actions--design {
  background: var(--bg-overlay);
  border-top-color: var(--border-color);
}

html[data-theme='dark'] .calendar-page .modal-calendar .modal-btn-ghost.modal-btn-ghost--design {
  background: color-mix(in srgb, var(--bg-elevated) 88%, black);
  border-color: var(--border-color);
  color: var(--text-primary);
}

html[data-theme='dark'] .calendar-page .modal-chip-status--accepted {
  background: color-mix(in srgb, var(--accent-green) 24%, transparent);
  color: color-mix(in srgb, white 84%, var(--accent-green));
}

html[data-theme='dark'] .calendar-page .modal-chip-status--pending {
  background: color-mix(in srgb, var(--warning-orange) 26%, transparent);
  color: color-mix(in srgb, white 84%, var(--warning-orange));
}

html[data-theme='dark'] .calendar-page .modal-chip-status--declined {
  background: color-mix(in srgb, var(--danger-red) 24%, transparent);
  color: color-mix(in srgb, white 84%, var(--danger-red));
}

html[data-theme='dark'] .calendar-page .assignees-tooltip-float {
  background: color-mix(in srgb, var(--bg-elevated) 88%, black);
  border-color: var(--border-color);
  color: var(--text-primary);
}

html[data-theme='dark'] .calendar-page .assignee-status-column {
  background: color-mix(in srgb, var(--bg-elevated) 82%, black);
  border-color: var(--border-color);
}

html[data-theme='dark'] .calendar-page .assignee-status-title {
  color: var(--text-secondary);
}

html[data-theme='dark'] .calendar-page .assignee-status-chip {
  background: color-mix(in srgb, var(--bg-elevated) 88%, black);
  border-color: var(--border-color);
  color: var(--text-primary);
}

html[data-theme='dark'] .calendar-page .assignee-status-chip--declined {
  background: color-mix(in srgb, var(--danger-red) 24%, transparent);
  border-color: color-mix(in srgb, var(--danger-red) 42%, var(--border-color));
  color: color-mix(in srgb, white 84%, var(--danger-red));
}

@media (max-width: 820px) {
  .assignee-status-board {
    grid-template-columns: 1fr;
  }
}
</style>
