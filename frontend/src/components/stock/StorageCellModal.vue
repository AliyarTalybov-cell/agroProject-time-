<script setup lang="ts">
import UiSelect from '@/components/ui/UiSelect.vue'
/** Ячейка склада. Тип — из справочника «Типы мест хранения» (силос, бункер, секция…). */
import { computed, onMounted, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  loadLocationTypes,
  parseDecimalInput,
  saveStorageCell,
  type CellWithStock,
  type LocationTypeOption,
} from '@/lib/stockLedger'

const props = defineProps<{ locationId: string; cell?: CellWithStock | null }>()
const emit = defineEmits<{ close: []; done: [] }>()

const isMain = computed(() => props.cell?.kind === 'main')
const types = ref<LocationTypeOption[]>([])
const form = ref({
  name: props.cell?.name ?? '',
  typeId: props.cell?.location_type_id ?? '',
  capacity: props.cell?.capacity_tons != null ? String(props.cell.capacity_tons).replace('.', ',') : '',
})
const saving = ref(false)
const error = ref<string | null>(null)
const capacity = computed(() => parseDecimalInput(form.value.capacity))
const canSave = computed(
  () => form.value.name.trim().length > 0 && (isMain.value || Boolean(form.value.typeId)) && (capacity.value == null || capacity.value > 0),
)

onMounted(async () => {
  try {
    types.value = await loadLocationTypes()
    if (!form.value.typeId && !isMain.value) form.value.typeId = types.value.find((t) => t.name === 'Силос')?.id ?? types.value[0]?.id ?? ''
  } catch (e) {
    error.value = formatSupabaseError(e)
  }
})

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = null
  try {
    await saveStorageCell(props.cell?.id ?? null, props.locationId, {
      name: form.value.name,
      location_type_id: isMain.value ? null : form.value.typeId || null,
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
        <label class="ui-form-label ui-form-label--with-help">Тип *
          <RefFieldHelp text="Нет нужного типа? Добавьте его в" :to="{ path: '/lands', query: { tab: 'storage-types' } }" link-label="Справочники хранения" />
        </label>
        <UiSelect v-model="form.typeId" :options="[...(types).map((t) => ({ value: t.id, label: String(t.name) }))]" placeholder="Выберите тип" v-if="!isMain" class="ui-form-select" />
        <input v-else class="ui-form-input" value="Основная" readonly tabindex="-1" />
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
