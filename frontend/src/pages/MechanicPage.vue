<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, onActivated, watch } from 'vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { useRouter } from 'vue-router'
import type { ActiveDowntime, DowntimeCategory } from '@/lib/downtimeStorage'
import { appendEvent, loadActive, saveActive, loadEvents as loadDowntimeEvents } from '@/lib/downtimeStorage'
import {
  appendOperation,
  loadOperations,
  loadActiveOperation,
  saveActiveOperation,
} from '@/lib/operationStorage'
import { loadDowntimeReasons, loadWorkOperations, isSupabaseConfigured } from '@/lib/reasonsAndOperations'
import type { DowntimeReasonRow, WorkOperationRow } from '@/lib/reasonsAndOperations'
import { loadFields, type FieldRow } from '@/lib/fieldsSupabase'
import { insertDowntime, insertOperation } from '@/lib/analyticsSupabase'
import { upsertOperatorStatus, deleteOperatorStatus, loadOperatorStatusesFromSupabase } from '@/lib/operatorStatusSupabase'
import { loadCalendarTasks, updateCalendarTask } from '@/lib/calendarTasksSupabase'
import { useAuth } from '@/stores/auth'
import {
  addTaskComment,
  addTaskEvent,
  loadTasksFiltered,
  updateTask,
  type TaskRow,
} from '@/lib/tasksSupabase'
import { loadEquipment, type EquipmentRow } from '@/lib/equipmentSupabase'
import { loadEmployees, loadPositions, searchEmployees, type EmployeeRow, type PositionRow } from '@/lib/employeesSupabase'
import { getOrCreateDmThread, sendChatMessage, sendChatMessageWithFile } from '@/lib/chatSupabase'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import UiSuccessModal from '@/components/UiSuccessModal.vue'

const DEFAULT_REASONS: Array<{ label: string; description: string; category: DowntimeCategory }> = [
  { label: 'Поломка техники', description: 'Неисправность, требующая остановки работы', category: 'breakdown' },
  { label: 'Дождь / погода', description: 'Осадки или условия, не позволяющие работать', category: 'rain' },
  { label: 'Нет топлива', description: 'Ожидание заправки или подвоза ГСМ', category: 'fuel' },
  { label: 'Ожидание задания', description: 'Нет подтверждённого задания от агронома', category: 'waiting' },
]

const router = useRouter()
const auth = useAuth()
const employeeDisplayName = computed(() => {
  const u = auth.user.value
  if (!u) return 'Гость'
  return (u.email ?? (u.user_metadata?.full_name as string) ?? 'Пользователь').trim() || 'Пользователь'
})

/** Сообщение о неудавшейся загрузке. Пустая строка — сообщения нет. */
const loadError = ref('')
const timerTick = ref(0)
let timerInterval: ReturnType<typeof setInterval> | null = null

/** Время начала работы (операции). Когда задано — крутится счётчик. Сбрасывается при начале простоя. */
const workStartedAt = ref<string | null>(null)


const timerStartISO = computed(() => {
  if (active.value?.startISO) return active.value.startISO
  if (activeOperation.value?.startISO) return activeOperation.value.startISO
  return null
})

function operationElapsedSeconds(now = Date.now()): number {
  const op = activeOperation.value
  if (!op?.startISO) return 0
  const startMs = new Date(op.startISO).getTime()
  if (Number.isNaN(startMs)) return 0
  let pauseSeconds = Math.max(0, Math.floor(op.accumulatedPauseSeconds ?? 0))
  if (op.pausedAt) {
    const pausedAtMs = new Date(op.pausedAt).getTime()
    if (!Number.isNaN(pausedAtMs) && now > pausedAtMs) {
      pauseSeconds += Math.floor((now - pausedAtMs) / 1000)
    }
  }
  return Math.max(0, Math.floor((now - startMs) / 1000) - pauseSeconds)
}

const elapsedSeconds = computed(() => {
  void timerTick.value
  if (active.value?.startISO) {
    const start = new Date(active.value.startISO).getTime()
    if (Number.isNaN(start)) return 0
    return Math.max(0, Math.floor((Date.now() - start) / 1000))
  }
  if (activeOperation.value?.startISO) return operationElapsedSeconds(Date.now())
  return 0
})

const timerLabel = computed(() => {
  const s = elapsedSeconds.value
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
})

type MechanicField = {
  id: string
  name: string
  operation: string
  area: number | null
}

const active = ref<ActiveDowntime | null>(loadActive())
const activeOperation = ref(loadActiveOperation())
const isReasonsOpen = ref(false)
const isOperationsOpen = ref(false)
const isStartedModalOpen = ref(false)
const isFinishedModalOpen = ref(false)
const isFinishedModalType = ref<'downtime' | 'operation'>('downtime')
const isAddFieldOpen = ref(false)
const isFieldsOpen = ref(false)
const fieldsDropdownRef = ref<HTMLElement | null>(null)

// --- Модалки старта операции с привязкой техники ---
const isEquipmentChoiceOpen = ref(false) // Будет ли использована техника?
const isEquipmentModalOpen = ref(false) // Выбор техники + параметры
const pendingStartOperation = ref<{
  fieldId?: string
  fieldName?: string
  operation?: string
  taskId?: string | null
  taskTitle?: string | null
  taskNumber?: number | null
  plannedHectares?: number | null
} | null>(null)

type EquipmentConditionBucket = 'good' | 'acceptable' | 'partial' | 'bad'

const equipmentList = ref<EquipmentRow[]>([])
const equipmentLoading = ref(false)
const equipmentError = ref<string | null>(null)
const selectedEquipmentId = ref<string>('')

const fuelPercent = ref<number>(70)
const conditionPercent = ref<number>(80)
const equipmentRepairNotes = ref<string>('')

const equipmentConditionBucket = computed<EquipmentConditionBucket>(() => {
  if (conditionPercent.value >= 75) return 'good'
  if (conditionPercent.value >= 50) return 'acceptable'
  if (conditionPercent.value >= 25) return 'partial'
  return 'bad'
})

const equipmentConditionLabel = computed(() => {
  const b = equipmentConditionBucket.value
  if (b === 'good') return 'Хорошее состояние'
  if (b === 'acceptable') return 'Приемлемо'
  if (b === 'partial') return 'Требуется частичная починка'
  return 'Плохое состояние'
})

const equipmentConditionRequiresNotes = computed(() => equipmentConditionBucket.value === 'partial' || equipmentConditionBucket.value === 'bad')

const finishNotesModalOpen = ref(false)
const finishNotesType = ref<'downtime' | 'operation' | null>(null)
const finishNotesText = ref('')
const finishProcessedHectares = ref<number>(0)

// Для операций с техникой: сколько топлива осталось у техники (после остановки)
const equipmentFuelLeftPercent = ref<number>(0)
const operatorNoteDraft = ref('')
const operatorNoteSaving = ref(false)

const shouldAskEquipmentFuelLeft = computed(
  () => finishNotesType.value === 'operation' && !!activeOperation.value?.equipmentId,
)
const shouldAskProcessedHectares = computed(() => finishNotesType.value === 'operation')

const newFieldName = ref('')
const newFieldOperation = ref('')
const startPlannedHectares = ref<number | null>(null)
const startOperationPlanError = ref<string | null>(null)

const fields = ref<MechanicField[]>([])
const currentFieldId = ref<string | null>(active.value?.fieldId ?? null)
const userTasks = ref<TaskRow[]>([])
const userTasksLoading = ref(false)
type CalendarTaskToday = {
  id: string
  title: string
  date: string
  startTime: string | null
  endTime: string | null
  priority: string
  completedAt: string | null
}
const calendarTasksToday = ref<CalendarTaskToday[]>([])
const calendarTasksLoading = ref(false)
const calendarTaskSavingIds = ref<string[]>([])

const reasons = ref<Array<{ label: string; description: string; category: DowntimeCategory }>>([...DEFAULT_REASONS])
const workOperationsList = ref<WorkOperationRow[]>([])
const operationHistory = ref(loadOperations())
const downtimeHistory = ref(loadDowntimeEvents())

const issueReportText = ref('')
const issueReportFile = ref<File | null>(null)
const issueReportError = ref<string | null>(null)
const issueReportSuccess = ref<string | null>(null)
const issueReportBusy = ref(false)
const issueFileInputRef = ref<HTMLInputElement | null>(null)
const issueDispatcherModalOpen = ref(false)
const issueDispatchersLoading = ref(false)
const issueDispatchers = ref<EmployeeRow[]>([])
const issuePositions = ref<PositionRow[]>([])
const issuePositionFilter = ref<string>('')
const issueSearch = ref('')
const selectedIssueRecipientIds = ref<string[]>([])
const successModalOpen = ref(false)
const successModalTitle = ref('Операция выполнена')
const successModalMessage = ref('')

function refreshShiftHistory() {
  operationHistory.value = loadOperations()
  downtimeHistory.value = loadDowntimeEvents()
}

