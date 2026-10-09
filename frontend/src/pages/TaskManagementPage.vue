<script setup lang="ts">
import { askConfirm } from '@/composables/useConfirm'
import UiPagination from '@/components/ui/UiPagination.vue'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/shadcn/input-group'
import { Input } from '@/components/ui/shadcn/input'
import { Textarea } from '@/components/ui/shadcn/textarea'
import { Button } from '@/components/ui/shadcn/button'
import UiPersonPicker from '@/components/ui/UiPersonPicker.vue'
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, CirclePlusIcon, ClipboardListIcon, FileIcon, FileSpreadsheetIcon, FileTextIcon, PaperclipIcon, PlusIcon, SearchIcon, XIcon } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { ButtonGroup } from '@/components/ui/shadcn/button-group'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Separator } from '@/components/ui/shadcn/separator'
import { Spinner } from '@/components/ui/shadcn/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/shadcn/table'
import PageToolbar from '@/components/ui/layout/PageToolbar.vue'
import FormGrid from '@/components/ui/layout/FormGrid.vue'
import FormField from '@/components/ui/layout/FormField.vue'
import UiBadge, { type UiBadgeTone } from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, ref, watch, onMounted, onActivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import UiDatePicker from '@/components/ui/UiDatePicker.vue'
import {
  isSupabaseConfigured,
  loadProfiles,
  loadTasksFiltered,
  loadTasksFilteredPage,
  tasksWithAssignees,
  createTask as createTaskApi,
  updateTask as updateTaskApi,
  deleteTask as deleteTaskApi,
  loadTaskComments,
  addTaskComment,
  loadTaskEvents,
  addTaskEvent,
  loadTaskFiles,
  uploadTaskFile,
  deleteTaskFile,
  getTaskFilePublicUrl,
  loadTaskParticipantsMap,
  syncTaskParticipants,
  TASK_ASSIGNEE_FILTER_UNASSIGNED,
} from '@/lib/tasksSupabase'
import { canDeleteTask } from '@/lib/deletePermissions'
import { loadFields as loadFieldsApi } from '@/lib/fieldsSupabase'
import { loadWorkOperations, type WorkOperationRow } from '@/lib/reasonsAndOperations'
import type { Task as TaskType, ProfileRow, TaskCommentRow, TaskEventRow, TaskFileRow } from '@/lib/tasksSupabase'
import { avatarColorByPosition } from '@/lib/avatarColors'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { downloadDelimited, escapeHtml, openPdfInNewTab, renderTablePdfFitPage } from '@/lib/tableExport'
import UserAvatar from '@/components/UserAvatar.vue'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UiSuccessModal from '@/components/UiSuccessModal.vue'

type FilterKey = 'all' | 'mine'
type Priority = 'high' | 'medium' | 'low'
type Status = 'todo' | 'in_progress' | 'review' | 'done'
type TaskSortKey = 'number' | 'title' | 'assignee' | 'priority' | 'dueDate' | 'status'
type SortDirection = 'asc' | 'desc'

interface AssigneeOption {
  id: string
  name: string
  initials: string
}

interface PendingTaskFile {
  id: string
  file: File
  previewUrl: string | null
}

type Task = TaskType

const auth = useAuth()
const route = useRoute()
const router = useRouter()
const activeFilter = ref<FilterKey>('all')
const filterEmployeeId = ref<string>('')
const filterStatus = ref<Status | ''>('')
const filterDateFrom = ref<string>('')
const filterDateTo = ref<string>('')
const dateFromInput = ref<string>('')
const dateToInput = ref<string>('')
const searchTaskNumber = ref('')
let searchByNumberTimeout: ReturnType<typeof setTimeout> | null = null
const currentPage = ref(1)
const pageSize = ref(10)
const listSortKey = ref<TaskSortKey>('number')
const listSortDirection = ref<SortDirection>('desc')
const showCreateModal = ref(false)
const editingTaskId = ref<string | null>(null)
const successModalOpen = ref(false)
/**
 * Сообщения о неудавшихся действиях. Показываются там, куда пользователь
 * в этот момент смотрит: смена статуса — на доске, удаление и комментарий —
 * в карточке задачи. Оформление то же, что у ошибок в ChatPage.
 */
const boardError = ref('')
const taskModalError = ref('')
/** Ошибка сохранения в окне создания / редактирования. */
const formError = ref('')
const selectedTaskId = ref<string | null>(null)
const tasksLoading = ref(true)
const tasks = ref<Task[]>([])
const serverTotal = ref(0)
const serverPagingMode = ref(false)
const profiles = ref<ProfileRow[]>([])
const taskComments = ref<TaskCommentRow[]>([])
const taskEvents = ref<TaskEventRow[]>([])
const taskFiles = ref<TaskFileRow[]>([])
const commentsLoading = ref(false)
const eventsLoading = ref(false)
const fileUploading = ref(false)
const createFileInputRef = ref<HTMLInputElement | null>(null)
const detailFileInputRef = ref<HTMLInputElement | null>(null)
const pendingCreateFiles = ref<PendingTaskFile[]>([])
const newCommentMessage = ref('')
const isSavingTask = ref(false)
const isTaskChatExpanded = ref(false)
/** Последние комментарии видны всегда, старые — по «Показать все». */
const TASK_COMMENTS_PREVIEW = 3
const visibleTaskComments = computed(() =>
  isTaskChatExpanded.value ? taskComments.value : taskComments.value.slice(-TASK_COMMENTS_PREVIEW),
)
const isSendingComment = ref(false)
const isMetaInitialLoading = ref(false)
const participantPickerOpen = ref(false)
const participantSearch = ref('')
const assignees = computed<AssigneeOption[]>(() => {
  if (!auth.user.value) return []
  const list = profiles.value.map((p) => ({
    id: p.id,
    name: p.display_name || p.email,
    initials: p.display_name
      ? (p.display_name.trim().split(/\s+/).length >= 2
          ? (p.display_name.trim().split(/\s+/)[0][0] + p.display_name.trim().split(/\s+/)[1][0]).toUpperCase()
          : p.display_name.trim().slice(0, 2).toUpperCase())
      : p.email.slice(0, 2).toUpperCase(),
  }))
  if (!isManager.value) {
    const me = auth.user.value
    const email = me.email ?? ''
    const name = (me.user_metadata?.full_name as string) || email
    return [{ id: me.id, name, initials: name.slice(0, 2).toUpperCase() }]
  }
  return list
})
const currentUserAssignee = computed<AssigneeOption | null>(() => {
  if (!auth.user.value) return null
  const me = auth.user.value
  const email = me.email ?? ''
  const name = (me.user_metadata?.full_name as string) || email
  return { id: me.id, name, initials: name.slice(0, 2).toUpperCase() }
})

const isManager = computed(() => auth.userRole.value === 'manager')

const profilesMap = computed(() => new Map(profiles.value.map((p) => [p.id, p])))

function profileLabel(p: ProfileRow): string {
  return (p.display_name?.trim() || p.email || '').trim()
}

function profileById(uid: string): ProfileRow | undefined {
  return profilesMap.value.get(uid)
}

function participantInitials(p: ProfileRow): string {
  const name = profileLabel(p)
  if (!name) return '?'
  const parts = name.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2)
  return name.slice(0, 2).toUpperCase()
}

const participantSearchLower = computed(() => participantSearch.value.trim().toLowerCase())

const participantsAvailable = computed(() => {
  const assigneeId = form.value.assigneeId.trim()
  return profiles.value.filter(
    (p) => !form.value.participantIds.includes(p.id) && p.id !== assigneeId,
  )
})

const participantOptions = computed(() => {
  const q = participantSearchLower.value
  const base = participantsAvailable.value
  if (!q) return base
  return base.filter((p) => {
    const label = profileLabel(p).toLowerCase()
    return label.includes(q) || p.email.toLowerCase().includes(q)
  })
})

function closeParticipantPicker() {
  participantPickerOpen.value = false
  participantSearch.value = ''
}

