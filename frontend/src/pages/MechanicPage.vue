<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, onActivated, watch } from 'vue'
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
  } catch {
    calendarTasksToday.value = calendarTasksToday.value.map((t, i) =>
      i === idx ? { ...t, completedAt: prev.completedAt } : t,
    )
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
    } catch {
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

<style scoped>
.mechanic-page {
  min-height: 100dvh;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background: var(--bg-base);
  background-image: var(--bg-body-image);
  color: var(--text-primary);
}

.mechanic-shell {
  flex: 1;
  width: 100%;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

.mechanic-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mechanic-badge {
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.mechanic-operator {
  margin-top: 4px;
  font-size: 1rem;
  font-weight: 500;
}

.mechanic-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-green);
  opacity: 0.25;
}

.status-dot-active {
  opacity: 1;
}

.mechanic-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-xl);
}

.operator-hero {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  box-shadow: var(--shadow-card);
  padding: var(--space-lg);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
  gap: var(--space-lg);
}

.operator-hero-sep {
  background: linear-gradient(to bottom, transparent, var(--border-color), transparent);
}

.operator-pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  color: var(--accent-green);
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.operator-title {
  margin: 10px 0 2px;
  font-size: 2rem;
  line-height: 1.05;
  font-weight: 900;
  color: var(--text-primary);
}

.operator-subtitle {
  margin: 0;
  font-size: 2rem;
  line-height: 1.05;
  font-weight: 900;
  color: var(--accent-green);
}

.operator-time-box {
  margin-top: var(--space-md);
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
}

.operator-time-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.operator-time-value {
  font-size: 2rem;
  line-height: 1;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.operator-notes {
  margin-top: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.operator-notes-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  font-weight: 800;
}

.operator-notes-input {
  width: 100%;
  min-height: 56px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
  padding: 10px;
  color: var(--text-primary);
  resize: vertical;
  font-family: inherit;
}

.operator-notes-save {
  align-self: flex-end;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--accent-green);
  background: var(--accent-green);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 800;
  padding: 0 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.operator-notes-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.operator-hero-right {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.operator-progress-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
}

.operator-progress-title {
  font-size: 0.95rem;
  font-weight: 700;
}

.operator-progress-meta {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.operator-progress-value {
  font-size: 2rem;
  line-height: 1;
  font-weight: 900;
  color: var(--accent-green);
}

.operator-progress-track {
  height: 12px;
  border-radius: 999px;
  background: var(--chip-bg);
  overflow: hidden;
}

.operator-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent-green) 80%, #fff) 0%, var(--accent-green) 100%);
  transition: width 0.3s ease;
}

.operator-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.operator-stat-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-base);
  padding: 12px;
}

.operator-stat-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  font-weight: 800;
}

.operator-stat-value {
  margin-top: 4px;
  font-size: 1.5rem;
  line-height: 1;
  font-weight: 900;
}

.operator-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: auto;
}

.operator-btn {
  position: relative;
  z-index: 0;
  overflow: visible;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.operator-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.operator-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  z-index: -1;
  transition: transform 0.4s ease, opacity 0.4s ease;
  background: var(--operator-btn-after-bg, var(--bg-panel));
}

.operator-btn:hover:not(:disabled) {
  transform: translateY(-3px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
}

.operator-btn:active:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 5px 10px rgba(0, 0, 0, 0.2);
}

.operator-btn:hover:not(:disabled)::after {
  transform: scaleX(1.4) scaleY(1.6);
  opacity: 0;
}

.operator-btn-danger {
  --operator-btn-after-bg: color-mix(in srgb, var(--danger-red) 20%, var(--bg-panel));
  background: color-mix(in srgb, var(--danger-red) 12%, transparent);
  border-color: color-mix(in srgb, var(--danger-red) 32%, transparent);
  color: var(--danger-red);
}

.operator-btn-warning {
  --operator-btn-after-bg: color-mix(in srgb, var(--warning-orange) 20%, var(--bg-panel));
  background: color-mix(in srgb, var(--warning-orange) 12%, transparent);
  border-color: color-mix(in srgb, var(--warning-orange) 32%, transparent);
  color: var(--warning-orange);
}

.operator-btn-success {
  --operator-btn-after-bg: color-mix(in srgb, var(--accent-green) 24%, var(--bg-panel));
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  border-color: color-mix(in srgb, var(--accent-green) 35%, transparent);
  color: var(--accent-green);
}

.operator-fields {
  position: relative;
  z-index: 35;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: var(--shadow-card);
  padding: var(--space-md);
}

.operator-fields-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.operator-fields-title {
  font-size: 0.9rem;
  font-weight: 800;
}

.operator-fields-hint {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.operator-fields-list {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
  scrollbar-width: thin;
}

.operator-fields-list .field-chip {
  flex: 0 0 auto;
}

.operator-fields-dropdown {
  position: relative;
}

.operator-fields-trigger {
  width: 100%;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
  border-radius: 12px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  column-gap: 10px;
  row-gap: 2px;
}

.operator-fields-trigger:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.operator-fields-trigger-main {
  grid-column: 1;
  grid-row: 1;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
}

.operator-fields-trigger-sub {
  grid-column: 1;
  grid-row: 2;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.operator-fields-trigger-chev {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  color: var(--text-secondary);
  display: inline-flex;
  transition: transform 0.2s ease;
}

.operator-fields-trigger-chev--open {
  transform: rotate(180deg);
}

.operator-fields-menu {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 8px);
  z-index: 60;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-panel);
  box-shadow: var(--shadow-card);
  max-height: min(280px, 45vh);
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.operator-fields-option {
  border: 1px solid transparent;
  background: var(--bg-base);
  border-radius: 10px;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.operator-fields-option:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.operator-fields-option:hover {
  border-color: var(--border-color);
}

.operator-fields-option-name {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--text-primary);
}

.operator-fields-option-op {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.operator-fields-option--active {
  border-color: color-mix(in srgb, var(--accent-green) 55%, transparent);
  background: color-mix(in srgb, var(--accent-green) 14%, transparent);
}

.operator-fields-option--add {
  color: var(--accent-green);
  font-weight: 700;
}

.mechanic-task-block {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: var(--space-lg);
  box-shadow: var(--shadow-card);
}

.mechanic-task-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.mechanic-task-timer {
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.mechanic-task-title {
  font-size: 1.4rem;
  font-weight: 600;
  margin: 0 0 var(--space-md);
  color: var(--text-primary);
}

.mechanic-task-progress-wrap {
  margin-bottom: var(--space-md);
}

.mechanic-task-progress-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.mechanic-task-progress-bar {
  height: 10px;
  border-radius: 999px;
  background: var(--chip-bg);
  overflow: hidden;
  margin-bottom: 6px;
}

.mechanic-task-progress-fill {
  height: 100%;
  background: var(--accent-green);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.mechanic-task-progress-text {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.mechanic-task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
}

.mechanic-operator-notes {
  margin-bottom: var(--space-md);
}

.mechanic-operator-notes-label {
  display: block;
  margin-bottom: 6px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-secondary);
}

.mechanic-operator-notes-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: end;
}

.mechanic-operator-notes-input {
  width: 100%;
  min-height: 64px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--chip-bg);
  color: var(--text-primary);
  font-family: inherit;
  resize: vertical;
}

.mechanic-operator-notes-save {
  height: 40px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--accent-green);
  background: var(--accent-green);
  color: #fff;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  cursor: pointer;
}

