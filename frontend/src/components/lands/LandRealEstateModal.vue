<script setup lang="ts">
/**
 * Окно объекта недвижимости на участке. Разметка перенесена из LandsPage
 * дословно, классы с префиксом lands- сохранены — стили к ним приходят из
 * landsModal.css.
 *
 * Форма передаётся объектом и правится на месте, как и в окне севооборота.
 */
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import type { CropRotationFieldOption, RealEstateForm } from '@/components/lands/types'

defineProps<{
  open: boolean
  form: RealEstateForm
  /** Поля, закреплённые за текущим участком. */
  assignedFields: CropRotationFieldOption[]
  /** Идентификатор правимого объекта: от него зависят заголовок и подпись кнопки. */
  editingId: string | null
  saving: boolean
}>()

defineEmits<{
  (e: 'save'): void
  (e: 'close'): void
}>()
</script>

<template>
<div v-if="open" class="lands-modal-backdrop" role="dialog" aria-modal="true" aria-label="Объект недвижимости" @click.self="$emit('close')">
  <div class="lands-modal">
    <div class="lands-modal-head">
      <h2>{{ editingId ? 'Редактировать объект недвижимости' : 'Добавить объект недвижимости' }}</h2>
      <ModalCloseButton @click="$emit('close')" />
    </div>
    <div class="lands-modal-body">
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>№ ПОЛЯ ЕФИС ЗСН</span>
          <select v-model="form.fieldId">
            <option value="">—</option>
            <option v-for="field in assignedFields" :key="field.id" :value="field.id">
              №{{ field.number }} — {{ field.name }}
            </option>
          </select>
        </label>
        <label class="lands-field">
          <span>Кадастровый номер *</span>
          <input v-model.trim="form.cadastralNumber" type="text" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Наименование</span>
          <input v-model.trim="form.name" type="text" />
        </label>
        <label class="lands-field">
          <span>Описание местоположения</span>
          <input v-model.trim="form.locationDescription" type="text" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Площадь, кв.м.</span>
          <input v-model.number="form.areaSqm" type="number" min="0" step="0.01" />
        </label>
        <label class="lands-field">
          <span>Вид разрешенного использования</span>
          <input v-model.trim="form.permittedUse" type="text" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Назначение</span>
          <input v-model.trim="form.purpose" type="text" />
        </label>
        <label class="lands-field">
          <span>Адрес</span>
          <input v-model.trim="form.address" type="text" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Глубина, м</span>
          <input v-model.number="form.depthM" type="number" min="0" step="0.01" />
        </label>
        <label class="lands-field">
          <span>Высота, м</span>
          <input v-model.number="form.heightM" type="number" min="0" step="0.01" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Протяженность, м</span>
          <input v-model.number="form.lengthM" type="number" min="0" step="0.01" />
        </label>
        <label class="lands-field">
          <span>Объем, м³</span>
          <input v-model.number="form.volumeM3" type="number" min="0" step="0.01" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Глубина залегания, м</span>
          <input v-model.number="form.burialDepthM" type="number" min="0" step="0.01" />
        </label>
        <label class="lands-field">
          <span>План застройки</span>
          <input v-model.trim="form.developmentPlan" type="text" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Этажность</span>
          <input v-model.trim="form.floors" type="text" />
        </label>
        <label class="lands-field">
          <span>Подземная этажность</span>
          <input v-model.trim="form.undergroundFloors" type="text" />
        </label>
      </div>
    </div>
    <div class="lands-modal-actions">
      <button type="button" class="lands-btn" @click="$emit('close')">Отмена</button>
      <button type="button" class="lands-btn lands-btn--save" :disabled="!form.cadastralNumber.trim() || saving" @click="$emit('save')">
        {{ editingId ? 'Сохранить' : 'Добавить' }}
      </button>
    </div>
  </div>
</div>
</template>

<!-- Без scoped: те же правила нужны и странице, и остальным окнам раздела. -->
<style src="./landsModal.css"></style>