function toggleParticipantPicker() {
  participantPickerOpen.value = !participantPickerOpen.value
  if (!participantPickerOpen.value) participantSearch.value = ''
}

function addParticipant(uid: string) {
  if (!form.value.participantIds.includes(uid)) {
    form.value.participantIds = [...form.value.participantIds, uid]
  }
  closeParticipantPicker()
}

function removeParticipant(uid: string) {
  form.value.participantIds = form.value.participantIds.filter((id) => id !== uid)
}

function profileName(userId: string | null | undefined): string {
  if (!userId) return 'Система'
  const p = profilesMap.value.get(userId)
  if (!p) return 'Система'
  return (p.display_name || p.email || '').trim() || 'Сотрудник'
}

function profileInitials(userId: string | null | undefined): string {
  if (!userId) return 'С'
  const p = profilesMap.value.get(userId)
  if (!p) return 'С'
  const base = (p.display_name || p.email || '').trim()
  const parts = base.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return base.slice(0, 2).toUpperCase()
}

function avatarStyleByUserId(userId: string | null | undefined): Record<string, string> | undefined {
  if (!userId) return undefined
  const p = profilesMap.value.get(userId)
  return { background: avatarColorByPosition(p?.position) }
}

function avatarUrlByUserId(userId: string | null | undefined): string | null {
  if (!userId) return null
  return profilesMap.value.get(userId)?.avatar_url ?? null
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function loadData() {
  if (!isSupabaseConfigured() || !auth.user.value) {
    tasks.value = []
    tasksLoading.value = false
    return
  }
  tasksLoading.value = true
  try {
    const user = auth.user.value
    const [profileList, fieldRows, workOps] = await Promise.all([
      loadProfiles(),
      loadFieldsApi(),
      loadWorkOperations(),
    ])
    profiles.value = profileList
    fields.value = fieldRows.map((f) => f.name).sort((a, b) => a.localeCompare(b, 'ru-RU'))
    workTypes.value = workOps.map((op: WorkOperationRow) => op.name)

    const numStr = searchTaskNumber.value.trim()
    let numberOpt: number | undefined
    if (numStr) {
      const n = parseInt(numStr, 10)
      if (isNaN(n) || n < 1) {
        tasks.value = []
        serverTotal.value = 0
        serverPagingMode.value = true
        return
      }
      numberOpt = n
    }
    const involvedUserId = activeFilter.value === 'mine' ? user.id : undefined

    const page = await loadTasksFilteredPage(false, user.id, {
      status: filterStatus.value || undefined,
      assigneeId: filterEmployeeId.value || undefined,
      involvedUserId,
      number: numberOpt,
      dueFrom: filterDateFrom.value || undefined,
      dueTo: filterDateTo.value || undefined,
      page: currentPage.value,
      pageSize: pageSize.value,
    })

    if (page.dueFilterUnsupported) {
      // Миграция нормализации даты не применена — фильтр по сроку считаем на клиенте.
      serverPagingMode.value = false
      const rows = await loadTasksFiltered(false, user.id, {
        status: filterStatus.value || undefined,
        assigneeId: filterEmployeeId.value || undefined,
        involvedUserId,
        limit: 500,
      })
      const participantsMap = await loadTaskParticipantsMap(rows.map((r) => r.id))
      tasks.value = tasksWithAssignees(rows, profileList, participantsMap)
      serverTotal.value = 0
    } else {
      serverPagingMode.value = true
      const participantsMap = await loadTaskParticipantsMap(page.rows.map((r) => r.id))
      tasks.value = tasksWithAssignees(page.rows, profileList, participantsMap)
      serverTotal.value = page.total
    }
  } catch (e) {
    boardError.value = formatSupabaseError(e) || 'Не удалось загрузить задачи'
    tasks.value = []
    serverTotal.value = 0
  } finally {
    tasksLoading.value = false
  }
}

const fields = ref<string[]>([])
const workTypes = ref<string[]>([])

const filters: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все задачи' },
  { key: 'mine', label: 'На мне' },
]

const statusColumns: { key: Status; title: string }[] = [
  { key: 'todo', title: 'К выполнению' },
  { key: 'in_progress', title: 'В процессе' },
  { key: 'review', title: 'На проверке' },
  { key: 'done', title: 'Выполнено' },
]

/** Параметры с страницы «Аналитика» (карточка задач по сроку). */
function applyAnalyticsQueryParams() {
  const q = route.query
  if (q.due_upto === '1' && typeof q.due_to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.due_to)) {
    filterDateFrom.value = ''
    dateFromInput.value = ''
    filterDateTo.value = q.due_to
    dateToInput.value = q.due_to
  } else {
    if (typeof q.due_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.due_from)) {
      filterDateFrom.value = q.due_from
      dateFromInput.value = q.due_from
    }
    if (typeof q.due_to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.due_to)) {
      filterDateTo.value = q.due_to
      dateToInput.value = q.due_to
    }
  }
  if (q.kpi_completed_due === '1') {
    filterStatus.value = 'done'
  }
}

async function syncOpenTaskFromQuery() {
  const raw = route.query.openTaskId
  const openTaskId = typeof raw === 'string' ? raw : ''
  if (!openTaskId) return
  const task = tasks.value.find((t) => t.id === openTaskId)
  if (!task) return
  await openTask(task.id)
}

onMounted(async () => {
  applyAnalyticsQueryParams()
  await loadData()
  await syncOpenTaskFromQuery()
})
onActivated(async () => {
  await loadData()
  await syncOpenTaskFromQuery()
})

watch(
  () => route.query.openTaskId,
  async () => {
    await syncOpenTaskFromQuery()
  },
)

const form = ref({
  title: '',
  assigneeId: '',
  participantIds: [] as string[],
  field: '',
  priority: 'medium' as Priority,
  dueDate: '',
  workType: '',
  description: '',
})

const TASK_TITLE_MAX = 60
const TASK_DESCRIPTION_MAX = 500
/** Превью описания под названием в списке (отдельная строка) */
const TASK_LIST_DESC_PREVIEW_MAX = 160

function truncateTaskTitle(value: string | null | undefined): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.length > TASK_TITLE_MAX ? `${text.slice(0, TASK_TITLE_MAX).trimEnd()}...` : text
}

/** Поле и тип работ — первая серая строка */
function taskListContextLine(task: Task): string {
  const parts: string[] = []
  const field = task.field?.trim()
  if (field) parts.push(field)
  const workType = task.workType?.trim()
  if (workType) parts.push(workType)
  return parts.join(' • ')
}

function taskListDescriptionFull(task: Task): string {
  const desc = task.description?.trim()
  if (!desc || desc === 'Просрочено') return ''
  return desc
}

function taskListDescriptionPreview(task: Task): string {
  const desc = taskListDescriptionFull(task)
  if (!desc) return ''
  if (desc.length > TASK_LIST_DESC_PREVIEW_MAX) {
    return `${desc.slice(0, TASK_LIST_DESC_PREVIEW_MAX).trimEnd()}…`
  }
  return desc
}

function taskListSubtitleTitle(task: Task): string {
  return taskListContextLine(task)
}

function isImageFile(fileName: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName)
}

