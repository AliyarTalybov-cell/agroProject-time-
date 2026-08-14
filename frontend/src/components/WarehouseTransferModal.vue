<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import {
  executeStorageTransfer,
  getStorageLocationInventory,
  loadStorageCropBalances,
  loadOpenBatchesForTransfer,
  type StorageCropBalance,
  type StorageOpenBatchOption,
} from '@/lib/storageTransfersSupabase'
import { storageLocationCropLabel, type StorageLocationRow } from '@/lib/storageLocationsSupabase'

const props = defineProps<{
  open: boolean
  places: StorageLocationRow[]
  initialFromId?: string | null
  initialBatchId?: string | null
  lockBatchSelection?: boolean
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const saving = ref(false)
const formError = ref<string | null>(null)

const fromId = ref('')
const toId = ref('')
const massTons = ref('')
const batchId = ref('')
const transferredAt = ref('')
const comment = ref('')

const availableTons = ref(0)
const cropLabel = ref('—')
const cropKey = ref<string | null>(null)
const selectedCropKey = ref('')
const cropBalances = ref<StorageCropBalance[]>([])
const batchOptions = ref<StorageOpenBatchOption[]>([])
const inventoryLoading = ref(false)

function nowDateLocal(): string {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

function resetForm() {
  fromId.value = props.initialFromId || ''
  toId.value = ''
  massTons.value = ''
  batchId.value = props.initialBatchId || ''
  transferredAt.value = nowDateLocal()
  comment.value = ''
  formError.value = null
  availableTons.value = 0
  cropLabel.value = '—'
  cropKey.value = null
  selectedCropKey.value = ''
  cropBalances.value = []
  batchOptions.value = []
}

const fromPlace = computed(() => props.places.find((p) => p.id === fromId.value) ?? null)
const toPlace = computed(() => props.places.find((p) => p.id === toId.value) ?? null)

const destinationOptions = computed(() =>
  props.places.filter((p) => p.id !== fromId.value),
)

const cropSelectOptions = computed(() => {
  const options = cropBalances.value.map((x) => ({ key: x.cropKey, label: x.cropLabel, massTons: x.massTons }))
  if (cropKey.value && !options.some((x) => x.key === cropKey.value)) {
    options.unshift({ key: cropKey.value, label: cropLabel.value !== '—' ? cropLabel.value : cropKey.value, massTons: 0 })
  }
  return options
})

function parseDecimal(value: string): number | null {
  const n = Number(value.replace(',', '.').trim())
  if (!Number.isFinite(n)) return null
  return n
}

const massNum = computed(() => parseDecimal(massTons.value))

const previewMass = computed(() => {
  const n = massNum.value
  if (n == null || n <= 0) return 100
  return n
})

const massExceedsAvailable = computed(() => {
  const m = massNum.value
  if (m == null || m <= 0) return false
  return m > availableTons.value + 0.0001
})

const massLimitMessage = computed(() => {
  if (!fromId.value || inventoryLoading.value) return ''
  if (massNum.value == null || massNum.value <= 0) return ''
  if (!massExceedsAvailable.value) return ''
  const max = formatMass(availableTons.value)
  const entered = formatMass(massNum.value!)
  return `Указано ${entered} т — больше доступного остатка (${max} т)`
})

const canSubmit = computed(() => {
  if (!fromId.value || !toId.value || fromId.value === toId.value) return false
  if (!selectedCropKey.value) return false
  if (!transferredAt.value) return false
  if (props.lockBatchSelection && !batchId.value) return false
  const m = massNum.value
  if (m == null || m <= 0) return false
  if (massExceedsAvailable.value) return false
  return true
})

const submitDisabledReason = computed(() => {
  if (canSubmit.value || saving.value) return ''
  if (massExceedsAvailable.value) {
    return `Масса не может превышать ${formatMass(availableTons.value)} т`
  }
  return ''
})

async function refreshFromInventory() {
  if (!fromId.value) {
    availableTons.value = 0
    cropLabel.value = '—'
    cropKey.value = null
    batchOptions.value = []
    return
  }
  inventoryLoading.value = true
  formError.value = null
  try {
    const [inv, batches, balances] = await Promise.all([
      getStorageLocationInventory(fromId.value),
      loadOpenBatchesForTransfer(fromId.value),
      loadStorageCropBalances(fromId.value),
    ])
    availableTons.value = inv.availableMassTons
    cropKey.value = inv.cropKey
    cropLabel.value = inv.cropLabel || (fromPlace.value ? storageLocationCropLabel(fromPlace.value) : '—')
    cropBalances.value = balances
    selectedCropKey.value = balances[0]?.cropKey || cropKey.value || ''
    batchOptions.value = batches
    if (props.initialBatchId && batches.some((b) => b.id === props.initialBatchId)) {
      batchId.value = props.initialBatchId
    } else if (batchId.value && !batches.some((b) => b.id === batchId.value)) {
      batchId.value = props.lockBatchSelection ? props.initialBatchId || '' : ''
    }
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Не удалось загрузить остаток'
  } finally {
    inventoryLoading.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      resetForm()
      document.body.style.overflow = 'hidden'
      void refreshFromInventory()
    } else {
      document.body.style.overflow = ''
    }
  },
)

onUnmounted(() => {
  document.body.style.overflow = ''
})

watch(fromId, () => {
  if (!props.lockBatchSelection) batchId.value = ''
  if (toId.value === fromId.value) toId.value = ''
  void refreshFromInventory()
})

watch(batchId, async (id) => {
  if (!fromId.value) return
  if (!id) {
    await refreshFromInventory()
    return
  }
  const batch = batchOptions.value.find((b) => b.id === id)
  if (batch) {
    availableTons.value = batch.totalNetTons
    if (batch.cropKey) {
      cropKey.value = batch.cropKey
      selectedCropKey.value = batch.cropKey
    }
  } else {
    await refreshFromInventory()
  }
})

watch(selectedCropKey, (key) => {
  if (batchId.value) return
  const selected = cropBalances.value.find((x) => x.cropKey === key)
  if (selected) {
    availableTons.value = selected.massTons
    cropKey.value = selected.cropKey
    cropLabel.value = selected.cropLabel
  } else if (fromId.value) {
    void refreshFromInventory()
  }
})

function close() {
  if (saving.value) return
  emit('close')
}

function toIsoFromDateInput(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return new Date().toISOString()
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0)
  return dt.toISOString()
}

