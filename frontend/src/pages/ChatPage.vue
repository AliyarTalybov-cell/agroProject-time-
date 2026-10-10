<script setup lang="ts">
import { Badge } from '@/components/ui/shadcn/badge'
import { Bubble, BubbleContent } from '@/components/ui/shadcn/bubble'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupTextarea } from '@/components/ui/shadcn/input-group'
import { Spinner } from '@/components/ui/shadcn/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import { Button } from '@/components/ui/shadcn/button'
import { ArrowUpIcon, CheckCheckIcon, ChevronDownIcon, ChevronLeftIcon, DownloadIcon, FileIcon, MessagesSquareIcon, PaperclipIcon, RefreshCcwIcon, SearchIcon, SquarePenIcon, Trash2Icon, UsersRoundIcon, XIcon } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import ChatGroupDialog from '@/components/ui/dialogs/ChatGroupDialog.vue'
import ChatDmDialog from '@/components/ui/dialogs/ChatDmDialog.vue'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useAuth } from '@/stores/auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { loadEmployees, searchEmployees, type EmployeeRow } from '@/lib/employeesSupabase'
import UserAvatar from '@/components/UserAvatar.vue'
import {
  type AvatarTone,
  CHAT_MESSAGES_PAGE_SIZE,
  type ChatFilterTab,
  type ChatMessageRow,
  type ThreadMessageRealtimePayload,
  type UiChatConversation,
  type UiChatMessage,
  createGroupThread,
  fetchChatThreadList,
  fetchPeerLastRead,
  fetchProfileAvatarMap,
  fetchSenderMetaMap,
  fetchThreadMessagesPage,
  getOrCreateDmThread,
  mapMessagesForUi,
  mapThreadRow,
  matchesChatListSearch,
  markThreadAsRead,
  refreshChatTotalUnread,
  CHAT_MESSAGE_MAX_CHARS,
  sendChatMessage,
  sendChatMessageWithFile,
  deleteChatMessage,
  subscribeToThreadMessages,
  fetchGroupThreadMembersDisplay,
  presenceFromLastActivity,
  type GroupMemberDisplay,
} from '@/lib/chatSupabase'

const auth = useAuth()
const isManager = computed(() => auth.userRole.value === 'manager')
const myId = computed(() => auth.user.value?.id ?? '')

const userInitials = computed(() => {
  const email = auth.user.value?.email ?? ''
  const part = email.split('@')[0]
  if (part.length >= 2) return part.slice(0, 2).toUpperCase()
  return part.slice(0, 1).toUpperCase() || 'ВЫ'
})
const myAvatarUrl = computed(() => auth.profileCache.value?.avatar_url ?? null)

const configured = computed(() => isSupabaseConfigured())
/** Первичная загрузка списка диалогов (не «Загрузка чата») */
const listLoading = ref(false)
/** Загрузка открытого диалога: сообщения, отметка прочитанного */
const chatLoading = ref(false)
const refreshBusy = ref(false)
const error = ref<string | null>(null)
const conversations = ref<UiChatConversation[]>([])
const activeId = ref<string | null>(null)
const filterTab = ref<ChatFilterTab>('all')
const searchLocal = ref('')
const messages = ref<UiChatMessage[]>([])
/** Есть ли ещё сообщения старее загруженных (страницы по CHAT_MESSAGES_PAGE_SIZE) */
const hasMoreOlderMessages = ref(false)
const olderLoading = ref(false)
const messagesScrollEl = useTemplateRef<HTMLDivElement>('messagesScrollEl')
const draft = ref('')
const pendingAttachment = ref<File | null>(null)
const attachBusy = ref(false)
const sendClickAnimating = ref(false)
let sendAnimTimer: ReturnType<typeof setTimeout> | null = null
const fileInputRef = useTemplateRef<HTMLInputElement>('chatFileInput')
const failedImagePreviewIds = ref<Record<string, true>>({})

/** Свайп «влево» для своих сообщений (px, отрицательное) */
const SWIPE_DELETE_W = 76
const swipeOffsets = reactive<Record<string, number>>({})
const swipeDrag = ref<{ id: string; startX: number; base: number } | null>(null)
const swipeDraggingId = ref<string | null>(null)

const msgContextMenu = ref<{ msg: UiChatMessage; x: number; y: number } | null>(null)
const deleteMessageModalOpen = ref(false)
const deleteMessageTarget = ref<UiChatMessage | null>(null)
const deleteMessageBusy = ref(false)

const groupMembers = ref<GroupMemberDisplay[]>([])
const groupMembersLoading = ref(false)
/** Состав группы: показать / скрыть (клик по логотипу или числу участников) */
const groupRosterExpanded = ref(false)

function toggleGroupRoster() {
  groupRosterExpanded.value = !groupRosterExpanded.value
}

const dmModalOpen = ref(false)
const dmSearch = ref('')
const dmResults = ref<EmployeeRow[]>([])
const dmLoading = ref(false)

const groupModalOpen = ref(false)
const groupTitle = ref('')
const groupEmployees = ref<EmployeeRow[]>([])
const groupSelected = ref<Set<string>>(new Set())
const groupBusy = ref(false)

const CHAT_MOBILE_BREAKPOINT_PX = 900

function getInitialMobileChatLayout(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(`(max-width: ${CHAT_MOBILE_BREAKPOINT_PX - 1}px)`).matches
}

/** Узкая вёрстка: один экран — список или переписка */
const isMobileChatLayout = ref(getInitialMobileChatLayout())
/** На мобилке: list | thread */
const mobileChatPanel = ref<'list' | 'thread'>('list')
let mobileChatMq: MediaQueryList | null = null
let mobileChatMqHandler: ((e: MediaQueryListEvent) => void) | null = null

/** Точка старта для свайпа «назад к списку» */
const threadBackSwipeStart = ref<{ x: number; y: number } | null>(null)

let dmSearchTimer: ReturnType<typeof setTimeout> | null = null
let rtStop: (() => void) | null = null
let presenceTicker: ReturnType<typeof setInterval> | null = null
/** Инкремент раз в минуту — пересчёт «в сети» по last_activity без новых запросов */
const presenceClock = ref(0)

const active = computed(() => conversations.value.find((c) => c.id === activeId.value) ?? null)

const chatPageLayoutClass = computed(() => {
  if (!isMobileChatLayout.value) return {}
  return mobileChatPanel.value === 'thread'
    ? { 'chat-page--mobile-thread': true }
    : { 'chat-page--mobile-list': true }
})