function toMs(iso: string | null | undefined): number {
  if (!iso) return 0
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

function lastFinishedActivityMs(): number {
  const opMax = operationHistory.value.reduce((max, op) => Math.max(max, toMs(op.endISO)), 0)
  const downMax = downtimeHistory.value.reduce((max, dt) => Math.max(max, toMs(dt.endISO)), 0)
  return Math.max(opMax, downMax)
}

onMounted(async () => {
  refreshShiftHistory()
  const savedOp = loadActiveOperation()
  if (savedOp && !active.value) {
    activeOperation.value = savedOp
    workStartedAt.value = savedOp.startISO
    operatorNoteDraft.value = savedOp.operatorNote ?? ''
    if (savedOp.fieldId) currentFieldId.value = savedOp.fieldId
  }
  timerInterval = setInterval(() => {
    if (active.value || activeOperation.value) timerTick.value += 1
  }, 1000)
  if (isSupabaseConfigured()) {
    try {
      const fieldRows: FieldRow[] = await loadFields()
      fields.value = fieldRows.map((f) => ({
        id: f.id,
        name: (f.name || '').trim() || `Поле №${f.number}`,
        operation: 'Операция не выбрана',
        area: Number.isFinite(Number(f.area)) ? Number(f.area) : null,
      }))
      if (!currentFieldId.value && fields.value.length) {
        currentFieldId.value = fields.value[0].id
      }
      const fromDb = await loadDowntimeReasons()
      if (fromDb.length) {
        reasons.value = fromDb.map((r: DowntimeReasonRow) => ({
          label: r.label,
          description: r.description ?? '',
          category: r.category as DowntimeCategory,
        }))
      }
      workOperationsList.value = await loadWorkOperations()
      equipmentList.value = await loadEquipment()
      const uid = auth.user.value?.id ?? null
      if (uid) {
        userTasksLoading.value = true
        calendarTasksLoading.value = true
        try {
          const [taskRows, calendarRows] = await Promise.all([
            loadTasksFiltered(false, uid, { limit: 200, involvedUserId: uid }),
            loadCalendarTasks(uid),
          ])
          userTasks.value = taskRows
          const today = new Date()
          const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
          calendarTasksToday.value = calendarRows
            .filter((t) => t.date === todayKey)
            .map((t) => ({
              id: t.id,
              title: t.title,
              date: t.date,
              startTime: t.start_time ?? null,
              endTime: t.end_time ?? null,
              priority: t.priority,
              completedAt: t.completed_at ?? null,
            }))
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
        } finally {
          userTasksLoading.value = false
          calendarTasksLoading.value = false
        }
      }

      // Если локально активность не восстановилась, пробуем взять live-статус из backend (operator_status),
      // чтобы экран оператора совпадал с аналитикой на других устройствах/браузерах.
      if (uid && !active.value && !activeOperation.value) {
        try {
          const rows = await loadOperatorStatusesFromSupabase(true, uid)
          const row = rows[0]
          const staleByHistory = toMs(row?.started_at) > 0 && toMs(row?.started_at) <= lastFinishedActivityMs()
          if (staleByHistory) {
            void deleteOperatorStatus(uid)
          } else if (row?.kind === 'operation') {
            const restored = {
              startISO: row.started_at,
              pausedAt: null,
              accumulatedPauseSeconds: 0,
              taskId: null,
              taskTitle: null,
              taskNumber: null,
              operatorNote: null,
              fieldId: row.field_id ?? undefined,
              fieldName: row.field_name ?? undefined,
              operation: row.operation ?? undefined,
              employee: row.employee || employeeDisplayName.value,
              equipmentId: row.equipment_id ?? null,
              equipmentFuelPercent: null,
              equipmentConditionValue: null,
              equipmentConditionLabel: null,
              equipmentRepairNotes: null,
              plannedHectares: null,
              processedHectares: null,
            }
            activeOperation.value = restored
            workStartedAt.value = row.started_at
            saveActiveOperation(restored)
            if (restored.fieldId) currentFieldId.value = restored.fieldId
          } else if (row?.kind === 'downtime') {
            const restoredDown = {
              id: Date.now(),
              employee: row.employee || employeeDisplayName.value,
              reason: row.downtime_reason || 'Простой',
              category: (row.downtime_category as DowntimeCategory) || 'waiting',
              startISO: row.started_at,
              fieldId: row.field_id ?? undefined,
              fieldName: row.field_name ?? undefined,
              operation: row.operation ?? undefined,
            }
            active.value = restoredDown
            saveActive(restoredDown)
            if (restoredDown.fieldId) currentFieldId.value = restoredDown.fieldId
          }
        } catch (e) {
          console.warn('restore operator status from backend failed', e)
        }
      }
    } catch {
      // оставляем дефолтные причины и пустой список операций
    }
  }

  // Восстановление «живого» статуса в Supabase после перезагрузки страницы (дашборд руководителя).
  const uid = auth.user.value?.id
  if (uid && isSupabaseConfigured()) {
    if (active.value) {
      void upsertOperatorStatus({
        userId: uid,
        kind: 'downtime',
        employee: active.value.employee,
        startedAt: active.value.startISO,
        fieldId: active.value.fieldId ?? null,
        fieldName: active.value.fieldName ?? null,
        operation: active.value.operation ?? null,
        downtimeCategory: active.value.category,
        downtimeReason: active.value.reason,
        equipmentId: null,
      })
    } else if (activeOperation.value) {
      const op = activeOperation.value
      void upsertOperatorStatus({
        userId: uid,
        kind: 'operation',
        employee: op.employee,
        startedAt: op.startISO,
        fieldId: op.fieldId ?? null,
        fieldName: op.fieldName ?? null,
        operation: op.operation ?? null,
        equipmentId: op.equipmentId ?? null,
      })
    }
  }
  window.addEventListener('mousedown', onGlobalPointerDown)
})
onActivated(() => {
  refreshShiftHistory()
})
onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval)
  window.removeEventListener('mousedown', onGlobalPointerDown)
})

watch(
  activeOperation,
  (op) => {
    if (op?.startISO) {
      if (workStartedAt.value !== op.startISO) workStartedAt.value = op.startISO
      return
    }
    if (workStartedAt.value) workStartedAt.value = null
  },
  { immediate: true },
)

function onGlobalPointerDown(e: MouseEvent) {
  if (!isFieldsOpen.value) return
  const root = fieldsDropdownRef.value
  if (!root) return
  if (e.target instanceof Node && root.contains(e.target)) return
  isFieldsOpen.value = false
}

const currentField = computed<MechanicField | null>(() => {
  if (active.value?.fieldId) {
    const fromActive = fields.value.find((f) => f.id === active.value?.fieldId)
    if (fromActive) return fromActive
  }
  return fields.value.find((f) => f.id === currentFieldId.value) ?? null
})

const statusText = computed(() => {
  if (!active.value && !workStartedAt.value) return 'Готов к работе'
  if (!active.value && workStartedAt.value && activeOperation.value?.pausedAt) return 'Операция на паузе'
  if (!active.value && workStartedAt.value) return 'Идёт операция'
  const down = active.value
  if (!down) return 'Готов к работе'
  const reason = reasons.value.find((r) => r.category === down.category)
  return `Простой • ${reason?.label ?? down.reason}`
})

const isOperationPaused = computed(() => !!activeOperation.value?.pausedAt)
const isFieldLocked = computed(() => !!active.value || !!workStartedAt.value)
const hasActiveTaskOperation = computed(() => !!activeOperation.value?.taskId)
const hasActiveEquipmentOperation = computed(() => !!activeOperation.value?.equipmentId)
const activeTaskLabel = computed(() => {
  const op = activeOperation.value
  if (!op?.taskId) return 'Операция без задачи'
  const number = op.taskNumber ? `#${op.taskNumber} ` : ''
  return `${number}${op.taskTitle ?? 'Задача'}`
})
const activeEquipment = computed(() => {
  const id = activeOperation.value?.equipmentId
  if (!id) return null
  return equipmentList.value.find((e) => e.id === id) ?? null
})
const activeEquipmentLabel = computed(() => {
  const e = activeEquipment.value
  if (!e) return 'Техника не выбрана'
  return `${e.brand} — ${e.license_plate}${e.model ? ` (${e.model})` : ''}`
})

const nextUserTasks = computed(() =>
  userTasks.value
    .filter((t) => t.status !== 'done')
    .sort((a, b) => a.number - b.number)
    .slice(0, 8),
)

const dropdownFields = computed(() =>
  fields.value.filter((f) => f.id !== currentField.value?.id),
)

function formatJournalTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type ShiftJournalItem = {
  id: string
  isActive: boolean
  timeLabel: string
  title: string
  subtitle: string
}

const shiftJournalItems = computed<ShiftJournalItem[]>(() => {
  const items: Array<{ at: number; item: ShiftJournalItem }> = []
  if (active.value?.startISO) {
    const at = new Date(active.value.startISO).getTime()
    items.push({
      at,
      item: {
        id: `active-downtime-${active.value.id}`,
        isActive: true,
        timeLabel: `${formatJournalTime(active.value.startISO)} — Сейчас`,
        title: `Простой — ${active.value.reason}`,
        subtitle: active.value.fieldName ?? 'Без поля',
      },
    })
  }
  if (activeOperation.value?.startISO) {
    const at = new Date(activeOperation.value.startISO).getTime()
    items.push({
      at,
      item: {
        id: `active-op-${activeOperation.value.startISO}`,
        isActive: true,
        timeLabel: `${formatJournalTime(activeOperation.value.startISO)} — Сейчас`,
        title: `${activeOperation.value.fieldName ?? 'Поле'} — ${activeOperation.value.operation ?? 'Операция'}`,
        subtitle: `В работе (${timerLabel.value})`,
      },
    })
  }
  for (const op of operationHistory.value.slice(-8)) {
    const at = new Date(op.endISO).getTime()
    items.push({
      at,
      item: {
        id: `op-${op.id}`,
        isActive: false,
        timeLabel: `${formatJournalTime(op.startISO)} - ${formatJournalTime(op.endISO)}`,
        title: op.operation || 'Операция',
        subtitle: `${op.fieldName ?? 'Без поля'} (${op.durationMinutes} мин)`,
      },
    })
  }
  for (const d of downtimeHistory.value.slice(-8)) {
    const at = new Date(d.endISO).getTime()
    items.push({
      at,
      item: {
        id: `down-${d.id}`,
        isActive: false,
        timeLabel: `${formatJournalTime(d.startISO)} - ${formatJournalTime(d.endISO)}`,
        title: `Простой — ${d.reason}`,
        subtitle: `${d.fieldName ?? 'Без поля'} (${d.durationMinutes} мин)`,
      },
    })
  }
  return items
    .sort((a, b) => b.at - a.at)
    .slice(0, 8)
    .map((x) => x.item)
})

