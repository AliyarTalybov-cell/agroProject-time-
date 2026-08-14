<script setup lang="ts">
/**
 * Универсальный аватар пользователя: показывает загруженное фото (avatar_url),
 * иначе — инициалы. Класс размера/фона/формы задаётся снаружи и мёржится в корень,
 * поэтому компонент можно ставить вместо существующих кружков с инициалами.
 */
defineProps<{
  url?: string | null
  initials: string
}>()
</script>

<template>
  <span class="user-avatar">
    <img v-if="url" :src="url" alt="" class="user-avatar__img" loading="lazy" />
    <template v-else>{{ initials }}</template>
  </span>
</template>

<style scoped>
.user-avatar {
  overflow: hidden;
}
.user-avatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: inherit;
}
</style>
