<script setup lang="ts">
import { computed, ref, watch, onMounted, onActivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
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
  } catch {
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
  } catch {
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
    } catch {
      if (t && prevStatus !== undefined) t.status = prevStatus
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
  } catch {
    // ignore for now
  } finally {
    isSendingComment.value = false
  }
}

async function deleteTask() {
  if (!selectedTaskId.value || !selectedTask.value) return
  if (!canDeleteSelectedTask.value) return
  if (!confirm('Удалить эту задачу?')) return
  if (isSupabaseConfigured()) {
    try {
      await deleteTaskApi(selectedTaskId.value, selectedTask.value.createdBy?.id ?? null)
      await loadData()
    } catch {
      tasks.value = tasks.value.filter((t) => t.id !== selectedTaskId.value)
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
  } catch {
    document.body.removeChild(el)
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

<style scoped>
.task-management-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

.task-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-lg);
  min-height: 280px;
  padding: var(--space-xl);
}

.task-form-static-assignee {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--chip-bg);
  color: var(--text-secondary);
  font-size: 0.9rem;
  min-height: 44px;
  display: flex;
  align-items: center;
}

/* Единая высота и стиль элементов шапки задач */
.task-header {
  --task-control-h: 38px;
  --task-control-radius: 10px;
  --task-control-fs: 0.875rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.task-header-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-lg);
}

.task-header-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.task-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}

.task-filter-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.task-filter-tab,
.task-filter-pill {
  height: var(--task-control-h);
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--task-control-fs);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.task-filter-tab {
  cursor: pointer;
}

.task-filter-pill {
  min-width: 0;
  cursor: pointer;
  font-family: inherit;
}

.task-filter-pill--select {
  min-width: 140px;
}

.task-filter-dates {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: var(--space-sm);
  padding-left: var(--space-sm);
  border-left: 1px solid var(--border-color);
  flex-wrap: wrap;
}

.task-filter-date-label {
  font-size: var(--task-control-fs);
  font-weight: 600;
  color: var(--text-secondary);
}

.task-filter-apply-dates {
  margin-left: 4px;
  background: var(--accent-green);
  border-color: var(--accent-green);
  color: #fff;
}

.task-filter-apply-dates:hover {
  background: var(--accent-green-hover);
  border-color: var(--accent-green-hover);
  color: #fff;
}

.task-filter-pill:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.task-filter-tab:hover:not(.task-filter-tab--active),
.task-filter-pill:hover:not(:disabled) {
  background: var(--sidebar-hover-bg);
  color: var(--text-primary);
}

/* Поиск по номеру — отдельный блок справа */
.task-search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--task-control-h);
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
}

.task-search-icon {
  display: flex;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.task-search-input {
  width: 140px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--task-control-fs);
  font-family: inherit;
  outline: none;
}

.task-search-input::placeholder {
  color: var(--text-secondary);
}

.task-filter-select-label {
  font-size: var(--task-control-fs);
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* Для пагинации (выпадающий список «На странице») */
.task-filter-select {
  height: var(--task-control-h);
  min-width: 70px;
  padding: 0 12px;
  border-radius: var(--task-control-radius);
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: var(--task-control-fs);
  font-weight: 500;
  cursor: pointer;
}

.task-filter-select:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.task-filter-tab--active {
  background: var(--accent-green);
  border-color: var(--accent-green);
  color: #fff;
}

[data-theme='dark'] .task-filter-tab--active {
  border-color: rgba(255, 255, 255, 0.5);
  color: #fff;
}

.task-btn-create {
  height: var(--task-control-h);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  border-radius: var(--task-control-radius);
  border: none;
  background: var(--accent-green);
  color: #fff;
  font-size: var(--task-control-fs);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.15s ease;
}

.task-btn-create:hover {
  background: var(--accent-green-hover);
}

.task-btn-create-icon {
  transform-origin: center;
  transition: transform 0.3s ease;
}

.task-btn-create:hover .task-btn-create-icon {
  transform: rotate(52deg) scale(1.2);
}

.task-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.task-export-btns {
  display: flex;
  gap: 8px;
}

.task-btn-export {
  height: var(--task-control-h);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: var(--task-control-radius);
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: var(--task-control-fs);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.task-btn-export:hover:not(:disabled) {
  background: var(--sidebar-hover-bg);
  color: var(--text-primary);
}

/* Анимация как у кнопки вложения файла в чате */
.task-btn-export.action_has {
  --color: 220 9% 46%;
  --color-has: 146 33% 30%;
}

[data-theme='dark'] .task-btn-export.action_has {
  --color: 215 14% 55%;
  --color-has: 97 55% 52%;
}

.task-btn-export.has_saved:hover:not(:disabled) {
  border-color: hsl(var(--color-has));
}

.task-btn-export.has_saved:hover:not(:disabled) svg {
  color: hsl(var(--color-has));
}

.task-btn-export.has_saved svg {
  overflow: visible;
  transform-origin: center;
  transition: transform 0.22s ease;
}

.task-btn-export.has_saved:hover:not(:disabled) svg {
  animation: task-export-file-hover 0.65s ease;
}

@keyframes task-export-file-hover {
  0% {
    transform: translateY(0) scale(1) rotate(0deg);
  }
  35% {
    transform: translateY(-2px) scale(1.11) rotate(-8deg);
  }
  70% {
    transform: translateY(-1px) scale(1.06) rotate(6deg);
  }
  100% {
    transform: translateY(0) scale(1) rotate(0deg);
  }
}

.task-btn-export:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.task-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-md);
  padding: var(--space-md) var(--space-lg) 0;
  border-top: 1px solid var(--border-color);
  min-height: 40px;
}