const circleFieldLabel = computed(() => active.value?.fieldName ?? currentField.value?.name ?? 'Поле не выбрано')
const circleTaskLabel = computed(
  () => active.value?.operation ?? activeOperation.value?.operation ?? currentField.value?.operation ?? 'Операция не указана',
)

const taskTitle = computed(() => `${circleFieldLabel.value} — ${circleTaskLabel.value}`)
const progressTotal = computed(() => {
  const area = currentField.value?.area
  if (!Number.isFinite(area) || !area || area <= 0) return 0
  return area
})
const progressDone = computed(() => {
  const planned = activeOperation.value?.plannedHectares
  if (!Number.isFinite(planned) || !planned || planned <= 0) return 0
  if (!workStartedAt.value || active.value) return 0
  const elapsed = operationElapsedSeconds(Date.now())
  const progressByTime = (Number(planned) * elapsed) / (3 * 3600)
  return Math.max(0, Math.min(Number(planned), Math.round(progressByTime * 10) / 10))
})
const progressPercent = computed(() => {
  const planned = Number(activeOperation.value?.plannedHectares ?? 0)
  if (!Number.isFinite(planned) || planned <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((progressDone.value / planned) * 100)))
})

function formatHectares(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '—'
  const n = Number(value)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

const pendingFieldArea = computed<number | null>(() => {
  const fieldId = pendingStartOperation.value?.fieldId
  if (!fieldId) return currentField.value?.area ?? null
  return fields.value.find((f) => f.id === fieldId)?.area ?? null
})

const activeOperationFieldArea = computed<number | null>(() => {
  const fieldId = activeOperation.value?.fieldId
  if (!fieldId) return currentField.value?.area ?? null
  return fields.value.find((f) => f.id === fieldId)?.area ?? currentField.value?.area ?? null
})

const finishProcessedHectaresMax = computed<number>(() => {
  const planned = Number(activeOperation.value?.plannedHectares ?? 0)
  if (Number.isFinite(planned) && planned > 0) return planned
  const fieldArea = Number(activeOperationFieldArea.value ?? 0)
  if (Number.isFinite(fieldArea) && fieldArea > 0) return fieldArea
  const byProgress = Number(progressDone.value ?? 0)
  if (Number.isFinite(byProgress) && byProgress > 0) return byProgress
  return 1
})

function setDefaultPlannedHectares() {
  const area = pendingFieldArea.value
  if (Number.isFinite(area ?? NaN) && (area ?? 0) > 0) {
    startPlannedHectares.value = Number(area)
  } else {
    startPlannedHectares.value = null
  }
}

function validatePlannedHectares(): number | null {
  const area = pendingFieldArea.value
  const planned = Number(startPlannedHectares.value)
  if (!Number.isFinite(area ?? NaN) || (area ?? 0) <= 0) {
    startOperationPlanError.value = 'Для выбранного поля не задана площадь. Укажите площадь поля в карточке поля.'
    return null
  }
  if (!Number.isFinite(planned) || planned <= 0) {
    startOperationPlanError.value = 'Укажите план работ в гектарах.'
    return null
  }
  if (planned > Number(area)) {
    startOperationPlanError.value = `План не может быть больше площади поля (${formatHectares(area)} Га).`
    return null
  }
  startOperationPlanError.value = null
  return Math.round(planned * 10) / 10
}

function priorityLabel(priority: string): string {
  return priority === 'high' ? 'Высокий' : priority === 'low' ? 'Низкий' : 'Обычный'
}

function isCalendarTaskSaving(taskId: string): boolean {
  return calendarTaskSavingIds.value.includes(taskId)
}

function formatCalendarTaskTime(task: CalendarTaskToday): string {
  if (task.startTime && task.endTime) return `${task.startTime} - ${task.endTime}`
  if (task.startTime) return task.startTime
  if (task.endTime) return `до ${task.endTime}`
  return 'Без времени'
}

async function toggleCalendarTaskCompleted(taskId: string) {
  if (isCalendarTaskSaving(taskId) || !isSupabaseConfigured()) return
  const idx = calendarTasksToday.value.findIndex((t) => t.id === taskId)
  if (idx < 0) return
  const prev = calendarTasksToday.value[idx]
  const nextCompletedAt = prev.completedAt ? null : new Date().toISOString()

  // Сначала визуальное состояние (анимация), затем запрос в БД.
  calendarTasksToday.value = calendarTasksToday.value.map((t, i) =>
    i === idx ? { ...t, completedAt: nextCompletedAt } : t,
  )
  calendarTaskSavingIds.value = [...calendarTaskSavingIds.value, taskId]

  await new Promise((resolve) => setTimeout(resolve, 260))
  try {
    await updateCalendarTask(taskId, { completed_at: nextCompletedAt })
  } catch (e) {
    // Откат был и раньше, но молча: галочка сама снималась обратно, и это
    // выглядело как сбой интерфейса, а не как отказ сервера.
    calendarTasksToday.value = calendarTasksToday.value.map((t, i) =>
      i === idx ? { ...t, completedAt: prev.completedAt } : t,
    )
    loadError.value = formatSupabaseError(e) || 'Не удалось сохранить отметку о задаче'
  } finally {
    calendarTaskSavingIds.value = calendarTaskSavingIds.value.filter((id) => id !== taskId)
  }
}

function openTaskInTaskManagement(task: TaskRow) {
  void router.push({ name: 'task-management', query: { openTaskId: task.id } })
}

function startDowntime(reason: { label: string; category: DowntimeCategory }) {
  workStartedAt.value = null
  activeOperation.value = null
  saveActiveOperation(null)
  const now = new Date()
  const field = currentField.value
  active.value = {
    id: now.getTime(),
    employee: employeeDisplayName.value,
    reason: reason.label,
    category: reason.category,
    startISO: now.toISOString(),
    fieldId: field?.id,
    fieldName: field?.name,
    operation: field?.operation,
  }
  saveActive(active.value)
  isReasonsOpen.value = false
  isStartedModalOpen.value = true

  const uid = auth.user.value?.id
  if (uid && isSupabaseConfigured() && active.value) {
    void upsertOperatorStatus({
      userId: uid,
      kind: 'downtime',
      employee: active.value.employee,
      startedAt: active.value.startISO,
      fieldId: active.value.fieldId ?? null,
      fieldName: active.value.fieldName ?? null,
      operation: active.value.operation ?? null,
      downtimeCategory: active.value.category,
      downtimeReason: active.value.reason,
      equipmentId: null,
    })
  }
}

function openFinishNotesModal(type: 'downtime' | 'operation') {
  finishNotesType.value = type
  finishNotesText.value = ''
  equipmentFuelLeftPercent.value = 0
  finishProcessedHectares.value = 0
  if (type === 'operation' && activeOperation.value?.equipmentId) {
    // По умолчанию ставим то, что было при старте операции.
    equipmentFuelLeftPercent.value = typeof activeOperation.value.equipmentFuelPercent === 'number'
      ? Math.round(activeOperation.value.equipmentFuelPercent)
      : 0
  }
  if (type === 'operation') {
    const live = progressDone.value
    const maxVal = finishProcessedHectaresMax.value
    const initSource = live > 0 ? live : maxVal
    const initValue = Math.max(0, Math.min(maxVal, initSource))
    finishProcessedHectares.value = Math.round(initValue * 10) / 10
  }
  finishNotesModalOpen.value = true
}

function closeFinishNotesModal() {
  finishNotesModalOpen.value = false
  finishNotesType.value = null
  finishNotesText.value = ''
  equipmentFuelLeftPercent.value = 0
  finishProcessedHectares.value = 0
}

function confirmFinishNotes(notes: string | null) {
  const type = finishNotesType.value
  const notesVal = notes?.trim() || undefined
  const fuelLeft =
    type === 'operation' && activeOperation.value?.equipmentId ? equipmentFuelLeftPercent.value : undefined
  const processedMax = finishProcessedHectaresMax.value
  const processed =
    type === 'operation'
      ? Math.max(0, Math.min(processedMax, Math.round(Number(finishProcessedHectares.value || 0) * 10) / 10))
      : undefined
  closeFinishNotesModal()
  if (type === 'downtime') {
    stopDowntimeWithNotes(notesVal)
    isFinishedModalType.value = 'downtime'
  } else if (type === 'operation') {
    stopOperationWithNotes(notesVal, fuelLeft, processed)
    isFinishedModalType.value = 'operation'
  }
  finishNotesText.value = ''
  isFinishedModalOpen.value = true
}

function stopDowntimeWithNotes(notes?: string) {
  if (!active.value) return
  const now = new Date()
  const start = new Date(active.value.startISO)
  const durationMinutes = Math.max(1, Math.round((now.getTime() - start.getTime()) / 60000))

  const event = {
    id: active.value.id,
    employee: active.value.employee,
    reason: active.value.reason,
    category: active.value.category,
    startISO: active.value.startISO,
    endISO: now.toISOString(),
    durationMinutes,
    fieldId: active.value.fieldId,
    fieldName: active.value.fieldName,
    operation: active.value.operation,
    notes,
  }
  appendEvent(event)
  refreshShiftHistory()
  if (isSupabaseConfigured()) {
    insertDowntime(event, auth.user.value?.id ?? null).catch(() => {})
  }

  active.value = null
  saveActive(null)

  const uid = auth.user.value?.id
  if (uid && isSupabaseConfigured()) {
    void deleteOperatorStatus(uid)
  }
}

function stopOperationWithNotes(notes?: string, equipmentFuelLeft?: number | null, processedHectares?: number | null) {
  if (!workStartedAt.value) return
  const now = new Date()
  const durationMinutes = Math.max(1, Math.round(operationElapsedSeconds(now.getTime()) / 60))
  const field = currentField.value
  const savedOp = activeOperation.value
  const hasEquipment = !!savedOp?.equipmentId

  // Страховка: если в сохранённом активном состоянии почему-то пустые значения,
  // берем их из текущих слайдеров техники.
  const equipmentFuelPercentFinal = savedOp?.equipmentFuelPercent ?? (hasEquipment ? Math.round(fuelPercent.value) : null)
  const equipmentConditionValueFinal = savedOp?.equipmentConditionValue ?? (hasEquipment ? Math.round(conditionPercent.value) : null)
  const equipmentConditionLabelFinal = savedOp?.equipmentConditionLabel ?? (hasEquipment ? equipmentConditionLabel.value : null)
  const equipmentRepairNotesFinal =
    savedOp?.equipmentRepairNotes ??
    (hasEquipment && equipmentConditionRequiresNotes.value ? equipmentRepairNotes.value.trim() : null)
  const liveNote = savedOp?.operatorNote?.trim() || ''
  const finishNote = notes?.trim() || ''
  const mergedNotes = [liveNote, finishNote].filter(Boolean).join('\n\n')
  const op = {
    id: now.getTime(),
    employee: employeeDisplayName.value,
    taskId: savedOp?.taskId ?? null,
    taskTitle: savedOp?.taskTitle ?? null,
    taskNumber: savedOp?.taskNumber ?? null,
    fieldId: savedOp?.fieldId ?? field?.id,
    fieldName: savedOp?.fieldName ?? field?.name,
    operation: savedOp?.operation ?? field?.operation,
    startISO: workStartedAt.value,
    endISO: now.toISOString(),
    durationMinutes,
    notes: mergedNotes || undefined,
    equipmentId: savedOp?.equipmentId ?? null,
    equipmentFuelPercent: equipmentFuelPercentFinal ?? null,
    equipmentFuelLeftPercent: equipmentFuelLeft ?? null,
    equipmentConditionValue: equipmentConditionValueFinal ?? null,
    equipmentConditionLabel: equipmentConditionLabelFinal ?? null,
    equipmentRepairNotes: equipmentRepairNotesFinal ?? null,
    plannedHectares: savedOp?.plannedHectares ?? null,
    processedHectares: processedHectares ?? null,
  }
  appendOperation(op)
  refreshShiftHistory()
  if (isSupabaseConfigured()) {
    insertOperation(op, auth.user.value?.id ?? null).catch((e) => {
      console.error('insertOperation failed (MechanicPage)', e, { op })
    })
  }
  // Диагностика: чтобы понять, что реально уходит в insertOperation.
  // В идеале equipmentFuelPercent/equipmentCondition* должны быть числами.
  saveActiveOperation(null)
  activeOperation.value = null
  workStartedAt.value = null
  operatorNoteDraft.value = ''

  const uid = auth.user.value?.id
  if (uid && isSupabaseConfigured()) {
    void deleteOperatorStatus(uid)
  }
}

function pauseOperation() {
  const op = activeOperation.value
  if (!op || op.pausedAt) return
  const next = { ...op, pausedAt: new Date().toISOString() }
  activeOperation.value = next
  saveActiveOperation(next)
}

function resumeOperation() {
  const op = activeOperation.value
  if (!op?.pausedAt) return
  const pausedAtMs = new Date(op.pausedAt).getTime()
  const nowMs = Date.now()
  const delta = !Number.isNaN(pausedAtMs) && nowMs > pausedAtMs ? Math.floor((nowMs - pausedAtMs) / 1000) : 0
  const next = {
    ...op,
    pausedAt: null,
    accumulatedPauseSeconds: Math.max(0, Math.floor(op.accumulatedPauseSeconds ?? 0) + delta),
  }
  activeOperation.value = next
  saveActiveOperation(next)
}

function setCurrentField(id: string) {
  if (isFieldLocked.value) return
  if (active.value?.fieldId && active.value.fieldId === id) return
  currentFieldId.value = id
}

function pickField(id: string) {
  setCurrentField(id)
  isFieldsOpen.value = false
}

function startOperation(field: MechanicField) {
  setCurrentField(field.id)
  pendingStartOperation.value = {
    fieldId: field.id,
    fieldName: field.name,
    operation: field.operation,
  }
  setDefaultPlannedHectares()
  startOperationPlanError.value = null
  isOperationsOpen.value = false
  isEquipmentChoiceOpen.value = true
}

function startOperationByName(op: WorkOperationRow) {
  const field = currentField.value
  pendingStartOperation.value = {
    fieldId: field?.id,
    fieldName: field?.name,
    operation: op.name,
    taskId: null,
    taskTitle: null,
    taskNumber: null,
  }
  setDefaultPlannedHectares()
  startOperationPlanError.value = null
  isOperationsOpen.value = false
  isEquipmentChoiceOpen.value = true
}

function startOperationByTask(task: TaskRow) {
  const field =
    fields.value.find((f) => f.name === task.field) ??
    fields.value.find((f) => task.field.includes(f.name))
  if (field) setCurrentField(field.id)
  pendingStartOperation.value = {
    fieldId: field?.id,
    fieldName: field?.name ?? task.field,
    operation: task.work_type || task.title,
    taskId: task.id,
    taskTitle: task.title,
    taskNumber: task.number,
  }
  setDefaultPlannedHectares()
  startOperationPlanError.value = null
  isOperationsOpen.value = false
  isEquipmentChoiceOpen.value = true
}

async function markTaskOperationStarted(taskId: string | null | undefined) {
  const uid = auth.user.value?.id ?? null
  if (!taskId || !uid || !isSupabaseConfigured()) return
  try {
    const task = userTasks.value.find((t) => t.id === taskId)
    if (task && task.status === 'todo') {
      await updateTask(task.id, { status: 'in_progress' })
      userTasks.value = userTasks.value.map((t) =>
        t.id === task.id ? { ...t, status: 'in_progress' } : t,
      )
    }
    await addTaskEvent({
      taskId,
      userId: uid,
      eventType: 'operation_started',
      payload: {
        fieldId: activeOperation.value?.fieldId ?? null,
        fieldName: activeOperation.value?.fieldName ?? null,
        operation: activeOperation.value?.operation ?? null,
      },
    })
  } catch (e) {
    console.error('markTaskOperationStarted failed', e)
  }
}

function resetEquipmentForm() {
  selectedEquipmentId.value = ''
  fuelPercent.value = 70
  conditionPercent.value = 80
  equipmentRepairNotes.value = ''
  equipmentError.value = null
  equipmentList.value = []
}

function conditionFromEquipmentType(c: string | null | undefined): number {
  // Пробрасываем из типа техники в начальное значение слайдера (примерно).
  if (c === 'operational') return 85
  if (c === 'repair') return 45
  if (c === 'decommissioned') return 10
  return 80
}

async function openEquipmentModal() {
  // Если бекенд не настроен или техник нет — всё равно показываем UI и позволяем заполнить параметры,
  // но без сохранения equipment_id.
  resetEquipmentForm()
  startOperationPlanError.value = null
  isEquipmentChoiceOpen.value = false
  isEquipmentModalOpen.value = true

  if (!isSupabaseConfigured()) return
  equipmentLoading.value = true
  try {
    equipmentList.value = await loadEquipment()
    if (equipmentList.value.length) {
      selectedEquipmentId.value = equipmentList.value[0].id
      conditionPercent.value = conditionFromEquipmentType(equipmentList.value[0].condition)
    }
  } catch (e) {
    equipmentError.value = e instanceof Error ? e.message : 'Не удалось загрузить технику'
  } finally {
    equipmentLoading.value = false
  }
}

watch(selectedEquipmentId, (id) => {
  if (!id) return
  const eq = equipmentList.value.find((e) => e.id === id)
  if (!eq) return
  conditionPercent.value = conditionFromEquipmentType(eq.condition)
  // При хорошем/приемлемом состоянии починка не нужна — очищаем текст.
  if (!(eq.condition === 'repair' || eq.condition === 'decommissioned')) {
    equipmentRepairNotes.value = ''
  }
})

watch(conditionPercent, () => {
  if (!equipmentConditionRequiresNotes.value) equipmentRepairNotes.value = ''
})

function startOperationConfirmedWithoutEquipment() {
  const pending = pendingStartOperation.value
  if (!pending) return
  const plannedHectares = validatePlannedHectares()
  if (plannedHectares == null) return
  const startISO = new Date().toISOString()
  workStartedAt.value = startISO
  activeOperation.value = {
    startISO,
    pausedAt: null,
    accumulatedPauseSeconds: 0,
    taskId: pending.taskId ?? null,
    taskTitle: pending.taskTitle ?? null,
    taskNumber: pending.taskNumber ?? null,
    operatorNote: null,
    fieldId: pending.fieldId,
    fieldName: pending.fieldName,
    operation: pending.operation,
    employee: employeeDisplayName.value,
    equipmentId: null,
    equipmentFuelPercent: null,
    equipmentConditionValue: null,
    equipmentConditionLabel: null,
    equipmentRepairNotes: null,
    plannedHectares,
  }
  saveActiveOperation(activeOperation.value)
  operatorNoteDraft.value = ''
  void markTaskOperationStarted(pending.taskId)
  isEquipmentChoiceOpen.value = false
  pendingStartOperation.value = null
  startOperationPlanError.value = null

  const uid = auth.user.value?.id
  if (uid && isSupabaseConfigured()) {
    void upsertOperatorStatus({
      userId: uid,
      kind: 'operation',
      employee: activeOperation.value.employee,
      startedAt: startISO,
      fieldId: activeOperation.value.fieldId ?? null,
      fieldName: activeOperation.value.fieldName ?? null,
      operation: activeOperation.value.operation ?? null,
      equipmentId: activeOperation.value.equipmentId ?? null,
    })
  }
}

function startOperationConfirmedWithEquipment() {
  const pending = pendingStartOperation.value
  if (!pending) return
  const plannedHectares = validatePlannedHectares()
  if (plannedHectares == null) return
  const equipmentId = selectedEquipmentId.value
  if (!equipmentId) return
  if (equipmentConditionRequiresNotes.value && !equipmentRepairNotes.value.trim()) return

  const startISO = new Date().toISOString()
  workStartedAt.value = startISO
  activeOperation.value = {
    startISO,
    pausedAt: null,
    accumulatedPauseSeconds: 0,
    taskId: pending.taskId ?? null,
    taskTitle: pending.taskTitle ?? null,
    taskNumber: pending.taskNumber ?? null,
    operatorNote: null,
    fieldId: pending.fieldId,
    fieldName: pending.fieldName,
    operation: pending.operation,
    employee: employeeDisplayName.value,
    equipmentId,
    equipmentFuelPercent: Math.round(fuelPercent.value),
    equipmentConditionValue: Math.round(conditionPercent.value),
    equipmentConditionLabel: equipmentConditionLabel.value,
    equipmentRepairNotes: equipmentConditionRequiresNotes.value ? equipmentRepairNotes.value.trim() : null,
    plannedHectares,
  }
  saveActiveOperation(activeOperation.value)
  operatorNoteDraft.value = ''
  void markTaskOperationStarted(pending.taskId)
  isEquipmentModalOpen.value = false
  isEquipmentChoiceOpen.value = false
  pendingStartOperation.value = null
  startOperationPlanError.value = null

  const uid = auth.user.value?.id
  if (uid && isSupabaseConfigured() && activeOperation.value) {
    void upsertOperatorStatus({
      userId: uid,
      kind: 'operation',
      employee: activeOperation.value.employee,
      startedAt: startISO,
      fieldId: activeOperation.value.fieldId ?? null,
      fieldName: activeOperation.value.fieldName ?? null,
      operation: activeOperation.value.operation ?? null,
      equipmentId: activeOperation.value.equipmentId ?? null,
    })
  }
}

async function saveOperatorNote() {
  if (!activeOperation.value || !workStartedAt.value) return
  const uid = auth.user.value?.id ?? null
  const note = operatorNoteDraft.value.trim()
  if (!note || operatorNoteSaving.value) return
  operatorNoteSaving.value = true
  try {
    const op = activeOperation.value
    const merged = [op.operatorNote?.trim() || '', note].filter(Boolean).join('\n')
    const next = { ...op, operatorNote: merged }
    activeOperation.value = next
    saveActiveOperation(next)
    operatorNoteDraft.value = ''

    if (uid && op.taskId && isSupabaseConfigured()) {
      await addTaskComment(op.taskId, uid, note)
      await addTaskEvent({
        taskId: op.taskId,
        userId: uid,
        eventType: 'operator_note',
        payload: {
          note,
          operation: op.operation ?? null,
          fieldName: op.fieldName ?? null,
        },
      })
      const task = userTasks.value.find((t) => t.id === op.taskId)
      if (task) {
        const prev = task.description?.trim() ?? ''
        const stamped = `${new Date().toLocaleString('ru-RU')} — ${note}`
        const nextDescription = [prev, `[Оператор] ${stamped}`].filter(Boolean).join('\n')
        await updateTask(task.id, {
          description: nextDescription,
          status: task.status === 'todo' ? 'in_progress' : task.status,
        })
        userTasks.value = userTasks.value.map((t) =>
          t.id === task.id ? { ...t, description: nextDescription, status: task.status === 'todo' ? 'in_progress' : t.status } : t,
        )
      }
    }
  } catch (e) {
    console.error('saveOperatorNote failed', e)
  } finally {
    operatorNoteSaving.value = false
  }
}

const issueCanSubmit = computed(() => issueReportText.value.trim().length > 0 || !!issueReportFile.value)
const issuePositionFilterValue = computed(() => issuePositionFilter.value || null)
const issueCanSendNow = computed(() => selectedIssueRecipientIds.value.length > 0)

function openIssueFilePicker() {
  issueFileInputRef.value?.click()
}

function onIssueFilePicked(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0] ?? null
  issueReportFile.value = file
  issueReportError.value = null
  if (input) input.value = ''
}

