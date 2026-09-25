<script setup lang="ts">
import { Button } from '@/components/ui/shadcn/button'
/**
 * Таблица складских документов: журнал операций, история склада и партии.
 * Строка раскрывается — движения по партиям и ячейкам, транспорт, документы,
 * веса и качество. Руководитель может отменить проведённый документ (сторно).
 *
 * `scopeLocationId` / `scopeBatchId` — показывать в колонке массы только
 * движения этого склада / этой партии (перемещение внутри склада даёт ноль).
 */
import { computed, ref } from 'vue'
import { useAuth } from '@/stores/auth'
import StockCancelModal from './StockCancelModal.vue'
import {
  consumptionTargetLabel,
  formatRub,
  formatTons,
  stockDocTypeLabel,
  type StockDocument,
} from '@/lib/stockLedger'

const props = defineProps<{
  documents: StockDocument[]
  scopeLocationId?: string | null
  scopeBatchId?: string | null
  emptyText?: string
}>()
const emit = defineEmits<{ changed: [] }>()

const auth = useAuth()
const isManager = computed(() => auth.userRole.value === 'manager')
const expanded = ref<string | null>(null)
const cancelling = ref<StockDocument | null>(null)

const DOC_PILL: Record<string, string> = {
  opening: 'ui-pill',
  intake: 'ui-pill ui-pill--green',
  processing: 'ui-pill ui-pill--amber',
  transfer: 'ui-pill ui-pill--blue',
  sale: 'ui-pill ui-pill--violet',
  seeding: 'ui-pill ui-pill--green',
  consumption: 'ui-pill ui-pill--amber',
  writeoff: 'ui-pill ui-pill--red',
  inventory: 'ui-pill',
  storno: 'ui-pill ui-pill--red',
}

function scopedMovements(d: StockDocument) {
  return d.movements.filter(
    (m) =>
      (!props.scopeLocationId || m.locationId === props.scopeLocationId) &&
      (!props.scopeBatchId || m.batch_id === props.scopeBatchId),
  )
}

function delta(d: StockDocument): number {
  return Number(scopedMovements(d).reduce((s, m) => s + m.delta_tons, 0).toFixed(3))
}

/** Для перемещения важно «сколько перевезли», а не сумма ± (она ноль или потери). */
function movedTons(d: StockDocument): number {
  return Number(d.movements.filter((m) => m.delta_tons < 0).reduce((s, m) => s - m.delta_tons, 0).toFixed(3))
}

function party(d: StockDocument): string {
  if (d.counterpartyName) return d.counterpartyName
  if (d.fieldName) return d.fieldName
  if (d.reasonName) return d.reasonName
  if (d.consumption_target) return d.consumptionTargetName ?? consumptionTargetLabel(d.consumption_target)
  if (d.doc_type === 'transfer') {
    const from = d.movements.find((m) => m.delta_tons < 0)
    const to = d.movements.find((m) => m.delta_tons > 0)
    return from && to ? `${from.locationName}, ${from.cellName} → ${to.locationName}, ${to.cellName}` : ''
  }
  return ''
}

function batchesOf(d: StockDocument): string {
  return Array.from(new Set(scopedMovements(d).map((m) => `${m.batchCode} · ${m.cropLabel}`))).join(', ')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const QUALITY_LABELS: Record<string, string> = {
  moisture: 'Влажность, %',
  base_moisture: 'Базовая влажность, %',
  weed_impurity: 'Сорная примесь, %',
  grain_impurity: 'Зерновая примесь, %',
  nature: 'Натура, г/л',
  gluten: 'Клейковина, %',
  protein: 'Протеин, %',
}
const WEIGHT_LABELS: Record<string, string> = {
  gross: 'Брутто, т',
  tare: 'Тара, т',
  grain_mass: 'Масса зерна, т',
  dry_mass: 'После сушки, т',
  impurity_loss: 'Потери на примеси, т',
  net: 'Зачётный вес, т',
  buyer_net: 'Вес у покупателя, т',
  before: 'До подработки, т',
  after: 'После подработки, т',
}

function details(d: StockDocument): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const push = (label: string, v: unknown) => {
    if (v != null && v !== '') out.push({ label, value: String(v) })
  }
  push('Машина', d.vehicle_plate)
  push('Водитель', d.driver_name)
  push('ТТН / накладная', d.waybill_number)
  push('СДИЗ', d.sdiz_number)
  push('Акт', d.act_number)
  if (d.price_per_ton != null) push('Цена за тонну', formatRub(d.price_per_ton))
  for (const [k, v] of Object.entries(d.weights)) push(WEIGHT_LABELS[k] ?? k, v)
  for (const [k, v] of Object.entries(d.quality)) push(QUALITY_LABELS[k] ?? k, v)
  push('Комментарий', d.comment)
  if (d.status === 'cancelled') push('Отменён', d.cancel_reason)
  push('Провёл', d.createdByName)
  return out
}