function syncMobileChatLayout() {
  if (typeof window === 'undefined') return
  isMobileChatLayout.value = window.matchMedia(`(max-width: ${CHAT_MOBILE_BREAKPOINT_PX - 1}px)`).matches
}

function backToChatList() {
  mobileChatPanel.value = 'list'
  closeMsgContextMenu()
  resetSwipeOffsets()
  threadBackSwipeStart.value = null
}

function onThreadBackSwipeTouchStart(e: TouchEvent) {
  if (!isMobileChatLayout.value || mobileChatPanel.value !== 'thread') return
  const t = e.touches[0]
  if (!t) return
  threadBackSwipeStart.value = { x: t.clientX, y: t.clientY }
}

function onThreadBackSwipeTouchEnd(e: TouchEvent) {
  const start = threadBackSwipeStart.value
  threadBackSwipeStart.value = null
  if (!start || !isMobileChatLayout.value || mobileChatPanel.value !== 'thread') return
  const t = e.changedTouches[0]
  if (!t) return
  const dx = t.clientX - start.x
  const dy = Math.abs(t.clientY - start.y)
  if (dx > 72 && dy < 56) backToChatList()
}

function onThreadBackSwipeTouchCancel() {
  threadBackSwipeStart.value = null
}

watch(activeId, (id) => {
  if (!id && isMobileChatLayout.value) mobileChatPanel.value = 'list'
})

const filteredList = computed(() => {
  const q = searchLocal.value.trim()
  return conversations.value.filter((c) => {
    if (filterTab.value === 'unread' && c.unread <= 0) return false
    if (filterTab.value === 'teams' && !c.isTeam) return false
    return matchesChatListSearch(c.searchHaystack, q)
  })
})

function setTab(tab: ChatFilterTab) {
  filterTab.value = tab
}

const AVATAR_TONE_CLASS: Record<AvatarTone, string> = {
  blue: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  purple: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  rose: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
}

function toneClass(tone: AvatarTone) {
  return AVATAR_TONE_CLASS[tone] ?? AVATAR_TONE_CLASS.blue
}

const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Подпись дня над сообщениями: «Сегодня», «Вчера», «25 сентября», в прошлые годы — с годом. */
function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dayKey(iso) === dayKey(now.toISOString())) return 'Сегодня'
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Вчера'
  const base = `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`
}

function renderMessageBlocks(msgs: UiChatMessage[]) {
  const blocks: { msg: UiChatMessage; showAvatar: boolean; startsRun: boolean; day: string | null }[] = []
  let lastKey: string | null = null
  let lastDay: string | null = null
  for (const msg of msgs) {
    const key = msg.side === 'out' ? 'out' : `in:${msg.senderId}`
    const dk = msg.createdAt ? dayKey(msg.createdAt) : null
    const newDay = dk !== lastDay
    const startsRun = key !== lastKey || newDay
    blocks.push({ msg, showAvatar: startsRun, startsRun, day: newDay && msg.createdAt ? dayLabel(msg.createdAt) : null })
    lastKey = key
    lastDay = dk
  }
  // Время — под последним сообщением серии или там, где сменилась минута.
  return blocks.map((b, i) => {
    const next = blocks[i + 1]
    const showTime = !next || next.startsRun || next.msg.time !== b.msg.time || b.msg.side === 'out' && next.msg.read !== b.msg.read
    return { ...b, showTime }
  })
}

const messageBlocks = computed(() => renderMessageBlocks(messages.value))

const draftLength = computed(() => draft.value.length)
const draftAtLimit = computed(() => draftLength.value >= CHAT_MESSAGE_MAX_CHARS)

const onlineInGroupCount = computed(() => {
  void presenceClock.value
  return groupMembers.value.filter((m) => presenceFromLastActivity(m.lastActivityAt).online).length
})

function livePresence(iso: string | null) {
  void presenceClock.value
  return presenceFromLastActivity(iso)
}

function convListPresence(c: UiChatConversation) {
  if (c.kind !== 'direct') return { online: false, presenceLabel: '' }
  return livePresence(c.peerLastActivityAt)
}

function groupMemberPresence(m: GroupMemberDisplay) {
  return livePresence(m.lastActivityAt)
}

const activeDirectPresence = computed(() => {
  void presenceClock.value
  const a = active.value
  if (!a || a.kind !== 'direct') return null
  return presenceFromLastActivity(a.peerLastActivityAt)
})

function participantsLabel(n: number): string {
  const h = n % 100
  const m = n % 10
  if (h >= 11 && h <= 14) return `${n} участников`
  if (m === 1) return `${n} участник`
  if (m >= 2 && m <= 4) return `${n} участника`
  return `${n} участников`
}

async function loadGroupMembers() {
  const tid = activeId.value
  const conv = conversations.value.find((c) => c.id === tid)
  if (!tid || conv?.kind !== 'group') {
    groupMembers.value = []
    groupMembersLoading.value = false
    return
  }
  groupMembersLoading.value = true
  try {
    groupMembers.value = await fetchGroupThreadMembersDisplay(tid, myId.value || null)
  } catch (e) {
    // Состав команды вспомогателен: переписку он не закрывает, поэтому
    // ошибку не выносим в шапку, но и не теряем.
    console.error('Состав команды', e)
    groupMembers.value = []
  } finally {
    groupMembersLoading.value = false
  }
}

const composerPlaceholder = computed(() => {
  if (!active.value) return 'Выберите диалог…'
  if (active.value.kind === 'group') return 'Сообщение для команды…'
  const first = active.value.name.split(' ')[0] || active.value.name
  return `Напишите сообщение ${first}…`
})

async function refreshThreads() {
  if (!configured.value) return
  const rows = await fetchChatThreadList()
  const list = rows
    .map(mapThreadRow)
    .sort((a, b) => {
      if (a.unreadUrgent !== b.unreadUrgent) return b.unreadUrgent - a.unreadUrgent
      if (a.unread !== b.unread) return b.unread - a.unread
      return 0
    })
  conversations.value = list
  // Подтягиваем фото собеседников лички (RPC не возвращает avatar_url)
  const peerIds = list.filter((c) => c.kind === 'direct' && c.peerUserId).map((c) => c.peerUserId as string)
  if (peerIds.length) {
    const avatarMap = await fetchProfileAvatarMap(peerIds)
    if (avatarMap.size) {
      conversations.value = conversations.value.map((c) =>
        c.kind === 'direct' && c.peerUserId && avatarMap.has(c.peerUserId)
          ? { ...c, avatarUrl: avatarMap.get(c.peerUserId) ?? null }
          : c,
      )
    }
  }
}

