<script setup lang="ts">
import { Button } from '@/components/ui/shadcn/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/shadcn/dropdown-menu'
import { Checkbox } from '@/components/ui/shadcn/checkbox'
import { CheckIcon, ChevronDownIcon, CirclePauseIcon, PaperclipIcon, PlayIcon, PlusIcon, SendIcon, SquareIcon, XIcon } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Input } from '@/components/ui/shadcn/input'
import { Textarea } from '@/components/ui/shadcn/textarea'
import { NativeSelect, NativeSelectOption } from '@/components/ui/shadcn/native-select'
import { Progress } from '@/components/ui/shadcn/progress'
import { Separator } from '@/components/ui/shadcn/separator'
import FormGrid from '@/components/ui/layout/FormGrid.vue'
import FormField from '@/components/ui/layout/FormField.vue'
import UiBadge, { type UiBadgeTone } from '@/components/ui/UiBadge.vue'
import PickSheet from '@/components/ui/dialogs/PickSheet.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
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

// Список полей — DropdownMenu shadcn: закрытие по клику мимо делает он сам.
// Прежний обработчик закрывал меню на pointerdown раньше, чем срабатывал выбор
// пункта (меню отрисовано вне обёртки), поэтому теперь он ничего не делает.
function onGlobalPointerDown(_e: MouseEvent) {}

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

function priorityTone(priority: string): UiBadgeTone {
  return priority === 'high' ? 'danger' : priority === 'low' ? 'neutral' : 'warning'
}