.task-pagination-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.task-pagination-right {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  flex-wrap: wrap;
}

.task-pagination-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-pagination-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.task-pagination-arrow:hover:not(:disabled) {
  background: var(--bg-panel-hover);
  border-color: var(--text-secondary);
}

.task-pagination-arrow:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.task-pagination-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.task-pagination-num:hover {
  background: var(--bg-panel-hover);
}

.task-pagination-num--active {
  background: rgba(76, 175, 80, 0.15);
  border-color: rgba(76, 175, 80, 0.5);
  color: var(--text-primary);
}

[data-theme='dark'] .task-pagination-num--active {
  background: rgba(76, 175, 80, 0.2);
  border-color: rgba(76, 175, 80, 0.5);
}

.task-pagination-num--active:hover {
  background: rgba(76, 175, 80, 0.22);
}

.task-pagination-ellipsis {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 36px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.task-pagination-size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.task-pagination-size .task-filter-select-label {
  line-height: 1.5;
}

.task-pagination-select {
  min-width: 72px;
  height: 36px;
  padding: 0 28px 0 10px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
}

.task-pill {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  line-height: 1.2;
}

.task-pill-field {
  background: #5a7c5e;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.task-detail-field-value {
  display: inline-block;
  max-width: 100%;
  font-size: inherit;
  color: var(--text-primary);
  line-height: inherit;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.task-list-cell-field {
  min-width: 130px;
}

.priority-high {
  background: #b85450;
  color: #fff;
}

.priority-medium {
  background: #b87a50;
  color: #fff;
}

.priority-low {
  background: #5a8a85;
  color: #fff;
}

.task-overdue {
  color: #b85450;
  font-weight: 600;
}

/* List */
.task-list-wrap {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
}

.task-list-table-wrapper {
  overflow-x: auto;
  padding-bottom: 52px;
}

.task-list-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
  min-width: 1120px;
}

.task-list-table th {
  padding: 11px 16px;
  text-align: left;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}

.task-list-sort-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.task-list-sort-indicator {
  font-size: 0.72rem;
  line-height: 1;
  opacity: 0.75;
}

.task-list-table td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.3;
  vertical-align: middle;
  background-color: transparent;
}

.task-list-table tbody tr:nth-child(odd) {
  background-color: var(--bg-panel);
}

.task-list-table tbody tr:nth-child(even) {
  background-color: color-mix(in srgb, var(--border-color) 22%, var(--bg-panel));
}

.task-list-row {
  cursor: pointer;
  transition:
    background-color 0.22s ease,
    box-shadow 0.22s ease,
    transform 0.22s ease;
}

.task-list-table tbody tr.task-list-row:hover {
  background-color: color-mix(in srgb, var(--accent-green) 9%, var(--bg-panel));
  box-shadow: inset 3px 0 0 var(--accent-green);
}

.task-list-table tbody tr.task-list-row:hover .task-list-title-main {
  color: var(--accent-green);
  transition: color 0.22s ease;
}

.task-list-table tbody tr.task-list-row:hover .task-list-cell-num {
  color: var(--accent-green);
  transition: color 0.22s ease;
}

.task-list-title-main,
.task-list-cell-num {
  transition: color 0.22s ease;
}

@media (prefers-reduced-motion: reduce) {
  .task-list-row {
    transition: background-color 0.15s ease, box-shadow 0.15s ease;
  }

  .task-list-table tbody tr.task-list-row:hover .task-list-title-main,
  .task-list-table tbody tr.task-list-row:hover .task-list-cell-num {
    transition: none;
  }
}

.task-list-cell-num {
  width: 3.4rem;
  min-width: 3.4rem;
  text-align: center;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  word-break: normal;
  overflow-wrap: normal;
}
.task-list-cell-title {
  min-width: 220px;
  max-width: 340px;
}

.task-list-cell-desc-header,
.task-list-cell-desc {
  min-width: 200px;
  max-width: 320px;
}