async function reloadMessages() {
  const uid = myId.value
  const tid = activeId.value
  if (!tid || !uid) {
    messages.value = []
    hasMoreOlderMessages.value = false
    return
  }
  const rows = await fetchThreadMessagesPage(tid, { limit: CHAT_MESSAGES_PAGE_SIZE, before: null })
  hasMoreOlderMessages.value = rows.length >= CHAT_MESSAGES_PAGE_SIZE
  const conv = conversations.value.find((c) => c.id === tid)
  let peerRead: string | null = null
  if (conv?.kind === 'direct' && conv.peerUserId) {
    peerRead = await fetchPeerLastRead(tid, conv.peerUserId)
  }
  const incomingSenders = [...new Set(rows.filter((r) => r.sender_id !== uid).map((r) => r.sender_id))]
  const meta =
    conv?.kind === 'group' ? await fetchSenderMetaMap(incomingSenders) : new Map()
  messages.value = mapMessagesForUi(rows, uid, peerRead, conv?.kind === 'group' ? { isGroup: true, senderMeta: meta } : undefined)
}

function scrollMessagesToBottom() {
  const el = messagesScrollEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

/** Лента прокручена до конца (с запасом) — новые сообщения можно докручивать автоматически. */
function isMessagesNearBottom(): boolean {
  const el = messagesScrollEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120
}

/** Пользователь внизу ленты — при догрузке картинок держим ленту внизу. */
let stickToBottom = true

function onMessagesScroll() {
  stickToBottom = isMessagesNearBottom()
}

/** Картинка во вложении загрузилась или не открылась — высота сообщения поменялась. */
function onAttachmentLayoutChange() {
  if (stickToBottom) scrollMessagesToBottom()
}

async function scrollMessagesToBottomSoon() {
  stickToBottom = true
  await nextTick()
  scrollMessagesToBottom()
}

async function loadOlderMessages() {
  const tid = activeId.value
  const uid = myId.value
  if (!tid || !uid || olderLoading.value || !hasMoreOlderMessages.value) return
  const oldest = messages.value[0]
  if (!oldest) return

  const el = messagesScrollEl.value
  const prevScrollHeight = el?.scrollHeight ?? 0
  const prevScrollTop = el?.scrollTop ?? 0

  olderLoading.value = true
  try {
    const rows = await fetchThreadMessagesPage(tid, {
      limit: CHAT_MESSAGES_PAGE_SIZE,
      before: { createdAt: oldest.createdAt, id: oldest.id },
    })
    if (rows.length === 0) {
      hasMoreOlderMessages.value = false
      return
    }
    if (rows.length < CHAT_MESSAGES_PAGE_SIZE) {
      hasMoreOlderMessages.value = false
    }
    const conv = conversations.value.find((c) => c.id === tid)
    let peerRead: string | null = null
    if (conv?.kind === 'direct' && conv.peerUserId) {
      peerRead = await fetchPeerLastRead(tid, conv.peerUserId)
    }
    const incomingSenders = [...new Set(rows.filter((r) => r.sender_id !== uid).map((r) => r.sender_id))]
    const meta =
      conv?.kind === 'group' ? await fetchSenderMetaMap(incomingSenders) : new Map()
    const olderUi = mapMessagesForUi(
      rows,
      uid,
      peerRead,
      conv?.kind === 'group' ? { isGroup: true, senderMeta: meta } : undefined,
    )
    const existingIds = new Set(messages.value.map((m) => m.id))
    const toPrepend = olderUi.filter((m) => !existingIds.has(m.id))
    messages.value = [...toPrepend, ...messages.value]

    await nextTick()
    if (el) {
      el.scrollTop = el.scrollHeight - prevScrollHeight + prevScrollTop
    }
  } catch (e) {
    error.value = formatSupabaseError(e) || 'Не удалось загрузить старые сообщения'
  } finally {
    olderLoading.value = false
  }
}

async function appendIncomingMessage(row: ChatMessageRow) {
  const tid = activeId.value
  const uid = myId.value
  if (!tid || !uid || row.thread_id !== tid) return
  if (messages.value.some((m) => m.id === row.id)) return
  const conv = conversations.value.find((c) => c.id === tid)
  let peerRead: string | null = null
  if (conv?.kind === 'direct' && conv.peerUserId) {
    peerRead = await fetchPeerLastRead(tid, conv.peerUserId)
  }
  const meta =
    conv?.kind === 'group'
      ? await fetchSenderMetaMap(row.sender_id === uid ? [] : [row.sender_id])
      : new Map()
  const mapped = mapMessagesForUi(
    [row],
    uid,
    peerRead,
    conv?.kind === 'group' ? { isGroup: true, senderMeta: meta } : undefined,
  )
  const ui = mapped[0]
  if (!ui) return
  const stick = ui.side === 'out' || isMessagesNearBottom()
  messages.value = [...messages.value, ui]
  if (stick) void scrollMessagesToBottomSoon()
}

async function handleThreadMessagesRealtime(tid: string, payload: ThreadMessageRealtimePayload | null) {
  if (!configured.value || activeId.value !== tid) return

  if (payload?.kind === 'delete') {
    messages.value = messages.value.filter((m) => m.id !== payload.messageId)
    void refreshThreads()
    void refreshChatTotalUnread()
    return
  }

  if (payload?.kind === 'insert') {
    await appendIncomingMessage(payload.record)
    void refreshThreads()
    void refreshChatTotalUnread()
    return
  }

  if (!hasMoreOlderMessages.value) {
    await reloadMessages()
  }
  void refreshThreads()
  void refreshChatTotalUnread()
}

function stopRealtime() {
  rtStop?.()
  rtStop = null
}

function startRealtime() {
  stopRealtime()
  const tid = activeId.value
  if (!tid) return
  const { unsubscribe } = subscribeToThreadMessages(tid, (payload) => {
    void handleThreadMessagesRealtime(tid, payload)
  })
  rtStop = unsubscribe
}

async function onPick(c: UiChatConversation) {
  if (!configured.value) return
  error.value = null
  pendingAttachment.value = null
  if (fileInputRef.value) fileInputRef.value.value = ''
  closeMsgContextMenu()
  resetSwipeOffsets()
  if (c.kind !== 'group') {
    groupMembers.value = []
    groupMembersLoading.value = false
    groupRosterExpanded.value = false
  } else {
    groupRosterExpanded.value = false
  }
  activeId.value = c.id
  chatLoading.value = true
  /* Сразу открыть экран чата на мобилке — иначе пользователь долго видит список без обратной связи */
  if (isMobileChatLayout.value) mobileChatPanel.value = 'thread'
  await nextTick()
  try {
    await markThreadAsRead(c.id)
    await refreshChatTotalUnread()
    await refreshThreads()
    await Promise.all([reloadMessages(), c.kind === 'group' ? loadGroupMembers() : Promise.resolve()])
    startRealtime()
  } catch (e) {
    error.value = formatSupabaseError(e) || 'Не удалось открыть диалог'
  } finally {
    chatLoading.value = false
    void scrollMessagesToBottomSoon()
  }
}

/** Обновить список диалогов и (если открыт) сообщения текущего чата */
async function refreshChat() {
  if (!configured.value || refreshBusy.value) return
  error.value = null
  refreshBusy.value = true
  const hadThread = Boolean(activeId.value)
  if (hadThread) chatLoading.value = true
  try {
    await refreshThreads()
    await refreshChatTotalUnread()
    if (activeId.value) {
      await reloadMessages()
      const conv = conversations.value.find((x) => x.id === activeId.value)
      if (conv?.kind === 'group') await loadGroupMembers()
    }
  } catch (e) {
    error.value = formatSupabaseError(e) || 'Не удалось обновить'
  } finally {
    refreshBusy.value = false
    if (hadThread) {
      chatLoading.value = false
      void scrollMessagesToBottomSoon()
    }
  }
}

async function onSend() {
  if (!activeId.value) return
  const text = draft.value.trim()
  const file = pendingAttachment.value
  if (!file && !text) return
  if (text.length > CHAT_MESSAGE_MAX_CHARS) {
    error.value = `Не больше ${CHAT_MESSAGE_MAX_CHARS} символов в сообщении`
    return
  }
  if (sendAnimTimer) clearTimeout(sendAnimTimer)
  sendClickAnimating.value = false
  requestAnimationFrame(() => {
    sendClickAnimating.value = true
    sendAnimTimer = setTimeout(() => {
      sendClickAnimating.value = false
      sendAnimTimer = null
    }, 410)
  })
  error.value = null
  attachBusy.value = true
  try {
    if (file) {
      await sendChatMessageWithFile(activeId.value, file, text || undefined)
      pendingAttachment.value = null
      if (fileInputRef.value) fileInputRef.value.value = ''
      draft.value = ''
    } else {
      await sendChatMessage(activeId.value, text)
      draft.value = ''
    }
    await reloadMessages()
    void scrollMessagesToBottomSoon()
    await refreshThreads()
    await refreshChatTotalUnread()
  } catch (e) {
    error.value = formatSupabaseError(e) || 'Не удалось отправить'
  } finally {
    attachBusy.value = false
  }
}

function triggerAttachmentPick() {
  if (chatLoading.value || attachBusy.value) return
  fileInputRef.value?.click()
}

function onAttachmentInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (!f) return
  pendingAttachment.value = f
}

