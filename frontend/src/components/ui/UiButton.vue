<script setup lang="ts">
/**
 * Кнопка действий в формах и модалках: «Отмена», «Сохранить», «Удалить».
 * Стили — эталон StorageLocationsPage (task-form-cancel / task-form-submit /
 * storage-task-delete-submit).
 */
withDefaults(
  defineProps<{
    variant?: 'secondary' | 'primary' | 'danger'
    type?: 'button' | 'submit'
    disabled?: boolean
  }>(),
  { variant: 'secondary', type: 'button', disabled: false },
)
</script>

<template>
  <button :type="type" class="ui-btn" :class="`ui-btn--${variant}`" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.ui-btn {
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  padding: 0 14px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.ui-btn--secondary {
  background: var(--bg-panel);
  color: var(--text-primary);
}

.ui-btn--primary,
.ui-btn--danger {
  border-color: transparent;
  color: #fff;
}

.ui-btn--primary {
  background: var(--accent-green);
}

.ui-btn--primary:hover:not(:disabled) {
  background: var(--accent-green-hover);
}

.ui-btn--danger {
  background: #b42318;
}

.ui-btn--danger:hover:not(:disabled) {
  background: #9f1f15;
}

.ui-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