async function submit() {
  if (!canSubmit.value || saving.value) return
  const m = massNum.value
  if (m == null) return
  saving.value = true
  formError.value = null
  try {
    await executeStorageTransfer({
      fromStorageLocationId: fromId.value,
      toStorageLocationId: toId.value,
      massTons: m,
      cropKey: selectedCropKey.value || cropKey.value,
      batchId: batchId.value || null,
      transferredAt: toIsoFromDateInput(transferredAt.value),
      comment: comment.value,
    })
    emit('success')
    emit('close')
  } catch (e) {
    formError.value = e instanceof Error && e.message ? e.message : 'Не удалось провести перемещение'
  } finally {
    saving.value = false
  }
}

function formatMass(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
}
</script>

<template>
  <teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="warehouse-transfer-title"
      @click.self="close"
    >
      <div class="modal warehouse-transfer-modal" @click.stop>
        <header class="modal-header">
          <h2 id="warehouse-transfer-title" class="modal-title">Перемещение зерна</h2>
          <ModalCloseButton :disabled="saving" @click="close" />
        </header>

        <div class="modal-body warehouse-transfer-body">
          <p v-if="formError" class="warehouse-transfer-error" role="alert">{{ formError }}</p>

          <div class="warehouse-transfer-grid">
            <label class="warehouse-transfer-field">
              <span class="warehouse-transfer-label">Откуда (место хранения)</span>
              <select v-model="fromId" class="warehouse-transfer-input" :disabled="saving">
                <option value="">Выберите склад</option>
                <option v-for="p in places" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <span
                v-if="fromId"
                class="warehouse-transfer-hint"
                :class="{ 'warehouse-transfer-hint--limit': !inventoryLoading && availableTons > 0 }"
              >
                <template v-if="inventoryLoading">Загрузка остатка…</template>
                <template v-else>Доступно для перемещения: <strong>{{ formatMass(availableTons) }} т</strong></template>
              </span>
            </label>

            <label class="warehouse-transfer-field">
              <span class="warehouse-transfer-label">Куда (место хранения)</span>
              <select v-model="toId" class="warehouse-transfer-input" :disabled="saving || !fromId">
                <option value="">Выберите склад</option>
                <option v-for="p in destinationOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </label>

            <label class="warehouse-transfer-field">
              <span class="warehouse-transfer-label">Культура</span>
              <select
                v-model="selectedCropKey"
                class="warehouse-transfer-input"
                :disabled="saving || !fromId || !cropSelectOptions.length || !!batchId"
              >
                <option value="">Выберите культуру</option>
                <option
                  v-for="crop in cropSelectOptions"
                  :key="crop.key"
                  :value="crop.key"
                >
                  {{ crop.label }} · {{ formatMass(crop.massTons) }} т
                </option>
              </select>
            </label>

            <label class="warehouse-transfer-field">
              <span class="warehouse-transfer-label">Масса для перемещения (т)</span>
              <input
                v-model="massTons"
                type="text"
                inputmode="decimal"
                class="warehouse-transfer-input"
                :class="{ 'warehouse-transfer-input--invalid': massExceedsAvailable }"
                :disabled="saving || !fromId"
                :aria-invalid="massExceedsAvailable ? 'true' : undefined"
                :aria-describedby="massExceedsAvailable ? 'warehouse-transfer-mass-error' : undefined"
                placeholder="Не больше доступного остатка"
              />
              <p
                v-if="massLimitMessage"
                id="warehouse-transfer-mass-error"
                class="warehouse-transfer-field-error"
                role="alert"
              >
                {{ massLimitMessage }}
              </p>
            </label>

            <label v-if="!lockBatchSelection" class="warehouse-transfer-field">
              <span class="warehouse-transfer-label">Партия (опционально)</span>
              <select v-model="batchId" class="warehouse-transfer-input" :disabled="saving || !fromId || !batchOptions.length">
                <option value="">Без привязки к партии</option>
                <option v-for="b in batchOptions" :key="b.id" :value="b.id">
                  {{ b.code }} · {{ formatMass(b.totalNetTons) }} т
                </option>
              </select>
            </label>
            <p v-else-if="lockBatchSelection && batchId && batchOptions.find((b) => b.id === batchId)" class="warehouse-transfer-batch-fixed">
              Партия <strong>{{ batchOptions.find((b) => b.id === batchId)?.code }}</strong>
            </p>

            <label class="warehouse-transfer-field">
              <span class="warehouse-transfer-label">Дата</span>
              <input v-model="transferredAt" type="date" class="warehouse-transfer-input" :disabled="saving" />
            </label>

            <label class="warehouse-transfer-field warehouse-transfer-field--full">
              <span class="warehouse-transfer-label">Комментарий</span>
              <textarea
                v-model="comment"
                class="warehouse-transfer-textarea"
                rows="3"
                :disabled="saving"
                placeholder="Введите дополнительную информацию..."
              />
            </label>
          </div>

          <div
            v-if="fromPlace && toPlace && massNum && massNum > 0 && massExceedsAvailable"
            class="warehouse-transfer-warn"
            role="alert"
          >
            <svg class="warehouse-transfer-warn-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <p class="warehouse-transfer-warn-text">
              Сократите массу до <strong>{{ formatMass(availableTons) }} т</strong> или меньше, чтобы провести перемещение.
            </p>
          </div>

          <div
            v-else-if="fromPlace && toPlace && massNum && massNum > 0 && !massExceedsAvailable"
            class="warehouse-transfer-info"
            role="status"
          >
            <svg class="warehouse-transfer-info-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <p class="warehouse-transfer-info-text">
              После проведения: со склада <strong>{{ fromPlace.name }}</strong> спишется
              <strong>{{ formatMass(previewMass) }} т</strong>, на склад <strong>{{ toPlace.name }}</strong> прибавится
              <strong>{{ formatMass(previewMass) }} т</strong>
            </p>
          </div>
        </div>

        <footer class="modal-actions warehouse-transfer-actions">
          <button type="button" class="task-form-cancel" :disabled="saving" @click="close">Отмена</button>
          <button
            type="button"
            class="task-form-submit"
            :disabled="saving || !canSubmit"
            :title="submitDisabledReason || undefined"
            @click="submit"
          >
            {{ saving ? 'Проведение…' : 'Провести перемещение' }}
          </button>
        </footer>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--modal-backdrop);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.modal-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.task-form-cancel,
