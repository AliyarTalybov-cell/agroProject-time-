<script setup lang="ts">
/**
 * Табель всех сотрудников за период (для руководителя): строки — люди,
 * колонки — дни, в ячейке отработанные часы. Красная точка — день не закрыт,
 * синяя — исправлен. Клик по сотруднику открывает его дни (emit select).
 */
import { computed, ref, watch } from 'vue'
import { DownloadIcon, SearchIcon } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Button } from '@/components/ui/shadcn/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/shadcn/input-group'
import UiPagination from '@/components/ui/UiPagination.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import UserAvatar from '@/components/UserAvatar.vue'
import { avatarColorByPosition } from '@/lib/avatarColors'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { downloadXls } from '@/lib/tableExport'
import { formatHoursShort, formatWorkMinutes, isTimesheetMissing, listWorkDays, type WorkDay } from '@/lib/timesheet'
import type { ProfileRow } from '@/lib/tasksSupabase'

const props = defineProps<{
  from: string
  to: string
  profiles: ProfileRow[]
}>()

const emit = defineEmits<{ select: [userId: string] }>()

const days = ref<WorkDay[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

/** Сетка не шире ~двух месяцев — иначе её не прочитать. */
const MAX_DAYS = 62
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dates = computed(() => {
  const out: string[] = []
  const d = new Date(`${props.from}T12:00:00`)
  const end = new Date(`${props.to}T12:00:00`)
  while (d <= end && out.length < MAX_DAYS) {
    out.push(ymd(d))
    d.setDate(d.getDate() + 1)
  }
  return out
})
const truncated = computed(() => dates.value.length >= MAX_DAYS && dates.value[dates.value.length - 1] < props.to)
const gridTo = computed(() => dates.value[dates.value.length - 1] ?? props.to)

async function load() {
  loading.value = true
  error.value = null
  try {
    days.value = await listWorkDays(props.from, gridTo.value, null)
  } catch (e) {
    error.value = isTimesheetMissing(e)
      ? 'Табель ещё не включён в базе — нужна миграция 20261103_work_days_timesheet.sql.'
      : formatSupabaseError(e) || 'Не удалось загрузить табель'
    days.value = []
  } finally {
    loading.value = false
  }
}
watch(() => [props.from, props.to], load, { immediate: true })

const isForgotten = (d: WorkDay) => d.is_open && Date.now() - Date.parse(d.started_at) > 86_400_000

const spansMonths = computed(() => props.from.slice(0, 7) !== gridTo.value.slice(0, 7))
const columns = computed(() =>
  dates.value.map((key) => {
    const date = new Date(`${key}T12:00:00`)
    const wd = date.getDay()
    return {
      key,
      n: spansMonths.value ? `${key.slice(8, 10)}.${key.slice(5, 7)}` : String(Number(key.slice(8, 10))),
      weekend: wd === 0 || wd === 6,
      weekday: date.toLocaleDateString('ru-RU', { weekday: 'short' }),
    }
  }),
)

const nameOf = (p: ProfileRow) => p.display_name?.trim() || p.email

/** Все, у кого есть дни, плюс остальные сотрудники без ролей руководителя — чтобы было видно, кто не отмечался. */
const allRows = computed(() => {
  const byUser = new Map<string, Map<string, WorkDay>>()
  for (const d of days.value) {
    const m = byUser.get(d.user_id) ?? new Map<string, WorkDay>()
    m.set(d.work_date, d)
    byUser.set(d.user_id, m)
  }
  const people = props.profiles.filter((p) => byUser.has(p.id) || p.role !== 'manager')
  return people
    .map((p) => {
      const cells = byUser.get(p.id) ?? new Map<string, WorkDay>()
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
})

/* ---------- поиск, фильтр, сортировка, страницы — сотрудников может быть много ---------- */
const search = ref('')
const position = ref('')
const sort = ref<'hours' | 'name' | 'issues'>('hours')
const page = ref(1)
const pageSize = ref(20)

const positionOptions = computed(() => {
  const set = new Set(allRows.value.map((r) => r.p.position?.trim()).filter((x): x is string => Boolean(x)))
  return [{ value: '', label: 'Все должности' }, ...[...set].sort((a, b) => a.localeCompare(b, 'ru')).map((x) => ({ value: x, label: x }))]
})
const sortOptions = [
  { value: 'hours' as const, label: 'Больше часов' },
  { value: 'issues' as const, label: 'Сначала не закрытые' },
  { value: 'name' as const, label: 'По имени' },
]

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = allRows.value.filter(
    (r) =>
      (!q || r.name.toLowerCase().includes(q) || (r.p.email || '').toLowerCase().includes(q)) &&
      (!position.value || r.p.position?.trim() === position.value),
  )
  const byName = (a: (typeof list)[number], b: (typeof list)[number]) => a.name.localeCompare(b.name, 'ru')
  if (sort.value === 'name') return list.sort(byName)
  if (sort.value === 'issues') return list.sort((a, b) => b.issues - a.issues || b.total - a.total || byName(a, b))
  return list.sort((a, b) => b.total - a.total || byName(a, b))
})

watch([search, position, sort, pageSize], () => (page.value = 1))
const pagedRows = computed(() => rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

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
      const d = r.cells.get(c.key)
      if (!d) return ''
      if (isForgotten(d)) return 'не закрыт'
      return formatHoursShort(d.worked_minutes) + (d.edited ? '*' : '')
    }),
    r.count,
    formatHoursShort(r.total),
  ])
  body.push(['Итого', '', ...columns.value.map(() => ''), '', formatHoursShort(teamTotal.value)])
  body.push(['* — день исправлен сотрудником или руководителем', '', ...columns.value.map(() => ''), '', ''])
  downloadXls(headers, body, `табель_${props.from}_${gridTo.value}.xls`)
}

