<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useAuth } from '@/stores/auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { loadEmployees, searchEmployees, type EmployeeRow } from '@/lib/employeesSupabase'
import UiTrashIcon from '@/components/UiTrashIcon.vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
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
  } catch {
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
    } catch {
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
  } catch {
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
          <button type="button" class="chat-page__toolbar-btn chat-page__toolbar-btn--anim" @click="openDmModal">Написать</button>
          <button
            type="button"
            class="chat-page__toolbar-btn chat-page__toolbar-btn--refresh chat-page__toolbar-btn--icon"
            :disabled="refreshBusy || listLoading"
            title="Обновить список диалогов и сообщения"
            aria-label="Обновить чат"
            @click="refreshChat"
          >
            <svg
              class="chat-page__toolbar-refresh-svg"
              :class="{ 'chat-page__toolbar-refresh-svg--spin': refreshBusy }"
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
          </button>
          <button
            v-if="isManager"
            type="button"
            class="chat-page__toolbar-btn chat-page__toolbar-btn--primary chat-page__toolbar-btn--anim"
            aria-label="Новая команда"
            @click="openGroupModal"
          >
            <span class="chat-page__toolbar-label chat-page__toolbar-label--full">Новая команда</span>
            <span class="chat-page__toolbar-label chat-page__toolbar-label--short" aria-hidden="true">Команда</span>
          </button>
        </div>
        <div class="chat-page__search-wrap">
          <span class="chat-page__search-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
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
        <div class="chat-page__tabs" role="tablist" aria-label="Фильтр диалогов">
          <button
            type="button"
            role="tab"
            :aria-selected="filterTab === 'all'"
            class="chat-page__tab"
            :class="{ 'chat-page__tab--active': filterTab === 'all' }"
            @click="setTab('all')"
          >
            Все
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="filterTab === 'unread'"
            class="chat-page__tab"
            :class="{ 'chat-page__tab--active': filterTab === 'unread' }"
            aria-label="Непрочитанные"
            @click="setTab('unread')"
          >
            <span class="chat-page__tab-text chat-page__tab-text--full">Непрочитанные</span>
            <span class="chat-page__tab-text chat-page__tab-text--short" aria-hidden="true">Непрочит.</span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="filterTab === 'teams'"
            class="chat-page__tab"
            :class="{ 'chat-page__tab--active': filterTab === 'teams' }"
            @click="setTab('teams')"
          >
            Команды
          </button>
        </div>
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
          <button
            v-if="isMobileChatLayout && mobileChatPanel === 'thread'"
            type="button"
            class="chat-page__mobile-back-btn"
            aria-label="Назад к списку чатов"
            @click="backToChatList"
          >
            <div class="chat-page__mobile-back-box">
              <span class="chat-page__mobile-back-ico" aria-hidden="true">
                <svg viewBox="0 0 46 40" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M46 20.038c0-.7-.3-1.5-.8-2.1l-16-17c-1.1-1-3.2-1.4-4.4-.3-1.2 1.1-1.2 3.3 0 4.4l11.3 11.9H3c-1.7 0-3 1.3-3 3s1.3 3 3 3h33.1l-11.3 11.9c-1 1-1.2 3.3 0 4.4 1.2 1.1 3.3.8 4.4-.3l16-17c.5-.5.8-1.1.8-1.9z"
                  />
                </svg>
              </span>
              <span class="chat-page__mobile-back-ico" aria-hidden="true">
                <svg viewBox="0 0 46 40" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M46 20.038c0-.7-.3-1.5-.8-2.1l-16-17c-1.1-1-3.2-1.4-4.4-.3-1.2 1.1-1.2 3.3 0 4.4l11.3 11.9H3c-1.7 0-3 1.3-3 3s1.3 3 3 3h33.1l-11.3 11.9c-1 1-1.2 3.3 0 4.4 1.2 1.1 3.3.8 4.4-.3l16-17c.5-.5.8-1.1.8-1.9z"
                  />
                </svg>
              </span>
            </div>
          </button>
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
            <button
              type="button"
              class="chat-page__icon-btn"
              title="Обновить переписку"
              aria-label="Обновить переписку"
              :disabled="refreshBusy"
              @click="refreshChat"
            >
              <svg
                class="chat-page__thread-refresh-ico"
                :class="{ 'chat-page__thread-refresh-ico--spin': refreshBusy }"
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
            </button>
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
                <button
                  type="button"
                  class="chat-page__load-older"
                  :disabled="olderLoading"
                  @click="loadOlderMessages"
                >
                  <span v-if="olderLoading" class="chat-page__spinner chat-page__spinner--sm" aria-hidden="true" />
                  {{ olderLoading ? 'Загрузка…' : 'Ранее сообщения' }}
                </button>
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
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M7 21h10a2 2 0 0 0 2-2V9.414a1 1 0 0 0-.293-.707l-5.414-5.414A1 1 0 0 0 12.586 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z" />
                          </svg>
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
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M7 21h10a2 2 0 0 0 2-2V9.414a1 1 0 0 0-.293-.707l-5.414-5.414A1 1 0 0 0 12.586 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z" />
                          </svg>
                        </div>
                        <div class="chat-page__attach-meta">
                          <p class="chat-page__attach-name">{{ block.msg.attachment.name }}</p>
                          <p class="chat-page__attach-size">{{ block.msg.attachment.size }}</p>
                        </div>
                      </div>
                      <div class="chat-page__msg-foot" :class="{ 'chat-page__msg-foot--out': block.msg.side === 'out' }">
                        <span>{{ block.msg.time }}</span>
                        <svg
                          v-if="block.msg.side === 'out' && block.msg.read"
                          class="chat-page__read-icon"
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          aria-label="Прочитано"
                        >
                          <path d="M5 13l4 4L19 7" />
                        </svg>
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
                <button type="button" class="chat-page__pending-file-remove" aria-label="Убрать файл" :disabled="attachBusy" @click="clearPendingAttachment">
                  ×
                </button>
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
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  data-path="box"
                />
                <path
                  d="M7 3L7 8L15 8"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  data-path="line-top"
                />
                <path
                  d="M17 20L17 13L7 13L7 20"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  data-path="line-bottom"
                />
              </svg>
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
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path fill="none" d="M0 0h24v24H0z"></path>
                      <path
                        fill="currentColor"
                        d="M1.946 9.315c-.522-.174-.527-.455.01-.634l19.087-6.362c.529-.176.832.12.684.638l-5.454 19.086c-.15.529-.455.547-.679.045L12 14l6-8-8 6-8.054-2.685z"
                      ></path>
                    </svg>
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

    <!-- Модалка: личный диалог -->
    <div v-if="dmModalOpen" class="chat-page__modal-backdrop" role="dialog" aria-modal="true" aria-label="Новое сообщение" @click.self="dmModalOpen = false">
      <div class="chat-page__modal" @click.stop>
        <div class="chat-page__modal-head">
          <h2 class="chat-page__modal-title">Кому написать</h2>
          <ModalCloseButton @click="dmModalOpen = false" />
        </div>
        <input v-model="dmSearch" type="search" class="chat-page__modal-search" placeholder="Поиск по сотрудникам…" autocomplete="off" />
        <div class="chat-page__modal-list">
          <p v-if="dmLoading" class="chat-page__empty">Поиск…</p>
          <button
            v-for="row in dmResults"
            :key="row.id"
            type="button"
            class="chat-page__modal-row"
            @click="pickDmPeer(row)"
          >
            <span class="chat-page__modal-row-name">{{ row.display_name?.trim() || row.email }}</span>
            <span class="chat-page__modal-row-meta">{{ row.position || row.role || '—' }}</span>
          </button>
          <p v-if="!dmLoading && !dmResults.length" class="chat-page__empty">Никого не найдено</p>
        </div>
      </div>
    </div>

    <!-- Модалка: группа (только руководитель) -->
    <div
      v-if="groupModalOpen"
      class="chat-page__modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Новая команда"
      @click.self="groupModalOpen = false"
    >
      <div class="chat-page__modal" @click.stop>
        <div class="chat-page__modal-head">
          <h2 class="chat-page__modal-title">Новая команда</h2>
          <ModalCloseButton @click="groupModalOpen = false" />
        </div>
        <label class="chat-page__modal-label">Название</label>
        <input v-model="groupTitle" type="text" class="chat-page__modal-input" placeholder="Например: Бригада поля №3" />
        <p class="chat-page__modal-hint">Выберите участников (вы будете добавлены автоматически).</p>
        <div class="chat-page__modal-list chat-page__modal-list--scroll">
          <label v-for="row in groupEmployees" :key="row.id" class="chat-page__check-row">
            <input type="checkbox" :checked="groupSelected.has(row.id)" @change="toggleGroupMember(row.id)" />
            <span>{{ row.display_name?.trim() || row.email }}</span>
            <span class="chat-page__modal-row-meta">{{ row.position || '' }}</span>
          </label>
        </div>
        <div class="chat-page__modal-footer">
          <button type="button" class="chat-page__toolbar-btn" :disabled="groupBusy" @click="groupModalOpen = false">Отмена</button>
          <button type="button" class="chat-page__toolbar-btn chat-page__toolbar-btn--primary" :disabled="groupBusy" @click="submitGroup">
            {{ groupBusy ? 'Создание…' : 'Создать' }}
          </button>
        </div>
      </div>
    </div>

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

    <div
      v-if="deleteMessageModalOpen"
      class="chat-page__modal-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="chat-delete-msg-title"
      @click.self="tryCloseDeleteMessageModal"
    >
      <div class="chat-page__modal chat-page__modal--sm" @click.stop>
        <h2 id="chat-delete-msg-title" class="chat-page__modal-title">Удалить сообщение?</h2>
        <p class="chat-page__modal-text">
          Это действие нельзя отменить.
          <template v-if="deleteMessageTarget?.attachment"> Вложенный файл будет удалён навсегда.</template>
        </p>
        <div class="chat-page__modal-footer">
          <button type="button" class="chat-page__toolbar-btn" :disabled="deleteMessageBusy" @click="tryCloseDeleteMessageModal">Отмена</button>
          <button type="button" class="chat-page__toolbar-btn chat-page__toolbar-btn--danger" :disabled="deleteMessageBusy" @click="confirmDeleteMessage">
            {{ deleteMessageBusy ? 'Удаление…' : 'Удалить' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-height: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

@media (min-width: 900px) {
  .chat-page {
    flex-direction: row;
    align-items: stretch;
    gap: var(--space-md);
    max-height: min(920px, calc(100dvh - 96px));
  }
}

.chat-page__list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

/* Мобильный: полноэкранно список ИЛИ чат (не делим экран пополам) */
@media (max-width: 899px) {
  .chat-page:not(.chat-page--mobile-thread) .chat-page__thread {
    display: none !important;
  }

  .chat-page--mobile-thread .chat-page__list {
    display: none !important;
  }

  .chat-page--mobile-list .chat-page__list,
  .chat-page--mobile-thread .chat-page__thread {
    flex: 1 1 0% !important;
    min-height: 0 !important;
    max-height: 100% !important;
    width: 100% !important;
    overflow: hidden;
  }
}

@media (min-width: 900px) {
  .chat-page__list {
    flex: 0 0 min(380px, 34vw);
    width: min(380px, 34vw);
    max-height: none;
    border-radius: 16px;
  }
}

.chat-page__list-head {
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

@media (min-width: 900px) {
  .chat-page__list-head {
    padding: 20px;
  }
}

.chat-page__search-wrap {
  position: relative;
}

.chat-page__search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
  display: flex;
  pointer-events: none;
}

.chat-page__search {
  width: 100%;
  padding: 10px 12px 10px 40px;
  border: none;
  border-radius: 12px;
  background: var(--chip-bg);
  color: var(--text-primary);
  font-size: 0.875rem;
}

.chat-page__search:focus {
  outline: 2px solid var(--accent-green);
  outline-offset: 1px;
}

.chat-page__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.chat-page__tab {
  border: none;
  cursor: pointer;
  padding: 6px 16px;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 500;
  background: transparent;
  color: var(--text-secondary);
  transition: background 0.15s ease, color 0.15s ease;
}

.chat-page__tab:hover {
  background: var(--row-hover-bg);
}

.chat-page__tab--active {
  background: var(--nav-active-bg);
  color: var(--nav-active-text);
}

.chat-page__list-scroll {
  flex: 1 1 0%;
  overflow-y: auto;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
}

.chat-page__row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0;
  padding: 16px;
  border: none;
  border-bottom: 1px solid var(--border-color);
  border-left: 4px solid transparent;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
  color: inherit;
}

.chat-page__row:hover {
  background: var(--row-hover-bg);
}

.chat-page__row--active {
  background: var(--nav-active-bg);
  border-left-color: var(--nav-active-bar);
}

.chat-page__row--urgent {
  background: color-mix(in srgb, var(--danger-red) 8%, transparent);
}

.chat-page__row-av-wrap {
  position: relative;
  flex-shrink: 0;
}

.chat-page__av {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.125rem;
}

.chat-page__av--blue {
  background: rgba(59, 130, 246, 0.15);
  color: #2563eb;
}
.chat-page__av--orange {
  background: rgba(234, 88, 12, 0.12);
  color: #ea580c;
}
.chat-page__av--purple {
  background: rgba(147, 51, 234, 0.12);
  color: #9333ea;
}
.chat-page__av--teal {
  background: rgba(13, 148, 136, 0.12);
  color: #0d9488;
}
.chat-page__av--rose {
  background: rgba(225, 29, 72, 0.1);
  color: #e11d48;
}

[data-theme='dark'] .chat-page__av--blue {
  background: rgba(59, 130, 246, 0.22);
  color: #93c5fd;
}
[data-theme='dark'] .chat-page__av--orange {
  background: rgba(234, 88, 12, 0.2);
  color: #fdba74;
}
[data-theme='dark'] .chat-page__av--purple {
  background: rgba(147, 51, 234, 0.22);
  color: #d8b4fe;
}
[data-theme='dark'] .chat-page__av--teal {
  background: rgba(13, 148, 136, 0.22);
  color: #5eead4;
}
[data-theme='dark'] .chat-page__av--rose {
  background: rgba(225, 29, 72, 0.2);
  color: #fda4af;
}

.chat-page__online {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--bg-panel);
}
.chat-page__online--on {
  background: var(--accent-green);
}
.chat-page__online--off {
  background: var(--text-muted);
}

.chat-page__row-main {
  flex: 1;
  min-width: 0;
  margin-left: 16px;
}

.chat-page__row-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.chat-page__row-name {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-page__row-time {
  font-size: 0.75rem;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.chat-page__row-time--accent {
  color: var(--accent-green);
  font-weight: 600;
}

.chat-page__row-role {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.chat-page__row-preview {
  margin: 4px 0 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
}

.chat-page__preview-check {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.chat-page__unread-badge {
  margin-left: 8px;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent-green);
  color: #fff;
  font-size: 0.6875rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.chat-page__urgent-badge {
  margin-left: 8px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--danger-red) 88%, white);
  color: #fff;
  font-size: 0.625rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.chat-page__empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

/* Thread */
.chat-page__thread {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

/* From Uiverse.io by xopc333 — круглая кнопка «назад» (40×40 как .chat-page__icon-btn) */
.chat-page__mobile-back-btn {
  --mobile-back-size: 40px;
  --mobile-back-shift: -40px;
  flex-shrink: 0;
  display: block;
  position: relative;
  width: var(--mobile-back-size);
  height: var(--mobile-back-size);
  margin: 0;
  padding: 0;
  overflow: hidden;
  outline: none;
  background-color: transparent;
  cursor: pointer;
  border: 0;
  -webkit-tap-highlight-color: transparent;
}

.chat-page__mobile-back-btn::before,
.chat-page__mobile-back-btn::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  inset: 5px;
}

.chat-page__mobile-back-btn::before {
  border: 3px solid color-mix(in srgb, var(--border-color) 65%, var(--text-secondary));
  transition:
    opacity 0.4s cubic-bezier(0.77, 0, 0.175, 1) 80ms,
    transform 0.5s cubic-bezier(0.455, 0.03, 0.515, 0.955) 80ms;
}

.chat-page__mobile-back-btn::after {
  border: 3px solid var(--accent-green);
  transform: scale(1.28);
  transition: opacity 0.4s cubic-bezier(0.165, 0.84, 0.44, 1), transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  opacity: 0;
}

.chat-page__mobile-back-btn:hover::before,
.chat-page__mobile-back-btn:focus-visible::before {
  opacity: 0;
  transform: scale(0.7);
  transition:
    opacity 0.4s cubic-bezier(0.165, 0.84, 0.44, 1),
    transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.chat-page__mobile-back-btn:hover::after,
.chat-page__mobile-back-btn:focus-visible::after {
  opacity: 1;
  transform: scale(1);
  transition:
    opacity 0.4s cubic-bezier(0.77, 0, 0.175, 1) 80ms,
    transform 0.5s cubic-bezier(0.455, 0.03, 0.515, 0.955) 80ms;
}

.chat-page__mobile-back-box {
  display: flex;
  position: absolute;
  top: 0;
  left: 0;
  width: calc(var(--mobile-back-size) * 2);
  height: var(--mobile-back-size);
  transition: transform 0.4s ease;
}

.chat-page__mobile-back-btn:hover .chat-page__mobile-back-box,
.chat-page__mobile-back-btn:focus-visible .chat-page__mobile-back-box {
  transform: translateX(var(--mobile-back-shift));
}

.chat-page__mobile-back-ico {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 var(--mobile-back-size);
  width: var(--mobile-back-size);
  height: var(--mobile-back-size);
  margin: 0;
  transform: rotate(180deg);
  color: var(--text-primary);
}

.chat-page__mobile-back-ico svg {
  display: block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  fill: currentColor;
}

.chat-page__mobile-back-btn:focus-visible {
  outline: 2px solid var(--accent-green);
  outline-offset: 2px;
}

.chat-page__thread-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  gap: 8px;
}

.chat-page__thread-user {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.chat-page__thread-head-text {
  min-width: 0;
  flex: 1;
}

.chat-page__thread-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-page__thread-meta {
  margin: 4px 0 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.chat-page__group-logo-btn {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 50%;
  line-height: 0;
  flex-shrink: 0;
}

.chat-page__group-logo-btn:focus-visible {
  outline: 2px solid var(--accent-green, #16a34a);
  outline-offset: 3px;
}

.chat-page__group-logo-btn:hover .chat-page__av,
.chat-page__group-logo-btn:focus-visible .chat-page__av {
  filter: brightness(0.97);
}

[data-theme='dark'] .chat-page__group-logo-btn:hover .chat-page__av,
[data-theme='dark'] .chat-page__group-logo-btn:focus-visible .chat-page__av {
  filter: brightness(1.08);
}

.chat-page__group-participants-btn {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: inherit;
  color: inherit;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
  text-underline-offset: 3px;
  border-radius: 4px;
}

.chat-page__group-participants-btn:hover,
.chat-page__group-participants-btn:focus-visible {
  color: var(--text-primary);
  text-decoration-color: currentColor;
}

.chat-page__group-participants-btn:focus-visible {
  outline: 2px solid var(--accent-green, #16a34a);
  outline-offset: 2px;
}

.chat-page__dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--border-color);
}

.chat-page__status-on {
  color: #16a34a;
  font-weight: 600;
}

.chat-page__status-off {
  color: var(--text-secondary);
  font-weight: 500;
}

.chat-page__thread-actions {
  display: flex;
  gap: 4px;
}

.chat-page__thread-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.chat-page__chat-loading {
  flex: 1;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 32px;
  background: color-mix(in srgb, var(--agri-bg) 55%, var(--bg-panel));
}

[data-theme='dark'] .chat-page__chat-loading {
  background: color-mix(in srgb, var(--bg-base) 80%, var(--bg-panel));
}

.chat-page__chat-loading-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-secondary);
  animation: chat-loading-pulse 1.2s ease-in-out infinite;
}

@keyframes chat-loading-pulse {
  0%,
  100% {
    opacity: 0.65;
  }
  50% {
    opacity: 1;
  }
}

.chat-page__thread-loaded {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-page__group-roster {
  flex-shrink: 0;
  padding: 12px 16px 14px;
  border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
  background: color-mix(in srgb, var(--agri-bg) 40%, var(--bg-panel));
}

[data-theme='dark'] .chat-page__group-roster {
  border-bottom-color: color-mix(in srgb, var(--text-primary) 12%, transparent);
  background: color-mix(in srgb, var(--bg-base) 70%, var(--bg-panel));
}

.chat-page__group-roster-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.chat-page__group-roster-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.chat-page__group-roster-sub {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.chat-page__group-roster-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.chat-page__group-roster-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(220px, 35vh);
  overflow-y: auto;
}

.chat-page__group-roster-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-panel) 85%, transparent);
}

[data-theme='dark'] .chat-page__group-roster-item {
  background: color-mix(in srgb, var(--bg-base) 50%, var(--bg-panel));
}

.chat-page__group-roster-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-page__group-roster-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.chat-page__group-roster-you {
  font-weight: 500;
  color: var(--text-secondary);
}

.chat-page__group-roster-role {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.chat-page__group-roster-status {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.35;
  text-transform: none;
}

.chat-page__group-roster-status--on {
  color: var(--accent-green);
}

.chat-page__group-roster-status--off {
  color: var(--text-secondary);
}

.chat-page__spinner {
  display: inline-block;
  width: 28px;
  height: 28px;
  border: 3px solid color-mix(in srgb, var(--accent-green) 25%, transparent);
  border-top-color: var(--accent-green);
  border-radius: 50%;
  animation: chat-spin 0.75s linear infinite;
}

.chat-page__spinner--sm {
  width: 22px;
  height: 22px;
  border-width: 2px;
}

.chat-page__spinner--lg {
  width: 40px;
  height: 40px;
  border-width: 3px;
}

@keyframes chat-spin {
  to {
    transform: rotate(360deg);
  }
}

.chat-page__list-loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 16px;
  color: var(--text-secondary);
}

.chat-page__list-loader-text {
  font-size: 0.8125rem;
  font-weight: 500;
}

.chat-page__toolbar-btn--refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.chat-page__toolbar-btn--icon {
  padding: 8px 10px;
  min-width: 40px;
}

.chat-page__toolbar-refresh-svg--spin {
  animation: chat-spin 0.8s linear infinite;
}

.chat-page__thread-refresh-ico--spin {
  animation: chat-spin 0.8s linear infinite;
}

.chat-page__icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}

.chat-page__icon-btn:hover:not(:disabled) {
  background: var(--row-hover-bg);
}

.chat-page__icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-page__load-older-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}

