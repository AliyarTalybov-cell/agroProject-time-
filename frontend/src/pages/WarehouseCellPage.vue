<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import WarehouseWriteoffModal from '@/components/WarehouseWriteoffModal.vue'
import WarehouseTransferModal from '@/components/WarehouseTransferModal.vue'
import { isSupabaseConfigured } from '@/lib/supabase'
import { loadFields, type FieldRow } from '@/lib/fieldsSupabase'
import { loadCrops, type CropRow } from '@/lib/landTypesAndCrops'
import {
  getStorageLocationById,
  loadStorageLocations,
  storageLocationCropLabel,
  storageLocationFillStatusCode,
  storageLocationFillStatusName,
  storageLocationTypeName,
  syncStorageLocationFillStatusFromIntakes,
  type StorageLocationRow,
} from '@/lib/storageLocationsSupabase'
import {
  addStorageIntake,
  attachStorageIntakesToBatch,
  detachStorageIntakeFromBatch,
  loadStorageIntakes,
  storageIntakeCropLabel,
  storageIntakeFieldLabel,
  type StorageIntakeRow,
} from '@/lib/storageIntakesSupabase'
import {
  formStorageBatch,
  isStorageBatchClosed,
  loadStorageBatches,
  storageBatchCropLabel,
  storageBatchUiStatus,
  storageBatchUiStatusLabel,
  updateStorageBatchQuality,
  type StorageBatchRow,
} from '@/lib/storageBatchesSupabase'
import { loadStorageWriteoffsForLocation, storageWriteoffTypeLabel } from '@/lib/storageWriteoffsSupabase'

const route = useRoute()
const router = useRouter()

const DEFAULT_BASE_MOISTURE_PERCENT = 14

const storageId = computed(() => String(route.params.id || ''))
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const storage = ref<StorageLocationRow | null>(null)
const storageOptions = ref<StorageLocationRow[]>([])
const fields = ref<FieldRow[]>([])
const crops = ref<CropRow[]>([])
const intakes = ref<StorageIntakeRow[]>([])
const batches = ref<StorageBatchRow[]>([])
const writeoffs = ref<Array<{
  id: string
  batch_id: string
  writeoff_type: 'sale' | 'processing' | 'spoilage' | 'feed'
  mass_tons: number
  operation_date: string
  counterparty: string | null
  comment: string | null
  created_at: string
  actorName: string
  batches?: { id: string; code: string } | null
  crops?: { key: string; label: string } | null
}>>([])

const activeTab = ref<'intakes' | 'batch' | 'history' | 'writeoffs'>('intakes')
const viewedBatchId = ref<string | null>(null)
const attachTargetBatchId = ref('')
const selectedIntakeIds = ref<string[]>([])
const intakeModalOpen = ref(false)
const batchWizardOpen = ref(false)
const writeoffModalOpen = ref(false)
const writeoffModalMode = ref<'sale' | 'writeoff'>('writeoff')
const transferModalOpen = ref(false)
const batchStep = ref<1 | 2 | 3>(1)
const detachConfirmIntake = ref<StorageIntakeRow | null>(null)
const passportModalOpen = ref(false)
const passportForm = ref({
  proteinPercent: '',
  oilContentPercent: '',
  acidNumber: '',
  gmoStatus: 'not_detected' as 'detected' | 'not_detected',
  pesticidesStatus: 'normal' as 'normal' | 'excess',
  sampleDate: '',
  labConclusionNumber: '',
})

const intakeForm = ref({
  receivedAt: '',
  fieldId: '',
  grossMassTons: '',
  moisturePercent: String(DEFAULT_BASE_MOISTURE_PERCENT).replace('.', ','),
  weedImpurityPercent: '0',
  grainImpurityPercent: '0',
  cropKey: '',
  storageLocationId: '',
  comment: '',
})

type BatchQualityFormRow = { name: string; value: string; removable: boolean }

const batchForm = ref({
  purpose: 'export',
  useGoal: 'food',
  selectedRows: [] as Array<{ intakeId: string; included: boolean; writeOffTons: string }>,
  qualityRows: [
    { name: 'Влажность (%)', value: '', removable: false },
    { name: 'Сорная примесь (%)', value: '', removable: false },
    { name: 'Клейковина (%)', value: '', removable: false },
    { name: 'Натура (г/л)', value: '', removable: false },
  ] as BatchQualityFormRow[],
  copyFromSource: true,
})