.mechanic-operator-notes-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.mechanic-fields-header--in-task {
  margin: var(--space-md) 0 var(--space-xs);
}

.mechanic-fields-chips--in-task {
  margin-bottom: var(--space-md);
}

.mechanic-today-tasks {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: var(--space-md) var(--space-lg);
  box-shadow: var(--shadow-card);
}

.mechanic-today-tasks-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.mechanic-today-tasks-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.mechanic-today-tasks-link {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--accent-green);
  text-decoration: none;
}

.mechanic-today-tasks-link:hover {
  text-decoration: underline;
}

.mechanic-today-tasks-loading {
  margin: 0;
  display: flex;
  justify-content: center;
  padding: 16px 0;
}

.mechanic-today-tasks-empty {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.mechanic-today-tasks-group {
  margin-bottom: 12px;
}

.mechanic-today-tasks-group:last-child {
  margin-bottom: 0;
}

.mechanic-today-tasks-group-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.mechanic-today-tasks-group-title--done {
  color: var(--text-secondary);
  opacity: 0.9;
}

.mechanic-today-tasks-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mechanic-today-task {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  font-size: 0.85rem;
  background: var(--bg-base);
}

.mechanic-today-task--done {
  background: var(--bg-panel);
  border-color: var(--border-color);
}

.mechanic-today-task-check {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--agro, #3d5c40);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mechanic-today-task-check:disabled {
  opacity: 0.6;
  cursor: wait;
}

.mechanic-today-task-check-empty {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-color);
  border-radius: 4px;
  display: block;
}

.mechanic-today-task-check:hover .mechanic-today-task-check-empty {
  border-color: var(--agro, #3d5c40);
}

.mechanic-today-task-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  min-width: 68px;
  font-size: 0.8rem;
}

.mechanic-today-task-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mechanic-today-task-priority {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: rgba(61, 92, 64, 0.12);
  color: var(--agro, #3d5c40);
}

.mechanic-today-task-priority--high {
  background: rgba(220, 38, 38, 0.1);
  color: #b91c1c;
}

.mechanic-today-task-priority--low {
  background: rgba(59, 130, 246, 0.08);
  color: #1d4ed8;
}

.mechanic-today-task-priority--muted {
  opacity: 0.85;
}

.mechanic-task-run-btn {
  border: 1px solid var(--accent-green);
  background: var(--accent-green);
  color: #fff;
  border-radius: 8px;
  height: 30px;
  padding: 0 10px;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  cursor: pointer;
}

.mechanic-task-run-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.mechanic-today-task--done .mechanic-today-task-title {
  text-decoration: line-through;
  color: var(--text-secondary);
}

.mechanic-today-task--done .mechanic-today-task-time {
  color: var(--text-secondary);
  opacity: 0.85;
}

.btn-operation {
  padding: 12px 20px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.2s ease, opacity 0.2s ease;
}

.btn-operation:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-operation-downtime {
  background: transparent;
  border: 2px solid var(--warning-orange);
  color: var(--warning-orange);
}

[data-theme="dark"] .btn-operation-downtime {
  color: var(--warning-orange);
  border-color: var(--warning-orange);
}

.btn-operation-downtime:hover:not(:disabled) {
  background: rgba(194, 65, 12, 0.1);
  transform: translateY(-1px);
}

.btn-operation-start {
  background: var(--accent-green);
  border-color: var(--accent-green);
  color: #fff;
}

[data-theme="dark"] .btn-operation-start {
  color: var(--text-primary);
}

.btn-operation-start:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -2px color-mix(in srgb, var(--accent-green) 42%, transparent);
}

.btn-operation-stop {
  background: transparent;
  border-color: var(--danger-red);
  color: var(--danger-red);
}

.btn-operation-stop:hover {
  transform: translateY(-1px);
  background: rgba(211, 60, 60, 0.08);
}

.btn-operation-pause {
  background: transparent;
  border-color: var(--warning-orange);
  color: var(--warning-orange);
}

.btn-operation-pause:hover:not(:disabled) {
  transform: translateY(-1px);
  background: rgba(194, 65, 12, 0.1);
}

.btn-operation-resume {
  background: var(--accent-green);
  border-color: var(--accent-green);
  color: #fff;
}

.btn-operation-resume:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -2px color-mix(in srgb, var(--accent-green) 42%, transparent);
}

.mechanic-cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-md);
}

.mechanic-dashboard-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--space-md);
}

.mechanic-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: var(--shadow-card);
  padding: var(--space-md);
}

.mechanic-panel-next {
  grid-column: span 4;
}

.mechanic-panel-middle {
  grid-column: span 4;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.mechanic-panel-journal {
  grid-column: span 4;
}

.mechanic-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: var(--space-sm);
}

.mechanic-panel-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
}

.mechanic-panel-link {
  font-size: 0.8rem;
  color: var(--accent-green);
  text-decoration: none;
}

.mechanic-next-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mechanic-next-item {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 10px;
  background: var(--bg-base);
}