function clearPendingAttachment() {
  pendingAttachment.value = null
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function markImagePreviewFailed(messageId: string) {
  if (!messageId) return
  failedImagePreviewIds.value = {
    ...failedImagePreviewIds.value,
    [messageId]: true,
  }
  void nextTick(onAttachmentLayoutChange)
}

function resetSwipeOffsets() {
  swipeDrag.value = null
  swipeDraggingId.value = null
  for (const k of Object.keys(swipeOffsets)) delete swipeOffsets[k]
}

function closeMsgContextMenu() {
  msgContextMenu.value = null
}

function openDeleteMessageModal(msg: UiChatMessage) {
  closeMsgContextMenu()
  deleteMessageTarget.value = msg
  deleteMessageModalOpen.value = true
}

function closeDeleteMessageModal() {
  deleteMessageModalOpen.value = false
  deleteMessageTarget.value = null
}

/** Закрытие модалки удаления только по действию пользователя (не во время запроса) */
function tryCloseDeleteMessageModal() {
  if (deleteMessageBusy.value) return
  closeDeleteMessageModal()
}

async function confirmDeleteMessage() {
  const msg = deleteMessageTarget.value
  if (!msg || deleteMessageBusy.value) return
  deleteMessageBusy.value = true
  error.value = null
  try {
    await deleteChatMessage(msg.id)
    delete swipeOffsets[msg.id]
    closeDeleteMessageModal()
    await reloadMessages()
    await refreshThreads()
    await refreshChatTotalUnread()
  } catch (e) {
    error.value = formatSupabaseError(e) || 'Не удалось удалить сообщение'
  } finally {
    deleteMessageBusy.value = false
  }
}

function onMessageContextMenu(e: MouseEvent, msg: UiChatMessage) {
  if (msg.side !== 'out') return
  e.preventDefault()
  const menuW = 200
  const menuH = 52
  let x = e.clientX
  let y = e.clientY
  if (typeof window !== 'undefined') {
    x = Math.min(x, window.innerWidth - menuW - 8)
    y = Math.min(y, window.innerHeight - menuH - 8)
    x = Math.max(8, x)
    y = Math.max(8, y)
  }
  msgContextMenu.value = { msg, x, y }
}

function ctxMenuDeleteClick() {
  const msg = msgContextMenu.value?.msg
  closeMsgContextMenu()
  if (msg) openDeleteMessageModal(msg)
}

function ownPaneStyle(msg: UiChatMessage): Record<string, string> {
  if (msg.side !== 'out') return {}
  const x = swipeOffsets[msg.id] ?? 0
  return { transform: `translate3d(${x}px,0,0)` }
}

function onOwnPaneTouchStart(e: TouchEvent, msg: UiChatMessage) {
  if (msg.side !== 'out' || e.touches.length !== 1) return
  closeMsgContextMenu()
  const t = e.touches[0]!
  swipeDrag.value = { id: msg.id, startX: t.clientX, base: swipeOffsets[msg.id] ?? 0 }
  swipeDraggingId.value = msg.id
}

function onOwnPaneTouchMove(e: TouchEvent, msg: UiChatMessage) {
  if (msg.side !== 'out' || !swipeDrag.value || swipeDrag.value.id !== msg.id || e.touches.length !== 1) return
  const t = e.touches[0]!
  const dx = t.clientX - swipeDrag.value.startX
  let next = swipeDrag.value.base + dx
  if (next > 0) next = 0
  if (next < -SWIPE_DELETE_W) next = -SWIPE_DELETE_W
  swipeOffsets[msg.id] = next
  if (Math.abs(dx) > 6) e.preventDefault()
}

function onOwnPaneTouchEnd(msg: UiChatMessage) {
  if (msg.side !== 'out') return
  if (swipeDrag.value?.id === msg.id) swipeDrag.value = null
  swipeDraggingId.value = null
  const cur = swipeOffsets[msg.id] ?? 0
  swipeOffsets[msg.id] = cur < -SWIPE_DELETE_W / 2 ? -SWIPE_DELETE_W : 0
}

function stripDeleteClick(msg: UiChatMessage) {
  openDeleteMessageModal(msg)
}

/** Красная зона удаления только при открытом свайпе — иначе даёт артефакты по краям пузыря */
function deleteStripVisible(msgId: string): boolean {
  return (swipeOffsets[msgId] ?? 0) < -4
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (attachBusy.value || draftLength.value > CHAT_MESSAGE_MAX_CHARS) return
    void onSend()
  }
}

