<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import {
  executeStorageWriteoff,
  loadStorageWriteoffBatchOptionById,
  loadStorageWriteoffBatchOptions,
  type StorageWriteoffBatchOption,
  type StorageWriteoffType,
} from '@/lib/storageWriteoffsSupabase'

const props = defineProps<{
  open: boolean
  storageLocationId?: string | null
  storageName?: string | null
  /** При открытии из карточки партии — партия фиксирована */
  batchId?: string | null
  batchCode?: string | null
  /** sale = только реализация; writeoff = переработка/порча/корма */
  mode?: 'sale' | 'writeoff' | null
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const loading = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)

const batchSearch = ref('')
const selectedBatchId = ref('')
const writeoffType = ref<StorageWriteoffType>('processing')
const massTons = ref('')
const operationDate = ref('')
const counterparty = ref('')
const comment = ref('')
const batchOptions = ref<StorageWriteoffBatchOption[]>([])

const lockedBatch = computed(() => Boolean(props.batchId))

const visibleTypeOptions = computed(() => {
  if (props.mode === 'sale') {
    return [{ value: 'sale' as const, label: 'Реализация' }]
  }
  if (props.mode === 'writeoff') {
    return [
      { value: 'processing' as const, label: 'Переработка' },
      { value: 'spoilage' as const, label: 'Порча' },
      { value: 'feed' as const, label: 'Корма' },
    ]
  }
  return typeOptionsAll
})

function nowDateLocal(): string {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

function parseDecimal(value: string): number | null {
  const n = Number(value.replace(',', '.').trim())
  if (!Number.isFinite(n)) return null
  return n
}

const massNum = computed(() => parseDecimal(massTons.value))

const filteredBatchOptions = computed(() => {
  const q = batchSearch.value.trim().toLowerCase()
  if (!q) return batchOptions.value
  return batchOptions.value.filter((x) =>
    `${x.code} ${x.cropLabel}`.toLowerCase().includes(q),
  )
})

const hasBatchOptions = computed(() => batchOptions.value.length > 0)

const selectedBatch = computed(() => {
  if (lockedBatch.value && props.batchId) {
    return batchOptions.value.find((x) => x.id === props.batchId) ?? null
  }
  return batchOptions.value.find((x) => x.id === selectedBatchId.value) ?? null
})

const effectiveBatchId = computed(() => props.batchId || selectedBatchId.value)

const maxMass = computed(() => Number(selectedBatch.value?.massTons || 0))

const massExceedsBatch = computed(() => {
  const m = massNum.value
  if (m == null || m <= 0) return false
  return m > maxMass.value + 0.0001
})

const canSubmit = computed(() => {
  if (!props.storageLocationId) return false
  if (!effectiveBatchId.value) return false
  if (!operationDate.value) return false
  if (writeoffType.value === 'sale' && !counterparty.value.trim()) return false
  const m = massNum.value
  if (m == null || m <= 0) return false
  if (massExceedsBatch.value) return false
  return true
})

const massErrorText = computed(() => {
  if (!massExceedsBatch.value) return ''
  return `Масса не может превышать остаток партии (${formatMass(maxMass.value)} т)`
})

const selectedTypeLabel = computed(
  () => visibleTypeOptions.value.find((x) => x.value === writeoffType.value)?.label || 'Списание',
)

const remainingAfterWriteoff = computed(() => {
  const m = massNum.value
  if (m == null || m <= 0 || !selectedBatch.value) return selectedBatch.value?.massTons || 0
  return Math.max(0, Number((selectedBatch.value.massTons - m).toFixed(3)))
})

const modalTitle = computed(() => {
  if (props.mode === 'sale') return 'Реализация зерна'
  const code = props.batchCode || selectedBatch.value?.code
  if (code) return `Списание зерна · ${code}`
  return 'Списание зерна'
})

const submitLabel = computed(() => {
  if (saving.value) return 'Проведение…'
  if (writeoffType.value === 'sale') return 'Провести реализацию'
  return 'Списать'
})

function resetForm() {
  batchSearch.value = ''
  selectedBatchId.value = props.batchId || ''
  writeoffType.value = props.mode === 'sale' ? 'sale' : 'processing'
  massTons.value = ''
  operationDate.value = nowDateLocal()
  counterparty.value = ''
  comment.value = ''
  formError.value = null
  batchOptions.value = []
}

async function loadBatches() {
  if (!props.storageLocationId) return
  loading.value = true
  formError.value = null
  try {
    if (props.batchId) {
      const one = await loadStorageWriteoffBatchOptionById(props.batchId)
      batchOptions.value = one && one.massTons > 0.0001 ? [one] : []
      selectedBatchId.value = props.batchId
    } else {
      batchOptions.value = await loadStorageWriteoffBatchOptions(props.storageLocationId)
    }
  } catch (e) {
    formError.value = e instanceof Error && e.message ? e.message : 'Не удалось загрузить партии'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      resetForm()
      document.body.style.overflow = 'hidden'
      void loadBatches()
    } else {
      document.body.style.overflow = ''
    }
  },
)

