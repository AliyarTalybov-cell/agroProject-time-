<script setup lang="ts">
/** Карточка партии: происхождение, качество, где лежит, операции, история. */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import StockDocumentsTable from '@/components/stock/StockDocumentsTable.vue'
import StockTransferModal from '@/components/stock/StockTransferModal.vue'
import StockOutgoingModal from '@/components/stock/StockOutgoingModal.vue'
import StockProcessingModal from '@/components/stock/StockProcessingModal.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  STOCK_PURPOSES,
  formatTons,
  loadStockBatch,
  loadStockDocumentsFor,
  parseDecimalInput,
  stockOriginLabel,
  stockPurposeLabel,
  updateStockBatch,
  type BatchPlacement,
  type StockBatch,
  type StockDocument,
  type StockOutgoingType,
  type StockPurpose,
} from '@/lib/stockLedger'

const props = defineProps<{ id: string }>()
const router = useRouter()

const loading = ref(true)
const error = ref<string | null>(null)
const batch = ref<StockBatch | null>(null)
const placements = ref<BatchPlacement[]>([])
const documents = ref<StockDocument[]>([])

type Dialog = { kind: 'transfer' } | { kind: 'processing' } | { kind: 'outgoing'; type: StockOutgoingType } | { kind: 'edit' }
const dialog = ref<Dialog | null>(null)

