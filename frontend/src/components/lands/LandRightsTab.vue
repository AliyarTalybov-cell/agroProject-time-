<script setup lang="ts">
import { FileSpreadsheetIcon, FileTextIcon, PencilIcon } from '@lucide/vue'
/**
 * Вкладка «Права владения» карточки участка.
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
import type { LandRightRow } from '@/lib/landsSupabase'

defineProps<{
  items: LandRightRow[]
  exportRows: string[][]
}>()

defineEmits<{
  (e: 'export-pdf'): void
  (e: 'export-excel'): void
  (e: 'create'): void
  (e: 'edit', right: LandRightRow): void
  (e: 'remove', id: string): void
}>()
</script>

<template>
        <div class="lands-section-head">
          <h2>Права владения</h2>
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
          <div v-for="right in items" :key="right.id" class="lands-list-plain-item lands-list-plain-item--stack">
            <div class="lands-right-card-main">
              <div class="lands-right-metric-row">
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Наименование</span>
                  <span class="lands-right-metric-value lands-right-metric-value--nowrap">{{ right.holder_name || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">ИНН</span>
                  <span class="lands-right-metric-value">{{ right.holder_inn || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">КПП</span>
                  <span class="lands-right-metric-value">{{ right.holder_kpp || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">ОГРН</span>
                  <span class="lands-right-metric-value">{{ right.holder_ogrn || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Кадастровый номер</span>
                  <span class="lands-right-metric-value lands-right-metric-value--nowrap">{{ right.cadastral_number || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Форма собственности</span>
                  <span class="lands-right-metric-value lands-right-metric-value--nowrap">{{ right.ownership_form || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Вид права</span>
                  <span class="lands-right-metric-value lands-right-metric-value--nowrap">{{ right.right_type || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Начало</span>
                  <span class="lands-right-metric-value">{{ right.starts_at || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Окончание</span>
                  <span class="lands-right-metric-value">{{ right.ends_at || '—' }}</span>
                </div>
              </div>
            </div>
            <div class="lands-item-actions">
              <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="$emit('edit', right)">
                <PencilIcon :size="18" />
              </button>
              <UiDeleteButton size="sm" @click="$emit('remove', right.id)" />
            </div>
          </div>
        </div>
        <p v-else class="lands-muted">Права владения пока не заполнены.</p>
</template>
