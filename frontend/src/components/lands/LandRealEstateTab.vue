<script setup lang="ts">
import { FileSpreadsheetIcon, FileTextIcon, PencilIcon } from '@lucide/vue'
/**
 * Вкладка «Объекты недвижимости» карточки участка.
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
import type { LandRealEstateObjectRow } from '@/lib/landsSupabase'

defineProps<{
  items: LandRealEstateObjectRow[]
  exportRows: string[][]
  /** Форматирование метрики и подпись поля — считаются на странице. */
  formatMetric: (value: number | null | undefined, fractionDigits?: number) => string
  fieldLabel: (fieldId: string | null) => string
}>()

defineEmits<{
  (e: 'export-pdf'): void
  (e: 'export-excel'): void
  (e: 'create'): void
  (e: 'edit', obj: LandRealEstateObjectRow): void
  (e: 'remove', id: string): void
}>()
</script>

<template>
        <div class="lands-section-head">
          <h2>Объекты недвижимости</h2>
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
          <div v-for="obj in items" :key="obj.id" class="lands-list-plain-item lands-list-plain-item--stack">
            <div class="lands-re-card-main">
              <div class="lands-re-metric-row">
                <div class="lands-re-metric">
                  <span class="lands-re-metric-label">№ ПОЛЯ ЕФИС ЗСН</span>
                  <span class="lands-re-metric-value lands-re-metric-value--nowrap">{{ fieldLabel(obj.field_id) }}</span>
                </div>
                <div class="lands-re-metric">
                  <span class="lands-re-metric-label">Кадастровый номер *</span>
                  <span class="lands-re-metric-value lands-re-metric-value--nowrap">{{ obj.cadastral_number || '—' }}</span>
                </div>
                <div class="lands-re-metric">
                  <span class="lands-re-metric-label">Наименование</span>
                  <span class="lands-re-metric-value lands-re-metric-value--nowrap">{{ obj.name?.trim() || '—' }}</span>
                </div>
                <div class="lands-re-metric">
                  <span class="lands-re-metric-label">Адрес</span>
                  <span class="lands-re-metric-value lands-re-metric-value--nowrap">{{ obj.address?.trim() || '—' }}</span>
                </div>
                <div class="lands-re-metric">
                  <span class="lands-re-metric-label">Площадь, кв.м.</span>
                  <span class="lands-re-metric-value">{{ formatMetric(obj.area_sqm) }}</span>
                </div>
              </div>
            </div>
            <div class="lands-item-actions">
              <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="$emit('edit', obj)">
                <PencilIcon :size="18" />
              </button>
              <UiDeleteButton size="sm" @click="$emit('remove', obj.id)" />
            </div>
          </div>
        </div>
        <p v-else class="lands-muted">Объекты недвижимости пока не добавлены.</p>
</template>
