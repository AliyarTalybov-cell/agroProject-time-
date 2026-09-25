<script setup lang="ts">
/**
 * Дата и время — пример «Date and Time picker» из shadcn-vue: Date Picker и
 * рядом Input type="time".
 *
 *   <UiDateTimePicker v-model="form.docDate" />
 *
 * v-model — строка 'ГГГГ-ММ-ДДTЧЧ:ММ' (как value у <input type="datetime-local">).
 */
import { computed } from 'vue'
import { Input } from '@/components/ui/shadcn/input'
import UiDatePicker from './UiDatePicker.vue'

const props = withDefaults(
  defineProps<{ modelValue: string | null | undefined; disabled?: boolean }>(),
  { disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const datePart = computed(() => (props.modelValue ?? '').slice(0, 10))
const timePart = computed(() => (props.modelValue ?? '').slice(11, 16))

function setDate(d: string) {
  if (!d) return emit('update:modelValue', '')
  emit('update:modelValue', `${d}T${timePart.value || '00:00'}`)
}

function setTime(v: string | number) {
  const t = String(v)
  if (!datePart.value || !t) return
  emit('update:modelValue', `${datePart.value}T${t}`)
}
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
    <UiDatePicker :model-value="datePart" :disabled="disabled" :clearable="false" block @update:model-value="setDate" />
    <Input
      type="time"
      :model-value="timePart"
      :disabled="disabled || !datePart"
      aria-label="Время"
      class="appearance-none bg-background tabular-nums [&::-webkit-calendar-picker-indicator]:hidden"
      @update:model-value="setTime"
    />
  </div>
</template>