.task-list-title-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.task-list-title-main {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.task-list-title-meta {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-secondary);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.task-list-desc {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.task-list-desc-empty {
  color: var(--text-muted);
  font-size: 0.84rem;
}

.task-list-cell-assignee {
  min-width: 220px;
}

.task-list-assignee-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-list-assignee-name {
  display: inline-block;
  min-width: 0;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-list-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--chip-bg);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.task-cell-overdue {
  color: #b85450;
  font-weight: 500;
}

.task-list-cell-priority {
  white-space: nowrap;
}

.task-list-cell-priority .task-pill {
  min-width: 92px;
  justify-content: center;
  white-space: nowrap;
  word-break: normal;
  overflow-wrap: normal;
  line-height: 1;
}

.task-overdue-icon {
  margin-right: 4px;
}

.task-status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}

.status-todo { background: #9ca3af; }
.status-in-progress { background: #3b82f6; }
.status-review { background: #b87a50; }
.status-done { background: #5a7c5e; }

/* Modals (оформление по образцу TasksPage / modal-calendar) */
.tm-modal-backdrop,
.modal.modal-tm-form,
.modal.modal-tm-detail {
  --agro: var(--accent-green);
  --agro-dark: var(--accent-green-hover);
  --agro-light: color-mix(in srgb, var(--accent-green) 24%, transparent);
}

.task-modal-backdrop,
.tm-modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--modal-backdrop);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--space-md);
  animation: taskFadeIn 0.2s ease;
}

.modal.modal-tm-form,
.modal.modal-tm-detail {
  width: 100%;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  animation: taskModalIn 0.25s ease;
}

.modal.modal-tm-form {
  max-width: 672px;
}

.modal.modal-tm-detail {
  max-width: 940px;
}

.modal-tm-form .modal-form--design {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.modal-tm-form .modal-form-fieldset {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 0;
  margin: 0;
  padding: 0;
  min-inline-size: 0;
}

.modal-tm-form .modal-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.modal-header-main {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  min-width: 0;
}

.modal-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.modal-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(61, 92, 64, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--agro);
  flex-shrink: 0;
}

.modal-icon--design {
  background: rgba(61, 92, 64, 0.08);
}

.modal-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-title--design {
  font-weight: 700;
}

.modal-task-id {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

/* .modal-close styles are in global.css */

.modal-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.modal-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.3;
  color: var(--text-secondary);
}

.modal-grid-2 {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-md);
  align-items: start;
}

.modal-grid-2 .modal-field--design {
  min-width: 0;
}

.tm-form-field--half {
  width: min(100%, calc((100% - var(--space-md)) / 2));
}

.modal-tm-form .modal-input.modal-input--design,
.modal-tm-form .modal-select.modal-select--design,
.modal-tm-form .modal-textarea.modal-textarea--design,
.modal-tm-detail .task-form-input,
.modal-tm-detail .task-form-select,
.modal-tm-detail .task-form-textarea,
.modal-tm-detail .task-detail-status-select {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.9375rem;
  line-height: 1.4;
  font-family: inherit;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.modal-tm-form .modal-input.modal-input--design,
.modal-tm-form .modal-select.modal-select--design,
.modal-tm-detail .task-form-input,
.modal-tm-detail .task-form-select,
.modal-tm-detail .task-detail-status-select {
  height: 44px;
}

.modal-tm-form .modal-input--title {
  font-weight: 600;
  font-size: 1rem;
}

.modal-tm-form .modal-textarea.modal-textarea--design,
.modal-tm-detail .task-form-textarea {
  min-height: 100px;
  height: auto;
  resize: vertical;
}

.modal-tm-form .modal-input:focus,
.modal-tm-form .modal-select:focus,
.modal-tm-form .modal-textarea:focus,
.modal-tm-detail .task-form-input:focus,
.modal-tm-detail .task-form-select:focus,
.modal-tm-detail .task-form-textarea:focus,
.modal-tm-detail .task-detail-status-select:focus {
  outline: none;
  border-color: var(--agro);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--agro) 20%, transparent);
}

.modal-tm-form .modal-select.modal-select--design,
.modal-tm-detail .task-form-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 40px;
}

.modal-tm-form .task-form-select-wrap {
  min-height: 44px;
  height: 44px;
}

.modal-tm-form .task-form-static-assignee {
  display: flex;
  align-items: center;
}

.modal-tm-form .modal-attach-placeholder--design,
.modal-tm-form .task-file-dropzone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 56px;
  padding: 10px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
}

.modal-tm-form .task-file-dropzone:hover:not(:disabled),
.modal-tm-form .modal-attach-placeholder--design:hover:not(:disabled) {
  border-color: var(--agro);
  color: var(--agro);
  background: color-mix(in srgb, var(--agro) 6%, var(--bg-panel));
}

.modal-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}

.modal-actions--design {
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-panel-hover);
  border-top: 1px solid var(--border-color);
  border-radius: 0 0 12px 12px;
}

.modal-actions-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.modal-btn-ghost.modal-btn-ghost--design {
  height: 40px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.modal-btn-ghost.modal-btn-ghost--design:hover {
  background: var(--sidebar-hover-bg);
  color: var(--text-primary);
}

.modal-btn.modal-btn--design {
  height: 40px;
  padding: 0 18px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--accent-green);
  color: #fff;
  -webkit-text-fill-color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 120px;
  appearance: none;
  box-shadow: none;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.modal-btn.modal-btn--design:hover:not(:disabled) {
  background: var(--accent-green-hover);
  border-color: var(--accent-green-hover);
}

.modal-btn.modal-btn--design:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.modal-tm-form .modal-actions :deep(.ui-delete-btn),
.modal-tm-detail .modal-actions :deep(.ui-delete-btn) {
  border-radius: 8px;
}

/* Участники задачи — как в календаре (TasksPage) */
.modal-tm-form .modal-label-row,
.modal-tm-detail .modal-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.modal-tm-form .modal-field--design .modal-label-row--design .modal-label,
.modal-tm-detail .task-detail-participants-edit .modal-label-row--design .modal-label {
  min-width: 0;
  flex: 1 1 auto;
}

.modal-tm-form .modal-field--design .modal-label-row--design .modal-assignee-picker,
.modal-tm-detail .task-detail-participants-edit .modal-assignee-picker {
  flex-shrink: 0;
}

.modal-tm-form .modal-assignee-picker,
.modal-tm-detail .modal-assignee-picker {
  position: relative;
}

.modal-tm-form .modal-add-assignee-btn,
.modal-tm-detail .modal-add-assignee-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--accent-green);
  background: transparent;
  border: none;
  cursor: pointer;
}

