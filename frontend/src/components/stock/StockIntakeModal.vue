<script setup lang="ts">
/**
 * Приёмка зерна: с поля или закупка. Новая партия или досыпка в существующую
 * той же культуры. В журнал идёт зачётный вес (computeCreditedWeight) —
 * формула та же, что была в прежней форме приёмки.
 */
import { computed, onMounted, ref, watch } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  computeCreditedWeight,
  fieldOptionLabel,
  formatRub,
  formatTons,
  parseDecimalInput,
  postIntake,
  type StockPurpose,
} from '@/lib/stockLedger'
import { localInputToIso, nowLocalInput, useStockRefs } from '@/composables/useStockRefs'

const props = defineProps<{ locationId?: string | null }>()
const emit = defineEmits<{ close: []; done: [] }>()

const refs = useStockRefs()
const saving = ref(false)
const error = ref<string | null>(null)

const form = ref({
  docDate: nowLocalInput(),
  origin: 'field' as 'field' | 'purchase',
  mode: 'new' as 'new' | 'existing',
  batchId: '',
  cropKey: '',
  fieldId: '',
  supplierId: '',
  variety: '',
  harvestYear: String(new Date().getFullYear()),
  purpose: 'food' as StockPurpose,
  fgisBatchNumber: '',
  cellId: '',
  grossTruck: '',
  tare: '',
  mass: '',
  moisture: '',
  weed: '0',
  grainImpurity: '0',
  nature: '',
  gluten: '',
  protein: '',
  vehiclePlate: '',
  driverName: '',
  waybillNumber: '',
  sdizNumber: '',
  pricePerTon: '',
  comment: '',
})

onMounted(async () => {
  await refs.reload()
  const firstCell = refs.cellOptions.value.find((c) => !props.locationId || c.locationId === props.locationId)
  if (firstCell) form.value.cellId = firstCell.id
})

const cellsForLocation = computed(() =>
  refs.cellOptions.value.filter((c) => !props.locationId || c.locationId === props.locationId),
)

/** Партии для досыпки — той же культуры, с остатком. */
const existingBatches = computed(() => refs.batches.value.filter((b) => b.tons > 0))
const selectedBatch = computed(() => refs.batchById.value.get(form.value.batchId) ?? null)
const effectiveCropKey = computed(() =>
  form.value.mode === 'existing' ? selectedBatch.value?.crop_key ?? '' : form.value.cropKey,
)
const baseMoisture = computed(() => {
  const c = refs.crops.value.find((x) => x.key === effectiveCropKey.value)
  const v = Number(c?.base_moisture_percent)
  return Number.isFinite(v) && v >= 0 && v < 100 ? v : 14
})

// Масса зерна: из весовой (брутто − тара), если оба веса введены, иначе вручную.
const truckNet = computed(() => {
  const g = parseDecimalInput(form.value.grossTruck)
  const t = parseDecimalInput(form.value.tare)
  if (g == null || t == null) return null
  return Number((g - t).toFixed(3))
})
watch(truckNet, (v) => {
  if (v != null && v > 0) form.value.mass = String(v).replace('.', ',')
})

const credited = computed(() =>
  computeCreditedWeight({
    massTons: parseDecimalInput(form.value.mass),
    moisturePercent: parseDecimalInput(form.value.moisture),
    baseMoisturePercent: baseMoisture.value,
    weedImpurityPercent: parseDecimalInput(form.value.weed) ?? 0,
    grainImpurityPercent: parseDecimalInput(form.value.grainImpurity) ?? 0,
  }),
)

const selectedCell = computed(() => refs.cellOptions.value.find((c) => c.id === form.value.cellId) ?? null)
const cellCropWarning = computed(() => {
  const cell = selectedCell.value
  const crop = refs.crops.value.find((c) => c.key === effectiveCropKey.value)
  if (!cell || !crop || !cell.cropLabel || cell.tons <= 0) return null
  return cell.cropLabel !== crop.label ? `В ячейке лежит «${cell.cropLabel}» — другую культуру сюда принять нельзя.` : null
})

const amount = computed(() => {
  const price = parseDecimalInput(form.value.pricePerTon)
  if (price == null || !credited.value) return null
  return Number((price * credited.value.netTons).toFixed(2))
})

const canSave = computed(() => {
  const f = form.value
  if (!f.cellId || !credited.value || credited.value.netTons <= 0) return false
  if (f.mode === 'existing') return Boolean(f.batchId)
  if (!f.cropKey) return false
  return f.origin === 'field' ? Boolean(f.fieldId) : Boolean(f.supplierId)
})

