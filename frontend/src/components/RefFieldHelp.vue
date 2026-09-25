<script setup lang="ts">
/**
 * Подсказка «?» у поля: откуда берутся значения и где их добавить.
 * Popover из shadcn-vue — открывается по клику (работает и на телефоне),
 * внутри текст и ссылка на раздел справочников.
 */
import type { RouteLocationRaw } from 'vue-router'
import { ArrowRightIcon, CircleHelpIcon } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover'

withDefaults(
  defineProps<{
    text: string
    to: RouteLocationRaw
    linkLabel?: string
  }>(),
  {
    linkLabel: 'Открыть раздел',
  },
)
</script>

<template>
  <Popover>
    <PopoverTrigger
      type="button"
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle outline-none focus-visible:ring-3"
      aria-label="Подсказка: где добавить значения"
      @click.stop
    >
      <CircleHelpIcon class="size-4" />
    </PopoverTrigger>
    <PopoverContent class="tw-scope w-72 text-sm" align="start" @click.stop>
      <p class="text-muted-foreground leading-snug font-normal normal-case">{{ text }}</p>
      <RouterLink :to="to" class="text-primary mt-2 inline-flex items-center gap-1 text-sm font-medium hover:underline">
        {{ linkLabel }}
        <ArrowRightIcon class="size-3.5" />
      </RouterLink>
    </PopoverContent>
  </Popover>
</template>