.modal-tm-form .modal-add-assignee-btn:hover,
.modal-tm-detail .modal-add-assignee-btn:hover {
  text-decoration: underline;
}

.modal-tm-form .modal-assignee-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  min-width: 220px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  z-index: 30;
  padding: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.modal-tm-form .modal-assignee-search,
.modal-tm-detail .modal-assignee-search {
  position: relative;
  margin-bottom: 4px;
}

.modal-tm-form .modal-assignee-search-icon,
.modal-tm-detail .modal-assignee-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
}

.modal-tm-form .modal-assignee-search-input,
.modal-tm-detail .modal-assignee-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px 6px 30px;
  border-radius: 6px;
  border: 1px solid var(--toolbar-form-surface-border, var(--border-color));
  background: var(--toolbar-form-surface, var(--bg-base));
  font-size: 0.8rem;
  color: var(--text-primary);
}

.modal-tm-form .modal-assignee-search-input:focus,
.modal-tm-detail .modal-assignee-search-input:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-green) 18%, transparent);
}

.modal-tm-form .modal-assignee-option,
.modal-tm-detail .modal-assignee-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  text-align: left;
  font-size: 0.85rem;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-primary);
}

.modal-tm-form .modal-assignee-option:hover,
.modal-tm-detail .modal-assignee-option:hover {
  background: var(--bg-base);
}

.modal-tm-form .modal-assignee-option-avatar,
.modal-tm-detail .modal-assignee-option-avatar {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 0.75rem;
  flex: 0 0 auto;
}

.modal-tm-form .modal-assignee-option-label,
.modal-tm-detail .modal-assignee-option-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.modal-tm-form .modal-assignee-empty,
.modal-tm-detail .modal-assignee-empty {
  margin: 0;
  padding: 8px 10px;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.modal-tm-form .modal-chips,
.modal-tm-detail .modal-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.modal-tm-form .modal-chips.modal-chips--design,
.modal-tm-detail .modal-chips.modal-chips--design {
  margin-top: 8px;
}

.modal-tm-form .modal-chip.modal-chip--design,
.modal-tm-detail .modal-chip.modal-chip--design {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 6px;
  border-radius: 9999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  font-size: 0.85rem;
}

.modal-tm-form .modal-chip-avatar.modal-chip-avatar--design,
.modal-tm-detail .modal-chip-avatar.modal-chip-avatar--design {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  font-weight: 600;
}

.modal-tm-form .modal-chip-label,
.modal-tm-detail .modal-chip-label {
  color: var(--text-primary);
}

.modal-tm-form .modal-chip-remove,
.modal-tm-detail .modal-chip-remove {
  padding: 0 2px;
  font-size: 1rem;
  line-height: 1;
  color: var(--text-secondary);
  background: none;
  border: none;
  cursor: pointer;
}

.modal-tm-form .modal-chip-remove:hover,
.modal-tm-detail .modal-chip-remove:hover {
  color: #dc2626;
}

/* Участники в карточке — отдельный блок с чипами, как в календаре */
.task-detail-participants-section {
  margin: 2px 0 14px;
}

.task-detail-participants-section .modal-label--design {
  display: block;
  margin-bottom: 8px;
}

.task-detail-participants-section .modal-chips.modal-chips--design {
  margin-top: 0;
  gap: 8px;
}

@keyframes taskFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.task-modal--detail {
  padding: 0;
}

@keyframes taskModalIn {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.task-form--compact .task-form-label {
  font-size: 0.6rem;
}

.task-form--compact .task-form-row > .task-form-label {
  margin-bottom: 4px;
}

.task-form--compact .task-form-field .task-form-label {
  margin-bottom: 0;
}

.task-form--compact .task-form-field {
  gap: 4px;
}

.task-form--compact .task-form-input,
.task-form--compact .task-form-select,
.task-form--compact .task-form-textarea {
  font-size: 0.8125rem;
  padding: 6px 10px;
  min-height: 32px;
}

.task-form--compact .task-form-select-wrap {
  min-height: 32px;
}

.task-form--compact .task-form-textarea {
  min-height: 60px;
}

.task-form--compact .task-form-row {
  margin-bottom: var(--space-sm);
}

.task-form--compact .task-form-row--two {
  gap: 16px;
}

.task-form--compact .task-form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.task-form--compact .task-form-priority-btn {
  font-size: 0.7rem;
  padding: 6px 8px;
}

.task-form-field {
  min-width: 0;
}

.task-form-row {
  margin-bottom: var(--space-md);
}

.task-form-row:last-of-type {
  margin-bottom: 0;
}

.task-form-row--design {
  margin-bottom: 0;
}

.task-form-row--priority {
  display: flex;
}

.task-form {
  width: 100%;
  box-sizing: border-box;
}

.task-form-row--two {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
}

.task-form-row--two .task-form-field {
  min-width: 0;
  overflow: hidden;
  width: 100%;
}

.task-form-row--two .task-form-field .task-form-select,
.task-form-row--two .task-form-field .task-form-input {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  box-sizing: border-box;
}

.task-form-row--two .task-form-select-wrap {
  width: 100% !important;
  min-width: 0 !important;
  box-sizing: border-box;
}

.task-form-row--two .task-form-select-wrap .task-form-select {
  flex: 1 1 0%;
  min-width: 0;
}

.task-form-row--two .task-form-label {
  font-size: 0.7rem;
  min-height: 1.35em;
  line-height: 1.35;
  display: flex;
  align-items: flex-end;
}

.task-form-row--two .task-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
}

.task-form-row--two .task-form-input,
.task-form-row--two .task-form-select {
  font-size: 0.9375rem;
  min-height: 44px;
  height: 44px;
  padding: 10px 12px;
  box-sizing: border-box;
}

.task-form-row--two .task-form-select-wrap {
  min-height: 44px;
  height: 44px;
  box-sizing: border-box;
}

.task-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.task-form-field--priority {
  width: min(100%, calc((100% - 16px) / 2));
}

.task-form-field .task-form-label {
  margin-bottom: 0;
}

.task-form-label {
  display: block;
  font-size: 0.64rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  margin-bottom: 5px;
  line-height: 1.3;
}

.task-form-counter {
  margin-top: 4px;
  text-align: right;
  font-size: 0.68rem;
  color: var(--text-secondary);
}

.task-form-input,
.task-form-select,
.task-form-textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  line-height: 1.4;
  font-family: inherit;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  box-sizing: border-box;
  min-height: 38px;
}

