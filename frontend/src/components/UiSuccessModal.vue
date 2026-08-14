<script setup lang="ts">
defineProps<{
  open: boolean
  title?: string
  message?: string
  buttonText?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

function close() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ui-success-backdrop" @click.self="close">
      <div class="ui-success-modal" role="dialog" aria-modal="true" @click.stop>
        <div class="success-modal-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" />
            <path d="M7 12.5l3.1 3.1L17 8.8" />
          </svg>
        </div>
        <h3 class="success-modal-title">{{ title || 'Операция выполнена' }}</h3>
        <p class="success-modal-message">{{ message || 'Данные успешно сохранены.' }}</p>
        <button type="button" class="success-modal-btn" @click="close">
          {{ buttonText || 'Понятно' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ui-success-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--modal-backdrop);
  animation: uiSuccessBackdropIn 0.2s ease-out;
}

.ui-success-modal {
  width: min(92vw, 460px);
  border-radius: 18px;
  padding: 26px 24px 22px;
  text-align: center;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-card);
  animation: uiSuccessModalIn 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

.success-modal-icon {
  width: 62px;
  height: 62px;
  margin: 0 auto 14px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent-green) 16%, transparent);
  display: grid;
  place-items: center;
}

.success-modal-icon svg {
  width: 34px;
  height: 34px;
  stroke: var(--accent-green);
  stroke-width: 1.9;
}

.success-modal-title {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 800;
  color: var(--text-primary);
}

.success-modal-message {
  margin: 10px 0 0;
  color: var(--text-secondary);
  line-height: 1.45;
  font-size: 0.98rem;
}

.success-modal-btn {
  margin-top: 18px;
  min-width: 140px;
  height: 42px;
  border-radius: 12px;
  border: 1px solid var(--accent-green);
  background: var(--accent-green);
  color: #fff;
  font-weight: 700;
  font-size: 0.95rem;
  cursor: pointer;
}

.success-modal-btn:hover {
  background: var(--accent-green-hover);
  border-color: var(--accent-green-hover);
}

@keyframes uiSuccessBackdropIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes uiSuccessModalIn {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-success-backdrop,
  .ui-success-modal {
    animation: none !important;
  }
}
</style>