function removeIssueFile() {
  issueReportFile.value = null
}

function formatIssueFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

async function openIssueDispatcherPicker() {
  issueReportError.value = null
  issueReportSuccess.value = null
  if (!issueCanSubmit.value) {
    issueReportError.value = 'Добавьте описание проблемы или файл.'
    return
  }
  issueDispatcherModalOpen.value = true
  if (!issuePositions.value.length) {
    try {
      issuePositions.value = await loadPositions()
    } catch (e) {
      // Список должностей подсказывает адресата, но не мешает отправить заявку.
      console.error('Справочник должностей', e)
      issuePositions.value = []
    }
  }
  await loadIssueRecipients()
}

function closeIssueDispatcherPicker() {
  if (issueReportBusy.value) return
  issueDispatcherModalOpen.value = false
}

async function submitIssueToDispatcher() {
  if (issueReportBusy.value) return
  const recipientIds = selectedIssueRecipientIds.value
  if (!recipientIds.length) {
    issueReportError.value = 'Выберите хотя бы одного получателя.'
    return
  }
  const message = issueReportText.value.trim()
  if (!message && !issueReportFile.value) {
    issueReportError.value = 'Добавьте описание проблемы или файл.'
    return
  }
  issueReportBusy.value = true
  issueReportError.value = null
  issueReportSuccess.value = null
  try {
    const op = activeOperation.value
    const headline = '[ВАЖНО] Сообщение о проблеме'
    const contextLines = [
      op?.fieldName ? `Поле: ${op.fieldName}` : null,
      op?.operation ? `Операция: ${op.operation}` : null,
      op?.equipmentId ? `Техника: ${activeEquipmentLabel.value}` : null,
      op?.taskTitle ? `Задача: ${activeTaskLabel.value}` : null,
    ].filter(Boolean) as string[]
    const payloadText = [headline, message || null, contextLines.length ? contextLines.join('\n') : null]
      .filter(Boolean)
      .join('\n\n')

    for (const recipientId of recipientIds) {
      const threadId = await getOrCreateDmThread(recipientId)
      if (issueReportFile.value) {
        await sendChatMessageWithFile(threadId, issueReportFile.value, payloadText, {
          urgent: true,
          urgentKind: 'problem_report',
        })
      } else {
        await sendChatMessage(threadId, payloadText, {
          urgent: true,
          urgentKind: 'problem_report',
        })
      }
    }

    issueReportText.value = ''
    issueReportFile.value = null
    issueDispatcherModalOpen.value = false
    issueReportSuccess.value = `Отправлено (${recipientIds.length}) как важное сообщение.`
    successModalTitle.value = 'Сообщение отправлено'
    successModalMessage.value = `Проблема отправлена ${recipientIds.length} получателям как важное сообщение.`
    successModalOpen.value = true
    selectedIssueRecipientIds.value = []
  } catch (e) {
    issueReportError.value = e instanceof Error ? e.message : 'Не удалось отправить сообщение получателям'
  } finally {
    issueReportBusy.value = false
  }
}

