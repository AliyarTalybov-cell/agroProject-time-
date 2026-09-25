<script setup lang="ts">
/**
 * Кнопка удаления в строках и карточках — Button shadcn-vue (ghost, иконка
 * Trash2), красная при наведении, со всплывающей подсказкой (Tooltip).
 * API прежний: size, loading, disabled, событие click.
 */
import { computed } from 'vue'
import { Trash2Icon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import { Spinner } from '@/components/ui/shadcn/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/shadcn/tooltip'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    loading?: boolean
    ariaLabel?: string
    size?: 'xs' | 'sm' | 'md' | 'lg'
    /** @deprecated не используется */
    wide?: boolean
  }>(),
  {
    ariaLabel: 'Удалить',
    size: 'sm',
    wide: false,
  },
)

const emit = defineEmits<{ click: [e: MouseEvent] }>()

const btnSize = computed(() => ({ xs: 'icon-xs', sm: 'icon-sm', md: 'icon', lg: 'icon-lg' } as const)[props.size])
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          :size="btnSize"
          class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          :disabled="disabled || loading"
          :aria-label="loading ? 'Удаление…' : ariaLabel"
          @click="(e: MouseEvent) => emit('click', e)"
        >
          <Spinner v-if="loading" />
          <Trash2Icon v-else />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ ariaLabel }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
