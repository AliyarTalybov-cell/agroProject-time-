<script setup lang="ts">
/**
 * Небольшое модальное окно раздела земель: заголовок, одна строка текста и
 * кнопки. Заменяет четыре одинаковых по устройству диалога, которые лежали в
 * LandsPage: подтверждение удаления файла у права владения, то же у
 * землепользователя, подтверждение удаления записи справочника и сообщение
 * «Готово».
 *
 * Разметка перенесена без изменений, поэтому у окна остались классы с
 * префиксом lands-: стили к ним приходят из landsModal.css.
 */
import ModalCloseButton from '@/components/ModalCloseButton.vue'

withDefaults(
  defineProps<{
    open: boolean
    /** Подпись окна для программ чтения с экрана. Не ariaLabel: такое имя
     *  компилятор Vue принял бы за обычный aria-атрибут, а не за пропс. */
    dialogLabel: string
    title: string
    text: string
    confirmLabel: string
    /** Блокирует обе кнопки и крестик на время запроса. */
    busy?: boolean
    /** Диалог «Готово» обходится одной кнопкой — тогда false. */
    cancellable?: boolean
    /** Оформление подтверждающей кнопки: красная для удаления, зелёная для остального. */
    confirmVariant?: 'danger' | 'save'
  }>(),
  { busy: false, cancellable: true, confirmVariant: 'danger' },
)

defineEmits<{
  (e: 'confirm'): void
  (e: 'close'): void
}>()
</script>

<template>
  <div
    v-if="open"
    class="lands-modal-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="dialogLabel"
    @click.self="$emit('close')"
  >
    <div class="lands-modal lands-modal--compact">
      <div class="lands-modal-head">
        <h2>{{ title }}</h2>
        <ModalCloseButton :disabled="busy" @click="$emit('close')" />
      </div>
      <div class="lands-modal-body">
        <p class="lands-confirm-text">{{ text }}</p>
      </div>
      <div class="lands-modal-actions">
        <button v-if="cancellable" type="button" class="lands-btn" :disabled="busy" @click="$emit('close')">Отмена</button>
        <button
          type="button"
          class="lands-btn"
          :class="confirmVariant === 'danger' ? 'lands-btn--danger' : 'lands-btn--save'"
          :disabled="busy"
          @click="$emit('confirm')"
        >{{ confirmLabel }}</button>
      </div>
    </div>
  </div>
</template>

<!-- Без scoped: те же правила нужны и странице, и остальным окнам раздела. -->
<style src="./landsModal.css"></style>