.chat-page__load-older {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--chip-bg);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.chat-page__load-older:hover:not(:disabled) {
  background: var(--row-hover-bg);
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--accent-green) 35%, var(--border-color));
}

.chat-page__load-older:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.chat-page__messages {
  flex: 1 1 0%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 24px;
  background: color-mix(in srgb, var(--agri-bg) 55%, var(--bg-panel));
}

[data-theme='dark'] .chat-page__messages {
  background: color-mix(in srgb, var(--bg-base) 80%, var(--bg-panel));
}

.chat-page__date-pill-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 24px;
}

.chat-page__date-pill {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--chip-bg);
  color: var(--text-secondary);
}

.chat-page__no-messages {
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.875rem;
  padding: 32px 16px;
}

.chat-page__msg-row {
  display: flex;
  gap: 12px;
  width: 100%;
  max-width: 48rem;
  min-width: 0;
  margin-bottom: 24px;
  align-items: flex-start;
}

.chat-page__msg-row--out {
  margin-left: auto;
  flex-direction: row;
  justify-content: flex-end;
}

.chat-page__msg-av {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: 0.625rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 4px;
}

.chat-page__msg-av--me {
  background: var(--accent-green);
  color: #fff;
}

.chat-page__msg-av-spacer {
  width: 32px;
  flex-shrink: 0;
}

