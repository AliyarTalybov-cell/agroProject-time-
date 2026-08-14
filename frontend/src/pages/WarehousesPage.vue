<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import WarehouseTransferModal from '@/components/WarehouseTransferModal.vue'
import { isSupabaseConfigured } from '@/lib/supabase'
import { loadStorageLocationsPage, storageLocationCropLabel, storageLocationFillStatusCode, storageLocationFillStatusName, storageLocationMarksInactive, storageLocationTypeName, type StorageLocationRow } from '@/lib/storageLocationsSupabase'
import { loadStorageFillStatuses, type StorageFillStatusRow } from '@/lib/storageRefsSupabase'
import { loadCrops, type CropRow } from '@/lib/landTypesAndCrops'
import { loadStorageLocationSummaries, type StorageLocationSummary } from '@/lib/storageTransfersSupabase'
import {
  fillBatchStateFromCode,
  placeholderWarehouseMetrics,
  type BatchFillState,
  type WarehouseCardMetrics,
} from '@/lib/warehouseCardMetrics'

type StatusFilter = 'all' | string

const loading = ref(false)
const error = ref<string | null>(null)
const router = useRouter()
const search = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

const statusFilter = ref<StatusFilter>('all')
/** all | __none__ (нет crop_key) | ключ из справочника crops */
const cropFilter = ref<'all' | '__none__' | string>('all')

const fillStatusOptions = ref<StorageFillStatusRow[]>([])
const cropOptions = ref<CropRow[]>([])

const page = ref(1)
const pageSize = ref(8)
const placesTotal = ref(0)

const places = ref<StorageLocationRow[]>([])
const summaries = ref<Record<string, StorageLocationSummary>>({})

const transferModalOpen = ref(false)
const transferFromId = ref<string | null>(null)

async function reloadPlaces() {
  if (!isSupabaseConfigured()) {
    places.value = []
    fillStatusOptions.value = []
    cropOptions.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    const [pageRes, fills, crops] = await Promise.all([
      loadStorageLocationsPage({
        search: search.value,
        fillStatusId: statusFilter.value,
        cropKey: cropFilter.value,
        page: page.value,
        pageSize: pageSize.value,
      }),
      loadStorageFillStatuses(),
      loadCrops(),
    ])
    const rows = pageRes.rows
    places.value = rows
    placesTotal.value = pageRes.total
    fillStatusOptions.value = fills
    cropOptions.value = crops
    summaries.value = rows.length ? await loadStorageLocationSummaries(rows) : {}
    if (page.value > totalPages.value) {
      page.value = totalPages.value
      const retry = await loadStorageLocationsPage({
        search: search.value,
        fillStatusId: statusFilter.value,
        cropKey: cropFilter.value,
        page: page.value,
        pageSize: pageSize.value,
      })
      places.value = retry.rows
      placesTotal.value = retry.total
      summaries.value = retry.rows.length ? await loadStorageLocationSummaries(retry.rows) : {}
    }
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : 'Не удалось загрузить места хранения'
  } finally {
    loading.value = false
  }
}

function metricsForPlace(place: StorageLocationRow): WarehouseCardMetrics {
  const summary = summaries.value[place.id]
  const code = storageLocationFillStatusCode(place)
  const cropFromPlace = storageLocationCropLabel(place)
  if (summary) {
    const cropLabel =
      summary.cropLabel ||
      (cropFromPlace !== '—' ? cropFromPlace : null) ||
      (summary.cropKey ? summary.cropKey : null)
    return {
      fillState: fillBatchStateFromCode(code),
      occupancyPercent: summary.occupancyPercent,
      totalMassTons: summary.totalMassTons,
      availableForTransferTons: summary.availableMassTons,
      reservedTons: summary.reservedTons,
      spoiledTons: summary.spoiledTons,
      cropLabel,
      lastOperationAt: summary.lastOperationAt,
      lastOperationLabel: summary.lastOperationLabel,
    }
  }
  const base = placeholderWarehouseMetrics()
  return {
    ...base,
    fillState: fillBatchStateFromCode(code),
    cropLabel: cropFromPlace !== '—' ? cropFromPlace : null,
    availableForTransferTons: 0,
    reservedTons: Number(place.reserved_tons || 0),
    spoiledTons: Number(place.spoiled_tons || 0),
  }
}

