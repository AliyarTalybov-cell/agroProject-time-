<script setup lang="ts">
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
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  </button>
</template>
