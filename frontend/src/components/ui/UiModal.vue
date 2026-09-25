<script setup lang="ts">
/**
 * Модальное окно проекта: подложка, шапка с заголовком и крестиком, тело,
 * нижние кнопки. Разметка и стили — эталон «Место хранения»
 * (StorageLocationsPage), крестик — ModalCloseButton по modal-close-button.mdc.
 * Тёмная тема и анимация открытия приходят из styles/modal.css по классам
 * modal-backdrop / modal.
 *
 * Показывать через v-if у родителя: окно закрывается по крестику, по клику на
 * подложку и по Esc — во всех случаях эмитит `close`, решать закрыть ли
 * (например, пока идёт сохранение) остаётся родителю.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'

const props = withDefaults(
  defineProps<{
    title: string
    /** Ширина окна, px (на узком экране — во всю ширину минус поля). 560 — форма, 460 — подтверждение. */
    maxWidth?: number
    /** Блокирует закрытие (крестик, подложка, Esc) — например, во время сохранения. */
    closeDisabled?: boolean
  }>(),
  { maxWidth: 560, closeDisabled: false },
)

const emit = defineEmits<{ close: [] }>()

function requestClose() {
  if (!props.closeDisabled) emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') requestClose()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="modal-backdrop" role="dialog" aria-modal="true" :aria-label="title" @click.self="requestClose">
    <div class="modal" :style="{ width: `min(calc(100vw - 48px), ${maxWidth}px)` }">
      <div class="modal-header">
        <h2 class="modal-title">{{ title }}</h2>
        <ModalCloseButton :disabled="closeDisabled" @click="requestClose" />
      </div>
      <div class="modal-body">
        <slot />
      </div>
      <div v-if="$slots.actions" class="modal-actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Dialog shadcn-vue: rounded-lg, border, shadow-lg, p-6, заголовок text-lg semibold,
   кнопки справа с зазором 8px. Шапка и низ остаются на месте при прокрутке тела. */
.modal-backdrop {
  z-index: 1000;
  padding: 24px;
}

.modal {
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  overflow: hidden;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding: 20px 24px 0;
}

.modal-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary);
}

.modal-body {
  padding: 16px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--border-color);
}

@media (max-width: 640px) {
  .modal-backdrop {
    padding: 16px;
  }

  .modal-header {
    padding: 16px 16px 0;
  }

  .modal-body {
    padding: 12px 16px 16px;
  }

  .modal-actions {
    padding: 12px 16px 16px;
  }
}
</style>
