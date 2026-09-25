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
// Общие стили раздела: подключаются импортом, а не <style src>, — так файл
// попадает в сборку одной копией, а не отдельной на каждый компонент.
import './landsShared.css'

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
  <UiModal v-if="open" :title="title" :max-width="560" :close-disabled="busy" @close="$emit('close')">
      <div class="lands-modal-body">
        <p class="lands-confirm-text">{{ text }}</p>
      </div>
    <template #actions>
        <UiButton v-if="cancellable" :disabled="busy" @click="$emit('close')">Отмена</UiButton>
        <UiButton :variant="confirmVariant === 'danger' ? 'danger' : 'primary'" :disabled="busy" @click="$emit('confirm')">{{ confirmLabel }}</UiButton>
    </template>
  </UiModal>
</template>

