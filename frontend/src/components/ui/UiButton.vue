<script setup lang="ts">
/**
 * Кнопка действий в формах и окнах: «Отмена», «Сохранить», «Удалить».
 * Это Button из shadcn-vue: secondary → outline, primary → default, danger → destructive.
 */
import { Button } from '@/components/ui/shadcn/button'

const props = withDefaults(
  defineProps<{
    variant?: 'secondary' | 'primary' | 'danger' | 'ghost'
    type?: 'button' | 'submit'
    disabled?: boolean
    size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm'
  }>(),
  { variant: 'secondary', type: 'button', disabled: false, size: 'default' },
)

const variantMap = { secondary: 'outline', primary: 'default', danger: 'destructive', ghost: 'ghost' } as const
</script>

<template>
  <Button :type="props.type" :variant="variantMap[props.variant]" :size="props.size" :disabled="props.disabled">
    <slot />
  </Button>
</template>
