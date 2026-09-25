<script setup lang="ts">
/** Просмотр картинки-документа — Dialog shadcn-vue. */
import UiModal from '@/components/ui/UiModal.vue'

defineProps<{ name: string; url: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <UiModal :title="name" :max-width="960" @close="emit('close')">
    <div class="bg-muted flex items-center justify-center overflow-hidden rounded-lg">
      <img :src="url" :alt="name" class="max-h-[70dvh] w-auto max-w-full object-contain" />
    </div>
  </UiModal>
</template>