.chat-page__msg-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  min-width: 0;
  max-width: 100%;
}

.chat-page__msg-col--out {
  align-items: flex-end;
}

.chat-page__msg-block-wrap {
  display: flex;
  flex-direction: column;
  max-width: 100%;
}

.chat-page__msg-block-wrap--own {
  position: relative;
  overflow: hidden;
  align-self: flex-end;
  border-radius: 4px;
}

/* Подсказка «Удалить» не обрезается, пока открыт свайп */
.chat-page__msg-block-wrap--own.chat-page__msg-block-wrap--strip-open {
  overflow: visible;
}

.chat-page__msg-delete-strip {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg-panel) 92%, var(--agri-bg));
  border-left: 1px solid var(--border-color);
  z-index: 0;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.18s ease,
    visibility 0.18s ease;
}

.chat-page__msg-delete-strip--visible {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

/* Плашка «Удалить» только при hover / focus — над иконкой */
.chat-page__del-pill {
  position: absolute;
  bottom: 100%;
  left: 50%;
  margin-bottom: 4px;
  padding: 3px 6px;
  border-radius: 5px;
  background-color: rgb(168, 7, 7);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.15;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  white-space: nowrap;
  z-index: 4;
  pointer-events: none;
  transform: translateX(-50%) translateY(4px);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s linear,
    visibility 0.2s linear,
    transform 0.2s linear;
}

.chat-page__del-pill--ctx {
  font-size: 9px;
  padding: 2px 5px;
}

/* В ПКМ-меню плашка снизу (как UiDeleteButton), не вылезает за край экрана */
.chat-page__ctx-menu .chat-page__ctx-delete-btn .chat-page__del-pill {
  top: 100%;
  bottom: auto;
  margin-bottom: 0;
  margin-top: 6px;
  transform: translateX(-50%) translateY(-6px);
}

.chat-page__ctx-menu .btn.chat-page__ctx-delete-btn:hover .chat-page__del-pill,
.chat-page__ctx-menu .btn.chat-page__ctx-delete-btn:focus-visible .chat-page__del-pill {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
  transition-delay: 0.15s;
}

.chat-page__msg-delete-strip-btn {
  background-color: transparent;
  position: relative;
  border: none;
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  overflow: visible;
}

.chat-page__msg-delete-icon {
  width: 15.43px;
  height: 18px;
  flex-shrink: 0;
  transform: scale(1);
  transition: 0.2s linear;
  display: block;
}

.chat-page__msg-delete-icon :deep(path) {
  fill: currentColor;
}

.chat-page__msg-delete-strip-btn:hover .chat-page__msg-delete-icon,
.chat-page__msg-delete-strip-btn:focus-visible .chat-page__msg-delete-icon {
  transform: scale(1.12);
}

.chat-page__msg-delete-strip-btn:hover,
.chat-page__msg-delete-strip-btn:focus-visible {
  color: rgb(168, 7, 7);
}

.chat-page__msg-delete-strip-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, rgb(168, 7, 7) 65%, white);
  outline-offset: 2px;
}