/** Подпись номинальной вместимости из справочника (если задана). */
function nominalCapacityLabel(place: StorageLocationRow): string | null {
  const raw = place.capacity_tons
  if (raw == null || !Number.isFinite(Number(raw))) return null
  const n = Number(raw)
  if (n <= 0) return null
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} т`
}

const rowsWithMetrics = computed(() =>
  places.value.map((place) => ({
    place,
    metrics: metricsForPlace(place),
    nominalLabel: nominalCapacityLabel(place),
  })),
)

const filteredRows = computed(() => rowsWithMetrics.value)

const totalFiltered = computed(() => placesTotal.value)
const totalPages = computed(() => Math.max(1, Math.ceil(totalFiltered.value / pageSize.value)))
const pageStart = computed(() => (totalFiltered.value ? (page.value - 1) * pageSize.value + 1 : 0))
const pageEnd = computed(() => Math.min(page.value * pageSize.value, totalFiltered.value))

const pagedRows = computed(() => rowsWithMetrics.value)

const pageNumbers = computed(() => {
  if (totalPages.value <= 7) return Array.from({ length: totalPages.value }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  if (page.value > 4) pages.push('ellipsis')
  for (let p = Math.max(2, page.value - 1); p <= Math.min(totalPages.value - 1, page.value + 1); p += 1) pages.push(p)
  if (page.value < totalPages.value - 3) pages.push('ellipsis')
  pages.push(totalPages.value)
  return pages
})

function fillStateClass(state: BatchFillState): string {
  if (state === 'empty') return 'warehouse-card-status--empty'
  if (state === 'filling') return 'warehouse-card-status--filling'
  return 'warehouse-card-status--formed'
}

function formatMassTons(tons: number): string {
  const n = Math.max(0, Math.round(tons))
  return `${n.toLocaleString('ru-RU')} т`
}

function formatLastOperation(metrics: WarehouseCardMetrics): string {
  if (!metrics.lastOperationAt) return '—'
  const d = new Date(metrics.lastOperationAt)
  if (Number.isNaN(d.getTime())) return '—'
  const datePart = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  const label = metrics.lastOperationLabel || 'Операция'
  if (label.startsWith('Приёмка')) return `Приёмка ${datePart}`
  if (label.startsWith('Перемещение')) return `Перемещ. ${datePart}`
  return `${label} ${datePart}`
}

function typeIconPath(type: string): string {
  if (type === 'Ток')
    return 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'
  if (type === 'Силос')
    return 'M6 20h12M6 20V10l6-4 6 4v10M6 20H4m16 0h2M9 14h6'
  if (type === 'Склад')
    return 'M3 21h18M5 21V7l8-4v18M19 21V11M9 9h1m0 4h1m4-4h1m0 4h1'
  if (type === 'Бурт')
    return 'M3 20h18M5 20V8l7-4 7 4v12'
  return 'M3 20h18M5 20V8l7-4 7 4v12'
}

function setPage(next: number) {
  const clamped = Math.min(totalPages.value, Math.max(1, next))
  if (clamped === page.value) return
  page.value = clamped
  void reloadPlaces()
}

function onPageSizeChange() {
  page.value = 1
  void reloadPlaces()
}

function openStorageCell(id: string) {
  void router.push({ name: 'warehouse-cell', params: { id } })
}

function openGrainIntake(id: string) {
  void router.push({ name: 'warehouse-cell', params: { id }, query: { intake: '1' } })
}

function openTransferModal(fromId?: string) {
  transferFromId.value = fromId ?? null
  transferModalOpen.value = true
}

function closeTransferModal() {
  transferModalOpen.value = false
  transferFromId.value = null
}

function onTransferSuccess() {
  void reloadPlaces()
}

onMounted(() => {
  void reloadPlaces()
})

watch(search, () => {
  page.value = 1
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void reloadPlaces(), 300)
})

watch(statusFilter, () => {
  page.value = 1
  void reloadPlaces()
})

watch(cropFilter, () => {
  page.value = 1
  void reloadPlaces()
})
</script>

<template>
  <section class="fields-page">
    <div class="fields-page-inner">
      <header class="fields-header page-enter-item">
        <div class="fields-header-text">
          <p class="fields-subtitle">
            Карточки привязаны к справочнику «Места хранения». Масса и заполненность обновляются по поступлениям, партиям и перемещениям.
          </p>
        </div>
        <RouterLink class="fields-add-btn" to="/warehouses/storage-locations?create=1">
          <svg class="fields-add-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
          Добавить склад
        </RouterLink>
      </header>

      <section class="fields-card">
        <div class="fields-toolbar">
          <div class="fields-search-wrap">
            <svg class="fields-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              v-model.trim="search"
              class="fields-search-input"
              type="search"
              placeholder="Поиск по названию склада..."
              autocomplete="off"
            />
          </div>
          <div class="warehouse-toolbar-filters">
            <label class="warehouse-filter-label">
              <span class="warehouse-filter-text">Статус заполнения</span>
              <select v-model="statusFilter" class="warehouse-filter-select">
                <option value="all">Все статусы</option>
                <option v-for="s in fillStatusOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </label>
            <label class="warehouse-filter-label">
              <span class="warehouse-filter-text">Культура</span>
              <select v-model="cropFilter" class="warehouse-filter-select">
                <option value="all">Все культуры</option>
                <option value="__none__">Без культуры</option>
                <option v-for="c in cropOptions" :key="c.id" :value="c.key">{{ c.label }}</option>
              </select>
            </label>
          </div>
        </div>

        <div v-if="!isSupabaseConfigured()" class="warehouse-alert" role="status">
          Supabase не настроен. Добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в `frontend/.env.local`.
        </div>
        <div v-else-if="error" class="warehouse-alert warehouse-alert--error" role="alert">{{ error }}</div>

        <div v-if="loading" class="fields-loading" role="status" aria-live="polite">
          <UiLoadingBar />
        </div>

        <div v-else-if="!places.length" class="warehouse-empty">
          <p class="warehouse-empty-title">Нет мест хранения</p>
          <p class="warehouse-empty-text">Добавьте место в справочнике — кнопка выше откроет форму создания.</p>
          <RouterLink class="fields-add-btn" to="/warehouses/storage-locations?create=1">
            <svg class="fields-add-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
            Добавить склад
          </RouterLink>
        </div>

        <div v-else-if="!filteredRows.length" class="warehouse-empty warehouse-empty--muted">
          <p class="warehouse-empty-title">Ничего не найдено</p>
          <p class="warehouse-empty-text">Измените поиск или фильтр статуса.</p>
        </div>

        <div v-else class="warehouse-grid">
          <article
            v-for="{ place, metrics, nominalLabel } in pagedRows"
            :key="place.id"
            class="warehouse-card"
            :class="{ 'warehouse-card--inactive': storageLocationMarksInactive(place) }"
          >
            <div
              class="warehouse-card-main"
              role="button"
              tabindex="0"
              @click="openStorageCell(place.id)"
              @keydown.enter.prevent="openStorageCell(place.id)"
              @keydown.space.prevent="openStorageCell(place.id)"
            >
            <div class="warehouse-card-top">
              <div class="warehouse-card-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path :d="typeIconPath(storageLocationTypeName(place))" />
                </svg>
              </div>
              <span class="warehouse-card-status" :class="fillStateClass(metrics.fillState)">
                {{ storageLocationFillStatusName(place) }}
              </span>
            </div>
            <h2 class="warehouse-card-title">{{ place.name }}</h2>
            <p class="warehouse-card-desc" :title="`${storageLocationTypeName(place)} · ${place.address}`">
              {{ storageLocationTypeName(place) }} · {{ place.address }}
            </p>
            <p v-if="nominalLabel" class="warehouse-card-nominal">Вместимость (номинал): {{ nominalLabel }}</p>
            <div class="warehouse-card-progress-block">
              <div class="warehouse-card-progress-label">Заполненность: {{ metrics.occupancyPercent }}%</div>
              <div class="warehouse-card-progress-track" role="progressbar" :aria-valuenow="metrics.occupancyPercent" aria-valuemin="0" aria-valuemax="100">
                <div class="warehouse-card-progress-fill" :style="{ width: `${Math.min(100, Math.max(0, metrics.occupancyPercent))}%` }" />
              </div>
            </div>
            <div class="warehouse-card-footer">
              <div class="warehouse-card-metric">
                <span class="warehouse-card-metric-label">Общая масса</span>
                <span class="warehouse-card-metric-value">{{ formatMassTons(metrics.totalMassTons) }}</span>
                <p class="warehouse-card-transfer-available">
                  Доступно для перемещения: {{ formatMassTons(metrics.availableForTransferTons) }}
                </p>
                <p
                  v-if="metrics.reservedTons > 0 || metrics.spoiledTons > 0"
                  class="warehouse-card-mass-holds"
                >
                  <template v-if="metrics.reservedTons > 0">резерв {{ formatMassTons(metrics.reservedTons) }}</template>
                  <template v-if="metrics.reservedTons > 0 && metrics.spoiledTons > 0"> · </template>
                  <template v-if="metrics.spoiledTons > 0">брак {{ formatMassTons(metrics.spoiledTons) }}</template>
                </p>
                <span class="warehouse-card-crop">{{ metrics.cropLabel || 'Нет' }}</span>
              </div>
              <div class="warehouse-card-metric warehouse-card-metric--right">
                <span class="warehouse-card-metric-label">Последняя операция</span>
                <span class="warehouse-card-metric-value warehouse-card-metric-value--date">{{ formatLastOperation(metrics) }}</span>
              </div>
            </div>
            </div>
            <div class="warehouse-card-actions">
              <button type="button" class="warehouse-card-btn warehouse-card-btn--move" @click.stop="openTransferModal(place.id)">
                Перемещение
              </button>
              <button type="button" class="warehouse-card-btn warehouse-card-btn--intake" @click.stop="openGrainIntake(place.id)">
                Приёмка зерна
              </button>
            </div>
          </article>
        </div>

        <footer v-if="!loading && places.length && filteredRows.length" class="fields-pagination">
          <p class="fields-pagination-info">
            Показано
            <span class="fields-pagination-num">{{ pageStart }}</span>
            –
            <span class="fields-pagination-num">{{ pageEnd }}</span>
            из
            <span class="fields-pagination-num">{{ totalFiltered }}</span>
          </p>
          <div class="fields-pagination-right">
            <nav class="fields-pagination-nav" aria-label="Пагинация">
              <button type="button" class="fields-page-btn fields-page-btn--edge" :disabled="page <= 1" aria-label="Предыдущая страница" @click="setPage(page - 1)">
                &lt;
              </button>
              <template v-for="(p, i) in pageNumbers" :key="p === 'ellipsis' ? `wh-e-${i}` : p">
                <button
                  v-if="p !== 'ellipsis'"
                  type="button"
                  class="fields-page-btn"
                  :class="{ 'fields-page-btn--active': p === page }"
                  @click="setPage(p as number)"
                >
                  {{ p }}
                </button>
                <span v-else class="fields-page-ellipsis">…</span>
              </template>
              <button type="button" class="fields-page-btn fields-page-btn--edge" :disabled="page >= totalPages" aria-label="Следующая страница" @click="setPage(page + 1)">
                &gt;
              </button>
            </nav>
            <label class="fields-pagination-size">
              <span class="fields-pagination-size-label">На странице</span>
              <select v-model.number="pageSize" class="fields-pagination-select" @change="onPageSizeChange">
                <option :value="4">4</option>
                <option :value="8">8</option>
                <option :value="12">12</option>
              </select>
            </label>
          </div>
        </footer>
      </section>
    </div>

    <WarehouseTransferModal
      :open="transferModalOpen"
      :places="places"
      :initial-from-id="transferFromId"
      @close="closeTransferModal"
      @success="onTransferSuccess"
    />
  </section>
</template>

<style scoped>
.fields-page {
  width: 100%;
}

.fields-page-inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.fields-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-md);
}

.fields-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.fields-subtitle {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
  max-width: 52rem;
  line-height: 1.45;
}

.fields-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 38px;
  border: 1px solid var(--accent-green);
  border-radius: 10px;
  background: var(--accent-green);
  color: #fff;
  padding: 0 14px;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25;
  cursor: pointer;
  text-decoration: none;
  flex-shrink: 0;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.fields-add-btn:hover {
  background: var(--accent-green-hover);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(61, 92, 64, 0.3);
}

.fields-add-btn-icon {
  width: 18px;
  height: 18px;
  transform-origin: center;
  transition: transform 0.28s ease;
}

.fields-add-btn:hover .fields-add-btn-icon {
  transform: rotate(52deg) scale(1.18);
}

.fields-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  padding: 12px;
}

/* Как на странице «Поля»: поиск с ограничением ширины, фильтры справа */
.fields-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md);
  margin: -12px -12px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}

.warehouse-toolbar-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  flex: 0 0 auto;
}

.warehouse-filter-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}

.warehouse-filter-text {
  font-size: 0.64rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.warehouse-filter-select {
  height: 38px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  font-size: 0.875rem;
  min-width: 160px;
}

.fields-search-wrap {
  position: relative;
  flex: 1;
  min-width: 200px;
  max-width: 28rem;
}

.fields-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
  pointer-events: none;
}

.fields-search-input {
  width: 100%;
  height: 38px;
  border: 1px solid var(--toolbar-form-surface-border);
  border-radius: 10px;
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  padding: 0 12px 0 34px;
  font-size: 0.93rem;
}

.fields-search-input::placeholder {
  color: var(--text-secondary);
}

.fields-search-input:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px var(--accent-green);
}

[data-theme='dark'] .fields-search-input,
[data-theme='dark'] .warehouse-filter-select {
  background: var(--toolbar-form-surface);
  border-color: var(--toolbar-form-surface-border);
}

.warehouse-alert {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.warehouse-alert--error {
  background: rgba(185, 28, 28, 0.1);
  border-color: rgba(185, 28, 28, 0.22);
  color: var(--danger-red);
}

.fields-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg) 24px;
}

.warehouse-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 16px;
  text-align: center;
}

.warehouse-empty--muted {
  padding: 32px 16px;
}

.warehouse-empty-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text-primary);
}

.warehouse-empty-text {
  margin: 0;
  max-width: 420px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.45;
}

.warehouse-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--space-md);
}

.warehouse-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--toolbar-form-surface-border);
  border-radius: 12px;
  background: var(--toolbar-form-surface);
  padding: 0;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
  overflow: hidden;
}

.warehouse-card-main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  padding: 14px 14px 12px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.warehouse-card:hover {
  border-color: color-mix(in srgb, var(--accent-green) 45%, var(--border-color));
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
  transform: translateY(-1px);
}

.warehouse-card:hover .warehouse-card-main {
  background: color-mix(in srgb, var(--toolbar-form-surface) 92%, #ffffff);
}

.warehouse-card-main:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-green) 52%, transparent);
  outline-offset: -2px;
}

[data-theme='dark'] .warehouse-card {
  background: color-mix(in srgb, var(--bg-panel) 88%, var(--bg-base));
  box-shadow: var(--shadow-card);
}

[data-theme='dark'] .warehouse-card:hover {
  background: var(--bg-panel-hover);
}

.warehouse-card--inactive {
  opacity: 0.72;
}

.warehouse-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.warehouse-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent-green) 12%, transparent);
  color: var(--accent-green);
}

.warehouse-card-status {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
}

.warehouse-card-status--empty {
  background: rgba(100, 116, 139, 0.2);
  color: var(--text-secondary);
  border: 1px solid rgba(100, 116, 139, 0.35);
}

.warehouse-card-status--filling {
  background: rgba(245, 158, 11, 0.22);
  color: #b45309;
  border: 1px solid rgba(245, 158, 11, 0.45);
}

.warehouse-card-status--formed {
  background: rgba(34, 197, 94, 0.18);
  color: #15803d;
  border: 1px solid rgba(34, 197, 94, 0.4);
}

[data-theme='dark'] .warehouse-card-status--empty {
  color: #cbd5e1;
  background: rgba(148, 163, 184, 0.2);
  border-color: rgba(148, 163, 184, 0.45);
}

[data-theme='dark'] .warehouse-card-status--filling {
  color: #fde68a;
  background: rgba(245, 158, 11, 0.22);
  border-color: rgba(245, 158, 11, 0.5);
}

[data-theme='dark'] .warehouse-card-status--formed {
  color: #86efac;
  background: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.45);
}

.warehouse-card-title {
  margin: 0 0 4px;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.25;
}

.warehouse-card-desc {
  margin: 0 0 12px;
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.35;
  min-height: calc(1.35em * 2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.warehouse-card-nominal {
  margin: -8px 0 10px;
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-weight: 500;
  min-height: 1.1rem;
}

.warehouse-card-progress-block {
  min-height: 42px;
  margin-bottom: 12px;
}

.warehouse-card-progress-label {
  font-size: 0.78rem;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.warehouse-card-progress-track {
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--toolbar-form-surface-border) 88%, transparent);
  overflow: hidden;
}

.warehouse-card-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--accent-green);
  transition: width 0.25s ease;
}

.warehouse-card-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

.warehouse-card-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.warehouse-card-metric--right {
  text-align: right;
  align-items: flex-end;
}

.warehouse-card-metric-label {
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.warehouse-card-metric-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.warehouse-card-metric-value--date {
  font-size: 0.9rem;
  font-weight: 600;
  min-height: 2.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;
}

.warehouse-card-transfer-available {
  margin: 4px 0 0;
  font-size: 0.78rem;
  font-weight: 500;
  line-height: 1.35;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.warehouse-card-mass-holds {
  margin: 2px 0 0;
  font-size: 0.72rem;
  line-height: 1.3;
  color: var(--text-muted);
}

.warehouse-card-crop {
  font-size: 0.78rem;
  color: var(--text-secondary);
  margin-top: 4px;
}

.warehouse-card-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-panel);
}

.warehouse-card-btn {
  width: 100%;
  height: 38px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.warehouse-card-btn--move {
  border: 1px solid color-mix(in srgb, #2563eb 55%, var(--border-color));
  background: var(--bg-panel);
  color: #2563eb;
}

.warehouse-card-btn--move:hover {
  background: color-mix(in srgb, #2563eb 10%, var(--bg-panel));
}

.warehouse-card-btn--writeoff {
  border: 1px solid color-mix(in srgb, var(--danger-red) 45%, var(--border-color));
  background: var(--bg-panel);
  color: var(--danger-red);
}

.warehouse-card-btn--writeoff:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.warehouse-card-btn--intake {
  border: 1px solid var(--accent-green);
  background: var(--accent-green);
  color: #fff;
}

.warehouse-card-btn--intake:hover {
  background: var(--accent-green-hover);
}

.fields-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-md);
  padding: var(--space-md) var(--space-lg) 0;
  border-top: 1px solid var(--border-color);
  min-height: 40px;
}

.fields-pagination-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
}

.fields-pagination-num {
  font-weight: 500;
}

.fields-pagination-right {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  flex-wrap: wrap;
}

.fields-pagination-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.fields-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.fields-page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fields-page-btn--edge {
  width: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
}

.fields-page-btn--active {
  background: rgba(76, 175, 80, 0.15);
  border-color: rgba(76, 175, 80, 0.5);
}

.fields-page-btn:hover:not(:disabled):not(.fields-page-btn--active) {
  background: var(--bg-panel-hover);
}

.fields-page-ellipsis {
  padding: 0 10px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.fields-pagination-size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.fields-pagination-size-label {
  white-space: nowrap;
}

.fields-pagination-select {
  height: 36px;
  min-width: 72px;
  padding: 0 28px 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
}

@media (max-width: 900px) {
  .fields-header {
    flex-direction: column;
    align-items: stretch;
  }

  .fields-add-btn {
    width: 100%;
    justify-content: center;
  }

  .fields-toolbar {
    flex-direction: column;
    align-items: stretch;
    margin-left: 0;
    margin-right: 0;
  }

  .fields-search-wrap {
    max-width: none;
    width: 100%;
  }

  .warehouse-toolbar-filters {
    width: 100%;
  }

  .warehouse-filter-label {
    flex: 1 1 auto;
    min-width: 0;
  }

  .warehouse-filter-select {
    width: 100%;
  }

  .fields-pagination {
    flex-direction: column;
    align-items: flex-start;
  }

  .fields-pagination-right {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