.task-form-submit {
  height: 40px;
  padding: 0 16px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--border-color);
}

.task-form-cancel {
  background: var(--bg-panel);
  color: var(--text-primary);
}

.task-form-cancel:hover:not(:disabled) {
  background: var(--bg-panel-hover);
}

.task-form-submit {
  border-color: var(--accent-green);
  background: var(--accent-green);
  color: #fff;
}

.task-form-submit:hover:not(:disabled) {
  background: var(--accent-green-hover);
}

.task-form-cancel:disabled,
.task-form-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.warehouse-transfer-modal {
  width: min(720px, 96vw);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  border-radius: 16px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  box-shadow: var(--shadow-card);
}

.warehouse-transfer-body {
  padding: 16px 20px;
  overflow: auto;
}

.warehouse-transfer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 16px;
}

.warehouse-transfer-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.warehouse-transfer-field--full {
  grid-column: 1 / -1;
}

.warehouse-transfer-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.warehouse-transfer-input,
.warehouse-transfer-textarea {
  width: 100%;
  border: 1px solid var(--toolbar-form-surface-border);
  border-radius: 10px;
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.9375rem;
  padding: 10px 12px;
}

.warehouse-transfer-input {
  height: 44px;
}

.warehouse-transfer-input--readonly {
  background: color-mix(in srgb, var(--toolbar-form-surface) 88%, var(--bg-base));
  color: var(--text-secondary);
}

