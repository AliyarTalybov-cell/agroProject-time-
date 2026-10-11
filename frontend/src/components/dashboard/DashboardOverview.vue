<script setup lang="ts">
/**
 * Вкладка «Обзор»: что важно сегодня. Каждый блок грузится сам по себе —
 * ошибка одного не прячет остальные. Графики здесь не дублируем, они в «Аналитике».
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { BellIcon, ChevronRightIcon, ClipboardCheckIcon, MessageSquareIcon, TractorIcon } from '@lucide/vue'
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/shadcn/card'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Button } from '@/components/ui/shadcn/button'
import UiBadge, { type UiBadgeTone } from '@/components/ui/UiBadge.vue'
import { useAuth } from '@/stores/auth'
import { loadTasksFiltered, taskDueDateToYmd, type TaskRow, type TaskPriority } from '@/lib/tasksSupabase'
import { loadCalendarTasks, type CalendarTaskRow } from '@/lib/calendarTasksSupabase'
import { countMyUnreadNotifications } from '@/lib/notificationsSupabase'
import { chatTotalUnread, fetchChatThreadList, refreshChatTotalUnread } from '@/lib/chatSupabase'
import { loadOperatorStatusesFromSupabase, type OperatorStatusRow } from '@/lib/operatorStatusSupabase'
import { loadWarehousesOverview, type WarehouseOverview } from '@/lib/stockLedger'
import { loadNewsPostsPage, type NewsPostRow } from '@/lib/newsSupabase'
import { ruDate } from '@/lib/ruDate'

type Block<T> = { loading: boolean; error: boolean; data: T }

function block<T>(data: T) {
  return ref<Block<T>>({ loading: true, error: false, data })
}

async function fill<T>(target: { value: Block<T> }, load: () => Promise<T>) {
  try {
    target.value.data = await load()
  } catch (e) {
    console.warn('dashboard', e)
    target.value.error = true
  } finally {
    target.value.loading = false
  }
}

const { user, userRole, profileCache } = useAuth()
const isManager = computed(() => userRole.value === 'manager')

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const today = ymd(new Date())

const greeting = computed(() => {
  const h = new Date().getHours()
  const hello = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
  const name = (profileCache.value?.display_name ?? '').trim().split(/\s+/)[0]
  return name ? `${hello}, ${name}` : hello
})
const todayLabel = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

/* ——— Мои задачи ——— */
type MyTask = TaskRow & { dueYmd: string | null }
const tasks = block<MyTask[]>([])
const TASKS_SHOWN = 6

const myTasksSorted = computed(() =>
  [...tasks.value.data].sort((a, b) => {
    if (a.dueYmd && b.dueYmd) return a.dueYmd.localeCompare(b.dueYmd)
    if (a.dueYmd) return -1
    if (b.dueYmd) return 1
    return b.created_at.localeCompare(a.created_at)
  }),
)
const overdueCount = computed(() => tasks.value.data.filter((t) => t.dueYmd && t.dueYmd < today).length)
const dueTodayCount = computed(() => tasks.value.data.filter((t) => t.dueYmd === today).length)

function dueLabel(t: MyTask): { text: string; tone: UiBadgeTone } | null {
  if (!t.dueYmd) return null
  if (t.dueYmd < today) return { text: `Просрочено · ${ruDate(t.dueYmd)}`, tone: 'danger' }
  if (t.dueYmd === today) return { text: 'Сегодня', tone: 'warning' }
  return { text: `до ${ruDate(t.dueYmd)}`, tone: 'neutral' }
}
const statusTitle: Record<string, string> = { todo: 'К выполнению', in_progress: 'В работе', review: 'На проверке', done: 'Выполнено' }
const priorityTone: Record<TaskPriority, UiBadgeTone> = { high: 'danger', medium: 'neutral', low: 'neutral' }

/* ——— Календарь на сегодня ——— */
const events = block<CalendarTaskRow[]>([])
function timeRange(e: CalendarTaskRow): string {
  const s = e.start_time?.slice(0, 5)
  const f = e.end_time?.slice(0, 5)
  if (s && f) return `${s}–${f}`
  return s || 'Весь день'
}

/* ——— Требует внимания ——— */
const notifications = block(0)
const chatUrgent = block(0)
const review = block(0)

