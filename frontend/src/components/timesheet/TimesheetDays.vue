<script setup lang="ts">
/**
 * Табель одного сотрудника за месяц: итоги, дни (таблица / карточки),
 * исправление дня, добавление забытого, выгрузка в Excel.
 *
 *   own      — это табель вошедшего: можно добавить забытый день;
 *   canEdit  — можно исправлять дни (свои — всегда, чужие — руководитель).
 */
import { computed, ref, watch } from 'vue'
import { CalendarClockIcon, DownloadIcon, PlusIcon } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Button } from '@/components/ui/shadcn/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/shadcn/table'
import UiBadge from '@/components/ui/UiBadge.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { downloadXls } from '@/lib/tableExport'
import {
  formatHoursShort,
  formatWorkMinutes,
  isTimesheetMissing,
  listWorkDays,
  moscowDate,
  timeHM,
  type WorkDay,
} from '@/lib/timesheet'
import WorkDayEditModal from './WorkDayEditModal.vue'

const props = defineProps<{
  userId: string
  personName: string
  /** Первый день месяца, ГГГГ-ММ-01. */
  month: string
  own: boolean
  canEdit: boolean
  nameOf: (userId: string | null) => string
}>()

const days = ref<WorkDay[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const editing = ref<{ day: WorkDay | null } | null>(null)

const monthEnd = computed(() => {
  const [y, m] = props.month.split('-').map(Number)
  return `${props.month.slice(0, 8)}${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
})

async function load() {
  loading.value = true
  error.value = null
  try {
    days.value = await listWorkDays(props.month, monthEnd.value, props.userId)
  } catch (e) {
    error.value = isTimesheetMissing(e)
      ? 'Табель ещё не включён в базе — нужна миграция 20261103_work_days_timesheet.sql.'
      : formatSupabaseError(e) || 'Не удалось загрузить табель'
    days.value = []
  } finally {
    loading.value = false
  }
}

watch(() => [props.userId, props.month], load, { immediate: true })

/** Не закрыт и уже не сегодняшний — забыли закончить день. */
const isForgotten = (d: WorkDay) => d.is_open && Date.now() - Date.parse(d.started_at) > 86_400_000

const totals = computed(() => {
  const closed = days.value
  const worked = closed.reduce((s, d) => s + (isForgotten(d) ? 0 : d.worked_minutes), 0)
  const ops = closed.reduce((s, d) => s + d.operation_minutes, 0)
  const count = closed.filter((d) => !isForgotten(d)).length
  return {
    worked,
    count,
    avg: count ? Math.round(worked / count) : 0,
    opsShare: worked ? Math.round((ops / worked) * 100) : 0,
    forgotten: closed.filter(isForgotten).length,
    edited: closed.filter((d) => d.edited).length,
  }
})

const dayLabel = (d: WorkDay) => {
  const date = new Date(`${d.work_date}T12:00:00`)
  return {
    date: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
    weekday: date.toLocaleDateString('ru-RU', { weekday: 'short' }),
  }
}

const range = (d: WorkDay) => {
  if (isForgotten(d)) return `${timeHM(d.started_at)} – не закрыт`
  if (d.is_open) return `${timeHM(d.started_at)} – идёт`
  const nextDay = d.ended_at && moscowDate(new Date(d.ended_at)) !== d.work_date
  return `${timeHM(d.started_at)}–${timeHM(d.ended_at)}${nextDay ? ' (+1)' : ''}`
}

function exportXls() {
  const headers = ['Дата', 'День', 'Начало', 'Конец', 'Перерыв, ч:мм', 'Отработано, ч:мм', 'Операции, ч:мм', 'Простои, ч:мм', 'Отметка']
  const rows = [...days.value].reverse().map((d) => {
    const l = dayLabel(d)
    return [
      `${l.date}.${d.work_date.slice(0, 4)}`,
      l.weekday,
      timeHM(d.started_at),
      d.ended_at ? timeHM(d.ended_at) : isForgotten(d) ? 'не закрыт' : 'идёт',
      formatHoursShort(d.break_minutes),
      isForgotten(d) ? '' : formatHoursShort(d.worked_minutes),
      formatHoursShort(d.operation_minutes),
      formatHoursShort(d.downtime_minutes),
      d.edited ? `Исправлено: ${d.last_edit_reason ?? ''}` : '',
    ]
  })
  rows.push(['Итого', '', '', '', '', formatHoursShort(totals.value.worked), '', '', ''])
  downloadXls(headers, rows, `табель_${props.personName.replace(/\s+/g, '_')}_${props.month.slice(0, 7)}.xls`)
}

function onSaved() {
  editing.value = null
  void load()
}

defineExpose({ reload: load })
</script>

<template>
  <div class="grid gap-4">
    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <template v-else>
      <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
          <dt class="text-muted-foreground text-xs">Отработано</dt>
          <dd class="text-sm font-semibold tabular-nums">{{ formatWorkMinutes(totals.worked) }}</dd>
        </div>
        <div class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
          <dt class="text-muted-foreground text-xs">Рабочих дней</dt>
          <dd class="text-sm font-semibold tabular-nums">{{ totals.count }}</dd>
        </div>
        <div class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
          <dt class="text-muted-foreground text-xs">В среднем за день</dt>
          <dd class="text-sm font-semibold tabular-nums">{{ formatWorkMinutes(totals.avg) }}</dd>
        </div>
        <div class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
          <dt class="text-muted-foreground text-xs">Из них на операциях</dt>
          <dd class="text-sm font-semibold tabular-nums">{{ totals.opsShare }}%</dd>
        </div>
      </dl>

      <Alert v-if="totals.forgotten">
        <AlertDescription>
          {{ totals.forgotten === 1 ? 'Один день не закрыт' : `Не закрыто дней: ${totals.forgotten}` }} — без конца дня он не попадает в итог.
          <template v-if="canEdit">Нажмите «Исправить» и укажите, когда закончили.</template>
        </AlertDescription>
      </Alert>

      <div class="flex flex-wrap justify-end gap-2">
        <Button v-if="days.length" variant="outline" size="sm" @click="exportXls">
          <DownloadIcon />
          Excel
        </Button>
        <Button v-if="own" variant="outline" size="sm" @click="editing = { day: null }">
          <PlusIcon />
          Добавить забытый день
        </Button>
      </div>

      <div v-if="loading && !days.length" class="grid gap-2">
        <Skeleton v-for="i in 5" :key="i" class="h-12 w-full rounded-lg" />
      </div>

      <Empty v-else-if="!days.length" class="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><CalendarClockIcon /></EmptyMedia>
          <EmptyTitle>В этом месяце дней нет</EmptyTitle>
          <EmptyDescription>
            {{ own ? 'Начните день на экране оператора — он появится здесь. Забыли отметить — добавьте день вручную.' : 'Сотрудник не отмечал рабочие дни в этом месяце.' }}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>

      <template v-else>
        <!-- Телефон -->
        <ul class="grid gap-2 md:hidden" :class="{ 'opacity-60': loading }">
          <li v-for="d in days" :key="d.id" class="grid gap-2 rounded-lg border p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="grid gap-0.5">
                <span class="font-medium tabular-nums">{{ dayLabel(d).date }} <span class="text-muted-foreground font-normal">{{ dayLabel(d).weekday }}</span></span>
                <span class="text-muted-foreground text-xs tabular-nums">{{ range(d) }}</span>
              </div>
              <span class="text-base font-semibold tabular-nums" :class="{ 'text-muted-foreground': isForgotten(d) }">
                {{ isForgotten(d) ? '—' : formatWorkMinutes(d.worked_minutes) }}
              </span>
            </div>
            <div class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums">
              <span>Операции {{ formatWorkMinutes(d.operation_minutes) }}</span>
              <span v-if="d.downtime_minutes">Простои {{ formatWorkMinutes(d.downtime_minutes) }}</span>
              <span v-if="d.break_minutes">Перерыв {{ formatWorkMinutes(d.break_minutes) }}</span>
            </div>
            <div v-if="isForgotten(d) || d.edited || canEdit" class="flex flex-wrap items-center justify-between gap-2">
              <span class="flex flex-wrap gap-1">
                <UiBadge v-if="isForgotten(d)" tone="danger">Не закрыт</UiBadge>
                <UiBadge v-else-if="d.is_open" tone="success">Идёт</UiBadge>
                <UiBadge v-if="d.edited" tone="info" :title="d.last_edit_reason ?? undefined">Исправлено</UiBadge>
              </span>
              <Button v-if="canEdit && !(d.is_open && !isForgotten(d))" variant="ghost" size="sm" @click="editing = { day: d }">Исправить</Button>
            </div>
          </li>
        </ul>

        <!-- Компьютер -->
        <div class="hidden overflow-hidden rounded-xl border md:block" :class="{ 'opacity-60': loading }">
          <Table class="table-fixed">
            <TableHeader class="bg-muted/50">
              <TableRow>
                <TableHead class="w-28 pl-4">Дата</TableHead>
                <TableHead class="w-40">Время</TableHead>
                <TableHead class="w-24 text-right">Перерыв</TableHead>
                <TableHead class="w-28 text-right">Отработано</TableHead>
                <TableHead class="w-28 text-right">Операции</TableHead>
                <TableHead class="w-24 text-right">Простои</TableHead>
                <TableHead>Отметки</TableHead>
                <TableHead v-if="canEdit" class="w-28 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="d in days" :key="d.id">
                <TableCell class="pl-4 tabular-nums">
                  {{ dayLabel(d).date }} <span class="text-muted-foreground">{{ dayLabel(d).weekday }}</span>
                </TableCell>
                <TableCell class="tabular-nums" :class="{ 'text-destructive': isForgotten(d) }">{{ range(d) }}</TableCell>
                <TableCell class="text-muted-foreground text-right tabular-nums">{{ d.break_minutes ? formatHoursShort(d.break_minutes) : '—' }}</TableCell>
                <TableCell class="text-right font-medium tabular-nums">{{ isForgotten(d) ? '—' : formatHoursShort(d.worked_minutes) }}</TableCell>
                <TableCell class="text-muted-foreground text-right tabular-nums">{{ d.operation_minutes ? formatHoursShort(d.operation_minutes) : '—' }}</TableCell>
                <TableCell class="text-muted-foreground text-right tabular-nums">{{ d.downtime_minutes ? formatHoursShort(d.downtime_minutes) : '—' }}</TableCell>
                <TableCell class="whitespace-normal">
                  <span class="flex flex-wrap items-center gap-1">
                    <UiBadge v-if="isForgotten(d)" tone="danger">Не закрыт</UiBadge>
                    <UiBadge v-else-if="d.is_open" tone="success">Идёт</UiBadge>
                    <UiBadge v-if="d.edited" tone="info">Исправлено</UiBadge>
                    <span v-if="d.edited && d.last_edit_reason" class="text-muted-foreground line-clamp-1 text-xs" :title="d.last_edit_reason">{{ d.last_edit_reason }}</span>
                  </span>
                </TableCell>
                <TableCell v-if="canEdit" class="pr-4 text-right">
                  <Button v-if="!(d.is_open && !isForgotten(d))" variant="ghost" size="sm" @click="editing = { day: d }">Исправить</Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </template>
    </template>

    <WorkDayEditModal
      v-if="editing"
      :day="editing.day"
      :person-name="own ? undefined : personName"
      :name-of="nameOf"
      @close="editing = null"
      @saved="onSaved"
    />
  </div>
</template>
