<script setup lang="ts">
import { Card } from '@/components/ui/shadcn/card'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/shadcn/input-group'
import { Button } from '@/components/ui/shadcn/button'
import { CylinderIcon, HouseIcon, PlusIcon, SearchIcon, SunIcon, WarehouseIcon } from '@lucide/vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/**
 * Склады — карточки. Масса, культуры и заполненность считаются по складскому
 * журналу (lib/stockLedger), статус заполнения — по остатку, а не вручную.
 * Разметка и стили карточек прежние.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UiPagination from '@/components/ui/UiPagination.vue'
import StockIntakeModal from '@/components/stock/StockIntakeModal.vue'
import StockTransferModal from '@/components/stock/StockTransferModal.vue'
import { isSupabaseConfigured } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { loadWarehousesOverview, stockDocTypeLabel, type WarehouseOverview } from '@/lib/stockLedger'

/** Заполнен — от 95% вместимости. */
const FULL_SHARE = 0.95

type FillState = 'empty' | 'filling' | 'formed'
const FILL_LABELS: Record<FillState, string> = { empty: 'Пусто', filling: 'Есть зерно', formed: 'Заполнен' }

const loading = ref(false)
const error = ref<string | null>(null)
const router = useRouter()
const search = ref('')
const statusFilter = ref<'all' | FillState>('all')
const cropFilter = ref<'all' | '__none__' | string>('all')
const page = ref(1)
const pageSize = ref(8)
const warehouses = ref<WarehouseOverview[]>([])

type Dialog = { kind: 'intake' | 'transfer'; locationId: string }
const dialog = ref<Dialog | null>(null)

async function reloadPlaces() {
  if (!isSupabaseConfigured()) {
    warehouses.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    warehouses.value = await loadWarehousesOverview()
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    loading.value = false
  }
}

function fillState(w: WarehouseOverview): FillState {
  if (w.tons <= 0) return 'empty'
  if (w.capacityTons && w.tons >= w.capacityTons * FULL_SHARE) return 'formed'
  return 'filling'
}

function occupancyPercent(w: WarehouseOverview): number {
  return w.capacityTons ? Math.round((w.tons / w.capacityTons) * 100) : 0
}

const cropOptions = computed(() =>
  Array.from(new Map(warehouses.value.flatMap((w) => w.crops.map((c) => [c.key, c.label] as const)))).sort((a, b) =>
    a[1].localeCompare(b[1], 'ru'),
  ),
)

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return warehouses.value.filter((w) => {
    if (q && !`${w.name} ${w.address}`.toLowerCase().includes(q)) return false
    if (statusFilter.value !== 'all' && fillState(w) !== statusFilter.value) return false
    if (cropFilter.value === '__none__' && w.crops.length) return false
    if (cropFilter.value !== 'all' && cropFilter.value !== '__none__' && !w.crops.some((c) => c.key === cropFilter.value)) return false
    return true
  })
})

const pagedRows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

watch([search, statusFilter, cropFilter, pageSize], () => (page.value = 1))

function fillStateClass(state: FillState): string {
  if (state === 'empty') return 'warehouse-card-status--empty'
  if (state === 'filling') return 'warehouse-card-status--filling'
  return 'warehouse-card-status--formed'
}

function formatMassTons(tons: number): string {
  const n = Math.max(0, Math.round(tons))
  return `${n.toLocaleString('ru-RU')} т`
}

function formatLastOperation(w: WarehouseOverview): string {
  if (!w.lastDocument) return '—'
  const d = new Date(w.lastDocument.date)
  if (Number.isNaN(d.getTime())) return '—'
  return `${stockDocTypeLabel(w.lastDocument.type)} ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`
}

function cropsLabel(w: WarehouseOverview): string {
  return w.crops.map((c) => `${c.label} ${formatMassTons(c.tons)}`).join(', ') || 'Нет'
}

