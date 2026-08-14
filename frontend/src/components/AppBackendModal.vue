<script setup lang="ts">
import ModalCloseButton from '@/components/ModalCloseButton.vue'

defineProps<{
  message: string
  checking?: boolean
}>()

const emit = defineEmits<{
  retry: []
  close: []
}>()
</script>

<template>
  <div class="backend-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="backend-modal-title">
    <div class="backend-modal">
      <div class="backend-modal__header">
        <div class="backend-modal__icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 9v4" /><path d="M12 17h.01" />
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </div>
        <h2 id="backend-modal-title" class="backend-modal__title">Сервер временно недоступен</h2>
        <ModalCloseButton class="backend-modal__close" @click="emit('close')" />
      </div>
      <p class="backend-modal__text">{{ message }}</p>
      <p class="backend-modal__hint">
        Похоже, база данных сейчас не отвечает. Попробуйте повторить попытку через минуту.
      </p>
      <div class="backend-modal__actions">
        <button type="button" class="backend-modal__retry" :disabled="checking" @click="emit('retry')">
          {{ checking ? 'Проверка…' : 'Повторить' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backend-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
  background: var(--modal-backdrop, rgba(15, 23, 42, 0.55));
  backdrop-filter: blur(2px);
}

.backend-modal {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: var(--bg-elevated, #fff);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: var(--space-xl);
  box-shadow: var(--shadow-card, 0 18px 48px rgba(0, 0, 0, 0.22));
}

.backend-modal__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: var(--space-md);
}

.backend-modal__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 10px;
  color: var(--danger-red, #b91c1c);
  background: color-mix(in srgb, var(--danger-red, #b91c1c) 12%, transparent);
}

.backend-modal__title {
  margin: 0;
  flex: 1;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
}

.backend-modal__close {
  flex-shrink: 0;
}

.backend-modal__text {
  margin: 0 0 8px;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--danger-red, #b91c1c);
}

.backend-modal__hint {
  margin: 0 0 var(--space-lg);
  font-size: 0.85rem;
  line-height: 1.45;
  color: var(--text-secondary);
}

.backend-modal__actions {
  display: flex;
  justify-content: flex-end;
}

.backend-modal__retry {
  height: 40px;
  padding: 0 20px;
  border-radius: 10px;
  border: 1px solid var(--accent-green);
  background: var(--accent-green);
  color: #fff;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.backend-modal__retry:hover:not(:disabled) {
  background: var(--accent-green-hover, #15803d);
  border-color: var(--accent-green-hover, #15803d);
}

.backend-modal__retry:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