.mechanic-next-item--clickable {
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.mechanic-next-item--clickable:hover {
  border-color: color-mix(in srgb, var(--accent-green) 45%, var(--border-color));
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
}

.mechanic-next-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.mechanic-next-title {
  margin-top: 4px;
  font-size: 0.92rem;
  font-weight: 700;
}

.mechanic-next-actions {
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.mechanic-calendar-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-color);
}

.mechanic-calendar-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}

.mechanic-calendar-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mechanic-calendar-item {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-base);
  padding: 8px 10px;
}

.mechanic-calendar-item--done {
  opacity: 0.92;
}

.mechanic-calendar-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-left: 42px;
  flex-wrap: wrap;
}

.mechanic-calendar-time {
  font-size: 0.76rem;
  color: var(--text-secondary);
}

.mechanic-calendar-saving {
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.checkbox-container {
  display: inline-block;
  user-select: none;
}

.task-checkbox {
  display: none;
}

.checkbox-label {
  display: flex;
  align-items: center;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 16px;
  color: var(--text-primary);
  font-weight: 500;
  transition: all 0.2s ease;
  padding: 8px;
  border-radius: 8px;
}

.checkbox-label:hover {
  background: color-mix(in srgb, var(--accent-green) 10%, transparent);
}

.checkbox-box {
  position: relative;
  width: 22px;
  height: 22px;
  border: 2px solid var(--border-color);
  border-radius: 6px;
  margin-right: 12px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  flex-shrink: 0;
}

.checkbox-fill {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent-green) 85%, #fff) 0%,
    var(--accent-green) 100%
  );
  transform: scale(0);
  transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  border-radius: 4px;
  opacity: 0;
}

.checkmark {
  position: relative;
  z-index: 2;
  opacity: 0;
  transform: scale(0.3) rotate(20deg);
  transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

.check-icon {
  width: 14px;
  height: 14px;
  fill: white;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
}

.success-ripple {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  background: color-mix(in srgb, var(--accent-green) 40%, transparent);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  opacity: 0;
  pointer-events: none;
}

.checkbox-text {
  transition: all 0.3s ease;
  font-size: 0.9rem;
  line-height: 1.25;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.checkbox-text::after {
  content: none;
}

.checkbox-label:hover .checkbox-box {
  border-color: var(--accent-green);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-green) 16%, transparent);
}

.task-checkbox:checked + .checkbox-label .checkbox-box {
  border-color: var(--accent-green);
  background: var(--accent-green);
  box-shadow:
    0 4px 12px color-mix(in srgb, var(--accent-green) 30%, transparent),
    0 0 0 2px color-mix(in srgb, var(--accent-green) 20%, transparent);
}

.task-checkbox:checked + .checkbox-label .checkbox-fill {
  transform: scale(1);
  opacity: 1;
}

.task-checkbox:checked + .checkbox-label .checkmark {
  opacity: 1;
  transform: scale(1) rotate(0deg);
  animation: checkPop 0.3s ease-out 0.2s;
}

.task-checkbox:checked + .checkbox-label .success-ripple {
  animation: rippleSuccess 0.6s ease-out;
}

.task-checkbox:checked + .checkbox-label .checkbox-text {
  color: var(--text-secondary);
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
  text-decoration-color: color-mix(in srgb, var(--text-secondary) 92%, transparent);
}

.task-checkbox:checked + .checkbox-label .checkbox-text::after {
  content: none;
}

.checkbox-label:active .checkbox-box {
  transform: scale(0.95);
}

@keyframes checkPop {
  0% {
    transform: scale(1) rotate(0deg);
  }
  50% {
    transform: scale(1.2) rotate(-5deg);
  }
  100% {
    transform: scale(1) rotate(0deg);
  }
}

@keyframes rippleSuccess {
  0% {
    width: 0;
    height: 0;
    opacity: 0.6;
  }
  70% {
    width: 50px;
    height: 50px;
    opacity: 0.3;
  }
  100% {
    width: 60px;
    height: 60px;
    opacity: 0;
  }
}

.mechanic-equipment-hero {
  border-radius: 12px;
  padding: 14px;
  color: #fff;
  background: linear-gradient(145deg, #1f2937 0%, #0f172a 100%);
}

.mechanic-equipment-hero-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.75;
}

.mechanic-equipment-hero-title {
  margin-top: 4px;
  font-size: 1rem;
  font-weight: 800;
}

.mechanic-equipment-hero-sub {
  margin-top: 4px;
  font-size: 0.85rem;
  opacity: 0.9;
}

.mechanic-equipment-hero-chip {
  margin-top: 10px;
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  font-size: 0.75rem;
  font-weight: 700;
}

.mechanic-equipment-empty {
  font-size: 0.85rem;
  color: var(--text-secondary);
  padding: 12px;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
}

.mechanic-dispatcher-card {
  border: 1px solid var(--border-color);
  border-radius: 22px;
  padding: 22px;
  background: var(--bg-panel);
  font-family: inherit;
  transition: border-color 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
}

[data-theme='dark'] .mechanic-dispatcher-card {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg-panel) 92%, #062318) 0%,
    color-mix(in srgb, var(--bg-panel) 88%, #03150f) 100%
  );
  border-color: color-mix(in srgb, var(--accent-green) 28%, var(--border-color));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--accent-green) 16%, transparent),
    0 8px 24px color-mix(in srgb, black 70%, transparent);
}

.mechanic-dispatcher-title {
  font-size: 1.95rem;
  font-weight: 800;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  line-height: 1.1;
  font-family: inherit;
  letter-spacing: 0;
}

.mechanic-dispatcher-title-icon {
  color: #f97316;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.mechanic-dispatcher-desc {
  margin: 0 0 14px;
  font-size: 0.95rem;
  color: var(--text-secondary);
  font-family: inherit;
  font-weight: 600;
  letter-spacing: 0;
}

.mechanic-dispatcher-textarea {
  width: 100%;
  min-height: 120px;
  resize: vertical;
  border: 1px solid var(--border-color);
  border-radius: 18px;
  padding: 16px;
  background: color-mix(in srgb, var(--bg-panel) 86%, var(--agri-bg));
  color: var(--text-primary);
  font-family: inherit;
  font-weight: 600;
  font-size: 1.05rem;
  line-height: 1.35;
  letter-spacing: 0;
}

