<script setup lang="ts">
/**
 * Бейдж статуса / приоритета / культуры — Badge shadcn с тоном.
 * Тона мягкие (заливка 10%, рамка 20%), в тёмной теме читаются так же.
 *   neutral — нет акцента, info — в работе, warning — внимание,
 *   success — готово / есть, danger — просрочено / высокий, primary — наш зелёный.
 */
import { Badge } from '@/components/ui/shadcn/badge'

export type UiBadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'primary'

withDefaults(defineProps<{ tone?: UiBadgeTone }>(), { tone: 'neutral' })

const tones: Record<UiBadgeTone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  info: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  warning: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  danger: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300',
  primary: 'border-primary/20 bg-primary/10 text-primary dark:text-emerald-300',
}
</script>

<template>
  <Badge variant="outline" :class="tones[tone]">
    <slot />
  </Badge>
</template>
