<script setup lang="ts">
/**
 * Партии зерна — один реестр вместо «Реестра партий» и «Текущих партий».
 * Остатки из того же журнала, что и карточки складов, поэтому сходятся.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UiPagination from '@/components/ui/UiPagination.vue'
import StockIntakeModal from '@/components/stock/StockIntakeModal.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  STOCK_PURPOSES,
  formatTons,
  loadStockBatches,
  stockOriginLabel,
  stockPurposeLabel,
  type BatchPlacement,
  type StockBatch,
} from '@/lib/stockLedger'

const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const batches = ref<StockBatch[]>([])
const placements = ref<BatchPlacement[]>([])
const intakeOpen = ref(false)

const search = ref('')
const cropFilter = ref('')
const statusFilter = ref<'open' | 'closed' | 'all'>('open')
const locationFilter = ref('')
const purposeFilter = ref('')
const page = ref(1)
const pageSize = ref(20)

async function load() {
  error.value = null
  try {
    const r = await loadStockBatches()
    batches.value = r.batches
    placements.value = r.placements
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const placementsByBatch = computed(() => {
  const m = new Map<string, BatchPlacement[]>()
  for (const p of placements.value) {
    const list = m.get(p.batchId) ?? []
    list.push(p)
    m.set(p.batchId, list)
  }
  return m
})

const cropOptions = computed(() =>
  Array.from(new Map(batches.value.map((b) => [b.crop_key, b.cropLabel]))).sort((a, b) => a[1].localeCompare(b[1], 'ru')),
)
const locationOptions = computed(() =>
  Array.from(new Map(placements.value.map((p) => [p.locationId, p.locationName]))).sort((a, b) => a[1].localeCompare(b[1], 'ru')),
)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return batches.value.filter((b) => {
    if (statusFilter.value === 'open' && b.tons <= 0) return false
    if (statusFilter.value === 'closed' && b.tons > 0) return false
    if (cropFilter.value && b.crop_key !== cropFilter.value) return false
    if (purposeFilter.value && b.purpose !== purposeFilter.value) return false
    if (locationFilter.value && !(placementsByBatch.value.get(b.id) ?? []).some((p) => p.locationId === locationFilter.value)) return false
    if (q) {
      const hay = [b.code, b.variety, b.fgis_batch_number, b.fieldName, b.supplierName].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

watch([search, cropFilter, statusFilter, locationFilter, purposeFilter, pageSize], () => (page.value = 1))

const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const totalTons = computed(() => filtered.value.reduce((s, b) => s + b.tons, 0))

function whereLabel(b: StockBatch): string {
  const list = placementsByBatch.value.get(b.id) ?? []
  if (!list.length) return '—'
  return list.map((p) => `${p.locationName}, ${p.cellName}`).join('; ')
}

function sourceLabel(b: StockBatch): string {
  if (b.origin === 'field') return b.fieldName ?? 'С поля'
  if (b.origin === 'purchase') return b.supplierName ?? 'Закупка'
  return b.fieldName ?? stockOriginLabel(b.origin)
}

function resetFilters() {
  search.value = ''
  cropFilter.value = ''
  statusFilter.value = 'open'
  locationFilter.value = ''
  purposeFilter.value = ''
}

function onIntakeDone() {
  intakeOpen.value = false
  void load()
}
</script>

<template>
  <section class="ui-page">
    <div class="ui-page-inner">
      <header class="ui-page-header">
        <p class="ui-page-subtitle">Партии зерна по всем складам. Остатки из журнала операций — те же, что в карточках складов.</p>
        <div class="ui-header-actions">
          <button type="button" class="ui-add-btn" @click="intakeOpen = true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" x2="12" y1="5" y2="19" /><line x1="5" x2="19" y1="12" y2="12" /></svg>
            Приёмка зерна
          </button>
        </div>
      </header>

      <section class="ui-card">
        <div class="ui-toolbar">
          <label class="ui-search">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <input v-model="search" type="search" placeholder="№ партии, сорт, поле, поставщик, № ФГИС" />
          </label>
          <select v-model="statusFilter" class="ui-filter-select" aria-label="Статус">
            <option value="open">С остатком</option>
            <option value="closed">Закрытые (0 т)</option>
            <option value="all">Все партии</option>
          </select>
          <select v-model="cropFilter" class="ui-filter-select" aria-label="Культура">
            <option value="">Все культуры</option>
            <option v-for="[key, label] in cropOptions" :key="key" :value="key">{{ label }}</option>
          </select>
          <select v-model="locationFilter" class="ui-filter-select" aria-label="Склад">
            <option value="">Все склады</option>
            <option v-for="[id, name] in locationOptions" :key="id" :value="id">{{ name }}</option>
          </select>
          <select v-model="purposeFilter" class="ui-filter-select" aria-label="Назначение">
            <option value="">Любое назначение</option>
            <option v-for="p in STOCK_PURPOSES" :key="p" :value="p">{{ stockPurposeLabel(p) }}</option>
          </select>
        </div>

        <p v-if="error" class="ui-alert ui-alert--error">{{ error }}</p>
        <div v-if="loading" class="ui-loading"><UiLoadingBar /></div>
        <div v-else-if="!filtered.length" class="ui-empty">
          <h3>Партий не найдено</h3>
          <p>Измените фильтры или проведите приёмку зерна.</p>
          <button type="button" class="ui-soft-btn" @click="resetFilters">Сбросить фильтры</button>
        </div>
        <template v-else>
          <div class="ui-table-wrap">
            <table class="ui-table batches-table">
              <thead>
                <tr>
                  <th>Партия</th>
                  <th>Культура</th>
                  <th>Откуда</th>
                  <th>Назначение</th>
                  <th>Где лежит</th>
                  <th class="ui-num">Остаток</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="b in pageRows"
                  :key="b.id"
                  class="ui-list-row"
                  @click="router.push({ name: 'grain-batch', params: { id: b.id } })"
                >
                  <td>
                    <span class="ui-list-title">{{ b.code }}</span>
                    <div class="ui-muted ui-small">урожай {{ b.harvest_year ?? '—' }}{{ b.variety ? ` · ${b.variety}` : '' }}</div>
                  </td>
                  <td>{{ b.cropLabel }}</td>
                  <td>{{ sourceLabel(b) }}</td>
                  <td>{{ stockPurposeLabel(b.purpose) }}</td>
                  <td class="batches-where">{{ whereLabel(b) }}</td>
                  <td class="ui-num ui-strong">
                    <span v-if="b.tons > 0">{{ formatTons(b.tons) }}</span>
                    <span v-else class="ui-pill">закрыта</span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="5">Итого по фильтру · партий: {{ filtered.length }}</td>
                  <td class="ui-num">{{ formatTons(totalTons) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <UiPagination v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" :page-size-options="[10, 20, 50, 100]" />
        </template>
      </section>
    </div>

    <teleport to="body">
      <StockIntakeModal v-if="intakeOpen" @close="intakeOpen = false" @done="onIntakeDone" />
    </teleport>
  </section>
</template>

<style scoped>
.batches-table {
  min-width: 900px;
}

.batches-where {
  max-width: 280px;
}
</style>
