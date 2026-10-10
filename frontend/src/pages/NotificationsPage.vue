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

.notification-task-link {
  color: color-mix(in srgb, var(--agro) 86%, #2f4733);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.notification-task-link:hover {
  color: var(--agro);
}
}
</style>
