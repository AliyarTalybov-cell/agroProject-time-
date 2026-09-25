<script setup lang="ts">
import { Input } from '@/components/ui/shadcn/input'
import { Button } from '@/components/ui/shadcn/button'
import { XIcon } from '@lucide/vue'
import UiDateTimePicker from '@/components/ui/UiDateTimePicker.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/**
 * Расход зерна: продажа, посев, переработка или корм, списание. Одним
 * документом можно отгрузить из нескольких партий и ячеек.
 */
import { computed, onMounted, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
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
  target: '',
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
  if (!form.value.target) form.value.target = refs.targets.value[0]?.id ?? ''
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
  if (props.type === 'consumption') return Boolean(form.value.target)
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
        <UiDateTimePicker v-model="form.docDate" />
      </div>
      <div v-if="type === 'sale'" class="ui-form-field">
        <label class="ui-form-label ui-form-label--with-help">Покупатель *
          <RefFieldHelp text="Нет покупателя? Добавьте его в" :to="{ path: '/grain/counterparties' }" link-label="Контрагенты" />
        </label>
        <UiSelect v-model="form.counterpartyId" :options="[...(refs.buyers.value).map((c) => ({ value: c.id, label: `${c.name}${c.inn ? ` · ИНН ${c.inn}` : ''}` }))]" placeholder="{{ refs.buyers.value.length ? 'Выберите покупателя' : 'Сначала добавьте покупателя в «Контрагентах»' }}" class="ui-form-select" />
      </div>
      <div v-else-if="type === 'seeding'" class="ui-form-field">
        <label class="ui-form-label">Поле *</label>
        <UiSelect v-model="form.fieldId" :options="[...(refs.fields.value).map((f) => ({ value: f.id, label: String(fieldOptionLabel(f)) }))]" placeholder="Выберите поле" class="ui-form-select" />
      </div>
      <div v-else-if="type === 'consumption'" class="ui-form-field">
        <label class="ui-form-label ui-form-label--with-help">Куда *
          <RefFieldHelp text="Нужно другое направление? Добавьте его в" :to="{ path: '/lands', query: { tab: 'storage-consumption-targets' } }" link-label="Справочники хранения" />
        </label>
        <UiSelect v-model="form.target" :options="[...(refs.targets.value).map((t) => ({ value: t.id, label: String(t.label) }))]" class="ui-form-select" />
      </div>
      <div v-else class="ui-form-field">
        <label class="ui-form-label ui-form-label--with-help">Причина *
          <RefFieldHelp text="Нет нужной причины? Добавьте её в" :to="{ path: '/lands', query: { tab: 'storage-writeoff-reasons' } }" link-label="Справочники хранения" />
        </label>
        <UiSelect v-model="form.reasonId" :options="[...(refs.reasons.value).map((r) => ({ value: r.id, label: String(r.label) }))]" placeholder="Выберите причину" class="ui-form-select" />
      </div>
    </div>

    <p class="ui-form-section-title">Из каких партий</p>
    <div v-for="(line, i) in lines" :key="i" class="stock-line">
      <UiSelect v-model="line.source" :options="[...(sources).map((p) => ({ value: p.key, label: `${p.label} · ${formatTons(p.tons)}` }))]" placeholder="Партия в ячейке" class="ui-form-select" />
      <Input v-model.trim="line.tons" inputmode="decimal" class="ui-form-input stock-line-tons" placeholder="т" />
      <Button variant="ghost" size="icon-sm" v-if="lines.length > 1" type="button" class="stock-line-remove text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Убрать строку" @click="removeLine(i)">
        <XIcon :size="16" />
      </Button>
      <p v-if="parsedLines[i].over" class="ui-form-hint stock-line-hint">
        Больше остатка: доступно {{ formatTons(parsedLines[i].src?.available) }}
      </p>
    </div>
    <div class="stock-lines-footer">
      <Button variant="outline" v-if="sources.length > lines.length" type="button" class="ui-soft-btn" @click="addLine">+ Ещё партия</Button>
      <span class="ui-strong">Итого {{ formatTons(totalTons) }}</span>
    </div>
    <p v-if="duplicate" class="ui-form-error">Одна и та же партия в ячейке выбрана дважды.</p>

    <template v-if="type === 'sale'">
      <div class="ui-form-row ui-form-row--three">
        <div class="ui-form-field">
          <label class="ui-form-label">Цена за тонну, ₽</label>
          <Input v-model.trim="form.pricePerTon" inputmode="decimal" class="ui-form-input" />
        </div>
        <div class="ui-form-field">
          <label class="ui-form-label">Сумма</label>
          <input :value="formatRub(amount)" class="ui-form-input" readonly tabindex="-1" />
        </div>
        <div class="ui-form-field">
          <label class="ui-form-label">Вес у покупателя, т</label>
          <Input v-model.trim="form.buyerNet" inputmode="decimal" class="ui-form-input" />
        </div>
      </div>
    </template>

    <template v-if="type === 'sale' || type === 'consumption' || type === 'seeding'">
      <div class="ui-form-row ui-form-row--two">
        <div class="ui-form-field">
          <label class="ui-form-label">Госномер машины</label>
          <Input v-model.trim="form.vehiclePlate" class="ui-form-input" />
        </div>
        <div class="ui-form-field">
          <label class="ui-form-label">Водитель</label>
          <Input v-model.trim="form.driverName" class="ui-form-input" />
        </div>
      </div>
    </template>
    <div class="ui-form-row ui-form-row--two">
      <div v-if="type !== 'writeoff'" class="ui-form-field">
        <label class="ui-form-label">ТТН / накладная №</label>
        <Input v-model.trim="form.waybillNumber" class="ui-form-input" />
      </div>
      <div v-if="type === 'sale'" class="ui-form-field">
        <label class="ui-form-label">СДИЗ № (ФГИС «Зерно»)</label>
        <Input v-model.trim="form.sdizNumber" class="ui-form-input" />
      </div>
      <div v-if="type === 'writeoff'" class="ui-form-field">
        <label class="ui-form-label">Акт №</label>
        <Input v-model.trim="form.actNumber" class="ui-form-input" />
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
@layer legacy {
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
}
</style>
