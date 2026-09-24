<script setup lang="ts">
/**
 * Расход зерна: продажа, посев, переработка или корм, списание. Одним
 * документом можно отгрузить из нескольких партий и ячеек.
 */
import { computed, onMounted, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  fieldOptionLabel,
  formatRub,
  formatTons,
  parseDecimalInput,
  postOutgoing,
  type StockOutgoingType,
} from '@/lib/stockLedger'
import { localInputToIso, nowLocalInput, useStockRefs } from '@/composables/useStockRefs'

const props = defineProps<{ type: StockOutgoingType; locationId?: string | null; batchId?: string | null }>()
const emit = defineEmits<{ close: []; done: [] }>()

const TITLES: Record<StockOutgoingType, string> = {
  sale: 'Продажа зерна',
  seeding: 'Выдача на посев',
  consumption: 'Переработка / корм',
  writeoff: 'Списание зерна',
}
const SUBMIT: Record<StockOutgoingType, string> = {
  sale: 'Провести продажу',
  seeding: 'Выдать на посев',
  consumption: 'Провести расход',
  writeoff: 'Списать',
}

const refs = useStockRefs()
const saving = ref(false)
const error = ref<string | null>(null)

type Line = { source: string; tons: string }
const lines = ref<Line[]>([{ source: '', tons: '' }])
const form = ref({
  docDate: nowLocalInput(),
  counterpartyId: '',
  fieldId: '',
  reasonId: '',
  target: 'feed' as 'feed' | 'processing',
  pricePerTon: '',
  buyerNet: '',
  vehiclePlate: '',
  driverName: '',
  waybillNumber: '',
  sdizNumber: '',
  actNumber: '',
  comment: '',
})

const sources = computed(() =>
  refs.placementOptions.value.filter(
    (p) => (!props.locationId || p.locationId === props.locationId) && (!props.batchId || p.batchId === props.batchId),
  ),
)

onMounted(async () => {
  await refs.reload()
  if (sources.value.length === 1) lines.value[0].source = sources.value[0].key
})

function sourceOf(line: Line) {
  return refs.placementOptions.value.find((p) => p.key === line.source) ?? null
}

const parsedLines = computed(() =>
  lines.value.map((l) => {
    const src = sourceOf(l)
    const tons = parseDecimalInput(l.tons)
    return { src, tons, over: src != null && tons != null && tons > src.available }
  }),
)
const totalTons = computed(() => Number(parsedLines.value.reduce((s, l) => s + (l.tons ?? 0), 0).toFixed(3)))
const amount = computed(() => {
  const price = parseDecimalInput(form.value.pricePerTon)
  return price == null ? null : Number((price * totalTons.value).toFixed(2))
})

const duplicate = computed(() => {
  const keys = lines.value.map((l) => l.source).filter(Boolean)
  return new Set(keys).size !== keys.length
})

const canSave = computed(() => {
  if (duplicate.value) return false
  if (!parsedLines.value.every((l) => l.src && l.tons != null && l.tons > 0 && !l.over)) return false
  if (props.type === 'sale') return Boolean(form.value.counterpartyId)
  if (props.type === 'seeding') return Boolean(form.value.fieldId)
  if (props.type === 'writeoff') return Boolean(form.value.reasonId)
  return true
})