async function load() {
  error.value = null
  try {
    const [b, docs] = await Promise.all([loadStockBatch(props.id), loadStockDocumentsFor({ batchId: props.id })])
    batch.value = b?.batch ?? null
    placements.value = b?.placements ?? []
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

const QUALITY_LABELS: Record<string, string> = {
  moisture: 'Влажность, %',
  base_moisture: 'Базовая влажность, %',
  weed_impurity: 'Сорная примесь, %',
  grain_impurity: 'Зерновая примесь, %',
  nature: 'Натура, г/л',
  gluten: 'Клейковина, %',
  protein: 'Протеин, %',
  class: 'Класс',
}

/** Известные показатели по-русски; перенесённые из старого учёта — как были. Пустые не показываем. */
const qualityRows = computed(() =>
  Object.entries(batch.value?.quality ?? {})
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => ({ label: QUALITY_LABELS[k] ?? k, value: String(v) })),
)

const source = computed(() => {
  const b = batch.value
  if (!b) return ''
  if (b.origin === 'purchase') return b.supplierName ? `Закупка · ${b.supplierName}` : 'Закупка'
  if (b.origin === 'field') return b.fieldName ? `С поля · ${b.fieldName}` : 'С поля'
  return b.fieldName ? `${stockOriginLabel(b.origin)} · ${b.fieldName}` : stockOriginLabel(b.origin)
})

const OUTGOING: { type: StockOutgoingType; label: string }[] = [
  { type: 'sale', label: 'Продажа' },
  { type: 'seeding', label: 'На посев' },
  { type: 'consumption', label: 'Переработка / корм' },
  { type: 'writeoff', label: 'Списание' },
]

// Редактирование описательных полей
const edit = ref({ variety: '', harvestYear: '', purpose: 'food' as StockPurpose, fgis: '', comment: '', class: '', protein: '', gluten: '', nature: '' })
const editSaving = ref(false)
const editError = ref<string | null>(null)

function openEdit() {
  const b = batch.value
  if (!b) return
  const q = b.quality as Record<string, unknown>
  edit.value = {
    variety: b.variety ?? '',
    harvestYear: b.harvest_year != null ? String(b.harvest_year) : '',
    purpose: b.purpose,
    fgis: b.fgis_batch_number ?? '',
    comment: b.comment ?? '',
    class: q.class != null ? String(q.class) : '',
    protein: q.protein != null ? String(q.protein) : '',
    gluten: q.gluten != null ? String(q.gluten) : '',
    nature: q.nature != null ? String(q.nature) : '',
  }
  editError.value = null
  dialog.value = { kind: 'edit' }
}

async function saveEdit() {
  const b = batch.value
  if (!b) return
  editSaving.value = true
  editError.value = null
  const e = edit.value
  try {
    await updateStockBatch(b.id, {
      variety: e.variety.trim() || null,
      harvest_year: parseDecimalInput(e.harvestYear),
      purpose: e.purpose,
      fgis_batch_number: e.fgis.trim() || null,
      comment: e.comment.trim() || null,
      quality: {
        ...b.quality,
        class: e.class.trim() || null,
        protein: parseDecimalInput(e.protein),
        gluten: parseDecimalInput(e.gluten),
        nature: parseDecimalInput(e.nature),
      },
    })
    dialog.value = null
    await load()
  } catch (err) {
    editError.value = formatSupabaseError(err)
  } finally {
    editSaving.value = false
  }
}
</script>

<template>
  <section class="ui-page">
    <div class="ui-page-inner">
      <button type="button" class="ui-back-btn" aria-label="Назад к списку партий" @click="router.push('/grain/batches')">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6" /></svg>
        Назад к списку партий
      </button>

      <div v-if="loading" class="ui-loading"><UiLoadingBar /></div>
      <p v-else-if="error && !batch" class="ui-alert ui-alert--error">{{ error }}</p>
      <p v-else-if="!batch" class="ui-alert">Партия не найдена.</p>

      <template v-else>
        <section class="ui-card batch-head">
          <div class="batch-title-row">
            <div>
              <h2 class="batch-title">{{ batch.code }} · {{ batch.cropLabel }}</h2>
              <p class="ui-page-subtitle">{{ source }}</p>
            </div>
            <span class="ui-pill" :class="batch.tons > 0 ? 'ui-pill--green' : ''">{{ batch.tons > 0 ? 'С остатком' : 'Закрыта' }}</span>
          </div>

          <div class="ui-stats">
            <div class="ui-stat">
              <span class="ui-stat-label">Остаток</span>
              <span class="ui-stat-value">{{ formatTons(batch.tons) }}</span>
            </div>
            <div class="ui-stat">
              <span class="ui-stat-label">Урожай</span>
              <span class="ui-stat-value">{{ batch.harvest_year ?? '—' }}</span>
            </div>
            <div class="ui-stat">
              <span class="ui-stat-label">Назначение</span>
              <span class="ui-stat-value batch-small-value">{{ stockPurposeLabel(batch.purpose) }}</span>
            </div>
            <div class="ui-stat">
              <span class="ui-stat-label">Сорт</span>
              <span class="ui-stat-value batch-small-value">{{ batch.variety || '—' }}</span>
            </div>
            <div class="ui-stat">
              <span class="ui-stat-label">Партия во ФГИС</span>
              <span class="ui-stat-value batch-small-value">{{ batch.fgis_batch_number || '—' }}</span>
            </div>
          </div>

          <div class="batch-actions">
            <button type="button" class="ui-soft-btn" :disabled="batch.tons <= 0" @click="dialog = { kind: 'transfer' }">Перемещение</button>
            <button v-for="o in OUTGOING" :key="o.type" type="button" class="ui-soft-btn" :disabled="batch.tons <= 0" @click="dialog = { kind: 'outgoing', type: o.type }">
              {{ o.label }}
            </button>
            <button type="button" class="ui-soft-btn" :disabled="batch.tons <= 0" @click="dialog = { kind: 'processing' }">Подработка</button>
            <button type="button" class="ui-soft-btn" @click="openEdit">Изменить данные партии</button>
          </div>
        </section>

        <div class="batch-grid">
          <section class="ui-card">
            <h3 class="ui-card-title">Где лежит</h3>
            <p v-if="!placements.length" class="ui-muted">Партия полностью израсходована.</p>
            <ul v-else class="batch-list">
              <li v-for="p in placements" :key="p.cellId">
                <RouterLink :to="{ name: 'warehouse-cell', params: { id: p.locationId } }" class="batch-link">{{ p.locationName }}, {{ p.cellName }}</RouterLink>
                <span class="ui-num ui-strong">{{ formatTons(p.tons) }}</span>
              </li>
            </ul>
          </section>
          <section class="ui-card">
            <h3 class="ui-card-title">Качество</h3>
            <p v-if="!qualityRows.length" class="ui-muted">Показатели не внесены.</p>
            <dl v-else class="batch-dl">
              <template v-for="q in qualityRows" :key="q.label">
                <dt>{{ q.label }}</dt>
                <dd>{{ q.value }}</dd>
              </template>
            </dl>
            <p v-if="batch.comment" class="ui-muted batch-comment">{{ batch.comment }}</p>
          </section>
        </div>

        <section class="ui-card">
          <h3 class="ui-card-title">История партии</h3>
          <StockDocumentsTable :documents="documents" :scope-batch-id="batch.id" @changed="load" />
        </section>
      </template>
    </div>

    <teleport to="body">
      <template v-if="batch && dialog">
        <StockTransferModal v-if="dialog.kind === 'transfer'" :batch-id="batch.id" @close="dialog = null" @done="onDone" />
        <StockProcessingModal v-else-if="dialog.kind === 'processing'" :batch-id="batch.id" @close="dialog = null" @done="onDone" />
        <StockOutgoingModal v-else-if="dialog.kind === 'outgoing'" :type="dialog.type" :batch-id="batch.id" @close="dialog = null" @done="onDone" />
        <UiModal v-else-if="dialog.kind === 'edit'" title="Данные партии" :max-width="620" :close-disabled="editSaving" @close="dialog = null">
          <p class="ui-muted" style="margin: 0">Культура и происхождение меняются только через документы — они здесь не редактируются.</p>
          <div class="ui-form-row ui-form-row--three">
            <div class="ui-form-field">
              <label class="ui-form-label">Сорт</label>
              <input v-model.trim="edit.variety" class="ui-form-input" />
            </div>
            <div class="ui-form-field">
              <label class="ui-form-label">Урожай года</label>
              <input v-model.trim="edit.harvestYear" inputmode="numeric" class="ui-form-input" />
            </div>
            <div class="ui-form-field">
              <label class="ui-form-label">Назначение</label>
              <select v-model="edit.purpose" class="ui-form-select">
                <option v-for="p in STOCK_PURPOSES" :key="p" :value="p">{{ stockPurposeLabel(p) }}</option>
              </select>
            </div>
          </div>
          <div class="ui-form-row ui-form-row--two">
            <div class="ui-form-field">
              <label class="ui-form-label">Партия во ФГИС «Зерно» №</label>
              <input v-model.trim="edit.fgis" class="ui-form-input" />
            </div>
            <div class="ui-form-field">
              <label class="ui-form-label">Класс</label>
              <input v-model.trim="edit.class" class="ui-form-input" placeholder="Например: 3" />
            </div>
          </div>
          <div class="ui-form-row ui-form-row--three">
            <div class="ui-form-field">
              <label class="ui-form-label">Протеин, %</label>
              <input v-model.trim="edit.protein" inputmode="decimal" class="ui-form-input" />
            </div>
            <div class="ui-form-field">
              <label class="ui-form-label">Клейковина, %</label>
              <input v-model.trim="edit.gluten" inputmode="decimal" class="ui-form-input" />
            </div>
            <div class="ui-form-field">
              <label class="ui-form-label">Натура, г/л</label>
              <input v-model.trim="edit.nature" inputmode="decimal" class="ui-form-input" />
            </div>
          </div>
          <div class="ui-form-field">
            <label class="ui-form-label">Комментарий</label>
            <textarea v-model.trim="edit.comment" class="ui-form-textarea" rows="2" />
          </div>
          <p v-if="editError" class="ui-form-error">{{ editError }}</p>
          <template #actions>
            <UiButton :disabled="editSaving" @click="dialog = null">Отмена</UiButton>
            <UiButton variant="primary" :disabled="editSaving" @click="saveEdit">{{ editSaving ? 'Сохранение…' : 'Сохранить' }}</UiButton>
          </template>
        </UiModal>
      </template>
    </teleport>
  </section>
</template>

<style scoped>
.batch-head {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.batch-title-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.batch-title {
  margin: 0 0 4px;
  font-size: 1.5rem;
  line-height: 1.2;
  color: var(--text-primary);
}

.batch-small-value {
  font-size: 0.95rem;
}

.batch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.batch-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-lg);
}

.batch-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.batch-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.batch-link {
  color: var(--text-primary);
}

.batch-link:hover {
  color: var(--accent-green);
}

.batch-dl {
  margin: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 16px;
  font-size: 0.9rem;
}

.batch-dl dt {
  color: var(--text-secondary);
}

.batch-dl dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.batch-comment {
  margin: 10px 0 0;
}

@media (max-width: 900px) {
  .batch-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .batch-actions > * {
    flex: 1 1 calc(50% - 8px);
  }
}
</style>