/** Иконка типа места хранения — Lucide (набор shadcn-vue). */
function typeIcon(type: string) {
  if (type === 'Ток') return SunIcon
  if (type === 'Силос') return CylinderIcon
  if (type === 'Склад') return WarehouseIcon
  return HouseIcon
}

function openStorageCell(id: string) {
  void router.push({ name: 'warehouse-cell', params: { id } })
}

function onDialogDone() {
  dialog.value = null
  void reloadPlaces()
}

onMounted(() => {
  void reloadPlaces()
})
</script>

<template>
  <section class="fields-page">
    <div class="fields-page-inner">
      <header class="fields-header page-enter-item">
        <div class="fields-header-text">
          <p class="fields-subtitle">
            Масса, культуры и заполненность — по складскому журналу. Нажмите на карточку, чтобы открыть ячейки склада и операции.
          </p>
        </div>
        <RouterLink class="fields-add-btn" to="/warehouses/storage-locations?create=1">
          <PlusIcon class="fields-add-btn-icon" />
          Добавить склад
        </RouterLink>
      </header>

      <Card class="fields-card gap-0">
        <div class="fields-toolbar">
          <InputGroup class="fields-search-wrap max-w-sm">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              v-model.trim="search"
              type="search"
              placeholder="Поиск по названию склада..."
              autocomplete="off" />
          </InputGroup>
          <div class="warehouse-toolbar-filters">
            <label class="warehouse-filter-label">
              <span class="warehouse-filter-text">Статус заполнения</span>
              <UiSelect v-model="statusFilter" :options="[{ value: 'all', label: 'Все статусы' }, { value: 'empty', label: 'Пусто' }, { value: 'filling', label: 'Есть зерно' }, { value: 'formed', label: 'Заполнен' }]" class="warehouse-filter-select" />
            </label>
            <label class="warehouse-filter-label">
              <span class="warehouse-filter-text">Культура</span>
              <UiSelect
                v-model="cropFilter"
                :options="[{ value: 'all', label: 'Все культуры' }, { value: '__none__', label: 'Пустые' }, ...cropOptions.map(([key, label]) => ({ value: key, label }))]"
                class="warehouse-filter-select"
              />
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

        <div v-else-if="!warehouses.length" class="warehouse-empty">
          <p class="warehouse-empty-title">Нет мест хранения</p>
          <p class="warehouse-empty-text">Добавьте место в справочнике — кнопка выше откроет форму создания.</p>
          <RouterLink class="fields-add-btn" to="/warehouses/storage-locations?create=1">
            <PlusIcon class="fields-add-btn-icon" />
            Добавить склад
          </RouterLink>
        </div>

        <div v-else-if="!filteredRows.length" class="warehouse-empty warehouse-empty--muted">
          <p class="warehouse-empty-title">Ничего не найдено</p>
          <p class="warehouse-empty-text">Измените поиск или фильтр статуса.</p>
        </div>

        <div v-else class="warehouse-grid">
          <Card
            v-for="w in pagedRows"
            :key="w.id"
            class="warehouse-card gap-0"
            :class="{ 'warehouse-card--inactive': w.inactive }"
          >
            <div
              class="warehouse-card-main"
              role="button"
              tabindex="0"
              @click="openStorageCell(w.id)"
              @keydown.enter.prevent="openStorageCell(w.id)"
              @keydown.space.prevent="openStorageCell(w.id)"
            >
            <div class="warehouse-card-top">
              <div class="warehouse-card-icon" aria-hidden="true">
                <component :is="typeIcon(w.typeName)" :size="22" :stroke-width="1.8" aria-hidden="true" />
              </div>
              <span class="warehouse-card-status" :class="fillStateClass(fillState(w))">
                {{ FILL_LABELS[fillState(w)] }}
              </span>
            </div>
            <h2 class="warehouse-card-title">{{ w.name }}</h2>
            <p class="warehouse-card-desc" :title="`${w.typeName} · ${w.address}`">
              {{ w.typeName }} · {{ w.address }}
            </p>
            <p v-if="w.capacityTons" class="warehouse-card-nominal">Вместимость: {{ formatMassTons(w.capacityTons) }} · ячеек: {{ w.cells.length }}</p>
            <div class="warehouse-card-progress-block">
              <div class="warehouse-card-progress-label">Заполненность: {{ occupancyPercent(w) }}%</div>
              <div class="warehouse-card-progress-track" role="progressbar" :aria-valuenow="occupancyPercent(w)" aria-valuemin="0" aria-valuemax="100">
                <div class="warehouse-card-progress-fill" :style="{ width: `${Math.min(100, Math.max(0, occupancyPercent(w)))}%` }" />
              </div>
            </div>
            <div class="warehouse-card-footer">
              <div class="warehouse-card-metric">
                <span class="warehouse-card-metric-label">Общая масса</span>
                <span class="warehouse-card-metric-value">{{ formatMassTons(w.tons) }}</span>
                <span class="warehouse-card-crop">{{ cropsLabel(w) }}</span>
              </div>
              <div class="warehouse-card-metric warehouse-card-metric--right">
                <span class="warehouse-card-metric-label">Последняя операция</span>
                <span class="warehouse-card-metric-value warehouse-card-metric-value--date">{{ formatLastOperation(w) }}</span>
              </div>
            </div>
            </div>
            <div class="warehouse-card-actions">
              <Button variant="outline" type="button" class="warehouse-card-btn warehouse-card-btn--move" :disabled="w.tons <= 0" @click.stop="dialog = { kind: 'transfer', locationId: w.id }">
                Перемещение
              </Button>
              <Button variant="outline" type="button" class="warehouse-card-btn warehouse-card-btn--intake" @click.stop="dialog = { kind: 'intake', locationId: w.id }">
                Приёмка зерна
              </Button>
            </div>
          </Card>
        </div>

        <UiPagination
          v-if="!loading && filteredRows.length"
          v-model:page="page"
          v-model:page-size="pageSize"
          :total="filteredRows.length"
          :page-size-options="[4, 8, 12]"
        />
      </Card>
    </div>

    <teleport to="body">
      <StockIntakeModal v-if="dialog?.kind === 'intake'" :location-id="dialog.locationId" @close="dialog = null" @done="onDialogDone" />
      <StockTransferModal v-if="dialog?.kind === 'transfer'" :location-id="dialog.locationId" @close="dialog = null" @done="onDialogDone" />
    </teleport>
  </section>
