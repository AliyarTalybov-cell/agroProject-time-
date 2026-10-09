<script setup lang="ts">
/**
 * Поле формы по канону: подпись → контрол → подсказка/счётчик, промежуток gap-2.
 * Справа от подписи можно поставить действие (слот `label-actions`, например
 * «Добавить»), под полем — подсказку `hint` и счётчик `count` / `max`.
 * `wide` — поле во всю ширину сетки FormGrid cols=2. `error` — ошибка поля
 * красным вместо подсказки.
 */
import { Label } from '@/components/ui/shadcn/label'

withDefaults(
  defineProps<{
    label?: string
    for?: string
    hint?: string
    count?: number
    max?: number
    wide?: boolean
    error?: string | false | null
    required?: boolean
  }>(),
  { label: undefined, for: undefined, hint: undefined, count: undefined, max: undefined, wide: false, error: undefined, required: false },
)
</script>

<template>
  <div class="grid min-w-0 content-start gap-2" :class="wide ? 'sm:col-span-full' : ''">
    <div v-if="label || $slots['label-actions']" class="flex min-h-5 items-center justify-between gap-2">
      <Label v-if="label" :for="$props.for">{{ label }}<span v-if="required" class="-ml-1.5 text-destructive" aria-hidden="true">*</span></Label>
      <slot name="label-actions" />
    </div>
    <slot />
    <div v-if="error || hint || max != null" class="flex items-start justify-between gap-2 text-xs text-muted-foreground">
      <span v-if="error" class="text-destructive" role="alert">{{ error }}</span>
      <span v-else>{{ hint }}</span>
      <span v-if="max != null" class="tabular-nums">{{ count ?? 0 }}/{{ max }}</span>
    </div>
  </div>
</template>