/* ——— Руководителю ——— */
const inField = block<OperatorStatusRow[]>([])
const grain = block<WarehouseOverview[]>([])
const grainTotals = computed(() => {
  const list = grain.value.data.filter((w) => !w.inactive)
  const tons = list.reduce((s, w) => s + w.tons, 0)
  const capacity = list.reduce((s, w) => s + (w.capacityTons ?? 0), 0)
  const crops = new Map<string, { label: string; tons: number }>()
  for (const w of list) {
    for (const c of w.crops) {
      const prev = crops.get(c.key)
      crops.set(c.key, { label: c.label, tons: (prev?.tons ?? 0) + c.tons })
    }
  }
  return {
    tons,
    capacity,
    percent: capacity > 0 ? Math.min(100, Math.round((tons / capacity) * 100)) : null,
    crops: [...crops.values()].filter((c) => c.tons > 0).sort((a, b) => b.tons - a.tons).slice(0, 4),
    warehouses: list.length,
  }
})
const tonsFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

function sinceLabel(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 60) return `${min} мин`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h} ч ${min % 60} мин` : `с ${ruDate(iso)}`
}

/* ——— Новости ——— */
const news = block<NewsPostRow[]>([])

onMounted(() => {
  const uid = user.value?.id
  if (!uid) return
  void fill(tasks, async () =>
    (await loadTasksFiltered(true, uid, { limit: 500 }))
      .filter((t) => t.status !== 'done')
      .map((t) => ({ ...t, dueYmd: taskDueDateToYmd(t.due_date) })),
  )
  void fill(events, async () =>
    (await loadCalendarTasks(uid))
      .filter((e) => e.date?.slice(0, 10) === today && !e.completed_at)
      .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '')),
  )
  void fill(notifications, countMyUnreadNotifications)
  void fill(chatUrgent, async () => {
    void refreshChatTotalUnread()
    return (await fetchChatThreadList()).reduce((s, t) => s + (t.unread_urgent_count ?? 0), 0)
  })
  void fill(news, async () => (await loadNewsPostsPage(1, 3)).items)
  if (isManager.value) {
    void fill(review, async () => (await loadTasksFiltered(false, uid, { status: 'review', limit: 500 })).length)
    void fill(inField, () => loadOperatorStatusesFromSupabase(false, null))
    void fill(grain, () => loadWarehousesOverview())
  } else {
    review.value.loading = false
    inField.value.loading = false
    grain.value.loading = false
  }
})

const attention = computed(() => {
  const items = [
    {
      key: 'chat',
      to: '/chat',
      icon: MessageSquareIcon,
      title: 'Сообщения',
      value: chatTotalUnread.value,
      hint: chatUrgent.value.data > 0 ? `из них важных: ${chatUrgent.value.data}` : 'непрочитанные',
      urgent: chatUrgent.value.data > 0,
      loading: chatUrgent.value.loading,
    },
    {
      key: 'notifications',
      to: '/notifications',
      icon: BellIcon,
      title: 'Уведомления',
      value: notifications.value.data,
      hint: 'непрочитанные',
      urgent: false,
      loading: notifications.value.loading,
    },
  ]
  if (isManager.value) {
    items.push({
      key: 'review',
      to: '/task-management?status=review',
      icon: ClipboardCheckIcon,
      title: 'На проверке',
      value: review.value.data,
      hint: 'задачи ждут решения',
      urgent: false,
      loading: review.value.loading,
    })
  }
  return items
})
</script>

<template>
  <section class="tw-scope flex flex-col gap-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex flex-col gap-1">
        <p class="text-xl font-semibold">{{ greeting }}</p>
        <p class="text-sm text-muted-foreground first-letter:uppercase">{{ todayLabel }}</p>
      </div>
      <Button v-if="!isManager" as-child>
        <RouterLink to="/mechanic"><TractorIcon /> Экран оператора</RouterLink>
      </Button>
    </div>

    <!-- Требует внимания -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2" :class="isManager ? 'lg:grid-cols-3' : ''">
      <RouterLink
        v-for="a in attention"
        :key="a.key"
        :to="a.to"
        class="group flex items-center gap-4 rounded-xl border bg-card p-4 text-foreground no-underline transition-colors hover:bg-muted/50"
      >
        <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <component :is="a.icon" class="size-5" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="text-sm text-muted-foreground">{{ a.title }}</span>
          <Skeleton v-if="a.loading" class="mt-1 h-6 w-10" />
          <span v-else class="text-2xl font-semibold tabular-nums leading-tight">{{ a.value }}</span>
          <span class="text-xs" :class="a.urgent ? 'text-destructive' : 'text-muted-foreground'">{{ a.hint }}</span>
        </span>
        <ChevronRightIcon class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </RouterLink>
    </div>

    <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <!-- Мои задачи -->
      <Card class="gap-4">
        <CardHeader>
          <CardTitle>Мои задачи</CardTitle>
          <p v-if="!tasks.loading && !tasks.error" class="text-sm text-muted-foreground">
            <template v-if="tasks.data.length === 0">Открытых задач нет</template>
            <template v-else>
              Открытых: {{ tasks.data.length }}<template v-if="overdueCount"> · <span class="text-destructive">просрочено: {{ overdueCount }}</span></template><template v-if="dueTodayCount"> · на сегодня: {{ dueTodayCount }}</template>
            </template>
          </p>
          <CardAction>
            <Button variant="ghost" size="sm" as-child><RouterLink to="/task-management">Все задачи</RouterLink></Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div v-if="tasks.loading" class="flex flex-col gap-2">
            <Skeleton v-for="i in 3" :key="i" class="h-12 w-full" />
          </div>
          <p v-else-if="tasks.error" class="text-sm text-destructive">Не удалось загрузить задачи</p>
          <p v-else-if="tasks.data.length === 0" class="text-sm text-muted-foreground">Можно выдохнуть — всё сделано.</p>
          <ul v-else class="-mx-2 flex flex-col">
            <li v-for="t in myTasksSorted.slice(0, TASKS_SHOWN)" :key="t.id">
              <RouterLink
                :to="`/task-management/${t.id}`"
                class="flex flex-col gap-1 rounded-md px-2 py-2 text-foreground no-underline transition-colors hover:bg-muted/60"
              >
                <span class="flex items-start gap-2">
                  <span class="shrink-0 text-sm text-muted-foreground tabular-nums">#{{ t.number }}</span>
                  <span class="min-w-0 flex-1 text-sm font-medium line-clamp-2">{{ t.title }}</span>
                </span>
                <span class="flex flex-wrap items-center gap-2">
                  <UiBadge v-if="dueLabel(t)" :tone="dueLabel(t)!.tone">{{ dueLabel(t)!.text }}</UiBadge>
                  <UiBadge :tone="t.status === 'review' ? 'warning' : t.status === 'in_progress' ? 'info' : 'neutral'">{{ statusTitle[t.status] }}</UiBadge>
                  <UiBadge v-if="t.priority === 'high'" :tone="priorityTone[t.priority]">Высокий приоритет</UiBadge>
                </span>
              </RouterLink>
            </li>
          </ul>
          <p v-if="tasks.data.length > TASKS_SHOWN" class="mt-2 text-xs text-muted-foreground">
            И ещё {{ tasks.data.length - TASKS_SHOWN }} — в разделе «Задачи»
          </p>
        </CardContent>
      </Card>

      <!-- Календарь на сегодня -->
      <Card class="gap-4">
        <CardHeader>
          <CardTitle>Сегодня в календаре</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" as-child><RouterLink to="/tasks">Календарь</RouterLink></Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div v-if="events.loading" class="flex flex-col gap-2">
            <Skeleton v-for="i in 2" :key="i" class="h-10 w-full" />
          </div>
          <p v-else-if="events.error" class="text-sm text-destructive">Не удалось загрузить календарь</p>
          <p v-else-if="events.data.length === 0" class="text-sm text-muted-foreground">На сегодня ничего не запланировано</p>
          <ul v-else class="flex flex-col gap-3">
            <li v-for="e in events.data" :key="e.id" class="flex gap-4">
              <span class="w-24 shrink-0 text-sm text-muted-foreground tabular-nums">{{ timeRange(e) }}</span>
              <span class="min-w-0 flex-1 text-sm">{{ e.title }}</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <!-- Сейчас в поле -->
      <Card v-if="isManager" class="gap-4">
        <CardHeader>
          <CardTitle>Сейчас в поле</CardTitle>
          <p v-if="!inField.loading && !inField.error" class="text-sm text-muted-foreground">
            {{ inField.data.length ? `На смене: ${inField.data.length}` : 'Никто не отметил начало работы' }}
          </p>
        </CardHeader>
        <CardContent v-if="inField.loading || inField.error || inField.data.length">
          <div v-if="inField.loading" class="flex flex-col gap-2">
            <Skeleton v-for="i in 2" :key="i" class="h-10 w-full" />
          </div>
          <p v-else-if="inField.error" class="text-sm text-destructive">Не удалось загрузить</p>
          <ul v-else class="flex flex-col gap-3">
            <li v-for="s in inField.data" :key="s.user_id" class="flex items-start gap-4">
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-sm font-medium">{{ s.employee }}</span>
                <span class="text-xs text-muted-foreground">
                  <template v-if="s.kind === 'operation'">{{ s.operation || 'Работа' }}<template v-if="s.field_name"> · {{ s.field_name }}</template></template>
                  <template v-else>Простой<template v-if="s.downtime_reason"> · {{ s.downtime_reason }}</template></template>
                </span>
              </span>
              <span class="flex shrink-0 flex-col items-end gap-1">
                <UiBadge :tone="s.kind === 'operation' ? 'success' : 'warning'">{{ s.kind === 'operation' ? 'Работает' : 'Простой' }}</UiBadge>
                <span class="text-xs text-muted-foreground tabular-nums">{{ sinceLabel(s.started_at) }}</span>
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <!-- Зерно -->
      <Card v-if="isManager" class="gap-4">
        <CardHeader>
          <CardTitle>Зерно на складах</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" as-child><RouterLink to="/warehouses">Склады</RouterLink></Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Skeleton v-if="grain.loading" class="h-20 w-full" />
          <p v-else-if="grain.error" class="text-sm text-destructive">Не удалось загрузить остатки</p>
          <div v-else class="flex flex-col gap-4">
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-semibold tabular-nums">{{ tonsFmt.format(grainTotals.tons) }} т</span>
              <span class="text-sm text-muted-foreground">
                <template v-if="grainTotals.capacity">из {{ tonsFmt.format(grainTotals.capacity) }} т · </template>складов: {{ grainTotals.warehouses }}
              </span>
            </div>
            <div v-if="grainTotals.percent !== null" class="flex flex-col gap-1">
              <div class="h-2 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary" :style="{ width: `${grainTotals.percent}%` }" />
              </div>
              <span class="text-xs text-muted-foreground">Заполнено на {{ grainTotals.percent }}%</span>
            </div>
            <ul v-if="grainTotals.crops.length" class="flex flex-col gap-2">
              <li v-for="c in grainTotals.crops" :key="c.label" class="flex justify-between gap-4 text-sm">
                <span>{{ c.label }}</span>
                <span class="tabular-nums text-muted-foreground">{{ tonsFmt.format(c.tons) }} т</span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <!-- Новости -->
      <Card class="gap-4" :class="isManager ? 'lg:col-span-2' : ''">
        <CardHeader>
          <CardTitle>Новости</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" as-child><RouterLink to="/news">Все новости</RouterLink></Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div v-if="news.loading" class="flex flex-col gap-2">
            <Skeleton v-for="i in 3" :key="i" class="h-10 w-full" />
          </div>
          <p v-else-if="news.error" class="text-sm text-destructive">Не удалось загрузить новости</p>
          <p v-else-if="news.data.length === 0" class="text-sm text-muted-foreground">Новостей пока нет</p>
          <ul v-else class="-mx-2 flex flex-col">
            <li v-for="n in news.data" :key="n.id">
              <RouterLink :to="`/news/${n.id}`" class="flex items-baseline gap-4 rounded-md px-2 py-2 text-foreground no-underline transition-colors hover:bg-muted/60">
                <span class="min-w-0 flex-1 text-sm font-medium line-clamp-1">{{ n.title }}</span>
                <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{ ruDate(n.published_at) }}</span>
              </RouterLink>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  </section>
</template>