async function loadIssueRecipients() {
  issueDispatchersLoading.value = true
  try {
    const search = issueSearch.value.trim()
    const byPosition = issuePositionFilterValue.value
    const rows = search
      ? await searchEmployees(search, 200, byPosition)
      : await loadEmployees(200, byPosition)
    const me = auth.user.value?.id ?? ''
    issueDispatchers.value = rows.filter((r) => r.id !== me)
  } catch (e) {
    issueReportError.value = e instanceof Error ? e.message : 'Не удалось загрузить список сотрудников'
    issueDispatchers.value = []
  } finally {
    issueDispatchersLoading.value = false
  }
}

function toggleIssueRecipient(id: string) {
  if (selectedIssueRecipientIds.value.includes(id)) {
    selectedIssueRecipientIds.value = selectedIssueRecipientIds.value.filter((x) => x !== id)
  } else {
    selectedIssueRecipientIds.value = [...selectedIssueRecipientIds.value, id]
  }
}

function closeEquipmentChoiceAndReturnToSheet() {
  isEquipmentChoiceOpen.value = false
  pendingStartOperation.value = null
  startOperationPlanError.value = null
  isOperationsOpen.value = true
}

function backFromEquipmentModalToChoice() {
  isEquipmentModalOpen.value = false
  isEquipmentChoiceOpen.value = true
  startOperationPlanError.value = null
}


function openAddField() {
  router.push({ name: 'fields', query: { highlightAddField: '1' } })
}

function addField() {
  const name = newFieldName.value.trim()
  const op = newFieldOperation.value.trim()
  if (!name || !op) {
    return
  }
  const id = `field-${Date.now()}`
  const field: MechanicField = {
    id,
    name,
    operation: op,
    area: null,
  }
  fields.value = [...fields.value, field]
  currentFieldId.value = id
  isAddFieldOpen.value = false
}
</script>

