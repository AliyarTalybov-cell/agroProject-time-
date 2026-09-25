<script setup lang="ts">
/**
 * Индикатор загрузки — Spinner из shadcn-vue (Loader2 с вращением) и,
 * если нужен, подпись приглушённым текстом. API прежний: size и label.
 */
import { computed } from 'vue'
import { Spinner } from '@/components/ui/shadcn/spinner'

const props = withDefaults(
  defineProps<{
    size?: 'full' | 'md' | 'compact' | 'micro'
    /** Подпись рядом со спиннером */
    label?: string
    /** Без подписи (кнопки, мини-индикаторы) */
    hideLabel?: boolean
  }>(),
  {
    size: 'full',
    label: 'Загрузка',
    hideLabel: false,
  },
)

/** Старые подписи были капсом («ЗАГРУЗКА») — показываем обычным регистром. */
const text = computed(() => {
  const l = props.label.trim()
  const normal = l === l.toUpperCase() ? l.charAt(0) + l.slice(1).toLowerCase() : l
  return normal.endsWith('…') ? normal : `${normal}…`
})

const spinnerClass = computed(() => ({ full: 'size-6', md: 'size-5', compact: 'size-4', micro: 'size-3.5' })[props.size])
const showLabel = computed(() => !props.hideLabel && props.size !== 'micro')
</script>

<template>
  <div
    class="text-muted-foreground inline-flex items-center justify-center gap-2 text-sm"
    :class="size === 'full' ? 'flex-col py-2' : ''"
    role="status"
    aria-live="polite"
  >
    <Spinner :class="spinnerClass" />
    <span v-if="showLabel">{{ text }}</span>
    <span v-else class="sr-only">{{ text }}</span>
  </div>
</template>
