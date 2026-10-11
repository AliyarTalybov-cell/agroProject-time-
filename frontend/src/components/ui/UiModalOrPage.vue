<script setup lang="ts">
/**
 * Одна и та же карточка — окном (UiModal) или отдельной страницей на весь экран.
 * Содержимое и кнопки передаются одинаково (слоты по умолчанию и `actions`),
 * поэтому разметку карточки не нужно дублировать. В режиме страницы сверху —
 * ссылка «назад», заголовок и подпись, снизу — те же кнопки, что в подвале окна.
 */
import { ArrowLeftIcon } from '@lucide/vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import UiModal from '@/components/ui/UiModal.vue'

withDefaults(
  defineProps<{
    asPage: boolean
    title: string
    description?: string
    maxWidth?: number
    /** Куда ведёт «назад» в режиме страницы. */
    backTo?: RouteLocationRaw
    backLabel?: string
    /** Заголовок в режиме страницы (в шапке сайта он уже есть — обычно не нужен). */
    pageTitle?: string
  }>(),
  { description: undefined, maxWidth: 940, backTo: undefined, backLabel: 'Назад', pageTitle: undefined },
)
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <UiModal v-if="!asPage" :title="title" :description="description" :max-width="maxWidth" @close="emit('close')">
    <template v-if="$slots['header-actions']" #header-actions><slot name="header-actions" /></template>
    <slot />
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </UiModal>

  <article v-else class="tw-scope flex min-w-0 flex-col gap-6 rounded-xl border bg-card p-4 shadow-xs md:p-6">
    <header class="flex flex-col gap-3">
      <RouterLink
        v-if="backTo"
        :to="backTo"
        class="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground no-underline hover:text-foreground"
      >
        <ArrowLeftIcon class="size-4" />
        {{ backLabel }}
      </RouterLink>
      <div v-if="pageTitle || description" class="grid gap-1">
        <h1 v-if="pageTitle" class="text-lg font-semibold">{{ pageTitle }}</h1>
        <p v-if="description" class="text-sm text-muted-foreground">{{ description }}</p>
      </div>
    </header>
    <slot />
    <footer v-if="$slots.actions" class="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end md:pt-6">
      <slot name="actions" />
    </footer>
  </article>
</template>