watch(writeoffType, (v) => {
  if (v !== 'sale') counterparty.value = ''
})

onUnmounted(() => {
  document.body.style.overflow = ''
})

function close() {
  if (saving.value) return
  emit('close')
}

async function submit() {
  if (!canSubmit.value || !props.storageLocationId || !effectiveBatchId.value) return
  const m = massNum.value
  if (m == null) return
  saving.value = true
  formError.value = null
  try {
    await executeStorageWriteoff({
      storageLocationId: props.storageLocationId,
      batchId: effectiveBatchId.value,
      writeoffType: writeoffType.value,
      massTons: m,
      operationDate: operationDate.value,
      counterparty: counterparty.value,
      comment: comment.value,
    })
    emit('success')
    emit('close')
  } catch (e) {
    formError.value = e instanceof Error && e.message ? e.message : 'Не удалось провести списание'
  } finally {
    saving.value = false
  }
}

function formatMass(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
}

const typeOptionsAll: Array<{ value: StorageWriteoffType; label: string }> = [
  { value: 'sale', label: 'Реализация' },
  { value: 'processing', label: 'Переработка' },
  { value: 'spoilage', label: 'Порча' },
  { value: 'feed', label: 'Корма' },
]
</script>

<template>
  <teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="warehouse-writeoff-title"
      @click.self="close"
    >
      <div class="modal warehouse-writeoff-modal" @click.stop>
        <header class="modal-header">
          <h2 id="warehouse-writeoff-title" class="modal-title">
            {{ modalTitle }}
            <span v-if="storageName && !batchCode" class="warehouse-writeoff-subtitle">· {{ storageName }}</span>
          </h2>
          <ModalCloseButton :disabled="saving" @click="close" />
        </header>

        <div class="modal-body warehouse-writeoff-body">
          <p v-if="formError" class="warehouse-writeoff-error" role="alert">{{ formError }}</p>

          <div class="warehouse-writeoff-grid">
            <template v-if="!lockedBatch">
              <label class="warehouse-writeoff-field warehouse-writeoff-field--full">
                <span class="warehouse-writeoff-label">Партия (поиск по реестру)</span>
                <input
                  v-model.trim="batchSearch"
                  type="text"
                  class="warehouse-writeoff-input"
                  :disabled="saving || loading"
                  placeholder="Введите номер партии или название культуры..."
                />
                <select
                  v-model="selectedBatchId"
                  class="warehouse-writeoff-input"
                  :disabled="saving || loading || !hasBatchOptions"
                >
                  <option value="">{{ hasBatchOptions ? 'Выберите партию' : 'Нет доступных партий' }}</option>
                  <option v-for="b in filteredBatchOptions" :key="b.id" :value="b.id">
                    {{ b.code }} · {{ b.cropLabel }} · {{ formatMass(b.massTons) }} т
                  </option>
                  <option
                    v-if="hasBatchOptions && batchSearch.trim() && !filteredBatchOptions.length"
                    value=""
                    disabled
                  >
                    Ничего не найдено по поиску
                  </option>
                </select>
                <span v-if="selectedBatch" class="warehouse-writeoff-hint">
                  Остаток в партии: <strong>{{ formatMass(selectedBatch.massTons) }} т</strong>
                </span>
                <span v-else-if="!loading && !hasBatchOptions" class="warehouse-writeoff-field-error">
                  Для списания нужна партия с остатком больше 0 т.
                </span>
              </label>
            </template>
            <p v-else-if="selectedBatch" class="warehouse-writeoff-batch-fixed">
              Партия <strong>{{ selectedBatch.code }}</strong> · остаток
              <strong>{{ formatMass(selectedBatch.massTons) }} т</strong>
            </p>
            <p v-else-if="lockedBatch && !loading" class="warehouse-writeoff-field-error">
              Партия закрыта или не найдена (остаток 0 т).
            </p>

            <div v-if="mode !== 'sale'" class="warehouse-writeoff-field warehouse-writeoff-field--full">
              <span class="warehouse-writeoff-label">Тип списания</span>
              <select v-model="writeoffType" class="warehouse-writeoff-input" :disabled="saving || mode === 'writeoff' && visibleTypeOptions.length <= 1">
                <option v-for="opt in visibleTypeOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <label class="warehouse-writeoff-field">
              <span class="warehouse-writeoff-label">Масса для списания (т)</span>
              <input
                v-model="massTons"
                type="text"
                inputmode="decimal"
                class="warehouse-writeoff-input"
                :class="{ 'warehouse-writeoff-input--invalid': massExceedsBatch }"
                :disabled="saving || !effectiveBatchId"
                placeholder="0.00"
              />
              <span v-if="massErrorText" class="warehouse-writeoff-field-error">{{ massErrorText }}</span>
            </label>

            <label class="warehouse-writeoff-field">
              <span class="warehouse-writeoff-label">Дата операции</span>
              <input v-model="operationDate" type="date" class="warehouse-writeoff-input" :disabled="saving" />
            </label>

            <label v-if="writeoffType === 'sale'" class="warehouse-writeoff-field warehouse-writeoff-field--full">
              <span class="warehouse-writeoff-label">Контрагент</span>
              <input
                v-model.trim="counterparty"
                type="text"
                class="warehouse-writeoff-input"
                :disabled="saving"
                placeholder="Название контрагента"
              />
            </label>

            <label class="warehouse-writeoff-field warehouse-writeoff-field--full">
              <span class="warehouse-writeoff-label">Комментарий</span>
              <textarea
                v-model.trim="comment"
                class="warehouse-writeoff-textarea"
                rows="3"
                :disabled="saving"
                placeholder="Необязательно"
              />
            </label>
          </div>

          <div
            v-if="selectedBatch && massNum && massNum > 0 && massExceedsBatch"
            class="warehouse-writeoff-warn"
            role="alert"
          >
            <svg class="warehouse-writeoff-warn-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <p class="warehouse-writeoff-warn-text">
              Сократите массу до <strong>{{ formatMass(maxMass) }} т</strong> или меньше, чтобы провести списание.
            </p>
          </div>

          <div
            v-else-if="selectedBatch && massNum && massNum > 0"
            class="warehouse-writeoff-info"
            role="status"
          >
            <svg class="warehouse-writeoff-info-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <p class="warehouse-writeoff-info-text">
              Будет выполнено <strong>{{ selectedTypeLabel.toLowerCase() }}</strong>: из партии
              <strong>{{ selectedBatch.code }}</strong> списывается <strong>{{ formatMass(massNum) }} т</strong>,
              остаток после операции — <strong>{{ formatMass(remainingAfterWriteoff) }} т</strong>.
              <template v-if="writeoffType === 'sale' && counterparty.trim()">
                Контрагент: <strong>{{ counterparty.trim() }}</strong>.
              </template>
            </p>
          </div>
        </div>

        <footer class="modal-actions warehouse-writeoff-actions">
          <button type="button" class="task-form-cancel" :disabled="saving" @click="close">Отмена</button>
          <button type="button" class="task-form-submit" :disabled="saving || !canSubmit" @click="submit">
            {{ submitLabel }}
          </button>
        </footer>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.warehouse-writeoff-modal {
  max-width: 560px;
}
.warehouse-writeoff-subtitle {
  font-weight: 500;
  color: var(--text-secondary);
}
.warehouse-writeoff-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.warehouse-writeoff-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.warehouse-writeoff-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.warehouse-writeoff-field--full {
  grid-column: 1 / -1;
}
.warehouse-writeoff-label {
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.warehouse-writeoff-input,
.warehouse-writeoff-textarea {
  width: 100%;
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--text-primary);
  font: inherit;
}
.warehouse-writeoff-input--invalid {
  border-color: color-mix(in srgb, var(--danger-red) 50%, var(--border-color));
}
.warehouse-writeoff-textarea {
  resize: vertical;
  min-height: 72px;
}
.warehouse-writeoff-hint,
.warehouse-writeoff-batch-fixed {
  font-size: 0.82rem;
  color: var(--text-secondary);
  margin: 0;
}
.warehouse-writeoff-field-error {
  font-size: 0.78rem;
  color: var(--danger-red);
}
.warehouse-writeoff-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger-red) 12%, transparent);
  color: var(--danger-red);
  font-size: 0.86rem;
}
.warehouse-writeoff-warn,
.warehouse-writeoff-info {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 0.86rem;
}
.warehouse-writeoff-warn {
  background: color-mix(in srgb, var(--warning-orange) 12%, var(--bg-panel));
  border: 1px solid color-mix(in srgb, var(--warning-orange) 28%, var(--border-color));
}
.warehouse-writeoff-info {
  background: color-mix(in srgb, var(--accent-green) 10%, var(--bg-panel));
  border: 1px solid color-mix(in srgb, var(--accent-green) 22%, var(--border-color));
}
.warehouse-writeoff-warn-icon {
  flex-shrink: 0;
  color: var(--warning-orange);
}
.warehouse-writeoff-info-icon {
  flex-shrink: 0;
  color: var(--accent-green);
}
.warehouse-writeoff-warn-text,
.warehouse-writeoff-info-text {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.4;
}
.warehouse-writeoff-actions {
  padding-top: 4px;
}
</style>