async function save() {
  if (!canSave.value || !credited.value) return
  saving.value = true
  error.value = null
  const f = form.value
  try {
    await postIntake({
      doc_date: localInputToIso(f.docDate),
      cell_id: f.cellId,
      net_tons: credited.value.netTons,
      counterparty_id: f.origin === 'purchase' ? f.supplierId : null,
      field_id: f.origin === 'field' ? f.fieldId : null,
      vehicle_plate: f.vehiclePlate,
      driver_name: f.driverName,
      waybill_number: f.waybillNumber,
      sdiz_number: f.sdizNumber,
      price_per_ton: f.origin === 'purchase' ? parseDecimalInput(f.pricePerTon) : null,
      amount: f.origin === 'purchase' ? amount.value : null,
      comment: f.comment,
      weights: {
        gross: parseDecimalInput(f.grossTruck),
        tare: parseDecimalInput(f.tare),
        grain_mass: parseDecimalInput(f.mass),
        dry_mass: credited.value.dryMassTons,
        impurity_loss: credited.value.impurityLossTons,
        net: credited.value.netTons,
      },
      quality: {
        moisture: parseDecimalInput(f.moisture),
        base_moisture: baseMoisture.value,
        weed_impurity: parseDecimalInput(f.weed),
        grain_impurity: parseDecimalInput(f.grainImpurity),
        nature: parseDecimalInput(f.nature),
        gluten: parseDecimalInput(f.gluten),
        protein: parseDecimalInput(f.protein),
      },
      ...(f.mode === 'existing'
        ? { batch_id: f.batchId }
        : {
            batch: {
              crop_key: f.cropKey,
              origin: f.origin,
              field_id: f.origin === 'field' ? f.fieldId : null,
              variety: f.variety,
              harvest_year: parseDecimalInput(f.harvestYear),
              purpose: f.purpose,
              fgis_batch_number: f.fgisBatchNumber,
            },
          }),
    })
    emit('done')
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    saving.value = false
  }
}

function num(v: number | null | undefined, digits = 2): string {
  return v == null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: digits })
}
</script>

