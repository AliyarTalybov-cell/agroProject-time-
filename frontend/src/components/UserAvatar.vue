<script setup lang="ts">
/**
 * Аватар пользователя — Avatar из shadcn-vue: фото (avatar_url), пока оно
 * грузится или если его нет — инициалы. Размер и цвет фона задаются снаружи
 * классом/стилем, как раньше; форма по умолчанию — круг.
 */
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar'

defineProps<{
  url?: string | null
  initials: string
}>()
</script>

<template>
  <Avatar class="user-avatar items-center justify-center">
    <AvatarImage v-if="url" :src="url" alt="" class="object-cover" />
    <AvatarFallback class="bg-transparent text-inherit" :delay-ms="url ? 400 : undefined">{{ initials }}</AvatarFallback>
  </Avatar>
</template>
