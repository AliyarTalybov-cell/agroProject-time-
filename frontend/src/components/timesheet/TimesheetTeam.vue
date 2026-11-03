<script setup lang="ts">
/**
 * Табель всех сотрудников за месяц (для руководителя): строки — люди,
 * колонки — дни, в ячейке отработанные часы. Красная точка — день не закрыт,
 * синяя — исправлен. Клик по сотруднику открывает его дни (emit select).
 */
import { computed, ref, watch } from 'vue'
import { DownloadIcon } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Button } from '@/components/ui/shadcn/button'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import UserAvatar from '@/components/UserAvatar.vue'
import { avatarColorByPosition } from '@/lib/avatarColors'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { downloadXls } from '@/lib/tableExport'
import { formatHoursShort, formatWorkMinutes, isTimesheetMissing, listWorkDays, type WorkDay } from '@/lib/timesheet'
import type { ProfileRow } from '@/lib/tasksSupabase'

const props = defineProps<{
  month: string
  profiles: ProfileRow[]
}>()

const emit = defineEmits<{ select: [userId: string] }>()

const days = ref<WorkDay[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const daysInMonth = computed(() => {
  const [y, m] = props.month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
})
const monthEnd = computed(() => `${props.month.slice(0, 8)}${String(daysInMonth.value).padStart(2, '0')}`)

async function load() {
  loading.value = true
  error.value = null
  try {
    days.value = await listWorkDays(props.month, monthEnd.value, null)
  } catch (e) {
    error.value = isTimesheetMissing(e)
      ? 'Табель ещё не включён в базе — нужна миграция 20261103_work_days_timesheet.sql.'
      : formatSupabaseError(e) || 'Не удалось загрузить табель'
    days.value = []
  } finally {
    loading.value = false
  }
}
watch(() => props.month, load, { immediate: true })

const isForgotten = (d: WorkDay) => d.is_open && Date.now() - Date.parse(d.started_at) > 86_400_000

const columns = computed(() =>
  Array.from({ length: daysInMonth.value }, (_, i) => {
    const date = new Date(`${props.month.slice(0, 8)}${String(i + 1).padStart(2, '0')}T12:00:00`)
    const wd = date.getDay()
    return { n: i + 1, weekend: wd === 0 || wd === 6, weekday: date.toLocaleDateString('ru-RU', { weekday: 'short' }) }
  }),
)

const nameOf = (p: ProfileRow) => p.display_name?.trim() || p.email

/** Все, у кого есть дни, плюс остальные сотрудники без ролей руководителя — чтобы было видно, кто не отмечался. */
const rows = computed(() => {
  const byUser = new Map<string, Map<number, WorkDay>>()
  for (const d of days.value) {
    const m = byUser.get(d.user_id) ?? new Map<number, WorkDay>()
    m.set(Number(d.work_date.slice(8, 10)), d)
    byUser.set(d.user_id, m)
  }
  const people = props.profiles.filter((p) => byUser.has(p.id) || p.role !== 'manager')
  return people
    .map((p) => {
      const cells = byUser.get(p.id) ?? new Map<number, WorkDay>()
      let total = 0
      let count = 0
      let issues = 0
      for (const d of cells.values()) {
        if (isForgotten(d)) issues += 1
        else {
          total += d.worked_minutes
          count += 1
        }
      }
      return { p, name: nameOf(p), cells, total, count, issues }
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ru'))
})

const teamTotal = computed(() => rows.value.reduce((s, r) => s + r.total, 0))
const peopleWithDays = computed(() => rows.value.filter((r) => r.count > 0).length)
const issuesTotal = computed(() => rows.value.reduce((s, r) => s + r.issues, 0))

function cellTitle(d: WorkDay | undefined): string | undefined {
  if (!d) return undefined
  if (isForgotten(d)) return 'День не закрыт'
  const parts = [`Отработано ${formatWorkMinutes(d.worked_minutes)}`, `операции ${formatWorkMinutes(d.operation_minutes)}`]
  if (d.edited) parts.push(`исправлено: ${d.last_edit_reason ?? ''}`)
  return parts.join(', ')
}

function initials(name: string) {
  const parts = name.split('@')[0].trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase() || '?'
}

function exportXls() {
  const headers = ['Сотрудник', 'Должность', ...columns.value.map((c) => String(c.n)), 'Дней', 'Итого, ч:мм']
  const body = rows.value.map((r) => [
    r.name,
    r.p.position ?? '',
    ...columns.value.map((c) => {
      const d = r.cells.get(c.n)
      if (!d) return ''
      if (isForgotten(d)) return 'не закрыт'
      return formatHoursShort(d.worked_minutes) + (d.edited ? '*' : '')
    }),
    r.count,
    formatHoursShort(r.total),
  ])
  body.push(['Итого', '', ...columns.value.map(() => ''), '', formatHoursShort(teamTotal.value)])
  body.push(['* — день исправлен сотрудником или руководителем', '', ...columns.value.map(() => ''), '', ''])
  downloadXls(headers, body, `табель_${props.month.slice(0, 7)}.xls`)
}

defineExpose({ reload: load })
</script>

<template>
  <div class="grid gap-4">
    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <template v-else>
      <div class="flex flex-wrap items-end justify-between gap-3">
        <dl class="grid flex-1 grid-cols-3 gap-2 sm:max-w-xl">
          <div class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
            <dt class="text-muted-foreground text-xs">Отработано всеми</dt>
            <dd class="text-sm font-semibold tabular-nums">{{ formatWorkMinutes(teamTotal) }}</dd>
          </div>
          <div class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
            <dt class="text-muted-foreground text-xs">Отмечались</dt>
            <dd class="text-sm font-semibold tabular-nums">{{ peopleWithDays }} из {{ rows.length }}</dd>
          </div>
          <div class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
            <dt class="text-muted-foreground text-xs">Не закрыто дней</dt>
            <dd class="text-sm font-semibold tabular-nums" :class="{ 'text-destructive': issuesTotal }">{{ issuesTotal }}</dd>
          </div>
        </dl>
        <Button variant="outline" size="sm" :disabled="!rows.length" @click="exportXls">
          <DownloadIcon />
          Excel
        </Button>
      </div>

      <div v-if="loading && !days.length" class="grid gap-2">
        <Skeleton v-for="i in 5" :key="i" class="h-10 w-full rounded-lg" />
      </div>

      <div v-else class="overflow-x-auto rounded-xl border" :class="{ 'opacity-60': loading }">
        <table class="w-max min-w-full border-collapse text-sm">
          <thead class="bg-muted/50">
            <tr>
              <th class="bg-muted sticky left-0 z-10 min-w-48 px-4 py-2 text-left text-xs font-medium">Сотрудник</th>
              <th
                v-for="c in columns"
                :key="c.n"
                class="w-11 px-1 py-2 text-center text-xs font-medium tabular-nums"
                :class="c.weekend ? 'text-muted-foreground/60' : 'text-muted-foreground'"
              >
                <div>{{ c.n }}</div>
                <div class="text-[10px] font-normal">{{ c.weekday }}</div>
              </th>
              <th class="px-3 py-2 text-right text-xs font-medium">Дней</th>
              <th class="px-4 py-2 text-right text-xs font-medium">Итого</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.p.id" class="hover:bg-muted/40 border-t">
              <td class="bg-card sticky left-0 z-10 px-4 py-2">
                <button type="button" class="flex min-w-0 items-center gap-2 text-left hover:underline" @click="emit('select', r.p.id)">
                  <UserAvatar class="size-6 shrink-0 text-[10px] font-medium text-white" :style="{ background: avatarColorByPosition(r.p.position || r.name) }" :url="r.p.avatar_url ?? null" :initials="initials(r.name)" />
                  <span class="grid min-w-0">
                    <span class="truncate">{{ r.name }}</span>
                    <span v-if="r.p.position" class="text-muted-foreground truncate text-xs">{{ r.p.position }}</span>
                  </span>
                </button>
              </td>
              <td
                v-for="c in columns"
                :key="c.n"
                class="relative px-1 py-2 text-center text-xs tabular-nums"
                :class="c.weekend ? 'bg-muted/30' : ''"
                :title="cellTitle(r.cells.get(c.n))"
              >
                <template v-if="r.cells.get(c.n)">
                  <span v-if="isForgotten(r.cells.get(c.n)!)" class="text-destructive font-medium">!</span>
                  <template v-else>{{ formatHoursShort(r.cells.get(c.n)!.worked_minutes) }}</template>
                  <span v-if="r.cells.get(c.n)!.edited" class="absolute top-1 right-1 size-1.5 rounded-full bg-sky-500" aria-label="Исправлено" />
                </template>
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ r.count }}</td>
              <td class="px-4 py-2 text-right font-medium tabular-nums">{{ formatHoursShort(r.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-muted-foreground text-xs">
        В ячейке — отработано за день (ч:мм). <span class="text-destructive">!</span> — день не закрыт,
        <span class="inline-block size-1.5 rounded-full bg-sky-500 align-middle" /> — исправлен. Нажмите на сотрудника, чтобы открыть его дни.
      </p>
    </template>
  </div>
</template>
