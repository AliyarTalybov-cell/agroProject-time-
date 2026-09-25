<script setup lang="ts">
import { Input } from '@/components/ui/shadcn/input'
import UiDateTimePicker from '@/components/ui/UiDateTimePicker.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/**
 * Перемещение партии из ячейки в ячейку (в том числе на другой склад).
 * Потери в пути уменьшают приход в ячейку назначения.
 */
import { computed, onMounted, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { formatTons, parseDecimalInput, postTransfer } from '@/lib/stockLedger'
import { localInputToIso, nowLocalInput, useStockRefs } from '@/composables/useStockRefs'

const props = defineProps<{ locationId?: string | null; batchId?: string | null }>()
const emit = defineEmits<{ close: []; done: [] }>()

const refs = useStockRefs()
const saving = ref(false)
const error = ref<string | null>(null)

const form = ref({
  docDate: nowLocalInput(),
  source: '',
  toCellId: '',
  tons: '',
  loss: '',
  vehiclePlate: '',
  driverName: '',
  waybillNumber: '',
  sdizNumber: '',
  comment: '',
})

const sources = computed(() =>
  refs.placementOptions.value.filter(
    (p) => (!props.locationId || p.locationId === props.locationId) && (!props.batchId || p.batchId === props.batchId),
  ),
)
const source = computed(() => refs.placementOptions.value.find((p) => p.key === form.value.source) ?? null)
const targets = computed(() => refs.cellOptions.value.filter((c) => c.id !== source.value?.cellId))

onMounted(async () => {
  await refs.reload()
  if (sources.value.length === 1) form.value.source = sources.value[0].key
})

const tons = computed(() => parseDecimalInput(form.value.tons))
const loss = computed(() => parseDecimalInput(form.value.loss) ?? 0)
const arrives = computed(() => (tons.value != null ? Number((tons.value - loss.value).toFixed(3)) : null))

const canSave = computed(
  () =>
    Boolean(source.value && form.value.toCellId) &&
    tons.value != null &&
    tons.value > 0 &&
    tons.value <= (source.value?.available ?? 0) &&
    loss.value >= 0 &&
    loss.value < tons.value,
)

async function save() {
  if (!canSave.value || !source.value || tons.value == null) return
  saving.value = true
  error.value = null
  const f = form.value
  try {
    await postTransfer({
      doc_date: localInputToIso(f.docDate),
      batch_id: source.value.batchId,
      from_cell_id: source.value.cellId,
      to_cell_id: f.toCellId,
      tons: tons.value,
      loss_tons: loss.value || null,
      vehicle_plate: f.vehiclePlate,
      driver_name: f.driverName,
      waybill_number: f.waybillNumber,
      sdiz_number: f.sdizNumber,
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
  <UiModal title="Перемещение зерна" :max-width="620" :close-disabled="saving" @close="emit('close')">
    <p v-if="refs.error.value" class="ui-form-error">{{ refs.error.value }}</p>
    <p v-else-if="!refs.loading.value && !sources.length" class="ui-alert">На складе нет зерна для перемещения.</p>

    <div class="ui-form-field">
      <label class="ui-form-label">Что и откуда *</label>
      <UiSelect v-model="form.source" :options="[...(sources).map((p) => ({ value: p.key, label: `${p.label} · ${formatTons(p.tons)}` }))]" placeholder="Выберите партию в ячейке" class="ui-form-select" />
    </div>
    <div class="ui-form-field">
      <label class="ui-form-label">Куда *</label>
      <UiSelect v-model="form.toCellId" :options="[...(targets).map((c) => ({ value: c.id, label: `${c.label}${c.cropLabel ? ` · ${c.cropLabel}, ${formatTons(c.tons)}` : ' · пусто'}` }))]" placeholder="Выберите ячейку" class="ui-form-select" />
    </div>
    <div class="ui-form-row ui-form-row--three">
      <div class="ui-form-field">
        <label class="ui-form-label">Дата и время *</label>
        <UiDateTimePicker v-model="form.docDate" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Масса, т *</label>
        <Input v-model.trim="form.tons" inputmode="decimal" class="ui-form-input" />
        <p v-if="source" class="ui-form-hint">Доступно {{ formatTons(source.available) }}</p>
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Потери в пути, т</label>
        <Input v-model.trim="form.loss" inputmode="decimal" class="ui-form-input" placeholder="0" />
        <p v-if="arrives != null && loss > 0" class="ui-form-hint">Придёт {{ formatTons(arrives) }}</p>
      </div>
    </div>
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
    <div class="ui-form-row ui-form-row--two">
      <div class="ui-form-field">
        <label class="ui-form-label">ТТН / накладная №</label>
        <Input v-model.trim="form.waybillNumber" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">СДИЗ №</label>
        <Input v-model.trim="form.sdizNumber" class="ui-form-input" />
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
        {{ saving ? 'Проводим…' : 'Переместить' }}
      </UiButton>
    </template>
  </UiModal>
</template>