function addLine() {
  lines.value.push({ source: '', tons: '' })
}
function removeLine(i: number) {
  lines.value.splice(i, 1)
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = null
  const f = form.value
  try {
    await postOutgoing(props.type, {
      doc_date: localInputToIso(f.docDate),
      lines: parsedLines.value.map((l) => ({ batch_id: l.src!.batchId, cell_id: l.src!.cellId, tons: l.tons! })),
      counterparty_id: props.type === 'sale' ? f.counterpartyId : null,
      field_id: props.type === 'seeding' ? f.fieldId : null,
      writeoff_reason_id: props.type === 'writeoff' ? f.reasonId : null,
      consumption_target: props.type === 'consumption' ? f.target : null,
      price_per_ton: props.type === 'sale' ? parseDecimalInput(f.pricePerTon) : null,
      amount: props.type === 'sale' ? amount.value : null,
      weights: props.type === 'sale' ? { buyer_net: parseDecimalInput(f.buyerNet) } : undefined,
      vehicle_plate: f.vehiclePlate,
      driver_name: f.driverName,
      waybill_number: f.waybillNumber,
      sdiz_number: f.sdizNumber,
      act_number: f.actNumber,
      comment: f.comment,
    })
    emit('done')
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :title="TITLES[type]" :max-width="680" :close-disabled="saving" @close="emit('close')">
    <p v-if="refs.error.value" class="ui-form-error">{{ refs.error.value }}</p>
    <p v-else-if="!refs.loading.value && !sources.length" class="ui-alert">Нет зерна с остатком.</p>

    <div class="ui-form-row ui-form-row--two">
      <div class="ui-form-field">
        <label class="ui-form-label">Дата и время *</label>
        <input v-model="form.docDate" type="datetime-local" class="ui-form-input" />
      </div>
      <div v-if="type === 'sale'" class="ui-form-field">
        <label class="ui-form-label">Покупатель *</label>
        <select v-model="form.counterpartyId" class="ui-form-select">
          <option value="" disabled>{{ refs.buyers.value.length ? 'Выберите покупателя' : 'Сначала добавьте покупателя в «Контрагентах»' }}</option>
          <option v-for="c in refs.buyers.value" :key="c.id" :value="c.id">{{ c.name }}{{ c.inn ? ` · ИНН ${c.inn}` : '' }}</option>
        </select>
      </div>
      <div v-else-if="type === 'seeding'" class="ui-form-field">
        <label class="ui-form-label">Поле *</label>
        <select v-model="form.fieldId" class="ui-form-select">
          <option value="" disabled>Выберите поле</option>
          <option v-for="f in refs.fields.value" :key="f.id" :value="f.id">{{ fieldOptionLabel(f) }}</option>
        </select>
      </div>
      <div v-else-if="type === 'consumption'" class="ui-form-field">
        <label class="ui-form-label">Куда *</label>
        <select v-model="form.target" class="ui-form-select">
          <option value="feed">На корм</option>
          <option value="processing">На переработку</option>
        </select>
      </div>
      <div v-else class="ui-form-field">
        <label class="ui-form-label">Причина *</label>
        <select v-model="form.reasonId" class="ui-form-select">
          <option value="" disabled>Выберите причину</option>
          <option v-for="r in refs.reasons.value" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>
    </div>

    <p class="ui-form-section-title">Из каких партий</p>
    <div v-for="(line, i) in lines" :key="i" class="stock-line">
      <select v-model="line.source" class="ui-form-select">
        <option value="" disabled>Партия в ячейке</option>
        <option v-for="p in sources" :key="p.key" :value="p.key">{{ p.label }} · {{ formatTons(p.tons) }}</option>
      </select>
      <input v-model.trim="line.tons" inputmode="decimal" class="ui-form-input stock-line-tons" placeholder="т" />
      <button v-if="lines.length > 1" type="button" class="stock-line-remove" aria-label="Убрать строку" @click="removeLine(i)">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      </button>
      <p v-if="parsedLines[i].over" class="ui-form-hint stock-line-hint">
        Больше остатка: доступно {{ formatTons(parsedLines[i].src?.available) }}
      </p>
    </div>
    <div class="stock-lines-footer">
      <button v-if="sources.length > lines.length" type="button" class="ui-soft-btn" @click="addLine">+ Ещё партия</button>
      <span class="ui-strong">Итого {{ formatTons(totalTons) }}</span>
    </div>
    <p v-if="duplicate" class="ui-form-error">Одна и та же партия в ячейке выбрана дважды.</p>

    <template v-if="type === 'sale'">
      <div class="ui-form-row ui-form-row--three">
        <div class="ui-form-field">
          <label class="ui-form-label">Цена за тонну, ₽</label>
          <input v-model.trim="form.pricePerTon" inputmode="decimal" class="ui-form-input" />
        </div>
        <div class="ui-form-field">
          <label class="ui-form-label">Сумма</label>
          <input :value="formatRub(amount)" class="ui-form-input" readonly tabindex="-1" />
        </div>
        <div class="ui-form-field">
          <label class="ui-form-label">Вес у покупателя, т</label>
          <input v-model.trim="form.buyerNet" inputmode="decimal" class="ui-form-input" />
        </div>
      </div>
    </template>

    <template v-if="type === 'sale' || type === 'consumption' || type === 'seeding'">
      <div class="ui-form-row ui-form-row--two">
        <div class="ui-form-field">
          <label class="ui-form-label">Госномер машины</label>
          <input v-model.trim="form.vehiclePlate" class="ui-form-input" />
        </div>
        <div class="ui-form-field">
          <label class="ui-form-label">Водитель</label>
          <input v-model.trim="form.driverName" class="ui-form-input" />
        </div>
      </div>
    </template>
    <div class="ui-form-row ui-form-row--two">
      <div v-if="type !== 'writeoff'" class="ui-form-field">
        <label class="ui-form-label">ТТН / накладная №</label>
        <input v-model.trim="form.waybillNumber" class="ui-form-input" />
      </div>
      <div v-if="type === 'sale'" class="ui-form-field">
        <label class="ui-form-label">СДИЗ № (ФГИС «Зерно»)</label>
        <input v-model.trim="form.sdizNumber" class="ui-form-input" />
      </div>
      <div v-if="type === 'writeoff'" class="ui-form-field">
        <label class="ui-form-label">Акт №</label>
        <input v-model.trim="form.actNumber" class="ui-form-input" />
      </div>
    </div>
    <div class="ui-form-field">
      <label class="ui-form-label">Комментарий</label>
      <textarea v-model.trim="form.comment" class="ui-form-textarea" rows="2" />
    </div>

    <p v-if="error" class="ui-form-error">{{ error }}</p>

    <template #actions>
      <UiButton :disabled="saving" @click="emit('close')">Отмена</UiButton>
      <UiButton :variant="type === 'writeoff' ? 'danger' : 'primary'" :disabled="saving || !canSave" @click="save">
        {{ saving ? 'Проводим…' : SUBMIT[type] }}
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.stock-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px 32px;
  gap: 8px;
  align-items: center;
}

.stock-line-tons {
  text-align: right;
}

.stock-line-remove {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.stock-line-remove:hover {
  background: var(--bg-panel-hover);
  color: var(--text-primary);
}

.stock-line-hint {
  grid-column: 1 / -1;
  color: var(--danger-red);
}

.stock-lines-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

@media (max-width: 640px) {
  .stock-line {
    grid-template-columns: minmax(0, 1fr) 90px 32px;
  }
}
</style>
