import { ref } from 'vue'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { assertCanDelete } from '@/lib/deletePermissions'

/** Бейдж в сайдбаре (обновляется опросом и после действий в чате) */
export const chatTotalUnread = ref(0)

export type ChatFilterTab = 'all' | 'unread' | 'teams'

export type AvatarTone = 'blue' | 'orange' | 'purple' | 'teal' | 'rose'

const TONES: AvatarTone[] = ['blue', 'orange', 'purple', 'teal', 'rose']

export function avatarToneFromUserId(id: string): AvatarTone {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return TONES[h % TONES.length]!
}

export function initialsFromProfile(displayName: string | null | undefined, email: string): string {
  const base = (displayName && displayName.trim()) || email.split('@')[0] || '?'
  const parts = base.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase()
  if (parts[0]!.length >= 2) return parts[0]!.slice(0, 2).toUpperCase()
  return parts[0]![0]!.toUpperCase()
}

export type ChatThreadListRow = {
  thread_id: string
  kind: 'direct' | 'group'
  title: string | null
  updated_at: string
  last_message_body: string
  last_message_at: string | null
  last_sender_id: string | null
  unread_count: number
  unread_urgent_count?: number
  peer_user_id: string | null
  peer_display_name: string | null
  peer_email: string | null
  peer_position: string | null
  /** Для «в сети» по last_activity_at (RPC list_my_chat_threads) */
  peer_last_activity_at?: string | null
}

export type UiChatConversation = {
  id: string
  kind: 'direct' | 'group'
  name: string
  role: string
  initials: string
  tone: AvatarTone
  /** Фото собеседника (личка); у группы null */
  avatarUrl: string | null
  lastPreview: string
  lastTime: string
  unread: number
  unreadUrgent: number
  isTeam: boolean
  peerUserId: string | null
  /** Для лички: profiles.last_activity_at; у группы null (присутствие не по собеседнику) */
  peerLastActivityAt: string | null
  /** Для поиска: ФИО + email (личка) или название группы */
  searchHaystack: string
}

export type ChatMessageRow = {
  id: string
  thread_id: string
  sender_id: string
  body: string | null
  attachment_bucket: string | null
  attachment_path: string | null
  attachment_name: string | null
  attachment_size: number | null
  is_urgent?: boolean | null
  urgent_kind?: 'problem_report' | null
  created_at: string
}

export type UiChatMessage = {
  id: string
  side: 'in' | 'out'
  senderId: string
  text?: string
  time: string
  read?: boolean
  attachment?: { name: string; size: string; url?: string }
  createdAt: string
  isUrgent: boolean
  urgentKind?: 'problem_report'
  /** В группе — аватар отправителя входящих */
  inAvatarInitials?: string
  inAvatarTone?: AvatarTone
  inAvatarUrl?: string | null
}