.task-form-select {
  min-height: 38px;
  height: 38px;
}

.task-form-input--title {
  font-size: 0.95rem;
  font-weight: 600;
}

.task-form-textarea {
  min-height: 56px;
  font-size: 0.8125rem;
}

.task-form-input--date {
  color: #4a6b4e;
}

.task-form-select-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
}

.task-form-select-wrap .task-form-select {
  flex: 1;
  min-width: 0;
}

.task-form-avatar {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: #5a7c5e;
  color: #fff;
  font-size: 0.68rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.task-form-textarea {
  resize: vertical;
}

.task-file-input-hidden {
  display: none;
}

.task-file-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-file-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-file-add-btn {
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.task-file-add-btn:hover:not(:disabled) {
  border-color: var(--agro);
  color: var(--agro);
  background: var(--bg-panel-hover);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(45, 90, 61, 0.16);
}

.task-file-add-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.task-file-dropzone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 58px;
  padding: 10px;
  border: 1px dashed var(--border-color);
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.task-file-dropzone:hover:not(:disabled) {
  background: rgba(61, 92, 64, 0.05);
  border-color: var(--agro);
  color: var(--agro);
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(45, 90, 61, 0.14);
}

.task-file-dropzone svg {
  transition: transform 0.22s ease;
}

.task-file-dropzone:hover:not(:disabled) svg {
  animation: task-file-dropzone-hover 0.65s ease;
}

@keyframes task-file-dropzone-hover {
  0% { transform: translateY(0); }
  40% { transform: translateY(-2px); }
  100% { transform: translateY(0); }
}

.task-files-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}

.task-file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: inherit;
  text-decoration: none;
}

.task-file-icon-box {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.task-file-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.task-file-icon-pdf {
  color: #dc2626;
}

.task-file-icon-doc {
  color: var(--text-secondary);
}

.task-file-info {
  flex: 1;
  min-width: 0;
}

.task-file-name {
  display: block;
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-file-size {
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.task-file-empty {
  padding: 6px 0;
  border: none;
  border-radius: 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
  background: transparent;
}

.task-form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
  margin-top: var(--space-xl);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border-color);
}

.task-detail-actions {
  margin-top: 0;
  flex-shrink: 0;
}

.modal-tm-detail.task-modal--detail {
  display: flex;
  flex-direction: column;
  max-height: min(90vh, 920px);
}

.modal-tm-detail .task-detail-layout {
  flex: 1;
  min-height: 0;
  max-height: none;
}

.task-detail-del-wrap {
  display: flex;
  align-items: center;
}

.task-detail-btn--saving {
  position: relative;
  min-width: 120px;
}

.task-detail-save-loader {
  display: flex;
  align-items: center;
  justify-content: center;
}
.task-detail-save-loader :deep(.ui-loading-bar) {
  transform: scale(0.88);
  transform-origin: center;
}

/* Detail modal */
.task-detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}

.task-detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.62fr) minmax(260px, 0.88fr);
  gap: 18px;
  position: relative;
  padding: var(--space-lg) 20px 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  align-items: start;
}

.task-detail-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  gap: 14px;
}

.task-detail-loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.02);
  backdrop-filter: blur(1px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.task-detail-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.task-detail-card {
  background: var(--bg-panel);
  border-radius: 14px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  box-shadow: none;
}

.task-detail-card-title {
  margin: 0 0 10px;
  font-size: 0.76rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-secondary);
}

.task-detail-info-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.task-detail-info-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #5a7c5e;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
}

.task-detail-info-main {
  display: flex;
  flex-direction: column;
}

.task-detail-info-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.task-detail-info-role {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.task-detail-info-meta {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-detail-info-meta-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.75rem;
}

.task-detail-info-meta-label {
  color: var(--text-secondary);
}

.task-detail-info-meta-value {
  color: var(--text-primary);
}

.task-history-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 0;
  min-height: 48px;
}

.task-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
}

.task-history-empty {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.task-history-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding-block: 6px;
}

.task-history-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-green);
  margin-top: 5px;
}

.task-history-content {
  flex: 1;
}

.task-history-text {
  font-size: 0.8rem;
  color: var(--text-primary);
}

.task-history-author {
  font-weight: 600;
}

.task-history-sep {
  margin: 0 4px;
  color: var(--text-secondary);
}

.task-history-event {
  color: var(--text-primary);
}

