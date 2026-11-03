<script setup lang="ts">
/**
 * Блок «Задачи» в «Аналитике»: сводка, открытые задачи по статусам,
 * исполнители и задачи, которые требуют внимания. Цифры — computeTaskStats.
 */
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRightIcon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/shadcn/table'
import UserAvatar from '@/components/UserAvatar.vue'
import { avatarColorByPosition } from '@/lib/avatarColors'
import type { TaskStats } from '@/lib/taskStats'
import type { ProfileRow } from '@/lib/tasksSupabase'

const props = defineProps<{
  stats: TaskStats
  profiles: ProfileRow[]
  loading: boolean
  periodLabel: string
}>()

const profileById = computed(() => new Map(props.profiles.map((p) => [p.id, p])))
const nameOf = (id: string | null) => {
  if (!id) return 'Без исполнителя'
  const p = profileById.value.get(id)
  return p?.display_name?.trim() || p?.email || 'Сотрудник'
}
const initials = (name: string) => {
  const parts = name.split('@')[0].trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase() || '?'
}
const avatarStyle = (id: string) => ({ background: avatarColorByPosition(profileById.value.get(id)?.position || nameOf(id)) })

const STATUS = {
  todo: { label: 'К выполнению', color: 'var(--chart-4)' },
  in_progress: { label: 'В процессе', color: 'var(--chart-2)' },
  review: { label: 'На проверке', color: 'var(--chart-3)' },
} as const

const segments = computed(() =>
  props.stats.byStatus
    .filter((s) => s.count > 0)
    .map((s) => ({ ...s, ...STATUS[s.status], pct: (s.count / Math.max(1, props.stats.open)) * 100 })),
)

const tiles = computed(() => [
  { label: 'В работе', value: String(props.stats.open), hint: 'не выполнены сейчас', tone: '' },
  { label: 'Просрочено', value: String(props.stats.overdue), hint: 'срок прошёл', tone: props.stats.overdue ? 'text-destructive' : '' },
  { label: 'Выполнено', value: String(props.stats.done), hint: props.periodLabel, tone: '' },
  {
    label: 'Вовремя',
    value: props.stats.onTimePct == null ? '—' : `${props.stats.onTimePct}%`,
    hint: 'закрыты в срок',
    tone: props.stats.onTimePct != null && props.stats.onTimePct < 70 ? 'text-amber-700 dark:text-amber-300' : '',
  },
])

const COLLAPSED = 6
const showAll = ref(false)
const assigneeRows = computed(() => (showAll.value ? props.stats.byAssignee : props.stats.byAssignee.slice(0, COLLAPSED)))

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')

function overdueLabel(days: number) {
  const mod10 = days % 10
  const mod100 = days % 100
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней'
  return `на ${days} ${word}`
}
</script>