function formatBytes(n: number | null): string {
  if (n == null || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Относительное время для списка диалогов */
export function formatThreadListTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((startToday.getTime() - startMsg.getTime()) / 86400000)
  if (diffDays === 0) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) return 'Вчера'
  if (diffDays < 7) {
    return d.toLocaleDateString('ru-RU', { weekday: 'short' })
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/** Время внутри пузыря */
export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Порог «в сети» по last_activity_at (должен совпадать с продуктовой логикой на UI) */
export const PRESENCE_ONLINE_WITHIN_MS = 15 * 60 * 1000

/**
 * Присутствие по полю last_activity_at: не позднее 15 мин — «В сети», иначе дата и время.
 */
export function presenceFromLastActivity(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): { online: boolean; presenceLabel: string } {
  if (!iso) {
    return { online: false, presenceLabel: 'Нет данных об активности' }
  }
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) {
    return { online: false, presenceLabel: 'Нет данных об активности' }
  }
  if (nowMs - t <= PRESENCE_ONLINE_WITHIN_MS) {
    return { online: true, presenceLabel: 'В сети' }
  }
  const formatted = new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return { online: false, presenceLabel: `Был в сети ${formatted}` }
}

export function mapThreadRow(r: ChatThreadListRow): UiChatConversation {
  const isTeam = r.kind === 'group'
  const peerId = r.peer_user_id
  const email = r.peer_email ?? ''
  const name = isTeam
    ? (r.title || 'Группа')
    : (r.peer_display_name?.trim() || email.split('@')[0] || 'Сотрудник')
  const role = isTeam ? 'Групповой чат' : (r.peer_position?.trim() || 'Сотрудник')
  const initials = isTeam
    ? (r.title || 'Гр').slice(0, 2).toUpperCase()
    : initialsFromProfile(r.peer_display_name, email)
  const toneKey = isTeam ? r.thread_id : peerId || r.thread_id
  const searchHaystack = isTeam
    ? [r.title?.trim(), name.trim()].filter((s) => s && s.length > 0).join(' ')
    : [r.peer_display_name?.trim(), email.trim()].filter((s) => s && s.length > 0).join(' ')
  return {
    id: r.thread_id,
    kind: r.kind,
    name,
    role,
    initials,
    tone: avatarToneFromUserId(toneKey),
    avatarUrl: null,
    lastPreview: r.last_message_body || (isTeam ? 'Нет сообщений' : ''),
    lastTime: formatThreadListTime(r.last_message_at),
    unread: Number(r.unread_count) || 0,
    unreadUrgent: Number(r.unread_urgent_count) || 0,
    isTeam,
    peerUserId: peerId,
    peerLastActivityAt: !isTeam ? (r.peer_last_activity_at ?? null) : null,
    searchHaystack,
  }
}

/**
 * Поиск в списке чатов: по подстроке или по всем «словам» запроса (≥2 символов) в любом порядке — удобно для ФИО.
 */
export function matchesChatListSearch(haystack: string, queryRaw: string): boolean {
  const q = queryRaw.trim()
  if (!q) return true
  let h: string
  let query: string
  try {
    h = haystack.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ')
    query = q.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()
  } catch {
    h = haystack.toLowerCase().replace(/\s+/g, ' ')
    query = q.toLowerCase().replace(/\s+/g, ' ').trim()
  }
  if (h.includes(query)) return true
  const tokens = query.split(/\s+/).filter((t) => t.length >= 2)
  if (tokens.length >= 2 && tokens.every((t) => h.includes(t))) return true
  return false
}

export async function fetchChatThreadList(): Promise<ChatThreadListRow[]> {
  if (!isSupabaseConfigured() || !supabase) return []
  const { data, error } = await supabase.rpc('list_my_chat_threads')
  if (error) throw error
  return (data ?? []) as ChatThreadListRow[]
}

export async function refreshChatTotalUnread(): Promise<void> {
  if (!isSupabaseConfigured() || !supabase) {
    chatTotalUnread.value = 0
    return
  }
  const { data, error } = await supabase.rpc('chat_total_unread')
  if (error) {
    console.warn('chat_total_unread', error)
    return
  }
  chatTotalUnread.value = typeof data === 'number' ? data : Number(data ?? 0)
}

/** Бакет для вложений в чате (миграция add_chat_attachments_storage) */
export const CHAT_ATTACHMENTS_BUCKET = 'chat-attachments'

/** Лимит размера файла на клиенте (сервер: file_size_limit в бакете) */
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

/** Максимум символов в тексте сообщения и в подписи к файлу (сервер: check в миграции) */
export const CHAT_MESSAGE_MAX_CHARS = 300

export function getChatAttachmentPublicUrl(bucket: string | null | undefined, path: string | null | undefined): string | undefined {
  if (!supabase || !path) return undefined
  const b = bucket?.trim() || CHAT_ATTACHMENTS_BUCKET
  const { data } = supabase.storage.from(b).getPublicUrl(path)
  return data.publicUrl
}

/** Размер страницы истории (сервер: list_chat_messages_page, макс. 100) */
export const CHAT_MESSAGES_PAGE_SIZE = 30

export type ChatMessagesPageCursor = { createdAt: string; id: string }

/**
 * Страница сообщений: сначала новые (сервер), возвращаем в хронологическом порядке (старые → новые).
 * Без курсора — последние `limit` сообщений.
 */
export async function fetchThreadMessagesPage(
  threadId: string,
  opts?: { limit?: number; before?: ChatMessagesPageCursor | null },
): Promise<ChatMessageRow[]> {
  if (!supabase) return []
  const limit = Math.min(Math.max(opts?.limit ?? CHAT_MESSAGES_PAGE_SIZE, 1), 100)
  const before = opts?.before ?? null
  const { data, error } = await supabase.rpc('list_chat_messages_page', {
    p_thread: threadId,
    p_limit: limit,
    p_before_created_at: before?.createdAt ?? null,
    p_before_id: before?.id ?? null,
  })
  if (error) throw error
  const rows = (data ?? []) as ChatMessageRow[]
  return rows.slice().reverse()
}

/** @deprecated Используй fetchThreadMessagesPage — по умолчанию только последняя страница */
export async function fetchThreadMessages(threadId: string): Promise<ChatMessageRow[]> {
  return fetchThreadMessagesPage(threadId, { before: null })
}

export type ThreadMessageRealtimePayload =
  | { kind: 'insert'; record: ChatMessageRow }
  | { kind: 'delete'; messageId: string }

export type SenderMeta = { initials: string; tone: AvatarTone; avatarUrl: string | null }

export async function fetchSenderMetaMap(senderIds: string[]): Promise<Map<string, SenderMeta>> {
  const map = new Map<string, SenderMeta>()
  const uniq = [...new Set(senderIds)].filter(Boolean)
  if (!supabase || !uniq.length) return map
  const baseCols = 'id, display_name, email, position'
  let rows: { id: string; display_name: string | null; email: string; position: string | null; avatar_url?: string | null }[] = []
  const withAvatar = await supabase.from('profiles').select(`${baseCols}, avatar_url`).in('id', uniq)
  if (!withAvatar.error && withAvatar.data) {
    rows = withAvatar.data as typeof rows
  } else {
    const base = await supabase.from('profiles').select(baseCols).in('id', uniq)
    if (base.error || !base.data) return map
    rows = base.data as typeof rows
  }
  for (const p of rows) {
    map.set(p.id, {
      initials: initialsFromProfile(p.display_name, p.email || ''),
      tone: avatarToneByPosition(p.position),
      avatarUrl: p.avatar_url ?? null,
    })
  }
  return map
}

/** Карта userId → avatar_url для произвольного набора пользователей (для лички/списка чатов). */
export async function fetchProfileAvatarMap(ids: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  const uniq = [...new Set(ids)].filter(Boolean)
  if (!supabase || !uniq.length) return map
  const { data, error } = await supabase.from('profiles').select('id, avatar_url').in('id', uniq)
  if (error || !data) return map
  for (const p of data as { id: string; avatar_url: string | null }[]) {
    map.set(p.id, p.avatar_url ?? null)
  }
  return map
}

function avatarToneByPosition(position: string | null | undefined): AvatarTone {
  const key = String(position || '—')
    .trim()
    .toLowerCase()
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return TONES[h % TONES.length]!
}

export function mapMessagesForUi(
  rows: ChatMessageRow[],
  myUserId: string,
  peerLastReadAt: string | null,
  options?: { isGroup: boolean; senderMeta: Map<string, SenderMeta> },
): UiChatMessage[] {
  return rows.map((m) => {
    const out = m.sender_id === myUserId
    const att = m.attachment_name
      ? {
          name: m.attachment_name,
          size: formatBytes(m.attachment_size),
          ...(m.attachment_path
            ? { url: getChatAttachmentPublicUrl(m.attachment_bucket, m.attachment_path) }
            : {}),
        }
      : undefined
    let read: boolean | undefined
    if (out && peerLastReadAt) {
      read = new Date(peerLastReadAt) >= new Date(m.created_at)
    }
    const meta = !out && options?.isGroup ? options.senderMeta.get(m.sender_id) : undefined
    return {
      id: m.id,
      side: out ? 'out' : 'in',
      senderId: m.sender_id,
      text: m.body?.trim() ? m.body : undefined,
      time: formatMessageTime(m.created_at),
      read,
      attachment: att,
      createdAt: m.created_at,
      isUrgent: Boolean(m.is_urgent),
      urgentKind: m.urgent_kind === 'problem_report' ? 'problem_report' : undefined,
      inAvatarInitials: meta?.initials,
      inAvatarTone: meta?.tone,
      inAvatarUrl: meta?.avatarUrl ?? null,
    }
  })
}

export async function markThreadAsRead(threadId: string): Promise<void> {
  if (!supabase) return
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  // Предпочитаем RPC (SECURITY DEFINER): стабильнее при RLS, чем прямой UPDATE из клиента.
  const { error: rpcErr } = await supabase.rpc('mark_chat_thread_read', { p_thread: threadId })
  if (rpcErr) {
    const msg = String((rpcErr as { message?: string }).message || '')
    const code = String((rpcErr as { code?: string }).code || '')
    const ml = msg.toLowerCase()
    const missingFn =
      code === '42883' ||
      code === 'PGRST202' ||
      ml.includes('could not find') ||
      ml.includes('does not exist') ||
      ml.includes('не найден') ||
      (ml.includes('function') && ml.includes('mark_chat_thread_read'))
    if (!missingFn) throw rpcErr

    const { error: updErr } = await supabase
      .from('chat_thread_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('thread_id', threadId)
      .eq('user_id', user.id)
    if (updErr) throw updErr
  }

  await refreshChatTotalUnread()
}

export async function sendChatMessage(
  threadId: string,
  body: string,
  opts?: { urgent?: boolean; urgentKind?: 'problem_report' | null },
): Promise<void> {
  if (!supabase) throw new Error('Нет подключения')
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Требуется вход')
  const trimmed = body.trim()
  if (!trimmed) return
  if (trimmed.length > CHAT_MESSAGE_MAX_CHARS) {
    throw new Error(`Сообщение не длиннее ${CHAT_MESSAGE_MAX_CHARS} символов`)
  }
  const { error } = await supabase.from('chat_messages').insert({
    thread_id: threadId,
    sender_id: user.id,
    body: trimmed,
    is_urgent: Boolean(opts?.urgent),
    urgent_kind: opts?.urgent ? opts?.urgentKind ?? 'problem_report' : null,
  })
  if (error) throw error
}

function sanitizeChatFileName(name: string): string {
  const base = name
    .normalize('NFKC')
    // Для ключей Storage используем только ascii-символы — это избегает ошибок вида "Invalid key" в превью изображений.
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 180)
  return base || 'file'
}

/**
 * Загрузка файла в Storage и сообщение в чат (текст опционален — подпись к файлу).
 */
export async function sendChatMessageWithFile(
  threadId: string,
  file: File,
  body?: string,
  opts?: { urgent?: boolean; urgentKind?: 'problem_report' | null },
): Promise<void> {
  if (!supabase) throw new Error('Нет подключения')
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Требуется вход')
  if (!file || file.size <= 0) throw new Error('Выберите файл')
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    throw new Error(`Файл больше ${Math.round(CHAT_ATTACHMENT_MAX_BYTES / (1024 * 1024))} МБ`)
  }
  const caption = body?.trim() || null
  if (caption && caption.length > CHAT_MESSAGE_MAX_CHARS) {
    throw new Error(`Подпись к файлу не длиннее ${CHAT_MESSAGE_MAX_CHARS} символов`)
  }
  const safe = sanitizeChatFileName(file.name)
  const objectPath = `${threadId}/${user.id}/${crypto.randomUUID()}_${safe}`

  const { error: upErr } = await supabase.storage.from(CHAT_ATTACHMENTS_BUCKET).upload(objectPath, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (upErr) throw upErr

  const { error } = await supabase.from('chat_messages').insert({
    thread_id: threadId,
    sender_id: user.id,
    body: caption,
    attachment_bucket: CHAT_ATTACHMENTS_BUCKET,
    attachment_path: objectPath,
    attachment_name: file.name,
    attachment_size: file.size,
    is_urgent: Boolean(opts?.urgent),
    urgent_kind: opts?.urgent ? opts?.urgentKind ?? 'problem_report' : null,
  })
  if (error) {
    try {
      await supabase.storage.from(CHAT_ATTACHMENTS_BUCKET).remove([objectPath])
    } catch {
      /* ignore */
    }
    throw error
  }
}

/**
 * Удалить своё сообщение и файл из Storage (если было вложение).
 */
export async function deleteChatMessage(messageId: string): Promise<void> {
  if (!supabase) throw new Error('Нет подключения')
  assertCanDelete()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Требуется вход')

  const { data: row, error: selErr } = await supabase
    .from('chat_messages')
    .select('sender_id, attachment_path, attachment_bucket')
    .eq('id', messageId)
    .maybeSingle()

  if (selErr) throw selErr
  if (!row) throw new Error('Сообщение не найдено')
  if (row.sender_id !== user.id) throw new Error('Можно удалить только свои сообщения')

  const path = row.attachment_path as string | null
  const bucket = (row.attachment_bucket as string | null)?.trim() || CHAT_ATTACHMENTS_BUCKET

  const { error: delErr } = await supabase.from('chat_messages').delete().eq('id', messageId)
  if (delErr) throw delErr

  if (path) {
    const { error: stErr } = await supabase.storage.from(bucket).remove([path])
    if (stErr) console.warn('chat attachment storage remove', stErr.message)
  }
}

export async function getOrCreateDmThread(otherUserId: string): Promise<string> {
  if (!supabase) throw new Error('Нет подключения')
  const { data, error } = await supabase.rpc('get_or_create_dm_thread', { p_other_user: otherUserId })
  if (error) throw error
  if (!data) throw new Error('Не удалось открыть диалог')
  return String(data)
}

export async function createGroupThread(title: string, memberIds: string[]): Promise<string> {
  if (!supabase) throw new Error('Нет подключения')
  const { data, error } = await supabase.rpc('create_group_thread', {
    p_title: title,
    p_member_ids: memberIds,
  })
  if (error) throw error
  if (!data) throw new Error('Не удалось создать группу')
  return String(data)
}

/** last_read_at собеседника (для галочек «прочитано» в direct) */
export async function fetchPeerLastRead(threadId: string, peerUserId: string): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('chat_thread_members')
    .select('last_read_at')
    .eq('thread_id', threadId)
    .eq('user_id', peerUserId)
    .maybeSingle()
  if (error || !data) return null
  return data.last_read_at as string | null
}