function nowDateTimeLocal(): string {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`
}

function formatDateOnlyRu(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDecimalPlain(n: number, frac: number): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: frac, maximumFractionDigits: frac })
}

function formatDateTimeRu(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function parseDecimal(value: string): number | null {
  const n = Number(value.replace(',', '.').trim())
  if (!Number.isFinite(n)) return null
  return n
}

const selectedField = computed(() => fields.value.find((f) => f.id === intakeForm.value.fieldId) ?? null)

watch(
  selectedField,
  (field) => {
    intakeForm.value.cropKey = field?.crop_key ?? ''
  },
  { immediate: true },
)

const selectedCropLabel = computed(() => {
  const key = intakeForm.value.cropKey
  if (!key) return 'Культура не указана у выбранного поля'
  return crops.value.find((c) => c.key === key)?.label ?? key
})

const grossMassNum = computed(() => parseDecimal(intakeForm.value.grossMassTons))
const moistureNum = computed(() => parseDecimal(intakeForm.value.moisturePercent))
const weedImpurityNum = computed(() => parseDecimal(intakeForm.value.weedImpurityPercent))
const grainImpurityNum = computed(() => parseDecimal(intakeForm.value.grainImpurityPercent))
const totalImpurityPercentNum = computed(() => {
  const weed = weedImpurityNum.value
  const grain = grainImpurityNum.value
  if (weed == null || grain == null) return null
  return Number((weed + grain).toFixed(2))
})
const selectedCropBaseMoistureNum = computed(() => {
  const key = intakeForm.value.cropKey
  if (!key) return DEFAULT_BASE_MOISTURE_PERCENT
  const value = crops.value.find((c) => c.key === key)?.base_moisture_percent
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 100) {
    return DEFAULT_BASE_MOISTURE_PERCENT
  }
  return value
})
const selectedCropBaseMoistureLabel = computed(() => formatDecimalPlain(selectedCropBaseMoistureNum.value, 1))
const dryMassNum = computed(() => {
  const gross = grossMassNum.value
  const moisture = moistureNum.value
  const baseMoisture = selectedCropBaseMoistureNum.value
  if (gross == null || moisture == null) return null
  if (gross < 0 || moisture < 0 || moisture >= 100 || baseMoisture >= 100) return null
  const raw = gross * (100 - moisture) / (100 - baseMoisture)
  return Number(raw.toFixed(2))
})
const impurityLossNum = computed(() => {
  const gross = grossMassNum.value
  const weed = weedImpurityNum.value
  const grain = grainImpurityNum.value
  if (gross == null || weed == null || grain == null) return null
  if (gross < 0 || weed < 0 || grain < 0) return null
  const raw = gross * (weed + grain) / 100
  return Number(raw.toFixed(2))
})

const netMassNum = computed(() => {
  const dryMass = dryMassNum.value
  const impurityLoss = impurityLossNum.value
  if (dryMass == null || impurityLoss == null) return null
  return Math.max(0, Number((dryMass - impurityLoss).toFixed(2)))
})

const canSaveIntake = computed(() => {
  if (!storage.value) return false
  if (!intakeForm.value.receivedAt || !intakeForm.value.fieldId || !intakeForm.value.cropKey) return false
  if (grossMassNum.value == null || grossMassNum.value <= 0) return false
  if (moistureNum.value == null || moistureNum.value < 0 || moistureNum.value >= 100) return false
  if (weedImpurityNum.value == null || weedImpurityNum.value < 0 || weedImpurityNum.value > 100) return false
  if (grainImpurityNum.value == null || grainImpurityNum.value < 0 || grainImpurityNum.value > 100) return false
  if ((weedImpurityNum.value + grainImpurityNum.value) > 100) return false
  return netMassNum.value != null
})

const unbatchedTotal = computed(() =>
  intakes.value
    .filter((x) => !x.batch_id)
    .reduce((sum, x) => sum + Number(x.net_mass_tons || 0), 0),
)

const unbatchedIntakes = computed(() => intakes.value.filter((x) => !x.batch_id))

const openBatches = computed(() => batches.value.filter((b) => !isStorageBatchClosed(b)))

const currentBatch = computed(() => {
  const queryId = String(route.query.batchId || '').trim()
  const id = viewedBatchId.value || queryId
  if (id) {
    const found = batches.value.find((b) => b.id === id)
    if (found) return found
  }
  return openBatches.value[0] ?? null
})

const isCurrentBatchClosed = computed(() => {
  const b = currentBatch.value
  return !b || isStorageBatchClosed(b)
})

const canOperateOnCurrentBatch = computed(() => !!currentBatch.value && !isCurrentBatchClosed.value)

const currentBatchIntakes = computed(() => {
  const b = currentBatch.value
  if (!b) return []
  return intakes.value.filter((x) => x.batch_id === b.id)
})

const currentBatchIntakesSorted = computed(() => {
  const rows = [...currentBatchIntakes.value]
  rows.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
  return rows
})

const compositionNetTotal = computed(() =>
  currentBatchIntakes.value.reduce((s, x) => s + Number(x.net_mass_tons || 0), 0),
)

const compositionAvgMoisture = computed(() => {
  const rows = currentBatchIntakes.value
  if (!rows.length) return null
  const gross = rows.reduce((s, x) => s + Number(x.gross_mass_tons || 0), 0)
  if (gross <= 0) return null
  return rows.reduce((s, x) => s + Number(x.gross_mass_tons || 0) * Number(x.moisture_percent || 0), 0) / gross
})

const canCollectSelectedToBatch = computed(() =>
  selectedIntakeIds.value.some((id) => intakes.value.some((i) => i.id === id && !i.batch_id)),
)

const unbatchedSelectedIds = computed(() =>
  selectedIntakeIds.value.filter((id) => intakes.value.some((i) => i.id === id && !i.batch_id)),
)

const allUnbatchedSelected = computed(() => {
  const ids = unbatchedIntakes.value.map((x) => x.id)
  if (!ids.length) return false
  return ids.every((id) => selectedIntakeIds.value.includes(id))
})

const hasOpenBatchesForAttach = computed(() => openBatches.value.length > 0)

const batchHeaderNetTons = computed(() => {
  if (currentBatchIntakes.value.length) return compositionNetTotal.value
  return Number(currentBatch.value?.total_net_tons || 0)
})

function goAddToBatchFromFab() {
  activeTab.value = 'intakes'
}

function toggleSelectAllUnbatched() {
  const ids = unbatchedIntakes.value.map((x) => x.id)
  if (!ids.length) return
  if (allUnbatchedSelected.value) {
    selectedIntakeIds.value = selectedIntakeIds.value.filter((id) => !ids.includes(id))
  } else {
    selectedIntakeIds.value = Array.from(new Set([...selectedIntakeIds.value, ...ids]))
  }
}

function isIntakeRowSelectable(row: StorageIntakeRow): boolean {
  return !row.batch_id
}

async function attachSelectedToBatch(targetBatchId?: string) {
  const loc = storage.value
  const batchId = targetBatchId || attachTargetBatchId.value
  const b = batches.value.find((x) => x.id === batchId)
  if (!b || !loc || isStorageBatchClosed(b)) return
  const ids = unbatchedSelectedIds.value
  if (!ids.length) return
  saving.value = true
  try {
    await attachStorageIntakesToBatch({
      storageLocationId: loc.id,
      batchId: b.id,
      batchCode: b.code,
      intakeIds: ids,
    })
    viewedBatchId.value = b.id
    selectedIntakeIds.value = []
    await loadStorageCell()
    activeTab.value = 'batch'
    await router.replace({ query: { tab: 'batch', batchId: b.id } })
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : 'Не удалось добавить поступления в партию'
  } finally {
    saving.value = false
  }
}

function selectBatchForView(batch: StorageBatchRow) {
  viewedBatchId.value = batch.id
  activeTab.value = 'batch'
  void router.replace({ query: { tab: 'batch', batchId: batch.id } })
}

function openWriteoffBatchFromJournal(batchId: string) {
  if (!batchId) return
  viewedBatchId.value = batchId
  activeTab.value = 'batch'
  void router.replace({ query: { tab: 'batch', batchId } })
}

function openSellModal() {
  if (!canOperateOnCurrentBatch.value || !currentBatch.value) return
  writeoffModalMode.value = 'sale'
  writeoffModalOpen.value = true
}

function openWriteoffModal() {
  if (!canOperateOnCurrentBatch.value || !currentBatch.value) return
  writeoffModalMode.value = 'writeoff'
  writeoffModalOpen.value = true
}

function openTransferModal() {
  if (!canOperateOnCurrentBatch.value || !currentBatch.value) return
  transferModalOpen.value = true
}

function closeWriteoffModal() {
  writeoffModalOpen.value = false
}

function closeTransferModal() {
  transferModalOpen.value = false
}

async function onBatchOperationSuccess() {
  await loadStorageCell()
}

function openDetachIntakeConfirm(row: StorageIntakeRow) {
  detachConfirmIntake.value = row
}

function closeDetachIntakeConfirm() {
  detachConfirmIntake.value = null
}

async function confirmDetachIntakeFromBatch() {
  const row = detachConfirmIntake.value
  const b = currentBatch.value
  const loc = storage.value
  if (!row || !b || !loc || !row.batch_id) return
  saving.value = true
  try {
    await detachStorageIntakeFromBatch({
      intakeId: row.id,
      storageLocationId: loc.id,
      batchId: b.id,
    })
    closeDetachIntakeConfirm()
    await loadStorageCell()
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : 'Не удалось исключить поступление из партии'
  } finally {
    saving.value = false
  }
}

function openPassportModal() {
  const quality = (currentBatch.value?.quality ?? {}) as Record<string, unknown>
  passportForm.value = {
    proteinPercent: String(quality['Протеин (%)'] ?? ''),
    oilContentPercent: String(quality['Масличность (%)'] ?? ''),
    acidNumber: String(quality['Кислотное число'] ?? ''),
    gmoStatus: quality['ГМО'] === 'Обнаружено' ? 'detected' : 'not_detected',
    pesticidesStatus: quality['Пестициды'] === 'Превышение' ? 'excess' : 'normal',
    sampleDate: String(quality['Дата отбора пробы'] ?? ''),
    labConclusionNumber: String(quality['Номер лабораторного заключения'] ?? ''),
  }
  passportModalOpen.value = true
}

function closePassportModal() {
  passportModalOpen.value = false
}

function printBatchView() {
  window.print()
}

function normalizePassportText(value: string): string {
  return value.trim()
}

const passportIsOilCrop = computed(() => {
  const batch = currentBatch.value
  if (!batch) return false
  const key = (batch.crop_key ?? '').toLowerCase()
  if (['sunflower', 'soy', 'rapeseed', 'raps', 'canola', 'flax', 'linseed'].includes(key)) return true
  const label = storageBatchCropLabel(batch).toLowerCase()
  return label.includes('подсолнеч') || label.includes('рапс') || label.includes('соя') || label.includes('лён') || label.includes('лен')
})

async function savePassportQuality() {
  const batch = currentBatch.value
  if (!batch) return
  saving.value = true
  try {
    const previous = (batch.quality ?? {}) as Record<string, unknown>
    const next: Record<string, unknown> = {
      ...previous,
      'Протеин (%)': normalizePassportText(passportForm.value.proteinPercent),
      'Кислотное число': normalizePassportText(passportForm.value.acidNumber),
      ГМО: passportForm.value.gmoStatus === 'detected' ? 'Обнаружено' : 'Не обнаружено',
      Пестициды: passportForm.value.pesticidesStatus === 'excess' ? 'Превышение' : 'В норме',
      'Дата отбора пробы': normalizePassportText(passportForm.value.sampleDate),
      'Номер лабораторного заключения': normalizePassportText(passportForm.value.labConclusionNumber),
    }
    if (passportIsOilCrop.value) {
      next['Масличность (%)'] = normalizePassportText(passportForm.value.oilContentPercent)
    } else {
      delete next['Масличность (%)']
    }
    await updateStorageBatchQuality(batch.id, next)
    await loadStorageCell()
    passportModalOpen.value = false
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : 'Не удалось сохранить паспорт качества'
  } finally {
    saving.value = false
  }
}

function downloadPassportPdfStub() {
  printBatchView()
}

function formatTons(n: number): string {
  return `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} т`
}

const canFormNewBatch = computed(() => unbatchedIntakes.value.length > 0)

function intakeStatusLabel(row: StorageIntakeRow): string {
  return row.batch_code ? `Включён в партию ${row.batch_code}` : 'Не оформлен'
}

function goBack() {
  void router.push('/warehouses')
}

function goToLocationsRegistry() {
  void router.push('/warehouses/storage-locations')
}

function statusClass(): string {
  const code = storage.value ? storageLocationFillStatusCode(storage.value) : null
  if (code === 'filling') return 'warehouse-cell-status--filling'
  if (code === 'formed') return 'warehouse-cell-status--formed'
  return 'warehouse-cell-status--empty'
}

const cropLabel = computed(() => (storage.value ? storageLocationCropLabel(storage.value) : '—'))

function resetIntakeForm() {
  const defaultField = fields.value[0] ?? null
  intakeForm.value = {
    receivedAt: nowDateTimeLocal(),
    fieldId: defaultField?.id ?? '',
    grossMassTons: '',
    moisturePercent: String(DEFAULT_BASE_MOISTURE_PERCENT).replace('.', ','),
    weedImpurityPercent: '0',
    grainImpurityPercent: '0',
    cropKey: defaultField?.crop_key ?? '',
    storageLocationId: storage.value?.id ?? '',
    comment: '',
  }
}

function resetBatchForm() {
  const allowedIds = new Set(selectedIntakeIds.value)
  const forMoisture = unbatchedIntakes.value.filter((x) => (allowedIds.size ? allowedIds.has(x.id) : true))
  batchForm.value.selectedRows = unbatchedIntakes.value.map((x) => ({
    intakeId: x.id,
    included: allowedIds.size ? allowedIds.has(x.id) : true,
    writeOffTons: Number(x.net_mass_tons || 0).toFixed(2),
  }))
  batchForm.value.purpose = 'export'
  batchForm.value.useGoal = 'food'
  batchForm.value.copyFromSource = true
  batchForm.value.qualityRows = [
    { name: 'Влажность (%)', value: weightedMoistureValueForRows(forMoisture), removable: false },
    { name: 'Сорная примесь (%)', value: '', removable: false },
    { name: 'Клейковина (%)', value: '', removable: false },
    { name: 'Натура (г/л)', value: '', removable: false },
  ]
}

function weightedMoistureValueForRows(rows: StorageIntakeRow[]): string {
  if (!rows.length) return ''
  const gross = rows.reduce((s, x) => s + Number(x.gross_mass_tons || 0), 0)
  if (gross <= 0) return ''
  const weighted = rows.reduce((s, x) => s + Number(x.gross_mass_tons || 0) * Number(x.moisture_percent || 0), 0) / gross
  return weighted.toFixed(1)
}

function batchPurposeLabel(p: string): string {
  if (p === 'export') return 'Экспорт'
  if (p === 'processing') return 'Переработка'
  if (p === 'storage') return 'Хранение'
  return p
}

function batchUseGoalLabel(g: string): string {
  if (g === 'food') return 'Пищевые'
  if (g === 'feed') return 'Кормовые'
  return g
}

function openBatchWizard() {
  if (!unbatchedIntakes.value.length) return
  resetBatchForm()
  batchStep.value = 1
  batchWizardOpen.value = true
}

function openBatchWizardFromSelection() {
  if (!canCollectSelectedToBatch.value) return
  resetBatchForm()
  batchStep.value = 1
  batchWizardOpen.value = true
}

function closeBatchWizard() {
  if (saving.value) return
  batchWizardOpen.value = false
}

const selectedBatchRows = computed(() =>
  batchForm.value.selectedRows.filter(
    (x) =>
      x.included
      && parseDecimal(x.writeOffTons) != null
      && (parseDecimal(x.writeOffTons) || 0) > 0,
  ),
)

const selectedIntakeMap = computed(() => new Map(unbatchedIntakes.value.map((x) => [x.id, x])))

const batchTotalNet = computed(() =>
  selectedBatchRows.value.reduce((sum, x) => sum + (parseDecimal(x.writeOffTons) || 0), 0),
)

const batchCropKey = computed(() => {
  const keys = new Set<string>()
  for (const row of selectedBatchRows.value) {
    const intake = selectedIntakeMap.value.get(row.intakeId)
    if (intake?.crop_key) keys.add(intake.crop_key)
  }
  if (!keys.size) return null
  return [...keys][0] ?? null
})

const batchCropLabel = computed(() => {
  const key = batchCropKey.value
  if (!key) return '—'
  return crops.value.find((c) => c.key === key)?.label ?? key
})

const canProceedBatchStep2 = computed(() => selectedBatchRows.value.length > 0 && batchTotalNet.value > 0)
const canFinishBatch = computed(() =>
  canProceedBatchStep2.value
  && batchForm.value.qualityRows.every((x) => x.name.trim()),
)

function addQualityRow() {
  batchForm.value.qualityRows.push({ name: '', value: '', removable: true })
}

function removeQualityRow(index: number) {
  const row = batchForm.value.qualityRows[index]
  if (!row?.removable) return
  batchForm.value.qualityRows.splice(index, 1)
}

function openIntakeModal() {
  if (!storage.value) return
  resetIntakeForm()
  intakeModalOpen.value = true
}

function closeIntakeModal() {
  if (saving.value) return
  intakeModalOpen.value = false
}

async function loadStorageCell() {
  if (!isSupabaseConfigured()) {
    storage.value = null
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [intakeRows, fieldRows, cropRows, locations, batchRows, writeoffRows] = await Promise.all([
      loadStorageIntakes(storageId.value),
      loadFields(),
      loadCrops(),
      loadStorageLocations(),
      loadStorageBatches(storageId.value),
      loadStorageWriteoffsForLocation(storageId.value),
    ])
    await syncStorageLocationFillStatusFromIntakes(storageId.value, intakeRows)
    const row = await getStorageLocationById(storageId.value)
    storage.value = row
    intakes.value = intakeRows
    fields.value = fieldRows
    crops.value = cropRows
    storageOptions.value = locations
    batches.value = batchRows
    writeoffs.value = writeoffRows
    selectedIntakeIds.value = []
    if (!row) error.value = 'Место хранения не найдено'
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : 'Не удалось загрузить карточку места хранения'
  } finally {
    loading.value = false
  }
}

async function saveIntake() {
  if (!storage.value || !canSaveIntake.value || netMassNum.value == null) return
  saving.value = true
  try {
    const receivedAtIso = new Date(intakeForm.value.receivedAt).toISOString()
    await addStorageIntake({
      storage_location_id: intakeForm.value.storageLocationId || storage.value.id,
      received_at: receivedAtIso,
      field_id: intakeForm.value.fieldId || null,
      crop_key: intakeForm.value.cropKey || null,
      gross_mass_tons: grossMassNum.value || 0,
      moisture_percent: moistureNum.value || 0,
      base_moisture_percent: selectedCropBaseMoistureNum.value,
      weed_impurity_percent: weedImpurityNum.value || 0,
      grain_impurity_percent: grainImpurityNum.value || 0,
      net_mass_tons: netMassNum.value,
      comment: intakeForm.value.comment || null,
    })
    intakeModalOpen.value = false
    await loadStorageCell()
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : 'Не удалось сохранить поступление'
  } finally {
    saving.value = false
  }
}

async function finishBatchFormation() {
  if (!storage.value || !canFinishBatch.value) return
  saving.value = true
  try {
    const quality: Record<string, string> = {}
    for (const row of batchForm.value.qualityRows) {
      const name = row.name.trim()
      if (!name) continue
      quality[name] = row.value.trim()
    }
    const created = await formStorageBatch({
      storageLocationId: storage.value.id,
      intakeIds: selectedBatchRows.value.map((x) => x.intakeId),
      cropKey: batchCropKey.value,
      purpose: batchForm.value.purpose,
      useGoal: batchForm.value.useGoal,
      quality,
      totalNetTons: Number(batchTotalNet.value.toFixed(2)),
    })
    batchWizardOpen.value = false
    viewedBatchId.value = created.id
    selectedIntakeIds.value = []
    activeTab.value = 'batch'
    await loadStorageCell()
    await router.replace({ query: { tab: 'batch', batchId: created.id } })
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : 'Не удалось сформировать партию'
  } finally {
    saving.value = false
  }
}

function applyRouteUiState() {
  const tab = String(route.query.tab || '')
  if (tab === 'batch' || tab === 'intakes' || tab === 'history' || tab === 'writeoffs') {
    activeTab.value = tab
  }
  const batchId = String(route.query.batchId || '').trim()
  if (batchId) viewedBatchId.value = batchId
}

watch(openBatches, (list) => {
  if (!attachTargetBatchId.value || !list.some((b) => b.id === attachTargetBatchId.value)) {
    attachTargetBatchId.value = list[0]?.id ?? ''
  }
})

onMounted(() => {
  applyRouteUiState()
  void loadStorageCell().then(() => {
    applyRouteUiState()
    if (route.query.intake === '1') openIntakeModal()
  })
})

watch(storageId, () => {
  viewedBatchId.value = null
  void loadStorageCell()
})

watch(() => route.query.tab, applyRouteUiState)
watch(() => route.query.batchId, applyRouteUiState)
</script>

<template>
  <section class="warehouse-cell-page">
    <div class="warehouse-cell-header">
      <button type="button" class="warehouse-cell-back" @click="goBack" aria-label="Назад к списку складов">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Назад к списку складов
      </button>
    </div>

    <div v-if="loading" class="warehouse-cell-loading">
      <UiLoadingBar />
    </div>
    <div v-else-if="!isSupabaseConfigured()" class="warehouse-cell-alert">
      Supabase не настроен. Добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в `frontend/.env.local`.
    </div>
    <div v-else-if="error || !storage" class="warehouse-cell-alert warehouse-cell-alert--error">
      {{ error || 'Не удалось открыть карточку места хранения' }}
    </div>
    <article v-else class="warehouse-cell-card">
      <header class="warehouse-cell-top">
        <div class="warehouse-cell-title-wrap">
          <h1 class="warehouse-cell-title">{{ storage.name }}</h1>
          <span class="warehouse-cell-status" :class="statusClass()">{{ storageLocationFillStatusName(storage) }}</span>
          <p class="warehouse-cell-subtitle">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg>
            {{ storage.address }}
          </p>
        </div>
        <div class="warehouse-cell-actions">
          <button type="button" class="warehouse-cell-btn" @click="goToLocationsRegistry">Редактировать</button>
          <button
            type="button"
            class="warehouse-cell-btn warehouse-cell-btn--primary"
            :disabled="!canFormNewBatch"
            :title="!unbatchedIntakes.length ? 'Нет неоформленных поступлений' : ''"
            @click="openBatchWizard"
          >
            Сформировать партию
          </button>
        </div>
      </header>

      <div class="warehouse-cell-tabs">
        <button type="button" class="warehouse-cell-tab" :class="{ 'is-active': activeTab === 'intakes' }" @click="activeTab = 'intakes'">Поступления</button>
        <button type="button" class="warehouse-cell-tab" :class="{ 'is-active': activeTab === 'batch' }" @click="activeTab = 'batch'">Текущая партия</button>
        <button type="button" class="warehouse-cell-tab" :class="{ 'is-active': activeTab === 'history' }" @click="activeTab = 'history'">История операций</button>
        <button type="button" class="warehouse-cell-tab" :class="{ 'is-active': activeTab === 'writeoffs' }" @click="activeTab = 'writeoffs'">Списания</button>
      </div>

      <section v-if="activeTab === 'intakes'" class="warehouse-cell-tab-panel">
        <div class="warehouse-cell-warning">
          <span>Итого неоформлено: {{ formatTons(unbatchedTotal) }} — Оформите партию, чтобы зерно появилось в реестре</span>
        </div>
        <div class="warehouse-cell-intakes-toolbar">
          <button
            type="button"
            class="warehouse-cell-btn warehouse-cell-btn--primary"
            :disabled="!canCollectSelectedToBatch || saving"
            @click="openBatchWizardFromSelection"
          >
            Собрать выбранное в партию
          </button>
          <template v-if="hasOpenBatchesForAttach">
            <label v-if="openBatches.length > 1" class="warehouse-cell-attach-target">
              <span class="warehouse-cell-attach-target-label">В партию</span>
              <select v-model="attachTargetBatchId" class="task-form-select warehouse-cell-attach-select" :disabled="saving">
                <option v-for="b in openBatches" :key="b.id" :value="b.id">{{ b.code }} · {{ formatTons(Number(b.total_net_tons || 0)) }}</option>
              </select>
            </label>
            <button
              type="button"
              class="warehouse-cell-btn warehouse-cell-btn--soft"
              :disabled="!canCollectSelectedToBatch || saving"
              @click="attachSelectedToBatch()"
            >
              Добавить в текущую партию
            </button>
          </template>
        </div>
        <div class="warehouse-cell-table-wrap">
          <table class="warehouse-cell-table">
            <thead>
              <tr>
                <th class="warehouse-cell-table-check">
                  <input
                    type="checkbox"
                    :checked="allUnbatchedSelected"
                    :disabled="!unbatchedIntakes.length"
                    aria-label="Выбрать все неоформленные поступления"
                    @change="toggleSelectAllUnbatched"
                  />
                </th>
                <th>Дата поступления</th>
                <th>Источник</th>
                <th>Культура</th>
                <th>Масса брутто (т)</th>
                <th>Влажность (%)</th>
                <th>Зачётный вес (т)</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in intakes" :key="row.id">
                <td class="warehouse-cell-table-check">
                  <input
                    v-if="isIntakeRowSelectable(row)"
                    :value="row.id"
                    type="checkbox"
                    v-model="selectedIntakeIds"
                    :aria-label="`Выбрать поступление ${formatDateTimeRu(row.received_at)}`"
                  />
                </td>
                <td>{{ formatDateTimeRu(row.received_at) }}</td>
                <td>{{ storageIntakeFieldLabel(row) }}</td>
                <td>{{ storageIntakeCropLabel(row) }}</td>
                <td>{{ Number(row.gross_mass_tons).toFixed(2) }}</td>
                <td>{{ Number(row.moisture_percent).toFixed(1) }}</td>
                <td>{{ Number(row.net_mass_tons).toFixed(2) }}</td>
                <td>{{ intakeStatusLabel(row) }}</td>
              </tr>
              <tr v-if="!intakes.length">
                <td colspan="8" class="warehouse-cell-empty">Поступлений пока нет. Зафиксируйте первый валовой сбор.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="activeTab === 'batch'" class="warehouse-cell-tab-panel warehouse-cell-tab-panel--batch">
        <template v-if="currentBatch">
          <div id="warehouse-batch-print-area" class="batch-detail-card">
            <div class="batch-detail-card-main">
              <div class="batch-detail-head">
                <h2 class="batch-detail-title">Партия № {{ currentBatch.code }}</h2>
                <span
                  class="batch-detail-badge"
                  :class="isCurrentBatchClosed ? 'batch-detail-badge--closed' : 'batch-detail-badge--open'"
                >
                  {{ isCurrentBatchClosed ? 'ЗАКРЫТА' : 'ОТКРЫТА' }}
                </span>
              </div>
              <p class="batch-detail-meta">
                Создана {{ formatDateOnlyRu(currentBatch.created_at) }} · {{ storageBatchCropLabel(currentBatch) }}
              </p>
              <p class="batch-detail-meta batch-detail-meta--muted">
                {{ storage.name }} · {{ storage.address }}
              </p>
              <p v-if="isCurrentBatchClosed" class="batch-detail-meta batch-detail-meta--muted">
                Закрыта, остаток 0 т
              </p>
              <p class="batch-detail-meta batch-detail-meta--muted">
                Назначение: {{ batchPurposeLabel(currentBatch.purpose) }} · Цель: {{ batchUseGoalLabel(currentBatch.use_goal) }}
              </p>
            </div>
            <div class="batch-detail-metrics">
              <div class="batch-detail-metric">
                <span class="batch-detail-metric-label">Общий зачётный вес</span>
                <strong class="batch-detail-metric-value">{{ formatTons(batchHeaderNetTons) }}</strong>
              </div>
              <div class="batch-detail-metric">
                <span class="batch-detail-metric-label">Кол-во рейсов</span>
                <strong class="batch-detail-metric-value">{{ currentBatchIntakes.length }}</strong>
              </div>
              <div class="batch-detail-metric">
                <span class="batch-detail-metric-label">Ср. влажность</span>
                <strong class="batch-detail-metric-value">{{ compositionAvgMoisture != null ? `${formatDecimalPlain(compositionAvgMoisture, 1)}%` : '—' }}</strong>
              </div>
            </div>
            <div class="batch-detail-toolbar">
              <div class="batch-detail-toolbar-left">
                <button type="button" class="batch-detail-icon-btn" aria-label="Печать" title="Печать" @click="printBatchView">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 9V2h12v7" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <path d="M6 14h12v8H6z" />
                  </svg>
                </button>
                <button type="button" class="warehouse-cell-btn batch-detail-passport-btn" @click="openPassportModal">Паспорт качества</button>
                <button type="button" class="warehouse-cell-btn batch-detail-passport-btn" @click="downloadPassportPdfStub">Скачать PDF</button>
              </div>
              <div v-if="canOperateOnCurrentBatch" class="batch-detail-actions">
                <button type="button" class="warehouse-cell-btn batch-detail-action-btn" :disabled="saving" @click="openSellModal">Продать</button>
                <button type="button" class="warehouse-cell-btn batch-detail-action-btn" :disabled="saving" @click="openWriteoffModal">Списать</button>
                <button type="button" class="warehouse-cell-btn batch-detail-action-btn batch-detail-action-btn--primary" :disabled="saving" @click="openTransferModal">Переместить</button>
              </div>
            </div>
          </div>

          <div class="batch-composition-block">
            <div class="batch-composition-head">
              <h3 class="batch-composition-title">Состав партии</h3>
            </div>
            <div class="warehouse-cell-table-wrap batch-composition-table-wrap">
              <table class="warehouse-cell-table warehouse-cell-table--composition">
                <thead>
                  <tr>
                    <th>Дата и время</th>
                    <th>Источник (Поле)</th>
                    <th>Зачётный вес (т)</th>
                    <th>Влажность (%)</th>
                    <th class="warehouse-cell-th-actions" aria-label="Действия" />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in currentBatchIntakesSorted" :key="row.id">
                    <td>{{ formatDateTimeRu(row.received_at) }}</td>
                    <td>{{ storageIntakeFieldLabel(row) }}</td>
                    <td>{{ formatDecimalPlain(Number(row.net_mass_tons || 0), 2) }}</td>
                    <td>{{ formatDecimalPlain(Number(row.moisture_percent || 0), 1) }}</td>
                    <td class="warehouse-cell-td-actions">
                      <UiDeleteButton
                        v-if="canOperateOnCurrentBatch"
                        size="xs"
                        aria-label="Исключить поступление из партии"
                        :disabled="saving"
                        @click="openDetachIntakeConfirm(row)"
                      />
                    </td>
                  </tr>
                  <tr v-if="!currentBatchIntakesSorted.length">
                    <td colspan="5" class="warehouse-cell-empty">В составе партии пока нет поступлений.</td>
                  </tr>
                </tbody>
                <tfoot v-if="currentBatchIntakes.length" class="warehouse-cell-tfoot-totals">
                  <tr>
                    <td colspan="2"><strong>Итого</strong></td>
                    <td><strong>{{ formatDecimalPlain(compositionNetTotal, 2) }}</strong></td>
                    <td><strong>{{ compositionAvgMoisture != null ? formatDecimalPlain(compositionAvgMoisture, 1) : '—' }}</strong></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </template>
        <div v-else class="warehouse-cell-empty-panel">
          <h2>Нет открытых партий</h2>
          <p>Соберите поступления в партию или откройте закрытую из истории операций.</p>
          <p>Тип: {{ storageLocationTypeName(storage) }} · Культура: {{ cropLabel }}</p>
        </div>
      </section>

      <section v-else-if="activeTab === 'history'" class="warehouse-cell-tab-panel">
        <div v-if="batches.length" class="warehouse-cell-table-wrap">
          <table class="warehouse-cell-table">
            <thead>
              <tr>
                <th>Код партии</th>
                <th>Дата формирования</th>
                <th>Культура</th>
                <th>Масса (т)</th>
                <th>Назначение</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="b in batches"
                :key="b.id"
                class="warehouse-cell-list-row"
                :class="{ 'warehouse-cell-list-row--closed': isStorageBatchClosed(b) }"
                tabindex="0"
                @click="selectBatchForView(b)"
                @keydown.enter.prevent="selectBatchForView(b)"
              >
                <td>{{ b.code }}</td>
                <td>{{ formatDateTimeRu(b.created_at) }}</td>
                <td>{{ storageBatchCropLabel(b) }}</td>
                <td>{{ Number(b.total_net_tons || 0).toFixed(2) }}</td>
                <td>{{ batchPurposeLabel(b.purpose) }}</td>
                <td>{{ storageBatchUiStatusLabel(storageBatchUiStatus(b)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="warehouse-cell-empty-panel">
          <h2>История операций</h2>
          <p>После формирования первой партии здесь появятся записи.</p>
        </div>
      </section>

      <section v-else class="warehouse-cell-tab-panel">
        <p class="warehouse-cell-writeoffs-hint">Журнал списаний по складу. Новые операции — из карточки открытой партии (Продать / Списать).</p>
        <div v-if="writeoffs.length" class="warehouse-cell-table-wrap">
          <table class="warehouse-cell-table">
            <thead>
              <tr>
                <th>Дата операции</th>
                <th>Партия</th>
                <th>Культура</th>
                <th>Тип списания</th>
                <th>Масса (т)</th>
                <th>Контрагент</th>
                <th>Кто провёл</th>
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in writeoffs"
                :key="row.id"
                class="warehouse-cell-list-row"
                :class="{ 'warehouse-cell-list-row--inactive': !row.batch_id }"
                :tabindex="row.batch_id ? 0 : undefined"
                @click="row.batch_id && openWriteoffBatchFromJournal(row.batch_id)"
                @keydown.enter.prevent="row.batch_id && openWriteoffBatchFromJournal(row.batch_id)"
              >
                <td>{{ formatDateOnlyRu(row.operation_date) }}</td>
                <td>{{ row.batches?.code || '—' }}</td>
                <td>{{ row.crops?.label || row.crops?.key || '—' }}</td>
                <td>{{ storageWriteoffTypeLabel(row.writeoff_type) }}</td>
                <td>{{ Number(row.mass_tons || 0).toFixed(2) }}</td>
                <td>{{ row.counterparty || '—' }}</td>
                <td>{{ row.actorName }}</td>
                <td>{{ row.comment || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="warehouse-cell-empty-panel">
          <h2>Списания</h2>
          <p>Записей о списании пока нет.</p>
        </div>
      </section>

      <footer v-show="activeTab !== 'batch' || !currentBatch || isCurrentBatchClosed" class="warehouse-cell-footer">
        <button type="button" class="warehouse-cell-btn warehouse-cell-btn--primary" @click="openIntakeModal">
          + Зафиксировать валовой сбор
        </button>
      </footer>

      <button
        v-if="canOperateOnCurrentBatch && activeTab === 'batch'"
        type="button"
        class="warehouse-cell-fab"
        @click="goAddToBatchFromFab"
      >
        + Добавить в партию
      </button>

      <WarehouseWriteoffModal
        :open="writeoffModalOpen"
        :storage-location-id="storage.id"
        :storage-name="storage.name"
        :batch-id="currentBatch?.id ?? null"
        :batch-code="currentBatch?.code ?? null"
        :mode="writeoffModalMode"
        @close="closeWriteoffModal"
        @success="onBatchOperationSuccess"
      />
      <WarehouseTransferModal
        :open="transferModalOpen"
        :places="storageOptions"
        :initial-from-id="storage.id"
        :initial-batch-id="currentBatch?.id ?? null"
        :lock-batch-selection="true"
        @close="closeTransferModal"
        @success="onBatchOperationSuccess"
      />
    </article>

    <teleport to="body">
      <div
        v-if="detachConfirmIntake"
        class="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detach-intake-title"
        @click.self="closeDetachIntakeConfirm"
      >
        <div class="modal warehouse-cell-confirm-modal" @click.stop>
          <div class="modal-header">
            <h2 id="detach-intake-title" class="modal-title">Исключить из партии?</h2>
            <ModalCloseButton @click="closeDetachIntakeConfirm" />
          </div>
          <div class="modal-body">
            <p class="warehouse-cell-confirm-text">
              Поступление {{ formatDateTimeRu(detachConfirmIntake.received_at) }}, {{ storageIntakeFieldLabel(detachConfirmIntake) }},
              зачётный вес {{ formatDecimalPlain(Number(detachConfirmIntake.net_mass_tons || 0), 2) }} т будет снова отмечено как неоформленное.
            </p>
          </div>
          <div class="modal-actions">
            <button type="button" class="task-form-cancel" :disabled="saving" @click="closeDetachIntakeConfirm">Отмена</button>
            <button type="button" class="task-form-submit" :disabled="saving" @click="confirmDetachIntakeFromBatch">
              {{ saving ? 'Сохранение…' : 'Исключить' }}
            </button>
          </div>
        </div>
      </div>
    </teleport>

    <teleport to="body">
      <div
        v-if="passportModalOpen && currentBatch"
        class="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Паспорт качества"
        @click.self="closePassportModal"
      >
        <div class="modal warehouse-intake-modal" @click.stop>
          <div class="modal-header">
            <h2 class="modal-title">Паспорт качества · {{ currentBatch.code }}</h2>
            <ModalCloseButton @click="closePassportModal" />
          </div>
          <div class="modal-body">
            <p class="batch-passport-crop">{{ storageBatchCropLabel(currentBatch) }}</p>
            <div class="warehouse-cell-quality warehouse-cell-quality--passport-editor">
              <div class="warehouse-cell-quality-row">
                <span>Протеин (%)</span>
                <input v-model.trim="passportForm.proteinPercent" class="task-form-input" type="text" inputmode="decimal" placeholder="14,5" />
              </div>
              <div v-if="passportIsOilCrop" class="warehouse-cell-quality-row">
                <span>Масличность (%)</span>
                <input v-model.trim="passportForm.oilContentPercent" class="task-form-input" type="text" inputmode="decimal" placeholder="42,0" />
              </div>
              <div class="warehouse-cell-quality-row">
                <span>Кислотное число</span>
                <input v-model.trim="passportForm.acidNumber" class="task-form-input" type="text" inputmode="decimal" placeholder="1,8" />
              </div>
              <div class="warehouse-cell-quality-row warehouse-cell-quality-row--radio">
                <span>ГМО</span>
                <div class="passport-radio-group">
                  <label class="passport-radio-option">
                    <input v-model="passportForm.gmoStatus" type="radio" value="detected" />
                    <span>Обнаружено</span>
                  </label>
                  <label class="passport-radio-option">
                    <input v-model="passportForm.gmoStatus" type="radio" value="not_detected" />
                    <span>Не обнаружено</span>
                  </label>
                </div>
              </div>
              <div class="warehouse-cell-quality-row warehouse-cell-quality-row--radio">
                <span>Пестициды</span>
                <div class="passport-radio-group">
                  <label class="passport-radio-option">
                    <input v-model="passportForm.pesticidesStatus" type="radio" value="normal" />
                    <span>В норме</span>
                  </label>
                  <label class="passport-radio-option">
                    <input v-model="passportForm.pesticidesStatus" type="radio" value="excess" />
                    <span>Превышение</span>
                  </label>
                </div>
              </div>
              <div class="warehouse-cell-quality-row">
                <span>Дата отбора пробы</span>
                <input v-model="passportForm.sampleDate" class="task-form-input" type="date" />
              </div>
              <div class="warehouse-cell-quality-row">
                <span>Номер лабораторного заключения</span>
                <input
                  v-model.trim="passportForm.labConclusionNumber"
                  class="task-form-input"
                  type="text"
                  placeholder="LZ-984410-23"
                />
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="task-form-cancel" :disabled="saving" @click="closePassportModal">Отмена</button>
            <button type="button" class="task-form-cancel" :disabled="saving" @click="downloadPassportPdfStub">Скачать паспорт PDF</button>
            <button type="button" class="task-form-submit" :disabled="saving" @click="savePassportQuality">
              {{ saving ? 'Сохранение…' : 'Сохранить изменения' }}
            </button>
          </div>
        </div>
      </div>
    </teleport>

    <teleport to="body">
      <div v-if="intakeModalOpen" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Зафиксировать валовой сбор" @click.self="closeIntakeModal">
        <div class="modal warehouse-intake-modal">
          <div class="modal-header">
            <h2 class="modal-title">Зафиксировать валовой сбор</h2>
            <ModalCloseButton @click="closeIntakeModal" />
          </div>
          <div class="modal-body">
            <div class="task-form-row task-form-row--two">
              <div class="task-form-field">
                <label class="task-form-label">Дата и время поступления</label>
                <input v-model="intakeForm.receivedAt" type="datetime-local" class="task-form-input" />
              </div>
              <div class="task-form-field">
                <label class="task-form-label">Масса брутто (т)</label>
                <input v-model.trim="intakeForm.grossMassTons" type="text" inputmode="decimal" class="task-form-input" placeholder="0,00" />
              </div>
            </div>

            <div class="task-form-row task-form-row--two">
              <div class="task-form-field">
                <label class="task-form-label">Источник (Поле)</label>
                <select v-model="intakeForm.fieldId" class="task-form-select">
                  <option value="" disabled>Выберите поле</option>
                  <option v-for="f in fields" :key="f.id" :value="f.id">Поле №{{ f.number }} ({{ f.name }})</option>
                </select>
              </div>
              <div class="task-form-field">
                <label class="task-form-label">Культура</label>
                <input class="task-form-input" type="text" :value="selectedCropLabel" disabled />
                <p class="warehouse-cell-hint">Культура определяется автоматически по выбранному полю.</p>
              </div>
            </div>

            <div class="warehouse-cell-form-section-title">Качество зерна</div>

            <div class="task-form-row task-form-row--two">
              <div class="task-form-field">
                <label class="task-form-label">Базовая влажность (%)</label>
                <input class="task-form-input" type="text" :value="selectedCropBaseMoistureLabel" disabled />
                <p class="warehouse-cell-hint">Подтягивается из справочника культур и не редактируется вручную.</p>
              </div>
              <div class="task-form-field">
                <label class="task-form-label">Влажность фактическая (%)</label>
                <input v-model.trim="intakeForm.moisturePercent" type="text" inputmode="decimal" class="task-form-input" />
              </div>
            </div>

            <div class="task-form-row task-form-row--two">
              <div class="task-form-field">
                <label class="task-form-label">Сорная примесь (%)</label>
                <input v-model.trim="intakeForm.weedImpurityPercent" type="text" inputmode="decimal" class="task-form-input" />
              </div>
              <div class="task-form-field">
                <label class="task-form-label">Зерновая примесь (%)</label>
                <input v-model.trim="intakeForm.grainImpurityPercent" type="text" inputmode="decimal" class="task-form-input" />
              </div>
            </div>

            <div class="warehouse-cell-form-section-title">Пошаговый расчёт зачётного веса</div>
            <div class="warehouse-cell-summary warehouse-cell-summary--calc">
              <div class="warehouse-cell-summary-row">
                <span>Масса брутто</span>
                <strong>{{ grossMassNum != null ? formatDecimalPlain(grossMassNum, 2) : '—' }} т</strong>
              </div>
              <div class="warehouse-cell-summary-row warehouse-cell-summary-row--formula">
                <span>
                  Масса после сушки:
                  {{
                    grossMassNum != null && moistureNum != null
                      ? `${formatDecimalPlain(grossMassNum, 2)} × (100 - ${formatDecimalPlain(moistureNum, 1)}) / (100 - ${selectedCropBaseMoistureLabel}) = ${dryMassNum != null ? formatDecimalPlain(dryMassNum, 2) : '—'} т`
                      : '—'
                  }}
                </span>
              </div>
              <div class="warehouse-cell-summary-row warehouse-cell-summary-row--formula">
                <span>
                  Потери на примеси:
                  {{
                    grossMassNum != null && totalImpurityPercentNum != null
                      ? `${formatDecimalPlain(grossMassNum, 2)} × ${formatDecimalPlain(totalImpurityPercentNum, 2)} / 100 = -${impurityLossNum != null ? formatDecimalPlain(impurityLossNum, 2) : '—'} т`
                      : '—'
                  }}
                </span>
              </div>
              <div class="warehouse-cell-summary-total">
                <span>ИТОГО ЗАЧЁТНЫЙ ВЕС</span>
                <strong>{{ netMassNum != null ? `${formatDecimalPlain(netMassNum, 2)} т` : '0,00 т' }}</strong>
              </div>
              <p class="warehouse-cell-hint warehouse-cell-hint--inline">
                Формула: Mзач = Mбр × (100 - Wфакт) / (100 - Wбаз) - Mбр × (Сор + Зерн) / 100
              </p>
            </div>

            <div class="task-form-row">
              <div class="task-form-field">
                <label class="task-form-label">Место складирования</label>
                <select v-model="intakeForm.storageLocationId" class="task-form-select">
                  <option v-for="x in storageOptions" :key="x.id" :value="x.id">{{ x.name }}</option>
                </select>
              </div>
            </div>

            <div class="task-form-row">
              <div class="task-form-field">
                <label class="task-form-label">Комментарий</label>
                <textarea v-model.trim="intakeForm.comment" rows="3" class="task-form-input" placeholder="Особенности партии, номер автомобиля или ФИО водителя..." />
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="task-form-cancel" :disabled="saving" @click="closeIntakeModal">Отмена</button>
            <button type="button" class="task-form-submit" :disabled="saving || !canSaveIntake" @click="saveIntake">
              {{ saving ? 'Сохранение…' : 'Сохранить запись' }}
            </button>
          </div>
        </div>
      </div>
    </teleport>

    <teleport to="body">
      <div v-if="batchWizardOpen" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Сформировать партию" @click.self="closeBatchWizard">
        <div class="modal warehouse-intake-modal">
          <div class="modal-header">
            <h2 class="modal-title">Сформировать партию зерна</h2>
            <ModalCloseButton @click="closeBatchWizard" />
          </div>
          <div class="modal-body">
            <div class="warehouse-cell-steps">
              <span :class="{ 'is-active': batchStep === 1 }">1. Источник зерна</span>
              <span :class="{ 'is-active': batchStep === 2 }">2. Параметры партии</span>
              <span :class="{ 'is-active': batchStep === 3 }">3. Подтверждение</span>
            </div>

            <div v-if="batchStep === 1">
              <div class="warehouse-cell-table-wrap">
                <table class="warehouse-cell-table warehouse-cell-table--batch-step1">
                  <thead>
                    <tr>
                      <th class="warehouse-cell-table-check" scope="col">В партии</th>
                      <th scope="col">Источник</th>
                      <th scope="col">Культура</th>
                      <th scope="col">Зачётный вес (т)</th>
                      <th scope="col">В партию (т)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in batchForm.selectedRows" :key="r.intakeId" :class="{ 'is-row-muted': !r.included }">
                      <td class="warehouse-cell-table-check">
                        <input v-model="r.included" type="checkbox" aria-label="Включить поступление в партию" />
                      </td>
                      <td>{{ storageIntakeFieldLabel(selectedIntakeMap.get(r.intakeId)!) }}</td>
                      <td>{{ storageIntakeCropLabel(selectedIntakeMap.get(r.intakeId)!) }}</td>
                      <td>{{ Number(selectedIntakeMap.get(r.intakeId)?.net_mass_tons || 0).toFixed(2) }}</td>
                      <td>
                        <input
                          v-model.trim="r.writeOffTons"
                          class="task-form-input"
                          type="text"
                          inputmode="decimal"
                          :disabled="!r.included"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="warehouse-cell-total">Общая масса новой партии: {{ formatTons(batchTotalNet) }}</p>
            </div>

            <div v-else-if="batchStep === 2">
              <div class="batch-fgis-blocks">
                <div class="batch-fgis-block">
                  <p class="batch-fgis-block-title">Назначение</p>
                  <p class="batch-fgis-block-hint">Куда направляется зерно</p>
                  <div class="batch-purpose-cards" role="radiogroup" aria-label="Назначение партии">
                    <label class="batch-purpose-card" :class="{ 'is-selected': batchForm.purpose === 'export' }">
                      <input v-model="batchForm.purpose" class="batch-purpose-card-input" type="radio" value="export" />
                      <span class="batch-purpose-card-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                      </span>
                      <span class="batch-purpose-card-label">Экспорт</span>
                    </label>
                    <label class="batch-purpose-card" :class="{ 'is-selected': batchForm.purpose === 'processing' }">
                      <input v-model="batchForm.purpose" class="batch-purpose-card-input" type="radio" value="processing" />
                      <span class="batch-purpose-card-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                        </svg>
                      </span>
                      <span class="batch-purpose-card-label">Переработка</span>
                    </label>
                    <label class="batch-purpose-card" :class="{ 'is-selected': batchForm.purpose === 'storage' }">
                      <input v-model="batchForm.purpose" class="batch-purpose-card-input" type="radio" value="storage" />
                      <span class="batch-purpose-card-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                          <line x1="12" y1="22.08" x2="12" y2="12" />
                        </svg>
                      </span>
                      <span class="batch-purpose-card-label">Хранение</span>
                    </label>
                  </div>
                </div>
                <div class="batch-fgis-block">
                  <p class="batch-fgis-block-title">Цель использования</p>
                  <p class="batch-fgis-block-hint">Пищевые или кормовые</p>
                  <div class="batch-use-goal-row" role="radiogroup" aria-label="Цель использования">
                    <label class="batch-use-goal-option" :class="{ 'is-selected': batchForm.useGoal === 'food' }">
                      <input v-model="batchForm.useGoal" class="batch-use-goal-input" type="radio" value="food" />
                      <span>Пищевые</span>
                    </label>
                    <label class="batch-use-goal-option" :class="{ 'is-selected': batchForm.useGoal === 'feed' }">
                      <input v-model="batchForm.useGoal" class="batch-use-goal-input" type="radio" value="feed" />
                      <span>Кормовые</span>
                    </label>
                  </div>
                </div>
              </div>
              <div class="warehouse-cell-quality warehouse-cell-quality--batch-editor">
                <div class="warehouse-cell-quality-row warehouse-cell-quality-row--head">
                  <span>Наименование</span>
                  <strong>Значение</strong>
                  <span class="warehouse-cell-quality-col-actions" aria-hidden="true" />
                </div>
                <div v-for="(row, idx) in batchForm.qualityRows" :key="idx" class="warehouse-cell-quality-row">
                  <input v-model.trim="row.name" class="task-form-input" type="text" />
                  <input v-model.trim="row.value" class="task-form-input" type="text" />
                  <div class="warehouse-cell-quality-row-actions">
                    <UiDeleteButton
                      v-if="row.removable"
                      size="xs"
                      aria-label="Удалить показатель"
                      @click="removeQualityRow(idx)"
                    />
                  </div>
                </div>
              </div>
              <button type="button" class="warehouse-cell-link-btn" @click="addQualityRow">+ Добавить показатель</button>
            </div>

            <div v-else>
              <div class="warehouse-cell-summary">
                <strong>{{ formatTons(batchTotalNet) }}</strong>
                <span>Источников: {{ selectedBatchRows.length }} · Культура: {{ batchCropLabel }}</span>
                <span>Назначение: {{ batchPurposeLabel(batchForm.purpose) }}</span>
                <span>Цель использования: {{ batchUseGoalLabel(batchForm.useGoal) }}</span>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button v-if="batchStep > 1" type="button" class="task-form-cancel" :disabled="saving" @click="batchStep = (batchStep - 1) as 1 | 2 | 3">Назад</button>
            <button v-if="batchStep < 3" type="button" class="task-form-submit" :disabled="saving || (batchStep === 1 && !canProceedBatchStep2)" @click="batchStep = (batchStep + 1) as 1 | 2 | 3">Далее</button>
            <button v-else type="button" class="task-form-submit" :disabled="saving || !canFinishBatch" @click="finishBatchFormation">{{ saving ? 'Формирование…' : 'Сформировать партию' }}</button>
          </div>
        </div>
      </div>
    </teleport>
  </section>
</template>

<style scoped>
.warehouse-cell-page { width: 100%; display: flex; flex-direction: column; gap: 12px; }
.warehouse-cell-header { display: flex; align-items: center; }
.warehouse-cell-back {
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  border-radius: 10px;
  height: 34px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.warehouse-cell-loading { padding: 32px 8px; }
.warehouse-cell-alert { border: 1px solid var(--border-color); background: var(--bg-panel); border-radius: 12px; padding: 12px; }
.warehouse-cell-alert--error { color: var(--danger-red); border-color: color-mix(in srgb, var(--danger-red) 24%, var(--border-color)); }
.warehouse-cell-card { border: 1px solid var(--border-color); border-radius: 14px; background: var(--bg-panel); padding: 14px; box-shadow: var(--shadow-card); }
.warehouse-cell-top { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; }
.warehouse-cell-title-wrap { min-width: 0; }
.warehouse-cell-title { margin: 0; font-size: 1.9rem; line-height: 1.15; color: var(--text-primary); }
.warehouse-cell-subtitle { margin: 8px 0 0; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 6px; }
.warehouse-cell-status { display: inline-flex; margin-top: 8px; padding: 4px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; }
.warehouse-cell-status--empty { background: rgba(100,116,139,.2); color: var(--text-secondary); border:1px solid rgba(100,116,139,.35);}
.warehouse-cell-status--filling { background: rgba(245,158,11,.22); color:#b45309; border:1px solid rgba(245,158,11,.45);}
.warehouse-cell-status--formed { background: rgba(34,197,94,.18); color:#15803d; border:1px solid rgba(34,197,94,.4);}
.warehouse-cell-actions { display: flex; gap: 8px; align-items: flex-start; }
.warehouse-cell-btn { height: 36px; border-radius: 9px; border: 1px solid var(--border-color); background: var(--bg-panel); color: var(--text-primary); padding: 0 12px; font-weight: 500; cursor: pointer; }
.warehouse-cell-btn:disabled { opacity: .6; cursor: not-allowed; }
.warehouse-cell-btn--primary { background: var(--accent-green); border-color: var(--accent-green); color: #fff; }
.warehouse-cell-btn--soft { background: color-mix(in srgb, var(--accent-green) 16%, #fff); border-color: color-mix(in srgb, var(--accent-green) 28%, var(--border-color)); }
.warehouse-cell-tabs { display: flex; gap: 8px; padding-top: 12px; border-bottom: 1px solid var(--border-color); }
.warehouse-cell-tab { border: none; background: transparent; color: var(--text-secondary); padding: 8px 2px; cursor: pointer; font-weight: 500; border-bottom: 2px solid transparent; }
.warehouse-cell-tab.is-active { color: var(--accent-green); border-bottom-color: var(--accent-green); }
.warehouse-cell-tab-panel { padding-top: 12px; }
.warehouse-cell-warning { border: 1px solid color-mix(in srgb, var(--warning-orange) 28%, var(--border-color)); background: color-mix(in srgb, var(--warning-orange) 10%, var(--bg-panel)); border-radius: 10px; padding: 10px 12px; display: flex; justify-content: space-between; gap: 10px; align-items: center; }
.warehouse-cell-writeoffs-hint { margin: 0 0 10px; font-size: 0.86rem; color: var(--text-secondary); }
.warehouse-cell-table-wrap { margin-top: 10px; border: 1px solid var(--border-color); border-radius: 10px; overflow: auto; }
.warehouse-cell-table { width: 100%; min-width: 900px; border-collapse: collapse; }
.warehouse-cell-table th, .warehouse-cell-table td { padding: 10px 12px; border-bottom: 1px solid var(--border-color); text-align: left; font-size: .86rem; }
.warehouse-cell-table th { font-size: .74rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-secondary); }
.warehouse-cell-empty { color: var(--text-secondary); text-align: center !important; padding: 24px 12px !important; }
.warehouse-cell-empty-panel { border: 1px dashed var(--border-color); border-radius: 10px; padding: 20px; color: var(--text-secondary); }
.warehouse-cell-empty-panel h2 { margin: 0 0 6px; font-size: 1rem; color: var(--text-primary); }
.warehouse-cell-empty-panel p { margin: 0; }
.warehouse-cell-footer { padding-top: 12px; display: flex; justify-content: flex-end; }
.warehouse-cell-warning-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; align-items: center; }
.batch-detail-card {
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  border-radius: 14px;
  padding: 16px 18px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px 28px;
  align-items: start;
}
.batch-detail-card-main { min-width: 0; grid-column: 1; }
.batch-detail-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.batch-detail-title { margin: 0; font-size: 1.35rem; line-height: 1.2; color: var(--text-primary); }
.batch-detail-badge {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.batch-detail-badge--open {
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  color: var(--accent-green);
  border: 1px solid color-mix(in srgb, var(--accent-green) 35%, var(--border-color));
}
.batch-detail-badge--closed {
  background: color-mix(in srgb, var(--text-secondary) 16%, transparent);
  color: var(--text-secondary);
  border: 1px solid color-mix(in srgb, var(--text-secondary) 28%, var(--border-color));
}
.warehouse-cell-intakes-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.warehouse-cell-attach-target {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.warehouse-cell-attach-target-label {
  font-size: 0.82rem;
  color: var(--text-secondary);
}
.warehouse-cell-attach-select {
  min-width: 220px;
}
.batch-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.batch-detail-action-btn {
  min-width: 108px;
}
.batch-detail-action-btn--primary {
  background: var(--accent-green);
  border-color: var(--accent-green);
  color: #fff;
}
.warehouse-cell-list-row {
  cursor: pointer;
  transition: background-color 0.22s ease, box-shadow 0.22s ease;
}
.warehouse-cell-list-row:hover {
  background-color: color-mix(in srgb, var(--accent-green) 9%, var(--bg-panel));
  box-shadow: inset 3px 0 0 var(--accent-green);
}
.warehouse-cell-list-row--closed {
  opacity: 0.72;
  color: var(--text-secondary);
}
.warehouse-cell-list-row--closed:hover {
  opacity: 0.85;
  background-color: color-mix(in srgb, var(--text-secondary) 8%, var(--bg-panel));
  box-shadow: inset 3px 0 0 var(--text-secondary);
}
.warehouse-cell-list-row--inactive {
  cursor: default;
}
.warehouse-cell-list-row--inactive:hover {
  background-color: transparent;
  box-shadow: none;
  opacity: 1;
}
.batch-detail-meta { margin: 8px 0 0; font-size: 0.88rem; color: var(--text-secondary); }
.batch-detail-meta--muted { margin-top: 4px; font-size: 0.8rem; }
.batch-detail-metrics {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 200px;
}
.batch-detail-metric { text-align: right; }
.batch-detail-metric-label { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-secondary); }
.batch-detail-metric-value { font-size: 1.15rem; color: var(--text-primary); }
.batch-detail-toolbar {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
  margin-top: 4px;
  border-top: 1px solid var(--border-color);
}
.batch-detail-toolbar-left { display: flex; align-items: center; gap: 10px; margin-right: auto; }
.batch-fgis-status {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: .78rem;
  font-weight: 700;
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
}
.batch-fgis-status--ready {
  border-color: color-mix(in srgb, var(--accent-green) 35%, var(--toolbar-form-surface-border));
}
.batch-fgis-status--uploaded {
  border-color: color-mix(in srgb, var(--accent-green) 55%, var(--toolbar-form-surface-border));
  background: color-mix(in srgb, var(--accent-green) 10%, var(--toolbar-form-surface));
}
.batch-detail-icon-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--bg-panel);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.batch-detail-icon-btn:hover { color: var(--text-primary); }
.batch-detail-passport-btn { background: var(--bg-panel); }
.batch-detail-complete-btn {
  background: #6690e9;
  border-color: #6690e9;
  color: #fff;
}
.batch-composition-block { margin-top: 18px; }
.batch-composition-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
.batch-composition-title { margin: 0; font-size: 1.05rem; color: var(--text-primary); }
.batch-composition-sort { display: inline-flex; align-items: center; gap: 8px; font-size: 0.86rem; color: var(--text-secondary); }
.batch-composition-sort-label { white-space: nowrap; }
.batch-composition-sort-select {
  min-width: 220px;
  height: 36px;
  border-radius: 9px;
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  padding: 0 10px;
  font-size: 0.86rem;
}
.warehouse-cell-table--composition { min-width: 880px; }
.warehouse-cell-th-actions { width: 56px; }
.warehouse-cell-td-actions { text-align: center; vertical-align: middle; }
.warehouse-cell-tfoot-totals { background: color-mix(in srgb, var(--toolbar-form-surface) 72%, var(--bg-panel)); }
.warehouse-cell-tfoot-totals td { font-weight: 600; border-top: 2px solid var(--border-color); }
.warehouse-cell-fab {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 40;
  height: 48px;
  padding: 0 20px;
  border-radius: 999px;
  border: none;
  background: #6690e9;
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.warehouse-cell-fab:hover { filter: brightness(1.05); }
.warehouse-cell-confirm-modal { max-width: 460px; }
.warehouse-cell-confirm-text { margin: 0; line-height: 1.5; color: var(--text-secondary); }
.batch-passport-crop { margin: 0 0 12px; font-weight: 600; color: var(--text-primary); }
.warehouse-cell-hint { margin: 6px 0 0; font-size: .78rem; color: var(--text-secondary); }
.warehouse-cell-hint--inline { margin-top: 6px; }
.warehouse-cell-form-section-title {
  font-size: .8rem;
  text-transform: uppercase;
  letter-spacing: .06em;
  font-weight: 700;
  color: var(--text-secondary);
  margin-top: 4px;
}
.warehouse-cell-summary {
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.warehouse-cell-quality { border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden; margin-top: 10px; }
.warehouse-cell-quality--batch-editor { overflow: visible; }
.warehouse-cell-quality--batch-editor .warehouse-cell-quality-row {
  grid-template-columns: minmax(0, 1fr) minmax(120px, 190px) 52px;
}
.warehouse-cell-quality--batch-editor .warehouse-cell-quality-row--head {
  grid-template-columns: minmax(0, 1fr) minmax(120px, 190px) 52px;
  align-items: center;
}
.warehouse-cell-quality-col-actions { min-width: 0; }
.warehouse-cell-quality-row-actions {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: 44px;
  padding-top: 2px;
}
.warehouse-cell-quality-row { display: grid; grid-template-columns: 1fr 190px; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border-color); align-items: center; }
.warehouse-cell-quality-row:last-child { border-bottom: 0; }
.warehouse-cell-quality-row--head { font-size: .76rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-secondary); background: color-mix(in srgb, var(--toolbar-form-surface) 84%, #fff); }
.warehouse-cell-quality--passport-editor .warehouse-cell-quality-row {
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 340px);
}
.warehouse-cell-quality-row--radio {
  align-items: flex-start;
}
.passport-radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  justify-content: flex-end;
}
.passport-radio-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  font-size: .92rem;
}
.passport-radio-option input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-green);
}
.warehouse-cell-link-btn { margin-top: 10px; border: none; background: transparent; color: #6690e9; font-size: 1.15rem; cursor: pointer; padding: 0; }
.warehouse-cell-total { margin: 10px 0 0; font-size: .95rem; font-weight: 600; color: var(--text-primary); }
.warehouse-cell-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; font-size: .86rem; color: var(--text-secondary); }
.warehouse-cell-steps span { border: 1px solid var(--border-color); border-radius: 999px; padding: 6px 10px; text-align: center; }
.warehouse-cell-steps span.is-active { border-color: color-mix(in srgb, var(--accent-green) 45%, var(--border-color)); color: var(--text-primary); background: color-mix(in srgb, var(--accent-green) 10%, var(--bg-panel)); }
.warehouse-cell-summary strong { font-size: 1.35rem; color: var(--text-primary); }
.warehouse-cell-summary span { font-size: .8rem; color: var(--text-secondary); }
.warehouse-cell-summary--calc {
  gap: 8px;
}
.warehouse-cell-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px dashed var(--toolbar-form-surface-border);
  padding-bottom: 8px;
}
.warehouse-cell-summary-row:last-of-type {
  border-bottom: 0;
  padding-bottom: 0;
}
.warehouse-cell-summary-row--formula {
  align-items: flex-start;
}
.warehouse-cell-summary-row strong {
  font-size: 1rem;
}
.warehouse-cell-summary-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 2px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}
.modal {
  width: min(calc(100vw - 48px), 980px);
  max-height: 92vh;
  overflow-y: auto;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
}
.warehouse-intake-modal { max-width: 960px; }
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border-color);
}
.modal-title { margin: 0; font-size: 1.7rem; color: var(--text-primary); }
/* .modal-close styles are in global.css */
.modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.task-form-row { display: flex; gap: 12px; }
.task-form-row--two > .task-form-field { width: 50%; }
.task-form-field { width: 100%; display: flex; flex-direction: column; gap: 6px; }
.task-form-label { font-size: .88rem; font-weight: 600; color: var(--text-secondary); }
.task-form-input, .task-form-select {
  height: 44px;
  border: 1px solid var(--toolbar-form-surface-border);
  border-radius: 10px;
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  padding: 0 12px;
  font-size: 1.05rem;
}
textarea.task-form-input { min-height: 70px; height: auto; padding: 10px 12px; resize: vertical; }
.modal-actions {
  border-top: 1px solid var(--border-color);
  padding: 12px 18px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.task-form-cancel, .task-form-submit {
  height: 42px;
  border-radius: 10px;
  padding: 0 22px;
  font-size: 1.05rem;
  font-weight: 600;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  cursor: pointer;
}
.task-form-submit { background: var(--accent-green); border-color: var(--accent-green); color: #fff; }

.batch-purpose-card { position: relative; border: 1px solid var(--toolbar-form-surface-border); border-radius: 12px; background: var(--toolbar-form-surface); padding: 14px 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.batch-purpose-card.is-selected {
  border-color: color-mix(in srgb, var(--accent-green) 55%, var(--border-color));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-green) 22%, transparent);
}
.batch-purpose-card-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  margin: 0;
}
.batch-purpose-card:focus-within { outline: 2px solid color-mix(in srgb, var(--accent-green) 45%, transparent); outline-offset: 2px; border-radius: 12px; }
.batch-purpose-card-icon { color: var(--text-secondary); }
.batch-purpose-card.is-selected .batch-purpose-card-icon { color: var(--accent-green); }
.batch-purpose-card-label { font-weight: 600; font-size: 0.9rem; color: var(--text-primary); }
.batch-fgis-blocks { display: flex; flex-direction: column; gap: 22px; }
.batch-fgis-block-title { margin: 0 0 4px; font-weight: 700; font-size: 0.95rem; color: var(--text-primary); }
.batch-fgis-block-hint { margin: 0 0 12px; font-size: 0.78rem; color: var(--text-secondary); line-height: 1.35; }
.batch-purpose-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.batch-use-goal-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.batch-use-goal-option {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  cursor: pointer;
  font-weight: 500;
  color: var(--text-primary);
}
.batch-use-goal-option.is-selected {
  border-color: color-mix(in srgb, var(--accent-green) 55%, var(--border-color));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-green) 28%, transparent);
}
.batch-use-goal-input { width: 18px; height: 18px; accent-color: var(--accent-green); flex-shrink: 0; }
.warehouse-cell-table-check { width: 92px; text-align: center; vertical-align: middle; }
.warehouse-cell-table--batch-step1 { min-width: 760px; }
tr.is-row-muted td:not(.warehouse-cell-table-check) { opacity: 0.48; }

@media (max-width: 900px) {
  .warehouse-cell-top { flex-direction: column; }
  .warehouse-cell-actions { width: 100%; }
  .warehouse-cell-btn { width: 100%; }
  .warehouse-cell-warning { flex-direction: column; align-items: stretch; }
  .warehouse-cell-tabs { overflow: auto; }
  .task-form-row { flex-direction: column; }
  .task-form-row--two > .task-form-field { width: 100%; }
  .warehouse-cell-quality-row { grid-template-columns: 1fr; }
  .warehouse-cell-quality--batch-editor .warehouse-cell-quality-row {
    grid-template-columns: 1fr;
  }
  .warehouse-cell-quality-row-actions {
    justify-content: flex-start;
    min-height: auto;
    padding-top: 0;
  }
  .warehouse-cell-steps { grid-template-columns: 1fr; }
  .batch-purpose-cards { grid-template-columns: 1fr; }
  .warehouse-cell-table--batch-step1 { min-width: 0; }
  .batch-detail-card { grid-template-columns: 1fr; }
  .batch-detail-metrics { grid-column: 1; min-width: 0; }
  .batch-detail-metric { text-align: left; }
  .batch-detail-toolbar { flex-direction: column; align-items: stretch; }
  .batch-detail-toolbar-left { margin-right: 0; flex-wrap: wrap; }
  .warehouse-cell-summary-row,
  .warehouse-cell-summary-total {
    flex-direction: column;
    align-items: flex-start;
  }
  .warehouse-cell-fab { right: 16px; bottom: 16px; max-width: calc(100vw - 32px); }
}
</style>
