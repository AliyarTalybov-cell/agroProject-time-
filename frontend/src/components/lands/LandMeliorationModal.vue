<script setup lang="ts">
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
import ModalCloseButton from '@/components/ModalCloseButton.vue'
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
<div v-if="open" class="lands-modal-backdrop" role="dialog" aria-modal="true" aria-label="Мелиорация" @click.self="$emit('close')">
  <div class="lands-modal lands-modal--compact">
    <div class="lands-modal-head">
      <h2>Добавить запись мелиорации</h2>
      <ModalCloseButton :disabled="saving" @click="$emit('close')" />
    </div>
    <div class="lands-modal-body">
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>№ ПОЛЯ ЕФИС ЗСН</span>
          <select v-model="form.fieldId">
            <option value="">—</option>
            <option v-for="field in fieldOptions" :key="field.id" :value="field.id">
              {{ fieldLabel(field.id) }}
            </option>
          </select>
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
          <select v-model="form.meliorationType">
            <option value="">—</option>
            <option v-for="row in types" :key="row.id" :value="row.name">
              {{ row.name }}
            </option>
          </select>
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
          <select v-model="form.eventType">
            <option value="">—</option>
            <option v-for="row in eventTypes" :key="row.id" :value="row.name">
              {{ row.name }}
            </option>
          </select>
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
          <select v-model="form.meliorationSubtype">
            <option value="">—</option>
            <option v-for="row in subtypes" :key="row.id" :value="row.name">
              {{ row.name }}
            </option>
          </select>
        </label>
        <label class="lands-field">
          <span>Кадастровый номер земельного участка</span>
          <input v-model.trim="form.cadastralNumber" type="text" />
        </label>
      </div>
      <div v-if="tab === 'systems'" class="lands-form-grid lands-form-grid--mel">
        <label class="lands-field">
          <span>Дата ввода в эксплуатацию</span>
          <input v-model="form.commissionedAt" type="date" />
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
          <input v-model="form.eventDate" type="date" />
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
    <div class="lands-modal-actions">
      <button type="button" class="lands-btn" :disabled="saving" @click="$emit('close')">Отмена</button>
      <button type="button" class="lands-btn lands-btn--save" :disabled="saving || !form.fieldId" @click="$emit('save')">
        {{ saving ? 'Сохранение...' : 'Сохранить' }}
      </button>
    </div>
  </div>
</div>
</template>