function isPdfFile(fileName: string): boolean {
  return /\.pdf$/i.test(fileName)
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function revokePendingFilePreview(file: PendingTaskFile) {
  if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
}

function clearPendingCreateFiles() {
  pendingCreateFiles.value.forEach(revokePendingFilePreview)
  pendingCreateFiles.value = []
  if (createFileInputRef.value) createFileInputRef.value.value = ''
}

function appendPendingFiles(fileList: FileList | null) {
  if (!fileList?.length) return
  const next = [...pendingCreateFiles.value]
  for (const file of Array.from(fileList)) {
    const duplicate = next.some((item) =>
      item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified,
    )
    if (duplicate) continue
    next.push({
      id: crypto.randomUUID(),
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    })
  }
  pendingCreateFiles.value = next
}

function triggerCreateFileInput() {
  createFileInputRef.value?.click()
}

function onCreateFilesSelected(e: Event) {
  const input = e.target as HTMLInputElement
  appendPendingFiles(input.files)
  input.value = ''
}

function removePendingCreateFile(id: string) {
  const file = pendingCreateFiles.value.find((item) => item.id === id)
  if (file) revokePendingFilePreview(file)
  pendingCreateFiles.value = pendingCreateFiles.value.filter((item) => item.id !== id)
}

async function uploadPendingFiles(taskId: string) {
  if (!pendingCreateFiles.value.length || !isSupabaseConfigured()) return
  fileUploading.value = true
  try {
    await Promise.all(pendingCreateFiles.value.map((item) => uploadTaskFile(taskId, item.file)))
  } finally {
    fileUploading.value = false
    clearPendingCreateFiles()
  }
}

/** Срок в форме хранится как «ДД.ММ.ГГГГ» (так он лежит в базе), календарь работает с ISO. */
const formDueDateIso = computed<string>({
  get: () => {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(form.value.dueDate.trim())
    return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
  },
  set: (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
    form.value.dueDate = m ? `${m[3]}.${m[2]}.${m[1]}` : ''
  },
})

function parseDueDate(dueDate: string): Date | null {
  if (!dueDate || dueDate === '—') return null
  const trimmed = dueDate.trim()
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const y = parseInt(iso[1], 10)
    const mo = parseInt(iso[2], 10) - 1
    const day = parseInt(iso[3], 10)
    const d = new Date(y, mo, day)
    return isNaN(d.getTime()) ? null : d
  }
  const m = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return null
  const [, day, month, year] = m
  const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10))
  return isNaN(d.getTime()) ? null : d
}

const filteredTasks = computed(() => {
  let list = tasks.value
  const numStr = searchTaskNumber.value.trim()
  if (numStr) {
    const n = parseInt(numStr, 10)
    list = isNaN(n) ? [] : list.filter((t) => t.number === n)
  }
  if (activeFilter.value === 'mine' && auth.user.value) {
    const myId = auth.user.value.id
    list = list.filter(
      (t) =>
        t.assignee.id === myId
        || t.participantIds.includes(myId)
        || t.createdBy?.id === myId,
    )
  }
  if (filterEmployeeId.value === TASK_ASSIGNEE_FILTER_UNASSIGNED) {
    list = list.filter((t) => !t.assignee.id)
  } else if (filterEmployeeId.value) {
    list = list.filter((t) => t.assignee.id === filterEmployeeId.value)
  }
  if (filterStatus.value) {
    list = list.filter((t) => t.status === filterStatus.value)
  }
  const from = filterDateFrom.value ? new Date(filterDateFrom.value) : null
  const to = filterDateTo.value ? new Date(filterDateTo.value) : null
  if (from || to) {
    list = list.filter((t) => {
      const d = parseDueDate(t.dueDate)
      if (!d) return true
      if (from && d < new Date(from.getFullYear(), from.getMonth(), from.getDate())) return false
      if (to) {
        const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1)
        if (d >= toEnd) return false
      }
      return true
    })
  }
  return list
})

const priorityRank: Record<Priority, number> = { low: 1, medium: 2, high: 3 }
const statusRank: Record<Status, number> = { todo: 1, in_progress: 2, review: 3, done: 4 }

