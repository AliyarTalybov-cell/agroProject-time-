<script setup lang="ts">
/**
 * Окно добавления и правки записи севооборота. Разметка перенесена из
 * LandsPage без изменений, включая классы с префиксом lands-: стили к ним
 * приходят из landsModal.css.
 *
 * Форма передаётся объектом и правится на месте. Так было и на странице:
 * `cropRotationForm` — единственный ref, поля которого связаны через v-model.
 * Разбирать его на два десятка пропсов с обратными событиями значило бы
 * переписать форму, а не вынести её.
 */
// Общие стили раздела: подключаются импортом, а не <style src>, — так файл
// попадает в сборку одной копией, а не отдельной на каждый компонент.
import './landsShared.css'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
import type { CropRotationFieldOption, CropRotationForm } from '@/components/lands/types'
import type { CropRow } from '@/lib/landTypesAndCrops'

const props = defineProps<{
  open: boolean
  form: CropRotationForm
  /** Поля, закреплённые за текущим участком. */
  assignedFields: CropRotationFieldOption[]
  cropRotationTypeOptions: string[]
  crops: CropRow[]
  /** Идентификатор правимой записи: от него зависит подпись кнопки. */
  editingId: string | null
  saving: boolean
}>()

defineEmits<{
  (e: 'save'): void
  (e: 'close'): void
}>()

/** Кнопку сохранения держим выключенной, пока не заполнены обязательные поля. */
function canSave(): boolean {
  const f = props.form
  return Boolean(f.fieldId && f.season && f.rotationType && f.cropKey) && !props.saving
}
</script>

<template>
  <div
    v-if="open"
    class="lands-modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Добавление записи севооборота"
    @click.self="$emit('close')"
  >
    <div class="lands-modal lands-modal--compact lands-modal--success">
      <div class="lands-modal-head">
        <h2>Добавить запись севооборота</h2>
        <ModalCloseButton @click="$emit('close')" />
      </div>
      <div class="lands-modal-body">
        <div class="lands-form-grid">
          <label class="lands-field">
            <span>№ ПОЛЯ ЕФИС ЗСН</span>
            <select v-model="form.fieldId">
              <option value="">— Выберите поле —</option>
              <option v-for="field in assignedFields" :key="field.id" :value="field.id">
                №{{ field.number }} — {{ field.name }}
              </option>
            </select>
          </label>
          <label class="lands-field">
            <span>Площадь, га</span>
            <input :value="form.areaForCropsHa ?? ''" type="number" disabled />
          </label>
        </div>
        <div class="lands-form-grid">
          <label class="lands-field">
            <span>Сезон *</span>
            <input v-model.trim="form.season" type="text" placeholder="Например: 2026" />
          </label>
          <label class="lands-field">
            <span class="lands-label-with-help">
              Тип севооборота *
              <RefFieldHelp
                text="Нет нужного типа севооборота? Добавьте его в"
                :to="{ path: '/lands', query: { tab: 'crop-rotation-refs' } }"
                link-label="Справочники севооборота"
              />
            </span>
            <select v-model="form.rotationType">
              <option value="">— Выберите тип —</option>
              <option v-for="type in cropRotationTypeOptions" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
        </div>
        <label class="lands-field">
          <span class="lands-label-with-help">
            Сельскохозяйственная культура *
            <RefFieldHelp
              text="Нет нужной культуры? Добавьте ее в"
              :to="{ path: '/lands', query: { tab: 'crops-refs' } }"
              link-label="Справочники СХ культур"
            />
          </span>
          <select v-model="form.cropKey">
            <option value="">— Выберите культуру —</option>
            <option v-for="crop in crops" :key="crop.id" :value="crop.key">{{ crop.label }}</option>
          </select>
        </label>
        <label class="lands-field">
          <span>Наименование семян (посадочный материал)</span>
          <textarea v-model.trim="form.seedMaterialName" rows="2" />
        </label>
        <div class="lands-form-grid">
          <label class="lands-field">
            <span>Площадь для выращивания сельхозкультур, га *</span>
            <input v-model.number="form.areaForCropsHa" type="number" min="0" step="0.01" />
          </label>
          <label class="lands-field">
            <span>Площадь с улучшенными характеристиками, га</span>
            <input v-model.number="form.areaWithImprovedProductsHa" type="number" min="0" step="0.01" />
          </label>
        </div>
        <div class="lands-form-grid">
          <label class="lands-field">
            <span>Площадь для органической продукции, га</span>
            <input v-model.number="form.areaForOrganicHa" type="number" min="0" step="0.01" />
          </label>
          <label class="lands-field">
            <span>Площадь для селекции и семеноводства, га</span>
            <input v-model.number="form.areaForSelectionSeedHa" type="number" min="0" step="0.01" />
          </label>
        </div>
        <label class="lands-field">
          <span>Сведения о производимой продукции</span>
          <textarea v-model.trim="form.producedProductsInfo" rows="3" />
        </label>
        <label class="lands-field">
          <span>Масса произведенной сельхозкультуры, т</span>
          <input v-model.number="form.producedCropMassTons" type="number" min="0" step="0.01" />
        </label>
      </div>
      <div class="lands-modal-actions">
        <button type="button" class="lands-btn" @click="$emit('close')">Отмена</button>
        <button type="button" class="lands-btn lands-btn--save" :disabled="!canSave()" @click="$emit('save')">
          {{ editingId ? 'Сохранить' : 'Добавить' }}
        </button>
      </div>
    </div>
  </div>
</template>