.mechanic-dispatcher-textarea:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-green) 20%, transparent);
}

.mechanic-dispatcher-file-input {
  display: none;
}

.mechanic-dispatcher-file-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--accent-green) 10%, var(--bg-panel));
}

.mechanic-dispatcher-file-name {
  min-width: 0;
  flex: 1;
  font-size: 0.82rem;
  font-weight: 600;
  font-family: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mechanic-dispatcher-file-size {
  font-size: 0.72rem;
  color: var(--text-secondary);
  font-family: inherit;
}

.mechanic-dispatcher-file-remove {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.mechanic-dispatcher-actions {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 12px;
}

/* Перенесено из ChatPage: анимация кнопки вложения */
.mechanic-dispatcher-attach.action_has {
  --color: 220 9% 46%;
  --color-has: 146 33% 30%;
  --sz: 1.25rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64px;
  width: 72px;
  padding: 0.4rem 0.5rem;
  border-radius: 16px;
  border: 1px solid hsl(var(--color));
  flex-shrink: 0;
  background: color-mix(in srgb, var(--bg-panel) 90%, var(--agri-bg));
  color: hsl(var(--color));
  font-family: inherit;
}

[data-theme='dark'] .mechanic-dispatcher-attach.action_has {
  --color: 215 14% 70%;
  --color-has: 97 55% 52%;
}

.mechanic-dispatcher-attach.has_saved:hover:not(:disabled) {
  border-color: hsl(var(--color-has));
}

.mechanic-dispatcher-attach.has_saved:hover:not(:disabled) svg {
  color: hsl(var(--color-has));
}

.mechanic-dispatcher-attach.has_saved svg {
  overflow: visible;
  height: calc(var(--sz) * 1.75);
  width: calc(var(--sz) * 1.75);
  --ease: cubic-bezier(0.5, 0, 0.25, 1);
  --zoom-from: 1.75;
  --zoom-via: 0.75;
  --zoom-to: 1;
  --duration: 1s;
}

.mechanic-dispatcher-attach.has_saved:hover:not(:disabled) path[data-path='box'] {
  transition: all 0.3s var(--ease);
  animation: mechanic-attach-has-saved var(--duration) var(--ease) forwards;
  fill: hsl(var(--color-has) / 0.35);
}

.mechanic-dispatcher-attach.has_saved:hover:not(:disabled) path[data-path='line-top'] {
  animation: mechanic-attach-has-saved-line-top var(--duration) var(--ease) forwards;
}

.mechanic-dispatcher-attach.has_saved:hover:not(:disabled) path[data-path='line-bottom'] {
  animation:
    mechanic-attach-has-saved-line-bottom var(--duration) var(--ease) forwards,
    mechanic-attach-has-saved-line-bottom-2 calc(var(--duration) * 1) var(--ease) calc(var(--duration) * 0.75);
}

/* Мобильный tap-аналог hover-анимации */
.mechanic-dispatcher-attach.has_saved:active:not(:disabled) path[data-path='box'] {
  transition: all 0.2s var(--ease);
  animation: mechanic-attach-has-saved calc(var(--duration) * 0.75) var(--ease) forwards;
  fill: hsl(var(--color-has) / 0.35);
}

.mechanic-dispatcher-attach.has_saved:active:not(:disabled) path[data-path='line-top'] {
  animation: mechanic-attach-has-saved-line-top calc(var(--duration) * 0.75) var(--ease) forwards;
}

.mechanic-dispatcher-attach.has_saved:active:not(:disabled) path[data-path='line-bottom'] {
  animation:
    mechanic-attach-has-saved-line-bottom calc(var(--duration) * 0.75) var(--ease) forwards,
    mechanic-attach-has-saved-line-bottom-2 calc(var(--duration) * 0.75) var(--ease) calc(var(--duration) * 0.45);
}

@keyframes mechanic-attach-has-saved-line-top {
  33.333% { transform: rotate(0deg) translate(1px, 2px) scale(var(--zoom-from)); d: path('M 3 5 L 3 8 L 3 8'); }
  66.666% { transform: rotate(20deg) translate(2px, -2px) scale(var(--zoom-via)); }
  100% { transform: rotate(0deg) translate(0, 0) scale(var(--zoom-to)); d: path('M 3 5 L 3 8 L 15 8'); }
}

@keyframes mechanic-attach-has-saved-line-bottom {
  0%, 100% { d: path('M 17 20 L 17 13 L 7 13 L 7 20'); transform: rotate(0deg) translate(0, 0) scale(var(--zoom-to)); }
  33.333% { d: path('M 17 20 L 17 13 L 7 13 L 7 20'); transform: rotate(0deg) translate(1px, 2px) scale(var(--zoom-from)); }
  66.666% { transform: rotate(20deg) translate(2px, -2px) scale(var(--zoom-via)); }
}

@keyframes mechanic-attach-has-saved-line-bottom-2 {
  from { d: path('M 17 20 L 17 13 L 7 13 L 7 20'); }
  to { transform: rotate(0deg) translate(0, 0) scale(var(--zoom-to)); d: path('M 17 20 L 17 13 L 7 13 L 7 20'); fill: transparent; }
}

@keyframes mechanic-attach-has-saved {
  0%, 100% { transform: rotate(0deg) translate(0, 0) scale(var(--zoom-to)); }
  33.333% { transform: rotate(0deg) translate(1px, 2px) scale(var(--zoom-from)); }
  66.666% { transform: rotate(20deg) translate(2px, -2px) scale(var(--zoom-via)); }
}

.mechanic-dispatcher-send {
  border: none;
  user-select: none;
  font-size: 18px;
  font-family: inherit;
  color: #fff;
  text-align: center;
  background-color: #1f2a44;
  box-shadow: color-mix(in srgb, var(--border-color) 65%, #cacaca) 2px 2px 10px 1px;
  border-radius: 12px;
  height: 64px;
  line-height: 64px;
  width: 100%;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

.mechanic-dispatcher-send:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.mechanic-dispatcher-send-text {
  position: relative;
  z-index: 2;
  display: inline-block;
  font-weight: 700;
  font-family: inherit;
}

.mechanic-dispatcher-send-msg {
  height: 0;
  width: 0;
  border-radius: 2px;
  position: absolute;
  left: 15%;
  top: 25%;
  z-index: 1;
}

.mechanic-dispatcher-send:hover:not(:disabled) .mechanic-dispatcher-send-msg {
  animation: mechanic-dispatcher-msg-run 2s forwards;
}

/* На touch-устройствах запускаем анимацию и по нажатию */
.mechanic-dispatcher-send:active:not(:disabled) .mechanic-dispatcher-send-msg {
  animation: mechanic-dispatcher-msg-run 1.1s forwards;
}

.mechanic-dispatcher-send:active {
  transition: all 0.001s ease;
  background-color: #5d9fcd;
  box-shadow: color-mix(in srgb, var(--border-color) 65%, #97989a) 0 0 0 0;
  transform: translateX(1px) translateY(1px);
}

@keyframes mechanic-dispatcher-msg-run {
  0% {
    border-top: #d6d6d9 0 solid;
    border-bottom: #f2f2f5 0 solid;
    border-left: #f2f2f5 0 solid;
    border-right: #f2f2f5 0 solid;
  }
  20% {
    border-top: #d6d6d9 14px solid;
    border-bottom: #f2f2f5 14px solid;
    border-left: #f2f2f5 20px solid;
    border-right: #f2f2f5 20px solid;
  }
  25% {
    border-top: #d6d6d9 12px solid;
    border-bottom: #f2f2f5 12px solid;
    border-left: #f2f2f5 18px solid;
    border-right: #f2f2f5 18px solid;
  }
  80% {
    border-top: transparent 12px solid;
    border-bottom: transparent 12px solid;
    border-left: transparent 18px solid;
    border-right: transparent 18px solid;
  }
  100% {
    transform: translateX(150px);
    border-top: transparent 12px solid;
    border-bottom: transparent 12px solid;
    border-left: transparent 18px solid;
    border-right: transparent 18px solid;
  }
}

.mechanic-dispatcher-error,
.mechanic-dispatcher-success {
  margin: 8px 2px 0;
  font-size: 0.76rem;
  font-weight: 600;
  font-family: inherit;
}

@media (max-width: 640px) {
  .mechanic-dispatcher-card {
    border-radius: 16px;
    padding: 14px;
  }
  .mechanic-dispatcher-title {
    font-size: 1.15rem;
    margin-bottom: 10px;
  }
  .mechanic-dispatcher-desc {
    font-size: 0.84rem;
    margin-bottom: 10px;
  }
  .mechanic-dispatcher-textarea {
    min-height: 88px;
    font-size: 0.95rem;
    border-radius: 14px;
    padding: 12px;
  }
  .mechanic-dispatcher-file-pill {
    padding: 7px 9px;
    border-radius: 10px;
    gap: 6px;
  }
  .mechanic-dispatcher-file-name {
    max-width: 58vw;
    font-size: 0.8rem;
  }
  .mechanic-dispatcher-actions {
    grid-template-columns: 52px 1fr;
    gap: 8px;
  }
  .mechanic-dispatcher-attach.action_has {
    height: 48px;
    width: 52px;
    border-radius: 12px;
  }
  .mechanic-dispatcher-send {
    height: 48px;
    border-radius: 12px;
    font-size: 0.86rem;
    box-shadow: 0 6px 18px color-mix(in srgb, #1f2a44 44%, transparent);
  }
  .mechanic-dispatcher-send-text {
    letter-spacing: 0.02em;
  }
  .mechanic-dispatcher-send-msg {
    left: 12%;
  }
}

.mechanic-dispatcher-error {
  color: var(--danger-red);
}

.mechanic-dispatcher-success {
  color: var(--accent-green);
}

.mechanic-dispatcher-btn {
  width: 100%;
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-weight: 700;
  cursor: pointer;
}

.mechanic-dispatcher-wip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  background: var(--bg-panel);
}

.mechanic-wip-loader {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
}

.mechanic-wip-loader path {
  stroke: currentColor;
  stroke-width: 0.75px;
  fill: none;
  animation:
    mechanic-wip-dash-array 4s ease-in-out infinite,
    mechanic-wip-dash-offset 4s linear infinite;
}

.mechanic-dispatcher-wip-text {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.03em;
}

@keyframes mechanic-wip-dash-array {
  0% {
    stroke-dasharray: 0 1 359 0;
  }
  50% {
    stroke-dasharray: 0 359 1 0;
  }
  100% {
    stroke-dasharray: 359 1 0 0;
  }
}

@keyframes mechanic-wip-dash-offset {
  0% {
    stroke-dashoffset: 365;
  }
  100% {
    stroke-dashoffset: 5;
  }
}

.mechanic-journal-list {
  list-style: none;
  margin: 0;
  padding: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 360px;
  overflow: auto;
}

.mechanic-journal-empty {
  font-size: 0.82rem;
  color: var(--text-secondary);
  padding: 8px 2px;
}

.mechanic-journal-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.mechanic-journal-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 6px;
  background: #cbd5e1;
  flex-shrink: 0;
}

.mechanic-journal-dot--active {
  background: #22c55e;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.2);
}

.mechanic-journal-time {
  font-size: 0.72rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.mechanic-journal-title {
  font-size: 0.88rem;
  font-weight: 700;
  margin-top: 2px;
}

.mechanic-journal-sub {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.mechanic-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  box-shadow: var(--shadow-card);
}

.mechanic-card-weather {
  background: var(--mechanic-weather-card-bg);
  border-color: var(--mechanic-weather-card-border);
}

.mechanic-card-weather .mechanic-card-title {
  color: var(--mechanic-weather-card-text);
}

.mechanic-card-weather :deep(.weather-widget-compact) {
  background: transparent;
  border-color: var(--mechanic-weather-card-border);
  margin-bottom: 0;
}

.mechanic-card-weather :deep(.weather-compact-city),
.mechanic-card-weather :deep(.weather-compact-temp) {
  color: var(--mechanic-weather-card-text);
}

.mechanic-card-weather :deep(.weather-compact-desc),
.mechanic-card-weather :deep(.weather-compact-feels),
.mechanic-card-weather :deep(.weather-compact-meta span) {
  color: var(--mechanic-weather-card-text-muted);
}

.mechanic-card-weather :deep(.type-action) {
  color: var(--accent-green);
}

.mechanic-card-weather :deep(.type-action:hover) {
  color: var(--accent-green-hover);
}

.mechanic-card-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.mechanic-card-subtitle {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.mechanic-card-badge {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  padding: 4px 8px;
  background: var(--chip-bg);
  border-radius: 6px;
}

[data-theme="light"] .mechanic-card-badge {
  color: #374151;
  background: rgba(0, 0, 0, 0.08);
}

.mechanic-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
}

.mechanic-card-link {
  background: none;
  border: none;
  color: var(--accent-green);
  font-size: 0.8rem;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

[data-theme="light"] .mechanic-card-link {
  color: #1f402a;
  font-weight: 600;
}

.mechanic-equipment-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
}

.mechanic-equipment-label {
  color: var(--text-secondary);
}

.mechanic-equipment-value {
  font-weight: 600;
  color: var(--text-primary);
}

.mechanic-progress-bar {
  height: 8px;
  border-radius: 999px;
  background: var(--chip-bg);
  overflow: hidden;
}

.mechanic-progress-bar-green .mechanic-progress-fill {
  background: var(--accent-green);
}

.mechanic-progress-bar-yellow .mechanic-progress-fill {
  background: var(--warning-orange);
}

.mechanic-progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}

.mechanic-equipment-ok {
  font-size: 0.8rem;
  color: var(--accent-green);
  font-weight: 600;
}

.mechanic-queue-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.mechanic-queue-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  background: var(--chip-bg);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.15s ease;
}

.mechanic-queue-item:hover {
  border-color: var(--accent-green);
  transform: translateY(-1px);
}

.mechanic-queue-name {
  font-weight: 600;
}

.mechanic-queue-op {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.mechanic-queue-add {
  margin-top: 4px;
  padding: 8px 0;
  background: none;
  border: none;
  color: var(--accent-green);
  font-size: 0.85rem;
  cursor: pointer;
  text-align: left;
}

[data-theme="light"] .mechanic-queue-add {
  color: #1f402a;
  font-weight: 600;
}

.mechanic-weather-permit {
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--mechanic-weather-permit-bg);
  border-radius: 8px;
  font-size: 0.8rem;
  color: var(--mechanic-weather-card-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.mechanic-fields-compact {
  margin-top: 0;
}

.mechanic-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.mechanic-fields-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-sm);
}

.mechanic-fields-hint {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.mechanic-fields-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.field-chip {
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--chip-bg);
  color: var(--text-secondary);
  font-size: 0.8rem;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease,
    transform 0.15s ease,
    box-shadow 0.2s ease;
}

.field-chip:hover {
  transform: translateY(-2px);
  border-color: var(--accent-green);
}

.field-chip-name {
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.field-chip-op {
  color: var(--text-secondary);
}

.field-chip-active .field-chip-op {
  color: inherit;
  opacity: 0.9;
}

.field-chip-active {
  border-color: var(--accent-green);
  background: var(--accent-green);
  color: #fff;
  transform: translateY(-2px);
  box-shadow: 0 2px 8px -2px color-mix(in srgb, var(--accent-green) 42%, transparent);
}

[data-theme="dark"] .field-chip-active {
  color: #000;
}

.field-chip-add {
  border-style: dashed;
  opacity: 0.9;
  color: var(--accent-green);
}

[data-theme="light"] .field-chip-add {
  color: #1f402a;
  font-weight: 600;
}

.mechanic-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.btn-main,
.btn-stop {
  padding: 14px 18px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 600;
  cursor: pointer;
}

.btn-main {
  background: var(--accent-green);
  border-color: var(--accent-green);
  color: #000;
  transition: transform 0.15s ease, box-shadow 0.2s ease;
}

.btn-main:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -2px color-mix(in srgb, var(--accent-green) 42%, transparent);
}

.btn-stop {
  background: transparent;
  border-color: var(--danger-red);
  color: var(--danger-red);
  transition: transform 0.15s ease, background 0.2s ease;
}

.btn-stop:hover {
  transform: translateY(-1px);
  background: rgba(211, 60, 60, 0.08);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 120;
  animation: mechanicFadeIn 0.2s ease;
}

[data-theme='dark'] .modal-backdrop {
  background: var(--modal-backdrop);
}

.modal {
  width: min(100vw - 48px, 360px);
  background: var(--bg-panel);
  border-radius: 16px;
  border: 1px solid var(--border-color);
  padding: var(--space-lg);
  box-shadow: var(--shadow-card);
  animation: mechanicModalIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  max-height: min(88vh, 760px);
  overflow-y: auto;
}

[data-theme='dark'] .modal {
  background: var(--bg-elevated);
  border-color: var(--border-color);
}

@keyframes mechanicFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes mechanicModalIn {
  from { opacity: 0; transform: scale(0.96) translateY(-10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-badge {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--accent-green);
  margin-bottom: 6px;
}

.modal-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.modal-title {
  font-size: 1.15rem;
  font-weight: 500;
  margin-bottom: 8px;
}

/* .modal-close-btn styles are in global.css */

.modal-text {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: var(--space-md);
  line-height: 1.45;
}

.modal-text--loading {
  display: flex;
  justify-content: center;
  padding: 12px 0 20px;
}

.modal-text-muted {
  margin-bottom: var(--space-sm);
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}

.modal-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-secondary);
}

.modal-field input {
  padding: 8px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--chip-bg);
  color: var(--text-primary);
  font-size: 0.85rem;
}

.modal-field input::placeholder {
  color: var(--text-secondary);
}

.modal-textarea {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--chip-bg);
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: inherit;
  resize: vertical;
  min-height: 80px;
}

.modal-textarea::placeholder {
  color: var(--text-secondary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}

.modal-actions--two {
  justify-content: space-between;
}

.modal-actions--two .modal-btn,
.modal-actions--two .modal-btn-ghost {
  flex: 1;
  text-align: center;
}

.modal-select {
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--chip-bg);
  color: var(--text-primary);
  font-size: 0.9rem;
}

.modal-select:focus {
  outline: none;
  border-color: var(--accent-green);
}

.modal-hectares-error {
  margin-top: -2px;
  margin-bottom: 0;
  color: var(--danger-red);
}

.modal--issue-recipients {
  width: min(100vw - 48px, 620px);
}

.modal-form--issue-filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}

