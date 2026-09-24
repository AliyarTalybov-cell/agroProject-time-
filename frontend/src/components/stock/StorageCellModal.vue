<script setup lang="ts">
/** Ячейка склада: силос, бункер, секция, площадка, бурт. */
import { computed, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  STORAGE_CELL_KINDS,
  parseDecimalInput,
  saveStorageCell,
  storageCellKindLabel,
  type CellWithStock,
  type StorageCellKind,
} from '@/lib/stockLedger'

const props = defineProps<{ locationId: string; cell?: CellWithStock | null }>()
const emit = defineEmits<{ close: []; done: [] }>()

const form = ref({
  name: props.cell?.name ?? '',
  kind: (props.cell?.kind ?? 'silo') as StorageCellKind,
  capacity: props.cell?.capacity_tons != null ? String(props.cell.capacity_tons).replace('.', ',') : '',
})
const saving = ref(false)
const error = ref<string | null>(null)
const capacity = computed(() => parseDecimalInput(form.value.capacity))
const canSave = computed(() => form.value.name.trim().length > 0 && (capacity.value == null || capacity.value > 0))

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = null
  try {
    await saveStorageCell(props.cell?.id ?? null, props.locationId, {
      name: form.value.name,
      kind: props.cell?.kind === 'main' ? 'main' : form.value.kind,
      capacity_tons: capacity.value,
    })
    emit('done')
  } catch (e) {
    const msg = formatSupabaseError(e)
    error.value = msg.includes('duplicate') ? 'Ячейка с таким названием на этом складе уже есть' : msg
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :title="cell ? 'Ячейка склада' : 'Новая ячейка склада'" :close-disabled="saving" @close="emit('close')">
    <div class="ui-form-row ui-form-row--two">
      <div class="ui-form-field">
        <label class="ui-form-label">Название *</label>
        <input v-model.trim="form.name" class="ui-form-input" placeholder="Например: Силос 3" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Тип</label>
        <select v-model="form.kind" class="ui-form-select" :disabled="cell?.kind === 'main'">
          <option v-if="cell?.kind === 'main'" value="main">Основная</option>
          <option v-for="k in STORAGE_CELL_KINDS" :key="k" :value="k">{{ storageCellKindLabel(k) }}</option>
        </select>
      </div>
    </div>
    <div class="ui-form-field">
      <label class="ui-form-label">Вместимость, т</label>
      <input v-model.trim="form.capacity" inputmode="decimal" class="ui-form-input" placeholder="Можно не указывать" />
      <p class="ui-form-hint">Если указана, принять больше не получится.</p>
    </div>
    <p v-if="error" class="ui-form-error">{{ error }}</p>
    <template #actions>
      <UiButton :disabled="saving" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" :disabled="saving || !canSave" @click="save">{{ saving ? 'Сохранение…' : 'Сохранить' }}</UiButton>
    </template>
  </UiModal>
</template>
