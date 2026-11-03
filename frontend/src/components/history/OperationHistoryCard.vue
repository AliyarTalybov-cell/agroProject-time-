<script setup lang="ts">
/**
 * «История взаимодействия» на карточке поля и техники.
 *
 * Сверху сводка (сколько работ, площадь, время, когда последняя), фильтры по
 * операции и исполнителю, ниже реестр: таблица на компьютере, карточки на
 * телефоне, постраничная загрузка с сервера.
 *
 *   scope="field"      — колонки «Исполнитель / Техника / Площадь»
 *   scope="equipment"  — «Поле / Исполнитель / Топливо / Состояние»
 */
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { HistoryIcon } from '@lucide/vue'
import { Card } from '@/components/ui/shadcn/card'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/shadcn/table'
import UiBadge, { type UiBadgeTone } from '@/components/ui/UiBadge.vue'
import UiPagination from '@/components/ui/UiPagination.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { avatarColorByPosition } from '@/lib/avatarColors'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  formatDurationMinutes,
  formatHectares,
  loadOperationHistoryPage,
  loadOperationHistorySummary,
  type OperationHistoryRow,
  type OperationHistoryScope,
  type OperationHistorySummary,
} from '@/lib/operationHistory'
import type { ProfileRow } from '@/lib/tasksSupabase'

const props = defineProps<{
  scope: OperationHistoryScope
  id: string
  title: string
  /** Не руководитель видит только свои работы. */
  onlyUserId?: string | null
  profiles: ProfileRow[]
}>()

const isField = computed(() => props.scope === 'field')

const rows = ref<OperationHistoryRow[]>([])
const total = ref(0)
const summary = ref<OperationHistorySummary | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const page = ref(1)
const pageSize = ref(10)
const operationFilter = ref('')
const employeeFilter = ref('')

const filter = computed(() => ({
  userId: props.onlyUserId || employeeFilter.value || null,
  operation: operationFilter.value || null,
}))

let seq = 0
async function loadPage() {
  const my = ++seq
  loading.value = true
  error.value = null
  try {
    const res = await loadOperationHistoryPage(props.scope, props.id, filter.value, page.value, pageSize.value)
    if (my !== seq) return
    rows.value = res.rows
    total.value = res.total
  } catch (e) {
    if (my !== seq) return
    error.value = formatSupabaseError(e) || 'Не удалось загрузить историю работ'
    rows.value = []
    total.value = 0
  } finally {
    if (my === seq) loading.value = false
  }
}

async function loadSummary() {
  try {
    // Списки для фильтров — по всем работам объекта, сводка — с учётом фильтров.
    summary.value = await loadOperationHistorySummary(props.scope, props.id, filter.value)
  } catch {
    summary.value = null
  }
}

function reloadAll() {
  void loadSummary()
  void loadPage()
}

watch(() => [props.id, props.onlyUserId], () => {
  page.value = 1
  operationFilter.value = ''
  employeeFilter.value = ''
  reloadAll()
}, { immediate: true })

watch([operationFilter, employeeFilter], () => {
  page.value = 1
  reloadAll()
})
watch([page, pageSize], () => void loadPage())

defineExpose({ reload: reloadAll })

/* ---------- люди ---------- */
const profileById = computed(() => new Map(props.profiles.map((p) => [p.id, p])))

function profileOf(row: { userId: string | null; employee: string }): ProfileRow | undefined {
  if (row.userId) {
    const p = profileById.value.get(row.userId)
    if (p) return p
  }
  const key = row.employee.trim().toLowerCase()
  if (!key) return undefined
  return props.profiles.find((p) => (p.email || '').toLowerCase() === key || (p.display_name || '').trim().toLowerCase() === key)
}

function personName(row: { userId: string | null; employee: string }): string {
  const p = profileOf(row)
  return p?.display_name?.trim() || row.employee || p?.email || 'Не указан'
}

function personInitials(row: { userId: string | null; employee: string }): string {
  const base = personName(row).split('@')[0]
  const parts = base.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (parts[0] ?? '?').slice(0, 2).toUpperCase()
}

function personAvatar(row: { userId: string | null; employee: string }) {
  const p = profileOf(row)
  return {
    url: p?.avatar_url ?? null,
    style: { background: avatarColorByPosition(p?.position || personName(row)) },
  }
}

/* ---------- фильтры ---------- */
const operationOptions = computed(() => [
  { value: '', label: 'Все операции' },
  ...(summary.value?.operations ?? []).map((o) => ({ value: o, label: o })),
])