.chat-page__msg-delete-strip-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-page__msg-block-pane {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.chat-page__msg-block-pane--own {
  align-items: flex-end;
  background: transparent;
  touch-action: pan-y;
}

.chat-page__msg-block-pane--dt {
  transition: transform 0.22s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.chat-page__ctx-layer {
  position: fixed;
  inset: 0;
  z-index: 4500;
  pointer-events: none;
}

.chat-page__ctx-menu {
  position: fixed;
  pointer-events: auto;
  min-width: auto;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-card);
  overflow: visible;
  animation: chat-ctx-pop 0.2s ease;
}

@keyframes chat-ctx-pop {
  from {
    opacity: 0;
    transform: scale(0.94);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Контекстное меню: та же логика — плашка при наведении */
.chat-page__ctx-menu .btn.chat-page__ctx-delete-btn {
  background-color: transparent;
  position: relative;
  border: none;
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #64748b);
  overflow: visible;
}

.chat-page__ctx-menu .btn.chat-page__ctx-delete-btn .icon {
  transform: scale(1);
  transition: 0.2s linear;
  display: block;
}

.chat-page__ctx-menu .btn.chat-page__ctx-delete-btn .icon path {
  fill: currentColor;
}

.chat-page__ctx-menu .btn.chat-page__ctx-delete-btn:hover > .icon {
  transform: scale(1.12);
}

.chat-page__ctx-menu .btn.chat-page__ctx-delete-btn:hover > .icon path {
  fill: rgb(168, 7, 7);
}

.chat-page__bubble {
  padding: 12px 20px;
  border-radius: 16px;
  font-size: 15px;
  line-height: 1.625;
  box-shadow: var(--shadow-card);
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-page__bubble p {
  margin: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-page__bubble--in {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  border-top-left-radius: 4px;
}

.chat-page__bubble--urgent {
  border-color: color-mix(in srgb, var(--danger-red) 55%, var(--border-color));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--danger-red) 26%, transparent), var(--shadow-card);
}

.chat-page__urgent-chip {
  display: inline-flex;
  align-items: center;
  margin-bottom: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #fff;
  background: color-mix(in srgb, var(--danger-red) 88%, white);
}

.chat-page__bubble--out {
  background: var(--accent-green);
  color: #fff;
  border-top-right-radius: 4px;
}

a.chat-page__attach {
  text-decoration: none;
  color: inherit;
}

.chat-page__attach {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  max-width: 16rem;
  cursor: pointer;
  margin-top: 4px;
  border-top-left-radius: 4px;
  transition: background 0.15s ease;
}

.chat-page__attach:hover {
  background: var(--bg-panel-hover);
}

.chat-page__attach--out {
  border-top-right-radius: 4px;
  border-top-left-radius: 12px;
}

.chat-page__attach-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-page__attach-meta {
  min-width: 0;
  flex: 1;
}

.chat-page__attach-name {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-page__attach-size {
  margin: 2px 0 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.chat-page__attach-hint {
  margin: 4px 0 0;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--accent-green);
}

a.chat-page__attach-preview {
  text-decoration: none;
  color: inherit;
}

.chat-page__attach-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  max-width: min(240px, 62vw);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  padding: 6px;
  border-top-left-radius: 4px;
  overflow: hidden;
}

.chat-page__attach-preview--out {
  border-top-right-radius: 4px;
  border-top-left-radius: 12px;
}

.chat-page__attach-preview-img {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-panel) 78%, var(--chip-bg));
}

.chat-page__attach-preview-name {
  display: block;
  padding: 0 2px 1px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-page__msg-foot {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-left: 4px;
}

.chat-page__msg-foot--out {
  margin-left: 0;
  margin-right: 4px;
  flex-direction: row-reverse;
}

.chat-page__read-icon {
  color: #3b82f6;
  flex-shrink: 0;
}

.chat-page__composer-wrap {
  padding: 16px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
  background: var(--bg-panel);
  position: relative;
}

.chat-page__file-input-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
}

.chat-page__pending-file {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent-green) 12%, var(--chip-bg));
  border: 1px solid color-mix(in srgb, var(--accent-green) 35%, var(--border-color));
}

