<script setup lang="ts" generic="T">
/**
 * Выпадающий список — Select из shadcn-vue.
 *
 *   <UiSelect v-model="cropKey" :options="[{ value: '', label: 'Все культуры' }, ...]" />
 *
 * Значения опций — любые (строка, число, null, ''): внутри Select получает номер
 * опции, наружу уходит исходное значение, поэтому замена нативного <select>
 * не меняет тип v-model. Событие `change` — как у нативного select, после выбора.
 */
import { computed, getCurrentInstance, ref, watch } from 'vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select'

export interface UiSelectOption<V> {
  value: V
  label: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: T
    options: UiSelectOption<T>[]
    placeholder?: string
    disabled?: boolean
    size?: 'default' | 'sm'
    ariaLabel?: string
    /** Растянуть кнопку на всю ширину контейнера. */
    block?: boolean
  }>(),
  { placeholder: 'Выберите', disabled: false, size: 'default', ariaLabel: undefined, block: false },
)

defineOptions({ inheritAttrs: false })

// Атрибут scoped-стилей страницы, где стоит компонент: кнопка получает его, как
// получил бы нативный select, и стили страницы по её классу продолжают действовать.
const parentScope = getCurrentInstance()?.vnode.scopeId
const scopeAttrs = parentScope ? { [parentScope]: '' } : {}

const emit = defineEmits<{ 'update:modelValue': [value: T]; change: [value: T] }>()

/** Сравнение как у v-model нативного select (looseEqual во Vue): '5' и 5 — одно значение. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  if (typeof a === 'object' || typeof b === 'object') return false
  return String(a) === String(b)
}

const selectedIndex = computed(() => {
  const i = props.options.findIndex((o) => sameValue(o.value, props.modelValue))
  return i >= 0 ? String(i) : undefined
})

// Пока список открыт, Reka блокирует клики по странице (pointer-events: none на
// body); если после закрытия блокировка осталась — снимаем её.
const open = ref(false)
watch(open, (isOpen) => {
  if (isOpen) return
  setTimeout(() => {
    if (!document.querySelector('[data-reka-popper-content-wrapper], [role="dialog"][data-state="open"]') && document.body.style.pointerEvents === 'none') {
      document.body.style.pointerEvents = ''
    }
  }, 250)
})

function onSelect(key: unknown) {
  const opt = props.options[Number(key)]
  if (!opt) return
  emit('update:modelValue', opt.value)
  emit('change', opt.value)
}
</script>

<template>
  <Select v-model:open="open" :model-value="selectedIndex" :disabled="disabled" @update:model-value="onSelect">
    <SelectTrigger
      v-bind="{ ...$attrs, ...scopeAttrs }"
      :size="size"
      :class="{ 'w-full': block }"
      :aria-label="ariaLabel"
    >
      <SelectValue :placeholder="placeholder" />
    </SelectTrigger>
    <SelectContent position="popper" class="max-h-80">
      <SelectItem v-for="(o, i) in options" :key="i" :value="String(i)" :disabled="o.disabled">
        {{ o.label }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
