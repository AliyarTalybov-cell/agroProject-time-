<script setup lang="ts">
import { Input } from '@/components/ui/shadcn/input'
import UiDateTimePicker from '@/components/ui/UiDateTimePicker.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/**
 * Подработка (сушка, очистка): из массы «до» остаётся масса «после», разница —
 * усушка и отходы. Показатели после подработки обновляют качество партии.
 */
import { computed, onMounted, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { formatTons, parseDecimalInput, postProcessing } from '@/lib/stockLedger'
import { localInputToIso, nowLocalInput, useStockRefs } from '@/composables/useStockRefs'

const props = defineProps<{ locationId?: string | null; batchId?: string | null }>()
const emit = defineEmits<{ close: []; done: [] }>()

const refs = useStockRefs()
const saving = ref(false)
const error = ref<string | null>(null)
const form = ref({
  docDate: nowLocalInput(),
  source: '',
  before: '',
  after: '',
  moisture: '',
  weed: '',
  grainImpurity: '',
  comment: '',
})

const sources = computed(() =>
  refs.placementOptions.value.filter(
    (p) => (!props.locationId || p.locationId === props.locationId) && (!props.batchId || p.batchId === props.batchId),
  ),
)
const source = computed(() => refs.placementOptions.value.find((p) => p.key === form.value.source) ?? null)

onMounted(async () => {
  await refs.reload()
  if (sources.value.length === 1) form.value.source = sources.value[0].key
})

const before = computed(() => parseDecimalInput(form.value.before))
const after = computed(() => parseDecimalInput(form.value.after))
const loss = computed(() => (before.value != null && after.value != null ? Number((before.value - after.value).toFixed(3)) : null))

const canSave = computed(
  () =>
    Boolean(source.value) &&
    before.value != null &&
    before.value > 0 &&
    before.value <= (source.value?.available ?? 0) &&
    after.value != null &&
    after.value >= 0 &&
    after.value < before.value,
)

async function save() {
  if (!canSave.value || !source.value) return
  saving.value = true
  error.value = null
  try {
    await postProcessing({
      doc_date: localInputToIso(form.value.docDate),
      batch_id: source.value.batchId,
      cell_id: source.value.cellId,
      tons_before: before.value!,
      tons_after: after.value!,
      quality: {
        moisture: parseDecimalInput(form.value.moisture),
        weed_impurity: parseDecimalInput(form.value.weed),
        grain_impurity: parseDecimalInput(form.value.grainImpurity),
      },
      comment: form.value.comment,
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
  <UiModal title="Подработка: сушка, очистка" :max-width="600" :close-disabled="saving" @close="emit('close')">
    <p v-if="refs.error.value" class="ui-form-error">{{ refs.error.value }}</p>
    <div class="ui-form-field">
      <label class="ui-form-label">Партия в ячейке *</label>
      <UiSelect v-model="form.source" :options="[...(sources).map((p) => ({ value: p.key, label: `${p.label} · ${formatTons(p.tons)}` }))]" placeholder="Выберите партию" class="ui-form-select" />
    </div>
    <div class="ui-form-row ui-form-row--three">
      <div class="ui-form-field">
        <label class="ui-form-label">Дата и время *</label>
        <UiDateTimePicker v-model="form.docDate" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Масса до, т *</label>
        <Input v-model.trim="form.before" inputmode="decimal" class="ui-form-input" />
        <p v-if="source" class="ui-form-hint">В ячейке {{ formatTons(source.available) }}</p>
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Масса после, т *</label>
        <Input v-model.trim="form.after" inputmode="decimal" class="ui-form-input" />
        <p v-if="loss != null && loss > 0" class="ui-form-hint">Усушка и отходы {{ formatTons(loss, 3) }}</p>
      </div>
    </div>
    <p class="ui-form-section-title">Качество после подработки</p>
    <div class="ui-form-row ui-form-row--three">
      <div class="ui-form-field">
        <label class="ui-form-label">Влажность, %</label>
        <Input v-model.trim="form.moisture" inputmode="decimal" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Сорная примесь, %</label>
        <Input v-model.trim="form.weed" inputmode="decimal" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Зерновая примесь, %</label>
        <Input v-model.trim="form.grainImpurity" inputmode="decimal" class="ui-form-input" />
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
        {{ saving ? 'Проводим…' : 'Провести подработку' }}
      </UiButton>
    </template>
  </UiModal>
</template>
