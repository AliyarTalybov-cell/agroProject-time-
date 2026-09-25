<script setup lang="ts">
import UiSelect from '@/components/ui/UiSelect.vue'
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
  <UiModal v-if="open" title="Добавить запись севооборота" :max-width="560" @close="$emit('close')">
      <div class="lands-modal-body">
        <div class="lands-form-grid">
          <label class="lands-field">
            <span>№ ПОЛЯ ЕФИС ЗСН</span>
            <UiSelect v-model="form.fieldId" :options="[{ value: '', label: '— Выберите поле —' }, ...(assignedFields).map((field) => ({ value: field.id, label: `№${field.number} — ${field.name}` }))]" />
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
            <UiSelect v-model="form.rotationType" :options="[{ value: '', label: '— Выберите тип —' }, ...(cropRotationTypeOptions).map((type) => ({ value: type, label: String(type) }))]" />
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
          <UiSelect v-model="form.cropKey" :options="[{ value: '', label: '— Выберите культуру —' }, ...(crops).map((crop) => ({ value: crop.key, label: String(crop.label) }))]" />
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
    <template #actions>
        <UiButton @click="$emit('close')">Отмена</UiButton>
        <UiButton variant="primary" :disabled="!canSave()" @click="$emit('save')">
          {{ editingId ? 'Сохранить' : 'Добавить' }}
        </UiButton>
    </template>
  </UiModal>
</template>

