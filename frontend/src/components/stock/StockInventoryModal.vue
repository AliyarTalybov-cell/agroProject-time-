<script setup lang="ts">
import { Input } from '@/components/ui/shadcn/input'
import UiDateTimePicker from '@/components/ui/UiDateTimePicker.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/**
 * Инвентаризация ячейки: для каждой партии в ячейке вводится фактический
 * остаток, разница с учётом проводится корректировкой.
 */
import { computed, onMounted, ref, watch } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { formatTons, parseDecimalInput, postInventory } from '@/lib/stockLedger'
import { localInputToIso, nowLocalInput, useStockRefs } from '@/composables/useStockRefs'

const props = defineProps<{ locationId: string }>()
const emit = defineEmits<{ close: []; done: [] }>()

const refs = useStockRefs()
const saving = ref(false)
const error = ref<string | null>(null)
const docDate = ref(nowLocalInput())
const actNumber = ref('')
const comment = ref('')
const cellId = ref('')
const actual = ref<Record<string, string>>({})

const cells = computed(() => refs.cellOptions.value.filter((c) => c.locationId === props.locationId))
const rows = computed(() =>
  refs.placements.value
    .filter((p) => p.cellId === cellId.value)
    .map((p) => ({ batchId: p.batchId, code: refs.batchById.value.get(p.batchId)?.code ?? '', book: p.tons })),
)

watch(rows, (list) => {
  actual.value = Object.fromEntries(list.map((r) => [r.batchId, String(r.book).replace('.', ',')]))
})

onMounted(async () => {
  await refs.reload()
  cellId.value = cells.value.find((c) => c.tons > 0)?.id ?? cells.value[0]?.id ?? ''
})

function diff(batchId: string, book: number): number | null {
  const v = parseDecimalInput(actual.value[batchId])
  return v == null ? null : Number((v - book).toFixed(3))
}

const canSave = computed(
  () => rows.value.length > 0 && rows.value.every((r) => (parseDecimalInput(actual.value[r.batchId]) ?? -1) >= 0),
)

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = null
  try {
    await postInventory({
      doc_date: localInputToIso(docDate.value),
      cell_id: cellId.value,
      act_number: actNumber.value,
      comment: comment.value,
      lines: rows.value.map((r) => ({ batch_id: r.batchId, actual_tons: parseDecimalInput(actual.value[r.batchId])! })),
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
  <UiModal title="Инвентаризация ячейки" :max-width="620" :close-disabled="saving" @close="emit('close')">
    <div class="ui-form-row ui-form-row--three">
      <div class="ui-form-field">
        <label class="ui-form-label">Ячейка *</label>
        <UiSelect v-model="cellId" :options="[...(cells).map((c) => ({ value: c.id, label: String(c.label) }))]" class="ui-form-select" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Дата и время *</label>
        <UiDateTimePicker v-model="docDate" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Акт №</label>
        <Input v-model.trim="actNumber" class="ui-form-input" />
      </div>
    </div>

    <p v-if="!rows.length" class="ui-alert">В ячейке нет зерна по учёту.</p>
    <div v-else class="ui-table-wrap">
      <table class="ui-table">
        <thead>
          <tr><th>Партия</th><th class="ui-num">По учёту</th><th class="ui-num">Фактически, т</th><th class="ui-num">Разница</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.batchId">
            <td class="ui-strong">{{ r.code }}</td>
            <td class="ui-num">{{ formatTons(r.book, 3) }}</td>
            <td class="ui-num"><Input v-model.trim="actual[r.batchId]" inputmode="decimal" class="ui-form-input inv-input" /></td>
            <td class="ui-num" :class="{ 'ui-plus': (diff(r.batchId, r.book) ?? 0) > 0, 'ui-minus': (diff(r.batchId, r.book) ?? 0) < 0 }">
              {{ diff(r.batchId, r.book) == null ? '—' : formatTons(diff(r.batchId, r.book), 3) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="ui-form-field">
      <label class="ui-form-label">Комментарий</label>
      <textarea v-model.trim="comment" class="ui-form-textarea" rows="2" />
    </div>
    <p v-if="error" class="ui-form-error">{{ error }}</p>
    <template #actions>
      <UiButton :disabled="saving" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" :disabled="saving || !canSave" @click="save">
        {{ saving ? 'Проводим…' : 'Провести инвентаризацию' }}
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
@layer legacy {
.inv-input {
  max-width: 130px;
  margin-left: auto;
  text-align: right;
}
}
</style>
