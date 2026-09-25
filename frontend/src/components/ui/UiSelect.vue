<script setup lang="ts" generic="T">
/**
 * Выпадающий список — Select из shadcn-vue на Reka UI: кнопка h-9 с шевроном,
 * всплывающий список с галочкой у выбранного, управление с клавиатуры.
 *
 *   <UiSelect v-model="cropKey" :options="[{ value: '', label: 'Все культуры' }, ...]" />
 *
 * Значения опций — любые (строка, число, null, ''): внутри Reka получает номер
 * опции, наружу уходит исходное значение, поэтому замена нативного <select>
 * не меняет тип v-model. Событие `change` — как у нативного select, после выбора.
 */
import { computed, getCurrentInstance, ref, watch } from 'vue'
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'

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
    /** sm — h-8, как SelectTrigger size="sm". */
    size?: 'default' | 'sm'
    ariaLabel?: string
    /** Растянуть кнопку на всю ширину контейнера (поля формы). */
    block?: boolean
  }>(),
  { placeholder: 'Выберите', disabled: false, size: 'default', ariaLabel: undefined, block: false },
)

defineOptions({ inheritAttrs: false })

// Атрибут scoped-стилей страницы, где стоит компонент: кнопка получает его, как
// получил бы нативный select/input, и стили страницы по её классу продолжают
// действовать (ширина в форме, отступы). Корень компонента — без обёртки, поэтому
// Vue сам его не проставляет.
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
// body). Бывает, что после закрытия блокировка остаётся — и страница перестаёт
// реагировать на клики. Снимаем её сами, если других всплывающих окон нет.
const open = ref(false)
watch(open, (isOpen) => {
  if (isOpen) return
  setTimeout(() => {
    if (!document.querySelector('[data-reka-popper-content-wrapper]') && document.body.style.pointerEvents === 'none') {
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
  <SelectRoot v-model:open="open" :model-value="selectedIndex" :disabled="disabled" @update:model-value="onSelect">
    <SelectTrigger
      v-bind="{ ...$attrs, ...scopeAttrs }"
      class="ui-select-trigger"
      :class="{ 'ui-select-trigger--sm': size === 'sm', 'ui-select-trigger--block': block }"
      :aria-label="ariaLabel"
    >
      <SelectValue class="ui-select-value" :placeholder="placeholder" />
      <SelectIcon as-child>
        <svg class="ui-select-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="ui-popover ui-select-content" position="popper" :side-offset="4">
        <SelectViewport class="ui-select-viewport">
          <SelectItem
            v-for="(o, i) in options"
            :key="i"
            :value="String(i)"
            :disabled="o.disabled"
            class="ui-select-item"
          >
            <SelectItemText>{{ o.label }}</SelectItemText>
            <span class="ui-select-item-check">
              <SelectItemIndicator>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
              </SelectItemIndicator>
            </span>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