export type GroupMemberDisplay = {
  userId: string
  displayName: string
  roleLabel: string
  initials: string
  tone: AvatarTone
  avatarUrl: string | null
  /** profiles.last_activity_at — текст «В сети» считается на клиенте по таймеру */
  lastActivityAt: string | null
  isSelf: boolean
}

/**
 * Участники группового чата + присутствие по profiles.last_activity_at.
 */
export async function fetchGroupThreadMembersDisplay(
  threadId: string,
  currentUserId?: string | null,
): Promise<GroupMemberDisplay[]> {
  if (!supabase) return []
  const { data: rows, error } = await supabase.from('chat_thread_members').select('user_id').eq('thread_id', threadId)
  if (error || !rows?.length) return []
  const ids = rows.map((r) => r.user_id as string)
  const baseMemberCols = 'id, display_name, email, position, role, last_activity_at'
  let profs: P[] | null = null
  const withAvatar = await supabase.from('profiles').select(`${baseMemberCols}, avatar_url`).in('id', ids)
  if (!withAvatar.error) {
    profs = withAvatar.data as P[] | null
  } else {
    const base = await supabase.from('profiles').select(baseMemberCols).in('id', ids)
    if (base.error) throw base.error
    profs = base.data as P[] | null
  }
  type P = {
    id: string
    display_name: string | null
    email: string
    position: string | null
    role: string | null
    last_activity_at: string | null
    avatar_url?: string | null
  }
  const profMap = new Map((profs as P[] | null)?.map((p) => [p.id, p]) ?? [])
  const me = currentUserId ?? ''
  const result: GroupMemberDisplay[] = ids.map((id) => {
    const p = profMap.get(id)
    const email = p?.email ?? ''
    const name = p?.display_name?.trim() || email.split('@')[0] || 'Участник'
    let roleLabel = p?.position?.trim()
    if (!roleLabel) {
      roleLabel = p?.role === 'manager' ? 'Руководитель' : p?.role === 'worker' ? 'Сотрудник' : 'Участник'
    }
    return {
      userId: id,
      displayName: name,
      roleLabel,
      initials: initialsFromProfile(p?.display_name, email),
      tone: avatarToneFromUserId(id),
      avatarUrl: p?.avatar_url ?? null,
      lastActivityAt: p?.last_activity_at ?? null,
      isSelf: Boolean(me && id === me),
    }
  })
  result.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1
    return a.displayName.localeCompare(b.displayName, 'ru')
  })
  return result
}

