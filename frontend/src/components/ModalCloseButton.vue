<script setup lang="ts">
import { XIcon } from '@lucide/vue'
withDefaults(
  defineProps<{
    disabled?: boolean
    /** Абсолютное позиционирование в углу модалки (сотрудники и т.п.) */
    absolute?: boolean
  }>(),
  { disabled: false, absolute: false },
)

defineEmits<{
  click: []
}>()
</script>

<template>
  <button
    type="button"
    class="modal-close"
    :class="{ 'modal-close--absolute': absolute }"
    aria-label="Закрыть"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <XIcon aria-hidden="true" :size="20" />
  </button>
</template>
