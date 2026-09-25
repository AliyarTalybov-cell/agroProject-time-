<script setup lang="ts">
/**
 * Выбор даты — Date Picker из shadcn-vue: кнопка (Button outline) с иконкой
 * календаря и Calendar во всплывающем Popover. Русская локаль, неделя с
 * понедельника, месяц и год выбираются списками (layout="month-and-year").
 *
 *   <UiDatePicker v-model="form.date" />
 *
 * v-model — строка 'ГГГГ-ММ-ДД' или '' (как value у <input type="date">).
 */
import { computed, getCurrentInstance, ref } from 'vue'
import { type DateValue, parseDate } from '@internationalized/date'
import { CalendarIcon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import { Calendar } from '@/components/ui/shadcn/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    modelValue: string | null | undefined
    placeholder?: string
    disabled?: boolean
    /** Кнопка «Очистить» под календарём. */
    clearable?: boolean
    min?: string
    max?: string
    ariaLabel?: string
    block?: boolean
  }>(),
  { placeholder: 'Выберите дату', disabled: false, clearable: true, min: undefined, max: undefined, ariaLabel: undefined, block: false },
)

defineOptions({ inheritAttrs: false })

const parentScope = getCurrentInstance()?.vnode.scopeId
const scopeAttrs = parentScope ? { [parentScope]: '' } : {}

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

const label = computed(() => {
  const v = value.value
  if (!v) return ''
  return `${String(v.day).padStart(2, '0')}.${String(v.month).padStart(2, '0')}.${v.year}`
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
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        v-bind="{ ...$attrs, ...scopeAttrs }"
        variant="outline"
        :disabled="disabled"
        :aria-label="ariaLabel || placeholder"
        :class="cn('justify-start text-left font-normal', block && 'w-full', !label && 'text-muted-foreground')"
      >
        <CalendarIcon class="opacity-60" />
        <span class="truncate">{{ label || placeholder }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-0" align="start">
      <Calendar
        :model-value="value"
        :default-placeholder="value"
        :min-value="minValue"
        :max-value="maxValue"
        locale="ru"
        :week-starts-on="1"
        weekday-format="short"
        layout="month-and-year"
        initial-focus
        @update:model-value="onPick"
      />
      <div v-if="clearable && label" class="flex justify-end border-t p-2">
        <Button variant="ghost" size="sm" @click="clear">Очистить</Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
