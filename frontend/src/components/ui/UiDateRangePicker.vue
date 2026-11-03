<script setup lang="ts">
/**
 * Выбор периода — Range Calendar из shadcn-vue во всплывающем Popover и
 * быстрые варианты слева («Эта неделя», «Этот месяц»…).
 *
 *   <UiDateRangePicker v-model:from="from" v-model:to="to" />
 *
 * from / to — строки 'ГГГГ-ММ-ДД'. Период применяется, когда выбраны оба
 * конца; одна дата вторым кликом по ней же — период из одного дня.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { type DateValue, parseDate } from '@internationalized/date'
import type { DateRange } from 'reka-ui'
import { CalendarIcon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover'
import { RangeCalendar } from '@/components/ui/shadcn/range-calendar'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    from: string
    to: string
    /** Не позже этой даты (например, сегодня). */
    max?: string
    block?: boolean
  }>(),
  { max: undefined, block: false },
)

const emit = defineEmits<{ 'update:from': [v: string]; 'update:to': [v: string]; change: [from: string, to: string] }>()

const open = ref(false)

const toValue = (s: string | undefined): DateValue | undefined => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  try {
    return parseDate(s)
  } catch {
    return undefined
  }
}

const draft = shallowRef<DateRange>({ start: toValue(props.from), end: toValue(props.to) })
watch(open, (v) => {
  if (v) draft.value = { start: toValue(props.from), end: toValue(props.to) }
})

const ru = (s: string) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '')
const label = computed(() => (props.from === props.to ? ru(props.from) : `${ru(props.from)} – ${ru(props.to)}`))

function apply(from: string, to: string) {
  emit('update:from', from)
  emit('update:to', to)
  emit('change', from, to)
  open.value = false
}

function onRange(v: DateRange) {
  draft.value = v
  if (v.start && v.end) apply(v.start.toString(), v.end.toString())
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const presets = computed(() => {
  const t = new Date()
  const today = ymd(t)
  const monday = new Date(t)
  monday.setDate(t.getDate() - ((t.getDay() + 6) % 7))
  const prevMonday = new Date(monday)
  prevMonday.setDate(monday.getDate() - 7)
  const prevSunday = new Date(monday)
  prevSunday.setDate(monday.getDate() - 1)
  const monthStart = new Date(t.getFullYear(), t.getMonth(), 1)
  const prevMonthStart = new Date(t.getFullYear(), t.getMonth() - 1, 1)
  const prevMonthEnd = new Date(t.getFullYear(), t.getMonth(), 0)
  return [
    { label: 'Сегодня', from: today, to: today },
    { label: 'Эта неделя', from: ymd(monday), to: today },
    { label: 'Прошлая неделя', from: ymd(prevMonday), to: ymd(prevSunday) },
    { label: 'Этот месяц', from: ymd(monthStart), to: today },
    { label: 'Прошлый месяц', from: ymd(prevMonthStart), to: ymd(prevMonthEnd) },
  ]
})

const isActive = (p: { from: string; to: string }) => p.from === props.from && p.to === props.to
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="outline" :class="cn('justify-start text-left font-normal tabular-nums', block && 'w-full')" aria-label="Период">
        <CalendarIcon class="opacity-60" />
        <span class="truncate">{{ label }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="tw-scope w-auto p-0" align="start">
      <div class="flex flex-col sm:flex-row">
        <ul class="flex flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
          <li v-for="p in presets" :key="p.label">
            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-start"
              :class="isActive(p) ? 'bg-accent text-accent-foreground' : ''"
              @click="apply(p.from, p.to)"
            >
              {{ p.label }}
            </Button>
          </li>
        </ul>
        <RangeCalendar
          :model-value="draft"
          :max-value="toValue(max)"
          :default-placeholder="draft.start"
          locale="ru"
          :week-starts-on="1"
          weekday-format="short"
          initial-focus
          @update:model-value="onRange"
        />
      </div>
      <p class="text-muted-foreground border-t px-3 py-2 text-xs">Выберите начало и конец периода. Один день — дважды нажмите на дату.</p>
    </PopoverContent>
  </Popover>
</template>
