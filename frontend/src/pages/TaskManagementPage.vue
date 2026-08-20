<script setup lang="ts">
import { computed, ref, watch, onMounted, onActivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loadPdfTools } from '@/lib/pdfExport'
import { useAuth } from '@/stores/auth'
import CalendarPopover from '@/components/CalendarPopover.vue'
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
import UserAvatar from '@/components/UserAvatar.vue'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
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
    await uploadPendingFiles(createdTask.id)
    if (isManager.value && form.value.participantIds.length) {
      await syncTaskParticipants(createdTask.id, form.value.participantIds)
    }
    await loadData()
    successModalOpen.value = true
  } catch {
    // skip if no Supabase
  } finally {
    isSavingTask.value = false
  }
  closeCreate()
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
  try {
    const uploaded = await Promise.all(files.map((file) => uploadTaskFile(selectedTaskId.value as string, file)))
    taskFiles.value = [...uploaded.reverse(), ...taskFiles.value]
  } catch (err) {
    console.error(err)
  } finally {
    fileUploading.value = false
    input.value = ''
  }
}

async function removeTaskFileRow(fileRow: TaskFileRow) {
  if (!isSupabaseConfigured()) return
  try {
    await deleteTaskFile(fileRow.id)
    taskFiles.value = taskFiles.value.filter((file) => file.id !== fileRow.id)
  } catch (err) {
    console.error(err)
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
    } catch (err) {
      // Откат был и раньше, но молча: карточка возвращалась на место,
      // и это выглядело как промах мышью, а не как отказ сервера.
      if (t && prevStatus !== undefined) t.status = prevStatus
      boardError.value = formatSupabaseError(err) || 'Не удалось изменить статус задачи'
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
  } catch (err) {
    taskModalError.value = formatSupabaseError(err) || 'Не удалось отправить комментарий'
  } finally {
    isSendingComment.value = false
  }
}

