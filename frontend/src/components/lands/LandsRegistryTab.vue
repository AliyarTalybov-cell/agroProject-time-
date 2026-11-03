<script setup lang="ts">
/**
 * Вкладка «Реестр земель»: поиск, экспорт и таблица участков.
 *
 * Разметка перенесена из LandsPage дословно, корневого элемента нет —
 * фрагмент повторяет прежний DOM. Данные — пропсами, действия — событиями,
 * запросы к базе остаются на странице.
 */
import './landsShared.css'

import { FileSpreadsheetIcon, FileTextIcon, PlusIcon } from '@lucide/vue'
import UiPagination from '@/components/ui/UiPagination.vue'
import { Button } from '@/components/ui/shadcn/button'
import { Input } from '@/components/ui/shadcn/input'
import type { LandRow } from '@/lib/landsSupabase'

defineProps<{
  items: LandRow[]
  search: string
  selectedId: string | null
  page: number
  pageSize: number
  total: number
  efisNumber: (land: LandRow) => string
  formatHa: (v: number | string | null | undefined) => string
}>()

defineEmits<{
  (e: 'update:search', value: string): void
  (e: 'update:page', page: number): void
  (e: 'update:page-size', size: number): void
  (e: 'export-pdf'): void
  (e: 'export-excel'): void
  (e: 'create'): void
  (e: 'open', id: string): void
}>()
</script>

<template>
          <div class="lands-table-top">
            <h2 class="sr-only">Реестр земель</h2>
            <div class="lands-table-tools">
              <Input :model-value="search" @update:model-value="(v) => $emit('update:search', String(v ?? '').trim())" class="lands-search" type="text" placeholder="Поиск по адресу или кадастровому номеру" />
              <div class="tw-scope flex flex-wrap items-center gap-2">
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
                  Новая земля
                </Button>
              </div>
            </div>
          </div>
          <div class="lands-table-wrap">
            <table class="lands-table" v-card-table>
              <thead>
                <tr>
                  <th>Кадастровый номер</th>
                  <th>№ поля ЕФИС ЗСН</th>
                  <th>Адрес</th>
                  <th>Категория земли</th>
                  <th>Площадь, га</th>
                  <th>Вид разрешенного использования</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="land in items"
                  :key="land.id"
                  class="lands-list-row"
                  :class="{ 'is-active': land.id === selectedId }"
                  @click="$emit('open', land.id)"
                >
                  <td class="lands-list-title-main">{{ land.cadastral_number || '—' }}</td>
                  <td>{{ efisNumber(land) }}</td>
                  <td>{{ land.address || '—' }}</td>
                  <td>{{ land.land_category || '—' }}</td>
                  <td>{{ formatHa(land.area || 0) }}</td>
                  <td>{{ land.permitted_use_docs || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!items.length && search.trim()" class="lands-muted">По вашему запросу ничего не найдено.</p>
          <p v-else-if="!items.length" class="lands-muted">Пока нет созданных земель.</p>

          <UiPagination v-if="total > 0" :page="page" :page-size="pageSize" :total="total" :page-size-options="[10, 25, 50]" @update:page="(p) => $emit('update:page', p)" @update:page-size="(n) => $emit('update:page-size', n)" />
</template>
