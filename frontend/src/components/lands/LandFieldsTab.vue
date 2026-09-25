<script setup lang="ts">
import { Button } from '@/components/ui/shadcn/button'
import { ExternalLinkIcon, FileSpreadsheetIcon, FileTextIcon, Trash2Icon } from '@lucide/vue'
/**
 * Вкладка «Поля» карточки участка.
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

import type { FieldRow } from '@/lib/fieldsSupabase'

defineProps<{
  items: FieldRow[]
  exportRows: string[][]
  /** Открыт ли встроенный редактор земли: от него зависит кнопка отвязки поля. */
  inlineEditOpen: boolean
  /** Подпись и оформление культуры — считаются на странице. */
  cropLabel: (cropKey: string | null) => string
  cropPillClass: (cropKey: string | null) => string
}>()

defineEmits<{
  (e: 'export-pdf'): void
  (e: 'export-excel'): void
  (e: 'open-field', id: string): void
  (e: 'unlink', id: string): void
}>()
</script>

<template>
        <div class="lands-section-head">
          <h2>Поля земли</h2>
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
        </div>
        <div v-if="items.length" class="lands-table-wrap">
          <table class="lands-table lands-fields-table" v-card-table>
            <thead>
              <tr>
                <th>Название</th>
                <th>№ ПОЛЯ ЕФИС ЗСН</th>
                <th>Площадь, га</th>
                <th>Культура</th>
                <th>Тип земли</th>
                <th>Муниципальное образование</th>
                <th>Регион</th>
                <th>Описание</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="field in items" :key="field.id" class="lands-list-row" @click="$emit('open-field', field.id)">
                <td>
                  <div class="lands-field-cell-title lands-list-title-main">Поле №{{ field.number }} {{ field.name }}</div>
                  <div class="lands-field-cell-subtitle">{{ field.cadastral_number ? `Кад. №: ${field.cadastral_number}` : 'Нет кад. номера' }}</div>
                </td>
                <td>{{ (field as any).efis_zsn_number || '—' }}</td>
                <td>{{ Number(field.area || 0).toFixed(2) }}</td>
                <td>
                  <span :class="cropPillClass(field.crop_key)">
                    {{ cropLabel(field.crop_key) }}
                  </span>
                </td>
                <td>{{ field.land_type || '—' }}</td>
                <td>{{ field.municipality || '—' }}</td>
                <td>{{ field.region || '—' }}</td>
                <td class="lands-field-description">{{ field.location_description || '—' }}</td>
                <td @click.stop>
                  <div class="lands-item-actions">
                    <Button variant="ghost" size="icon-sm" type="button" class="lands-action-btn" aria-label="Открыть поле" title="Открыть поле" @click="$emit('open-field', field.id)">
                      <ExternalLinkIcon :size="17" :stroke-width="2.1" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" v-if="inlineEditOpen" type="button" class="lands-action-btn lands-action-btn--danger text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Отвязать поле" title="Отвязать поле" @click="$emit('unlink', field.id)">
                      <Trash2Icon :size="17" :stroke-width="2.1" />
                    </Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="lands-muted">К этой земле пока не привязаны поля.</p>
</template>
