<script setup lang="ts">
/**
 * Вкладка «Землепользователи» карточки участка.
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
import type { LandUserRow } from '@/lib/landsSupabase'

defineProps<{
  items: LandUserRow[]
  /** Форматирование числовой метрики — считается на странице. */
  formatMetric: (value: number | null | undefined, fractionDigits?: number) => string
}>()

defineEmits<{
  (e: 'create'): void
  (e: 'edit', user: LandUserRow): void
  (e: 'remove', id: string): void
}>()
</script>

<template>
        <h2>Землепользователи</h2>
        <div class="lands-actions lands-actions--crop">
          <button type="button" class="lands-btn lands-btn--save lands-btn--add" @click="$emit('create')">
            Добавить
          </button>
        </div>
        <div v-if="items.length" class="lands-list-plain">
          <div v-for="user in items" :key="user.id" class="lands-list-plain-item lands-list-plain-item--stack">
            <div class="lands-right-card-main">
              <div class="lands-right-metric-row">
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Наименование</span>
                  <span class="lands-right-metric-value">{{ user.holder_name || user.organization_name || user.person_name || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">ИНН</span>
                  <span class="lands-right-metric-value">{{ user.holder_inn || user.inn || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">КПП</span>
                  <span class="lands-right-metric-value">{{ user.holder_kpp || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">ОГРН</span>
                  <span class="lands-right-metric-value">{{ user.holder_ogrn || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Вид права</span>
                  <span class="lands-right-metric-value">{{ user.right_type || user.basis || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Тип документа</span>
                  <span class="lands-right-metric-value">{{ user.document_type || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Начало</span>
                  <span class="lands-right-metric-value">{{ user.starts_at || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Окончание</span>
                  <span class="lands-right-metric-value">{{ user.ends_at || '—' }}</span>
                </div>
                <div class="lands-right-metric">
                  <span class="lands-right-metric-label">Площадь использования, га</span>
                  <span class="lands-right-metric-value">{{ formatMetric(user.usage_area_ha) }}</span>
                </div>
              </div>
            </div>
            <div class="lands-item-actions">
              <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="$emit('edit', user)">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              </button>
              <UiDeleteButton size="sm" @click="$emit('remove', user.id)" />
            </div>
          </div>
        </div>
        <p v-else class="lands-muted">Землепользователи пока не заполнены.</p>
</template>
