<script setup lang="ts">
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
                <svg class="lands-export-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M12 18v-6" />
                  <path d="M9 15h6" />
                </svg>
                PDF
              </button>
              <button type="button" class="lands-export-btn action_has has_saved" :disabled="!exportRows.length" title="Экспорт в Excel" @click="$emit('export-excel')">
                <svg class="lands-export-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M8 13h2" />
                  <path d="M8 17h2" />
                  <path d="M14 13h2" />
                  <path d="M14 17h2" />
                </svg>
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
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              </button>
              <UiDeleteButton size="sm" @click="$emit('remove', obj.id)" />
            </div>
          </div>
        </div>
        <p v-else class="lands-muted">Объекты недвижимости пока не добавлены.</p>
</template>