function canCancel(d: StockDocument): boolean {
  return isManager.value && d.status === 'posted' && d.doc_type !== 'storno' && d.doc_type !== 'opening'
}

function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id
}
</script>

<template>
  <div>
    <p v-if="!documents.length" class="ui-muted" style="margin: 8px 0">{{ emptyText ?? 'Операций пока нет.' }}</p>
    <div v-else class="ui-table-wrap">
      <table class="ui-table stock-docs" v-card-table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Операция</th>
            <th>Партии</th>
            <th>Контрагент / поле / куда</th>
            <th class="ui-num">Масса</th>
            <th class="ui-num">Сумма</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="d in documents" :key="d.id">
            <tr class="ui-list-row" :class="{ 'stock-doc--cancelled': d.status === 'cancelled' }" @click="toggle(d.id)">
              <td class="ui-num">
                <span class="ui-list-title">{{ formatDate(d.doc_date) }}</span>
                <div class="ui-muted ui-small">№ {{ d.number }}</div>
              </td>
              <td>
                <span :class="DOC_PILL[d.doc_type] ?? 'ui-pill'">{{ stockDocTypeLabel(d.doc_type) }}</span>
                <div v-if="d.status === 'cancelled'" class="ui-muted ui-small">отменён</div>
              </td>
              <td class="stock-doc-batches">{{ batchesOf(d) }}</td>
              <td>{{ party(d) }}</td>
              <td class="ui-num ui-strong">
                <template v-if="d.doc_type === 'transfer' && !scopeLocationId">{{ formatTons(movedTons(d)) }}</template>
                <template v-else-if="d.doc_type === 'transfer' && delta(d) === 0">{{ formatTons(movedTons(d)) }}</template>
                <span v-else :class="delta(d) > 0 ? 'ui-plus' : delta(d) < 0 ? 'ui-minus' : ''">
                  {{ delta(d) > 0 ? '+' : '' }}{{ formatTons(delta(d), 3) }}
                </span>
              </td>
              <td class="ui-num">{{ d.amount != null ? formatRub(d.amount) : '' }}</td>
              <td class="stock-doc-actions" @click.stop>
                <Button variant="outline" size="sm" v-if="canCancel(d)" type="button" class="stock-doc-cancel" @click="cancelling = d">Отменить</Button>
              </td>
            </tr>
            <tr v-if="expanded === d.id" class="stock-doc-details">
              <td colspan="7">
                <div class="stock-doc-grid">
                  <div>
                    <p class="ui-form-section-title">Движения</p>
                    <ul class="stock-doc-moves">
                      <li v-for="m in d.movements" :key="m.id">
                        <span :class="m.delta_tons > 0 ? 'ui-plus' : 'ui-minus'" class="ui-num ui-strong">
                          {{ m.delta_tons > 0 ? '+' : '' }}{{ formatTons(m.delta_tons, 3) }}
                        </span>
                        {{ m.batchCode }} · {{ m.cropLabel }} — {{ m.locationName }}, {{ m.cellName }}
                      </li>
                    </ul>
                  </div>
                  <dl v-if="details(d).length" class="stock-doc-dl">
                    <template v-for="item in details(d)" :key="item.label">
                      <dt>{{ item.label }}</dt>
                      <dd>{{ item.value }}</dd>
                    </template>
                  </dl>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <teleport to="body">
      <StockCancelModal
        v-if="cancelling"
        :document="cancelling"
        @close="cancelling = null"
        @done="cancelling = null; emit('changed')"
      />
    </teleport>
  </div>
</template>

<style scoped>
@layer legacy {
.stock-docs {
  min-width: 860px;
}

.stock-doc-batches {
  max-width: 260px;
}

.stock-doc--cancelled td {
  opacity: 0.55;
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--text-secondary) 60%, transparent);
}

.stock-doc--cancelled td:last-child {
  opacity: 1;
  text-decoration: none;
}

.stock-doc-actions {
  width: 1%;
  white-space: nowrap;
}

.stock-doc-cancel {
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  border-radius: 8px;
  height: 30px;
  padding: 0 10px;
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.stock-doc-cancel:hover {
  color: var(--danger-red);
  border-color: color-mix(in srgb, var(--danger-red) 40%, var(--border-color));
}

.stock-doc-details td {
  background: var(--bg-base);
}

.stock-doc-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
}

.stock-doc-moves {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stock-doc-dl {
  margin: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 12px;
  font-size: 0.85rem;
}

.stock-doc-dl dt {
  color: var(--text-secondary);
}

.stock-doc-dl dd {
  margin: 0;
}

@media (max-width: 900px) {
  .stock-doc-grid {
    grid-template-columns: 1fr;
  }
}
}
</style>
