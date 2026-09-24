<script setup lang="ts">
/**
 * Подтверждение действия (в первую очередь удаления) вместо window.confirm —
 * см. ui-navigation-consistency.mdc. Эталон — «Удалить место хранения?»
 * в StorageLocationsPage.
 */
import UiButton from './UiButton.vue'
import UiModal from './UiModal.vue'

withDefaults(
  defineProps<{
    title: string
    text?: string
    confirmLabel?: string
    busyLabel?: string
    busy?: boolean
    danger?: boolean
  }>(),
  {
    text: 'Это действие нельзя отменить.',
    confirmLabel: 'Удалить',
    busyLabel: 'Удаление…',
    busy: false,
    danger: true,
  },
)

defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <UiModal :title="title" :max-width="460" :close-disabled="busy" @close="$emit('cancel')">
    <p class="ui-confirm-text">
      <slot>{{ text }}</slot>
    </p>
    <template #actions>
      <UiButton :disabled="busy" @click="$emit('cancel')">Отмена</UiButton>
      <UiButton :variant="danger ? 'danger' : 'primary'" :disabled="busy" @click="$emit('confirm')">
        {{ busy ? busyLabel : confirmLabel }}
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.ui-confirm-text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.45;
}
</style>