.task-history-time {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.modal-tm-detail .task-chat {
  flex-shrink: 0;
  margin-top: 8px;
  padding: 18px 20px 20px;
  border: none;
  border-top: 1px solid var(--border-color);
  border-radius: 0;
  background: color-mix(in srgb, var(--bg-panel-hover) 55%, var(--bg-panel));
}

.task-chat {
  margin-top: 6px;
  padding: 14px 20px 0;
  border: none;
  border-top: 1px solid var(--border-color);
  border-radius: 0;
  background: transparent;
}

.task-chat-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.task-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.task-chat-toggle {
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.task-chat-toggle:hover:not(:disabled) {
  background: var(--bg-panel-hover);
  border-color: var(--agro);
  color: var(--agro);
}

.task-chat-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.task-chat-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 0;
  min-height: 56px;
}

.task-chat-body {
  max-height: 240px;
  overflow-y: auto;
  margin-bottom: 12px;
}

.task-chat-empty {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.task-chat-collapsed-hint {
  margin-bottom: 14px;
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.task-chat-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-chat-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
}

.task-chat-avatar {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: #5a7c5e;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.task-chat-message {
  flex: 1;
}

.task-chat-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
  font-size: 0.78rem;
}

.task-chat-author {
  font-weight: 600;
  color: var(--text-primary);
}

.task-chat-dot {
  color: var(--text-secondary);
}

.task-chat-time {
  color: var(--text-secondary);
}

.task-chat-text {
  margin-top: 2px;
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--text-primary);
  white-space: pre-wrap;
}

.task-chat-input-row {
  display: flex;
  flex-direction: row;
  gap: 12px;
  align-items: flex-end;
  margin-top: 4px;
  padding-top: 2px;
}

.modal-tm-detail .task-chat-input-row {
  margin-top: 8px;
}

.task-chat-input {
  flex: 1;
  min-height: 44px;
  max-height: 120px;
  resize: vertical;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  font-size: 0.85rem;
  color: var(--text-primary);
}

.task-chat-send {
  padding: 0 18px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--accent-green);
  color: #fff;
  -webkit-text-fill-color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  min-height: 44px;
  appearance: none;
  flex-shrink: 0;
  transition: background 0.2s ease;
}

.task-chat-send:hover:not(:disabled) {
  background: var(--accent-green-hover);
}

.task-chat-send:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.task-chat-send--loading {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 104px;
}

.task-chat-send-loader {
  display: flex;
  align-items: center;
  justify-content: center;
}
.task-chat-send-loader :deep(.ui-loading-bar) {
  transform: scale(0.82);
  transform-origin: center;
}

.task-pill-status {
  color: #fff;
  white-space: nowrap;
}