async function deleteTask() {
  if (!selectedTaskId.value || !selectedTask.value) return
  if (!canDeleteSelectedTask.value) return
  if (!confirm('Удалить эту задачу?')) return
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

const CSV_SEP = '\t'

function escapeCsvCell(val: string): string {
  const s = String(val ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""')
  return s.includes(CSV_SEP) || s.includes('"') || s.includes('\r') ? `"${s}"` : s
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
  const line = (arr: string[]) => arr.map(escapeCsvCell).join(CSV_SEP)
  const csv = '\uFEFF' + [line(headers), ...rows.map((r) => line(r))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `задачи_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
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
    const { html2canvas, jsPDF } = await loadPdfTools()
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false })
    document.body.removeChild(el)
    const imgData = canvas.toDataURL('image/png')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 10
    const maxW = pageW - margin * 2
    const maxH = pageH - margin * 2
    let w = maxW
    let h = (canvas.height / canvas.width) * w
    if (h > maxH) {
      h = maxH
      w = (canvas.width / canvas.height) * h
    }
    doc.addImage(imgData, 'PNG', margin, margin, w, h)
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (e) {
    document.body.removeChild(el)
    boardError.value = formatSupabaseError(e) || 'Не удалось сформировать PDF'
  }
}

function priorityClass(p: Priority) {
  return { high: 'priority-high', medium: 'priority-medium', low: 'priority-low' }[p]
}
function statusClass(s: Status) {
  return {
    todo: 'status-todo',
    in_progress: 'status-in-progress',
    review: 'status-review',
    done: 'status-done',
  }[s]
}
</script>

<template>
  <section class="task-management-page page-enter-item">
    <p v-if="boardError" class="tm-error" role="alert">{{ boardError }}</p>
    <header class="task-header">
      <div class="task-header-left">
        <div class="task-filter-row">
          <div class="task-filter-tabs">
            <button
              v-for="f in filters"
              :key="f.key"
              type="button"
              class="task-filter-tab"
              :class="{ 'task-filter-tab--active': activeFilter === f.key }"
              @click="activeFilter = f.key"
            >
              {{ f.label }}
            </button>
          </div>
          <select
            v-if="isManager"
            v-model="filterEmployeeId"
            class="task-filter-pill task-filter-pill--select"
            title="Сотрудник"
            :disabled="!assignees.length"
          >
            <option value="">Все сотрудники</option>
            <option :value="TASK_ASSIGNEE_FILTER_UNASSIGNED">Без исполнителя</option>
            <option
              v-for="a in assignees"
              :key="a.id"
              :value="a.id"
            >
              {{ a.name }}
            </option>
          </select>
          <select
            v-model="filterStatus"
            class="task-filter-pill task-filter-pill--select"
            title="Статус"
          >
            <option value="">Все статусы</option>
            <option
              v-for="col in statusColumns"
              :key="col.key"
              :value="col.key"
            >
              {{ col.title }}
            </option>
          </select>
          <div class="task-filter-dates">
            <span class="task-filter-date-label">С</span>
            <CalendarPopover v-model="dateFromInput" placeholder="Дата с" />
            <span class="task-filter-date-label">По</span>
            <CalendarPopover v-model="dateToInput" placeholder="Дата по" />
            <button type="button" class="task-filter-tab task-filter-apply-dates" @click="applyDateFilter">
              Применить
            </button>
          </div>
        </div>
      </div>
      <div class="task-header-actions">
        <div class="task-search-wrap">
          <span class="task-search-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </span>
          <input
            v-model.trim="searchTaskNumber"
            type="text"
            inputmode="numeric"
            class="task-search-input"
            placeholder="Поиск по номеру"
          />
        </div>
        <div class="task-export-btns">
          <button
            type="button"
            class="task-btn-export action_has has_saved"
            :disabled="!filteredTasks.length"
            title="Экспорт в PDF (предпросмотр)"
            @click="exportToPdf"
          >
            <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" data-path="box" />
              <path d="M14 2v6h6" data-path="line-top" />
              <path d="M12 18v-6" data-path="line-bottom" />
              <path d="M9 15h6" />
            </svg>
            PDF
          </button>
          <button
            type="button"
            class="task-btn-export action_has has_saved"
            :disabled="!filteredTasks.length"
            title="Экспорт в Excel"
            @click="exportToExcel"
          >
            <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" data-path="box" />
              <path d="M14 2v6h6" data-path="line-top" />
              <path d="M8 13h2" data-path="line-bottom" />
              <path d="M8 17h2" />
              <path d="M14 13h2" />
              <path d="M14 17h2" />
            </svg>
            Excel
          </button>
        </div>
        <button type="button" class="task-btn-create" @click="openCreate">
          <svg class="task-header-icon task-btn-create-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
          Создать задачу
        </button>
      </div>
    </header>

    <div v-if="tasksLoading" class="task-loading" role="status" aria-live="polite">
      <UiLoadingBar />
    </div>
    <div v-show="!tasksLoading" class="task-list-wrap">
      <div class="task-list-table-wrapper">
        <table class="task-list-table">
          <thead>
            <tr>
              <th class="task-list-cell-num">
                <button type="button" class="task-list-sort-btn" @click="setListSort('number')">
                  №
                  <span class="task-list-sort-indicator">{{ sortIndicator('number') === 'asc' ? '↑' : sortIndicator('number') === 'desc' ? '↓' : '↕' }}</span>
                </button>
              </th>
              <th>
                <button type="button" class="task-list-sort-btn" @click="setListSort('title')">
                  Название задачи
                  <span class="task-list-sort-indicator">{{ sortIndicator('title') === 'asc' ? '↑' : sortIndicator('title') === 'desc' ? '↓' : '↕' }}</span>
                </button>
              </th>
              <th class="task-list-cell-desc-header">Описание</th>
              <th>
                <button type="button" class="task-list-sort-btn" @click="setListSort('assignee')">
                  Исполнитель
                  <span class="task-list-sort-indicator">{{ sortIndicator('assignee') === 'asc' ? '↑' : sortIndicator('assignee') === 'desc' ? '↓' : '↕' }}</span>
                </button>
              </th>
              <th>
                <button type="button" class="task-list-sort-btn" @click="setListSort('priority')">
                  Приоритет
                  <span class="task-list-sort-indicator">{{ sortIndicator('priority') === 'asc' ? '↑' : sortIndicator('priority') === 'desc' ? '↓' : '↕' }}</span>
                </button>
              </th>
              <th>
                <button type="button" class="task-list-sort-btn" @click="setListSort('dueDate')">
                  Срок
                  <span class="task-list-sort-indicator">{{ sortIndicator('dueDate') === 'asc' ? '↑' : sortIndicator('dueDate') === 'desc' ? '↓' : '↕' }}</span>
                </button>
              </th>
              <th>
                <button type="button" class="task-list-sort-btn" @click="setListSort('status')">
                  Статус
                  <span class="task-list-sort-indicator">{{ sortIndicator('status') === 'asc' ? '↑' : sortIndicator('status') === 'desc' ? '↓' : '↕' }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(task, index) in paginatedTasks"
              :key="task.id"
              class="task-list-row"
              @click="openTask(task.id)"
            >
              <td class="task-list-cell-num" data-label="№">{{ getTaskNumber(task.id) }}</td>
              <td class="task-list-cell-title" data-label="Название задачи">
                <div class="task-list-title-cell" :title="taskListSubtitleTitle(task) || task.title">
                  <span class="task-list-title-main">{{ task.title }}</span>
                  <span v-if="taskListContextLine(task)" class="task-list-title-meta">
                    {{ taskListContextLine(task) }}
                  </span>
                </div>
              </td>
              <td
                class="task-list-cell-desc"
                data-label="Описание"
                :title="taskListDescriptionFull(task)"
              >
                <span v-if="taskListDescriptionPreview(task)" class="task-list-desc">
                  {{ taskListDescriptionPreview(task) }}
                </span>
                <span v-else class="task-list-desc-empty">—</span>
              </td>
              <td class="task-list-cell-assignee" data-label="Исполнитель">
                <div class="task-list-assignee-inner">
                  <UserAvatar class="task-list-avatar" :style="avatarStyleByUserId(task.assignee.id)" :url="avatarUrlByUserId(task.assignee.id)" :initials="task.assignee.initials" />
                  <span class="task-list-assignee-name">{{ task.assignee.name }}</span>
                </div>
              </td>
              <td class="task-list-cell-priority" data-label="Приоритет">
                <span class="task-pill" :class="priorityClass(task.priority)">
                  {{ task.priority === 'high' ? 'Высокий' : task.priority === 'medium' ? 'Средний' : 'Низкий' }}
                </span>
              </td>
              <td data-label="Срок" :class="{ 'task-cell-overdue': task.description === 'Просрочено' }">
                <template v-if="task.description === 'Просрочено'">
                  <span class="task-overdue-icon" aria-hidden="true">△</span>
                  {{ task.dueDate }}
                </template>
                <template v-else>{{ task.dueDate }}</template>
              </td>
              <td data-label="Статус">
                <span
                  class="task-pill task-pill-status"
                  :class="statusClass(task.status)"
                >
                  {{ statusColumns.find((c) => c.key === task.status)?.title }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-show="!tasksLoading && totalFiltered > 0" class="task-pagination">
      <span class="task-pagination-info">
        Показано {{ paginationStart }}–{{ paginationEnd }} из {{ totalFiltered }}
      </span>
      <div class="task-pagination-right">
        <div class="task-pagination-nav">
          <button
            type="button"
            class="task-pagination-arrow"
            :disabled="currentPage <= 1"
            aria-label="Предыдущая страница"
            @click="currentPage = currentPage - 1"
          >
            &lt;
          </button>
          <template v-for="(p, i) in pageNumbers" :key="p === 'ellipsis' ? `e-${i}` : p">
            <button
              v-if="p !== 'ellipsis'"
              type="button"
              class="task-pagination-num"
              :class="{ 'task-pagination-num--active': p === currentPage }"
              @click="goToPage(p)"
            >
              {{ p }}
            </button>
            <span v-else class="task-pagination-ellipsis">…</span>
          </template>
          <button
            type="button"
            class="task-pagination-arrow"
            :disabled="currentPage >= totalPages"
            aria-label="Следующая страница"
            @click="currentPage = currentPage + 1"
          >
            &gt;
          </button>
        </div>
        <label class="task-pagination-size">
          <span class="task-filter-select-label">На странице</span>
          <select v-model.number="pageSize" class="task-filter-select task-pagination-select">
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
          </select>
        </label>
      </div>
    </div>

    <!-- Modal: New Task (оформление как модалка календаря) -->
    <Teleport to="body">
      <div v-if="showCreateModal" class="task-modal-backdrop tm-modal-backdrop" @click.self="closeCreate">
        <div class="modal modal-tm-form" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" @click.stop>
          <form class="modal-form modal-form--design" @submit.prevent="createTask">
            <div class="modal-header modal-header--design">
              <div class="modal-header-main">
                <div class="modal-icon modal-icon--design" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                    <path d="M9 12h6" />
                    <path d="M9 16h6" />
                  </svg>
                </div>
                <div class="modal-header-text">
                  <h2 id="task-modal-title" class="modal-title modal-title--design">
                    {{ editingTaskId ? 'Редактирование задачи' : 'Новая задача' }}
                  </h2>
                  <p v-if="editingTaskId" class="modal-task-id modal-task-id--design">
                    № {{ getTaskNumber(editingTaskId) }}
                  </p>
                </div>
              </div>
              <ModalCloseButton @click="closeCreate" />
            </div>
            <fieldset class="modal-form-fieldset">
              <div class="modal-body">
                <label class="modal-field modal-field--design">
                  <span class="modal-label modal-label--design">Название задачи</span>
                  <input
                    v-model="form.title"
                    type="text"
                    class="modal-input modal-input--design modal-input--title task-form-input"
                    placeholder="Введите название..."
                    :maxlength="TASK_TITLE_MAX"
                  />
                  <div class="task-form-counter">{{ form.title.length }}/{{ TASK_TITLE_MAX }}</div>
                </label>
                <div class="modal-grid-2">
                  <label class="modal-field modal-field--design">
                    <span class="modal-label modal-label--design">Исполнитель</span>
                    <div v-if="isManager" class="task-form-select-wrap">
                      <UserAvatar
                        class="task-form-avatar"
                        :style="avatarStyleByUserId(form.assigneeId || null)"
                        :url="avatarUrlByUserId(form.assigneeId || null)"
                        :initials="form.assigneeId ? (assignees.find((a) => a.id === form.assigneeId)?.initials ?? '?') : '—'"
                      />
                      <select v-model="form.assigneeId" class="modal-input modal-input--design modal-select modal-select--design task-form-select">
                        <option value="">Без исполнителя</option>
                        <option v-for="a in assignees" :key="a.id" :value="a.id">{{ a.name }}</option>
                      </select>
                    </div>
                    <div v-else class="task-form-static-assignee modal-input modal-input--design">Назначить себе</div>
                  </label>
                  <label class="modal-field modal-field--design">
                    <span class="modal-label modal-label--design">Объект / поле</span>
                    <select v-model="form.field" class="modal-input modal-input--design modal-select modal-select--design task-form-select">
                      <option value="">Не выбрано</option>
                      <option v-for="f in fields" :key="f" :value="f">{{ f }}</option>
                    </select>
                  </label>
                </div>
                <div v-if="isManager" class="modal-field modal-field--design">
                  <div class="modal-label-row modal-label-row--design">
                    <span class="modal-label modal-label--design">Участники задачи</span>
                    <div class="modal-assignee-picker">
                      <button
                        type="button"
                        class="modal-add-assignee-btn modal-add-assignee-btn--design"
                        @click="toggleParticipantPicker"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" x2="12" y1="8" y2="16" />
                          <line x1="8" x2="16" y1="12" y2="12" />
                        </svg>
                        Добавить
                      </button>
                      <div v-if="participantPickerOpen" class="modal-assignee-dropdown">
                        <div class="modal-assignee-search">
                          <svg class="modal-assignee-search-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="7" />
                            <line x1="16.65" y1="16.65" x2="21" y2="21" />
                          </svg>
                          <input
                            v-model="participantSearch"
                            type="text"
                            class="modal-assignee-search-input"
                            placeholder="Поиск по имени или email"
                          />
                        </div>
                        <button
                          v-for="p in participantOptions"
                          :key="p.id"
                          type="button"
                          class="modal-assignee-option"
                          @click="addParticipant(p.id)"
                        >
                          <UserAvatar class="modal-assignee-option-avatar" :style="avatarStyleByUserId(p.id)" :url="avatarUrlByUserId(p.id)" :initials="participantInitials(p)" />
                          <span class="modal-assignee-option-label">{{ profileLabel(p) }}{{ p.id === auth.user.value?.id ? ' (Вы)' : '' }}</span>
                        </button>
                        <p v-if="participantOptions.length === 0" class="modal-assignee-empty">
                          {{ participantsAvailable.length === 0 ? 'Все добавлены' : 'Ничего не найдено' }}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div class="modal-chips modal-chips--design">
                    <div
                      v-for="uid in form.participantIds"
                      :key="uid"
                      class="modal-chip modal-chip--design"
                    >
                      <UserAvatar
                        class="modal-chip-avatar modal-chip-avatar--design"
                        :style="profileById(uid) ? avatarStyleByUserId(uid) : undefined"
                        :url="avatarUrlByUserId(uid)"
                        :initials="profileById(uid) ? participantInitials(profileById(uid)!) : '?'"
                      />
                      <span class="modal-chip-label">{{ profileById(uid) ? profileLabel(profileById(uid)!) : uid }}</span>
                      <button type="button" class="modal-chip-remove" aria-label="Убрать" @click="removeParticipant(uid)">×</button>
                    </div>
                  </div>
                </div>
                <label class="modal-field modal-field--design tm-form-field--half">
                  <span class="modal-label modal-label--design">Приоритет</span>
                  <select v-model="form.priority" class="modal-input modal-input--design modal-select modal-select--design task-form-select">
                    <option value="high">Высокий</option>
                    <option value="medium">Средний</option>
                    <option value="low">Низкий</option>
                  </select>
                </label>
                <div class="modal-grid-2">
                  <label class="modal-field modal-field--design">
                    <span class="modal-label modal-label--design">Срок выполнения</span>
                    <input
                      v-model="form.dueDate"
                      type="text"
                      class="modal-input modal-input--design task-form-input task-form-input--date"
                      placeholder="ДД.ММ.ГГГГ"
                    />
                  </label>
                  <label class="modal-field modal-field--design">
                    <span class="modal-label modal-label--design">Тип работ</span>
                    <select v-model="form.workType" class="modal-input modal-input--design modal-select modal-select--design task-form-select">
                      <option value="">Не указано</option>
                      <option v-for="w in workTypes" :key="w" :value="w">{{ w }}</option>
                    </select>
                  </label>
                </div>
                <label class="modal-field modal-field--design">
                  <span class="modal-label modal-label--design">Описание и инструкции</span>
                  <textarea
                    v-model="form.description"
                    class="modal-textarea modal-textarea--design task-form-textarea"
                    placeholder="Добавьте подробности для исполнителя..."
                    rows="4"
                    :maxlength="TASK_DESCRIPTION_MAX"
                  ></textarea>
                  <div class="task-form-counter">{{ form.description.length }}/{{ TASK_DESCRIPTION_MAX }}</div>
                </label>
                <div class="modal-field modal-field--design">
                  <div class="task-file-section">
                    <div class="task-file-section-head">
                      <span class="modal-label modal-label--design">Прикрепленные файлы</span>
                      <button type="button" class="task-file-add-btn" :disabled="fileUploading" @click="triggerCreateFileInput">
                        {{ fileUploading ? 'Загрузка...' : 'Добавить файлы' }}
                      </button>
                    </div>
                    <div v-if="pendingCreateFiles.length" class="task-files-grid">
                      <div v-for="file in pendingCreateFiles" :key="file.id" class="task-file-card">
                        <div class="task-file-icon-box">
                          <img v-if="file.previewUrl" class="task-file-thumb" :src="file.previewUrl" :alt="file.file.name" />
                          <svg v-else-if="isPdfFile(file.file.name)" class="task-file-icon-pdf" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                            <path d="M9 13h6" />
                            <path d="M9 17h6" />
                          </svg>
                          <svg v-else class="task-file-icon-doc" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                          </svg>
                        </div>
                        <div class="task-file-info">
                          <span class="task-file-name">{{ file.file.name }}</span>
                          <span class="task-file-size">{{ formatFileSize(file.file.size) }}</span>
                        </div>
                        <UiDeleteButton size="xs" @click="removePendingCreateFile(file.id)" />
                      </div>
                    </div>
                    <button
                      v-else
                      type="button"
                      class="modal-attach-placeholder modal-attach-placeholder--design task-file-dropzone"
                      :disabled="fileUploading"
                      @click="triggerCreateFileInput"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                      <span>Добавьте фото, PDF или документы к задаче</span>
                    </button>
                  </div>
                </div>
              </div>
              <div class="modal-actions modal-actions--design">
                <div class="modal-actions-right">
                  <button type="button" class="modal-btn-ghost modal-btn-ghost--design" @click="closeCreate">Отмена</button>
                  <button type="submit" class="modal-btn modal-btn--design" :disabled="!form.title.trim() || isSavingTask">
                    {{ isSavingTask ? 'Сохранение...' : (editingTaskId ? 'Сохранить изменения' : 'Создать задачу') }}
                  </button>
                </div>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- Modal: Task detail -->
    <Teleport to="body">
      <div v-if="selectedTask" class="task-modal-backdrop tm-modal-backdrop" @click.self="closeTask">
        <div class="modal modal-tm-detail task-modal--detail" role="dialog" aria-labelledby="task-detail-title" @click.stop>
          <div class="modal-header modal-header--design">
            <div class="modal-header-main">
              <div class="modal-icon modal-icon--design" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                  <path d="M9 12h6" />
                  <path d="M9 16h6" />
                </svg>
              </div>
              <div class="modal-header-text">
                <h2 id="task-detail-header-title" class="modal-title modal-title--design">Задача</h2>
                <p class="modal-task-id modal-task-id--design">№ {{ getTaskNumber(selectedTask.id) }}</p>
              </div>
            </div>
            <ModalCloseButton @click="closeTask" />
          </div>
          <p v-if="taskModalError" class="tm-error tm-error--modal" role="alert">{{ taskModalError }}</p>
          <div class="task-detail-layout">
            <div v-if="isMetaInitialLoading" class="task-detail-loading-overlay" aria-hidden="true">
              <UiLoadingBar size="md" />
            </div>
            <div class="task-detail-main">
              <div class="task-detail-badges">
                <span
                  class="task-pill task-pill-status"
                  :class="selectedTask ? statusClass(selectedTask.status) : ''"
                >
                  {{ statusColumns.find((c) => c.key === selectedTask?.status)?.title }}
                </span>
                <span class="task-pill" :class="priorityClass(selectedTask.priority)">
                  {{ selectedTask.priority === 'high' ? 'Высокий приоритет' : selectedTask.priority === 'medium' ? 'Средний' : 'Низкий' }}
                </span>
              </div>
              <h2 id="task-detail-title" class="task-detail-title">
                {{ truncateTaskTitle(selectedTask.title) }}
              </h2>
              <dl class="task-detail-list">
                <div class="task-detail-item">
                  <dt class="task-detail-label">Номер задачи</dt>
                  <dd class="task-detail-value">№ {{ getTaskNumber(selectedTask.id) || '—' }}</dd>
                </div>
                <div class="task-detail-item">
                  <dt class="task-detail-label">Исполнитель</dt>
                  <dd class="task-detail-value">
                    <UserAvatar class="task-detail-avatar" :style="avatarStyleByUserId(selectedTask.assignee.id)" :url="avatarUrlByUserId(selectedTask.assignee.id)" :initials="selectedTask.assignee.initials" />
                    {{ selectedTask.assignee.name }}
                  </dd>
                </div>
                <div class="task-detail-item">
                  <dt class="task-detail-label">Статус</dt>
                  <dd class="task-detail-value">
                    <select
                      :value="selectedTask.status"
                      class="task-detail-status-select"
                      @change="(e) => selectedTask && updateTaskStatus(selectedTask.id, (e.target as HTMLSelectElement).value as Status)"
                    >
                      <option v-for="col in statusColumns" :key="col.key" :value="col.key">
                        {{ col.title }}
                      </option>
                    </select>
                  </dd>
                </div>
                <div class="task-detail-item">
                  <dt class="task-detail-label">Срок выполнения</dt>
                  <dd class="task-detail-value" :class="{ 'task-detail-overdue': selectedTask.description === 'Просрочено' }">
                    до {{ selectedTask.dueDate }}
                    <span v-if="selectedTask.description === 'Просрочено'" class="task-overdue"> (Просрочено)</span>
                  </dd>
                </div>
                <div class="task-detail-item">
                  <dt class="task-detail-label">Тип работ</dt>
                  <dd class="task-detail-value">
                    {{ selectedTask.workType || 'Не указано' }}
                  </dd>
                </div>
                <div class="task-detail-item">
                  <dt class="task-detail-label">Локация</dt>
                  <dd class="task-detail-value">
                    <span class="task-detail-field-value">{{ selectedTask.field || 'Не выбрано' }}</span>
                  </dd>
                </div>
              </dl>
              <div
                v-if="selectedTask.participantIds.length"
                class="task-detail-participants-section"
              >
                <span class="modal-label modal-label--design">Участники задачи</span>
                <div class="modal-chips modal-chips--design">
                  <div
                    v-for="uid in selectedTask.participantIds"
                    :key="uid"
                    class="modal-chip modal-chip--design modal-chip--readonly"
                  >
                    <UserAvatar
                      class="modal-chip-avatar modal-chip-avatar--design"
                      :style="profileById(uid) ? avatarStyleByUserId(uid) : undefined"
                      :url="avatarUrlByUserId(uid)"
                      :initials="profileById(uid) ? participantInitials(profileById(uid)!) : '?'"
                    />
                    <span class="modal-chip-label">{{ profileById(uid) ? profileLabel(profileById(uid)!) : uid }}</span>
                  </div>
                </div>
              </div>
              <div class="task-detail-desc-wrap">
                <span class="task-detail-label">Описание задачи</span>
                <div class="task-detail-desc">
                  {{ selectedTask.description || 'Описание не указано' }}
                </div>
              </div>
              <div class="task-detail-desc-wrap">
                <div class="task-file-section-head">
                  <span class="task-detail-label">Файлы задачи</span>
                  <button type="button" class="task-file-add-btn" :disabled="fileUploading" @click="triggerDetailFileInput">
                    {{ fileUploading ? 'Загрузка...' : 'Добавить файлы' }}
                  </button>
                </div>
                <div v-if="taskFiles.length" class="task-files-grid">
                  <a
                    v-for="file in taskFiles"
                    :key="file.id"
                    :href="getTaskFilePublicUrl(file.file_path)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="task-file-card"
                  >
                    <div class="task-file-icon-box">
                      <img v-if="isImageFile(file.file_name)" class="task-file-thumb" :src="getTaskFilePublicUrl(file.file_path)" :alt="file.file_name" />
                      <svg v-else-if="isPdfFile(file.file_name)" class="task-file-icon-pdf" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                        <path d="M9 13h6" />
                        <path d="M9 17h6" />
                      </svg>
                      <svg v-else class="task-file-icon-doc" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                      </svg>
                    </div>
                    <div class="task-file-info">
                      <span class="task-file-name">{{ file.file_name }}</span>
                      <span class="task-file-size">{{ formatFileSize(file.file_size) }}</span>
                    </div>
                    <UiDeleteButton size="xs" @click.prevent="removeTaskFileRow(file)" />
                  </a>
                </div>
                <div v-else class="task-file-empty">Файлы пока не прикреплены.</div>
              </div>
            </div>
            <aside class="task-detail-sidebar">
              <section class="task-detail-card">
                <h3 class="task-detail-card-title">Информация о задаче</h3>
                <div class="task-detail-info-row">
                  <UserAvatar class="task-detail-info-avatar" :style="avatarStyleByUserId(selectedTask.createdBy?.id ?? null)" :url="avatarUrlByUserId(selectedTask.createdBy?.id ?? null)" :initials="profileInitials(selectedTask.createdBy?.id ?? null)" />
                  <div class="task-detail-info-main">
                    <div class="task-detail-info-name">{{ selectedTaskCreatorName }}</div>
                    <div class="task-detail-info-role">Автор задачи</div>
                  </div>
                </div>
                <div class="task-detail-info-meta">
                  <div class="task-detail-info-meta-item">
                    <span class="task-detail-info-meta-label">Создана</span>
                    <span class="task-detail-info-meta-value">{{ selectedTaskCreatedAt }}</span>
                  </div>
                </div>
              </section>
              <section class="task-detail-card task-detail-card--history">
                <h3 class="task-detail-card-title">История изменений</h3>
                <div v-if="eventsLoading" class="task-history-loading">
                  <UiLoadingBar size="compact" />
                </div>
                <ul v-else class="task-history-list">
                  <li v-if="!taskEvents.length" class="task-history-empty">История пока пуста</li>
                  <li v-for="event in taskEvents" :key="event.id" class="task-history-item">
                    <div class="task-history-dot" aria-hidden="true"></div>
                    <div class="task-history-content">
                      <div class="task-history-text">
                        <span class="task-history-author">{{ profileName(event.user_id) }}</span>
                        <span class="task-history-sep">·</span>
                        <span class="task-history-event">
                          <template v-if="event.event_type === 'status_changed'">
                            Статус:
                            {{
                              statusTitle(
                                (event.payload?.from as Status) || 'todo',
                              )
                            }}
                            →
                            {{
                              statusTitle(
                                (event.payload?.to as Status) || 'todo',
                              )
                            }}
                          </template>
                          <template v-else-if="event.event_type === 'comment_added'">
                            Добавлен комментарий
                          </template>
                          <template v-else-if="event.event_type === 'created'">
                            Задача создана
                          </template>
                          <template v-else>
                            {{ event.event_type }}
                          </template>
                        </span>
                      </div>
                      <div class="task-history-time">
                        {{ formatDateTime(event.created_at) }}
                      </div>
                    </div>
                  </li>
                </ul>
              </section>
            </aside>
          </div>
          <section class="task-chat">
            <div class="task-chat-header">
              <h3 class="task-chat-title">Обсуждение задачи</h3>
              <button
                type="button"
                class="task-chat-toggle"
                :disabled="commentsLoading || !taskComments.length"
                @click="isTaskChatExpanded = !isTaskChatExpanded"
              >
                {{ isTaskChatExpanded ? 'Скрыть' : 'Показать все' }}
              </button>
            </div>
            <div v-if="commentsLoading" class="task-chat-loading">
              <UiLoadingBar size="compact" />
            </div>
            <div v-else-if="isTaskChatExpanded" class="task-chat-body">
              <div v-if="!taskComments.length" class="task-chat-empty">
                Пока нет комментариев. Напишите первый.
              </div>
              <ul v-else class="task-chat-list">
                <li v-for="comment in taskComments" :key="comment.id" class="task-chat-item">
                  <UserAvatar class="task-chat-avatar" :style="avatarStyleByUserId(comment.user_id)" :url="avatarUrlByUserId(comment.user_id)" :initials="profileInitials(comment.user_id)" />
                  <div class="task-chat-message">
                    <div class="task-chat-meta">
                      <span class="task-chat-author">{{ profileName(comment.user_id) }}</span>
                      <span class="task-chat-dot">·</span>
                      <span class="task-chat-time">{{ formatDateTime(comment.created_at) }}</span>
                    </div>
                    <div class="task-chat-text">
                      {{ comment.message }}
                    </div>
                  </div>
                </li>
              </ul>
            </div>
            <div v-else class="task-chat-collapsed-hint">
              {{ taskComments.length ? `Комментариев: ${taskComments.length}` : 'Пока нет комментариев. Напишите первый.' }}
            </div>
            <form class="task-chat-input-row" @submit.prevent="submitComment">
              <textarea
                v-model="newCommentMessage"
                class="task-chat-input"
                rows="2"
                placeholder="Напишите комментарий для исполнителя..."
              ></textarea>
              <button type="submit" class="task-chat-send" :class="{ 'task-chat-send--loading': isSendingComment }" :disabled="!newCommentMessage.trim() || isSendingComment">
                <span v-if="!isSendingComment">Отправить</span>
                <UiLoadingBar v-else size="micro" hide-label class="task-chat-send-loader" />
              </button>
            </form>
          </section>
          <div class="modal-actions modal-actions--design task-detail-actions">
            <div v-if="canDeleteSelectedTask" class="task-detail-del-wrap">
              <UiDeleteButton size="md" @click="deleteTask" />
            </div>
            <div class="modal-actions-right">
              <button type="button" class="modal-btn-ghost modal-btn-ghost--design" @click="openEdit">
                Редактировать
              </button>
              <button type="button" class="modal-btn modal-btn--design" @click="closeTask">
                Закрыть
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

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
      class="task-file-input-hidden"
      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
      multiple
      @change="onCreateFilesSelected"
    />
    <input
      ref="detailFileInputRef"
      type="file"
      class="task-file-input-hidden"
      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
      multiple
      @change="onDetailFilesSelected"
    />

  </section>
</template>

<style scoped src="./TaskManagementPage.css"></style>
