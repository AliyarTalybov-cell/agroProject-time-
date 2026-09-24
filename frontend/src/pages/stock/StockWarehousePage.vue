<script setup lang="ts">
/**
 * Карточка склада на складском журнале: ячейки и что в них лежит, операции,
 * история. Все цифры — из журнала движений (lib/stockLedger).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import StockDocumentsTable from '@/components/stock/StockDocumentsTable.vue'
import StockIntakeModal from '@/components/stock/StockIntakeModal.vue'
import StockTransferModal from '@/components/stock/StockTransferModal.vue'
import StockOutgoingModal from '@/components/stock/StockOutgoingModal.vue'
import StockProcessingModal from '@/components/stock/StockProcessingModal.vue'
import StockInventoryModal from '@/components/stock/StockInventoryModal.vue'
import StorageCellModal from '@/components/stock/StorageCellModal.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  deleteStorageCell,
  formatTons,
  loadStockBatches,
  loadStockDocumentsFor,
  loadWarehousesOverview,
  type BatchPlacement,
  type CellWithStock,
  type StockBatch,
  type StockDocument,
  type StockOutgoingType,
  type WarehouseOverview,
} from '@/lib/stockLedger'

const props = defineProps<{ id: string }>()
const router = useRouter()

const loading = ref(true)
const error = ref<string | null>(null)
const warehouse = ref<WarehouseOverview | null>(null)
const placements = ref<BatchPlacement[]>([])
const batches = ref<Map<string, StockBatch>>(new Map())
const documents = ref<StockDocument[]>([])
const tab = ref<'cells' | 'journal'>('cells')

type Dialog =
  | { kind: 'intake' }
  | { kind: 'transfer' }
  | { kind: 'processing' }
  | { kind: 'inventory' }
  | { kind: 'outgoing'; type: StockOutgoingType }
  | { kind: 'cell'; cell: CellWithStock | null }
  | { kind: 'delete-cell'; cell: CellWithStock }
const dialog = ref<Dialog | null>(null)
const deleting = ref(false)

async function load() {
  error.value = null
  try {
    const [w, b, docs] = await Promise.all([
      loadWarehousesOverview(props.id),
      loadStockBatches(),
      loadStockDocumentsFor({ locationId: props.id }),
    ])
    warehouse.value = w[0] ?? null
    batches.value = new Map(b.batches.map((x) => [x.id, x]))
    placements.value = b.placements.filter((p) => p.locationId === props.id)
    documents.value = docs
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

function onDone() {
  dialog.value = null
  void load()
}

const fillPercent = computed(() => {
  const w = warehouse.value
  if (!w?.capacityTons) return null
  return Math.round((w.tons / w.capacityTons) * 100)
})

function cellPlacements(cellId: string) {
  return placements.value
    .filter((p) => p.cellId === cellId)
    .map((p) => ({ ...p, batch: batches.value.get(p.batchId) }))
}

function cellFill(c: CellWithStock): number | null {
  return c.capacity_tons ? Math.round((c.tons / c.capacity_tons) * 100) : null
}

const hasStock = computed(() => (warehouse.value?.tons ?? 0) > 0)

const OUTGOING: { type: StockOutgoingType; label: string }[] = [
  { type: 'sale', label: 'Продажа' },
  { type: 'seeding', label: 'На посев' },
  { type: 'consumption', label: 'Переработка / корм' },
  { type: 'writeoff', label: 'Списание' },
]

async function confirmDeleteCell() {
  if (dialog.value?.kind !== 'delete-cell') return
  deleting.value = true
  try {
    await deleteStorageCell(dialog.value.cell.id)
    dialog.value = null
    await load()
  } catch (e) {
    const msg = formatSupabaseError(e)
    error.value = msg.includes('foreign key') ? 'По ячейке уже есть операции — удалить её нельзя, можно переименовать.' : msg
    dialog.value = null
  } finally {
    deleting.value = false
  }
}

function openBatch(batchId: string) {
  void router.push({ name: 'grain-batch', params: { id: batchId } })
}
</script>

<template>
  <section class="ui-page">
    <div class="ui-page-inner">
      <button type="button" class="ui-back-btn" aria-label="Назад к списку складов" @click="router.push('/warehouses')">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6" /></svg>
        Назад к списку складов
      </button>

      <div v-if="loading" class="ui-loading"><UiLoadingBar /></div>
      <p v-else-if="error && !warehouse" class="ui-alert ui-alert--error">{{ error }}</p>
      <p v-else-if="!warehouse" class="ui-alert">Склад не найден.</p>

      <template v-else>
        <section class="ui-card wh-head">
          <div class="wh-title-row">
            <div>
              <h2 class="wh-title">{{ warehouse.name }}</h2>
              <p class="ui-page-subtitle">{{ [warehouse.typeName, warehouse.address].filter(Boolean).join(' · ') }}</p>
            </div>
            <span class="ui-pill" :class="warehouse.inactive ? '' : 'ui-pill--green'">{{ warehouse.statusName || 'Активен' }}</span>
          </div>

          <div class="ui-stats">
            <div class="ui-stat">
              <span class="ui-stat-label">Лежит</span>
              <span class="ui-stat-value">{{ formatTons(warehouse.tons) }}</span>
            </div>
            <div class="ui-stat">
              <span class="ui-stat-label">Вместимость</span>
              <span class="ui-stat-value">{{ warehouse.capacityTons ? formatTons(warehouse.capacityTons) : '—' }}</span>
            </div>
            <div class="ui-stat">
              <span class="ui-stat-label">Заполнено</span>
              <span class="ui-stat-value">{{ fillPercent == null ? '—' : `${fillPercent}%` }}</span>
              <div v-if="fillPercent != null" class="ui-fill-bar" :class="{ 'ui-fill-bar--over': fillPercent > 100 }">
                <span :style="{ width: `${Math.min(100, fillPercent)}%` }" />
              </div>
            </div>
            <div class="ui-stat">
              <span class="ui-stat-label">Культуры</span>
              <span class="ui-stat-value wh-crops">{{ warehouse.crops.map((c) => c.label).join(', ') || '—' }}</span>
            </div>
          </div>

          <div class="wh-actions">
            <button type="button" class="ui-add-btn" @click="dialog = { kind: 'intake' }">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" x2="12" y1="5" y2="19" /><line x1="5" x2="19" y1="12" y2="12" /></svg>
              Приёмка
            </button>
            <button type="button" class="ui-soft-btn" :disabled="!hasStock" @click="dialog = { kind: 'transfer' }">Перемещение</button>
            <button v-for="o in OUTGOING" :key="o.type" type="button" class="ui-soft-btn" :disabled="!hasStock" @click="dialog = { kind: 'outgoing', type: o.type }">
              {{ o.label }}
            </button>
            <button type="button" class="ui-soft-btn" :disabled="!hasStock" @click="dialog = { kind: 'processing' }">Подработка</button>
            <button type="button" class="ui-soft-btn" :disabled="!hasStock" @click="dialog = { kind: 'inventory' }">Инвентаризация</button>
          </div>
        </section>

        <p v-if="error" class="ui-alert ui-alert--error">{{ error }}</p>

        <section class="ui-card">
          <div class="ui-tabs">
            <button type="button" class="ui-tab" :class="{ 'is-active': tab === 'cells' }" @click="tab = 'cells'">Ячейки и партии</button>
            <button type="button" class="ui-tab" :class="{ 'is-active': tab === 'journal' }" @click="tab = 'journal'">
              Журнал · {{ documents.length }}
            </button>
          </div>

          <div v-if="tab === 'cells'" class="wh-panel">
            <div class="ui-toolbar wh-panel-toolbar">
              <span class="ui-muted">В одной ячейке — одна культура. Разные культуры кладите в разные ячейки.</span>
              <button type="button" class="ui-soft-btn" @click="dialog = { kind: 'cell', cell: null }">+ Ячейка</button>
            </div>
            <div class="ui-table-wrap">
              <table class="ui-table wh-cells" v-card-table>
                <thead>
                  <tr>
                    <th>Ячейка</th>
                    <th>Культура</th>
                    <th>Партии</th>
                    <th class="ui-num">Лежит</th>
                    <th class="ui-num">Вместимость</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in warehouse.cells" :key="c.id">
                    <td>
                      <span class="ui-strong">{{ c.name }}</span>
                      <div v-if="c.typeName" class="ui-muted ui-small">{{ c.typeName }}</div>
                    </td>
                    <td>{{ c.cropLabel ?? '—' }}</td>
                    <td>
                      <div v-if="!cellPlacements(c.id).length" class="ui-muted">пусто</div>
                      <button
                        v-for="p in cellPlacements(c.id)"
                        :key="p.batchId"
                        type="button"
                        class="wh-batch-link"
                        @click="openBatch(p.batchId)"
                      >
                        {{ p.batch?.code ?? '—' }} · {{ formatTons(p.tons) }}
                      </button>
                    </td>
                    <td class="ui-num ui-strong">{{ formatTons(c.tons) }}</td>
                    <td class="ui-num">
                      {{ c.capacity_tons ? formatTons(c.capacity_tons) : '—' }}
                      <div v-if="cellFill(c) != null" class="ui-fill-bar wh-cell-bar" :class="{ 'ui-fill-bar--over': (cellFill(c) ?? 0) > 100 }">
                        <span :style="{ width: `${Math.min(100, cellFill(c) ?? 0)}%` }" />
                      </div>
                    </td>
                    <td class="wh-cell-actions">
                      <button type="button" class="wh-icon-btn" aria-label="Изменить ячейку" title="Изменить" @click="dialog = { kind: 'cell', cell: c }">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
                      </button>
                      <button
                        v-if="c.kind !== 'main' && c.tons === 0"
                        type="button"
                        class="wh-icon-btn wh-icon-btn--danger"
                        aria-label="Удалить ячейку"
                        title="Удалить"
                        @click="dialog = { kind: 'delete-cell', cell: c }"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else class="wh-panel">
            <StockDocumentsTable :documents="documents" :scope-location-id="warehouse.id" @changed="load" />
          </div>
        </section>
      </template>
    </div>

    <teleport to="body">
      <template v-if="warehouse && dialog">
        <StockIntakeModal v-if="dialog.kind === 'intake'" :location-id="warehouse.id" @close="dialog = null" @done="onDone" />
        <StockTransferModal v-else-if="dialog.kind === 'transfer'" :location-id="warehouse.id" @close="dialog = null" @done="onDone" />
        <StockProcessingModal v-else-if="dialog.kind === 'processing'" :location-id="warehouse.id" @close="dialog = null" @done="onDone" />
        <StockInventoryModal v-else-if="dialog.kind === 'inventory'" :location-id="warehouse.id" @close="dialog = null" @done="onDone" />
        <StockOutgoingModal v-else-if="dialog.kind === 'outgoing'" :type="dialog.type" :location-id="warehouse.id" @close="dialog = null" @done="onDone" />
        <StorageCellModal v-else-if="dialog.kind === 'cell'" :location-id="warehouse.id" :cell="dialog.cell" @close="dialog = null" @done="onDone" />
        <UiConfirmModal
          v-else-if="dialog.kind === 'delete-cell'"
          :title="`Удалить ячейку «${dialog.cell.name}»?`"
          :busy="deleting"
          @cancel="dialog = null"
          @confirm="confirmDeleteCell"
        />
      </template>
    </teleport>
  </section>
</template>

<style scoped>
.wh-head {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.wh-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.wh-title {
  margin: 0 0 4px;
  font-size: 1.5rem;
  line-height: 1.2;
  color: var(--text-primary);
}

.wh-crops {
  font-size: 0.95rem;
  line-height: 1.35;
}

.wh-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wh-panel {
  padding-top: 12px;
}

.wh-panel-toolbar {
  justify-content: space-between;
}

.wh-cells {
  min-width: 760px;
}

.wh-batch-link {
  display: block;
  padding: 2px 0;
  border: none;
  background: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
}

.wh-batch-link:hover {
  color: var(--accent-green);
  text-decoration: underline;
}

.wh-cell-bar {
  margin-top: 6px;
  margin-left: auto;
  max-width: 120px;
}

.wh-cell-actions {
  width: 1%;
  white-space: nowrap;
}

.wh-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  color: var(--text-secondary);
  transition: background 0.2s ease, color 0.2s ease;
}

.wh-icon-btn:hover {
  background: var(--bg-panel-hover);
  color: var(--text-primary);
}

.wh-icon-btn--danger:hover {
  color: var(--danger-red);
}

@media (max-width: 640px) {
  .wh-actions > * {
    flex: 1 1 calc(50% - 8px);
  }
}
</style>
