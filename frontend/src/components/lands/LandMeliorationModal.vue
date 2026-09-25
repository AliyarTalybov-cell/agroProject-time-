<script setup lang="ts">
import UiDatePicker from '@/components/ui/UiDatePicker.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/**
 * Окно записи мелиорации. Набор полей зависит от вкладки раздела: системы,
 * лесные насаждения или мероприятия — поэтому вкладка приходит пропсом.
 *
 * Разметка перенесена из LandsPage дословно, классы с префиксом lands-
 * сохранены: стили к ним приходят из landsModal.css. Подпись поля считает
 * страница, поэтому `fieldLabel` передаётся функцией — так же, как это
 * работало внутри страницы.
 */
// Общие стили раздела: подключаются импортом, а не <style src>, — так файл
// попадает в сборку одной копией, а не отдельной на каждый компонент.
import './landsShared.css'
import type { MeliorationForm, MeliorationTab } from '@/components/lands/types'
import type { FieldRow } from '@/lib/fieldsSupabase'
import type { LandRightRefRow } from '@/lib/landsSupabase'

defineProps<{
  open: boolean
  form: MeliorationForm
  tab: MeliorationTab
  fieldOptions: FieldRow[]
  /** Подпись поля в списке — считается на странице. */
  fieldLabel: (fieldId: string | null) => string
  types: LandRightRefRow[]
  subtypes: LandRightRefRow[]
  eventTypes: LandRightRefRow[]
  saving: boolean
}>()

defineEmits<{
  (e: 'save'): void
  (e: 'close'): void
}>()
</script>

<template>
<UiModal v-if="open" title="Добавить запись мелиорации" :max-width="560" :close-disabled="saving" @close="$emit('close')">
    <div class="lands-modal-body">
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>№ ПОЛЯ ЕФИС ЗСН</span>
          <UiSelect v-model="form.fieldId" :options="[{ value: '', label: '—' }, ...(fieldOptions).map((field) => ({ value: field.id, label: String(fieldLabel(field.id)) }))]" />
        </label>
        <label v-if="tab === 'systems'" class="lands-field">
          <span class="lands-label-with-help">
            Тип мелиорации
            <RefFieldHelp
              text="Нет нужного типа мелиорации? Добавьте его в"
              :to="{ path: '/lands', query: { tab: 'melioration-refs' } }"
              link-label="Справочники мелиорации"
            />
          </span>
          <UiSelect v-model="form.meliorationType" :options="[{ value: '', label: '—' }, ...(types).map((row) => ({ value: row.name, label: String(row.name) }))]" />
        </label>
        <label v-else-if="tab === 'forest'" class="lands-field">
          <span>Год создания</span>
          <input v-model.number="form.forestYearCreated" type="number" min="1900" step="1" />
        </label>
        <label v-else class="lands-field">
          <span class="lands-label-with-help">
            Тип мероприятия
            <RefFieldHelp
              text="Нет нужного типа мероприятия? Добавьте его в"
              :to="{ path: '/lands', query: { tab: 'melioration-refs' } }"
              link-label="Типы мероприятий"
            />
          </span>
          <UiSelect v-model="form.eventType" :options="[{ value: '', label: '—' }, ...(eventTypes).map((row) => ({ value: row.name, label: String(row.name) }))]" />
        </label>
      </div>
      <div v-if="tab === 'systems'" class="lands-form-grid lands-form-grid--mel">
        <label class="lands-field">
          <span class="lands-label-with-help">
            Вид мелиорации
            <RefFieldHelp
              text="Нет нужного вида мелиорации? Добавьте его в"
              :to="{ path: '/lands', query: { tab: 'melioration-refs' } }"
              link-label="Справочники мелиорации"
            />
          </span>
          <UiSelect v-model="form.meliorationSubtype" :options="[{ value: '', label: '—' }, ...(subtypes).map((row) => ({ value: row.name, label: String(row.name) }))]" />
        </label>
        <label class="lands-field">
          <span>Кадастровый номер земельного участка</span>
          <input v-model.trim="form.cadastralNumber" type="text" />
        </label>
      </div>
      <div v-if="tab === 'systems'" class="lands-form-grid lands-form-grid--mel">
        <label class="lands-field">
          <span>Дата ввода в эксплуатацию</span>
          <UiDatePicker v-model="form.commissionedAt" />
        </label>
        <label class="lands-field">
          <span>Площадь орошаемых (осушаемых) земель, га</span>
          <input v-model.number="form.areaHa" type="number" min="0" step="0.01" />
        </label>
      </div>
      <label v-if="tab === 'systems'" class="lands-field">
        <span>Описание мелиоративной системы и местоположения</span>
        <input v-model.trim="form.descriptionLocation" type="text" />
      </label>

      <div v-if="tab === 'forest'" class="lands-form-grid lands-form-grid--mel">
        <label class="lands-field">
          <span>Площадь МЗЛН, га</span>
          <input v-model.number="form.areaHa" type="number" min="0" step="0.01" />
        </label>
        <label class="lands-field">
          <span>Кадастровый номер земельного участка</span>
          <input v-model.trim="form.cadastralNumber" type="text" />
        </label>
      </div>
      <label v-if="tab === 'forest'" class="lands-field">
        <span>Количественные, качественные характеристики</span>
        <input v-model.trim="form.forestCharacteristics" type="text" />
      </label>
      <label v-if="tab === 'forest'" class="lands-field">
        <span>Информация о реконструкции насаждений</span>
        <input v-model.trim="form.reconstructionInfo" type="text" />
      </label>

      <div v-if="tab === 'events'" class="lands-form-grid lands-form-grid--mel">
        <label class="lands-field">
          <span>Дата проведения</span>
          <UiDatePicker v-model="form.eventDate" />
        </label>
        <label class="lands-field">
          <span>Площадь земельного участка, га</span>
          <input v-model.number="form.areaHa" type="number" min="0" step="0.01" />
        </label>
      </div>
      <label v-if="tab === 'events'" class="lands-field">
        <span>Согласование проектов мелиорации</span>
        <input v-model.trim="form.projectApproval" type="text" />
      </label>
    </div>
  <template #actions>
      <UiButton :disabled="saving" @click="$emit('close')">Отмена</UiButton>
      <UiButton variant="primary" :disabled="saving || !form.fieldId" @click="$emit('save')">
        {{ saving ? 'Сохранение...' : 'Сохранить' }}
      </UiButton>
  </template>
</UiModal>
</template>

