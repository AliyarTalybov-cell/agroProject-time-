<script setup lang="ts">
/**
 * Панель над реестром: фильтры слева, действия страницы справа — одной линией,
 * все элементы высотой h-9 и с промежутком gap-2 (канон, см. CANON.md).
 * На узком экране действия уходят на свою строку и растягиваются.
 *
 *   <PageToolbar>
 *     <UiSelect … />  <InputGroup … />
 *     <template #actions><Button>Создать</Button></template>
 *   </PageToolbar>
 */
</script>

<template>
  <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <slot />
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-end">
      <slot name="actions" />
    </div>
  </div>
</template>
