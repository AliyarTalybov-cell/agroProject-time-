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
.modal-backdrop {
  z-index: 1000;
  padding: 24px;
}

.modal {
  max-height: 90vh;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
  overscroll-behavior: contain;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-color);
}

.modal-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.modal-body {
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
}
</style>
