<script setup lang="ts">
import { PlusIcon, SearchIcon } from '@lucide/vue'
import UiSelect from '@/components/ui/UiSelect.vue'
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
  formatTons,
  loadSimpleRef,
  loadStockBatches,
  stockOriginLabel,
  type BatchPlacement,
  type SimpleRefRow,
  type StockBatch,
} from '@/lib/stockLedger'

const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const batches = ref<StockBatch[]>([])
const placements = ref<BatchPlacement[]>([])
const intakeOpen = ref(false)
const purposes = ref<SimpleRefRow[]>([])

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
    const [r, pu] = await Promise.all([loadStockBatches(), loadSimpleRef('stock_batch_purposes')])
    purposes.value = pu
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

const statusOptions: { value: 'open' | 'closed' | 'all'; label: string }[] = [
  { value: 'open', label: 'С остатком' },
  { value: 'closed', label: 'Закрытые (0 т)' },
  { value: 'all', label: 'Все партии' },
]
const cropSelectOptions = computed(() => [
  { value: '', label: 'Все культуры' },
  ...cropOptions.value.map(([value, label]) => ({ value, label })),
])
const locationSelectOptions = computed(() => [
  { value: '', label: 'Все склады' },
  ...locationOptions.value.map(([value, label]) => ({ value, label })),
])
const purposeSelectOptions = computed(() => [
  { value: '', label: 'Все назначения' },
  ...purposes.value.map((p) => ({ value: p.id, label: p.label })),
])

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
            <PlusIcon />
            Приёмка зерна
          </button>
        </div>
      </header>

      <section class="ui-card">
        <div class="ui-toolbar">
          <label class="ui-search">
            <SearchIcon />
            <input v-model="search" type="search" placeholder="№ партии, сорт, поле, поставщик, № ФГИС" />
          </label>
          <UiSelect v-model="statusFilter" :options="statusOptions" aria-label="Статус" class="ui-filter-select" />
          <UiSelect v-model="cropFilter" :options="cropSelectOptions" aria-label="Культура" class="ui-filter-select" />
          <UiSelect v-model="locationFilter" :options="locationSelectOptions" aria-label="Склад" class="ui-filter-select" />
          <UiSelect v-model="purposeFilter" :options="purposeSelectOptions" aria-label="Назначение" class="ui-filter-select" />
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
            <table class="ui-table batches-table" v-card-table>
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
                  <td>{{ b.purposeLabel }}</td>
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
@layer legacy {
.batches-table {
  min-width: 900px;
}

.batches-where {
  max-width: 280px;
}
}
</style>