function isImageAttachmentName(fileName: string | null | undefined): boolean {
  const name = String(fileName || '').toLowerCase()
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name)
}

function incomingAvatar(block: { msg: UiChatMessage }) {
  const tone = block.msg.inAvatarTone ?? active.value?.tone ?? 'blue'
  const initials = block.msg.inAvatarInitials ?? active.value?.initials ?? '?'
  // В группе — фото отправителя из меты; в личке — фото собеседника
  const url = block.msg.inAvatarUrl ?? (active.value?.kind === 'direct' ? active.value?.avatarUrl ?? null : null)
  return { tone, initials, url }
}

watch(dmSearch, (q) => {
  if (dmSearchTimer) clearTimeout(dmSearchTimer)
  dmSearchTimer = setTimeout(async () => {
    if (!configured.value) return
    dmLoading.value = true
    try {
      const list = q.trim() ? await searchEmployees(q.trim(), 40, null) : await loadEmployees(40, null)
      const me = myId.value
      dmResults.value = me ? list.filter((e) => e.id !== me) : list
    } catch (e) {
      console.error('Поиск сотрудников для диалога', e)
      dmResults.value = []
    } finally {
      dmLoading.value = false
    }
  }, 320)
})

async function openDmModal() {
  dmModalOpen.value = true
  dmSearch.value = ''
  if (!configured.value) return
  dmLoading.value = true
  try {
    const list = await loadEmployees(50, null)
    const me = myId.value
    dmResults.value = me ? list.filter((e) => e.id !== me) : list
  } finally {
    dmLoading.value = false
  }
}

async function pickDmPeer(row: EmployeeRow) {
  error.value = null
  try {
    const tid = await getOrCreateDmThread(row.id)
    dmModalOpen.value = false
    await refreshThreads()
    await refreshChatTotalUnread()
    const conv = conversations.value.find((c) => c.id === tid)
    if (conv) await onPick(conv)
  } catch (e) {
    error.value = formatSupabaseError(e) || 'Не удалось создать диалог'
  }
}

async function openGroupModal() {
  groupModalOpen.value = true
  groupTitle.value = ''
  groupSelected.value = new Set()
  if (!configured.value) return
  try {
    const list = await loadEmployees(80, null)
    const me = myId.value
    groupEmployees.value = me ? list.filter((e) => e.id !== me) : list
  } catch (e) {
    console.error('Список сотрудников для команды', e)
    groupEmployees.value = []
  }
}

function toggleGroupMember(id: string) {
  const next = new Set(groupSelected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  groupSelected.value = next
}

async function submitGroup() {
  if (!groupTitle.value.trim() || groupSelected.value.size === 0) {
    error.value = 'Укажите название и выберите хотя бы одного участника'
    return
  }
  groupBusy.value = true
  error.value = null
  try {
    const tid = await createGroupThread(groupTitle.value.trim(), [...groupSelected.value])
    groupModalOpen.value = false
    await refreshThreads()
    await refreshChatTotalUnread()
    const conv = conversations.value.find((c) => c.id === tid)
    if (conv) await onPick(conv)
  } catch (e) {
    error.value = formatSupabaseError(e) || 'Не удалось создать команду'
  } finally {
    groupBusy.value = false
  }
}

function onGlobalPointerDown(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (t?.closest?.('.chat-ctx-menu')) return
  closeMsgContextMenu()
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeMsgContextMenu()
    tryCloseDeleteMessageModal()
  }
}

onMounted(async () => {
  syncMobileChatLayout()
  if (typeof window !== 'undefined') {
    mobileChatMq = window.matchMedia(`(max-width: ${CHAT_MOBILE_BREAKPOINT_PX - 1}px)`)
    mobileChatMqHandler = () => {
      const narrow = mobileChatMq?.matches ?? false
      isMobileChatLayout.value = narrow
      if (narrow) mobileChatPanel.value = 'list'
    }
    mobileChatMq.addEventListener('change', mobileChatMqHandler)
  }
  document.addEventListener('pointerdown', onGlobalPointerDown)
  document.addEventListener('keydown', onGlobalKeydown)
  presenceTicker = setInterval(() => {
    presenceClock.value++
  }, 60_000)
  if (!configured.value) return
  listLoading.value = true
  error.value = null
  try {
    await refreshThreads()
    await refreshChatTotalUnread()
  } catch (e) {
    error.value = formatSupabaseError(e) || 'Не удалось загрузить чаты'
  } finally {
    listLoading.value = false
  }
})

onUnmounted(() => {
  if (mobileChatMq && mobileChatMqHandler) {
    mobileChatMq.removeEventListener('change', mobileChatMqHandler)
  }
  mobileChatMq = null
  mobileChatMqHandler = null
  document.removeEventListener('pointerdown', onGlobalPointerDown)
  document.removeEventListener('keydown', onGlobalKeydown)
  stopRealtime()
  if (dmSearchTimer) clearTimeout(dmSearchTimer)
  if (sendAnimTimer) clearTimeout(sendAnimTimer)
  if (presenceTicker) {
    clearInterval(presenceTicker)
    presenceTicker = null
  }
})
</script>