.modal-form--issue-filters .modal-select,
.modal-form--issue-filters .modal-input {
  min-height: 44px;
  height: 44px;
  box-sizing: border-box;
  font-size: 0.95rem;
  font-weight: 600;
}

.modal-form--issue-filters .modal-input {
  padding: 0 14px;
}

.modal-form--issue-filters .modal-select {
  padding: 0 12px;
  border-radius: 999px;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23697586' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 38px;
}

.modal-form--issue-filters .modal-select:focus,
.modal-form--issue-filters .modal-input:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-green) 24%, transparent);
}

.modal-issue-recipient-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: var(--space-md);
  max-height: min(42vh, 320px);
  overflow-y: auto;
  padding-right: 2px;
}

.modal-issue-recipient-item {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 10px;
  row-gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--chip-bg);
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, transform 0.2s ease;
}

.modal-issue-recipient-item:hover {
  border-color: color-mix(in srgb, var(--accent-green) 45%, var(--border-color));
  background: color-mix(in srgb, var(--chip-bg) 88%, var(--accent-green));
  transform: translateY(-1px);
}

.modal-issue-checkbox-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

.modal-issue-checkbox-mark {
  position: relative;
  top: 0;
  left: 0;
  width: 1.3em;
  height: 1.3em;
  margin-top: 2px;
  border-radius: 0.32em;
  background-color: transparent;
  transition: all 0.25s ease;
  border: 1px solid color-mix(in srgb, var(--border-color) 78%, var(--text-secondary));
}