function compareTaskValues(a: Task, b: Task, key: TaskSortKey): number {
  if (key === 'number') return Number(a.number ?? 0) - Number(b.number ?? 0)
  if (key === 'title') return (a.title ?? '').localeCompare((b.title ?? ''), 'ru', { sensitivity: 'base' })
  if (key === 'assignee') {
    return (a.assignee?.name ?? '').localeCompare((b.assignee?.name ?? ''), 'ru', { sensitivity: 'base' })
  }
  if (key === 'priority') return priorityRank[a.priority] - priorityRank[b.priority]
  if (key === 'status') return statusRank[a.status] - statusRank[b.status]
  const aDate = parseDueDate(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER
  const bDate = parseDueDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER
  return aDate - bDate
}

const sortedFilteredTasks = computed(() => {
  const base = [...filteredTasks.value]
  const key = listSortKey.value
  const dir = listSortDirection.value === 'asc' ? 1 : -1
  return base.sort((a, b) => {
    const cmp = compareTaskValues(a, b, key)
    if (cmp !== 0) return cmp * dir
    return Number(b.number ?? 0) - Number(a.number ?? 0)
  })
})

function setListSort(key: TaskSortKey) {
  if (listSortKey.value === key) {
    listSortDirection.value = listSortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    listSortKey.value = key
    listSortDirection.value = key === 'number' ? 'desc' : 'asc'
  }
}

function sortIndicator(key: TaskSortKey): 'none' | 'asc' | 'desc' {
  if (listSortKey.value !== key) return 'none'
  return listSortDirection.value
}

const totalFiltered = computed(() => (serverPagingMode.value ? serverTotal.value : filteredTasks.value.length))
const totalPages = computed(() => Math.max(1, Math.ceil(totalFiltered.value / pageSize.value)))

const paginationStart = computed(() => (currentPage.value - 1) * pageSize.value + 1)
const paginationEnd = computed(() =>
  Math.min(currentPage.value * pageSize.value, totalFiltered.value),
)

const pageNumbers = computed(() => {
  const total = totalPages.value
  const current = currentPage.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  if (current <= 4) {
    for (let p = 2; p <= 5; p += 1) pages.push(p)
    pages.push('ellipsis')
    pages.push(total)
    return pages
  }
  if (current >= total - 3) {
    pages.push('ellipsis')
    for (let p = total - 4; p <= total; p += 1) pages.push(p)
    return pages
  }
  pages.push('ellipsis')
  for (let p = current - 1; p <= current + 1; p += 1) pages.push(p)
  pages.push('ellipsis')
  pages.push(total)
  return pages
})

function goToPage(page: number) {
  currentPage.value = Math.max(1, Math.min(page, totalPages.value))
}

const paginatedTasks = computed(() => {
  if (serverPagingMode.value) return sortedFilteredTasks.value
  const list = sortedFilteredTasks.value
  const start = (currentPage.value - 1) * pageSize.value
  return list.slice(start, start + pageSize.value)
})

/* Номер задачи приходит с бэкенда (поле number в таблице tasks) */
function getTaskNumber(taskId: string): number {
  const task = tasks.value.find((t) => t.id === taskId) ?? filteredTasks.value.find((t) => t.id === taskId)
  return task?.number ?? 0
}

function reloadFromFirstPage() {
  if (!isSupabaseConfigured() || !auth.user.value) return
  if (currentPage.value !== 1) {
    currentPage.value = 1
  } else {
    void loadData()
  }
}

function applyDateFilter() {
  // Изменение filterDateFrom/To перехватывается watch ниже и перезагружает с первой страницы.
  filterDateFrom.value = dateFromInput.value
  filterDateTo.value = dateToInput.value
}

// Даты применяются сразу при выборе — как остальные фильтры.
watch([dateFromInput, dateToInput], applyDateFilter)

watch(
  () => [filterDateFrom.value, filterDateTo.value, filterEmployeeId.value, filterStatus.value, activeFilter.value],
  () => {
    reloadFromFirstPage()
  },
)
watch(searchTaskNumber, () => {
  if (searchByNumberTimeout) clearTimeout(searchByNumberTimeout)
  searchByNumberTimeout = setTimeout(() => {
    reloadFromFirstPage()
  }, 400)
})
watch(pageSize, () => {
  reloadFromFirstPage()
})
watch(totalPages, (pages) => {
  if (currentPage.value > pages) currentPage.value = Math.max(1, pages)
})
watch(currentPage, () => {
  if (!isSupabaseConfigured() || !auth.user.value) return
  void loadData()
})

const selectedTask = computed(() =>
  selectedTaskId.value
    ? (tasks.value.find((t) => t.id === selectedTaskId.value) ?? null)
    : null
)

const canDeleteSelectedTask = computed(() => {
  const task = selectedTask.value
  if (!task) return false
  return canDeleteTask(task.createdBy?.id ?? null)
})

const selectedTaskCreatorName = computed(() => (selectedTask.value?.createdBy?.name ?? '—'))
const selectedTaskCreatedAt = computed(() => formatDateTime(selectedTask.value?.createdAt))

async function loadMetaForTask(taskId: string) {
  if (!isSupabaseConfigured() || !auth.user.value) {
    taskComments.value = []
    taskEvents.value = []
    taskFiles.value = []
    return
  }
  commentsLoading.value = true
  eventsLoading.value = true
  isMetaInitialLoading.value = true
  try {
    const [comments, events, files] = await Promise.all([
      loadTaskComments(taskId),
      loadTaskEvents(taskId),
      loadTaskFiles(taskId),
    ])
    taskComments.value = comments
    taskEvents.value = events
    taskFiles.value = files
  } catch (e) {
    taskModalError.value = formatSupabaseError(e) || 'Не удалось загрузить переписку и файлы задачи'
    taskComments.value = []
    taskEvents.value = []
    taskFiles.value = []
  } finally {
    commentsLoading.value = false
    eventsLoading.value = false
    isMetaInitialLoading.value = false
  }
}

function openCreate() {
  editingTaskId.value = null
  clearPendingCreateFiles()
  const d = new Date()
  const defaultAssigneeId = !isManager.value && currentUserAssignee.value
    ? currentUserAssignee.value.id
    : ''
  form.value = {
    title: '',
    assigneeId: defaultAssigneeId,
    participantIds: [],
    field: fields.value[0] || '',
    priority: 'medium',
    dueDate: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'),
    workType: workTypes.value[0] || '',
    description: '',
  }
  closeParticipantPicker()
  showCreateModal.value = true
}

function openEdit() {
  const task = selectedTask.value
  if (!task) return
  const assigneeId = task.assignee.id ?? ''
  form.value = {
    title: task.title,
    assigneeId,
    participantIds: [...task.participantIds],
    field: task.field,
    priority: task.priority,
    dueDate: task.dueDate === '—' ? '' : task.dueDate,
    workType: task.workType ?? (workTypes.value[0] || ''),
    description: task.description ?? '',
  }
  closeParticipantPicker()
  editingTaskId.value = task.id
  selectedTaskId.value = null
  showCreateModal.value = true
}

function closeCreate() {
  formError.value = ''
  showCreateModal.value = false
  editingTaskId.value = null
  closeParticipantPicker()
  clearPendingCreateFiles()
}

async function createTask() {
  const title = form.value.title.trim()
  if (!title || isSavingTask.value) return
  let assigneeId: string | null = null
  if (isManager.value) {
    assigneeId = form.value.assigneeId.trim() || null
  } else {
    assigneeId = currentUserAssignee.value?.id ?? null
    if (!assigneeId && !editingTaskId.value) return
  }

  if (editingTaskId.value) {
    const taskId = editingTaskId.value
    const existing = tasks.value.find((x) => x.id === taskId)
    const prevField = existing?.field ?? form.value.field
    const prevWorkType = existing?.workType ?? ''
    const assigneeFromList = assigneeId ? assignees.value.find((a) => a.id === assigneeId) : null
    isSavingTask.value = true
    try {
      if (isSupabaseConfigured()) {
        const payload: Parameters<typeof updateTaskApi>[1] = {
          title,
          priority: form.value.priority,
          field: form.value.field,
          due_date: form.value.dueDate || '—',
          work_type: form.value.workType,
          description: form.value.description.trim() || undefined,
        }
        if (isManager.value) payload.assignee_id = assigneeId
        await updateTaskApi(taskId, payload)
        if (isManager.value) {
          await syncTaskParticipants(taskId, form.value.participantIds)
        }
        await loadData()
      } else {
        const t = tasks.value.find((x) => x.id === taskId)
        if (t) {
          t.title = title
          if (isManager.value) {
            t.assignee = assigneeFromList
              ? { id: assigneeFromList.id, name: assigneeFromList.name, initials: assigneeFromList.initials }
              : { id: null, name: 'Без исполнителя', initials: '—' }
            t.participantIds = [...form.value.participantIds]
          }
          t.priority = form.value.priority
          t.field = form.value.field
          t.dueDate = form.value.dueDate || '—'
          t.workType = form.value.workType || undefined
          t.description = form.value.description.trim() || undefined
        }
      }
      const userId = auth.user.value?.id ?? null
      if (form.value.field !== prevField) {
        addTaskEvent({
          taskId,
          userId,
          eventType: 'field_changed',
          payload: { from: prevField, to: form.value.field },
        })
      }
      if ((form.value.workType || '') !== prevWorkType) {
        addTaskEvent({
          taskId,
          userId,
          eventType: 'work_type_changed',
          payload: { from: prevWorkType || null, to: form.value.workType || null },
        })
      }
      closeCreate()
      selectedTaskId.value = taskId
      await loadMetaForTask(taskId)
    } catch (err) {
      formError.value = formatSupabaseError(err) || 'Не удалось сохранить задачу'
    } finally {
      isSavingTask.value = false
    }
    return
  }

  if (!isSupabaseConfigured() || !auth.user.value) return
  isSavingTask.value = true
  try {
    const createdTask = await createTaskApi(
      {
        title,
        priority: form.value.priority,
        field: form.value.field,
        due_date: form.value.dueDate || '—',
        status: 'todo',
        work_type: form.value.workType,
        description: form.value.description.trim() || undefined,
      },
      assigneeId,
      auth.user.value.id,
    )
    // Задача уже создана: сбой загрузки файлов не должен оставить её без участников.
    let filesError = ''
    try {
      await uploadPendingFiles(createdTask.id)
    } catch (err) {
      filesError = formatSupabaseError(err) || 'ошибка загрузки'
    }
    if (isManager.value && form.value.participantIds.length) {
      await syncTaskParticipants(createdTask.id, form.value.participantIds)
    }
    await loadData()
    closeCreate()
    if (filesError) {
      selectedTaskId.value = createdTask.id
      await loadMetaForTask(createdTask.id)
      taskModalError.value = `Задача создана, но файлы не прикрепились: ${filesError}`
    } else {
      successModalOpen.value = true
    }
  } catch (err) {
    formError.value = formatSupabaseError(err) || 'Не удалось создать задачу'
  } finally {
    isSavingTask.value = false
  }
}

watch(
  () => form.value.assigneeId,
  (assigneeId) => {
    if (!assigneeId || !form.value.participantIds.includes(assigneeId)) return
    form.value.participantIds = form.value.participantIds.filter((id) => id !== assigneeId)
  },
)

async function openTask(id: string) {
  selectedTaskId.value = id
  isTaskChatExpanded.value = false
  await loadMetaForTask(id)
}
function closeTask() {
  selectedTaskId.value = null
  taskModalError.value = ''
  taskComments.value = []
  taskEvents.value = []
  taskFiles.value = []
  newCommentMessage.value = ''
  isTaskChatExpanded.value = false
  if (route.query.openTaskId) {
    const rest = { ...route.query }
    delete rest.openTaskId
    void router.replace({ query: rest })
  }
}

function triggerDetailFileInput() {
  if (selectedTaskId.value) detailFileInputRef.value?.click()
}

async function onDetailFilesSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (!files.length || !selectedTaskId.value || !isSupabaseConfigured()) return
  fileUploading.value = true
  taskModalError.value = ''
  try {
    const uploaded = await Promise.all(files.map((file) => uploadTaskFile(selectedTaskId.value as string, file)))
    taskFiles.value = [...uploaded.reverse(), ...taskFiles.value]
  } catch (err) {
    taskModalError.value = `Файл не прикрепился: ${formatSupabaseError(err) || 'ошибка загрузки'}`
  } finally {
    fileUploading.value = false
    input.value = ''
  }
}

async function removeTaskFileRow(fileRow: TaskFileRow) {
  if (!isSupabaseConfigured()) return
  if (!(await askConfirm('Удалить файл?', `«${fileRow.file_name}» будет удалён из задачи.`))) return
  try {
    await deleteTaskFile(fileRow.id)
    taskFiles.value = taskFiles.value.filter((file) => file.id !== fileRow.id)
  } catch (err) {
    taskModalError.value = `Файл не удалён: ${formatSupabaseError(err) || 'ошибка'}`
  }
}

