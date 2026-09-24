<script setup lang="ts">
/** Отмена документа сторно — только руководитель; причина обязательна. */
import { computed, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { cancelStockDocument, stockDocTypeLabel, type StockDocument } from '@/lib/stockLedger'

const props = defineProps<{ document: StockDocument }>()
const emit = defineEmits<{ close: []; done: [] }>()

const reason = ref('')
const saving = ref(false)
const error = ref<string | null>(null)
const canSave = computed(() => reason.value.trim().length > 2)

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = null
  try {
    await cancelStockDocument(props.document.id, reason.value.trim())
    emit('done')
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :title="`Отменить документ «${stockDocTypeLabel(document.doc_type)}» № ${document.number}?`" :max-width="480" :close-disabled="saving" @close="emit('close')">
    <p class="ui-muted" style="margin: 0">
      Документ не удаляется: создаётся сторно с обратными движениями, остатки вернутся как было до него.
    </p>
    <div class="ui-form-field">
      <label class="ui-form-label">Причина отмены *</label>
      <textarea v-model="reason" class="ui-form-textarea" rows="3" placeholder="Например: ошибка в весе" />
    </div>
    <p v-if="error" class="ui-form-error">{{ error }}</p>
    <template #actions>
      <UiButton :disabled="saving" @click="emit('close')">Не отменять</UiButton>
      <UiButton variant="danger" :disabled="saving || !canSave" @click="save">{{ saving ? 'Отменяем…' : 'Отменить документ' }}</UiButton>
    </template>
  </UiModal>
</template>
