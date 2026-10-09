<script setup lang="ts">
/**
 * Кнопка действий в формах и окнах: «Отмена», «Сохранить», «Удалить».
 * Это Button из shadcn-vue: secondary → outline, primary → default, danger → destructive.
 * danger-quiet — «Удалить» в подвале окна редактирования: красный текст без
 * заливки (второстепенное действие); заливка — только у кнопки подтверждения.
 */
import { Button } from '@/components/ui/shadcn/button'

const props = withDefaults(
  defineProps<{
    variant?: 'secondary' | 'primary' | 'danger' | 'danger-quiet' | 'ghost'
    type?: 'button' | 'submit'
    disabled?: boolean
    size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm'
  }>(),
  { variant: 'secondary', type: 'button', disabled: false, size: 'default' },
)

const variantMap = { secondary: 'outline', primary: 'default', danger: 'destructive', 'danger-quiet': 'ghost', ghost: 'ghost' } as const
</script>

<template>
  <Button
    :type="props.type"
    :variant="variantMap[props.variant]"
    :size="props.size"
    :disabled="props.disabled"
    :class="props.variant === 'danger-quiet' ? 'text-destructive hover:bg-destructive/10 hover:text-destructive' : undefined"
  >
    <slot />
  </Button>
</template>