.task-pill-status.status-todo { background: #9ca3af; }
.task-pill-status.status-in-progress { background: #3b82f6; }
.task-pill-status.status-review { background: #b87a50; }
.task-pill-status.status-done { background: #5a7c5e; }

.task-detail-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.task-detail-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 9px;
  margin: 0;
}

.task-detail-list dd {
  margin: 0;
  padding-left: 0;
}

.task-detail-item {
  margin: 0;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  min-height: 62px;
}

.task-detail-label {
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  margin-bottom: 4px;
  line-height: 1.3;
}

.task-detail-value {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-primary);
  min-width: 0;
  line-height: 1.25;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.task-detail-avatar {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: #5a7c5e;
  color: #fff;
  font-size: 0.52rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.task-detail-status-select {
  height: 32px;
  padding: 0 9px;
  border-radius: 7px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.76rem;
  min-width: 116px;
  cursor: pointer;
}

.task-detail-overdue {
  color: #b85450;
}

.task-detail-desc-wrap {
  margin-bottom: 0;
  padding: 7px 8px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
}

.task-detail-desc-wrap .task-detail-label {
  margin-bottom: 6px;
}

.task-detail-desc {
  padding: 0;
  border-radius: 0;
  background: transparent;
  font-size: 0.8rem;
  color: var(--text-primary);
  line-height: 1.3;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.task-file-section-head {
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.task-file-section-head .task-detail-label,
.task-file-section-head .task-form-label {
  margin-bottom: 0;
}

.task-detail-desc-wrap .task-file-section {
  gap: 8px;
}

.task-file-card {
  box-shadow: none;
}

.task-file-empty {
  font-size: 0.8rem;
  padding: 6px 0;
}

/* ——— Тёмная тема (Context7: опора на CSS-переменные и контраст) ——— */
[data-theme='dark'] .task-management-page {
  --task-input-bg: color-mix(in srgb, var(--bg-elevated) 76%, black);
  --task-input-border: var(--border-color);
  --task-placeholder: var(--text-muted);
}

[data-theme='dark'] .modal.modal-tm-form,
[data-theme='dark'] .modal.modal-tm-detail {
  background: var(--bg-elevated);
  border-color: var(--border-color);
  box-shadow: var(--shadow-card);
}

[data-theme='dark'] .modal-tm-form .modal-body {
  background: var(--bg-elevated);
}

[data-theme='dark'] .modal-actions--design {
  background: color-mix(in srgb, var(--bg-elevated) 92%, black);
  border-top-color: var(--border-color);
}

[data-theme='dark'] .modal-btn-ghost.modal-btn-ghost--design {
  background: color-mix(in srgb, var(--bg-elevated) 88%, black);
  border-color: var(--border-color);
  color: var(--text-secondary);
}

[data-theme='dark'] .modal-btn-ghost.modal-btn-ghost--design:hover {
  background: var(--interactive-hover);
  color: var(--text-primary);
}

[data-theme='dark'] .modal-icon--design {
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  color: color-mix(in srgb, #fff 82%, var(--accent-green));
}

[data-theme='dark'] .modal-tm-detail .task-chat {
  background: color-mix(in srgb, var(--bg-elevated) 92%, black);
}

[data-theme='dark'] .modal-btn.modal-btn--design {
  background: var(--accent-green);
  color: #fff;
  -webkit-text-fill-color: #fff;
}

[data-theme='dark'] .modal-btn.modal-btn--design:hover:not(:disabled) {
  background: var(--accent-green-hover);
}

[data-theme='dark'] .modal-tm-form .modal-chip.modal-chip--design,
[data-theme='dark'] .modal-tm-detail .modal-chip.modal-chip--design {
  background: color-mix(in srgb, var(--bg-elevated) 88%, black);
  border-color: var(--border-color);
}

[data-theme='dark'] .modal-tm-form .modal-assignee-dropdown,
[data-theme='dark'] .task-form-input,
[data-theme='dark'] .task-form-select,
[data-theme='dark'] .task-form-textarea,
[data-theme='dark'] .task-detail-status-select {
  background: var(--task-input-bg, var(--chip-bg));
  border-color: var(--task-input-border, var(--border-color));
  color: var(--text-primary);
}

[data-theme='dark'] .task-form-input::placeholder,
[data-theme='dark'] .task-form-textarea::placeholder {
  color: var(--task-placeholder, var(--text-secondary));
}

[data-theme='dark'] .task-form-input--date {
  color: color-mix(in srgb, white 78%, var(--accent-green));
}

[data-theme='dark'] .task-filter-tab {
  color: var(--text-secondary);
}

[data-theme='dark'] .task-filter-tab:hover {
  color: var(--text-primary);
}

[data-theme='dark'] .task-filter-pill {
  color: var(--text-secondary);
}

[data-theme='dark'] .task-filter-pill:hover:not(:disabled) {
  color: var(--text-primary);
}

[data-theme='dark'] .task-search-wrap {
  background: color-mix(in srgb, var(--bg-elevated) 68%, black);
  border-color: var(--border-color);
}

[data-theme='dark'] .task-list-wrap {
  background: color-mix(in srgb, var(--bg-elevated) 82%, black);
  border-color: var(--border-color);
}

[data-theme='dark'] .task-list-table tbody tr:nth-child(odd) {
  background-color: var(--bg-elevated);
}

[data-theme='dark'] .task-list-table tbody tr:nth-child(even) {
  background-color: color-mix(in srgb, #ffffff 11%, var(--bg-elevated));
}

[data-theme='dark'] .task-list-table tbody tr.task-list-row:hover {
  background-color: color-mix(in srgb, var(--accent-green) 16%, var(--bg-elevated));
  box-shadow: inset 3px 0 0 var(--accent-green);
}

[data-theme='dark'] .task-list-table tbody tr.task-list-row:hover .task-list-title-main,
[data-theme='dark'] .task-list-table tbody tr.task-list-row:hover .task-list-cell-num {
  color: color-mix(in srgb, #fff 75%, var(--accent-green));
}

[data-theme='dark'] .task-list-title-meta,
[data-theme='dark'] .task-list-desc {
  color: var(--text-muted);
}

[data-theme='dark'] .task-list-avatar {
  background: color-mix(in srgb, var(--accent-green) 26%, transparent);
  color: var(--text-primary);
}

/* dark .modal-close:hover handled by global.css */

[data-theme='dark'] .task-detail-card {
  background: color-mix(in srgb, var(--bg-elevated) 88%, black);
  border-color: var(--border-color);
}

[data-theme='dark'] .task-chat-input {
  background: color-mix(in srgb, var(--bg-elevated) 88%, black);
  border-color: var(--border-color);
}

@media (max-width: 1024px) {
  .task-list-table {
    min-width: 1040px;
  }

  .task-list-wrap {
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    overflow: hidden;
  }

  .task-list-table-wrapper {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 0;
  }

  .task-list-assignee-name {
    max-width: 170px;
  }
}

@media (max-width: 900px) {
  .task-header {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-md);
  }

  .task-header-left {
    flex-direction: column;
    gap: var(--space-md);
  }

  .task-header-actions {
    flex-wrap: wrap;
    width: 100%;
  }

  .task-search-wrap {
    flex: 1;
    min-width: 160px;
  }

  .task-search-input {
    width: 100%;
    min-width: 0;
  }
}

@media (max-width: 768px) {
  .task-management-page {
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  .task-form-row--two {
    grid-template-columns: 1fr;
  }

  .task-form-field--priority {
    width: 100%;
  }

  .task-filter-row {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-sm);
  }

  .task-filter-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }

  .task-filter-tab {
    justify-content: center;
  }

  .task-filter-dates {
    margin-left: 0;
    padding-left: 0;
    border-left: none;
    padding-top: var(--space-xs);
    border-top: 1px solid var(--border-color);
    margin-top: var(--space-xs);
  }

  .task-filter-pill--select {
    min-width: 0;
    width: 100%;
    flex: 1;
  }

  .task-header-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .task-search-wrap {
    width: 100%;
    min-width: 0;
  }

  .task-export-btns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-sm);
  }

  .task-btn-export {
    justify-content: center;
  }

  .task-btn-create {
    width: 100%;
    justify-content: center;
  }

  .task-detail-layout {
    grid-template-columns: 1fr;
  }

  .task-detail-list {
    grid-template-columns: 1fr;
  }

  .task-detail-value,
  .task-detail-input-inline,
  .task-detail-status-select {
    max-width: 100%;
    min-width: 0;
  }

  .task-detail-input-inline,
  .task-detail-status-select {
    width: 100%;
  }

  .task-detail-sidebar {
    margin-top: var(--space-md);
  }

  .task-chat {
    margin-top: var(--space-md);
  }

  .task-detail-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .task-detail-actions .task-detail-btn {
    width: 100%;
  }

  .task-detail-actions .task-detail-del-wrap {
    width: 100%;
    justify-content: center;
  }

  .task-pagination {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-sm);
    padding: var(--space-md) 0;
  }

  .task-pagination-info {
    text-align: center;
  }

  .task-pagination-right {
    justify-content: center;
  }

  .task-pagination-nav {
    flex-wrap: wrap;
    justify-content: center;
  }

  .task-pagination-size {
    justify-content: center;
  }

  .task-list-wrap {
    background: transparent;
    border: none;
    border-radius: 0;
    overflow: visible;
  }

  .task-list-table-wrapper {
    overflow: visible;
    padding-bottom: 0;
    border: none;
  }

  .task-list-table {
    min-width: 0;
  }

  .task-list-table thead {
    display: none;
  }

  .task-list-table,
  .task-list-table tbody,
  .task-list-table tr,
  .task-list-table td {
    display: block;
    width: 100%;
    box-sizing: border-box;
  }

  .task-list-row {
    grid-template-columns: 1fr;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-panel);
    margin-bottom: var(--space-sm);
    padding: 6px 0;
    box-shadow: 0 1px 2px rgba(15, 23, 18, 0.04);
  }

  .task-list-table tbody tr.task-list-row:hover {
    background-color: color-mix(in srgb, var(--accent-green) 8%, var(--bg-panel));
    border-color: color-mix(in srgb, var(--accent-green) 35%, var(--border-color));
    box-shadow:
      inset 3px 0 0 var(--accent-green),
      0 8px 20px rgba(45, 90, 61, 0.12);
    transform: translateY(-2px);
  }

  @media (prefers-reduced-motion: reduce) {
    .task-list-table tbody tr.task-list-row:hover {
      transform: none;
    }
  }

  .task-list-table td {
    border-bottom: 1px solid var(--border-color);
    padding: 10px 12px;
    text-align: left;
  }

  .task-list-table td:last-child {
    border-bottom: none;
  }

  .task-list-table td::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 5px;
    font-size: 0.64rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }

  .task-list-cell-num {
    text-align: left;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .task-list-cell-title {
    max-width: none;
  }

  .task-list-title-main {
    font-size: 0.88rem;
    -webkit-line-clamp: 3;
  }

  .task-list-title-meta {
    font-size: 0.72rem;
    white-space: normal;
  }

  .task-list-cell-desc {
    max-width: none;
  }

  .task-list-desc {
    font-size: 0.78rem;
    -webkit-line-clamp: 4;
    white-space: normal;
  }

  .task-list-assignee-inner {
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 10px;
  }

  .task-list-assignee-name {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .task-list-avatar {
    width: 30px;
    height: 30px;
    font-size: 0.72rem;
  }

  .task-pill {
    display: inline-flex;
    max-width: 100%;
    white-space: normal;
    text-align: left;
  }

  .task-list-cell-priority .task-pill {
    max-width: none;
    white-space: nowrap;
    text-align: center;
  }

  .modal.modal-tm-form,
  .modal.modal-tm-detail {
    max-width: 100%;
    max-height: calc(100vh - 2 * var(--space-md));
  }

  .modal-grid-2 {
    grid-template-columns: 1fr;
  }

  .tm-form-field--half {
    width: 100%;
  }

  .modal-actions-right {
    width: 100%;
    justify-content: stretch;
  }

  .modal-actions-right .modal-btn-ghost,
  .modal-actions-right .modal-btn {
    flex: 1 1 auto;
  }
}

@media (max-width: 480px) {
  .task-list-row {
    margin-bottom: 10px;
    border-radius: 10px;
  }

  .task-list-table td {
    padding: 9px 10px;
  }

  .task-list-table td::before {
    font-size: 0.6rem;
    margin-bottom: 4px;
  }

  .task-list-title-main {
    font-size: 0.9rem;
  }

  .task-list-cell-assignee {
    gap: 8px;
  }

  .task-filter-tabs {
    grid-template-columns: 1fr;
  }

  .task-export-btns {
    grid-template-columns: 1fr;
  }

  .task-loading {
    min-height: 200px;
    padding: var(--space-lg);
  }

  .modal.modal-tm-form,
  .modal.modal-tm-detail {
    max-height: calc(100vh - 2 * var(--space-sm));
  }

  .task-detail-title {
    font-size: 1.2rem;
    line-height: 1.22;
  }

  .task-detail-list {
    gap: 6px;
  }

  .task-detail-item,
  .task-detail-desc-wrap {
    padding: 6px 7px;
  }

  .task-detail-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .task-detail-actions .task-detail-del-wrap {
    width: 100%;
    justify-content: flex-start;
  }

  .task-detail-actions .modal-actions-right {
    flex-direction: column;
    width: 100%;
  }
}
</style>