/** История открытой карточки сразу показывает только что записанное событие. */
async function refreshOpenTaskEvents(taskId: string) {
  if (selectedTaskId.value !== taskId) return
  try {
    taskEvents.value = await loadTaskEvents(taskId)
  } catch {
    // История не критична: при ошибке остаётся прежний список.
  }
}

async function updateTaskStatus(taskId: string, newStatus: Status) {
  boardError.value = ''
  const t = tasks.value.find((x) => x.id === taskId)
  const prevStatus = t?.status
  if (t) t.status = newStatus
  if (isSupabaseConfigured()) {
    try {
      await updateTaskApi(taskId, { status: newStatus })
      await addTaskEvent({
        taskId,
        userId: auth.user.value?.id ?? null,
        eventType: 'status_changed',
        payload: { from: prevStatus, to: newStatus },
      })
      await refreshOpenTaskEvents(taskId)
    } catch (err) {
      // Откат был и раньше, но молча: карточка возвращалась на место,
      // и это выглядело как промах мышью, а не как отказ сервера.
      if (t && prevStatus !== undefined) t.status = prevStatus
      const msg = formatSupabaseError(err) || 'Не удалось изменить статус задачи'
      // Статус меняют из карточки — ошибка должна быть видна в ней, а не под окном.
      if (selectedTaskId.value === taskId) taskModalError.value = msg
      else boardError.value = msg
    }
  }
}

async function submitComment() {
  const task = selectedTask.value
  const user = auth.user.value
  if (!task || !user) return
  const text = newCommentMessage.value.trim()
  if (!text) return
  if (isSendingComment.value) return
  taskModalError.value = ''
  isSendingComment.value = true
  try {
    const comment = await addTaskComment(task.id, user.id, text)
    taskComments.value.push(comment)
    newCommentMessage.value = ''
    await addTaskEvent({
      taskId: task.id,
      userId: user.id,
      eventType: 'comment_added',
      payload: { preview: text.slice(0, 140) },
    })
    await refreshOpenTaskEvents(task.id)
  } catch (err) {
    taskModalError.value = formatSupabaseError(err) || 'Не удалось отправить комментарий'
  } finally {
    isSendingComment.value = false
  }
}

async function deleteTask() {
  if (!selectedTaskId.value || !selectedTask.value) return
  if (!canDeleteSelectedTask.value) return
  if (!(await askConfirm('Удалить эту задачу?'))) return
  taskModalError.value = ''
  if (isSupabaseConfigured()) {
    try {
      await deleteTaskApi(selectedTaskId.value, selectedTask.value.createdBy?.id ?? null)
      await loadData()
    } catch (err) {
      // Раньше задача исчезала из списка и при неудачном удалении: человек
      // считал её удалённой, а после перезагрузки она возвращалась.
      taskModalError.value = formatSupabaseError(err) || 'Не удалось удалить задачу'
      return
    }
  } else {
    tasks.value = tasks.value.filter((t) => t.id !== selectedTaskId.value)
  }
  closeTask()
}

function statusTitle(s: Status): string {
  return statusColumns.find((c) => c.key === s)?.title ?? s
}
function priorityLabel(p: Priority): string {
  return { high: 'Высокий', medium: 'Средний', low: 'Низкий' }[p]
}


function exportToExcel() {
  const list = sortedFilteredTasks.value
  if (!list.length) return
  const headers = ['№', 'Название', 'Исполнитель', 'Приоритет', 'Поле', 'Срок', 'Статус', 'Тип работы', 'Описание']
  const rows = list.map((t) => [
    String(t.number ?? ''),
    t.title,
    t.assignee.name,
    priorityLabel(t.priority),
    t.field,
    t.dueDate,
    statusTitle(t.status),
    t.workType ?? '',
    (t.description ?? '').replace(/\r?\n/g, ' '),
  ])
  downloadDelimited(headers, rows, `задачи_${new Date().toISOString().slice(0, 10)}.csv`)
}