.chat-page__pending-file-name {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-page__pending-file-remove {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: var(--row-hover-bg);
  color: var(--text-secondary);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-page__pending-file-remove:hover:not(:disabled) {
  background: var(--border-color);
  color: var(--text-primary);
}

.chat-page__textarea:disabled,
.chat-page__composer-attach:disabled,
.chat-page__send:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.chat-page__composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px;
  border-radius: 16px;
  border: 1px solid var(--border-color);
  background: var(--chip-bg);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.chat-page__composer:focus-within {
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px var(--accent-green);
}

.chat-page__composer--busy {
  opacity: 0.75;
  pointer-events: none;
}

/* Uiverse.io / ilkhoeri — кнопка вложения файла */
.chat-page__composer-attach.action_has {
  --color: 220 9% 46%;
  /* было синее (211°); под цвет акцента — тёмно-зелёный как --accent-green светлой темы */
  --color-has: 146 33% 30%;
  --sz: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  height: calc(var(--sz) * 2.5);
  width: calc(var(--sz) * 2.5);
  padding: 0.4rem 0.5rem;
  border-radius: 0.375rem;
  border: 0.0625rem solid hsl(var(--color));
  flex-shrink: 0;
  background: transparent;
  color: hsl(var(--color));
}

[data-theme='dark'] .chat-page__composer-attach.action_has {
  --color: 215 14% 55%;
  /* как --accent-green в тёмной теме (#68ad33) */
  --color-has: 97 55% 52%;
}

.chat-page__composer-attach.has_saved:hover:not(:disabled) {
  border-color: hsl(var(--color-has));
}

.chat-page__composer-attach.has_saved:hover:not(:disabled) svg {
  color: hsl(var(--color-has));
}

.chat-page__composer-attach.has_saved svg {
  overflow: visible;
  height: calc(var(--sz) * 1.75);
  width: calc(var(--sz) * 1.75);
  --ease: cubic-bezier(0.5, 0, 0.25, 1);
  --zoom-from: 1.75;
  --zoom-via: 0.75;
  --zoom-to: 1;
  --duration: 1s;
}

.chat-page__composer-attach.has_saved:hover:not(:disabled) path[data-path='box'] {
  transition: all 0.3s var(--ease);
  animation: chat-attach-has-saved var(--duration) var(--ease) forwards;
  fill: hsl(var(--color-has) / 0.35);
}

.chat-page__composer-attach.has_saved:hover:not(:disabled) path[data-path='line-top'] {
  animation: chat-attach-has-saved-line-top var(--duration) var(--ease) forwards;
}

.chat-page__composer-attach.has_saved:hover:not(:disabled) path[data-path='line-bottom'] {
  animation:
    chat-attach-has-saved-line-bottom var(--duration) var(--ease) forwards,
    chat-attach-has-saved-line-bottom-2 calc(var(--duration) * 1) var(--ease) calc(var(--duration) * 0.75);
}

@keyframes chat-attach-has-saved-line-top {
  33.333% {
    transform: rotate(0deg) translate(1px, 2px) scale(var(--zoom-from));
    d: path('M 3 5 L 3 8 L 3 8');
  }
  66.666% {
    transform: rotate(20deg) translate(2px, -2px) scale(var(--zoom-via));
  }
  99.999% {
    transform: rotate(0deg) translate(0px, 0px) scale(var(--zoom-to));
  }
}

@keyframes chat-attach-has-saved-line-bottom {
  33.333% {
    transform: rotate(0deg) translate(1px, 2px) scale(var(--zoom-from));
    d: path('M 17 20 L 17 13 L 7 13 L 7 20');
  }
  66.666% {
    transform: rotate(20deg) translate(2px, -2px) scale(var(--zoom-via));
  }
  99.999% {
    transform: rotate(0deg) translate(0px, 0px) scale(var(--zoom-to));
    d: path('M 17 21 L 17 21 L 7 21 L 7 21');
  }
}

@keyframes chat-attach-has-saved-line-bottom-2 {
  from {
    d: path('M 17 21 L 17 21 L 7 21 L 7 21');
  }
  to {
    transform: rotate(0deg) translate(0px, 0px) scale(var(--zoom-to));
    d: path('M 17 20 L 17 13 L 7 13 L 7 20');
    fill: white;
  }
}

@keyframes chat-attach-has-saved {
  33.333% {
    transform: rotate(0deg) translate(1px, 2px) scale(var(--zoom-from));
  }
  66.666% {
    transform: rotate(20deg) translate(2px, -2px) scale(var(--zoom-via));
  }
  99.999% {
    transform: rotate(0deg) translate(0px, 0px) scale(var(--zoom-to));
  }
}

.chat-page__textarea {
  flex: 1;
  border: none;
  background: transparent;
  resize: none;
  min-height: 44px;
  max-height: 8rem;
  padding: 10px 4px;
  font-size: 15px;
  color: var(--text-primary);
  font-family: inherit;
}

.chat-page__textarea:focus {
  outline: none;
}

.chat-page__textarea::placeholder {
  color: var(--text-secondary);
  opacity: 0.85;
}

.chat-page__composer-right {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/* From Uiverse.io by adamgiebl — как в сниппете, только селектор .chat-page__send вместо button */
.chat-page__send {
  font-family: inherit;
  background: var(--accent-green);
  color: #fff;
  width: 44px;
  height: 40px;
  padding: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  border: none;
  border-radius: calc(16px * 0.85);
  overflow: hidden;
  transition: background 0.2s ease, transform 0.2s ease;
  cursor: pointer;
  margin-left: 4px;
  flex-shrink: 0;
}

.chat-page__send svg {
  display: block;
  transform-origin: center center;
  transition: transform 0.12s ease-out;
}

.chat-page__send:hover:not(:disabled) {
  background: var(--accent-green-hover);
}

.chat-page__send:hover:not(:disabled) svg {
  transform: rotate(18deg) scale(1.08);
}

.chat-page__send:active {
  transform: scale(0.95);
}

.chat-page__send--click-anim .svg-wrapper {
  animation: chat-send-fly-cycle 0.38s cubic-bezier(0.33, 1, 0.68, 1);
  will-change: transform, opacity;
}

@keyframes chat-send-fly-cycle {
  0% {
    transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
    opacity: 1;
  }
  /* Повернуться вправо на месте */
  18% {
    transform: translate3d(0, 0, 0) scale(1.02) rotate(28deg);
    opacity: 1;
  }
  /* Улететь вправо носиком вправо */
  40% {
    transform: translate3d(30px, -1px, 0) scale(1) rotate(34deg);
    opacity: 0;
  }
  /* Прилететь слева бочком */
  41% {
    transform: translate3d(-30px, 0, 0) scale(0.98) rotate(-72deg);
    opacity: 0;
  }
  68% {
    transform: translate3d(-10px, 0, 0) scale(1) rotate(10deg);
    opacity: 1;
  }
  /* Встать по центру, носик вверх */
  100% {
    transform: translate3d(0, 0, 0) scale(1) rotate(0deg);
    opacity: 1;
  }
}

.chat-page__send--click-anim svg {
  animation: chat-send-nose-up 0.38s cubic-bezier(0.33, 1, 0.68, 1);
}

@keyframes chat-send-nose-up {
  0% {
    transform: rotate(0deg);
  }
  42% {
    transform: rotate(22deg);
  }
  68% {
    transform: rotate(14deg);
  }
  100% {
    transform: rotate(0deg);
  }
}

.chat-page__composer-meta {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding: 0 8px;
}

.chat-page__hint {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.chat-page__draft-count {
  flex-shrink: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.chat-page__draft-count--limit {
  color: var(--accent-green);
}

.chat-page__warn,
.chat-page__err {
  width: 100%;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 0.875rem;
  margin: 0 0 var(--space-sm);
}

.chat-page__warn {
  background: var(--chip-bg);
  color: var(--text-secondary);
}

.chat-page__err {
  background: color-mix(in srgb, var(--danger-red) 12%, transparent);
  color: var(--danger-red);
}

.chat-page__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.chat-page__toolbar-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.chat-page__toolbar-btn:hover:not(:disabled) {
  background: var(--row-hover-bg);
}

.chat-page__toolbar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.chat-page__toolbar-btn--primary {
  background: var(--accent-green);
  border-color: var(--accent-green);
  color: #fff;
}

.chat-page__toolbar-btn--primary:hover:not(:disabled) {
  background: var(--accent-green-hover);
  border-color: var(--accent-green-hover);
}

.chat-page__toolbar-btn--anim {
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.22s ease,
    box-shadow 0.22s ease;
}

.chat-page__toolbar-btn--anim:hover:not(:disabled) {
  transform: translateY(-1px) scale(1.02);
  box-shadow: 0 6px 14px color-mix(in srgb, black 22%, transparent);
}

.chat-page__toolbar-btn--anim:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
}

.chat-page__toolbar-btn--danger {
  background: var(--danger-red);
  border-color: var(--danger-red);
  color: #fff;
}

.chat-page__toolbar-btn--danger:hover:not(:disabled) {
  filter: brightness(1.06);
}

.chat-page__thread-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  color: var(--text-secondary);
  font-size: 0.9375rem;
  text-align: center;
}

.chat-page__modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: var(--modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.chat-page__modal {
  width: 100%;
  max-width: 420px;
  max-height: min(560px, 90dvh);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: var(--shadow-card);
  padding: 0 0 16px;
  display: flex;
  flex-direction: column;
}

.chat-page__modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border-color);
}

.chat-page__modal-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

/* .chat-page__modal-close styles are in global.css */

.chat-page__modal-search,
.chat-page__modal-input {
  margin: 12px 18px 0;
  width: calc(100% - 36px);
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--chip-bg);
  color: var(--text-primary);
  font-size: 0.875rem;
}

.chat-page__modal-label {
  display: block;
  margin: 12px 18px 4px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.chat-page__modal-hint {
  margin: 8px 18px 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.chat-page__modal-list {
  margin-top: 12px;
  padding: 0 8px;
  max-height: 240px;
  overflow-y: auto;
}

.chat-page__modal-list--scroll {
  max-height: 220px;
}

.chat-page__modal-row {
  width: calc(100% - 16px);
  margin: 0 8px 6px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: var(--chip-bg);
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: inherit;
}

.chat-page__modal-row:hover {
  border-color: var(--border-color);
  background: var(--row-hover-bg);
}

.chat-page__modal-row-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.chat-page__modal-row-meta {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.chat-page__check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin: 0 8px 4px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.chat-page__check-row:hover {
  background: var(--row-hover-bg);
}

.chat-page__modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 18px 0;
  margin-top: 12px;
  border-top: 1px solid var(--border-color);
}

.chat-page__modal--sm {
  max-width: 380px;
  padding: 20px 0 8px;
}

.chat-page__modal--sm .chat-page__modal-title {
  padding: 0 20px;
  margin-bottom: 10px;
}

.chat-page__modal-text {
  margin: 0 20px 4px;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.chat-page__modal--sm .chat-page__modal-footer {
  border-top: none;
  margin-top: 8px;
  padding-top: 8px;
}

.chat-page__tab-text--short,
.chat-page__toolbar-label--short {
  display: none;
}

@media (max-width: 420px) {
  .chat-page__tab-text--full {
    display: none;
  }

  .chat-page__tab-text--short {
    display: inline;
  }
}

@media (max-width: 380px) {
  .chat-page__toolbar-label--full {
    display: none;
  }

  .chat-page__toolbar-label--short {
    display: inline;
  }
}

@media (max-width: 899px) {
  .chat-page__thread-head {
    padding: 10px 12px;
    gap: 8px;
    align-items: flex-start;
  }

  .chat-page__thread-actions {
    flex-shrink: 0;
    padding-top: 2px;
  }

  .chat-page__thread-user {
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .chat-page__thread-title {
    font-size: 1rem;
  }

  .chat-page__thread-meta {
    font-size: 0.8125rem;
  }

  .chat-page__row {
    padding: 12px;
    gap: 0;
  }

  .chat-page__row-main {
    margin-left: 12px;
  }

  .chat-page__av {
    width: 44px;
    height: 44px;
    font-size: 1rem;
  }

  .chat-page__search {
    font-size: 16px; /* iOS: не увеличивать зум при фокусе */
  }

  .chat-page__tabs {
    margin-top: 12px;
    gap: 6px;
  }

  .chat-page__tab {
    padding: 6px 12px;
    font-size: 0.8125rem;
  }

  .chat-page__toolbar {
    gap: 6px;
    margin-bottom: 10px;
  }

  .chat-page__toolbar-btn {
    padding: 8px 12px;
    font-size: 0.75rem;
  }

  .chat-page__messages {
    padding: 12px 10px;
  }

  .chat-page__msg-row {
    margin-bottom: 16px;
    max-width: 100%;
  }

  .chat-page__attach-preview {
    max-width: min(210px, 70vw);
    padding: 5px;
  }

  .chat-page__attach-preview-name {
    font-size: 0.6875rem;
  }

  .chat-page__composer-wrap {
    padding: 10px 10px max(10px, env(safe-area-inset-bottom, 0px));
  }

  .chat-page__composer {
    gap: 6px;
    padding: 6px;
    border-radius: 12px;
  }

  .chat-page__textarea {
    font-size: 16px;
    min-height: 40px;
    padding: 8px 4px;
    max-height: 6.5rem;
  }

  .chat-page__composer-meta {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 0 4px;
  }

  .chat-page__draft-count {
    align-self: flex-end;
  }

  .chat-page__composer-attach.action_has {
    --sz: 0.9rem;
  }

  .chat-page__send {
    position: relative;
    margin-left: 2px;
    width: 42px;
    height: 38px;
  }

  .chat-page__modal-backdrop {
    padding: max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px))
      max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px));
    align-items: center;
    justify-content: center;
  }

  /* Диалоги выбора — снизу как sheet */
  .chat-page__modal-backdrop:has(.chat-page__modal:not(.chat-page__modal--sm)) {
    align-items: flex-end;
  }

  .chat-page__modal {
    max-height: min(92dvh, calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px));
    width: 100%;
    max-width: 100%;
    border-radius: 16px 16px 0 0;
  }

  .chat-page__modal--sm {
    border-radius: 16px;
    max-width: calc(100vw - 24px);
    width: 100%;
  }

  .chat-page__modal-list,
  .chat-page__modal-list--scroll {
    max-height: min(42dvh, 280px);
  }

  .chat-page__modal-footer {
    flex-wrap: wrap;
    justify-content: stretch;
  }

  .chat-page__modal-footer .chat-page__toolbar-btn {
    flex: 1 1 auto;
    min-width: 0;
  }
}

@media (max-width: 380px) {
  .chat-page__hint {
    font-size: 0.6875rem;
    line-height: 1.35;
  }
}
</style>
