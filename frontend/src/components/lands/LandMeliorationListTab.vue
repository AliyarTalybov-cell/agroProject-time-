<script setup lang="ts">
/**
 * Раздел «Мелиорация»: три подвкладки (системы, лесные насаждения,
 * мероприятия), экспорт и таблица записей.
 *
 * Разметка перенесена из LandsPage дословно, корневого элемента нет.
 * Данные — пропсами, действия — событиями, запросы к базе — на странице.
 */
import './landsShared.css'

import { FileSpreadsheetIcon, FileTextIcon, PencilIcon, PlusIcon } from '@lucide/vue'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import UiPagination from '@/components/ui/UiPagination.vue'
import { Button } from '@/components/ui/shadcn/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import type { LandMeliorationEntryRow } from '@/lib/landsSupabase'

export type MeliorationTabId = 'systems' | 'forest' | 'events'

const MELIORATION_TABS = [
  { id: 'systems', label: 'Мелиоративные системы, расположенные на земельном участке', short: 'Системы' },
  { id: 'forest', label: 'Мелиоративные защитные лесные насаждения', short: 'Защитные лесные насаждения' },
  { id: 'events', label: 'Мелиоративные мероприятия', short: 'Мероприятия' },
] as const

defineProps<{
  tab: MeliorationTabId
  items: LandMeliorationEntryRow[]
  loading: boolean
  page: number
  pageSize: number
  total: number
  fieldLabel: (fieldId: string | null) => string
  formatDate: (value: string | null | undefined) => string
  formatMetric: (value: number | null | undefined, fractionDigits?: number) => string
}>()

defineEmits<{
  (e: 'update:tab', tab: MeliorationTabId): void
  (e: 'update:page', page: number): void
  (e: 'update:page-size', size: number): void
  (e: 'export-pdf'): void
  (e: 'export-excel'): void
  (e: 'create'): void
  (e: 'edit', entry: LandMeliorationEntryRow): void
  (e: 'remove', id: string): void
}>()
</script>

<template>
          <div class="tw-scope flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
            <Tabs :model-value="tab" class="min-w-0">
              <TabsList class="h-auto max-w-full flex-wrap justify-start">
                <TabsTrigger v-for="t in MELIORATION_TABS" :key="t.id" :value="t.id" class="flex-none" :title="t.label" @click="$emit('update:tab', t.id)">
                  {{ t.short }}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div class="flex flex-wrap items-center gap-2">
              <Button variant="outline" type="button" :disabled="!items.length" @click="$emit('export-pdf')">
                <FileTextIcon />
                PDF
              </Button>
              <Button variant="outline" type="button" :disabled="!items.length" @click="$emit('export-excel')">
                <FileSpreadsheetIcon />
                Excel
              </Button>
              <Button type="button" @click="$emit('create')">
                <PlusIcon />
                Добавить
              </Button>
            </div>
          </div>
          <div class="lands-table-wrap lands-table-wrap--melioration">
            <table class="lands-table" v-card-table>
              <thead>
                <tr v-if="tab === 'systems'">
                  <th>№ поля ЕФИС ЗСН</th>
                  <th>Тип мелиорации</th>
                  <th>Вид мелиорации</th>
                  <th>Описание системы и местоположения</th>
                  <th>Кадастровый номер земельного участка</th>
                  <th>Дата ввода в эксплуатацию</th>
                  <th>Площадь орошаемых (осушаемых) земель, га</th>
                  <th>Действия</th>
                </tr>
                <tr v-else-if="tab === 'forest'">
                  <th>№ поля ЕФИС ЗСН</th>
                  <th>Площадь МЗЛН, га</th>
                  <th>Количественные, качественные характеристики</th>
                  <th>Год создания</th>
                  <th>Информация о реконструкции насаждений</th>
                  <th>Кадастровый номер земельного участка</th>
                  <th>Действия</th>
                </tr>
                <tr v-else>
                  <th>№ поля ЕФИС ЗСН</th>
                  <th>Тип мероприятия</th>
                  <th>Дата проведения</th>
                  <th>Площадь земельного участка, га</th>
                  <th>Согласование проектов мелиорации</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in items" :key="entry.id" :class="{ 'lands-mel-row': true }">
                  <td>{{ fieldLabel(entry.field_id) }}</td>
                  <template v-if="tab === 'systems'">
                    <td>{{ entry.melioration_type || '—' }}</td>
                    <td>{{ entry.melioration_subtype || '—' }}</td>
                    <td>{{ entry.description_location || '—' }}</td>
                    <td>{{ entry.cadastral_number || '—' }}</td>
                    <td>{{ formatDate(entry.commissioned_at) }}</td>
                    <td>{{ formatMetric(entry.irrigated_area_ha ?? entry.area_ha) }}</td>
                  </template>
                  <template v-else-if="tab === 'forest'">
                    <td>{{ formatMetric(entry.forest_area_ha ?? entry.area_ha) }}</td>
                    <td>{{ entry.forest_characteristics || '—' }}</td>
                    <td>{{ entry.forest_year_created ?? '—' }}</td>
                    <td>{{ entry.reconstruction_info || '—' }}</td>
                    <td>{{ entry.cadastral_number || '—' }}</td>
                  </template>
                  <template v-else>
                    <td>{{ entry.event_type || '—' }}</td>
                    <td>{{ formatDate(entry.event_date) }}</td>
                    <td>{{ formatMetric(entry.area_ha) }}</td>
                    <td>{{ entry.project_approval || '—' }}</td>
                  </template>
                  <td @click.stop>
                    <div class="lands-item-actions">
                      <Button variant="ghost" size="icon-sm" type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="$emit('edit', entry)">
                        <PencilIcon :size="17" :stroke-width="2.1" />
                      </Button>
                      <UiDeleteButton size="sm" @click="$emit('remove', entry.id)" />
                    </div>
                  </td>
                </tr>
                <tr v-if="!items.length && !loading">
                  <td :colspan="tab === 'systems' ? 8 : tab === 'forest' ? 7 : 6" class="lands-muted lands-melioration-empty">нет данных для отображения</td>
                </tr>
              </tbody>
            </table>
          </div>
          <UiPagination v-if="total > 0" :page="page" :page-size="pageSize" :total="total" :page-size-options="[10, 25, 50]" @update:page="(p) => $emit('update:page', p)" @update:page-size="(n) => $emit('update:page-size', n)" />
</template>