.modal-issue-checkbox-mark::after {
  content: '';
  position: absolute;
  transform: rotate(0deg);
  border: 0.1em solid var(--text-secondary);
  left: 0.08em;
  top: 0.08em;
  width: 1em;
  height: 1em;
  border-radius: 0.25em;
  transition: all 0.25s ease, border-width 0.1s ease;
}

.modal-issue-checkbox-input:checked + .modal-issue-checkbox-mark {
  background-color: var(--accent-green);
  border-color: var(--accent-green);
}

.modal-issue-checkbox-input:checked + .modal-issue-checkbox-mark::after {
  left: 0.45em;
  top: 0.24em;
  width: 0.25em;
  height: 0.5em;
  border-color: transparent #fff #fff transparent;
  border-width: 0 0.15em 0.15em 0;
  border-radius: 0;
  transform: rotate(45deg);
}

.modal-issue-checkbox-input:focus-visible + .modal-issue-checkbox-mark {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-green) 28%, transparent);
}

.modal-issue-recipient-item--selected {
  border-color: var(--accent-green);
  background: color-mix(in srgb, var(--chip-bg) 74%, var(--accent-green));
}

.modal-issue-recipient-main {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--text-primary);
}

.modal-issue-recipient-meta {
  grid-column: 2;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.modal-issue-selected {
  margin: 0 0 var(--space-sm);
  font-size: 0.82rem;
  color: color-mix(in srgb, var(--text-secondary) 78%, var(--accent-green));
}

.modal-issue-submit {
  height: 52px;
  line-height: 52px;
  border-radius: 999px;
  font-size: 15px;
  flex: 1;
}

.modal-actions--two .modal-btn-ghost {
  min-height: 52px;
  font-size: 0.9rem;
  font-weight: 600;
}

.equipment-sliders {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}

.equipment-slider-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.equipment-slider-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.equipment-slider-label {
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.equipment-slider-value {
  font-size: 0.9rem;
  font-weight: 800;
  color: var(--text-primary);
}

.equipment-condition-text {
  font-size: 0.9rem;
  font-weight: 650;
  color: var(--text-primary);
  margin-top: -6px;
}

.equipment-range {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: var(--chip-bg);
  outline: none;
  -webkit-appearance: none;
}

.equipment-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent-green);
  border: 2px solid var(--bg-panel);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  cursor: pointer;
}