<template>
  <section class="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-base font-semibold">Задачи</h2>
      <RouterLink to="/task-management" class="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline dark:text-green-400">
        Все задачи
        <ArrowRightIcon class="size-4" />
      </RouterLink>
    </div>

    <div v-if="loading" class="grid gap-2">
      <Skeleton class="h-16 w-full rounded-lg" />
      <Skeleton class="h-32 w-full rounded-lg" />
    </div>

    <template v-else>
      <dl class="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div v-for="t in tiles" :key="t.label" class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
          <dt class="text-muted-foreground text-xs">{{ t.label }}</dt>
          <dd class="text-xl font-semibold tabular-nums" :class="t.tone">{{ t.value }}</dd>
          <dd class="text-muted-foreground truncate text-xs">{{ t.hint }}</dd>
        </div>
      </dl>

      <div v-if="stats.open" class="grid gap-2">
        <div class="bg-muted flex h-2 overflow-hidden rounded-full" role="img" :aria-label="segments.map((s) => `${s.label}: ${s.count}`).join(', ')">
          <span v-for="s in segments" :key="s.status" class="h-full" :style="{ width: `${s.pct}%`, background: s.color }" />
        </div>
        <ul class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <li v-for="s in segments" :key="s.status" class="flex items-center gap-1.5">
            <span class="size-2 rounded-full" :style="{ background: s.color }" />
            {{ s.label }} <span class="text-foreground font-medium tabular-nums">{{ s.count }}</span>
          </li>
        </ul>
      </div>

      <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div class="grid min-w-0 gap-2">
          <h3 class="text-sm font-medium">По исполнителям</h3>
          <p v-if="!stats.byAssignee.length" class="text-muted-foreground text-sm">Нет задач с исполнителем.</p>
          <ul v-if="stats.byAssignee.length" class="divide-border grid divide-y rounded-lg border md:hidden">
            <li v-for="r in assigneeRows" :key="r.assigneeId" class="grid gap-1 px-3 py-2">
              <span class="flex min-w-0 items-center gap-2 text-sm">
                <UserAvatar class="size-6 shrink-0 text-[10px] font-medium text-white" :style="avatarStyle(r.assigneeId)" :url="profileById.get(r.assigneeId)?.avatar_url ?? null" :initials="initials(nameOf(r.assigneeId))" />
                <span class="truncate">{{ nameOf(r.assigneeId) }}</span>
              </span>
              <span class="text-muted-foreground flex flex-wrap gap-x-3 pl-8 text-xs tabular-nums">
                <span>В работе <span class="text-foreground font-medium">{{ r.open }}</span></span>
                <span v-if="r.overdue" class="text-destructive">Просрочено <span class="font-medium">{{ r.overdue }}</span></span>
                <span>Выполнено <span class="text-foreground font-medium">{{ r.done }}</span></span>
                <span v-if="r.done">Вовремя {{ pct(r.onTime, r.done) }}</span>
              </span>
            </li>
          </ul>
          <div v-if="stats.byAssignee.length" class="hidden overflow-hidden rounded-lg border md:block">
            <Table class="table-fixed">
              <TableHeader class="bg-muted/50">
                <TableRow>
                  <TableHead class="pl-3">Сотрудник</TableHead>
                  <TableHead class="w-20 text-right">В работе</TableHead>
                  <TableHead class="w-24 text-right">Просрочено</TableHead>
                  <TableHead class="w-24 text-right">Выполнено</TableHead>
                  <TableHead class="w-20 pr-3 text-right">Вовремя</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="r in assigneeRows" :key="r.assigneeId">
                  <TableCell class="pl-3">
                    <span class="flex min-w-0 items-center gap-2">
                      <UserAvatar class="size-6 shrink-0 text-[10px] font-medium text-white" :style="avatarStyle(r.assigneeId)" :url="profileById.get(r.assigneeId)?.avatar_url ?? null" :initials="initials(nameOf(r.assigneeId))" />
                      <span class="truncate" :title="nameOf(r.assigneeId)">{{ nameOf(r.assigneeId) }}</span>
                    </span>
                  </TableCell>
                  <TableCell class="text-right tabular-nums">{{ r.open || '—' }}</TableCell>
                  <TableCell class="text-right tabular-nums" :class="r.overdue ? 'text-destructive font-medium' : 'text-muted-foreground'">{{ r.overdue || '—' }}</TableCell>
                  <TableCell class="text-right tabular-nums">{{ r.done || '—' }}</TableCell>
                  <TableCell class="text-muted-foreground pr-3 text-right tabular-nums">{{ pct(r.onTime, r.done) }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <Button v-if="stats.byAssignee.length > COLLAPSED" variant="ghost" size="sm" class="justify-self-start" @click="showAll = !showAll">
            {{ showAll ? 'Свернуть' : `Показать всех (${stats.byAssignee.length})` }}
          </Button>
        </div>

        <div class="grid min-w-0 gap-2">
          <h3 class="text-sm font-medium">Требуют внимания</h3>
          <p v-if="!stats.attention.length" class="text-muted-foreground text-sm">Просроченных задач нет.</p>
          <ul v-else class="grid min-w-0 gap-1">
            <li v-for="a in stats.attention" :key="a.task.id">
              <RouterLink
                :to="{ path: '/task-management', query: { openTaskId: a.task.id } }"
                class="hover:bg-muted/50 grid min-w-0 gap-0.5 rounded-lg px-3 py-2 text-foreground no-underline transition-colors"
              >
                <span class="truncate text-sm"><span class="text-muted-foreground tabular-nums">№{{ a.task.number }}</span> {{ a.task.title }}</span>
                <span class="text-muted-foreground flex min-w-0 gap-2 text-xs">
                  <span class="truncate">{{ nameOf(a.task.assignee_id) }}</span>
                  <span class="text-destructive shrink-0 tabular-nums">просрочена {{ overdueLabel(a.overdueDays) }}</span>
                </span>
              </RouterLink>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </section>
</template>