defineExpose({ reload: load })
</script>

<template>
  <div class="grid gap-4">
    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <template v-else>
      <div class="grid gap-2 sm:flex sm:flex-wrap sm:items-end sm:justify-between sm:gap-3">
        <dl class="grid grid-cols-3 gap-2 sm:max-w-xl sm:flex-1">
          <div class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
            <dt class="text-muted-foreground text-xs">Отработано</dt>
            <dd class="text-sm font-semibold tabular-nums">{{ formatWorkMinutes(teamTotal) }}</dd>
          </div>
          <div class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
            <dt class="text-muted-foreground text-xs">Отмечались</dt>
            <dd class="text-sm font-semibold tabular-nums">{{ peopleWithDays }} из {{ rows.length }}</dd>
          </div>
          <div class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
            <dt class="text-muted-foreground text-xs">Не закрыто</dt>
            <dd class="text-sm font-semibold tabular-nums" :class="{ 'text-destructive': issuesTotal }">{{ issuesTotal }}</dd>
          </div>
        </dl>
        <Button variant="outline" class="justify-self-end" :disabled="!rows.length" @click="exportXls">
          <DownloadIcon />
          Excel
        </Button>
      </div>

      <div class="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <InputGroup class="sm:w-64">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput v-model="search" type="search" autocomplete="off" placeholder="Поиск сотрудника" aria-label="Поиск сотрудника" />
        </InputGroup>
        <UiSelect v-if="positionOptions.length > 2" v-model="position" :options="positionOptions" class="sm:w-52" aria-label="Должность" />
        <UiSelect v-model="sort" :options="sortOptions" class="sm:w-52" aria-label="Сортировка" />
      </div>

      <div v-if="loading && !days.length" class="grid gap-2">
        <Skeleton v-for="i in 5" :key="i" class="h-10 w-full rounded-lg" />
      </div>

      <p v-else-if="!rows.length" class="text-muted-foreground rounded-xl border px-4 py-6 text-center text-sm">Никого не нашли — измените поиск или фильтр.</p>

      <div v-else class="max-h-[70vh] overflow-auto rounded-xl border" :class="{ 'opacity-60': loading }">
        <table class="w-max min-w-full border-collapse text-sm">
          <thead class="bg-muted sticky top-0 z-20">
            <tr>
              <th class="bg-muted sticky left-0 z-30 w-40 min-w-40 px-3 py-2 text-left sm:w-56 sm:min-w-56 sm:px-4 text-xs font-medium">Сотрудник</th>
              <th
                v-for="c in columns"
                :key="c.key"
                class="min-w-11 px-1 py-2 text-center text-xs font-medium tabular-nums"
                :class="c.weekend ? 'text-muted-foreground/60' : 'text-muted-foreground'"
              >
                <div>{{ c.n }}</div>
                <div class="text-[10px] font-normal">{{ c.weekday }}</div>
              </th>
              <th class="w-16 min-w-16 px-3 py-2 text-right text-xs font-medium">Дней</th>
              <th class="w-20 min-w-20 px-4 py-2 text-right text-xs font-medium">Итого</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRows" :key="r.p.id" class="hover:bg-muted/40 border-t">
              <td class="bg-card sticky left-0 z-10 max-w-40 px-3 py-2 sm:max-w-56 sm:px-4">
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
                :key="c.key"
                class="px-1 py-2 text-center text-xs whitespace-nowrap tabular-nums"
                :class="c.weekend ? 'bg-muted/30' : ''"
                :title="cellTitle(r.cells.get(c.key))"
              >
                <template v-if="r.cells.get(c.key)">
                  <span v-if="isForgotten(r.cells.get(c.key)!)" class="text-destructive font-medium">!</span>
                  <template v-else>{{ formatHoursShort(r.cells.get(c.key)!.worked_minutes) }}</template>
                  <span v-if="r.cells.get(c.key)!.edited" class="ml-0.5 inline-block size-1.5 rounded-full bg-sky-500 align-top" aria-label="Исправлено" />
                </template>
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ r.count }}</td>
              <td class="px-4 py-2 text-right font-medium tabular-nums">{{ formatHoursShort(r.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <UiPagination
        v-if="rows.length > 20"
        :page="page"
        :page-size="pageSize"
        :total="rows.length"
        :page-size-options="[20, 50, 100]"
        @update:page="(p) => (page = p)"
        @update:page-size="(n) => (pageSize = n)"
      />
      <p v-if="truncated" class="text-muted-foreground text-xs">Показаны первые {{ MAX_DAYS }} дней периода — для итогов за большой срок выгрузите Excel по частям или сузьте период.</p>
      <p class="text-muted-foreground text-xs">
        В ячейке — отработано за день (ч:мм). <span class="text-destructive">!</span> — день не закрыт,
        <span class="inline-block size-1.5 rounded-full bg-sky-500 align-middle" /> — исправлен. Нажмите на сотрудника, чтобы открыть его дни.
      </p>
    </template>
  </div>
</template>