<template>
  <section class="mechanic-page">
    <p v-if="loadError" class="page-load-error" role="alert">{{ loadError }}</p>
    <div class="mechanic-shell">
      <main class="mechanic-main">
        <section class="operator-hero page-enter-item" style="--enter-delay: 60ms">
          <div class="operator-hero-left">
            <span class="operator-pill">Текущая задача</span>
            <h2 class="operator-title">{{ circleFieldLabel }}</h2>
            <p class="operator-subtitle">{{ circleTaskLabel }}</p>

            <div class="operator-time-box">
              <div class="operator-time-label">Время в работе</div>
              <div class="operator-time-value">{{ timerStartISO ? timerLabel : '00:00:00' }}</div>
            </div>

            <div class="operator-notes">
              <label class="operator-notes-label" for="operator-note">Заметки оператора</label>
              <div class="mechanic-dispatcher-wip" role="status" aria-live="polite">
                <svg
                  class="mechanic-wip-loader"
                  viewBox="0 0 64 64"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path pathLength="360" d="M 56.3752 2 H 7.6248 C 7.2797 2 6.9999 2.268 6.9999 2.5985 V 61.4015 C 6.9999 61.7321 7.2797 62 7.6248 62 H 56.3752 C 56.7203 62 57.0001 61.7321 57.0001 61.4015 V 2.5985 C 57.0001 2.268 56.7203 2 56.3752 2 Z" />
                  <path pathLength="360" d="M 55.7503 60.803 H 8.2497 V 3.1971 H 55.7503 V 60.803 Z" />
                  <path pathLength="360" d="M 13.1528 55.5663 C 13.1528 55.8968 13.4326 56.1648 13.7777 56.1648 H 50.2223 C 50.5674 56.1648 50.8472 55.8968 50.8472 55.5663 V 8.4339 C 50.8472 8.1034 50.5674 7.8354 50.2223 7.8354 H 13.7777 C 13.4326 7.8354 13.1528 8.1034 13.1528 8.4339 V 55.5663 Z" />
                </svg>
                <div class="mechanic-dispatcher-wip-text">В разработке</div>
              </div>
            </div>
          </div>

          <div class="operator-hero-sep" />

          <div class="operator-hero-right">
            <div class="operator-progress-head">
              <div>
                <div class="operator-progress-title">Прогресс выполнения</div>
                <div class="operator-progress-meta" v-if="activeOperation?.plannedHectares && progressTotal > 0">
                  Обработано {{ formatHectares(progressDone) }} из {{ formatHectares(activeOperation.plannedHectares) }} Га
                </div>
                <div class="operator-progress-meta" v-else-if="progressTotal > 0">
                  Площадь поля: {{ formatHectares(progressTotal) }} Га
                </div>
                <div class="operator-progress-meta" v-else>
                  Укажите площадь в карточке поля для расчета плана.
                </div>
              </div>
              <div class="operator-progress-value">{{ progressPercent }}%</div>
            </div>
            <div class="operator-progress-track">
              <div class="operator-progress-fill" :style="{ width: progressPercent + '%' }" />
            </div>

            <div class="operator-stats">
              <div class="operator-stat-card">
                <div class="operator-stat-label">Топливо</div>
                <div class="operator-stat-value">{{ activeOperation?.equipmentFuelPercent ?? '—' }}%</div>
              </div>
            </div>

            <div class="operator-actions">
              <template v-if="!active && !workStartedAt">
                <button
                  class="operator-btn operator-btn-danger"
                  type="button"
                  :disabled="!currentField"
                  @click="isReasonsOpen = true"
                >
                  Начать простой
                </button>
                <button
                  class="operator-btn operator-btn-success"
                  type="button"
                  :disabled="!workOperationsList.length && !fields.length"
                  @click="isOperationsOpen = true"
                >
                  Начать операцию
                </button>
              </template>
              <template v-else-if="!active && workStartedAt">
                <button
                  class="operator-btn operator-btn-danger"
                  type="button"
                  @click="openFinishNotesModal('operation')"
                >
                  Завершить операцию
                </button>
                <button
                  v-if="!isOperationPaused"
                  class="operator-btn operator-btn-warning"
                  type="button"
                  @click="pauseOperation"
                >
                  Пауза / Простой
                </button>
                <button
                  v-else
                  class="operator-btn operator-btn-success"
                  type="button"
                  @click="resumeOperation"
                >
                  Продолжить
                </button>
              </template>
              <button
                v-else
                class="operator-btn operator-btn-danger"
                type="button"
                @click="openFinishNotesModal('downtime')"
              >
                Завершить простой
              </button>
            </div>
          </div>
        </section>

        <section class="operator-fields page-enter-item" style="--enter-delay: 80ms">
          <div class="operator-fields-head">
            <div class="operator-fields-title">Поля</div>
            <div class="operator-fields-hint">Листайте и выберите поле</div>
          </div>
          <div ref="fieldsDropdownRef" class="operator-fields-dropdown">
            <button
              type="button"
              class="operator-fields-trigger"
              :disabled="isFieldLocked"
              @click="isFieldsOpen = !isFieldsOpen"
            >
              <span class="operator-fields-trigger-main">{{ currentField?.name ?? 'Выберите поле' }}</span>
              <span class="operator-fields-trigger-sub">{{ currentField?.operation ?? 'Операция не выбрана' }}</span>
              <span class="operator-fields-trigger-chev" :class="{ 'operator-fields-trigger-chev--open': isFieldsOpen }">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>
            <div v-if="isFieldsOpen" class="operator-fields-menu">
              <button
                v-for="field in dropdownFields"
                :key="field.id"
                class="operator-fields-option"
                :class="{ 'operator-fields-option--active': currentField?.id === field.id }"
                type="button"
                :disabled="isFieldLocked"
                @click="pickField(field.id)"
              >
                <span class="operator-fields-option-name">{{ field.name }}</span>
                <span class="operator-fields-option-op">{{ field.operation }}</span>
              </button>
              <button class="operator-fields-option operator-fields-option--add" type="button" @click="openAddField">
                + Добавить поле
              </button>
            </div>
          </div>
        </section>

        <section class="mechanic-dashboard-grid page-enter-item" style="--enter-delay: 90ms">
          <article class="mechanic-panel mechanic-panel-next">
            <div class="mechanic-panel-head">
              <h3 class="mechanic-panel-title">Следующая задача</h3>
              <router-link to="/task-management" class="mechanic-panel-link">Все задачи</router-link>
            </div>
            <div v-if="userTasksLoading" class="mechanic-today-tasks-loading">
              <UiLoadingBar size="compact" />
            </div>
            <ul v-else-if="nextUserTasks.length" class="mechanic-next-list">
              <li
                v-for="t in nextUserTasks"
                :key="t.id"
                class="mechanic-next-item mechanic-next-item--clickable"
                role="button"
                tabindex="0"
                @click="openTaskInTaskManagement(t)"
                @keydown.enter="openTaskInTaskManagement(t)"
              >
                <div class="mechanic-next-meta">
                  <span class="mechanic-next-number">#{{ t.number }}</span>
                  <span class="mechanic-next-field">{{ t.field }}</span>
                </div>
                <div class="mechanic-next-title">{{ t.title }}</div>
                <div class="mechanic-next-actions">
                  <span
                    class="mechanic-today-task-priority"
                    :class="{
                      'mechanic-today-task-priority--high': t.priority === 'high',
                      'mechanic-today-task-priority--low': t.priority === 'low',
                    }"
                  >
                    {{ priorityLabel(t.priority) }}
                  </span>
                  <button
                    type="button"
                    class="mechanic-task-run-btn"
                    :disabled="!!workStartedAt || !!active"
                    @click.stop
                    @click="startOperationByTask(t)"
                  >
                    В работу
                  </button>
                </div>
              </li>
            </ul>
            <p v-else class="mechanic-today-tasks-empty">Нет активных задач, назначенных на вас</p>

            <div class="mechanic-calendar-block">
              <div class="mechanic-calendar-title">Задачи из календаря (сегодня)</div>
              <div v-if="calendarTasksLoading" class="mechanic-today-tasks-loading">
                <UiLoadingBar size="compact" />
              </div>
              <ul v-else-if="calendarTasksToday.length" class="mechanic-calendar-list">
                <li
                  v-for="task in calendarTasksToday"
                  :key="task.id"
                  class="mechanic-calendar-item"
                  :class="{ 'mechanic-calendar-item--done': !!task.completedAt }"
                >
                  <div class="checkbox-container">
                    <input
                      :id="`calendar-task-${task.id}`"
                      class="task-checkbox"
                      type="checkbox"
                      :checked="!!task.completedAt"
                      :disabled="isCalendarTaskSaving(task.id)"
                      @change="toggleCalendarTaskCompleted(task.id)"
                    />
                    <label :for="`calendar-task-${task.id}`" class="checkbox-label">
                      <div class="checkbox-box">
                        <div class="checkbox-fill"></div>
                        <div class="checkmark">
                          <svg viewBox="0 0 24 24" class="check-icon">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"></path>
                          </svg>
                        </div>
                        <div class="success-ripple"></div>
                      </div>
                      <span class="checkbox-text">{{ task.title }}</span>
                    </label>
                  </div>
                  <div class="mechanic-calendar-meta">
                    <span class="mechanic-calendar-time">{{ formatCalendarTaskTime(task) }}</span>
                    <span
                      class="mechanic-today-task-priority"
                      :class="{
                        'mechanic-today-task-priority--high': task.priority === 'high',
                        'mechanic-today-task-priority--low': task.priority === 'low',
                      }"
                    >
                      {{ priorityLabel(task.priority) }}
                    </span>
                    <span v-if="isCalendarTaskSaving(task.id)" class="mechanic-calendar-saving">Сохранение...</span>
                  </div>
                </li>
              </ul>
              <p v-else class="mechanic-today-tasks-empty">На сегодня в календаре задач нет</p>
            </div>
          </article>

          <article class="mechanic-panel mechanic-panel-middle">
            <div class="mechanic-panel-head">
              <h3 class="mechanic-panel-title">Техника</h3>
            </div>
            <div v-if="hasActiveEquipmentOperation" class="mechanic-equipment-hero">
              <div class="mechanic-equipment-hero-label">{{ hasActiveTaskOperation ? 'Активная задача' : 'Активная операция' }}</div>
              <div class="mechanic-equipment-hero-title">{{ hasActiveTaskOperation ? activeTaskLabel : (activeOperation?.operation || 'Операция без задачи') }}</div>
              <div class="mechanic-equipment-hero-sub">{{ activeEquipmentLabel }}</div>
              <div class="mechanic-equipment-hero-chip">
                Топливо: {{ activeOperation?.equipmentFuelPercent ?? '—' }}%
              </div>
            </div>
            <div v-else class="mechanic-equipment-empty">
              Техника появится после старта операции и выбора техники.
            </div>
            <div class="mechanic-dispatcher-card">
              <div class="mechanic-dispatcher-title">
                <span>Сообщить о проблеме</span>
              </div>
              <p class="mechanic-dispatcher-desc">Поломка техники, препятствие на поле или другие трудности.</p>
              <textarea
                v-model="issueReportText"
                class="mechanic-dispatcher-textarea"
                placeholder="Опишите проблему коротко..."
                maxlength="300"
              />
              <div v-if="issueReportFile" class="mechanic-dispatcher-file-pill">
                <span class="mechanic-dispatcher-file-name">{{ issueReportFile.name }}</span>
                <span class="mechanic-dispatcher-file-size">{{ formatIssueFileSize(issueReportFile.size) }}</span>
                <button type="button" class="mechanic-dispatcher-file-remove" @click="removeIssueFile">✕</button>
              </div>
              <input
                ref="issueFileInputRef"
                class="mechanic-dispatcher-file-input"
                type="file"
                @change="onIssueFilePicked"
              />
              <div class="mechanic-dispatcher-actions">
                <button
                  type="button"
                  class="action_has has_saved mechanic-dispatcher-attach"
                  :disabled="issueReportBusy"
                  @click="openIssueFilePicker"
                  aria-label="Добавить файл"
                >
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                    stroke-width="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    fill="none"
                  >
                    <path
                      d="m19,21H5c-1.1,0-2-.9-2-2V5c0-1.1.9-2,2-2h11l5,5v11c0,1.1-.9,2-2,2Z"
                      data-path="box"
                    />
                    <path d="M7 3L7 8L15 8" data-path="line-top" />
                    <path d="M17 20L17 13L7 13L7 20" data-path="line-bottom" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="mechanic-dispatcher-send"
                  :disabled="!issueCanSubmit || issueReportBusy"
                  @click="openIssueDispatcherPicker"
                >
                  <span class="mechanic-dispatcher-send-msg" aria-hidden="true"></span>
                  <span class="mechanic-dispatcher-send-text">{{ issueReportBusy ? 'Отправка...' : 'Отправить диспетчеру' }}</span>
                </button>
              </div>
              <p v-if="issueReportError" class="mechanic-dispatcher-error">{{ issueReportError }}</p>
              <p v-else-if="issueReportSuccess" class="mechanic-dispatcher-success">{{ issueReportSuccess }}</p>
            </div>
          </article>

          <article class="mechanic-panel mechanic-panel-journal">
            <div class="mechanic-panel-head">
              <h3 class="mechanic-panel-title">Журнал смены</h3>
            </div>
            <ul class="mechanic-journal-list">
              <li v-if="!shiftJournalItems.length" class="mechanic-journal-empty">
                Записей пока нет. После начала или завершения операции здесь появится история смены.
              </li>
              <li v-for="item in shiftJournalItems" :key="item.id" class="mechanic-journal-item">
                <span class="mechanic-journal-dot" :class="{ 'mechanic-journal-dot--active': item.isActive }" />
                <div class="mechanic-journal-content">
                  <div class="mechanic-journal-time">{{ item.timeLabel }}</div>
                  <div class="mechanic-journal-title">{{ item.title }}</div>
                  <div class="mechanic-journal-sub">{{ item.subtitle }}</div>
                </div>
              </li>
            </ul>
          </article>
        </section>
      </main>
    </div>

    <div
      v-if="issueDispatcherModalOpen"
      class="modal-backdrop"
      @click.self="closeIssueDispatcherPicker"
    >
      <div class="modal modal--issue-recipients" @click.stop>
        <div class="modal-badge">АГРОСИСТЕМА</div>
        <div class="modal-title">Кому отправить сообщение о проблеме?</div>
        <p class="modal-text modal-text-muted">Выберите одного или нескольких сотрудников. Сообщение будет отправлено в чат как важное.</p>
        <div class="modal-form modal-form--issue-filters">
          <label class="modal-field">
            <span class="modal-label">Должность</span>
            <select v-model="issuePositionFilter" class="modal-select" @change="loadIssueRecipients">
              <option value="">Все должности</option>
              <option v-for="pos in issuePositions" :key="pos.id" :value="pos.name">{{ pos.name }}</option>
            </select>
          </label>
          <label class="modal-field">
            <span class="modal-label">Поиск</span>
            <input
              v-model.trim="issueSearch"
              class="modal-input"
              type="search"
              placeholder="ФИО, email, телефон..."
              @input="loadIssueRecipients"
            />
          </label>
        </div>
        <div v-if="issueDispatchersLoading" class="modal-text modal-text--loading">
          <UiLoadingBar size="compact" />
        </div>
        <div v-else-if="!issueDispatchers.length" class="modal-text modal-text-muted">
          Подходящих сотрудников не найдено.
        </div>
        <div v-else class="modal-issue-recipient-list">
          <label
            v-for="d in issueDispatchers"
            :key="d.id"
            class="modal-issue-recipient-item"
            :class="{ 'modal-issue-recipient-item--selected': selectedIssueRecipientIds.includes(d.id) }"
          >
            <input
              class="modal-issue-checkbox-input"
              type="checkbox"
              :checked="selectedIssueRecipientIds.includes(d.id)"
              @change="toggleIssueRecipient(d.id)"
            />
            <span class="modal-issue-checkbox-mark" aria-hidden="true"></span>
            <span class="modal-issue-recipient-main">{{ d.display_name || d.email || 'Сотрудник' }}</span>
            <span class="modal-issue-recipient-meta">{{ d.position || d.role || '—' }} · {{ d.email || 'без email' }}</span>
          </label>
        </div>
        <p v-if="selectedIssueRecipientIds.length" class="modal-issue-selected">
          Выбрано получателей: {{ selectedIssueRecipientIds.length }}
        </p>
        <div class="modal-actions modal-actions--two">
          <button type="button" class="modal-btn-ghost" :disabled="issueReportBusy" @click="closeIssueDispatcherPicker">
            Отмена
          </button>
          <button
            type="button"
            class="mechanic-dispatcher-send modal-issue-submit"
            :disabled="issueReportBusy || !issueCanSendNow"
            @click="submitIssueToDispatcher"
          >
            <span class="mechanic-dispatcher-send-msg" aria-hidden="true"></span>
            <span class="mechanic-dispatcher-send-text">{{ issueReportBusy ? 'Отправка...' : 'Отправить' }}</span>
          </button>
        </div>
      </div>
    </div>

    <div
      class="sheet-backdrop"
      :class="{ 'sheet-backdrop-open': isReasonsOpen }"
      @click="isReasonsOpen = false"
    />
    <aside class="sheet" :class="{ 'sheet-open': isReasonsOpen }">
      <header class="sheet-header">
        <div>
          <div class="sheet-label">Простой</div>
          <div class="sheet-title">Выберите причину начала простоя</div>
        </div>
        <button class="sheet-close" type="button" @click="isReasonsOpen = false">
          ✕
        </button>
      </header>
      <ul class="sheet-list">
        <li
          v-for="reason in reasons"
          :key="reason.category"
          class="sheet-item"
        >
          <button
            class="sheet-button"
            type="button"
            @click="startDowntime(reason)"
          >
            <span class="sheet-button-title">{{ reason.label }}</span>
            <span class="sheet-button-desc">{{ reason.description }}</span>
          </button>
        </li>
      </ul>
    </aside>

    <div
      class="sheet-backdrop"
      :class="{ 'sheet-backdrop-open': isOperationsOpen }"
      @click="isOperationsOpen = false"
    />
    <aside class="sheet" :class="{ 'sheet-open': isOperationsOpen }">
      <header class="sheet-header">
        <div>
          <div class="sheet-label">Операция</div>
          <div class="sheet-title">Выберите операцию для работы</div>
        </div>
        <button class="sheet-close" type="button" @click="isOperationsOpen = false">
          ✕
        </button>
      </header>
      <ul class="sheet-list">
        <li
          v-for="op in workOperationsList"
          :key="op.id"
          class="sheet-item"
        >
          <button
            class="sheet-button"
            type="button"
            @click="startOperationByName(op)"
          >
            <span class="sheet-button-title">{{ op.name }}</span>
            <span class="sheet-button-desc">Начать операцию (поле: {{ currentField?.name ?? 'не выбрано' }})</span>
          </button>
        </li>
        <li v-for="field in (workOperationsList.length ? [] : fields)" :key="'f-' + field.id" class="sheet-item">
          <button class="sheet-button" type="button" @click="startOperation(field)">
            <span class="sheet-button-title">{{ field.name }} — {{ field.operation }}</span>
            <span class="sheet-button-desc">Начать работу по этому полю</span>
          </button>
        </li>
      </ul>
      <p v-if="!workOperationsList.length && !fields.length" class="sheet-empty">Добавьте операции на странице «Поля» (блок «Справочники») или поля в «Мои поля сегодня».</p>
    </aside>

    <!-- Modal: Будет ли использована техника? -->
    <div
      v-if="isEquipmentChoiceOpen"
      class="modal-backdrop"
      @click="closeEquipmentChoiceAndReturnToSheet()"
    >
      <div class="modal" @click.stop>
        <div class="modal-badge">АГРОСИСТЕМА</div>
        <div class="modal-title">Будет ли использована техника?</div>
        <p class="modal-text modal-text-muted">
          Если техника нужна — выберите её и укажите параметры (топливо и состояние).
        </p>
        <p v-if="startOperationPlanError" class="modal-text modal-hectares-error">
          {{ startOperationPlanError }}
        </p>
        <div class="modal-actions modal-actions--two">
          <button type="button" class="modal-btn-ghost" @click="startOperationConfirmedWithoutEquipment">
            Нет
          </button>
          <button type="button" class="modal-btn" @click="openEquipmentModal">
            Да
          </button>
        </div>
      </div>
    </div>

    <!-- Modal: Выбор техники + топливо/состояние -->
    <div
      v-if="isEquipmentModalOpen"
      class="modal-backdrop"
      @click="backFromEquipmentModalToChoice()"
    >
      <div class="modal" @click.stop>
        <div class="modal-badge">АГРОСИСТЕМА</div>
        <div class="modal-title">Техника для операции</div>

        <div v-if="equipmentLoading" class="modal-text modal-text--loading">
          <UiLoadingBar size="md" />
        </div>
        <div v-else-if="equipmentError" class="modal-text modal-text-muted">{{ equipmentError }}</div>
        <div v-else>
          <div class="modal-form">
            <label class="modal-field">
              <span class="modal-label">Техника</span>
              <select v-model="selectedEquipmentId" class="modal-select">
                <option value="" disabled>Выберите технику</option>
                <option v-for="e in equipmentList" :key="e.id" :value="e.id">
                  {{ e.brand }} — {{ e.license_plate }} ({{ e.model ?? '—' }})
                </option>
              </select>
            </label>
          </div>

          <div class="equipment-sliders">
            <div class="equipment-slider-block">
              <div class="equipment-slider-row">
                <span class="equipment-slider-label">План работ</span>
                <span class="equipment-slider-value">
                  {{ startPlannedHectares != null ? `${formatHectares(startPlannedHectares)} Га` : '—' }}
                </span>
              </div>
              <input
                v-model.number="startPlannedHectares"
                type="range"
                min="0.1"
                :max="pendingFieldArea && pendingFieldArea > 0 ? pendingFieldArea : 0.1"
                step="0.1"
                class="equipment-range"
                :disabled="!(pendingFieldArea && pendingFieldArea > 0)"
              />
              <div class="equipment-condition-text">
                Доступно по полю: {{ pendingFieldArea && pendingFieldArea > 0 ? `${formatHectares(pendingFieldArea)} Га` : 'не задано' }}
              </div>
            </div>

            <div class="equipment-slider-block">
              <div class="equipment-slider-row">
                <span class="equipment-slider-label">Топливо</span>
                <span class="equipment-slider-value">{{ fuelPercent }}%</span>
              </div>
              <input
                v-model.number="fuelPercent"
                type="range"
                min="0"
                max="100"
                step="1"
                class="equipment-range"
              />
            </div>

            <div class="equipment-slider-block">
              <div class="equipment-slider-row">
                <span class="equipment-slider-label">Состояние техники</span>
                <span class="equipment-slider-value">{{ conditionPercent }}%</span>
              </div>
              <input
                v-model.number="conditionPercent"
                type="range"
                min="0"
                max="100"
                step="1"
                class="equipment-range"
              />
              <div class="equipment-condition-text">{{ equipmentConditionLabel }}</div>
            </div>

            <div v-if="equipmentConditionRequiresNotes" class="equipment-repair-notes">
              <label class="modal-field">
                <span class="modal-label">Что конкретно необходимо исправить</span>
                <textarea
                  v-model="equipmentRepairNotes"
                  class="modal-textarea"
                  rows="4"
                  placeholder="Например: заменить ремень, проверить гидравлику, подтянуть крепления…"
                />
              </label>
            </div>
          </div>
          <p v-if="startOperationPlanError" class="modal-text modal-hectares-error">
            {{ startOperationPlanError }}
          </p>
        </div>

        <div class="modal-actions modal-actions--two">
          <button type="button" class="modal-btn-ghost" @click="backFromEquipmentModalToChoice">
            Назад
          </button>
          <button
            type="button"
            class="modal-btn"
            :disabled="!selectedEquipmentId || equipmentLoading || (equipmentConditionRequiresNotes && !equipmentRepairNotes.trim())"
            @click="startOperationConfirmedWithEquipment"
          >
            Начать операцию
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="isStartedModalOpen"
      class="modal-backdrop"
      @click="isStartedModalOpen = false"
    >
      <div class="modal" @click.stop>
        <div class="modal-badge">АГРОСИСТЕМА</div>
        <div class="modal-title">Простой зафиксирован</div>
        <p class="modal-text">
          Начало простоя записано по объекту «{{ circleFieldLabel }}», операция: {{ circleTaskLabel }}.
          Данные учтены в системе.
        </p>
        <button class="modal-btn" type="button" @click="isStartedModalOpen = false">
          Понятно
        </button>
      </div>
    </div>

    <div
      v-if="finishNotesModalOpen"
      class="modal-backdrop"
      @click="closeFinishNotesModal"
    >
      <div class="modal" @click.stop>
        <div class="modal-badge">АГРОСИСТЕМА</div>
        <div class="modal-title-row">
          <div class="modal-title">
            {{ finishNotesType === 'downtime' ? 'Завершить простой' : 'Остановить операцию' }}
          </div>
          <ModalCloseButton aria-label="Закрыть без завершения" @click="closeFinishNotesModal" />
        </div>
        <p class="modal-text modal-text-muted">
          По желанию укажите список дел, которые были выполнены. Заметки сохранятся и будут видны в журнале работ и аналитике.
        </p>
        <div class="modal-form">
          <label class="modal-field">
            <span class="modal-label">Список дел (что сделано)</span>
            <textarea
              v-model="finishNotesText"
              class="modal-textarea"
              rows="4"
              placeholder="Например: Замена масла, проверка подшипников, дозаправка..."
            />
          </label>

          <div v-if="shouldAskEquipmentFuelLeft" class="equipment-sliders" style="margin-top: var(--space-md);">
            <div class="equipment-slider-block">
              <div class="equipment-slider-row">
                <span class="equipment-slider-label">Топливо осталось у техники</span>
                <span class="equipment-slider-value">{{ equipmentFuelLeftPercent }}%</span>
              </div>
              <input
                v-model.number="equipmentFuelLeftPercent"
                type="range"
                min="0"
                max="100"
                step="1"
                class="equipment-range"
              />
            </div>
          </div>
          <div v-if="shouldAskProcessedHectares" class="equipment-sliders" style="margin-top: var(--space-md);">
            <div class="equipment-slider-block">
              <div class="equipment-slider-row">
                <span class="equipment-slider-label">Сколько Га обработано</span>
                <span class="equipment-slider-value">{{ formatHectares(finishProcessedHectares) }} Га</span>
              </div>
              <input
                v-model.number="finishProcessedHectares"
                type="range"
                min="0"
                :max="finishProcessedHectaresMax"
                step="0.1"
                class="equipment-range"
              />
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="modal-btn" type="button" @click="confirmFinishNotes(finishNotesText)">
            Сохранить и завершить
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="isFinishedModalOpen"
      class="modal-backdrop"
      @click="isFinishedModalOpen = false"
    >
      <div class="modal" @click.stop>
        <div class="modal-badge">АГРОСИСТЕМА</div>
        <div class="modal-title">
          {{ isFinishedModalType === 'downtime' ? 'Простой завершён' : 'Операция завершена' }}
        </div>
        <p class="modal-text">
          Запись сохранена. Данные отображаются в разделе «Аналитика» и в журнале работ.
        </p>
        <button class="modal-btn" type="button" @click="isFinishedModalOpen = false">
          Закрыть
        </button>
      </div>
    </div>

    <div
      v-if="isAddFieldOpen"
      class="modal-backdrop"
      @click="isAddFieldOpen = false"
    >
      <div class="modal" @click.stop>
        <div class="modal-badge">АГРОСИСТЕМА</div>
        <div class="modal-title">Новое поле</div>
        <p class="modal-text modal-text-muted">
          Добавьте поле в список «Мои поля сегодня» для учёта работ и простоев.
        </p>
        <div class="modal-form">
          <label class="modal-field">
            <span class="modal-label">Название поля</span>
            <input
              v-model="newFieldName"
              type="text"
              placeholder="Например: Поле №15"
            />
          </label>
          <label class="modal-field">
            <span class="modal-label">Операция</span>
            <input
              v-model="newFieldOperation"
              type="text"
              placeholder="Например: Посев, Уборка, Опрыскивание"
            />
          </label>
        </div>
        <div class="modal-actions">
          <button class="modal-btn-ghost" type="button" @click="isAddFieldOpen = false">
            Отмена
          </button>
          <button class="modal-btn" type="button" @click="addField">
            Добавить
          </button>
        </div>
      </div>
    </div>

    <UiSuccessModal
      :open="successModalOpen"
      :title="successModalTitle"
      :message="successModalMessage"
      button-text="Хорошо"
      @close="successModalOpen = false"
    />
  </section>
</template>

<style scoped src="./MechanicPage.css"></style>

