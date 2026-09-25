<script setup lang="ts">
import UiSelect from '@/components/ui/UiSelect.vue'
/**
 * Окно объекта недвижимости на участке. Разметка перенесена из LandsPage
 * дословно, классы с префиксом lands- сохранены — стили к ним приходят из
 * landsModal.css.
 *
 * Форма передаётся объектом и правится на месте, как и в окне севооборота.
 */
// Общие стили раздела: подключаются импортом, а не <style src>, — так файл
// попадает в сборку одной копией, а не отдельной на каждый компонент.
import './landsShared.css'
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
<UiModal v-if="open" :title="editingId ? 'Редактировать объект недвижимости' : 'Добавить объект недвижимости'" :max-width="1100" @close="$emit('close')">
    <div class="lands-modal-body">
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>№ ПОЛЯ ЕФИС ЗСН</span>
          <UiSelect v-model="form.fieldId" :options="[{ value: '', label: '—' }, ...(assignedFields).map((field) => ({ value: field.id, label: `№${field.number} — ${field.name}` }))]" />
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
  <template #actions>
      <UiButton @click="$emit('close')">Отмена</UiButton>
      <UiButton variant="primary" :disabled="!form.cadastralNumber.trim() || saving" @click="$emit('save')">
        {{ editingId ? 'Сохранить' : 'Добавить' }}
      </UiButton>
  </template>
</UiModal>
</template>