<template>
  <div class="chat-page tw-scope flex min-h-0 flex-col gap-4">
    <Alert v-if="!configured" class="shrink-0">
      <AlertDescription>Подключите Supabase (переменные окружения), чтобы чат работал с базой данных.</AlertDescription>
    </Alert>
    <Alert v-else-if="error" variant="destructive" class="shrink-0">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div class="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card shadow-xs">
      <!-- Список диалогов -->
      <section
        v-show="!isMobileChatLayout || mobileChatPanel === 'list'"
        class="flex min-h-0 flex-col"
        :class="isMobileChatLayout ? 'w-full' : 'w-80 shrink-0 border-r xl:w-96'"
        aria-label="Диалоги"
      >
        <div class="flex shrink-0 flex-col gap-3 border-b p-4">
          <div v-if="configured" class="flex items-center gap-2">
            <Button variant="outline" size="sm" type="button" @click="openDmModal">
              <SquarePenIcon />
              Написать
            </Button>
            <Button v-if="isManager" variant="outline" size="sm" type="button" @click="openGroupModal">
              <UsersRoundIcon />
              Новая команда
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              class="ml-auto text-muted-foreground"
              :disabled="refreshBusy || listLoading"
              title="Обновить список диалогов"
              aria-label="Обновить список диалогов"
              @click="refreshChat"
            >
              <RefreshCcwIcon :class="{ 'animate-spin': refreshBusy }" />
            </Button>
          </div>
          <InputGroup>
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput
              v-model="searchLocal"
              type="search"
              placeholder="Сотрудник или команда"
              autocomplete="off"
              aria-label="Поиск по ФИО сотрудника или названию команды"
            />
          </InputGroup>
          <Tabs :model-value="filterTab" @update:model-value="(v) => setTab(v as ChatFilterTab)">
            <TabsList class="w-full" aria-label="Фильтр диалогов">
              <TabsTrigger value="all">Все</TabsTrigger>
              <TabsTrigger value="unread">Непрочитанные</TabsTrigger>
              <TabsTrigger value="teams">Команды</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <div v-if="listLoading" class="flex flex-col" role="status" aria-label="Загрузка списка">
            <div v-for="i in 5" :key="i" class="flex items-center gap-3 px-4 py-3">
              <Skeleton class="size-10 shrink-0 rounded-full" />
              <div class="grid flex-1 gap-2">
                <Skeleton class="h-4 w-2/3" />
                <Skeleton class="h-3 w-1/2" />
              </div>
            </div>
          </div>
          <template v-else>
            <button
              v-for="c in filteredList"
              :key="c.id"
              type="button"
              class="flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
              :class="c.id === activeId ? 'bg-muted' : ''"
              :aria-current="c.id === activeId ? 'true' : undefined"
              @click="onPick(c)"
            >
              <div class="relative shrink-0">
                <UserAvatar class="size-10 text-sm font-medium" :class="toneClass(c.tone)" :url="c.avatarUrl" :initials="c.initials" />
                <span
                  v-if="c.kind === 'direct'"
                  class="absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-card"
                  :class="convListPresence(c).online ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
                  aria-hidden="true"
                />
              </div>
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <div class="flex min-w-0 items-baseline gap-2">
                  <span class="min-w-0 truncate text-sm font-medium">{{ c.name }}</span>
                  <span class="ml-auto shrink-0 text-xs tabular-nums" :class="c.unread > 0 ? 'font-medium text-primary dark:text-emerald-300' : 'text-muted-foreground'">
                    {{ c.lastTime }}
                  </span>
                </div>
                <span v-if="c.role" class="truncate text-xs text-muted-foreground">{{ c.role }}</span>
                <div class="flex min-w-0 items-center gap-2">
                  <span class="min-w-0 truncate text-sm" :class="c.unread > 0 ? 'text-foreground' : 'text-muted-foreground'">{{ c.lastPreview }}</span>
                  <span class="ml-auto flex shrink-0 items-center gap-1">
                    <UiBadge v-if="c.unreadUrgent > 0" tone="danger" :aria-label="`Важно: ${c.unreadUrgent}`">Важно</UiBadge>
                    <Badge v-if="c.unread > 0" class="h-5 min-w-5 rounded-full px-1.5 tabular-nums" :aria-label="`Непрочитано: ${c.unread}`">{{ c.unread > 9 ? '9+' : c.unread }}</Badge>
                  </span>
                </div>
              </div>
            </button>
            <p v-if="!filteredList.length" class="px-4 py-10 text-center text-sm text-muted-foreground">
              {{ searchLocal.trim() ? 'Никого не нашли' : filterTab === 'unread' ? 'Непрочитанных нет' : filterTab === 'teams' ? 'Команд пока нет' : 'Диалогов пока нет' }}
            </p>
          </template>
        </div>
      </section>

      <!-- Переписка -->
      <section
        v-show="!isMobileChatLayout || mobileChatPanel === 'thread'"
        class="flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label="Переписка"
      >
        <Empty v-if="!configured || !active" class="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon"><MessagesSquareIcon /></EmptyMedia>
            <EmptyTitle>Выберите диалог</EmptyTitle>
            <EmptyDescription>
              {{ configured ? 'Откройте переписку из списка или начните новую.' : 'Сообщения появятся после настройки базы.' }}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent v-if="configured">
            <Button variant="outline" size="sm" type="button" @click="openDmModal">
              <SquarePenIcon />
              Написать
            </Button>
          </EmptyContent>
        </Empty>

        <template v-else>
          <header class="flex shrink-0 items-center gap-3 border-b px-4 py-3">
            <Button
              v-if="isMobileChatLayout"
              variant="ghost"
              size="icon-sm"
              type="button"
              class="-ml-2"
              aria-label="Назад к списку чатов"
              @click="backToChatList"
            >
              <ChevronLeftIcon />
            </Button>
            <button
              v-if="active.kind === 'group'"
              type="button"
              class="shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              :aria-expanded="groupRosterExpanded"
              aria-controls="chat-group-roster"
              :aria-label="groupRosterExpanded ? 'Скрыть состав команды' : 'Показать состав команды'"
              @click="toggleGroupRoster"
            >
              <UserAvatar class="size-9 text-sm font-medium" :class="toneClass(active.tone)" :url="active.avatarUrl" :initials="active.initials" />
            </button>
            <div v-else class="relative shrink-0">
              <UserAvatar class="size-9 text-sm font-medium" :class="toneClass(active.tone)" :url="active.avatarUrl" :initials="active.initials" />
              <span
                class="absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-card"
                :class="activeDirectPresence?.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
                aria-hidden="true"
              />
            </div>
            <div class="flex min-w-0 flex-1 flex-col">
              <h2 class="truncate text-sm font-semibold">{{ active.name }}</h2>
              <p v-if="active.kind === 'group'" class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <button
                  type="button"
                  class="inline-flex items-center gap-0.5 rounded-sm underline-offset-2 hover:text-foreground hover:underline"
                  :aria-expanded="groupRosterExpanded"
                  aria-controls="chat-group-roster"
                  @click="toggleGroupRoster"
                >
                  {{ participantsLabel(groupMembers.length) }}
                  <ChevronDownIcon class="size-3.5 transition-transform" :class="groupRosterExpanded ? 'rotate-180' : ''" />
                </button>
                <span aria-hidden="true">·</span>
                <span :class="onlineInGroupCount > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''">в сети: {{ onlineInGroupCount }}</span>
              </p>
              <p v-else class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span v-if="active.role" class="truncate">{{ active.role }}</span>
                <span v-if="active.role && activeDirectPresence" aria-hidden="true">·</span>
                <span
                  v-if="activeDirectPresence"
                  class="truncate"
                  :class="activeDirectPresence.online ? 'text-emerald-600 dark:text-emerald-400' : ''"
                >
                  {{ activeDirectPresence.presenceLabel }}
                </span>
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              class="text-muted-foreground"
              title="Обновить переписку"
              aria-label="Обновить переписку"
              :disabled="refreshBusy"
              @click="refreshChat"
            >
              <RefreshCcwIcon :class="{ 'animate-spin': refreshBusy }" />
            </Button>
          </header>

          <div v-if="chatLoading" class="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner class="size-5" />
            Загрузка переписки…
          </div>

          <template v-else>
            <div
              v-if="active.kind === 'group'"
              v-show="groupRosterExpanded"
              id="chat-group-roster"
              class="max-h-64 shrink-0 overflow-y-auto border-b bg-muted/30 p-4"
              aria-label="Состав команды"
            >
              <div v-if="groupMembersLoading" class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Spinner class="size-4" />
                Загрузка состава…
              </div>
              <ul v-else class="grid gap-3 sm:grid-cols-2">
                <li v-for="m in groupMembers" :key="m.userId" class="flex min-w-0 items-center gap-3">
                  <div class="relative shrink-0">
                    <UserAvatar class="size-8 text-xs font-medium" :class="toneClass(m.tone)" :url="m.avatarUrl" :initials="m.initials" />
                    <span
                      class="absolute right-0 bottom-0 size-2 rounded-full ring-2 ring-card"
                      :class="groupMemberPresence(m).online ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
                      aria-hidden="true"
                    />
                  </div>
                  <div class="grid min-w-0">
                    <span class="truncate text-sm font-medium">
                      {{ m.displayName }}<span v-if="m.isSelf" class="font-normal text-muted-foreground"> (вы)</span>
                    </span>
                    <span class="truncate text-xs text-muted-foreground">
                      {{ m.roleLabel }} · <span :class="groupMemberPresence(m).online ? 'text-emerald-600 dark:text-emerald-400' : ''">{{ groupMemberPresence(m).presenceLabel }}</span>
                    </span>
                  </div>
                </li>
              </ul>
            </div>

            <div
              ref="messagesScrollEl"
              class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 py-4"
              @touchstart.passive="onThreadBackSwipeTouchStart"
              @touchend.passive="onThreadBackSwipeTouchEnd"
              @touchcancel.passive="onThreadBackSwipeTouchCancel"
              @scroll.passive="onMessagesScroll"
            >
              <div v-if="hasMoreOlderMessages" class="mb-2 flex justify-center">
                <Button variant="ghost" size="sm" type="button" class="text-muted-foreground" :disabled="olderLoading" @click="loadOlderMessages">
                  <Spinner v-if="olderLoading" class="size-4" />
                  {{ olderLoading ? 'Загрузка…' : 'Показать ранние сообщения' }}
                </Button>
              </div>

              <p v-if="!messageBlocks.length" class="m-auto text-center text-sm text-muted-foreground">Сообщений пока нет — напишите первым.</p>

              <template v-for="block in messageBlocks" :key="block.msg.id">
                <div v-if="block.day" class="my-3 flex justify-center first:mt-0">
                  <span class="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{{ block.day }}</span>
                </div>
                <div
                  class="flex items-end gap-2"
                  :class="[block.msg.side === 'out' ? 'justify-end' : 'justify-start', block.startsRun && !block.day ? 'mt-3' : 'mt-1']"
                >
                  <template v-if="block.msg.side === 'in' && active.kind === 'group'">
                    <UserAvatar
                      v-if="block.showAvatar"
                      class="size-8 shrink-0 self-start text-xs font-medium"
                      :class="toneClass(incomingAvatar(block).tone)"
                      :url="incomingAvatar(block).url"
                      :initials="incomingAvatar(block).initials"
                    />
                    <div v-else class="w-8 shrink-0" />
                  </template>

                  <div
                    class="relative flex max-w-[85%] min-w-0 flex-col sm:max-w-[70%]"
                    :class="block.msg.side === 'out' ? 'items-end' : 'items-start'"
                  >
                    <!-- Красная зона удаления под своим сообщением: видна только при свайпе влево -->
                    <div
                      v-if="block.msg.side === 'out' && deleteStripVisible(block.msg.id)"
                      class="absolute inset-y-0 right-0 flex w-[76px] items-center justify-center rounded-2xl bg-destructive"
                    >
                      <button
                        type="button"
                        class="flex size-full items-center justify-center text-white"
                        aria-label="Удалить сообщение"
                        @click="stripDeleteClick(block.msg)"
                      >
                        <Trash2Icon class="size-5" />
                      </button>
                    </div>
                    <div
                      class="relative flex min-w-0 flex-col gap-1 bg-card"
                      :class="[
                        block.msg.side === 'out' ? 'items-end' : 'items-start',
                        block.msg.side === 'out' && swipeDraggingId !== block.msg.id ? 'transition-transform duration-200' : '',
                      ]"
                      :style="ownPaneStyle(block.msg)"
                      @touchstart="onOwnPaneTouchStart($event, block.msg)"
                      @touchmove="onOwnPaneTouchMove($event, block.msg)"
                      @touchend="onOwnPaneTouchEnd(block.msg)"
                      @contextmenu="onMessageContextMenu($event, block.msg)"
                    >
                      <Bubble
                        v-if="block.msg.text"
                        :variant="block.msg.side === 'out' ? 'default' : block.msg.isUrgent ? 'destructive' : 'secondary'"
                        :align="block.msg.side === 'out' ? 'end' : 'start'"
                        class="max-w-full"
                      >
                        <BubbleContent class="break-words whitespace-pre-wrap">
                          <UiBadge v-if="block.msg.isUrgent && block.msg.side === 'in'" tone="danger" class="mb-1">Важно: проблема</UiBadge>
                          <p>{{ block.msg.text }}</p>
                        </BubbleContent>
                      </Bubble>
                      <a
                        v-if="block.msg.attachment?.url && isImageAttachmentName(block.msg.attachment.name) && !failedImagePreviewIds[block.msg.id]"
                        :href="block.msg.attachment.url"
                        class="block overflow-hidden rounded-xl border bg-muted no-underline"
                        target="_blank"
                        rel="noopener noreferrer"
                        :download="block.msg.attachment.name"
                        :title="`Открыть ${block.msg.attachment.name}`"
                      >
                        <img
                          :src="block.msg.attachment.url"
                          :alt="block.msg.attachment.name"
                          class="block max-h-64 w-auto max-w-full object-cover sm:max-w-72"
                          loading="lazy"
                          @load="onAttachmentLayoutChange"
                          @error="markImagePreviewFailed(block.msg.id)"
                        />
                      </a>
                      <component
                        :is="block.msg.attachment.url ? 'a' : 'div'"
                        v-else-if="block.msg.attachment"
                        v-bind="block.msg.attachment.url ? { href: block.msg.attachment.url, target: '_blank', rel: 'noopener noreferrer', download: block.msg.attachment.name } : {}"
                        class="flex max-w-full min-w-0 items-center gap-3 rounded-xl border bg-background p-3 text-foreground no-underline"
                        :class="block.msg.attachment.url ? 'transition-colors hover:bg-muted/60' : ''"
                      >
                        <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <FileIcon class="size-4" />
                        </span>
                        <span class="grid min-w-0">
                          <span class="truncate text-sm font-medium">{{ block.msg.attachment.name }}</span>
                          <span class="text-xs text-muted-foreground">
                            {{ block.msg.attachment.size }}<template v-if="block.msg.attachment.url"> · скачать</template>
                          </span>
                        </span>
                        <DownloadIcon v-if="block.msg.attachment.url" class="size-4 shrink-0 text-muted-foreground" />
                      </component>
                      <div v-if="block.showTime" class="flex items-center gap-1 px-1 text-xs text-muted-foreground tabular-nums">
                        <span>{{ block.msg.time }}</span>
                        <CheckCheckIcon v-if="block.msg.side === 'out' && block.msg.read" class="size-3.5 text-primary dark:text-emerald-400" aria-label="Прочитано" />
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>

            <footer class="shrink-0 border-t p-3 md:p-4">
              <input
                ref="chatFileInput"
                type="file"
                class="hidden"
                tabindex="-1"
                aria-hidden="true"
                @change="onAttachmentInputChange"
              />
              <div v-if="pendingAttachment" class="mb-2 flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 py-1 pr-1 pl-3 text-sm" role="status">
                <PaperclipIcon class="size-4 shrink-0 text-muted-foreground" />
                <span class="truncate" :title="pendingAttachment.name">{{ pendingAttachment.name }}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  class="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Убрать файл"
                  :disabled="attachBusy"
                  @click="clearPendingAttachment"
                >
                  <XIcon />
                </Button>
              </div>
              <InputGroup :class="{ 'opacity-70': attachBusy }">
                <InputGroupTextarea
                  v-model="draft"
                  rows="1"
                  class="max-h-40 min-h-10"
                  :maxlength="CHAT_MESSAGE_MAX_CHARS"
                  :placeholder="pendingAttachment ? 'Подпись к файлу (необязательно)' : composerPlaceholder"
                  :disabled="chatLoading || attachBusy"
                  @keydown="onKeydown"
                />
                <InputGroupAddon align="block-end">
                  <InputGroupButton
                    variant="ghost"
                    size="icon-sm"
                    title="Прикрепить файл до 10 МБ"
                    aria-label="Прикрепить файл"
                    :disabled="chatLoading || attachBusy"
                    @click="triggerAttachmentPick"
                  >
                    <PaperclipIcon />
                  </InputGroupButton>
                  <span
                    v-if="draftLength > CHAT_MESSAGE_MAX_CHARS * 0.8"
                    class="ml-auto text-xs tabular-nums"
                    :class="draftAtLimit ? 'text-destructive' : 'text-muted-foreground'"
                    aria-live="polite"
                  >
                    {{ draftLength }}/{{ CHAT_MESSAGE_MAX_CHARS }}
                  </span>
                  <InputGroupButton
                    variant="default"
                    size="icon-sm"
                    class="rounded-full"
                    :class="draftLength > CHAT_MESSAGE_MAX_CHARS * 0.8 ? '' : 'ml-auto'"
                    aria-label="Отправить"
                    :disabled="chatLoading || attachBusy || (!pendingAttachment && !draft.trim()) || draftLength > CHAT_MESSAGE_MAX_CHARS"
                    @click="onSend"
                  >
                    <Spinner v-if="attachBusy" class="size-4" />
                    <ArrowUpIcon v-else />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <p class="mt-2 hidden text-xs text-muted-foreground md:block">
                Enter — отправить, Shift+Enter — новая строка. Своё сообщение можно удалить через правую кнопку мыши.
              </p>
              <p class="mt-2 text-xs text-muted-foreground md:hidden">Своё сообщение: свайп влево или долгое нажатие — удалить.</p>
            </footer>
          </template>
        </template>
      </section>
    </div>

    <ChatDmDialog
      v-if="dmModalOpen"
      v-model:search="dmSearch"
      :results="dmResults"
      :loading="dmLoading"
      @close="dmModalOpen = false"
      @pick="pickDmPeer"
    />

    <ChatGroupDialog
      v-if="groupModalOpen"
      v-model:title="groupTitle"
      :employees="groupEmployees"
      :selected="groupSelected"
      :busy="groupBusy"
      @close="groupModalOpen = false"
      @toggle="toggleGroupMember"
      @submit="submitGroup"
    />

    <Teleport to="body">
      <div
        v-if="msgContextMenu"
        class="chat-ctx-menu tw-scope fixed z-[2600] min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        role="menu"
        :style="{ left: msgContextMenu.x + 'px', top: msgContextMenu.y + 'px' }"
        @pointerdown.stop
      >
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none hover:bg-destructive/10 focus-visible:bg-destructive/10"
          @click="ctxMenuDeleteClick"
        >
          <Trash2Icon class="size-4" />
          Удалить сообщение
        </button>
      </div>
    </Teleport>

    <UiConfirmModal
      v-if="deleteMessageModalOpen"
      title="Удалить сообщение?"
      :busy="deleteMessageBusy"
      @cancel="tryCloseDeleteMessageModal"
      @confirm="confirmDeleteMessage"
    >
      Это действие нельзя отменить.
      <template v-if="deleteMessageTarget?.attachment"> Вложенный файл будет удалён навсегда.</template>
    </UiConfirmModal>
  </div>
</template>