.warehouse-transfer-textarea {
  min-height: 88px;
  resize: vertical;
}

.warehouse-transfer-input:focus,
.warehouse-transfer-textarea:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 2px var(--focus-ring);
}

.warehouse-transfer-hint {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.warehouse-transfer-hint--limit strong {
  color: var(--accent-green);
  font-weight: 700;
}

.warehouse-transfer-input--invalid {
  border-color: var(--danger-red) !important;
  background: color-mix(in srgb, var(--danger-red) 6%, var(--toolbar-form-surface)) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger-red) 18%, transparent);
}

.warehouse-transfer-input--invalid:focus {
  border-color: var(--danger-red) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger-red) 22%, transparent);
}

.warehouse-transfer-field-error {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.35;
  color: var(--danger-red);
  font-weight: 500;
}

.warehouse-transfer-warn {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--danger-red) 35%, transparent);
  background: color-mix(in srgb, var(--danger-red) 10%, transparent);
}

.warehouse-transfer-warn-icon {
  flex-shrink: 0;
  color: var(--danger-red);
  margin-top: 1px;
}

.warehouse-transfer-warn-text {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--text-primary);
}

.warehouse-transfer-error {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--danger-red) 35%, transparent);
  background: color-mix(in srgb, var(--danger-red) 10%, transparent);
  color: var(--danger-red);
  font-size: 0.875rem;
}

.warehouse-transfer-info {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, #3b82f6 28%, transparent);
  background: color-mix(in srgb, #3b82f6 10%, transparent);
}

.warehouse-transfer-info-icon {
  flex-shrink: 0;
  color: #2563eb;
  margin-top: 1px;
}

.warehouse-transfer-info-text {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--text-primary);
}

.warehouse-transfer-actions {
  padding: 14px 20px;
  border-top: 1px solid var(--border-color);
  justify-content: flex-end;
}

@media (max-width: 640px) {
  .warehouse-transfer-grid {
    grid-template-columns: 1fr;
  }
}
</style>
