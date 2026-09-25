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
/* Button shadcn-vue: h-9, rounded-md, px-4, text-sm font-medium; secondary = outline */
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: var(--control-h);
  padding: 0 16px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s ease, box-shadow 0.15s ease;
}

.ui-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--ring);
}

.ui-btn--secondary {
  border-color: var(--input-border);
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-xs);
}

.ui-btn--secondary:hover:not(:disabled) {
  background: var(--muted-bg);
}

.ui-btn--primary,
.ui-btn--danger {
  color: #fff;
}

.ui-btn--primary {
  background: var(--accent-green);
}

.ui-btn--primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-green) 90%, black);
}

.ui-btn--danger {
  background: #dc2626;
}

.ui-btn--danger:hover:not(:disabled) {
  background: #b91c1c;
}

.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
