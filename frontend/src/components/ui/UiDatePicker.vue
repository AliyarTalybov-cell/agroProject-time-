<script setup lang="ts">
/**
 * Выбор даты — Date Picker из shadcn-vue на Reka UI: кнопка как поле ввода с
 * иконкой календаря, по клику — календарь во всплывающем окне (Popover + Calendar),
 * русская локаль, неделя с понедельника, месяц и год выбираются списками.
 *
 *   <UiDatePicker v-model="form.date" />
 *
 * v-model — строка 'ГГГГ-ММ-ДД' или '' (как value у <input type="date">),
 * поэтому замена нативного поля не меняет данные формы.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { type DateValue, parseDate, today, getLocalTimeZone } from '@internationalized/date'
import {
  CalendarCell,
  CalendarCellTrigger,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHead,
  CalendarGridRow,
  CalendarHeadCell,
  CalendarHeader,
  CalendarNext,
  CalendarPrev,
  CalendarRoot,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'

const props = withDefaults(
  defineProps<{
    modelValue: string | null | undefined
    placeholder?: string
    disabled?: boolean
    /** Можно ли очистить дату (кнопка «Очистить» под календарём). */
    clearable?: boolean
    min?: string
    max?: string
    ariaLabel?: string
    block?: boolean
  }>(),
  { placeholder: 'Выберите дату', disabled: false, clearable: true, min: undefined, max: undefined, ariaLabel: undefined, block: false },
)

defineOptions({ inheritAttrs: false })

const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string] }>()

const open = ref(false)

function toDateValue(s: string | null | undefined): DateValue | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined
  try {
    return parseDate(s.slice(0, 10))
  } catch {
    return undefined
  }
}

const value = computed(() => toDateValue(props.modelValue))
const minValue = computed(() => toDateValue(props.min))
const maxValue = computed(() => toDateValue(props.max))

// Какой месяц показан в календаре — отдельно от выбранной даты.
const placeholderDate = shallowRef<DateValue>(value.value ?? today(getLocalTimeZone()))
watch(open, (o) => {
  if (o) placeholderDate.value = value.value ?? today(getLocalTimeZone())
})

const label = computed(() => {
  const v = value.value
  if (!v) return ''
  return `${String(v.day).padStart(2, '0')}.${String(v.month).padStart(2, '0')}.${v.year}`
})

const monthNames = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(new Date(2000, i, 1)),
).map((m) => m.charAt(0).toUpperCase() + m.slice(1))

const years = computed(() => {
  const cur = today(getLocalTimeZone()).year
  const from = Math.min(minValue.value?.year ?? cur - 30, placeholderDate.value.year, value.value?.year ?? cur)
  const to = Math.max(maxValue.value?.year ?? cur + 10, placeholderDate.value.year, value.value?.year ?? cur)
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
})

function onPick(v: DateValue | undefined) {
  if (!v) return
  const s = v.toString()
  emit('update:modelValue', s)
  emit('change', s)
  open.value = false
}

function clear() {
  emit('update:modelValue', '')
  emit('change', '')
  open.value = false
}

function setMonth(e: Event) {
  placeholderDate.value = placeholderDate.value.set({ month: Number((e.target as HTMLSelectElement).value) })
}

function setYear(e: Event) {
  placeholderDate.value = placeholderDate.value.set({ year: Number((e.target as HTMLSelectElement).value) })
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      v-bind="$attrs"
      type="button"
      class="ui-date-trigger"
      :class="{ 'ui-date-trigger--block': block, 'is-empty': !label }"
      :disabled="disabled"
      :aria-label="ariaLabel || placeholder"
    >
      <svg class="ui-date-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
      <span class="ui-date-label">{{ label || placeholder }}</span>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="ui-popover ui-date-content" align="start" :side-offset="4">
        <CalendarRoot
          v-slot="{ grid, weekDays }"
          v-model:placeholder="placeholderDate"
          :model-value="value"
          :min-value="minValue"
          :max-value="maxValue"
          locale="ru"
          :week-starts-on="1"
          weekday-format="short"
          fixed-weeks
          class="ui-calendar"
          @update:model-value="onPick"
        >
          <CalendarHeader class="ui-calendar-header">
            <CalendarPrev class="ui-calendar-nav" aria-label="Предыдущий месяц">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </CalendarPrev>
            <div class="ui-calendar-selects">
              <select class="ui-calendar-select" :value="placeholderDate.month" aria-label="Месяц" @change="setMonth">
                <option v-for="(m, i) in monthNames" :key="m" :value="i + 1">{{ m }}</option>
              </select>
              <select class="ui-calendar-select" :value="placeholderDate.year" aria-label="Год" @change="setYear">
                <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
              </select>
            </div>
            <CalendarNext class="ui-calendar-nav" aria-label="Следующий месяц">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </CalendarNext>
          </CalendarHeader>
          <CalendarGrid v-for="month in grid" :key="month.value.toString()" class="ui-calendar-grid">
            <CalendarGridHead>
              <CalendarGridRow class="ui-calendar-row">
                <CalendarHeadCell v-for="day in weekDays" :key="day" class="ui-calendar-head-cell">{{ day }}</CalendarHeadCell>
              </CalendarGridRow>
            </CalendarGridHead>
            <CalendarGridBody>
              <CalendarGridRow v-for="(week, wi) in month.rows" :key="`w-${wi}`" class="ui-calendar-row">
                <CalendarCell v-for="d in week" :key="d.toString()" :date="d" class="ui-calendar-cell">
                  <CalendarCellTrigger :day="d" :month="month.value" class="ui-calendar-day" />
                </CalendarCell>
              </CalendarGridRow>
            </CalendarGridBody>
          </CalendarGrid>
        </CalendarRoot>
        <div v-if="clearable && label" class="ui-date-footer">
          <button type="button" class="ui-date-clear" @click="clear">Очистить</button>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
