<script setup lang="ts">
withDefaults(
  defineProps<{
    checking?: boolean
  }>(),
  { checking: false },
)

const emit = defineEmits<{
  retry: []
}>()
</script>

<template>
  <div class="db-badge" role="status" aria-live="polite">
    <span class="db-badge__icon" aria-hidden="true">⚠️</span>
    <span class="db-badge__text">Нет связи с БД</span>
    <button
      type="button"
      class="db-badge__retry"
      :class="{ 'db-badge__retry--spin': checking }"
      :disabled="checking"
      aria-label="Повторить подключение"
      @click="emit('retry')"
    >
      ↻
    </button>
  </div>
</template>

<style scoped>
.db-badge {
  position: fixed;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 40px;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 68, 68, 0.3);
  color: #fff;
  font-size: 12px;
  font-family: system-ui, -apple-system, sans-serif;
  z-index: 9999;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}

.db-badge__icon {
  font-size: 14px;
  animation: db-badge-pulse 1s infinite;
}

.db-badge__text {
  white-space: nowrap;
}

.db-badge__retry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 20px;
  background: #ff4444;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.db-badge__retry:hover:not(:disabled) {
  transform: rotate(180deg);
}

.db-badge__retry:disabled {
  cursor: not-allowed;
  opacity: 0.85;
}

.db-badge__retry--spin {
  animation: db-badge-spin 0.8s linear infinite;
}

@keyframes db-badge-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

@keyframes db-badge-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .db-badge__icon,
  .db-badge__retry--spin {
    animation: none;
  }
  .db-badge__retry:hover:not(:disabled) {
    transform: none;
  }
}
</style>
