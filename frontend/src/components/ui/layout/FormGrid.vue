<script setup lang="ts">
/**
 * Сетка полей формы и окна: промежуток gap-4 между полями (канон),
 * cols=2 — две колонки от sm, на телефоне всегда одна.
 * Поле во всю ширину — <FormField wide>.
 */
withDefaults(defineProps<{ cols?: 1 | 2 }>(), { cols: 1 })
</script>

<template>
  <div class="grid gap-4" :class="cols === 2 ? 'sm:grid-cols-2' : ''">
    <slot />
  </div>
</template>