.equipment-range::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent-green);
  border: 2px solid var(--bg-panel);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  cursor: pointer;
}

.equipment-repair-notes {
  margin-top: var(--space-sm);
}

.modal-btn,
.modal-btn-ghost {
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  cursor: pointer;
}

.modal-btn {
  background: var(--accent-green);
  border-color: var(--accent-green);
  color: #fff;
}

.modal-btn-ghost {
  background: transparent;
  color: var(--text-secondary);
}

.sheet-backdrop {
  position: fixed;
  inset: 0;
  background: var(--modal-backdrop);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
  z-index: 100;
}

.sheet-backdrop-open {
  opacity: 1;
  pointer-events: auto;
}

.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-color);
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  padding: var(--space-md) var(--space-lg) calc(var(--space-lg) + env(safe-area-inset-bottom, 0));
  z-index: 110;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15);
  max-height: min(84vh, 760px);
  overflow-y: auto;
}

.sheet-open {
  transform: translateY(0);
}

.sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-md);
}

.sheet-label {
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.sheet-title {
  margin-top: 4px;
  font-size: 1.1rem;
}

.sheet-close {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.sheet-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.sheet-item {
  border-bottom: 1px dashed var(--border-color);
}

.sheet-item:last-child {
  border-bottom: none;
}

.sheet-button {
  width: 100%;
  padding: 14px 0;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
}

.sheet-button-title {
  font-size: 1rem;
}

.sheet-button-desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.sheet-empty {
  padding: var(--space-md) var(--space-lg);
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

@media (max-width: 900px) {
  .mechanic-cards {
    grid-template-columns: 1fr;
  }

  .mechanic-dashboard-grid {
    grid-template-columns: 1fr;
  }

  .mechanic-panel-next,
  .mechanic-panel-middle,
  .mechanic-panel-journal {
    grid-column: span 1;
  }
}

@media (max-width: 768px) {
  .mechanic-shell { gap: var(--space-lg); }

  .mechanic-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .mechanic-status {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-panel);
  }

  .mechanic-task-block {
    padding: var(--space-md);
  }

  .operator-hero {
    grid-template-columns: 1fr;
    gap: var(--space-md);
  }

  .operator-hero-sep {
    display: none;
  }

  .operator-title,
  .operator-subtitle {
    font-size: 1.4rem;
  }

  .operator-time-value {
    font-size: 1.5rem;
  }

  .operator-actions {
    grid-template-columns: 1fr;
  }

  .operator-btn {
    min-height: 46px;
    font-size: 0.74rem;
    letter-spacing: 0.06em;
  }

  .mechanic-panel {
    padding: var(--space-sm);
    border-radius: 14px;
  }

  .mechanic-panel-title {
    font-size: 0.95rem;
  }

  .operator-fields-list {
    gap: 6px;
  }

  .mechanic-task-title {
    font-size: 1.1rem;
  }

  .mechanic-task-actions {
    flex-direction: column;
  }

  .mechanic-operator-notes-row {
    grid-template-columns: 1fr;
  }

  .mechanic-operator-notes-save {
    width: 100%;
  }

  .btn-operation {
    width: 100%;
    text-align: center;
  }

  .mechanic-today-tasks {
    padding: var(--space-md);
  }

  .mechanic-cards {
    grid-template-columns: 1fr;
  }

  .mechanic-fields-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .mechanic-fields-chips {
    gap: 8px;
  }

  .field-chip {
    width: 100%;
    justify-content: space-between;
  }

  .operator-fields-list .field-chip {
    width: auto;
    justify-content: flex-start;
  }
}

@media (max-width: 480px) {
  .mechanic-shell { padding: 0; }

  .mechanic-task-block {
    padding: var(--space-md);
  }

  .mechanic-task-timer {
    font-size: 1.3rem;
  }

  .mechanic-task-title {
    font-size: 1rem;
  }

  .operator-stats {
    grid-template-columns: 1fr;
  }

  .mechanic-today-task {
    flex-wrap: wrap;
  }

  .mechanic-today-task-time {
    min-width: 56px;
  }

  .mechanic-card {
    padding: var(--space-sm) var(--space-md);
  }

  .mechanic-fields-chips {
    flex-direction: column;
  }

  .field-chip {
    border-radius: 10px;
  }

  .operator-fields-list {
    flex-direction: row;
  }

  .modal {
    width: min(100vw - 32px, 360px);
    padding: var(--space-md);
    max-height: 86vh;
  }

  .mechanic-panel {
    border-radius: 12px;
  }

  .mechanic-dispatcher-card {
    padding: 12px;
    border-radius: 14px;
  }

  .mechanic-dispatcher-title {
    font-size: 1.02rem;
  }

  .mechanic-dispatcher-desc {
    font-size: 0.8rem;
    line-height: 1.3;
  }

  .mechanic-dispatcher-textarea {
    min-height: 82px;
    border-radius: 12px;
    padding: 10px 11px;
    font-size: 0.9rem;
  }

  .mechanic-dispatcher-attach.action_has {
    width: 48px;
    height: 46px;
  }

  .mechanic-dispatcher-send {
    height: 46px;
    line-height: 46px;
  }

  .modal--issue-recipients {
    width: min(100vw - 12px, 620px);
    padding: 12px;
    border-radius: 12px;
  }

  .modal--issue-recipients .modal-title {
    font-size: 0.95rem;
  }

  .modal--issue-recipients .modal-text {
    font-size: 0.78rem;
  }

  .modal-issue-recipient-list {
    max-height: 36vh;
  }

  .modal-actions {
    flex-direction: column;
  }

  .modal-btn,
  .modal-btn-ghost {
    width: 100%;
    justify-content: center;
  }
}

@media (max-width: 640px) {
  .mechanic-shell { gap: var(--space-md); }

  .modal-form--issue-filters {
    grid-template-columns: 1fr;
  }

  .modal--issue-recipients {
    width: min(100vw - 18px, 620px);
    padding: var(--space-md);
    border-radius: 14px;
    max-height: 90vh;
  }

  .modal--issue-recipients .modal-title {
    font-size: 1rem;
    margin-bottom: 6px;
  }

  .modal--issue-recipients .modal-text {
    font-size: 0.82rem;
    margin-bottom: 10px;
  }

  .modal-issue-recipient-list {
    max-height: 34vh;
    gap: 6px;
  }

  .modal-issue-recipient-item {
    padding: 8px 10px;
    border-radius: 9px;
    column-gap: 8px;
  }

  .modal-issue-recipient-main {
    font-size: 0.84rem;
  }

  .modal-issue-recipient-meta {
    font-size: 0.72rem;
  }

  .modal-issue-submit,
  .modal-actions--two .modal-btn-ghost {
    min-height: 46px;
    height: 46px;
    line-height: 46px;
    font-size: 0.8rem;
    letter-spacing: 0.08em;
  }

  .operator-hero {
    padding: var(--space-md);
    border-radius: 16px;
  }

  .operator-time-box,
  .operator-stat-card {
    padding: 10px 12px;
  }

  .operator-time-value,
  .operator-progress-value {
    font-size: 1.35rem;
  }

  .operator-fields {
    padding: 10px;
  }

  .operator-fields-menu {
    top: calc(100% + 6px);
    border-radius: 10px;
    padding: 4px;
    max-height: 40vh;
  }

  .mechanic-dashboard-grid {
    gap: var(--space-sm);
  }

  .mechanic-next-item {
    padding: 8px;
  }

  .mechanic-calendar-meta {
    padding-left: 0;
  }

  .checkbox-label {
    padding: 6px;
  }

  .checkbox-box {
    width: 20px;
    height: 20px;
    margin-right: 10px;
  }

  .sheet {
    border-top-left-radius: 14px;
    border-top-right-radius: 14px;
    padding: var(--space-sm) var(--space-md) calc(var(--space-md) + env(safe-area-inset-bottom, 0));
    max-height: 82vh;
  }

  .sheet-button {
    padding: 12px 0;
  }

  .modal-backdrop {
    padding: 8px;
  }

  .modal {
    width: min(100vw - 16px, 520px);
    border-radius: 14px;
  }
}

@media (min-width: 768px) {
  .mechanic-shell { padding-inline: 0; }
}
</style>

