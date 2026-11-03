<script setup lang="ts">
/**
 * «Рабочий день» на экране оператора: начать день, перерыв, закончить день,
 * и сколько уже отработано сегодня — с разбивкой на операции, простои и
 * перерывы. Время считает база (list_work_days), здесь — только показ и
 * живой счётчик между обновлениями.
 *
 * Экран оператора вызывает ensureStarted() при старте операции или простоя:
 * если день не начат, он начнётся сам.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { CoffeeIcon, PlayIcon, SquareIcon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import UiBadge from '@/components/ui/UiBadge.vue'
import { askConfirm } from '@/composables/useConfirm'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  endBreak,
  finishWorkDay,
  formatWorkMinutes,
  isTimesheetMissing,
  loadMyCurrentDay,
  startBreak,
  startWorkDay,
  timeHM,
  type WorkDay,
} from '@/lib/timesheet'

const props = defineProps<{
  userId: string | null
  /** Идёт операция или простой — закончить день нельзя. */
  busy: boolean
  /** Минуты текущей, ещё не завершённой операции — в счётчик «Операции». */
  liveOperationMinutes: number
}>()

const day = ref<WorkDay | null>(null)
const loadedAt = ref(Date.now())
const now = ref(Date.now())
const loading = ref(true)
const acting = ref(false)
const error = ref<string | null>(null)
const unavailable = ref(false)

async function refresh() {
  if (!props.userId) return
  try {
    day.value = await loadMyCurrentDay(props.userId)
    loadedAt.value = Date.now()
    error.value = null
  } catch (e) {
    if (isTimesheetMissing(e)) unavailable.value = true
    else error.value = formatSupabaseError(e) || 'Не удалось загрузить рабочий день'
  } finally {
    loading.value = false
  }
}

let tick: ReturnType<typeof setInterval> | null = null
let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void refresh()
  tick = setInterval(() => (now.value = Date.now()), 15_000)
  // Раз в 5 минут — с сервера: подтянуть завершённые операции и простои.
  poll = setInterval(() => void refresh(), 5 * 60_000)
})
onUnmounted(() => {
  if (tick) clearInterval(tick)
  if (poll) clearInterval(poll)
})
watch(() => props.userId, () => void refresh())

const isOpen = computed(() => Boolean(day.value?.is_open))
const onBreak = computed(() => Boolean(day.value?.on_break))
const isClosed = computed(() => Boolean(day.value && !day.value.is_open))

/** Живая добавка с последней загрузки: идёт день — к отработанному, перерыв — к перерыву. */
const sinceLoad = computed(() => (isOpen.value ? Math.max(0, Math.floor((now.value - loadedAt.value) / 60000)) : 0))
const worked = computed(() => (day.value ? day.value.worked_minutes + (onBreak.value ? 0 : sinceLoad.value) : 0))
const breaks = computed(() => (day.value ? day.value.break_minutes + (onBreak.value ? sinceLoad.value : 0) : 0))
const operations = computed(() => (day.value?.operation_minutes ?? 0) + (isOpen.value ? props.liveOperationMinutes : 0))
const downtimes = computed(() => day.value?.downtime_minutes ?? 0)
const other = computed(() => Math.max(0, worked.value - operations.value - downtimes.value))

const status = computed(() => {
  if (!day.value) return { label: 'Не начат', tone: 'neutral' as const }
  if (onBreak.value) return { label: 'Перерыв', tone: 'warning' as const }
  if (isOpen.value) return { label: `Идёт с ${timeHM(day.value.started_at)}`, tone: 'success' as const }
  return { label: `Закончен ${timeHM(day.value.started_at)}–${timeHM(day.value.ended_at)}`, tone: 'neutral' as const }
})

async function act(fn: () => Promise<void>) {
  if (acting.value) return
  acting.value = true
  error.value = null
  try {
    await fn()
    await refresh()
  } catch (e) {
    error.value = navigator.onLine
      ? formatSupabaseError(e) || 'Не удалось сохранить отметку'
      : 'Нет связи — отметка не сохранена. Попробуйте, когда появится интернет.'
  } finally {
    acting.value = false
  }
}

const onStart = () => act(startWorkDay)
const onBreakStart = () => act(startBreak)
const onBreakEnd = () => act(endBreak)

async function onFinish() {
  if (props.busy) return
  const ok = await askConfirm(
    'Закончить рабочий день?',
    `Отработано ${formatWorkMinutes(worked.value)}. Если вернётесь к работе сегодня, день можно продолжить.`,
    'Закончить день',
    false,
  )
  if (ok) await act(finishWorkDay)
}

/** Начать день, если он не идёт (старт операции или простоя). Ошибку не показываем громко — операция важнее. */
async function ensureStarted() {
  if (unavailable.value || !props.userId || isOpen.value) return
  try {
    await startWorkDay()
    await refresh()
  } catch {
    // нет связи — оператор начнёт день сам, когда появится интернет
  }
}

defineExpose({ ensureStarted, refresh })
</script>

<template>
  <section v-if="!unavailable" class="grid gap-4 rounded-xl border bg-card p-4 shadow-xs md:flex md:items-center md:justify-between md:gap-6 md:px-6">
    <div class="grid min-w-0 gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-sm font-medium">Рабочий день</h2>
        <UiBadge :tone="status.tone">{{ status.label }}</UiBadge>
      </div>
      <div v-if="loading" class="text-muted-foreground text-sm">Загрузка…</div>
      <template v-else-if="day">
        <div class="text-2xl font-semibold tabular-nums">{{ formatWorkMinutes(worked) }}</div>
        <div class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums">
          <span>Операции {{ formatWorkMinutes(operations) }}</span>
          <span v-if="downtimes">Простои {{ formatWorkMinutes(downtimes) }}</span>
          <span>Прочее {{ formatWorkMinutes(other) }}</span>
          <span v-if="breaks">Перерыв {{ formatWorkMinutes(breaks) }}</span>
        </div>
      </template>
      <p v-else class="text-muted-foreground text-sm">Отметьте начало дня — время работы посчитается само.</p>
      <p v-if="error" class="text-destructive text-xs" role="alert">{{ error }}</p>
    </div>

    <div class="grid shrink-0 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
      <RouterLink to="/timesheet" class="text-primary px-1 text-sm font-medium hover:underline dark:text-green-400 max-sm:order-last max-sm:text-center">
        Мой табель
      </RouterLink>
      <template v-if="!loading">
        <Button v-if="!day" :disabled="acting" @click="onStart">
          <PlayIcon />
          Начать день
        </Button>
        <template v-else-if="isOpen">
          <Button v-if="onBreak" :disabled="acting" @click="onBreakEnd">
            <PlayIcon />
            Вернуться к работе
          </Button>
          <Button v-else variant="outline" :disabled="acting" @click="onBreakStart">
            <CoffeeIcon />
            Перерыв
          </Button>
          <Button
            variant="outline"
            :disabled="acting || busy"
            :title="busy ? 'Сначала завершите операцию или простой' : undefined"
            @click="onFinish"
          >
            <SquareIcon />
            Закончить день
          </Button>
        </template>
        <Button v-else-if="isClosed" variant="outline" :disabled="acting" @click="onStart">
          <PlayIcon />
          Продолжить день
        </Button>
      </template>
    </div>
    <p v-if="isOpen && busy" class="text-muted-foreground text-xs md:hidden">Закончить день можно после завершения операции или простоя.</p>
  </section>
</template>
