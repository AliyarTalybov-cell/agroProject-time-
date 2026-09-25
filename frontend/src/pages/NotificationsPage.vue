<script setup lang="ts">
import { Button } from '@/components/ui/shadcn/button'
import { BellIcon, CalendarIcon, CheckCheckIcon, CircleAlertIcon, ClipboardListIcon } from '@lucide/vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert'
import { Badge } from '@/components/ui/shadcn/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/shadcn/item'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { computed, onMounted, ref, watch } from 'vue'
import {
  countMyUnreadNotifications,
  loadMyNotifications,
  markMyNotificationsRead,
  type NotificationFilter,
  type NotificationRow,
} from '@/lib/notificationsSupabase'

type UiNotification = {
  id: string
  type: NotificationRow['type']
  isRead: boolean
  createdAt: string
  title: string
  body: string
  row: NotificationRow
  dayKey: string
  dayLabel: string
  timeLabel: string
}

const activeTab = ref<NotificationFilter>('all')
const pageSize = 20
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(true)
const page = ref(1)
const unreadCount = ref(0)
const rows = ref<NotificationRow[]>([])
const markBusyId = ref<string | null>(null)
const markAllBusy = ref(false)
const loadError = ref<string | null>(null)

const monthNamesGenitive = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function parseDate(value: string): Date {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return new Date()
  return d
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatEventDateLabel(raw: string | null): string {
  if (!raw) return 'без даты'
  const d = new Date(raw)
  if (!Number.isNaN(d.getTime())) return `${d.getDate()} ${monthNamesGenitive[d.getMonth()]} ${d.getFullYear()}`
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return raw
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  if (month < 0 || month > 11) return raw
  return `${day} ${monthNamesGenitive[month]} ${year}`
}

function formatTimestampLabel(iso: string): string {
  const d = parseDate(iso)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startYesterday = new Date(startToday)
  startYesterday.setDate(startYesterday.getDate() - 1)
  if (d >= startToday) return `Сегодня, ${formatTime(d)}`
  if (d >= startYesterday) return `Вчера, ${formatTime(d)}`
  return `${d.getDate()} ${monthNamesGenitive[d.getMonth()]}, ${formatTime(d)}`
}

function dayGroupKey(iso: string): string {
  const d = parseDate(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayGroupLabel(iso: string): string {
  const d = parseDate(iso)
  const week = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startYesterday = new Date(startToday)
  startYesterday.setDate(startYesterday.getDate() - 1)
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (dayStart.getTime() === startToday.getTime()) return 'сегодня'
  if (dayStart.getTime() === startYesterday.getTime()) return 'вчера'
  return `${week[d.getDay()]}, ${d.getDate()} ${monthNamesGenitive[d.getMonth()]}`
}

function titleForType(type: NotificationRow['type']): string {
  if (type === 'task_assigned') return 'На вас поставлена новая задача'
  if (type === 'task_participant_added') return 'Вас добавили участником задачи'
  if (type === 'task_comment_added') return 'Новый комментарий в задаче'
  if (type === 'calendar_invited') return 'Вас добавили участником события'
  return 'Изменение в задаче'
}

function actorLabel(row: NotificationRow): string {
  return row.actor_name || 'Система'
}

function isTaskDirectLinkType(type: NotificationRow['type']): boolean {
  return type === 'task_assigned' || type === 'task_participant_added' || type === 'task_comment_added'
}

function bodyForRow(row: NotificationRow): string {
  const actor = row.actor_name || 'Система'
  if (row.type === 'calendar_invited') {
    const eventLabel = row.calendar_title ? `"${row.calendar_title}"` : 'без названия'
    return `Событие ${eventLabel} на ${formatEventDateLabel(row.calendar_date)}. Инициатор: ${actor}.`
  }
  const numberPart = row.task_number ? `№${row.task_number}` : 'без номера'
  const titlePart = row.task_title ? `"${row.task_title}"` : 'без названия'
  if (row.type === 'task_status_changed') {
    return `В задаче ${numberPart} ${titlePart} изменен статус. Автор: ${actor}.`
  }
  if (row.type === 'task_comment_added') {
    return `В задаче ${numberPart} ${titlePart} добавлен комментарий. Автор: ${actor}.`
  }
  if (row.type === 'task_participant_added') {
    return `Вы участник задачи ${numberPart} ${titlePart}. Инициатор: ${actor}.`
  }
  return `Задача ${numberPart} ${titlePart}. Автор: ${actor}.`
}

const items = computed<UiNotification[]>(() =>
  rows.value.map((row) => ({
    id: row.id,
    type: row.type,
    isRead: row.is_read,
    createdAt: row.created_at,
    title: titleForType(row.type),
    body: bodyForRow(row),
    row,
    dayKey: dayGroupKey(row.created_at),
    dayLabel: dayGroupLabel(row.created_at),
    timeLabel: formatTimestampLabel(row.created_at),
  })),
)

const groupedItems = computed(() => {
  const groups: Array<{ key: string; label: string; items: UiNotification[] }> = []
  for (const item of items.value) {
    const last = groups[groups.length - 1]
    if (!last || last.key !== item.dayKey) {
      groups.push({ key: item.dayKey, label: item.dayLabel, items: [item] })
    } else {
      last.items.push(item)
    }
  }
  return groups
})

async function refreshUnreadCount() {
  try {
    unreadCount.value = await countMyUnreadNotifications()
  } catch (e) {
    // Счётчик вторичен: сам список уведомлений грузится отдельно и о своих
    // сбоях сообщает сам.
    console.error('Счётчик непрочитанных уведомлений', e)
    unreadCount.value = 0
  }
}

async function loadPage(append: boolean) {
  if (append) loadingMore.value = true
  else loading.value = true
  loadError.value = null
  try {
    const data = await loadMyNotifications({
      filter: activeTab.value,
      limit: pageSize,
      offset: (page.value - 1) * pageSize,
    })
    if (append) rows.value = [...rows.value, ...data]
    else rows.value = data
    hasMore.value = data.length === pageSize
  } catch (e) {
    // Раньше сбой выглядел как пустой список («Пока уведомлений нет») — теперь показываем ошибку.
    loadError.value = formatSupabaseError(e)
    if (!append) rows.value = []
  } finally {
    if (append) loadingMore.value = false
    else loading.value = false
  }
}

async function reloadCurrentTab() {
  page.value = 1
  hasMore.value = true
  await loadPage(false)
  await refreshUnreadCount()
}

async function loadMore() {
  if (!hasMore.value || loading.value || loadingMore.value) return
  page.value += 1
  await loadPage(true)
}

async function markOneAsRead(id: string) {
  if (markBusyId.value) return
  markBusyId.value = id
  try {
    await markMyNotificationsRead([id])
    const row = rows.value.find((x) => x.id === id)
    if (row) row.is_read = true
    if (activeTab.value === 'unread') {
      rows.value = rows.value.filter((x) => x.id !== id)
    }
    await refreshUnreadCount()
  } finally {
    markBusyId.value = null
  }
}

async function markAllAsRead() {
  if (markAllBusy.value || unreadCount.value <= 0) return
  markAllBusy.value = true
  try {
    await markMyNotificationsRead()
    if (activeTab.value === 'unread') {
      rows.value = []
      unreadCount.value = 0
      hasMore.value = false
      return
    }
    rows.value = rows.value.map((r) => ({ ...r, is_read: true }))
    unreadCount.value = 0
  } finally {
    markAllBusy.value = false
  }
}

watch(activeTab, () => {
  void reloadCurrentTab()
})

onMounted(() => {
  void reloadCurrentTab()
})
</script>

<template>
  <div class="mx-auto grid w-full max-w-3xl gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Tabs :model-value="activeTab" @update:model-value="(v) => (activeTab = v as NotificationFilter)">
        <TabsList aria-label="Фильтр уведомлений">
          <TabsTrigger value="all">Все</TabsTrigger>
          <TabsTrigger value="unread">
            Не прочитано
            <Badge v-if="unreadCount > 0" class="ml-1 h-5 min-w-5 rounded-full px-1.5 tabular-nums">{{ unreadCount }}</Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Button v-if="unreadCount > 0" variant="outline" size="sm" :disabled="markAllBusy" @click="markAllAsRead">
        <CheckCheckIcon />
        {{ markAllBusy ? 'Обновление…' : 'Прочитать все' }}
      </Button>
    </div>

    <Alert v-if="loadError" variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Не удалось загрузить уведомления</AlertTitle>
      <AlertDescription>
        <p>{{ loadError }}</p>
        <Button variant="outline" size="sm" class="mt-2" @click="reloadCurrentTab">Повторить</Button>
      </AlertDescription>
    </Alert>

    <div v-else-if="loading" class="grid gap-3">
      <div v-for="i in 4" :key="i" class="flex items-start gap-4 rounded-lg border p-4">
        <Skeleton class="size-8 rounded-md" />
        <div class="grid flex-1 gap-2">
          <Skeleton class="h-4 w-1/2" />
          <Skeleton class="h-4 w-4/5" />
        </div>
      </div>
    </div>

    <template v-else-if="groupedItems.length">
      <section v-for="group in groupedItems" :key="group.key" class="grid gap-2">
        <h2 class="text-muted-foreground px-1 text-xs font-medium">{{ group.label }}</h2>
        <ItemGroup class="gap-2">
          <Item
            v-for="item in group.items"
            :key="item.id"
            variant="outline"
            :class="item.isRead ? 'opacity-70' : 'bg-card'"
          >
            <ItemMedia variant="icon">
              <CalendarIcon v-if="item.type === 'calendar_invited'" />
              <ClipboardListIcon v-else />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                {{ item.title }}
                <span v-if="!item.isRead" class="bg-primary size-2 rounded-full" aria-label="Не прочитано" />
              </ItemTitle>
            <ItemDescription class="line-clamp-none">
                <template v-if="isTaskDirectLinkType(item.type)">
                  Задача
                  <RouterLink
                    v-if="item.row.task_id && item.row.task_number"
                    class="notification-task-link"
                    :to="{ path: '/task-management', query: { openTaskId: item.row.task_id } }"
                  >
                    №{{ item.row.task_number }}
                  </RouterLink>
                  <span v-else> без номера</span>
                  <template v-if="item.row.task_title">
                    "{{ item.row.task_title }}"
                  </template>.
                  Автор: {{ actorLabel(item.row) }}.
                </template>
                <template v-else>
                  {{ item.body }}
                </template>
              </ItemDescription>
              <span class="text-muted-foreground text-xs">{{ item.timeLabel }}</span>
            </ItemContent>
            <ItemActions v-if="!item.isRead">
              <Button variant="ghost" size="sm" :disabled="markBusyId === item.id" @click="markOneAsRead(item.id)">Прочитано</Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </section>
      <div v-if="hasMore" class="flex justify-center">
        <Button variant="outline" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? 'Загрузка…' : 'Загрузить ещё' }}
        </Button>
      </div>
    </template>

    <Empty v-else class="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><BellIcon /></EmptyMedia>
        <EmptyTitle>{{ activeTab === 'unread' ? 'Непрочитанных нет' : 'Уведомлений пока нет' }}</EmptyTitle>
        <EmptyDescription>Здесь появятся приглашения в события календаря и новости по задачам.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </div>
</template>

<style scoped>
@layer legacy {
.notifications-page {
  display: grid;
  gap: 10px;
}

.notifications-tabs {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.notifications-tab {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.96rem;
  font-weight: 600;
  padding: 8px 6px;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: color 0.18s ease, border-color 0.18s ease;
}

.notifications-tab:hover {
  color: var(--text-primary);
}

.notifications-tab--active {
  color: var(--text-primary);
  border-bottom-color: var(--agro);
}

.notifications-tab-badge {
  min-width: 24px;
  height: 24px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--agro) 20%, transparent);
  color: color-mix(in srgb, var(--agro) 88%, #1f3f2a);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.94rem;
  font-weight: 700;
  line-height: 1;
  padding: 0 8px;
}

.notifications-read-all-btn {
  border: 1px solid color-mix(in srgb, var(--border-color) 86%, transparent);
  border-radius: 999px;
  background: var(--bg-panel);
  color: color-mix(in srgb, var(--agro) 84%, #2f4733);
  font-size: 0.86rem;
  font-weight: 600;
  padding: 6px 10px;
  margin-left: auto;
  cursor: pointer;
}

.notifications-read-all-btn:hover {
  border-color: color-mix(in srgb, var(--agro) 32%, var(--border-color));
  color: var(--agro);
}

.notifications-card {
  background: var(--bg-panel);
  border: 1px solid color-mix(in srgb, var(--border-color) 86%, transparent);
  border-radius: var(--radius-xl);
  padding: 12px;
  display: grid;
  gap: 8px;
}

.notifications-day-group {
  display: grid;
  gap: 8px;
}

.notifications-day-head-wrap {
  position: relative;
  display: flex;
  justify-content: center;
  margin: 4px 0 0;
}

.notifications-day-head-wrap::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
}

.notifications-day-head {
  position: relative;
  z-index: 1;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-panel) 92%, #fff);
  color: var(--text-secondary);
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: lowercase;
  padding: 6px 14px;
}

.notification-item {
  border: 1px solid color-mix(in srgb, var(--border-color) 86%, transparent);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  padding: 11px 14px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.notification-item--read {
  opacity: 0.62;
}

.notification-item-icon {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.notification-item-icon svg {
  width: 15px;
  height: 15px;
}

.notification-item-icon--task_assigned,
.notification-item-icon--task_participant_added,
.notification-item-icon--task_status_changed {
  color: #5b8fd8;
  background: color-mix(in srgb, #5b8fd8 14%, transparent);
}

.notification-item-icon--calendar_invited {
  color: #d98745;
  background: color-mix(in srgb, #d98745 14%, transparent);
}

.notification-item-main {
  min-width: 0;
}

.notification-item-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.notification-item-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.16rem;
  line-height: 1.2;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.notification-item-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-primary) 88%, transparent);
}

.notification-item-read-btn {
  border: none;
  background: transparent;
  color: color-mix(in srgb, var(--agro) 82%, #2f4733);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  white-space: nowrap;
}

.notification-item-read-btn:hover {
  color: var(--agro);
}

.notification-item-body {
  margin: 4px 0 0;
  color: var(--text-primary);
  font-size: 0.95rem;
  line-height: 1.35;
}

.notification-item-time {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 0.86rem;
}

.notification-task-link {
  color: color-mix(in srgb, var(--agro) 86%, #2f4733);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.notification-task-link:hover {
  color: var(--agro);
}

.notifications-load-more-wrap {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

.notifications-load-more {
  border: 1px solid color-mix(in srgb, var(--border-color) 86%, transparent);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 0.92rem;
  font-weight: 600;
  padding: 10px 20px;
  cursor: pointer;
}

.notifications-empty {
  border: 1px dashed color-mix(in srgb, var(--border-color) 86%, transparent);
  border-radius: var(--radius-xl);
  color: var(--text-secondary);
  padding: 14px;
}

.notifications-empty p {
  margin: 0;
}

@media (max-width: 900px) {
  .notification-item-title {
    font-size: 1.03rem;
  }

  .notification-item-body {
    font-size: 0.88rem;
  }
}

@media (max-width: 640px) {
  .notifications-tabs {
    flex-wrap: wrap;
  }

  .notifications-read-all-btn {
    margin-left: 0;
    font-size: 0.8rem;
    padding: 5px 9px;
  }

  .notifications-card {
    padding: 9px;
  }

  .notification-item {
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 8px;
    padding: 9px 10px;
  }

  .notification-item-title-row {
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
  }

  .notification-item-read-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.76rem;
    padding: 4px 0;
    white-space: normal;
  }

  .notification-item-title {
    font-size: 0.98rem;
  }

  .notification-item-time {
    font-size: 0.78rem;
  }
}
}
</style>