const showEmployeeFilter = computed(() => !props.onlyUserId && (summary.value?.employees.length ?? 0) > 1)
const employeeOptions = computed(() => [
  { value: '', label: 'Все исполнители' },
  ...(summary.value?.employees ?? [])
    .map((e) => ({ value: e.userId, label: personName({ userId: e.userId, employee: e.employee }) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
])

const hasFilters = computed(() => Boolean(operationFilter.value || employeeFilter.value))

/* ---------- форматирование ---------- */
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

function dateLabel(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d)
}

function timeRange(row: OperationHistoryRow) {
  const s = new Date(row.startISO)
  const e = new Date(row.endISO)
  if (Number.isNaN(s.getTime())) return ''
  if (Number.isNaN(e.getTime()) || e <= s) return timeFmt.format(s)
  if (s.toDateString() !== e.toDateString()) {
    const endDay = e.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    return `${timeFmt.format(s)} – ${endDay} ${timeFmt.format(e)}`
  }
  return `${timeFmt.format(s)}–${timeFmt.format(e)}`
}

function lastLabel(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days <= 0) return 'Сегодня'
  if (days === 1) return 'Вчера'
  return dateFmt.format(d)
}

function conditionTone(label: string | null): UiBadgeTone {
  const s = (label ?? '').toLowerCase()
  if (!s) return 'neutral'
  if (s.includes('плох') || s.includes('низк') || s.includes('неисправ')) return 'danger'
  if (s.includes('частич') || s.includes('требует') || s.includes('ремонт')) return 'warning'
  return 'success'
}

function fuelLabel(row: OperationHistoryRow): string {
  if (row.fuelStart == null && row.fuelLeft == null) return '—'
  if (row.fuelLeft == null) return `${row.fuelStart}%`
  if (row.fuelStart == null) return `→ ${row.fuelLeft}%`
  return `${row.fuelStart}% → ${row.fuelLeft}%`
}

const fuelLow = (row: OperationHistoryRow) => row.fuelLeft != null && row.fuelLeft < 25

const stats = computed(() => {
  const s = summary.value
  if (!s) return []
  const list = [
    { label: 'Работ', value: String(s.count) },
    { label: 'В работе', value: s.minutes >= 600 ? `${Math.round(s.minutes / 60).toLocaleString('ru-RU')} ч` : formatDurationMinutes(s.minutes) },
    { label: 'Последняя', value: lastLabel(s.lastISO) },
  ]
  if (s.hectares > 0) list.splice(1, 0, { label: 'Обработано', value: `${formatHectares(s.hectares)} га` })
  return list
})
</script>

<template>
  <Card class="tw-scope gap-4 p-4 md:p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="grid gap-1">
        <h2 class="text-base font-semibold">{{ title }}</h2>
        <p class="text-muted-foreground text-xs">Работы с экрана оператора, новые сверху.</p>
      </div>
      <div v-if="summary && (summary.operations.length > 1 || showEmployeeFilter)" class="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto">
        <UiSelect v-if="summary.operations.length > 1" v-model="operationFilter" :options="operationOptions" size="sm" aria-label="Операция" class="sm:w-56" />
        <UiSelect v-if="showEmployeeFilter" v-model="employeeFilter" :options="employeeOptions" size="sm" aria-label="Исполнитель" class="sm:w-48" />
      </div>
    </div>

    <dl v-if="stats.length && summary!.count > 0" class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div v-for="s in stats" :key="s.label" class="bg-muted/50 grid gap-0.5 rounded-lg px-3 py-2">
        <dt class="text-muted-foreground text-xs">{{ s.label }}</dt>
        <dd class="text-sm font-semibold tabular-nums">{{ s.value }}</dd>
      </div>
    </dl>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-else-if="loading && !rows.length" class="grid gap-2">
      <Skeleton v-for="i in 4" :key="i" class="h-12 w-full rounded-lg" />
    </div>

    <Empty v-else-if="!rows.length" class="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><HistoryIcon /></EmptyMedia>
        <EmptyTitle>{{ hasFilters ? 'Ничего не найдено' : 'Работ пока не было' }}</EmptyTitle>
        <EmptyDescription>
          {{ hasFilters ? 'Измените фильтры.' : 'Записи появятся, когда оператор завершит работу на экране оператора.' }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>

    <template v-else>
      <!-- Телефон: карточки -->
      <ul class="grid gap-2 md:hidden" :class="{ 'opacity-60': loading }">
        <li v-for="r in rows" :key="r.id" class="grid gap-2 rounded-lg border p-3">
          <div class="flex items-start justify-between gap-3">
            <span class="min-w-0 font-medium leading-snug">{{ r.operation || 'Операция' }}</span>
            <span class="text-muted-foreground shrink-0 text-xs tabular-nums">{{ dateLabel(r.startISO) }}</span>
          </div>
          <div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span class="flex w-full items-center gap-1.5">
              <UserAvatar class="size-5 shrink-0 text-[9px] font-medium text-white" :style="personAvatar(r).style" :url="personAvatar(r).url" :initials="personInitials(r)" />
              {{ personName(r) }}
            </span>
            <span class="tabular-nums">{{ timeRange(r) }} · {{ formatDurationMinutes(r.durationMinutes) }}</span>
            <span v-if="isField && r.processedHectares != null" class="tabular-nums">{{ formatHectares(r.processedHectares) }} га</span>
            <span v-if="!isField && (r.fuelStart != null || r.fuelLeft != null)" class="tabular-nums" :class="{ 'text-destructive': fuelLow(r) }">Топливо {{ fuelLabel(r) }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <template v-if="isField">
              <RouterLink v-if="r.equipmentId" class="text-primary hover:underline" :to="{ name: 'equipment-details', params: { id: r.equipmentId } }">{{ r.equipmentLabel || 'Техника' }}</RouterLink>
            </template>
            <template v-else>
              <RouterLink v-if="r.fieldId" class="text-primary hover:underline" :to="{ name: 'field-details', params: { id: r.fieldId } }">{{ r.fieldName || 'Поле' }}</RouterLink>
              <span v-else-if="r.fieldName" class="text-muted-foreground">{{ r.fieldName }}</span>
              <UiBadge v-if="r.conditionLabel" :tone="conditionTone(r.conditionLabel)">{{ r.conditionLabel }}</UiBadge>
            </template>
          </div>
          <p v-if="r.notes" class="text-muted-foreground text-xs whitespace-pre-line">{{ r.notes }}</p>
          <p v-if="r.repairNotes" class="text-xs whitespace-pre-line text-amber-700 dark:text-amber-300">Неисправность: {{ r.repairNotes }}</p>
        </li>
      </ul>

      <!-- Компьютер: таблица -->
      <div class="hidden overflow-hidden rounded-xl border md:block" :class="{ 'opacity-60': loading }">
        <Table class="table-fixed">
          <TableHeader class="bg-muted/50">
            <TableRow>
              <TableHead class="w-36 pl-4">Дата</TableHead>
              <TableHead>Операция</TableHead>
              <TableHead v-if="!isField" class="w-[16%]">Поле</TableHead>
              <TableHead class="w-[18%]">Исполнитель</TableHead>
              <TableHead v-if="isField" class="w-[20%]">Техника</TableHead>
              <TableHead v-if="isField" class="w-24 text-right">Площадь</TableHead>
              <TableHead v-if="!isField" class="w-28">Топливо</TableHead>
              <TableHead v-if="!isField" class="w-[15%]">Состояние</TableHead>
              <TableHead class="w-28 pr-4 text-right">Длительность</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="r in rows" :key="r.id" class="align-top">
              <TableCell class="pl-4">
                <div class="tabular-nums">{{ dateLabel(r.startISO) }}</div>
                <div class="text-muted-foreground text-xs whitespace-normal tabular-nums">{{ timeRange(r) }}</div>
              </TableCell>
              <TableCell class="whitespace-normal">
                <div class="font-medium leading-snug">{{ r.operation || 'Операция' }}</div>
                <div v-if="r.notes" class="text-muted-foreground line-clamp-2 text-xs" :title="r.notes">{{ r.notes }}</div>
              </TableCell>
              <TableCell v-if="!isField" class="whitespace-normal">
                <RouterLink v-if="r.fieldId" class="text-primary hover:underline" :to="{ name: 'field-details', params: { id: r.fieldId } }">{{ r.fieldName || 'Поле' }}</RouterLink>
                <span v-else class="text-muted-foreground">{{ r.fieldName || '—' }}</span>
              </TableCell>
              <TableCell>
                <span class="flex min-w-0 items-center gap-2">
                  <UserAvatar class="size-6 shrink-0 text-[10px] font-medium text-white" :style="personAvatar(r).style" :url="personAvatar(r).url" :initials="personInitials(r)" />
                  <span class="truncate" :title="personName(r)">{{ personName(r) }}</span>
                </span>
              </TableCell>
              <TableCell v-if="isField" class="whitespace-normal">
                <RouterLink v-if="r.equipmentId" class="text-primary hover:underline" :to="{ name: 'equipment-details', params: { id: r.equipmentId } }">{{ r.equipmentLabel || 'Техника' }}</RouterLink>
                <span v-else class="text-muted-foreground">—</span>
              </TableCell>
              <TableCell v-if="isField" class="text-right tabular-nums">
                {{ r.processedHectares != null ? `${formatHectares(r.processedHectares)} га` : '—' }}
              </TableCell>
              <TableCell v-if="!isField" class="tabular-nums" :class="{ 'text-destructive': fuelLow(r) }" :title="fuelLow(r) ? 'Мало топлива после работы' : undefined">
                {{ fuelLabel(r) }}
              </TableCell>
              <TableCell v-if="!isField" class="whitespace-normal">
                <UiBadge v-if="r.conditionLabel" :tone="conditionTone(r.conditionLabel)" class="h-auto max-w-full text-left whitespace-normal">{{ r.conditionLabel }}</UiBadge>
                <span v-else class="text-muted-foreground">—</span>
                <div v-if="r.repairNotes" class="text-muted-foreground mt-1 line-clamp-2 text-xs" :title="r.repairNotes">{{ r.repairNotes }}</div>
              </TableCell>
              <TableCell class="pr-4 text-right tabular-nums">{{ formatDurationMinutes(r.durationMinutes) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <UiPagination
        v-if="total > 0"
        :page="page"
        :page-size="pageSize"
        :total="total"
        :page-size-options="[10, 20, 50]"
        @update:page="(p) => (page = p)"
        @update:page-size="(n) => (pageSize = n)"
      />
    </template>
  </Card>
</template>
