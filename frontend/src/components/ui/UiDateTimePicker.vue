<script setup lang="ts">
/**
 * Дата и время — как пример «Date and Time picker» из shadcn-vue: календарь
 * (UiDatePicker) и рядом поле времени.
 *
 *   <UiDateTimePicker v-model="form.docDate" />
 *
 * v-model — строка 'ГГГГ-ММ-ДДTЧЧ:ММ' (как value у <input type="datetime-local">),
 * поэтому замена нативного поля не меняет данные формы.
 */
import { computed } from 'vue'
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

function setTime(e: Event) {
  const t = (e.target as HTMLInputElement).value
  if (!datePart.value || !t) return
  emit('update:modelValue', `${datePart.value}T${t}`)
}
</script>

<template>
  <div class="ui-datetime">
    <UiDatePicker :model-value="datePart" :disabled="disabled" :clearable="false" class="ui-datetime-date" @update:model-value="setDate" />
    <input
      type="time"
      class="ui-form-input ui-datetime-time"
      :value="timePart"
      :disabled="disabled || !datePart"
      aria-label="Время"
      @change="setTime"
    />
  </div>
</template>