function rowFromRealtimeNew(raw: Record<string, unknown>): ChatMessageRow | null {
  const id = raw.id != null ? String(raw.id) : ''
  const thread_id = raw.thread_id != null ? String(raw.thread_id) : ''
  const sender_id = raw.sender_id != null ? String(raw.sender_id) : ''
  const created_at = raw.created_at != null ? String(raw.created_at) : ''
  if (!id || !thread_id || !sender_id || !created_at) return null
  return {
    id,
    thread_id,
    sender_id,
    body: raw.body != null ? String(raw.body) : null,
    attachment_bucket: raw.attachment_bucket != null ? String(raw.attachment_bucket) : null,
    attachment_path: raw.attachment_path != null ? String(raw.attachment_path) : null,
    attachment_name: raw.attachment_name != null ? String(raw.attachment_name) : null,
    attachment_size: raw.attachment_size != null ? Number(raw.attachment_size) : null,
    is_urgent: raw.is_urgent != null ? Boolean(raw.is_urgent) : false,
    urgent_kind: raw.urgent_kind === 'problem_report' ? 'problem_report' : null,
    created_at,
  }
}

export function subscribeToThreadMessages(
  threadId: string,
  onEvent: (payload: ThreadMessageRealtimePayload | null) => void,
): { unsubscribe: () => void } {
  if (!supabase) return { unsubscribe: () => {} }
  const client = supabase
  const filter = `thread_id=eq.${threadId}`
  const channel = client
    .channel(`chat-messages:${threadId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter }, (payload) => {
      const rec = rowFromRealtimeNew((payload.new ?? {}) as Record<string, unknown>)
      if (!rec || rec.thread_id !== threadId) {
        onEvent(null)
        return
      }
      onEvent({ kind: 'insert', record: rec })
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages', filter }, (payload) => {
      const old = (payload.old ?? {}) as Record<string, unknown>
      const messageId = old.id != null ? String(old.id) : null
      if (!messageId) {
        onEvent(null)
        return
      }
      onEvent({ kind: 'delete', messageId })
    })
    .subscribe()
  return {
    unsubscribe: () => {
      void client.removeChannel(channel)
    },
  }
}