/** Должность, а без неё — роль по-русски (в базе роли хранятся как manager / worker). */
function employeeRoleLabel(row: EmployeeRow): string {
  if (row.position?.trim()) return row.position.trim()
  if (row.role === 'manager') return 'Руководитель'
  if (row.role === 'worker') return 'Сотрудник'
  return 'Сотрудник'
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
  <section class="mechanic-page tw-scope flex min-w-0 flex-col gap-6">
    <Alert v-if="loadError" variant="destructive">
      <AlertDescription>{{ loadError }}</AlertDescription>
    </Alert>

    <!-- Текущая работа -->
    <section class="grid gap-6 rounded-xl border bg-card p-4 shadow-xs md:p-6 lg:grid-cols-2 lg:gap-8">
      <div class="flex min-w-0 flex-col gap-4">
        <div class="grid gap-1">
          <span class="text-xs text-muted-foreground">Текущая задача</span>
          <h2 class="text-2xl leading-tight font-semibold">{{ circleFieldLabel }}</h2>
          <p class="text-base font-medium text-primary dark:text-ring">{{ circleTaskLabel }}</p>
        </div>

        <div class="rounded-lg bg-muted/60 p-4">
          <div class="text-xs text-muted-foreground">Время в работе</div>
          <div class="mt-1 text-3xl font-semibold tabular-nums">{{ timerStartISO ? timerLabel : '00:00:00' }}</div>
        </div>

        <div class="grid gap-2">
          <span class="text-sm font-medium">Заметки оператора</span>
          <p class="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground" role="status">В разработке</p>
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-4 lg:border-l lg:pl-8">
        <div class="flex items-start justify-between gap-4">
          <div class="grid gap-1">
            <span class="text-sm font-medium">Прогресс выполнения</span>
            <span v-if="activeOperation?.plannedHectares && progressTotal > 0" class="text-xs text-muted-foreground">
              Обработано {{ formatHectares(progressDone) }} из {{ formatHectares(activeOperation.plannedHectares) }} га
            </span>
            <span v-else-if="progressTotal > 0" class="text-xs text-muted-foreground">Площадь поля: {{ formatHectares(progressTotal) }} га</span>
            <span v-else class="text-xs text-muted-foreground">Укажите площадь в карточке поля для расчёта плана.</span>
          </div>
          <span class="text-3xl font-semibold text-primary tabular-nums dark:text-ring">{{ progressPercent }}%</span>
        </div>
        <Progress :model-value="progressPercent" class="h-2" aria-label="Прогресс выполнения" />

        <div class="w-fit min-w-36 rounded-lg border p-3">
          <div class="text-xs text-muted-foreground">Топливо</div>
          <div class="mt-1 text-xl font-semibold tabular-nums">{{ activeOperation?.equipmentFuelPercent ?? '—' }}%</div>
        </div>

        <div class="mt-auto grid gap-2 sm:grid-cols-2">
          <template v-if="!active && !workStartedAt">
            <Button
              variant="outline"
              size="lg"
              type="button"
              class="h-12 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              :disabled="!currentField"
              @click="isReasonsOpen = true"
            >
              <CirclePauseIcon />
              Начать простой
            </Button>
            <Button size="lg" type="button" class="h-12" :disabled="!workOperationsList.length && !fields.length" @click="isOperationsOpen = true">
              <PlayIcon />
              Начать операцию
            </Button>
          </template>
          <template v-else-if="!active && workStartedAt">
            <Button
              v-if="!isOperationPaused"
              variant="outline"
              size="lg"
              type="button"
              class="h-12"
              @click="pauseOperation"
            >
              <CirclePauseIcon />
              Пауза / простой
            </Button>
            <Button v-else size="lg" type="button" class="h-12" @click="resumeOperation">
              <PlayIcon />
              Продолжить
            </Button>
            <Button
              variant="outline"
              size="lg"
              type="button"
              class="h-12 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              @click="openFinishNotesModal('operation')"
            >
              <SquareIcon />
              Завершить операцию
            </Button>
          </template>
          <Button v-else size="lg" type="button" class="h-12 sm:col-span-2" @click="openFinishNotesModal('downtime')">
            <SquareIcon />
            Завершить простой
          </Button>
        </div>
      </div>
    </section>

    <!-- Выбор поля -->
    <section class="grid gap-2">
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-sm font-medium">Поле</span>
        <span v-if="isFieldLocked" class="text-xs text-muted-foreground">Поле меняется после завершения работы</span>
      </div>
      <div ref="fieldsDropdownRef">
        <DropdownMenu v-model:open="isFieldsOpen">
          <DropdownMenuTrigger as-child :disabled="isFieldLocked">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-xs outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="isFieldLocked"
            >
              <span class="grid min-w-0 flex-1">
                <span class="truncate text-sm font-medium">{{ currentField?.name ?? 'Выберите поле' }}</span>
                <span class="truncate text-xs text-muted-foreground">{{ currentField?.operation ?? 'Операция не выбрана' }}</span>
              </span>
              <ChevronDownIcon class="size-4 shrink-0 text-muted-foreground transition-transform" :class="{ 'rotate-180': isFieldsOpen }" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="max-h-80 w-(--reka-dropdown-menu-trigger-width) overflow-y-auto">
            <DropdownMenuItem
              v-for="field in dropdownFields"
              :key="field.id"
              :disabled="isFieldLocked"
              class="items-start py-2"
              @select="pickField(field.id)"
            >
              <span class="grid min-w-0 flex-1">
                <span class="truncate font-medium">{{ field.name }}</span>
                <span class="truncate text-xs text-muted-foreground">{{ field.operation }}</span>
              </span>
              <CheckIcon v-if="currentField?.id === field.id" class="mt-0.5 size-4 shrink-0 text-primary" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="openAddField">
              <PlusIcon />
              Добавить поле
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>

    <section class="grid items-start gap-6 lg:grid-cols-3">
      <!-- Задачи -->
      <article class="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-base font-semibold">Следующая задача</h3>
          <router-link to="/task-management" class="text-sm font-medium text-primary no-underline hover:underline dark:text-ring">Все задачи</router-link>
        </div>
        <UiLoadingBar v-if="userTasksLoading" size="compact" />
        <ul v-else-if="nextUserTasks.length" class="grid gap-2">
          <li
            v-for="t in nextUserTasks"
            :key="t.id"
            class="grid cursor-pointer gap-2 rounded-lg border p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            role="button"
            tabindex="0"
            @click="openTaskInTaskManagement(t)"
            @keydown.enter="openTaskInTaskManagement(t)"
          >
            <div class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span class="tabular-nums">#{{ t.number }}</span>
              <span class="truncate">{{ t.field }}</span>
            </div>
            <div class="text-sm font-medium">{{ t.title }}</div>
            <div class="flex items-center justify-between gap-2">
              <UiBadge :tone="priorityTone(t.priority)">{{ priorityLabel(t.priority) }}</UiBadge>
              <Button size="sm" type="button" :disabled="!!workStartedAt || !!active" @click.stop="startOperationByTask(t)">
                <PlayIcon />
                В работу
              </Button>
            </div>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">Нет активных задач, назначенных на вас</p>

        <Separator />

        <div class="grid gap-3">
          <h4 class="text-sm font-medium">Задачи из календаря на сегодня</h4>
          <UiLoadingBar v-if="calendarTasksLoading" size="compact" />
          <ul v-else-if="calendarTasksToday.length" class="grid gap-2">
            <li
              v-for="task in calendarTasksToday"
              :key="task.id"
              class="flex items-center gap-3"
              :class="{ 'opacity-60': !!task.completedAt }"
            >
              <Checkbox
                :id="`calendar-task-${task.id}`"
                class="size-5"
                :model-value="!!task.completedAt"
                :disabled="isCalendarTaskSaving(task.id)"
                aria-label="Задача выполнена"
                @update:model-value="toggleCalendarTaskCompleted(task.id)"
              />
              <label :for="`calendar-task-${task.id}`" class="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
                <span class="tabular-nums" :class="{ 'line-through': !!task.completedAt }">{{ formatCalendarTaskTime(task) }}</span>
                <UiBadge :tone="priorityTone(task.priority)">{{ priorityLabel(task.priority) }}</UiBadge>
                <span v-if="isCalendarTaskSaving(task.id)" class="text-xs text-muted-foreground">Сохранение…</span>
              </label>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-foreground">На сегодня в календаре задач нет</p>
        </div>
      </article>

      <div class="flex min-w-0 flex-col gap-6">
        <!-- Техника -->
        <article class="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
          <h3 class="text-base font-semibold">Техника</h3>
          <div v-if="hasActiveEquipmentOperation" class="grid gap-1 rounded-lg bg-muted/60 p-3">
            <span class="text-xs text-muted-foreground">{{ hasActiveTaskOperation ? 'Активная задача' : 'Активная операция' }}</span>
            <span class="text-sm font-medium">{{ hasActiveTaskOperation ? activeTaskLabel : (activeOperation?.operation || 'Операция без задачи') }}</span>
            <span class="text-xs text-muted-foreground">{{ activeEquipmentLabel }}</span>
            <UiBadge tone="neutral" class="mt-1 w-fit">Топливо: {{ activeOperation?.equipmentFuelPercent ?? '—' }}%</UiBadge>
          </div>
          <p v-else class="text-sm text-muted-foreground">Техника появится после старта операции и выбора техники.</p>
        </article>

        <!-- Сообщить о проблеме -->
        <article class="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
          <div class="grid gap-1">
            <h3 class="text-base font-semibold">Сообщить о проблеме</h3>
            <p class="text-sm text-muted-foreground">Поломка техники, препятствие на поле или другие трудности.</p>
          </div>
          <FormField label="Что случилось" for="issue-text" :count="issueReportText.length" :max="300">
            <Textarea id="issue-text" v-model="issueReportText" class="min-h-24" placeholder="Опишите проблему коротко" maxlength="300" />
          </FormField>
          <div v-if="issueReportFile" class="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 py-1 pr-1 pl-3 text-sm">
            <PaperclipIcon class="size-4 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ issueReportFile.name }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{{ formatIssueFileSize(issueReportFile.size) }}</span>
            <Button variant="ghost" size="icon-sm" type="button" class="ml-auto shrink-0 text-muted-foreground hover:text-destructive" aria-label="Убрать файл" @click="removeIssueFile">
              <XIcon />
            </Button>
          </div>
          <input ref="issueFileInputRef" class="hidden" type="file" @change="onIssueFilePicked" />
          <div class="grid gap-2">
            <Button variant="outline" type="button" :disabled="issueReportBusy" @click="openIssueFilePicker">
              <PaperclipIcon />
              Прикрепить файл
            </Button>
            <Button type="button" :disabled="!issueCanSubmit || issueReportBusy" @click="openIssueDispatcherPicker">
              <SendIcon />
              {{ issueReportBusy ? 'Отправка…' : 'Отправить диспетчеру' }}
            </Button>
          </div>
          <p v-if="issueReportError" class="text-sm text-destructive" role="alert">{{ issueReportError }}</p>
          <p v-else-if="issueReportSuccess" class="text-sm text-emerald-700 dark:text-ring" role="status">{{ issueReportSuccess }}</p>
        </article>
      </div>

      <!-- Журнал смены -->
      <article class="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
        <h3 class="text-base font-semibold">Журнал смены</h3>
        <p v-if="!shiftJournalItems.length" class="text-sm text-muted-foreground">
          Записей пока нет. После начала или завершения операции здесь появится история смены.
        </p>
        <ol v-else class="grid gap-4">
          <li v-for="item in shiftJournalItems" :key="item.id" class="flex gap-3">
            <span
              class="mt-1.5 size-2 shrink-0 rounded-full"
              :class="item.isActive ? 'bg-primary ring-4 ring-primary/15 dark:bg-ring' : 'bg-muted-foreground/40'"
              aria-hidden="true"
            />
            <div class="grid min-w-0 gap-0.5">
              <span class="text-xs text-muted-foreground tabular-nums">{{ item.timeLabel }}</span>
              <span class="text-sm font-medium">{{ item.title }}</span>
              <span class="text-xs text-muted-foreground">{{ item.subtitle }}</span>
            </div>
          </li>
        </ol>
      </article>
    </section>

    <UiModal
      v-if="issueDispatcherModalOpen"
      title="Кому отправить сообщение о проблеме?"
      description="Выберите одного или нескольких сотрудников — сообщение придёт им в чат как важное."
      :max-width="560"
      @close="closeIssueDispatcherPicker"
    >
      <div class="tw-scope grid gap-4">
        <FormGrid :cols="2">
          <FormField label="Должность" for="issue-position">
            <NativeSelect id="issue-position" v-model="issuePositionFilter" @change="loadIssueRecipients">
              <NativeSelectOption value="">Все должности</NativeSelectOption>
              <NativeSelectOption v-for="pos in issuePositions" :key="pos.id" :value="pos.name">{{ pos.name }}</NativeSelectOption>
            </NativeSelect>
          </FormField>
          <FormField label="Поиск" for="issue-search">
            <Input id="issue-search" v-model.trim="issueSearch" type="search" placeholder="ФИО, email, телефон" @input="loadIssueRecipients" />
          </FormField>
        </FormGrid>
        <UiLoadingBar v-if="issueDispatchersLoading" size="compact" />
        <p v-else-if="!issueDispatchers.length" class="py-6 text-center text-sm text-muted-foreground">Подходящих сотрудников не найдено.</p>
        <div v-else class="grid max-h-72 overflow-y-auto rounded-lg border p-1">
          <label
            v-for="d in issueDispatchers"
            :key="d.id"
            class="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60"
            :class="{ 'bg-muted': selectedIssueRecipientIds.includes(d.id) }"
          >
            <Checkbox :model-value="selectedIssueRecipientIds.includes(d.id)" @update:model-value="toggleIssueRecipient(d.id)" />
            <span class="grid min-w-0">
              <span class="truncate text-sm font-medium">{{ d.display_name || d.email || 'Сотрудник' }}</span>
              <span class="truncate text-xs text-muted-foreground">{{ employeeRoleLabel(d) }}<template v-if="d.email && d.display_name"> · {{ d.email }}</template></span>
            </span>
          </label>
        </div>
      </div>
      <template #actions>
        <span v-if="selectedIssueRecipientIds.length" class="mr-auto self-center text-sm text-muted-foreground">Выбрано: {{ selectedIssueRecipientIds.length }}</span>
        <UiButton :disabled="issueReportBusy" @click="closeIssueDispatcherPicker">Отмена</UiButton>
        <UiButton variant="primary" :disabled="issueReportBusy || !issueCanSendNow" @click="submitIssueToDispatcher">
          <SendIcon />
          {{ issueReportBusy ? 'Отправка…' : 'Отправить' }}
        </UiButton>
      </template>
    </UiModal>

    <PickSheet
      v-model:open="isReasonsOpen"
      label="Простой"
      title="Выберите причину начала простоя"
      :items="reasons.map((reason) => ({ key: reason.category, title: reason.label, description: reason.description, onPick: () => startDowntime(reason) }))"
    />

    <PickSheet
      v-model:open="isOperationsOpen"
      label="Операция"
      title="Выберите операцию для работы"
      empty="Добавьте операции на странице «Поля» (блок «Справочники») или поля в «Мои поля сегодня»."
      :items="workOperationsList.length
        ? workOperationsList.map((op) => ({ key: op.id, title: op.name, description: `Начать операцию (поле: ${currentField?.name ?? 'не выбрано'})`, onPick: () => startOperationByName(op) }))
        : fields.map((field) => ({ key: 'f-' + field.id, title: `${field.name} — ${field.operation}`, description: 'Начать работу по этому полю', onPick: () => startOperation(field) }))"
    />

    <UiModal
      v-if="isEquipmentChoiceOpen"
      title="Будет ли использована техника?"
      description="Если техника нужна — выберите её и укажите топливо и состояние."
      :max-width="460"
      @close="closeEquipmentChoiceAndReturnToSheet()"
    >
      <Alert v-if="startOperationPlanError" variant="destructive" class="tw-scope">
        <AlertDescription>{{ startOperationPlanError }}</AlertDescription>
      </Alert>
      <template #actions>
        <UiButton @click="startOperationConfirmedWithoutEquipment">Без техники</UiButton>
        <UiButton variant="primary" @click="openEquipmentModal">Выбрать технику</UiButton>
      </template>
    </UiModal>

    <UiModal v-if="isEquipmentModalOpen" title="Техника для операции" :max-width="560" @close="backFromEquipmentModalToChoice()">
      <div class="tw-scope grid gap-4">
        <UiLoadingBar v-if="equipmentLoading" size="md" />
        <Alert v-else-if="equipmentError" variant="destructive">
          <AlertDescription>{{ equipmentError }}</AlertDescription>
        </Alert>
        <FormGrid v-else>
          <FormField label="Техника" for="op-equipment">
            <NativeSelect id="op-equipment" v-model="selectedEquipmentId">
              <NativeSelectOption value="" disabled>Выберите технику</NativeSelectOption>
              <NativeSelectOption v-for="e in equipmentList" :key="e.id" :value="e.id">
                {{ e.brand }} — {{ e.license_plate }} ({{ e.model ?? '—' }})
              </NativeSelectOption>
            </NativeSelect>
          </FormField>
          <FormField
            label="План работ"
            :hint="`Доступно по полю: ${pendingFieldArea && pendingFieldArea > 0 ? `${formatHectares(pendingFieldArea)} га` : 'не задано'}`"
          >
            <template #label-actions>
              <span class="text-sm font-medium tabular-nums">{{ startPlannedHectares != null ? `${formatHectares(startPlannedHectares)} га` : '—' }}</span>
            </template>
            <input
              v-model.number="startPlannedHectares"
              type="range"
              min="0.1"
              :max="pendingFieldArea && pendingFieldArea > 0 ? pendingFieldArea : 0.1"
              step="0.1"
              class="h-5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="План работ, га"
              :disabled="!(pendingFieldArea && pendingFieldArea > 0)"
            />
          </FormField>
          <FormField label="Топливо">
            <template #label-actions>
              <span class="text-sm font-medium tabular-nums">{{ fuelPercent }}%</span>
            </template>
            <input v-model.number="fuelPercent" type="range" min="0" max="100" step="1" class="h-5 w-full cursor-pointer accent-primary" aria-label="Топливо, %" />
          </FormField>
          <FormField label="Состояние техники" :hint="equipmentConditionLabel">
            <template #label-actions>
              <span class="text-sm font-medium tabular-nums">{{ conditionPercent }}%</span>
            </template>
            <input v-model.number="conditionPercent" type="range" min="0" max="100" step="1" class="h-5 w-full cursor-pointer accent-primary" aria-label="Состояние техники, %" />
          </FormField>
          <FormField v-if="equipmentConditionRequiresNotes" label="Что нужно исправить" for="op-repair" required>
            <Textarea id="op-repair" v-model="equipmentRepairNotes" rows="4" placeholder="Например: заменить ремень, проверить гидравлику, подтянуть крепления" />
          </FormField>
        </FormGrid>
        <Alert v-if="startOperationPlanError" variant="destructive">
          <AlertDescription>{{ startOperationPlanError }}</AlertDescription>
        </Alert>
      </div>
      <template #actions>
        <UiButton @click="backFromEquipmentModalToChoice">Назад</UiButton>
        <UiButton
          variant="primary"
          :disabled="!selectedEquipmentId || equipmentLoading || (equipmentConditionRequiresNotes && !equipmentRepairNotes.trim())"
          @click="startOperationConfirmedWithEquipment"
        >
          Начать операцию
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      v-if="isStartedModalOpen"
      title="Простой зафиксирован"
      :description="`Начало простоя записано по объекту «${circleFieldLabel}», операция: ${circleTaskLabel}.`"
      :max-width="460"
      @close="isStartedModalOpen = false"
    >
      <template #actions>
        <UiButton variant="primary" @click="isStartedModalOpen = false">Понятно</UiButton>
      </template>
    </UiModal>

    <UiModal
      v-if="finishNotesModalOpen"
      :title="finishNotesType === 'downtime' ? 'Завершить простой' : 'Завершить операцию'"
      description="По желанию укажите, что сделано. Заметки будут видны в журнале работ и аналитике."
      :max-width="560"
      @close="closeFinishNotesModal"
    >
      <FormGrid class="tw-scope">
        <FormField label="Что сделано" for="finish-notes">
          <Textarea id="finish-notes" v-model="finishNotesText" rows="4" placeholder="Например: замена масла, проверка подшипников, дозаправка" />
        </FormField>
        <FormField v-if="shouldAskEquipmentFuelLeft" label="Топлива осталось у техники">
          <template #label-actions>
            <span class="text-sm font-medium tabular-nums">{{ equipmentFuelLeftPercent }}%</span>
          </template>
          <input v-model.number="equipmentFuelLeftPercent" type="range" min="0" max="100" step="1" class="h-5 w-full cursor-pointer accent-primary" aria-label="Топлива осталось, %" />
        </FormField>
        <FormField v-if="shouldAskProcessedHectares" label="Сколько обработано">
          <template #label-actions>
            <span class="text-sm font-medium tabular-nums">{{ formatHectares(finishProcessedHectares) }} га</span>
          </template>
          <input
            v-model.number="finishProcessedHectares"
            type="range"
            min="0"
            :max="finishProcessedHectaresMax"
            step="0.1"
            class="h-5 w-full cursor-pointer accent-primary"
            aria-label="Обработано, га"
          />
        </FormField>
      </FormGrid>
      <template #actions>
        <UiButton @click="closeFinishNotesModal">Отмена</UiButton>
        <UiButton variant="primary" @click="confirmFinishNotes(finishNotesText)">Сохранить и завершить</UiButton>
      </template>
    </UiModal>

    <UiModal
      v-if="isFinishedModalOpen"
      :title="isFinishedModalType === 'downtime' ? 'Простой завершён' : 'Операция завершена'"
      description="Запись сохранена. Данные видны в разделе «Аналитика» и в журнале работ."
      :max-width="460"
      @close="isFinishedModalOpen = false"
    >
      <template #actions>
        <UiButton variant="primary" @click="isFinishedModalOpen = false">Закрыть</UiButton>
      </template>
    </UiModal>

    <UiModal
      v-if="isAddFieldOpen"
      title="Новое поле"
      description="Поле появится в списке для учёта работ и простоев."
      :max-width="560"
      @close="isAddFieldOpen = false"
    >
      <FormGrid class="tw-scope">
        <FormField label="Название поля" for="new-field-name">
          <Input id="new-field-name" v-model="newFieldName" type="text" placeholder="Например: Поле №15" />
        </FormField>
        <FormField label="Операция" for="new-field-op">
          <Input id="new-field-op" v-model="newFieldOperation" type="text" placeholder="Например: посев, уборка, опрыскивание" />
        </FormField>
      </FormGrid>
      <template #actions>
        <UiButton @click="isAddFieldOpen = false">Отмена</UiButton>
        <UiButton variant="primary" @click="addField">Добавить</UiButton>
      </template>
    </UiModal>

    <UiSuccessModal
      :open="successModalOpen"
      :title="successModalTitle"
      :message="successModalMessage"
      button-text="Хорошо"
      @close="successModalOpen = false"
    />
  </section>
</template>