<template>
  <UiModal title="Приёмка зерна" :max-width="720" :close-disabled="saving" @close="emit('close')">
    <p v-if="refs.error.value" class="ui-form-error">{{ refs.error.value }}</p>

    <div class="ui-form-row ui-form-row--two">
      <div class="ui-form-field">
        <label class="ui-form-label">Дата и время *</label>
        <input v-model="form.docDate" type="datetime-local" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Куда (ячейка склада) *</label>
        <select v-model="form.cellId" class="ui-form-select">
          <option v-for="c in cellsForLocation" :key="c.id" :value="c.id">
            {{ c.label }}{{ c.cropLabel ? ` · ${c.cropLabel}, ${formatTons(c.tons)}` : ' · пусто' }}
          </option>
        </select>
      </div>
    </div>

    <div class="ui-form-row ui-form-row--two">
      <div class="ui-form-field">
        <label class="ui-form-label">Откуда зерно *</label>
        <select v-model="form.origin" class="ui-form-select" :disabled="form.mode === 'existing'">
          <option value="field">С поля (урожай)</option>
          <option value="purchase">Закупка у поставщика</option>
        </select>
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Партия *</label>
        <select v-model="form.mode" class="ui-form-select">
          <option value="new">Новая партия</option>
          <option value="existing">Досыпать в существующую</option>
        </select>
      </div>
    </div>

    <template v-if="form.mode === 'existing'">
      <div class="ui-form-field">
        <label class="ui-form-label">Существующая партия *</label>
        <select v-model="form.batchId" class="ui-form-select">
          <option value="" disabled>Выберите партию</option>
          <option v-for="b in existingBatches" :key="b.id" :value="b.id">
            {{ b.code }} · {{ b.cropLabel }} · {{ formatTons(b.tons) }}
          </option>
        </select>
      </div>
    </template>
    <template v-else>
      <div class="ui-form-row ui-form-row--two">
        <div class="ui-form-field">
          <label class="ui-form-label ui-form-label--with-help">Культура *
            <RefFieldHelp text="Нет нужной культуры? Добавьте её в" :to="{ path: '/lands', query: { tab: 'crops-refs' } }" link-label="Справочники СХ культур" />
          </label>
          <select v-model="form.cropKey" class="ui-form-select">
            <option value="" disabled>Выберите культуру</option>
            <option v-for="c in refs.crops.value" :key="c.key" :value="c.key">{{ c.label }}</option>
          </select>
        </div>
        <div v-if="form.origin === 'field'" class="ui-form-field">
          <label class="ui-form-label">Поле *</label>
          <select v-model="form.fieldId" class="ui-form-select">
            <option value="" disabled>Выберите поле</option>
            <option v-for="f in refs.fields.value" :key="f.id" :value="f.id">{{ fieldOptionLabel(f) }}</option>
          </select>
        </div>
        <div v-else class="ui-form-field">
          <label class="ui-form-label ui-form-label--with-help">Поставщик *
            <RefFieldHelp text="Нет поставщика? Добавьте его в" :to="{ path: '/grain/counterparties' }" link-label="Контрагенты" />
          </label>
          <select v-model="form.supplierId" class="ui-form-select">
            <option value="" disabled>{{ refs.suppliers.value.length ? 'Выберите поставщика' : 'Сначала добавьте поставщика в «Контрагентах»' }}</option>
            <option v-for="s in refs.suppliers.value" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
      </div>
      <div class="ui-form-row ui-form-row--three">
        <div class="ui-form-field">
          <label class="ui-form-label">Сорт</label>
          <input v-model.trim="form.variety" class="ui-form-input" placeholder="Например: Скипетр" />
        </div>
        <div class="ui-form-field">
          <label class="ui-form-label">Урожай года</label>
          <input v-model.trim="form.harvestYear" inputmode="numeric" class="ui-form-input" />
        </div>
        <div class="ui-form-field">
          <label class="ui-form-label ui-form-label--with-help">Назначение
            <RefFieldHelp text="Нужно своё назначение? Добавьте его в" :to="{ path: '/lands', query: { tab: 'storage-purposes' } }" link-label="Справочники хранения" />
          </label>
          <select v-model="form.purpose" class="ui-form-select">
            <option v-for="p in refs.purposes.value" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
      </div>
    </template>
    <p v-if="cellCropWarning" class="ui-form-error">{{ cellCropWarning }}</p>

    <p class="ui-form-section-title">Весовая</p>
    <div class="ui-form-row ui-form-row--three">
      <div class="ui-form-field">
        <label class="ui-form-label">Брутто (машина с грузом), т</label>
        <input v-model.trim="form.grossTruck" inputmode="decimal" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Тара, т</label>
        <input v-model.trim="form.tare" inputmode="decimal" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Масса зерна, т *</label>
        <input v-model.trim="form.mass" inputmode="decimal" class="ui-form-input" />
      </div>
    </div>

    <p class="ui-form-section-title">Лаборатория</p>
    <div class="ui-form-row ui-form-row--three">
      <div class="ui-form-field">
        <label class="ui-form-label">Влажность, % *</label>
        <input v-model.trim="form.moisture" inputmode="decimal" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Сорная примесь, %</label>
        <input v-model.trim="form.weed" inputmode="decimal" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Зерновая примесь, %</label>
        <input v-model.trim="form.grainImpurity" inputmode="decimal" class="ui-form-input" />
      </div>
    </div>
    <div class="ui-form-row ui-form-row--three">
      <div class="ui-form-field">
        <label class="ui-form-label">Натура, г/л</label>
        <input v-model.trim="form.nature" inputmode="decimal" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Клейковина, %</label>
        <input v-model.trim="form.gluten" inputmode="decimal" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Протеин, %</label>
        <input v-model.trim="form.protein" inputmode="decimal" class="ui-form-input" />
      </div>
    </div>

    <div class="ui-summary">
      <div class="ui-summary-row">
        <span>После сушки: {{ num(parseDecimalInput(form.mass)) }} × (100 − {{ num(parseDecimalInput(form.moisture), 1) }}) / (100 − {{ num(baseMoisture, 1) }})</span>
        <strong>{{ num(credited?.dryMassTons) }} т</strong>
      </div>
      <div class="ui-summary-row">
        <span>Потери на примеси</span>
        <strong>−{{ num(credited?.impurityLossTons) }} т</strong>
      </div>
      <div class="ui-summary-row ui-summary-row--total">
        <span>Зачётный вес — пойдёт в остаток</span>
        <strong>{{ num(credited?.netTons) }} т</strong>
      </div>
    </div>

    <p class="ui-form-section-title">Документы и транспорт</p>
    <div class="ui-form-row ui-form-row--two">
      <div class="ui-form-field">
        <label class="ui-form-label">Госномер машины</label>
        <input v-model.trim="form.vehiclePlate" class="ui-form-input" placeholder="А123ВС46" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Водитель</label>
        <input v-model.trim="form.driverName" class="ui-form-input" />
      </div>
    </div>
    <div class="ui-form-row ui-form-row--three">
      <div class="ui-form-field">
        <label class="ui-form-label">ТТН / накладная №</label>
        <input v-model.trim="form.waybillNumber" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">СДИЗ № (ФГИС «Зерно»)</label>
        <input v-model.trim="form.sdizNumber" class="ui-form-input" />
      </div>
      <div v-if="form.mode === 'new'" class="ui-form-field">
        <label class="ui-form-label">Партия во ФГИС №</label>
        <input v-model.trim="form.fgisBatchNumber" class="ui-form-input" />
      </div>
    </div>
    <div v-if="form.origin === 'purchase'" class="ui-form-row ui-form-row--two">
      <div class="ui-form-field">
        <label class="ui-form-label">Цена за тонну, ₽</label>
        <input v-model.trim="form.pricePerTon" inputmode="decimal" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Сумма</label>
        <input :value="formatRub(amount)" class="ui-form-input" readonly tabindex="-1" />
      </div>
    </div>
    <div class="ui-form-field">
      <label class="ui-form-label">Комментарий</label>
      <textarea v-model.trim="form.comment" class="ui-form-textarea" rows="2" />
    </div>

    <p v-if="error" class="ui-form-error">{{ error }}</p>

    <template #actions>
      <UiButton :disabled="saving" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" :disabled="saving || !canSave" @click="save">
        {{ saving ? 'Проводим…' : 'Провести приёмку' }}
      </UiButton>
    </template>
  </UiModal>
</template>
