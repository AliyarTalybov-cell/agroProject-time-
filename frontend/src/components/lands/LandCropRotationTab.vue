<script setup lang="ts">
import { FileSpreadsheetIcon, FileTextIcon, PencilIcon } from '@lucide/vue'
/**
 * Вкладка «Севооборот» карточки участка.
 *
 * Разметка перенесена из LandsPage дословно. Своего корневого элемента у
 * компонента намеренно нет: фрагмент повторяет прежнюю структуру DOM, а
 * лишняя обёртка сдвинула бы вёрстку.
 *
 * Данные приходят пропсами, действия уходят событиями — запросы к базе
 * остаются на странице, рядом с остальными.
 */
// Общие стили раздела: подключаются импортом, а не <style src>, — так файл
// попадает в сборку одной копией, а не отдельной на каждый компонент.
import './landsShared.css'

import UiDeleteButton from '@/components/UiDeleteButton.vue'
import type { LandCropRotationRow } from '@/lib/landsSupabase'
import type { FieldRow } from '@/lib/fieldsSupabase'

defineProps<{
  items: LandCropRotationRow[]
  exportRows: string[][]
  cropLabelMap: Map<string, string>
  fieldMap: Map<string, FieldRow>
  /** Форматирование метрики и подпись поля — считаются на странице. */
  formatMetric: (value: number | null | undefined, fractionDigits?: number) => string
  fieldLabel: (fieldId: string | null) => string
}>()

defineEmits<{
  (e: 'export-pdf'): void
  (e: 'export-excel'): void
  (e: 'create'): void
  (e: 'edit', rotation: LandCropRotationRow): void
  (e: 'remove', id: string): void
}>()
</script>

<template>
        <div class="lands-section-head">
          <h2>Севооборот</h2>
          <div class="lands-section-actions">
            <div class="lands-export-btns">
              <button type="button" class="lands-export-btn action_has has_saved" :disabled="!exportRows.length" title="Экспорт в PDF" @click="$emit('export-pdf')">
                <FileTextIcon class="lands-export-icon" />
                PDF
              </button>
              <button type="button" class="lands-export-btn action_has has_saved" :disabled="!exportRows.length" title="Экспорт в Excel" @click="$emit('export-excel')">
                <FileSpreadsheetIcon class="lands-export-icon" />
                Excel
              </button>
            </div>
            <button type="button" class="lands-btn lands-btn--save lands-btn--add" @click="$emit('create')">
              Добавить
            </button>
          </div>
        </div>
        <div v-if="items.length" class="lands-list-plain">
          <div v-for="rotation in items" :key="rotation.id" class="lands-list-plain-item lands-list-plain-item--stack">
            <div class="lands-crop-rotation-card-main">
              <div class="lands-crop-rotation-metric-row">
                <div class="lands-crop-rotation-metric">
                  <span class="lands-crop-rotation-metric-label">№ ПОЛЯ ЕФИС ЗСН</span>
                  <span class="lands-crop-rotation-metric-value lands-crop-rotation-metric-value--nowrap">{{ fieldLabel(rotation.field_id) }}</span>
                </div>
                <div class="lands-crop-rotation-metric">
                  <span class="lands-crop-rotation-metric-label">Сезон</span>
                  <span class="lands-crop-rotation-metric-value">{{ rotation.season || '—' }}</span>
                </div>
                <div class="lands-crop-rotation-metric">
                  <span class="lands-crop-rotation-metric-label">Тип</span>
                  <span class="lands-crop-rotation-metric-value">{{ rotation.rotation_type || '—' }}</span>
                </div>
                <div class="lands-crop-rotation-metric">
                  <span class="lands-crop-rotation-metric-label">Культура</span>
                  <span class="lands-crop-rotation-metric-value">{{ cropLabelMap.get(rotation.crop_key || '') || '—' }}</span>
                </div>
                <div class="lands-crop-rotation-metric">
                  <span class="lands-crop-rotation-metric-label">Площадь, га</span>
                  <span class="lands-crop-rotation-metric-value">{{ formatMetric(fieldMap.get(rotation.field_id)?.area) }}</span>
                </div>
                <div class="lands-crop-rotation-metric">
                  <span class="lands-crop-rotation-metric-label">Площадь для выращивания сельхозкультур, га *</span>
                  <span class="lands-crop-rotation-metric-value">{{ formatMetric(rotation.area_for_crops_ha) }}</span>
                </div>
                <div class="lands-crop-rotation-metric">
                  <span class="lands-crop-rotation-metric-label">Масса произведенной сельхозкультуры, т</span>
                  <span class="lands-crop-rotation-metric-value">{{ formatMetric(rotation.produced_crop_mass_tons) }}</span>
                </div>
              </div>
            </div>
            <div class="lands-item-actions">
              <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="$emit('edit', rotation)">
                <PencilIcon :size="18" />
              </button>
              <UiDeleteButton size="sm" @click="$emit('remove', rotation.id)" />
            </div>
          </div>
        </div>
</template>