</template>

<style scoped>
@layer legacy {
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
  height: var(--control-h);
  border: 1px solid var(--accent-green);
  border-radius: var(--radius-md);
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
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
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
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.warehouse-filter-select {
  height: var(--control-h);
  padding: 0 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--input-border);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 0.875rem;
  min-width: 160px;
  box-shadow: var(--shadow-xs);
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
  height: var(--control-h);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-md);
  background: var(--input-bg);
  color: var(--text-primary);
  padding: 0 12px 0 34px;
  font-size: 0.93rem;
  box-shadow: var(--shadow-xs);
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
  border-radius: var(--radius-xl);
  background: var(--toolbar-form-surface);
  padding: 0;
  box-shadow: var(--shadow-sm);
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
  width: var(--control-h);
  height: var(--control-h);
  border-radius: var(--radius-md);
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
  font-weight: 600;
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
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.warehouse-card-metric-value {
  font-size: 1rem;
  font-weight: 600;
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
  height: var(--control-h);
  border-radius: var(--radius-md);
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
  height: var(--control-h);
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
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
  border: 1px solid var(--input-border);
  background: var(--bg-panel);
  box-shadow: var(--shadow-xs);
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
  height: var(--control-h);
  min-width: 72px;
  padding: 0 28px 0 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--input-border);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  box-shadow: var(--shadow-xs);
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
}
</style>
