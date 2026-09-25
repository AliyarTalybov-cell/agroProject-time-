<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import { Button } from '@/components/ui/shadcn/button'
import { ArrowRightIcon, CheckIcon, FileIcon, RefreshCcwIcon, SaveIcon, SearchIcon, SendIcon } from '@lucide/vue'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import ChatGroupDialog from '@/components/ui/dialogs/ChatGroupDialog.vue'
import ChatDmDialog from '@/components/ui/dialogs/ChatDmDialog.vue'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useAuth } from '@/stores/auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { loadEmployees, searchEmployees, type EmployeeRow } from '@/lib/employeesSupabase'
import UiTrashIcon from '@/components/UiTrashIcon.vue'
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

function toneClass(tone: AvatarTone) {
  return `chat-page__av chat-page__av--${tone}`
}

function renderMessageBlocks(msgs: UiChatMessage[]) {
  const blocks: { msg: UiChatMessage; showAvatar: boolean }[] = []
  let lastKey: string | null = null
  for (const msg of msgs) {
    const key = msg.side === 'out' ? 'out' : `in:${msg.senderId}`
    const showAvatar = key !== lastKey
    lastKey = key
    blocks.push({ msg, showAvatar })
  }
  return blocks
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
  messages.value = [...messages.value, ui]
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
    await nextTick()
    scrollMessagesToBottom()
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
    if (hadThread) chatLoading.value = false
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

function todayLabel(): string {
  const d = new Date()
  const months = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ]
  return `Сегодня, ${d.getDate()} ${months[d.getMonth()]}`
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
  if (t?.closest?.('.chat-page__ctx-menu')) return
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
  <div class="chat-page" :class="chatPageLayoutClass">
    <p v-if="!configured" class="chat-page__warn">
      Подключите Supabase (переменные окружения), чтобы чат работал с базой данных.
    </p>
    <p v-else-if="error" class="chat-page__err">{{ error }}</p>

    <!-- Левая колонка: список (структура как design/chat.html) -->
    <section class="chat-page__list" aria-label="Диалоги">
      <div class="chat-page__list-head">
        <div v-if="configured" class="chat-page__toolbar">
          <Button variant="outline" size="sm" type="button" class="chat-page__toolbar-btn chat-page__toolbar-btn--anim" @click="openDmModal">Написать</Button>
          <Button variant="outline" size="sm"
            type="button"
            class="chat-page__toolbar-btn chat-page__toolbar-btn--refresh chat-page__toolbar-btn--icon"
            :disabled="refreshBusy || listLoading"
            title="Обновить список диалогов и сообщения"
            aria-label="Обновить чат"
            @click="refreshChat"
          >
            <RefreshCcwIcon class="chat-page__toolbar-refresh-svg" :class="{ 'chat-page__toolbar-refresh-svg--spin': refreshBusy }" aria-hidden="true" :size="18" />
          </Button>
          <Button variant="default"
            v-if="isManager"
            type="button"
            class="chat-page__toolbar-btn chat-page__toolbar-btn--primary chat-page__toolbar-btn--anim"
            aria-label="Новая команда"
            @click="openGroupModal"
          >
            <span class="chat-page__toolbar-label chat-page__toolbar-label--full">Новая команда</span>
            <span class="chat-page__toolbar-label chat-page__toolbar-label--short" aria-hidden="true">Команда</span>
          </Button>
        </div>
        <div class="chat-page__search-wrap">
          <span class="chat-page__search-icon" aria-hidden="true">
            <SearchIcon :size="20" />
          </span>
          <input
            v-model="searchLocal"
            type="search"
            class="chat-page__search"
            placeholder="ФИО или название группы…"
            autocomplete="off"
            aria-label="Поиск по ФИО сотрудника или названию группы"
          />
        </div>
        <Tabs :model-value="filterTab">
          <TabsList aria-label="Фильтр диалогов">
            <TabsTrigger value="all"
           
            @click="setTab('all')">
            Все
          </TabsTrigger>
            <TabsTrigger value="unread"
           
            aria-label="Непрочитанные"
            @click="setTab('unread')">
            <span class="chat-page__tab-text chat-page__tab-text--full">Непрочитанные</span>
            <span class="chat-page__tab-text chat-page__tab-text--short" aria-hidden="true">Непрочит.</span>
          </TabsTrigger>
            <TabsTrigger value="teams"
           
            @click="setTab('teams')">
            Команды
          </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div class="chat-page__list-scroll">
        <div v-if="listLoading" class="chat-page__list-loader" role="status" aria-live="polite">
          <span class="chat-page__spinner chat-page__spinner--sm" aria-hidden="true" />
          <span class="chat-page__list-loader-text">Загрузка списка…</span>
        </div>
        <template v-else>
        <button
          v-for="c in filteredList"
          :key="c.id"
          type="button"
          class="chat-page__row"
          :class="{ 'chat-page__row--active': c.id === activeId, 'chat-page__row--urgent': c.unreadUrgent > 0 }"
          @click="onPick(c)"
        >
          <div class="chat-page__row-av-wrap">
            <UserAvatar :class="toneClass(c.tone)" :url="c.avatarUrl" :initials="c.initials" />
            <span
              class="chat-page__online"
              :class="convListPresence(c).online ? 'chat-page__online--on' : 'chat-page__online--off'"
              aria-hidden="true"
            />
          </div>
          <div class="chat-page__row-main">
            <div class="chat-page__row-top">
              <h3 class="chat-page__row-name">{{ c.name }}</h3>
              <span class="chat-page__row-time" :class="{ 'chat-page__row-time--accent': c.unread > 0 }">
                {{ c.lastTime }}
              </span>
            </div>
            <div class="chat-page__row-role">{{ c.role }}</div>
            <p class="chat-page__row-preview">
              {{ c.lastPreview }}
            </p>
          </div>
          <div v-if="c.unreadUrgent > 0" class="chat-page__urgent-badge" :aria-label="`Важно: ${c.unreadUrgent}`">
            Важно
          </div>
          <div v-if="c.unread > 0" class="chat-page__unread-badge" :aria-label="`Непрочитано: ${c.unread}`">
            {{ c.unread > 9 ? '9+' : c.unread }}
          </div>
        </button>
        <p v-if="!filteredList.length" class="chat-page__empty">Нет диалогов по выбранному фильтру.</p>
        </template>
      </div>
    </section>

    <!-- Правая колонка: активный чат -->
    <section class="chat-page__thread" aria-label="Переписка">
      <div v-if="!configured" class="chat-page__thread-empty">
        <p>Сообщения загружаются из Supabase после настройки проекта.</p>
      </div>
      <div v-else-if="!active" class="chat-page__thread-empty">
        <p>
          {{
            isMobileChatLayout
              ? 'Выберите диалог в списке или нажмите «Написать».'
              : 'Выберите диалог слева или нажмите «Написать».'
          }}
        </p>
      </div>
      <template v-else>
        <header class="chat-page__thread-head">
          <!-- From Uiverse.io by xopc333 — назад к списку (адаптировано под тему) -->
          <Button variant="ghost" size="icon-sm"
            v-if="isMobileChatLayout && mobileChatPanel === 'thread'"
            type="button"
            class="chat-page__mobile-back-btn"
            aria-label="Назад к списку чатов"
            @click="backToChatList"
          >
            <div class="chat-page__mobile-back-box">
              <span class="chat-page__mobile-back-ico" aria-hidden="true">
                <ArrowRightIcon />
              </span>
              <span class="chat-page__mobile-back-ico" aria-hidden="true">
                <ArrowRightIcon />
              </span>
            </div>
          </Button>
          <div class="chat-page__thread-user">
            <button
              v-if="active.kind === 'group'"
              type="button"
              class="chat-page__group-logo-btn chat-page__row-av-wrap"
              :aria-expanded="groupRosterExpanded"
              aria-controls="chat-group-roster"
              :aria-label="groupRosterExpanded ? 'Скрыть состав группы' : 'Показать состав группы'"
              :title="groupRosterExpanded ? 'Скрыть состав' : 'Показать состав'"
              @click="toggleGroupRoster"
            >
              <UserAvatar :class="toneClass(active.tone)" :url="active.avatarUrl" :initials="active.initials" />
            </button>
            <div v-else class="chat-page__row-av-wrap">
              <UserAvatar :class="toneClass(active.tone)" :url="active.avatarUrl" :initials="active.initials" />
              <span
                class="chat-page__online"
                :class="activeDirectPresence?.online ? 'chat-page__online--on' : 'chat-page__online--off'"
                aria-hidden="true"
              />
            </div>
            <div class="chat-page__thread-head-text">
              <h2 class="chat-page__thread-title">{{ active.name }}</h2>
              <p v-if="active.kind === 'group'" class="chat-page__thread-meta">
                <button
                  type="button"
                  class="chat-page__group-participants-btn"
                  :aria-expanded="groupRosterExpanded"
                  aria-controls="chat-group-roster"
                  :aria-label="`${groupRosterExpanded ? 'Скрыть' : 'Показать'} состав (${participantsLabel(groupMembers.length)})`"
                  :title="groupRosterExpanded ? 'Скрыть состав' : 'Показать состав'"
                  @click="toggleGroupRoster"
                >
                  {{ participantsLabel(groupMembers.length) }}
                </button>
                <span class="chat-page__dot" aria-hidden="true" />
                <span :class="onlineInGroupCount > 0 ? 'chat-page__status-on' : 'chat-page__status-off'">
                  В сети: {{ onlineInGroupCount }}
                </span>
              </p>
              <p v-else class="chat-page__thread-meta">
                {{ active.role }}
                <span class="chat-page__dot" aria-hidden="true" />
                <span
                  v-if="activeDirectPresence"
                  :class="activeDirectPresence.online ? 'chat-page__status-on' : 'chat-page__status-off'"
                >
                  {{ activeDirectPresence.presenceLabel }}
                </span>
              </p>
            </div>
          </div>
          <div class="chat-page__thread-actions">
            <Button variant="ghost" size="icon-sm"
              type="button"
              class="chat-page__icon-btn"
              title="Обновить переписку"
              aria-label="Обновить переписку"
              :disabled="refreshBusy"
              @click="refreshChat"
            >
              <RefreshCcwIcon class="chat-page__thread-refresh-ico" :class="{ 'chat-page__thread-refresh-ico--spin': refreshBusy }" aria-hidden="true" :size="20" />
            </Button>
          </div>
        </header>

        <div class="chat-page__thread-main">
          <div v-if="chatLoading" class="chat-page__chat-loading" role="status" aria-live="polite">
            <span class="chat-page__spinner chat-page__spinner--lg" aria-hidden="true" />
            <p class="chat-page__chat-loading-title">Загрузка чата</p>
          </div>

          <template v-else>
            <div class="chat-page__thread-loaded">
            <div
              v-if="active.kind === 'group'"
              id="chat-group-roster"
              v-show="groupRosterExpanded"
              class="chat-page__group-roster"
              aria-label="Состав группы"
            >
              <div class="chat-page__group-roster-head">
                <h3 class="chat-page__group-roster-title">Состав</h3>
                <span v-if="!groupMembersLoading" class="chat-page__group-roster-sub">
                  {{ onlineInGroupCount }} из {{ groupMembers.length }} в сети
                </span>
              </div>
              <div v-if="groupMembersLoading" class="chat-page__group-roster-loading" role="status">
                <span class="chat-page__spinner chat-page__spinner--sm" aria-hidden="true" />
                <span>Загрузка состава…</span>
              </div>
              <ul v-else class="chat-page__group-roster-list">
                <li v-for="m in groupMembers" :key="m.userId" class="chat-page__group-roster-item">
                  <div class="chat-page__row-av-wrap">
                    <UserAvatar :class="toneClass(m.tone)" :url="m.avatarUrl" :initials="m.initials" />
                    <span
                      class="chat-page__online"
                      :class="groupMemberPresence(m).online ? 'chat-page__online--on' : 'chat-page__online--off'"
                      :title="groupMemberPresence(m).presenceLabel"
                      :aria-label="`${m.displayName}, ${groupMemberPresence(m).presenceLabel}`"
                    />
                  </div>
                  <div class="chat-page__group-roster-text">
                    <span class="chat-page__group-roster-name">
                      {{ m.displayName }}
                      <span v-if="m.isSelf" class="chat-page__group-roster-you">(вы)</span>
                    </span>
                    <span class="chat-page__group-roster-role">{{ m.roleLabel }}</span>
                    <span
                      class="chat-page__group-roster-status"
                      :class="groupMemberPresence(m).online ? 'chat-page__group-roster-status--on' : 'chat-page__group-roster-status--off'"
                    >
                      {{ groupMemberPresence(m).presenceLabel }}
                    </span>
                  </div>
                </li>
              </ul>
            </div>

            <div
              ref="messagesScrollEl"
              class="chat-page__messages"
              @touchstart.passive="onThreadBackSwipeTouchStart"
              @touchend.passive="onThreadBackSwipeTouchEnd"
              @touchcancel.passive="onThreadBackSwipeTouchCancel"
            >
              <div v-if="hasMoreOlderMessages" class="chat-page__load-older-wrap">
                <Button variant="ghost" size="sm"
                  type="button"
                  class="chat-page__load-older"
                  :disabled="olderLoading"
                  @click="loadOlderMessages"
                >
                  <span v-if="olderLoading" class="chat-page__spinner chat-page__spinner--sm" aria-hidden="true" />
                  {{ olderLoading ? 'Загрузка…' : 'Ранее сообщения' }}
                </Button>
              </div>

              <div class="chat-page__date-pill-wrap">
                <span class="chat-page__date-pill">{{ todayLabel() }}</span>
              </div>

              <div v-if="!messageBlocks.length" class="chat-page__no-messages">Сообщений пока нет — напишите первым.</div>

              <div v-for="block in messageBlocks" :key="block.msg.id" class="chat-page__msg-row" :class="{ 'chat-page__msg-row--out': block.msg.side === 'out' }">
                <template v-if="block.msg.side === 'in'">
                  <UserAvatar
                    v-if="block.showAvatar"
                    :class="[toneClass(incomingAvatar(block).tone), 'chat-page__msg-av']"
                    :url="incomingAvatar(block).url"
                    :initials="incomingAvatar(block).initials"
                  />
                  <div v-else class="chat-page__msg-av-spacer" />
                </template>

                <div class="chat-page__msg-col" :class="{ 'chat-page__msg-col--out': block.msg.side === 'out' }">
                  <div
                    class="chat-page__msg-block-wrap"
                    :class="{
                      'chat-page__msg-block-wrap--own': block.msg.side === 'out',
                      'chat-page__msg-block-wrap--strip-open':
                        block.msg.side === 'out' && deleteStripVisible(block.msg.id),
                    }"
                  >
                    <div
                      v-if="block.msg.side === 'out'"
                      class="chat-page__msg-delete-strip"
                      :class="{ 'chat-page__msg-delete-strip--visible': deleteStripVisible(block.msg.id) }"
                    >
                      <button
                        type="button"
                        class="chat-page__msg-delete-strip-btn"
                        aria-label="Удалить сообщение"
                        @click="stripDeleteClick(block.msg)"
                      >
                        <UiTrashIcon class="chat-page__msg-delete-icon" aria-hidden="true" />
                      </button>
                    </div>
                    <div
                      class="chat-page__msg-block-pane"
                      :class="{
                        'chat-page__msg-block-pane--own': block.msg.side === 'out',
                        'chat-page__msg-block-pane--dt': block.msg.side !== 'out' || swipeDraggingId !== block.msg.id,
                      }"
                      :style="ownPaneStyle(block.msg)"
                      @touchstart="onOwnPaneTouchStart($event, block.msg)"
                      @touchmove="onOwnPaneTouchMove($event, block.msg)"
                      @touchend="onOwnPaneTouchEnd(block.msg)"
                      @contextmenu="onMessageContextMenu($event, block.msg)"
                    >
                      <div
                        v-if="block.msg.text"
                        class="chat-page__bubble"
                        :class="[
                          block.msg.side === 'out' ? 'chat-page__bubble--out' : 'chat-page__bubble--in',
                          block.msg.isUrgent && block.msg.side === 'in' ? 'chat-page__bubble--urgent' : '',
                        ]"
                      >
                        <div v-if="block.msg.isUrgent && block.msg.side === 'in'" class="chat-page__urgent-chip">Важно: проблема</div>
                        <p>{{ block.msg.text }}</p>
                      </div>
                      <a
                        v-if="
                          block.msg.attachment?.url &&
                          isImageAttachmentName(block.msg.attachment.name) &&
                          !failedImagePreviewIds[block.msg.id]
                        "
                        :href="block.msg.attachment.url"
                        class="chat-page__attach-preview"
                        :class="block.msg.side === 'out' ? 'chat-page__attach-preview--out' : ''"
                        target="_blank"
                        rel="noopener noreferrer"
                        :download="block.msg.attachment.name"
                      >
                        <img
                          :src="block.msg.attachment.url"
                          :alt="block.msg.attachment.name"
                          class="chat-page__attach-preview-img"
                          loading="lazy"
                          @error="markImagePreviewFailed(block.msg.id)"
                        />
                        <span class="chat-page__attach-preview-name">{{ block.msg.attachment.name }}</span>
                      </a>
                      <a
                        v-else-if="block.msg.attachment?.url"
                        :href="block.msg.attachment.url"
                        class="chat-page__attach"
                        :class="block.msg.side === 'out' ? 'chat-page__attach--out' : ''"
                        target="_blank"
                        rel="noopener noreferrer"
                        :download="block.msg.attachment.name"
                      >
                        <div class="chat-page__attach-icon" aria-hidden="true">
                          <FileIcon :size="24" />
                        </div>
                        <div class="chat-page__attach-meta">
                          <p class="chat-page__attach-name">{{ block.msg.attachment.name }}</p>
                          <p class="chat-page__attach-size">{{ block.msg.attachment.size }}</p>
                          <p class="chat-page__attach-hint">Скачать</p>
                        </div>
                      </a>
                      <div
                        v-else-if="block.msg.attachment"
                        class="chat-page__attach"
                        :class="block.msg.side === 'out' ? 'chat-page__attach--out' : ''"
                        role="group"
                        :aria-label="`Вложение: ${block.msg.attachment.name}`"
                      >
                        <div class="chat-page__attach-icon" aria-hidden="true">
                          <FileIcon :size="24" />
                        </div>
                        <div class="chat-page__attach-meta">
                          <p class="chat-page__attach-name">{{ block.msg.attachment.name }}</p>
                          <p class="chat-page__attach-size">{{ block.msg.attachment.size }}</p>
                        </div>
                      </div>
                      <div class="chat-page__msg-foot" :class="{ 'chat-page__msg-foot--out': block.msg.side === 'out' }">
                        <span>{{ block.msg.time }}</span>
                        <CheckIcon v-if="block.msg.side === 'out' && block.msg.read" class="chat-page__read-icon" aria-label="Прочитано" :size="16" />
                      </div>
                    </div>
                  </div>
                </div>

                <template v-if="block.msg.side === 'out'">
                  <UserAvatar v-if="block.showAvatar" class="chat-page__msg-av chat-page__msg-av--me" :url="myAvatarUrl" :initials="userInitials" />
                  <div v-else class="chat-page__msg-av-spacer" />
                </template>
              </div>
            </div>

            <footer class="chat-page__composer-wrap">
              <input
                ref="chatFileInput"
                type="file"
                class="chat-page__file-input-hidden"
                tabindex="-1"
                aria-hidden="true"
                @change="onAttachmentInputChange"
              />
              <div v-if="pendingAttachment" class="chat-page__pending-file" role="status">
                <span class="chat-page__pending-file-name" :title="pendingAttachment.name">{{ pendingAttachment.name }}</span>
                <Button variant="ghost" size="icon-sm" type="button" class="chat-page__pending-file-remove text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Убрать файл" :disabled="attachBusy" @click="clearPendingAttachment">
                  ×
                </Button>
              </div>
              <div class="chat-page__composer" :class="{ 'chat-page__composer--busy': attachBusy }">
            <!-- From Uiverse.io by ilkhoeri — иконка «документ» для вложения -->
            <button
              type="button"
              class="action_has has_saved chat-page__composer-attach"
              title="Прикрепить файл"
              aria-label="Прикрепить файл"
              :disabled="chatLoading || attachBusy"
              @click="triggerAttachmentPick"
            >
              <SaveIcon aria-hidden="true" :size="20" />
            </button>
            <textarea
              v-model="draft"
              class="chat-page__textarea"
              rows="1"
              :maxlength="CHAT_MESSAGE_MAX_CHARS"
              :placeholder="pendingAttachment ? 'Подпись к файлу (необязательно)…' : composerPlaceholder"
              :disabled="chatLoading || attachBusy"
              @keydown="onKeydown"
            />
            <div class="chat-page__composer-right">
              <!-- From Uiverse.io by adamgiebl -->
              <button
                type="button"
                class="chat-page__send"
                :class="{ 'chat-page__send--click-anim': sendClickAnimating }"
                aria-label="Отправить"
                :disabled="
                  chatLoading ||
                  attachBusy ||
                  (!pendingAttachment && !draft.trim()) ||
                  draftLength > CHAT_MESSAGE_MAX_CHARS
                "
                @click="onSend"
              >
                <div class="svg-wrapper-1">
                  <div class="svg-wrapper">
                    <SendIcon aria-hidden="true" :size="20" />
                  </div>
                </div>
              </button>
            </div>
              </div>
              <div class="chat-page__composer-meta">
                <p class="chat-page__hint">
                  <template v-if="isMobileChatLayout && mobileChatPanel === 'thread'">
                    Свайп вправо по ленте сообщений — вернуться к списку. Свои сообщения: долгое нажатие — меню, свайп
                    влево — удалить.
                  </template>
                  <template v-else>
                    Enter — отправить, Shift+Enter — перенос. До {{ CHAT_MESSAGE_MAX_CHARS }} символов. Файл до 10 МБ.
                    Свои сообщения: ПКМ — меню, на телефоне — свайп влево.
                  </template>
                </p>
                <span
                  class="chat-page__draft-count"
                  :class="{ 'chat-page__draft-count--limit': draftAtLimit }"
                  aria-live="polite"
                >
                  {{ draftLength }}/{{ CHAT_MESSAGE_MAX_CHARS }}
                </span>
              </div>
            </footer>
            </div>
          </template>
        </div>
      </template>
    </section>

    <!-- Личный диалог — Dialog + Command shadcn -->
    <ChatDmDialog
      v-if="dmModalOpen"
      v-model:search="dmSearch"
      :results="dmResults"
      :loading="dmLoading"
      @close="dmModalOpen = false"
      @pick="pickDmPeer"
    />

    <!-- Новая команда (только руководитель) — Dialog shadcn -->
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
      <Transition name="chat-ctx">
        <div v-if="msgContextMenu" class="chat-page__ctx-layer">
          <div
            class="chat-page__ctx-menu"
            role="menu"
            :style="{ left: msgContextMenu.x + 'px', top: msgContextMenu.y + 'px' }"
            @pointerdown.stop
          >
            <!-- Та же кнопка, что в полосе свайпа (Uiverse / boryanakrasteva), цвета под панель -->
            <button
              type="button"
              class="btn chat-page__ctx-delete-btn"
              role="menuitem"
              aria-label="Удалить сообщение"
              @click="ctxMenuDeleteClick"
            >
              <span class="chat-page__del-pill chat-page__del-pill--ctx" aria-hidden="true">Удалить</span>
              <UiTrashIcon class="icon" width="15.43" height="18" aria-hidden="true" />
            </button>
          </div>
        </div>
      </Transition>
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

<style scoped src="./ChatPage.css"></style>