async function exportToPdf() {
  const list = sortedFilteredTasks.value
  if (!list.length) return
  const headers = ['№', 'Название', 'Исполнитель', 'Приоритет', 'Поле', 'Срок', 'Статус', 'Тип работы', 'Описание']
  const rows = list.map((t) => [
    String(t.number ?? ''),
    escapeHtml(t.title),
    escapeHtml(t.assignee.name),
    escapeHtml(priorityLabel(t.priority)),
    escapeHtml(t.field),
    escapeHtml(t.dueDate),
    escapeHtml(statusTitle(t.status)),
    escapeHtml(t.workType ?? ''),
    escapeHtml((t.description ?? '').slice(0, 80)),
  ])
  const tableRows = rows
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`,
    )
    .join('')
  const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const html = `
    <div class="pdf-export-table-wrap" style="position:fixed;left:-9999px;top:0;width:1100px;font-family:Arial,sans-serif;font-size:12px;background:#fff;">
      <h2 style="margin:0 0 12px 0;font-size:16px;">Список задач</h2>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead><tr style="background:#225533;color:#fff;">${headerCells}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `
  const wrap = document.createElement('div')
  wrap.innerHTML = html.trim()
  const el = wrap.firstElementChild as HTMLElement
  document.body.appendChild(el)
  try {
    const doc = await renderTablePdfFitPage(el)
    document.body.removeChild(el)
    openPdfInNewTab(doc)
  } catch (e) {
    document.body.removeChild(el)
    boardError.value = formatSupabaseError(e) || 'Не удалось сформировать PDF'
  }
}

const TASK_EVENT_LABELS: Record<string, string> = {
  created: 'создал задачу',
  comment_added: 'оставил комментарий',
  field_changed: 'изменил объект',
  work_type_changed: 'изменил тип работ',
  priority_changed: 'изменил приоритет',
  due_date_changed: 'изменил срок',
  assignee_changed: 'сменил исполнителя',
  title_changed: 'изменил название',
  description_changed: 'изменил описание',
}
function taskEventLabel(type: string): string {
  return TASK_EVENT_LABELS[type] ?? 'изменил задачу'
}
function statusTone(s: Status): UiBadgeTone {
  return ({ todo: 'neutral', in_progress: 'info', review: 'warning', done: 'success' } as const)[s]
}
function priorityTone(p: Priority): UiBadgeTone {
  return ({ high: 'danger', medium: 'warning', low: 'neutral' } as const)[p]
}
function sortIcon(key: TaskSortKey) {
  const d = sortIndicator(key)
  return d === 'asc' ? ArrowUpIcon : d === 'desc' ? ArrowDownIcon : ChevronsUpDownIcon
}
</script>

<template>
  <section class="tw-scope flex flex-col gap-6">
    <Alert v-if="boardError" variant="destructive">
      <AlertDescription>{{ boardError }}</AlertDescription>
    </Alert>

    <PageToolbar>
      <Tabs :model-value="activeFilter">
        <TabsList>
          <TabsTrigger v-for="f in filters" :key="f.key" :value="f.key" @click="activeFilter = f.key">
            {{ f.label }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <template #actions>
        <ButtonGroup>
          <Button variant="outline" :disabled="!filteredTasks.length" title="Экспорт в PDF (предпросмотр)" @click="exportToPdf">
            <FileTextIcon />
            PDF
          </Button>
          <Button variant="outline" :disabled="!filteredTasks.length" title="Экспорт в Excel" @click="exportToExcel">
            <FileSpreadsheetIcon />
            Excel
          </Button>
        </ButtonGroup>
        <Button @click="openCreate">
          <PlusIcon />
          Создать задачу
        </Button>
      </template>
    </PageToolbar>

    <div class="-mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <InputGroup class="col-span-2 sm:w-52">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput v-model.trim="searchTaskNumber" type="text" inputmode="numeric" placeholder="Номер задачи" />
      </InputGroup>
      <div v-if="isManager" class="min-w-0 sm:w-48">
        <UiSelect
          v-model="filterEmployeeId"
          block
          :options="[{ value: '', label: 'Все сотрудники' }, { value: TASK_ASSIGNEE_FILTER_UNASSIGNED, label: 'Без исполнителя' }, ...assignees.map((a) => ({ value: a.id, label: String(a.name) }))]"
          aria-label="Сотрудник"
          :disabled="!assignees.length"
        />
      </div>
      <div class="min-w-0 sm:w-40">
        <UiSelect
          v-model="filterStatus"
          block
          :options="[{ value: '', label: 'Все статусы' }, ...statusColumns.map((col) => ({ value: col.key, label: String(col.title) }))]"
          aria-label="Статус"
        />
      </div>
      <UiDatePicker v-model="dateFromInput" placeholder="Срок с" clearable block class="sm:w-36" />
      <UiDatePicker v-model="dateToInput" placeholder="Срок по" clearable block class="sm:w-36" />
    </div>

    <div v-if="tasksLoading" class="overflow-hidden rounded-xl border">
      <div v-for="i in 6" :key="i" class="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
        <Skeleton class="h-4 w-8" />
        <Skeleton class="h-4 flex-1" />
        <Skeleton class="hidden h-4 w-32 md:block" />
        <Skeleton class="hidden h-5 w-20 rounded-full md:block" />
      </div>
    </div>

    <template v-else>
      <template v-if="boardError && !paginatedTasks.length" />
      <Empty v-else-if="!paginatedTasks.length" class="rounded-xl border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon"><ClipboardListIcon /></EmptyMedia>
          <EmptyTitle>Задач нет</EmptyTitle>
          <EmptyDescription>По выбранным фильтрам ничего не найдено. Измените фильтры или создайте задачу.</EmptyDescription>
        </EmptyHeader>
      </Empty>

      <template v-else>
        <!-- Телефон: карточки -->
        <ul class="grid grid-cols-1 gap-3 md:hidden">
          <li v-for="task in paginatedTasks" :key="task.id">
            <button
              type="button"
              class="grid w-full min-w-0 grid-cols-1 gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-muted/50"
              @click="openTask(task.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="grid min-w-0 gap-1">
                  <span class="text-xs text-muted-foreground tabular-nums">№ {{ getTaskNumber(task.id) }}</span>
                  <span class="font-medium leading-snug">{{ task.title }}</span>
                  <span v-if="taskListContextLine(task)" class="truncate text-xs text-muted-foreground">{{ taskListContextLine(task) }}</span>
                </div>
                <UiBadge :tone="statusTone(task.status)">{{ statusTitle(task.status) }}</UiBadge>
              </div>
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="flex min-w-0 items-center gap-2">
                  <UserAvatar class="size-6 shrink-0 text-[10px] font-medium text-white" :style="avatarStyleByUserId(task.assignee.id)" :url="avatarUrlByUserId(task.assignee.id)" :initials="task.assignee.initials" />
                  <span class="truncate text-muted-foreground">{{ task.assignee.name }}</span>
                </span>
                <span class="flex shrink-0 items-center gap-2">
                  <UiBadge :tone="priorityTone(task.priority)">{{ priorityLabel(task.priority) }}</UiBadge>
                  <span class="whitespace-nowrap tabular-nums" :class="task.description === 'Просрочено' ? 'text-destructive' : 'text-muted-foreground'">{{ task.dueDate }}</span>
                </span>
              </div>
            </button>
          </li>
        </ul>

        <!-- Десктоп: таблица -->
        <div class="hidden overflow-hidden rounded-xl border md:block">
          <Table class="table-fixed">
            <TableHeader class="bg-muted/50">
              <TableRow>
                <TableHead class="w-20 pl-4">
                  <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" @click="setListSort('number')">№<component :is="sortIcon('number')" class="size-3.5 opacity-60" /></button>
                </TableHead>
                <TableHead>
                  <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" @click="setListSort('title')">Задача<component :is="sortIcon('title')" class="size-3.5 opacity-60" /></button>
                </TableHead>
                <TableHead class="hidden w-[24%] xl:table-cell">Описание</TableHead>
                <TableHead class="w-[19%]">
                  <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" @click="setListSort('assignee')">Исполнитель<component :is="sortIcon('assignee')" class="size-3.5 opacity-60" /></button>
                </TableHead>
                <TableHead class="w-28">
                  <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" @click="setListSort('priority')">Приоритет<component :is="sortIcon('priority')" class="size-3.5 opacity-60" /></button>
                </TableHead>
                <TableHead class="w-28">
                  <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" @click="setListSort('dueDate')">Срок<component :is="sortIcon('dueDate')" class="size-3.5 opacity-60" /></button>
                </TableHead>
                <TableHead class="w-32 pr-4">
                  <button type="button" class="inline-flex items-center gap-1 hover:text-foreground" @click="setListSort('status')">Статус<component :is="sortIcon('status')" class="size-3.5 opacity-60" /></button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="task in paginatedTasks" :key="task.id" class="cursor-pointer" @click="openTask(task.id)">
                <TableCell class="pl-4 text-muted-foreground tabular-nums">{{ getTaskNumber(task.id) }}</TableCell>
                <TableCell class="whitespace-normal" :title="taskListSubtitleTitle(task) || task.title">
                  <div class="grid gap-0.5">
                    <span class="line-clamp-2 font-medium">{{ task.title }}</span>
                    <span v-if="taskListContextLine(task)" class="truncate text-xs text-muted-foreground">{{ taskListContextLine(task) }}</span>
                  </div>
                </TableCell>
                <TableCell class="hidden whitespace-normal xl:table-cell" :title="taskListDescriptionFull(task)">
                  <span class="line-clamp-2 text-muted-foreground">{{ taskListDescriptionPreview(task) || '—' }}</span>
                </TableCell>
                <TableCell>
                  <div class="flex min-w-0 items-center gap-2">
                    <UserAvatar class="size-6 shrink-0 text-[10px] font-medium text-white" :style="avatarStyleByUserId(task.assignee.id)" :url="avatarUrlByUserId(task.assignee.id)" :initials="task.assignee.initials" />
                    <span class="truncate">{{ task.assignee.name }}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <UiBadge :tone="priorityTone(task.priority)">{{ priorityLabel(task.priority) }}</UiBadge>
                </TableCell>
                <TableCell class="tabular-nums" :class="task.description === 'Просрочено' ? 'font-medium text-destructive' : ''">
                  {{ task.dueDate }}
                </TableCell>
                <TableCell class="pr-4">
                  <UiBadge :tone="statusTone(task.status)">{{ statusTitle(task.status) }}</UiBadge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </template>
    </template>
    <UiPagination v-show="!tasksLoading && totalFiltered > 0" :page="currentPage" :page-size="pageSize" :total="totalFiltered" @update:page="goToPage" @update:page-size="(n) => (pageSize = n)" />

    <!-- Окно новой / редактируемой задачи — UiModal (Dialog shadcn) -->
    <UiModal
      v-if="showCreateModal"
      :title="editingTaskId ? 'Редактирование задачи' : 'Новая задача'"
      :description="editingTaskId ? `№ ${getTaskNumber(editingTaskId)}` : undefined"
      :max-width="672"
      @close="closeCreate"
    >
      <form id="task-create-form" class="tw-scope" @submit.prevent="createTask">
        <FormGrid :cols="2">
          <Alert v-if="formError" variant="destructive" class="sm:col-span-full">
            <AlertDescription>{{ formError }}</AlertDescription>
          </Alert>
          <FormField label="Название задачи" for="task-title" wide :count="form.title.length" :max="TASK_TITLE_MAX">
            <Input id="task-title" v-model="form.title" type="text" placeholder="Например, подготовка поля к посеву" :maxlength="TASK_TITLE_MAX" />
          </FormField>

          <FormField label="Исполнитель">
            <UiSelect v-if="isManager" v-model="form.assigneeId" block :options="[{ value: '', label: 'Без исполнителя' }, ...assignees.map((a) => ({ value: a.id, label: String(a.name) }))]" />
            <Input v-else model-value="Назначить себе" disabled />
          </FormField>
          <FormField label="Объект / поле">
            <UiSelect v-model="form.field" block :options="[{ value: '', label: 'Не выбрано' }, ...fields.map((f) => ({ value: f, label: String(f) }))]" />
          </FormField>

          <FormField v-if="isManager" label="Участники" wide>
            <template #label-actions>
              <UiPersonPicker
                :options="participantsAvailable.map((p) => ({ id: p.id, label: profileLabel(p) + (p.id === auth.user.value?.id ? ' (Вы)' : ''), initials: participantInitials(p), url: avatarUrlByUserId(p.id), avatarStyle: avatarStyleByUserId(p.id) }))"
                :all-added="participantsAvailable.length === 0"
                @pick="addParticipant"
              />
            </template>
            <div v-if="form.participantIds.length" class="flex flex-wrap gap-2">
              <span v-for="uid in form.participantIds" :key="uid" class="inline-flex h-8 items-center gap-2 rounded-full border bg-muted/40 pl-1 pr-1 text-sm">
                <UserAvatar
                  class="size-6 text-[10px] font-medium text-white"
                  :style="profileById(uid) ? avatarStyleByUserId(uid) : undefined"
                  :url="avatarUrlByUserId(uid)"
                  :initials="profileById(uid) ? participantInitials(profileById(uid)!) : '?'"
                />
                <span class="max-w-48 truncate">{{ profileById(uid) ? profileLabel(profileById(uid)!) : uid }}</span>
                <Button variant="ghost" size="icon-sm" type="button" class="size-6 rounded-full text-muted-foreground hover:text-destructive" aria-label="Убрать участника" @click="removeParticipant(uid)">
                  <XIcon />
                </Button>
              </span>
            </div>
            <p v-else class="text-sm text-muted-foreground">Участники видят задачу и получают уведомления.</p>
          </FormField>

          <FormField label="Приоритет">
            <UiSelect v-model="form.priority" block :options="[{ value: 'high', label: 'Высокий' }, { value: 'medium', label: 'Средний' }, { value: 'low', label: 'Низкий' }]" />
          </FormField>
          <FormField label="Срок выполнения">
            <UiDatePicker v-model="formDueDateIso" placeholder="Без срока" clearable block aria-label="Срок выполнения" />
          </FormField>
          <FormField label="Тип работ" wide>
            <UiSelect v-model="form.workType" block :options="[{ value: '', label: 'Не указано' }, ...workTypes.map((w) => ({ value: w, label: String(w) }))]" />
          </FormField>

          <FormField label="Описание и инструкции" for="task-desc" wide :count="form.description.length" :max="TASK_DESCRIPTION_MAX">
            <Textarea id="task-desc" v-model="form.description" class="min-h-24" placeholder="Что сделать, на что обратить внимание" rows="4" :maxlength="TASK_DESCRIPTION_MAX" />
          </FormField>

          <FormField label="Файлы" wide>
            <template v-if="pendingCreateFiles.length" #label-actions>
              <Button variant="outline" size="sm" type="button" :disabled="fileUploading" @click="triggerCreateFileInput">
                <PaperclipIcon />
                {{ fileUploading ? 'Загрузка…' : 'Добавить' }}
              </Button>
            </template>
            <ul v-if="pendingCreateFiles.length" class="grid gap-2 sm:grid-cols-2">
              <li v-for="file in pendingCreateFiles" :key="file.id" class="flex min-w-0 items-center gap-3 rounded-lg border p-2">
                <div class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                  <img v-if="file.previewUrl" class="size-full object-cover" :src="file.previewUrl" :alt="file.file.name" />
                  <FileTextIcon v-else-if="isPdfFile(file.file.name)" class="size-4" />
                  <FileIcon v-else class="size-4" />
                </div>
                <div class="grid min-w-0 flex-1">
                  <span class="truncate text-sm font-medium">{{ file.file.name }}</span>
                  <span class="text-xs text-muted-foreground">{{ formatFileSize(file.file.size) }}</span>
                </div>
                <UiDeleteButton size="xs" @click="removePendingCreateFile(file.id)" />
              </li>
            </ul>
            <button
              v-else
              type="button"
              class="flex h-20 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:border-ring hover:bg-muted/40 disabled:opacity-50"
              :disabled="fileUploading"
              @click="triggerCreateFileInput"
            >
              <PaperclipIcon class="size-4" />
              Фото, PDF или документы
            </button>
          </FormField>
        </FormGrid>
      </form>
      <template #actions>
        <UiButton @click="closeCreate">Отмена</UiButton>
        <UiButton variant="primary" type="submit" form="task-create-form" :disabled="!form.title.trim() || isSavingTask">
          {{ isSavingTask ? 'Сохранение...' : (editingTaskId ? 'Сохранить изменения' : 'Создать задачу') }}
        </UiButton>
      </template>
    </UiModal>

    <!-- Карточка задачи — UiModal (Dialog shadcn) -->
    <UiModal
      v-if="selectedTask"
      title="Задача"
      :description="`№ ${getTaskNumber(selectedTask.id)}`"
      :max-width="940"
      @close="closeTask"
    >
      <div class="tw-scope relative grid gap-6">
        <Alert v-if="taskModalError" variant="destructive">
          <AlertDescription>{{ taskModalError }}</AlertDescription>
        </Alert>
        <div v-if="isMetaInitialLoading" class="absolute inset-0 z-10 flex items-center justify-center bg-background/60" aria-hidden="true">
          <Spinner class="size-5 text-muted-foreground" />
        </div>

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <!-- Основное -->
          <div class="grid min-w-0 content-start gap-6">
            <div class="grid gap-3">
              <div class="flex flex-wrap gap-2">
                <UiBadge :tone="statusTone(selectedTask.status)">{{ statusTitle(selectedTask.status) }}</UiBadge>
                <UiBadge :tone="priorityTone(selectedTask.priority)">Приоритет: {{ priorityLabel(selectedTask.priority).toLowerCase() }}</UiBadge>
              </div>
              <h2 id="task-detail-title" class="text-lg font-semibold leading-snug break-words">{{ selectedTask.title }}</h2>
            </div>

            <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div class="grid gap-1.5">
                <dt class="text-xs text-muted-foreground">Исполнитель</dt>
                <dd class="flex min-w-0 items-center gap-2 text-sm">
                  <UserAvatar class="size-6 shrink-0 text-[10px] font-medium text-white" :style="avatarStyleByUserId(selectedTask.assignee.id)" :url="avatarUrlByUserId(selectedTask.assignee.id)" :initials="selectedTask.assignee.initials" />
                  <span class="truncate">{{ selectedTask.assignee.name }}</span>
                </dd>
              </div>
              <div class="grid gap-1.5">
                <dt class="text-xs text-muted-foreground">Статус</dt>
                <dd>
                  <UiSelect
                    :model-value="selectedTask.status"
                    size="sm"
                    :options="statusColumns.map((col) => ({ value: col.key, label: col.title }))"
                    aria-label="Статус задачи"
                    @update:model-value="(v) => selectedTask && updateTaskStatus(selectedTask.id, v as Status)"
                  />
                </dd>
              </div>
              <div class="grid gap-1.5">
                <dt class="text-xs text-muted-foreground">Срок</dt>
                <dd class="text-sm tabular-nums" :class="selectedTask.description === 'Просрочено' ? 'font-medium text-destructive' : ''">
                  до {{ selectedTask.dueDate }}<span v-if="selectedTask.description === 'Просрочено'"> · просрочено</span>
                </dd>
              </div>
              <div class="grid gap-1.5">
                <dt class="text-xs text-muted-foreground">Тип работ</dt>
                <dd class="text-sm">{{ selectedTask.workType || 'Не указано' }}</dd>
              </div>
              <div class="grid gap-1.5 sm:col-span-2">
                <dt class="text-xs text-muted-foreground">Объект / поле</dt>
                <dd class="text-sm">{{ selectedTask.field || 'Не выбрано' }}</dd>
              </div>
              <div v-if="selectedTask.participantIds.length" class="grid gap-1.5 sm:col-span-2">
                <dt class="text-xs text-muted-foreground">Участники</dt>
                <dd class="flex flex-wrap gap-2">
                  <span v-for="uid in selectedTask.participantIds" :key="uid" class="inline-flex h-7 items-center gap-2 rounded-full border bg-muted/40 pl-0.5 pr-3 text-sm">
                    <UserAvatar
                      class="size-6 text-[10px] font-medium text-white"
                      :style="profileById(uid) ? avatarStyleByUserId(uid) : undefined"
                      :url="avatarUrlByUserId(uid)"
                      :initials="profileById(uid) ? participantInitials(profileById(uid)!) : '?'"
                    />
                    <span class="max-w-48 truncate">{{ profileById(uid) ? profileLabel(profileById(uid)!) : uid }}</span>
                  </span>
                </dd>
              </div>
            </dl>

            <section class="grid gap-2">
              <h3 class="text-sm font-medium">Описание</h3>
              <p class="whitespace-pre-line text-sm leading-relaxed" :class="selectedTask.description ? '' : 'text-muted-foreground'">
                {{ selectedTask.description || 'Описание не указано' }}
              </p>
            </section>

            <section class="grid gap-3">
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-sm font-medium">Файлы</h3>
                <Button variant="outline" size="sm" type="button" :disabled="fileUploading" @click="triggerDetailFileInput">
                  <PaperclipIcon />
                  {{ fileUploading ? 'Загрузка…' : 'Добавить' }}
                </Button>
              </div>
              <ul v-if="taskFiles.length" class="grid gap-2 sm:grid-cols-2">
                <li v-for="file in taskFiles" :key="file.id" class="min-w-0">
                  <a
                    :href="getTaskFilePublicUrl(file.file_path)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex min-w-0 items-center gap-3 rounded-lg border p-2 text-inherit no-underline transition-colors hover:bg-muted/50"
                  >
                    <div class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                      <img v-if="isImageFile(file.file_name)" class="size-full object-cover" :src="getTaskFilePublicUrl(file.file_path)" :alt="file.file_name" />
                      <FileTextIcon v-else-if="isPdfFile(file.file_name)" class="size-4" />
                      <FileIcon v-else class="size-4" />
                    </div>
                    <div class="grid min-w-0 flex-1">
                      <span class="truncate text-sm font-medium">{{ file.file_name }}</span>
                      <span class="text-xs text-muted-foreground">{{ formatFileSize(file.file_size) }}</span>
                    </div>
                    <UiDeleteButton size="xs" @click.prevent="removeTaskFileRow(file)" />
                  </a>
                </li>
              </ul>
              <p v-else class="text-sm text-muted-foreground">Файлы пока не прикреплены.</p>
            </section>
          </div>

          <!-- Сбоку: автор и история -->
          <aside class="grid content-start gap-6 lg:border-l lg:pl-6">
            <section class="grid gap-3">
              <h3 class="text-sm font-medium">Автор</h3>
              <div class="flex min-w-0 items-center gap-3">
                <UserAvatar class="size-8 shrink-0 text-xs font-medium text-white" :style="avatarStyleByUserId(selectedTask.createdBy?.id ?? null)" :url="avatarUrlByUserId(selectedTask.createdBy?.id ?? null)" :initials="profileInitials(selectedTask.createdBy?.id ?? null)" />
                <div class="grid min-w-0">
                  <span class="truncate text-sm font-medium">{{ selectedTaskCreatorName }}</span>
                  <span class="text-xs text-muted-foreground">Создана {{ selectedTaskCreatedAt }}</span>
                </div>
              </div>
            </section>
            <Separator class="lg:hidden" />
            <section class="grid gap-3">
              <h3 class="text-sm font-medium">История</h3>
              <div v-if="eventsLoading" class="grid gap-2">
                <Skeleton v-for="i in 3" :key="i" class="h-8 w-full" />
              </div>
              <p v-else-if="!taskEvents.length" class="text-sm text-muted-foreground">История пока пуста</p>
              <ol v-else class="grid max-h-64 gap-3 overflow-y-auto pr-1">
                <li v-for="event in taskEvents.slice().reverse()" :key="event.id" class="relative grid gap-0.5 pl-4 text-sm before:absolute before:left-0 before:top-1.5 before:size-1.5 before:rounded-full before:bg-muted-foreground/40">
                  <span>
                    <span class="font-medium">{{ profileName(event.user_id) }}</span>
                    <span class="text-muted-foreground">
                      ·
                      <template v-if="event.event_type === 'status_changed'">
                        {{ statusTitle((event.payload?.from as Status) || 'todo') }} → {{ statusTitle((event.payload?.to as Status) || 'todo') }}
                      </template>
                      <template v-else>{{ taskEventLabel(event.event_type) }}</template>
                    </span>
                  </span>
                  <span class="text-xs text-muted-foreground">{{ formatDateTime(event.created_at) }}</span>
                </li>
              </ol>
            </section>
          </aside>
        </div>

        <Separator />

        <!-- Обсуждение -->
        <section class="grid gap-4">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-medium">
              Обсуждение<span v-if="taskComments.length" class="ml-1.5 font-normal text-muted-foreground">{{ taskComments.length }}</span>
            </h3>
            <Button
              v-if="taskComments.length > TASK_COMMENTS_PREVIEW"
              variant="ghost"
              size="sm"
              type="button"
              :disabled="commentsLoading"
              @click="isTaskChatExpanded = !isTaskChatExpanded"
            >
              {{ isTaskChatExpanded ? 'Свернуть' : `Показать все (${taskComments.length})` }}
            </Button>
          </div>
          <div v-if="commentsLoading" class="grid gap-2">
            <Skeleton v-for="i in 2" :key="i" class="h-12 w-full" />
          </div>
          <ul v-else-if="taskComments.length" class="grid gap-4">
            <li v-for="comment in visibleTaskComments" :key="comment.id" class="flex gap-3">
              <UserAvatar class="size-7 shrink-0 text-[10px] font-medium text-white" :style="avatarStyleByUserId(comment.user_id)" :url="avatarUrlByUserId(comment.user_id)" :initials="profileInitials(comment.user_id)" />
              <div class="grid min-w-0 gap-1">
                <div class="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span class="font-medium">{{ profileName(comment.user_id) }}</span>
                  <span class="text-xs text-muted-foreground">{{ formatDateTime(comment.created_at) }}</span>
                </div>
                <p class="whitespace-pre-line break-words text-sm leading-relaxed">{{ comment.message }}</p>
              </div>
            </li>
          </ul>
          <p v-else-if="!taskComments.length" class="text-sm text-muted-foreground">Комментариев пока нет.</p>
          <form class="grid gap-2" @submit.prevent="submitComment">
            <Textarea v-model="newCommentMessage" class="min-h-16" rows="2" placeholder="Комментарий для исполнителя" />
            <div class="flex justify-end">
              <Button type="submit" size="sm" :disabled="!newCommentMessage.trim() || isSendingComment">
                <Spinner v-if="isSendingComment" />
                Отправить
              </Button>
            </div>
          </form>
        </section>
      </div>
      <template #actions>
        <UiButton v-if="canDeleteSelectedTask" variant="danger-quiet" class="sm:mr-auto" @click="deleteTask">Удалить</UiButton>
        <UiButton @click="openEdit">Редактировать</UiButton>
        <UiButton variant="primary" @click="closeTask">Закрыть</UiButton>
      </template>
    </UiModal>

    <UiSuccessModal
      :open="successModalOpen"
      title="Задача создана"
      message="Новая задача успешно добавлена."
      button-text="Отлично"
      @close="successModalOpen = false"
    />
    <input
      ref="createFileInputRef"
      type="file"
      class="hidden"
      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
      multiple
      @change="onCreateFilesSelected"
    />
    <input
      ref="detailFileInputRef"
      type="file"
      class="hidden"
      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
      multiple
      @change="onDetailFilesSelected"
    />

  </section>
</template>

