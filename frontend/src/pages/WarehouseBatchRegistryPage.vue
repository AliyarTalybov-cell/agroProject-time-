<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  formStorageBatch,
  isStorageBatchClosed,
  loadStorageBatchesRegistry,
  storageBatchCropLabel,
  storageBatchUiStatus,
  storageBatchUiStatusLabel,
  type StorageBatchRow,
} from '@/lib/storageBatchesSupabase'
import { loadStorageLocations } from '@/lib/storageLocationsSupabase'
import { loadStorageIntakes, storageIntakeCropLabel, storageIntakeFieldLabel, type StorageIntakeRow } from '@/lib/storageIntakesSupabase'
import { loadCrops, type CropRow } from '@/lib/landTypesAndCrops'

const router = useRouter()
const loading = ref(false)
const error = ref<string | null>(null)
const exportError = ref<string | null>(null)
const exportingBatchId = ref<string | null>(null)
const exportMenuOpen = ref(false)
const exportingAll = ref(false)
const openRowMenuId = ref<string | null>(null)
const rowMenuPos = ref<{ top: number; left: number }>({ top: 0, left: 0 })
const createModalOpen = ref(false)
const createStep = ref<1 | 2 | 3>(1)
const creatingBatch = ref(false)
const createBatchError = ref<string | null>(null)
const createIntakes = ref<StorageIntakeRow[]>([])
const rows = ref<StorageBatchRow[]>([])
const crops = ref<CropRow[]>([])
const storageOptions = ref<{ id: string; name: string }[]>([])
const totalFiltered = ref(0)
const createForm = ref({
  storageLocationId: '',
  purpose: 'export',
  useGoal: 'food',
  selectedRows: [] as Array<{ intakeId: string; included: boolean; writeOffTons: string }>,
  qualityRows: [
    { name: 'Влажность (%)', value: '', removable: false },
    { name: 'Сорная примесь (%)', value: '', removable: false },
    { name: 'Клейковина (%)', value: '', removable: false },
    { name: 'Натура (г/л)', value: '', removable: false },
  ] as Array<{ name: string; value: string; removable: boolean }>,
})

const search = ref('')
const cropFilter = ref('all')
const statusFilter = ref<'all' | 'open' | 'closed'>('all')
const storageFilter = ref('all')
const dateFrom = ref('')
const dateTo = ref('')

const page = ref(1)
const pageSize = ref(10)

function locationJoin(row: StorageBatchRow): { id: string; name: string; address: string } | null {
  const x = row.storage_locations
  if (!x) return null
  return Array.isArray(x) ? x[0] ?? null : x
}

function formatDateRu(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatMass(value: number): string {
  return Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function batchStatus(row: StorageBatchRow): 'open' | 'closed' {
  return storageBatchUiStatus(row)
}

function batchStatusLabel(status: 'open' | 'closed'): string {
  return storageBatchUiStatusLabel(status)
}

const totalPages = computed(() => Math.max(1, Math.ceil(totalFiltered.value / pageSize.value)))
const pageStart = computed(() => (totalFiltered.value ? (page.value - 1) * pageSize.value + 1 : 0))
const pageEnd = computed(() => Math.min((page.value - 1) * pageSize.value + rows.value.length, totalFiltered.value))
const pagedRows = computed(() => rows.value)
const openRowMenu = computed(() => (openRowMenuId.value ? rows.value.find((r) => r.id === openRowMenuId.value) ?? null : null))
const pageNumbers = computed(() => {
  if (totalPages.value <= 7) return Array.from({ length: totalPages.value }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  if (page.value > 4) pages.push('ellipsis')
  for (let p = Math.max(2, page.value - 1); p <= Math.min(totalPages.value - 1, page.value + 1); p += 1) pages.push(p)
  if (page.value < totalPages.value - 3) pages.push('ellipsis')
  pages.push(totalPages.value)
  return pages
})

watch([search, cropFilter, statusFilter, storageFilter, dateFrom, dateTo, pageSize], () => {
  page.value = 1
})
watch([search, cropFilter, statusFilter, storageFilter, dateFrom, dateTo, pageSize, page], () => {
  void loadData()
})

function resetFilters() {
  search.value = ''
  cropFilter.value = 'all'
  statusFilter.value = 'all'
  storageFilter.value = 'all'
  dateFrom.value = ''
  dateTo.value = ''
  page.value = 1
}

function setPage(next: number) {
  page.value = Math.min(totalPages.value, Math.max(1, next))
}

function goCreateBatch() {
  createBatchError.value = null
  createForm.value = {
    storageLocationId: storageFilter.value !== 'all' ? storageFilter.value : (storageOptions.value[0]?.id ?? ''),
    purpose: 'export',
    useGoal: 'food',
    selectedRows: [],
    qualityRows: [
      { name: 'Влажность (%)', value: '', removable: false },
      { name: 'Сорная примесь (%)', value: '', removable: false },
      { name: 'Клейковина (%)', value: '', removable: false },
      { name: 'Натура (г/л)', value: '', removable: false },
    ],
  }
  createModalOpen.value = true
  createStep.value = 1
}

function openBatch(row: StorageBatchRow) {
  if (!row.storage_location_id) return
  void router.push({
    name: 'warehouse-cell',
    params: { id: row.storage_location_id },
    query: { tab: 'batch', batchId: row.id },
  })
}

function toggleRowMenu(id: string, event: MouseEvent) {
  if (openRowMenuId.value === id) {
    openRowMenuId.value = null
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const menuWidth = 200
  const menuHeight = 150
  let left = rect.right - menuWidth
  if (left < 8) left = 8
  let top = rect.bottom + 6
  if (top + menuHeight > window.innerHeight - 8) {
    const above = rect.top - 6 - menuHeight
    if (above >= 8) top = above
  }
  rowMenuPos.value = { top, left }
  openRowMenuId.value = id
}

function closeRowMenu() {
  openRowMenuId.value = null
}

function sanitizeFileBase(value: string): string {
  return value.replace(/[^\p{L}\p{N}\-_]+/gu, '_')
}

async function exportSingleBatch(row: StorageBatchRow, format: 'excel' | 'csv' | 'pdf') {
  closeRowMenu()
  if (exportingBatchId.value) return
  exportError.value = null
  exportingBatchId.value = row.id
  try {
    const base = `${sanitizeFileBase(row.code)}_${new Date().toISOString().slice(0, 10)}`
    await runExport([row], format, base, `Партия ${row.code}`)
  } catch (e) {
    exportError.value = e instanceof Error && e.message ? e.message : 'Не удалось экспортировать партию'
  } finally {
    exportingBatchId.value = null
  }
}

function escapeHtml(value: unknown): string {
  const div = document.createElement('div')
  div.textContent = String(value ?? '')
  return div.innerHTML
}

function escapeDelimitedCell(value: unknown, sep: string): string {
  const s = String(value ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""')
  return s.includes(sep) || s.includes('"') || s.includes('\r') ? `"${s}"` : s
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const EXPORT_HEADERS = ['№', 'Номер партии', 'Культура', 'Масса (т)', 'Статус', 'Место хранения', 'Назначение', 'Дата формирования']

function batchToExportCells(row: StorageBatchRow, index: number): string[] {
  return [
    String(index + 1),
    row.code,
    storageBatchCropLabel(row),
    formatMass(row.total_net_tons),
    batchStatusLabel(batchStatus(row)),
    locationJoin(row)?.name || '—',
    row.purpose || '—',
    formatDateRu(row.created_at),
  ]
}

async function loadAllFilteredBatches(): Promise<StorageBatchRow[]> {
  const res = await loadStorageBatchesRegistry({
    search: search.value,
    cropKey: cropFilter.value !== 'all' ? cropFilter.value : undefined,
    status: statusFilter.value !== 'all' ? statusFilter.value : undefined,
    storageLocationId: storageFilter.value !== 'all' ? storageFilter.value : undefined,
    dateFrom: dateFrom.value || undefined,
    dateTo: dateTo.value || undefined,
    page: 1,
    pageSize: 100000,
  })
  return res.rows
}

function exportRowsToCsv(allRows: StorageBatchRow[], filename: string) {
  const sep = ';'
  const line = (arr: string[]) => arr.map((v) => escapeDelimitedCell(v, sep)).join(sep)
  const body = allRows.map((r, i) => line(batchToExportCells(r, i)))
  const csv = '\uFEFF' + [line(EXPORT_HEADERS), ...body].join('\r\n')
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
}

function exportRowsToExcel(allRows: StorageBatchRow[], filename: string) {
  const headerCells = EXPORT_HEADERS.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const bodyRows = allRows
    .map((r, i) => `<tr>${batchToExportCells(r, i).map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`
  downloadBlob(new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }), filename)
}

async function exportRowsToPdf(allRows: StorageBatchRow[], filename: string, title: string) {
  const headerCells = EXPORT_HEADERS.map((h) => `<th style="padding:6px;border:1px solid #cbd5e1;text-align:left;">${escapeHtml(h)}</th>`).join('')
  const bodyRows = allRows
    .map((r, i) => `<tr>${batchToExportCells(r, i).map((c) => `<td style="padding:6px;border:1px solid #cbd5e1;">${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')
  const html = `
    <div style="position:fixed;left:-9999px;top:0;width:1300px;font-family:Arial,sans-serif;font-size:12px;background:#fff;">
      <h2 style="margin:0 0 12px 0;font-size:16px;">${escapeHtml(title)}</h2>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead><tr style="background:#2d5a3d;color:#fff;">${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`
  const wrap = document.createElement('div')
  wrap.innerHTML = html.trim()
  const el = wrap.firstElementChild as HTMLElement
  document.body.appendChild(el)
  try {
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false })
    const imgData = canvas.toDataURL('image/png')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 10
    const maxW = pageW - margin * 2
    const maxH = pageH - margin * 2
    let w = maxW
    let h = (canvas.height / canvas.width) * w
    if (h > maxH) {
      h = maxH
      w = (canvas.width / canvas.height) * h
    }
    doc.addImage(imgData, 'PNG', margin, margin, w, h)
    doc.save(filename)
  } finally {
    el.remove()
  }
}

async function runExport(allRows: StorageBatchRow[], format: 'excel' | 'csv' | 'pdf', filenameBase: string, title: string) {
  if (format === 'excel') exportRowsToExcel(allRows, `${filenameBase}.xls`)
  else if (format === 'csv') exportRowsToCsv(allRows, `${filenameBase}.csv`)
  else await exportRowsToPdf(allRows, `${filenameBase}.pdf`, title)
}

function toggleExportMenu() {
  exportMenuOpen.value = !exportMenuOpen.value
}

function closeExportMenu() {
  exportMenuOpen.value = false
}

async function exportRegistry(format: 'excel' | 'csv' | 'pdf') {
  closeExportMenu()
  if (exportingAll.value) return
  exportError.value = null
  exportingAll.value = true
  try {
    const allRows = await loadAllFilteredBatches()
    if (!allRows.length) {
      exportError.value = 'Нет данных для экспорта по текущим фильтрам'
      return
    }
    await runExport(allRows, format, `реестр_партий_${new Date().toISOString().slice(0, 10)}`, 'Реестр партий')
  } catch (e) {
    exportError.value = e instanceof Error && e.message ? e.message : 'Не удалось выполнить экспорт'
  } finally {
    exportingAll.value = false
  }
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeExportMenu()
    closeRowMenu()
  }
}

function onGlobalPointerDown(event: MouseEvent) {
  if (!exportMenuOpen.value && openRowMenuId.value === null) return
  const target = event.target as HTMLElement | null
  if (target && target.closest('.registry-export, .registry-row-export, .registry-export-menu')) return
  closeExportMenu()
  closeRowMenu()
}

function parseDecimal(value: string): number | null {
  const n = Number(value.replace(',', '.').trim())
  if (!Number.isFinite(n)) return null
  return n
}

const createUnbatchedIntakes = computed(() => createIntakes.value.filter((x) => !x.batch_id))
const createSelectedRows = computed(() => createForm.value.selectedRows.filter((x) => x.included && (parseDecimal(x.writeOffTons) || 0) > 0))
const createSelectedIntakeMap = computed(() => new Map(createUnbatchedIntakes.value.map((x) => [x.id, x])))
const createBatchTotalNet = computed(() => createSelectedRows.value.reduce((sum, x) => sum + (parseDecimal(x.writeOffTons) || 0), 0))
const createBatchCropKey = computed(() => {
  const keys = new Set<string>()
  for (const row of createSelectedRows.value) {
    const intake = createSelectedIntakeMap.value.get(row.intakeId)
    if (intake?.crop_key) keys.add(intake.crop_key)
  }
  if (!keys.size) return null
  return [...keys][0] ?? null
})
const createBatchCropLabel = computed(() => {
  const key = createBatchCropKey.value
  if (!key) return '—'
  return crops.value.find((c) => c.key === key)?.label ?? key
})
const canProceedCreateStep2 = computed(() => createSelectedRows.value.length > 0 && createBatchTotalNet.value > 0 && !!createForm.value.storageLocationId)
const canCreateBatch = computed(() => canProceedCreateStep2.value && createForm.value.qualityRows.every((x) => x.name.trim()))

function createRowState(intakeId: string) {
  return createForm.value.selectedRows.find((x) => x.intakeId === intakeId) ?? null
}

function toggleCreateIntakeIncluded(intakeId: string, included: boolean) {
  const current = createRowState(intakeId)
  if (current) current.included = included
}

function setCreateIntakeWriteOff(intakeId: string, value: string) {
  const current = createRowState(intakeId)
  if (current) current.writeOffTons = value
}

function onToggleCreateIntake(intakeId: string, event: Event) {
  const target = event.target as HTMLInputElement | null
  toggleCreateIntakeIncluded(intakeId, !!target?.checked)
}

function onCreateMassInput(intakeId: string, event: Event) {
  const target = event.target as HTMLInputElement | null
  setCreateIntakeWriteOff(intakeId, target?.value ?? '')
}

watch(
  () => createForm.value.storageLocationId,
  () => {
    if (!createModalOpen.value) return
    void loadCreateIntakes()
  },
)

async function loadCreateIntakes() {
  const storageLocationId = createForm.value.storageLocationId
  if (!storageLocationId || !isSupabaseConfigured()) {
    createIntakes.value = []
    createForm.value.selectedRows = []
    return
  }
  try {
    const intakeRows = await loadStorageIntakes(storageLocationId)
    createIntakes.value = intakeRows
    createForm.value.selectedRows = intakeRows
      .filter((x) => !x.batch_id)
      .map((x) => ({ intakeId: x.id, included: true, writeOffTons: String(Number(x.net_mass_tons || 0).toFixed(2)).replace('.', ',') }))
  } catch (e) {
    createBatchError.value = e instanceof Error && e.message ? e.message : 'Не удалось загрузить поступления для формирования партии'
    createIntakes.value = []
    createForm.value.selectedRows = []
  }
}

function closeCreateModal() {
  if (creatingBatch.value) return
  createModalOpen.value = false
}

function addCreateQualityRow() {
  createForm.value.qualityRows.push({ name: '', value: '', removable: true })
}

function removeCreateQualityRow(index: number) {
  if (!createForm.value.qualityRows[index]?.removable) return
  createForm.value.qualityRows.splice(index, 1)
}

async function submitCreateBatch() {
  if (!canCreateBatch.value) return
  creatingBatch.value = true
  createBatchError.value = null
  try {
    const quality: Record<string, string> = {}
    for (const row of createForm.value.qualityRows) {
      const name = row.name.trim()
      if (!name) continue
      quality[name] = row.value.trim()
    }
    await formStorageBatch({
      storageLocationId: createForm.value.storageLocationId,
      intakeIds: createSelectedRows.value.map((x) => x.intakeId),
      cropKey: createBatchCropKey.value,
      purpose: createForm.value.purpose,
      useGoal: createForm.value.useGoal,
      quality,
      totalNetTons: Number(createBatchTotalNet.value.toFixed(2)),
    })
    createModalOpen.value = false
    await loadData()
  } catch (e) {
    createBatchError.value = e instanceof Error && e.message ? e.message : 'Не удалось сформировать партию'
  } finally {
    creatingBatch.value = false
  }
}

async function loadData() {
  if (!isSupabaseConfigured()) {
    rows.value = []
    crops.value = []
    totalFiltered.value = 0
    return
  }
  loading.value = true
  error.value = null
  try {
    const [batchPage, cropRows] = await Promise.all([
      loadStorageBatchesRegistry({
        search: search.value,
        cropKey: cropFilter.value !== 'all' ? cropFilter.value : undefined,
        status: statusFilter.value !== 'all' ? statusFilter.value : undefined,
        storageLocationId: storageFilter.value !== 'all' ? storageFilter.value : undefined,
        dateFrom: dateFrom.value || undefined,
        dateTo: dateTo.value || undefined,
        page: page.value,
        pageSize: pageSize.value,
      }),
      crops.value.length ? Promise.resolve(crops.value) : loadCrops(),
    ])
    rows.value = batchPage.rows
    totalFiltered.value = batchPage.total
    crops.value = cropRows
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : 'Не удалось загрузить реестр партий'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadStorageLocations().then((locations) => {
    storageOptions.value = locations.map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  })
  void loadData()
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('mousedown', onGlobalPointerDown)
  window.addEventListener('scroll', closeRowMenu, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('mousedown', onGlobalPointerDown)
  window.removeEventListener('scroll', closeRowMenu, true)
})
</script>

<template>
  <section class="fields-page">
    <div class="fields-page-inner">
      <header class="fields-header page-enter-item">
        <div class="fields-header-text">
          <p class="fields-subtitle">Партии по всем местам хранения с фильтрами по статусу и складу</p>
        </div>
        <div class="registry-actions">
          <div class="registry-export">
            <button
              type="button"
              class="fields-add-btn fields-add-btn--secondary registry-export-toggle"
              :class="{ 'is-open': exportMenuOpen }"
              :disabled="exportingAll"
              :aria-label="exportingAll ? 'Экспортируется' : 'Экспорт'"
              :title="exportingAll ? 'Экспортируется' : 'Экспорт'"
              aria-haspopup="menu"
              :aria-expanded="exportMenuOpen"
              @click="toggleExportMenu"
            >
              <svg class="registry-export-toggle-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </svg>
              <svg class="registry-export-chevron" :class="{ 'is-open': exportMenuOpen }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <transition name="export-menu-pop">
              <div v-if="exportMenuOpen" class="registry-export-menu" role="menu">
                <button type="button" class="registry-export-item task-btn-export action_has has_saved" role="menuitem" @click="exportRegistry('excel')">
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                  <span>Excel (.xls)</span>
                </button>
                <button type="button" class="registry-export-item task-btn-export action_has has_saved" role="menuitem" @click="exportRegistry('csv')">
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 13h2" /><path d="M8 17h2" /><path d="M14 13h2" /><path d="M14 17h2" /></svg>
                  <span>CSV (.csv)</span>
                </button>
                <button type="button" class="registry-export-item task-btn-export action_has has_saved" role="menuitem" @click="exportRegistry('pdf')">
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" /><line x1="10" x2="8" y1="9" y2="9" /></svg>
                  <span>PDF (.pdf)</span>
                </button>
              </div>
            </transition>
          </div>
          <button type="button" class="fields-add-btn fields-add-btn--secondary" @click="resetFilters">Сбросить фильтры</button>
          <button type="button" class="fields-add-btn" @click="goCreateBatch">
            <svg class="fields-add-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" x2="12" y1="5" y2="19" />
              <line x1="5" x2="19" y1="12" y2="12" />
            </svg>
            Создать партию
          </button>
        </div>
      </header>

      <section class="fields-card page-enter-item" style="--enter-delay: 80ms">
        <div v-if="!isSupabaseConfigured()" class="warehouse-alert" role="status">
          Supabase не настроен. Добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в `frontend/.env.local`.
        </div>
        <div v-else-if="error" class="warehouse-alert warehouse-alert--error" role="alert">{{ error }}</div>
        <div v-if="exportError" class="warehouse-alert warehouse-alert--error" role="alert">{{ exportError }}</div>
        <div v-if="loading" class="fields-loading" role="status" aria-live="polite"><UiLoadingBar /></div>

        <template v-else>
          <div class="fields-toolbar">
            <div class="fields-search-wrap">
              <svg class="fields-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input v-model.trim="search" class="fields-search-input" type="search" placeholder="Поиск по номеру партии..." />
            </div>
            <div class="warehouse-toolbar-filters">
              <label class="warehouse-filter-label">
                <span class="warehouse-filter-text">Культура</span>
                <select v-model="cropFilter" class="warehouse-filter-select">
                  <option value="all">Все культуры</option>
                  <option v-for="c in crops" :key="c.id" :value="c.key">{{ c.label }}</option>
                </select>
              </label>
              <label class="warehouse-filter-label">
                <span class="warehouse-filter-text">Статус</span>
                <select v-model="statusFilter" class="warehouse-filter-select">
                  <option value="all">Все статусы</option>
                  <option value="open">Открыта</option>
                  <option value="closed">Закрыта</option>
                </select>
              </label>
              <label class="warehouse-filter-label">
                <span class="warehouse-filter-text">Место хранения</span>
                <select v-model="storageFilter" class="warehouse-filter-select">
                  <option value="all">Все места хранения</option>
                  <option v-for="x in storageOptions" :key="x.id" :value="x.id">{{ x.name }}</option>
                </select>
              </label>
              <label class="warehouse-filter-label">
                <span class="warehouse-filter-text">Дата с</span>
                <input v-model="dateFrom" class="warehouse-filter-select" type="date" />
              </label>
              <label class="warehouse-filter-label">
                <span class="warehouse-filter-text">Дата по</span>
                <input v-model="dateTo" class="warehouse-filter-select" type="date" />
              </label>
            </div>
          </div>

          <div v-if="pagedRows.length" class="fields-table-wrap">
            <table class="fields-table">
              <thead>
                <tr>
                  <th>Номер партии</th>
                  <th>Культура</th>
                  <th>Масса (т)</th>
                  <th>Статус</th>
                  <th>Место хранения</th>
                  <th>Назначение</th>
                  <th>Дата форм.</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in pagedRows"
                  :key="row.id"
                  class="registry-row"
                  :class="{ 'registry-row--closed': isStorageBatchClosed(row) }"
                  @click="openBatch(row)"
                >
                  <td>
                    <button type="button" class="registry-link-btn" @click.stop="openBatch(row)">
                      {{ row.code }}
                    </button>
                  </td>
                  <td>{{ storageBatchCropLabel(row) }}</td>
                  <td>{{ formatMass(row.total_net_tons) }}</td>
                  <td>
                    <span class="status-pill" :class="`status-pill--${batchStatus(row)}`">{{ batchStatusLabel(batchStatus(row)) }}</span>
                  </td>
                  <td>{{ locationJoin(row)?.name || '—' }}</td>
                  <td>{{ row.purpose || '—' }}</td>
                  <td>{{ formatDateRu(row.created_at) }}</td>
                  <td>
                    <button
                      type="button"
                      class="registry-export-btn registry-row-export"
                      :class="{ 'is-open': openRowMenuId === row.id }"
                      :disabled="exportingBatchId === row.id"
                      :aria-label="exportingBatchId === row.id ? 'Экспортируется' : 'Экспорт'"
                      :title="exportingBatchId === row.id ? 'Экспортируется' : 'Экспорт'"
                      aria-haspopup="menu"
                      :aria-expanded="openRowMenuId === row.id"
                      @click.stop="toggleRowMenu(row.id, $event)"
                    >
                      <svg class="registry-export-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 3v12" />
                        <path d="m7 10 5 5 5-5" />
                        <path d="M5 21h14" />
                      </svg>
                      <svg class="registry-export-chevron" :class="{ 'is-open': openRowMenuId === row.id }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="warehouse-empty warehouse-empty--muted">
            <p class="warehouse-empty-title">Ничего не найдено</p>
          </div>
        </template>
      </section>

      <div v-if="isSupabaseConfigured() && !loading && !error && totalFiltered > 0" class="fields-pagination">
        <p class="fields-pagination-info">
          Показано <span class="fields-pagination-num">{{ pageStart }}</span>–<span class="fields-pagination-num">{{ pageEnd }}</span> из <span class="fields-pagination-num">{{ totalFiltered }}</span>
        </p>
        <div class="fields-pagination-right">
          <nav class="fields-pagination-nav" aria-label="Пагинация">
            <button type="button" class="fields-page-btn fields-page-btn--edge" :disabled="page <= 1" aria-label="Предыдущая страница" @click="setPage(page - 1)">
              <svg class="fields-page-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <template v-for="(p, i) in pageNumbers" :key="p === 'ellipsis' ? `wbr-e-${i}` : p">
              <button v-if="p !== 'ellipsis'" type="button" class="fields-page-btn" :class="{ 'fields-page-btn--active': p === page }" @click="setPage(p as number)">
                {{ p }}
              </button>
              <span v-else class="fields-page-ellipsis">…</span>
            </template>
            <button type="button" class="fields-page-btn fields-page-btn--edge" :disabled="page >= totalPages" aria-label="Следующая страница" @click="setPage(page + 1)">
              <svg class="fields-page-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </nav>
          <label class="fields-pagination-size">
            <span class="fields-pagination-size-label">На странице</span>
            <select v-model.number="pageSize" class="fields-pagination-select">
              <option :value="10">10</option>
              <option :value="25">25</option>
              <option :value="50">50</option>
            </select>
          </label>
        </div>
      </div>
    </div>

    <teleport to="body">
      <transition name="export-menu-pop">
        <div
          v-if="openRowMenu"
          class="registry-export-menu registry-row-export-menu"
          :style="{ top: `${rowMenuPos.top}px`, left: `${rowMenuPos.left}px` }"
          role="menu"
        >
          <button type="button" class="registry-export-item task-btn-export action_has has_saved" role="menuitem" @click="exportSingleBatch(openRowMenu, 'excel')">
            <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
            <span>Excel (.xls)</span>
          </button>
          <button type="button" class="registry-export-item task-btn-export action_has has_saved" role="menuitem" @click="exportSingleBatch(openRowMenu, 'csv')">
            <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 13h2" /><path d="M8 17h2" /><path d="M14 13h2" /><path d="M14 17h2" /></svg>
            <span>CSV (.csv)</span>
          </button>
          <button type="button" class="registry-export-item task-btn-export action_has has_saved" role="menuitem" @click="exportSingleBatch(openRowMenu, 'pdf')">
            <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" /><line x1="10" x2="8" y1="9" y2="9" /></svg>
            <span>PDF (.pdf)</span>
          </button>
        </div>
      </transition>
    </teleport>

    <teleport to="body">
    <div v-if="createModalOpen" class="modal-backdrop" @click.self="closeCreateModal">
      <div class="modal modal-fields storage-modal">
        <div class="modal-header">
          <h2 class="modal-title">Сформировать партию зерна</h2>
          <ModalCloseButton :disabled="creatingBatch" @click="closeCreateModal" />
        </div>
        <div class="modal-body">
          <div class="warehouse-cell-steps">
            <span :class="{ 'is-active': createStep === 1 }">1. Источник зерна</span>
            <span :class="{ 'is-active': createStep === 2 }">2. Параметры партии</span>
            <span :class="{ 'is-active': createStep === 3 }">3. Подтверждение</span>
          </div>

          <div v-if="createStep === 1">
            <div class="task-form-grid">
              <label class="task-form-field">
                <span class="task-form-label">Место хранения</span>
                <select v-model="createForm.storageLocationId" class="task-form-input">
                  <option value="" disabled>Выберите место хранения</option>
                  <option v-for="x in storageOptions" :key="x.id" :value="x.id">{{ x.name }}</option>
                </select>
              </label>
            </div>
            <div class="registry-create-intakes">
              <h3 class="registry-create-title">Источники партии</h3>
              <div class="fields-table-wrap">
                <table class="fields-table">
                  <thead>
                    <tr>
                      <th>В партии</th>
                      <th>Дата поступления</th>
                      <th>Источник</th>
                      <th>Культура</th>
                      <th>Доступная масса (т)</th>
                      <th>Масса для списания (т)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in createUnbatchedIntakes" :key="row.id" :class="{ 'is-row-muted': !(createRowState(row.id)?.included ?? false) }">
                      <td>
                        <input
                          type="checkbox"
                          :checked="createRowState(row.id)?.included ?? false"
                          @change="onToggleCreateIntake(row.id, $event)"
                        />
                      </td>
                      <td>{{ formatDateRu(row.received_at) }}</td>
                      <td>{{ storageIntakeFieldLabel(row) }}</td>
                      <td>{{ storageIntakeCropLabel(row) }}</td>
                      <td>{{ formatMass(row.net_mass_tons) }}</td>
                      <td>
                        <input
                          :value="createRowState(row.id)?.writeOffTons ?? '0'"
                          class="task-form-input registry-create-mass-input"
                          :disabled="!(createRowState(row.id)?.included ?? false)"
                          @input="onCreateMassInput(row.id, $event)"
                        />
                      </td>
                    </tr>
                    <tr v-if="!createUnbatchedIntakes.length">
                      <td colspan="6" class="warehouse-empty-title">Нет неоформленных поступлений для выбранного места хранения</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="warehouse-cell-total">Общая масса новой партии: {{ formatMass(createBatchTotalNet) }} т</p>
            </div>
          </div>

          <div v-else-if="createStep === 2">
            <div class="task-form-grid">
              <label class="task-form-field">
                <span class="task-form-label">Назначение партии</span>
                <select v-model="createForm.purpose" class="task-form-input">
                  <option value="export">Экспорт</option>
                  <option value="processing">Переработка</option>
                  <option value="storage">Хранение</option>
                </select>
              </label>
              <label class="task-form-field">
                <span class="task-form-label">Цель использования</span>
                <select v-model="createForm.useGoal" class="task-form-input">
                  <option value="food">Пищевые</option>
                  <option value="feed">Кормовые</option>
                </select>
              </label>
            </div>
            <div class="registry-create-quality">
              <div class="warehouse-cell-quality warehouse-cell-quality--batch-editor">
                <div class="warehouse-cell-quality-row warehouse-cell-quality-row--head">
                  <span>Наименование</span>
                  <strong>Значение</strong>
                  <span class="warehouse-cell-quality-col-actions" aria-hidden="true" />
                </div>
                <div v-for="(row, idx) in createForm.qualityRows" :key="`create-q-${idx}`" class="warehouse-cell-quality-row">
                  <input v-model.trim="row.name" class="task-form-input" type="text" />
                  <input v-model.trim="row.value" class="task-form-input" type="text" />
                  <div class="warehouse-cell-quality-row-actions">
                    <button v-if="row.removable" type="button" class="registry-quality-remove" @click="removeCreateQualityRow(idx)">Удалить</button>
                  </div>
                </div>
              </div>
              <button type="button" class="warehouse-cell-link-btn" @click="addCreateQualityRow">+ Добавить показатель</button>
            </div>
          </div>

          <div v-else class="warehouse-cell-summary">
            <strong>{{ formatMass(createBatchTotalNet) }} т</strong>
            <span>Источников: {{ createSelectedRows.length }} · Культура: {{ createBatchCropLabel }}</span>
            <span>Назначение: {{ createForm.purpose }}</span>
            <span>Цель использования: {{ createForm.useGoal }}</span>
          </div>
          <p v-if="createBatchError" class="registry-create-error">{{ createBatchError }}</p>
        </div>
        <div class="modal-actions">
          <button v-if="createStep > 1" type="button" class="task-form-cancel" :disabled="creatingBatch" @click="createStep = (createStep - 1) as 1 | 2 | 3">Назад</button>
          <button v-if="createStep < 3" type="button" class="task-form-submit" :disabled="creatingBatch || (createStep === 1 && !canProceedCreateStep2)" @click="createStep = (createStep + 1) as 1 | 2 | 3">Далее</button>
          <button v-else type="button" class="task-form-submit" :disabled="creatingBatch || !canCreateBatch" @click="submitCreateBatch">{{ creatingBatch ? 'Формирование…' : 'Сформировать партию' }}</button>
        </div>
      </div>
    </div>
    </teleport>
  </section>
</template>

<style scoped>
.fields-page { width: 100%; padding: 0; }
.fields-page-inner { width: 100%; }
.fields-header {
  position: relative;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}
.fields-header-text { flex: 1; min-width: 0; }
.fields-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.3;
  color: var(--text-primary);
}
.fields-subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.875rem; line-height: 1.4; }
.registry-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.fields-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 8px;
  background: var(--accent-green);
  color: #fff;
  padding: 10px 16px;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: transform 0.22s ease, box-shadow 0.22s ease, background 0.22s ease;
}
.fields-add-btn:hover {
  background: var(--accent-green-hover);
  transform: translateY(-1px) scale(1.01);
  box-shadow: 0 6px 14px rgba(61, 92, 64, 0.3);
}
.fields-add-btn-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  transform-origin: center;
  transition: transform 0.28s ease;
}
.fields-add-btn:hover .fields-add-btn-icon { transform: rotate(52deg) scale(1.18); }
.fields-add-btn:focus-visible,
.fields-add-btn--secondary:focus-visible,
.fields-page-btn:focus-visible,
.fields-pagination-select:focus-visible,
.fields-search-input:focus-visible,
.warehouse-filter-select:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-green) 52%, transparent);
  outline-offset: 1px;
}
.fields-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.fields-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.fields-search-wrap { position: relative; flex: 1; min-width: 240px; max-width: 28rem; }
.fields-search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  color: var(--text-secondary);
  pointer-events: none;
}
.fields-search-input {
  width: 100%;
  height: 38px;
  border: 1px solid var(--toolbar-form-surface-border);
  border-radius: 8px;
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  padding: 0 12px 0 40px;
  font-size: 0.875rem;
}
.fields-search-input::placeholder { color: var(--text-secondary); }
.fields-search-input:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px var(--accent-green);
}
.warehouse-toolbar-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; flex: 0 0 auto; }
.warehouse-filter-label { display: flex; flex-direction: column; gap: 4px; min-width: 160px; }
.warehouse-filter-text {
  font-size: 0.64rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}
.warehouse-filter-select {
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  font-size: 0.875rem;
  min-width: 160px;
}
.warehouse-filter-select:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px var(--accent-green);
}
.fields-add-btn--secondary { background: var(--bg-panel); color: var(--text-primary); border: 1px solid var(--border-color); box-shadow: none; }
.fields-add-btn--secondary:hover {
  background: var(--bg-panel-hover);
  border-color: color-mix(in srgb, var(--accent-green) 38%, var(--border-color));
  color: var(--accent-green);
  transform: translateY(-1px);
  box-shadow: none;
}
.fields-add-btn--secondary:hover .fields-add-btn-icon { transform: none; }
.warehouse-alert {
  margin: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-size: 0.88rem;
}
.warehouse-alert--error {
  background: rgba(185, 28, 28, 0.1);
  border-color: rgba(185, 28, 28, 0.22);
  color: var(--danger-red);
}
.fields-loading { display: flex; align-items: center; justify-content: center; padding: var(--space-lg) 24px; }
.fields-table-wrap {
  overflow-x: auto;
}
.fields-table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.fields-table thead { background: rgba(0, 0, 0, 0.02); }
.fields-table th,
.fields-table td {
  padding: 14px 24px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
  vertical-align: middle;
}
.fields-table tbody tr:last-child td { border-bottom: none; }
.fields-table th {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  white-space: nowrap;
}
.registry-link-btn {
  border: 0;
  background: transparent;
  color: var(--accent-green);
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.registry-link-btn:hover { color: var(--accent-green-hover); }
.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: .76rem;
  font-weight: 700;
}
.status-pill--open { background: color-mix(in srgb, var(--accent-green) 18%, transparent); color: var(--accent-green); }
.status-pill--closed { background: color-mix(in srgb, var(--text-secondary) 18%, transparent); color: var(--text-secondary); }
.registry-row--closed {
  opacity: 0.72;
  color: var(--text-secondary);
}
.registry-row--closed:hover {
  opacity: 0.85;
  background-color: color-mix(in srgb, var(--text-secondary) 8%, var(--bg-panel));
  box-shadow: inset 3px 0 0 var(--text-secondary);
}
.registry-row {
  cursor: pointer;
  transition: background-color 0.22s ease, box-shadow 0.22s ease;
}
.registry-row:hover {
  background-color: color-mix(in srgb, var(--accent-green) 9%, var(--bg-panel));
  box-shadow: inset 3px 0 0 var(--accent-green);
}
.registry-row:hover .registry-link-btn { color: var(--accent-green-hover); }
[data-theme='dark'] .registry-row:hover {
  background-color: color-mix(in srgb, var(--accent-green) 16%, var(--bg-elevated));
  box-shadow: inset 3px 0 0 var(--accent-green);
}
.warehouse-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px 16px;
  text-align: center;
}
.warehouse-empty-title { margin: 0; font-size: 1.05rem; font-weight: 600; color: var(--text-primary); }
.fields-pagination {
  margin-top: var(--space-md);
  padding: var(--space-md) var(--space-lg) 0;
  border-top: 1px solid var(--border-color);
  min-height: 40px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-md);
}
.fields-pagination-info { margin: 0; color: var(--text-secondary); font-size: 0.875rem; }
.fields-pagination-num { color: var(--text-primary); font-weight: 500; }
.fields-pagination-right { display: flex; align-items: center; gap: var(--space-lg); flex-wrap: wrap; }
.fields-pagination-nav { display: flex; align-items: center; gap: 4px; }
.fields-page-btn {
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}
.fields-page-btn:hover:not(:disabled):not(.fields-page-btn--active) {
  background: var(--bg-panel-hover);
}
.fields-page-btn-icon { width: 14px; height: 14px; }
.fields-page-btn--edge {
  width: 36px;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
}
.fields-page-btn--active {
  border-color: rgba(76, 175, 80, 0.5);
  background: rgba(76, 175, 80, 0.15);
  color: var(--text-primary);
}
.fields-page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.fields-page-ellipsis { color: var(--text-secondary); padding: 0 10px; font-size: 0.875rem; }
.registry-export-btn {
  height: 32px;
  min-width: 64px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--accent-green) 35%, var(--border-color));
  background: color-mix(in srgb, var(--accent-green) 10%, var(--toolbar-form-surface));
  color: var(--accent-green);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 8px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}
.registry-export-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-green) 16%, var(--toolbar-form-surface));
  border-color: color-mix(in srgb, var(--accent-green) 50%, var(--border-color));
  transform: translateY(-1px);
}
.registry-export-btn:disabled { opacity: 0.65; cursor: not-allowed; }
.registry-export-btn-icon { width: 14px; height: 14px; }
.registry-export { position: relative; }
.registry-export-toggle { gap: 8px; }
.registry-export-toggle-icon { width: 18px; height: 18px; flex-shrink: 0; }
.registry-export-toggle:hover:not(:disabled) .registry-export-toggle-icon { transform: none; }
.registry-export-chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 0.24s ease;
}
.registry-export-chevron.is-open { transform: rotate(180deg); }
.registry-export-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 200px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-panel);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.16);
}
.registry-row-export-menu {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1300;
}
.registry-export-item {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}
.registry-export-item:hover {
  background: var(--bg-panel-hover);
  border-color: color-mix(in srgb, var(--accent-green) 30%, var(--border-color));
}
.task-header-icon { width: 18px; height: 18px; flex-shrink: 0; }
.task-btn-export.action_has {
  --color: 220 9% 46%;
  --color-has: 146 33% 30%;
}
[data-theme='dark'] .task-btn-export.action_has {
  --color: 215 14% 55%;
  --color-has: 97 55% 52%;
}
.task-btn-export.has_saved svg {
  overflow: visible;
  transform-origin: center;
  color: hsl(var(--color));
  transition: transform 0.22s ease, color 0.18s ease;
}
.task-btn-export.has_saved:hover svg { color: hsl(var(--color-has)); }
.task-btn-export.has_saved:hover svg { animation: equipment-export-file-hover 0.65s ease; }
@keyframes equipment-export-file-hover {
  0% { transform: translateY(0) scale(1) rotate(0deg); }
  35% { transform: translateY(-2px) scale(1.11) rotate(-8deg); }
  70% { transform: translateY(-1px) scale(1.06) rotate(6deg); }
  100% { transform: translateY(0) scale(1) rotate(0deg); }
}
.export-menu-pop-enter-active { transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.33, 1, 0.68, 1); }
.export-menu-pop-leave-active { transition: opacity 0.14s ease, transform 0.14s ease; }
.export-menu-pop-enter-from,
.export-menu-pop-leave-to { opacity: 0; transform: translateY(-6px) scale(0.98); }
.fields-pagination-size { display: inline-flex; align-items: center; gap: 8px; font-size: 0.875rem; color: var(--text-secondary); }
.fields-pagination-size-label { font-size: 0.875rem; color: var(--text-secondary); }
.fields-pagination-select {
  height: 36px;
  min-width: 72px;
  border-radius: 8px;
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  padding: 0 28px 0 10px;
}
[data-theme='dark'] .fields-search-input,
[data-theme='dark'] .warehouse-filter-select,
[data-theme='dark'] .fields-pagination-select {
  background: var(--toolbar-form-surface);
  border-color: var(--toolbar-form-surface-border);
}
.registry-create-intakes,
.registry-create-quality {
  margin-top: 12px;
}
.registry-create-title {
  margin: 0 0 8px;
  font-size: 0.95rem;
  color: var(--text-primary);
}
.registry-create-mass-input {
  max-width: 110px;
  min-height: 34px;
}
.registry-quality-remove {
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  border-radius: 8px;
  height: 30px;
  padding: 0 8px;
  cursor: pointer;
  color: var(--text-secondary);
}
.registry-create-error {
  margin: 10px 0 0;
  color: var(--danger-red);
  font-size: 0.85rem;
}
.warehouse-cell-summary {
  margin-top: 12px;
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  border-radius: 10px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}
.warehouse-cell-summary strong {
  font-size: 1.05rem;
  color: var(--text-primary);
}
.warehouse-cell-summary span {
  font-size: 0.84rem;
  color: var(--text-secondary);
}
.warehouse-cell-quality {
  border: 1px solid var(--toolbar-form-surface-border);
  border-radius: 10px;
  background: var(--toolbar-form-surface);
  overflow: hidden;
}
.warehouse-cell-quality-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(120px, 160px) auto;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
  align-items: center;
}
.warehouse-cell-quality-row:last-child { border-bottom: 0; }
.warehouse-cell-quality-row--head {
  background: color-mix(in srgb, var(--toolbar-form-surface) 85%, var(--border-color));
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}
.warehouse-cell-quality-row-actions { display: flex; justify-content: flex-end; }
.warehouse-cell-link-btn {
  margin-top: 8px;
  border: 0;
  background: transparent;
  color: var(--accent-green);
  cursor: pointer;
  padding: 0;
  font: inherit;
  font-size: 0.84rem;
}
.warehouse-cell-link-btn:hover { color: var(--accent-green-hover); }
.warehouse-cell-steps {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.warehouse-cell-steps span {
  font-size: 0.8rem;
  color: var(--text-secondary);
  padding: 5px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
}
.warehouse-cell-steps span.is-active {
  color: var(--accent-green);
  border-color: color-mix(in srgb, var(--accent-green) 45%, var(--border-color));
  background: color-mix(in srgb, var(--accent-green) 10%, transparent);
}
.warehouse-cell-total {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 0.86rem;
}
.is-row-muted { opacity: 0.6; }
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.46);
}
.modal {
  width: min(980px, 96vw);
  max-height: min(90vh, 900px);
  border-radius: 14px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
}
.modal-title {
  margin: 0;
  font-size: 1.05rem;
  color: var(--text-primary);
}
.modal-body {
  padding: 12px 14px;
  overflow: auto;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--border-color);
}
@media (max-width: 1240px) {
  .warehouse-toolbar-filters { width: 100%; }
  .warehouse-filter-label { min-width: 140px; flex: 1 1 170px; }
}
@media (max-width: 900px) {
  .fields-header { flex-direction: column; align-items: stretch; }
  .registry-actions { width: 100%; }
  .registry-actions .fields-add-btn { flex: 1 1 auto; }
  .fields-search-wrap { min-width: 100%; max-width: none; }
  .fields-pagination { flex-direction: column; align-items: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .registry-row,
  .fields-page-btn,
  .fields-add-btn,
  .fields-add-btn-icon,
  .registry-export-chevron,
  .export-menu-pop-enter-active,
  .export-menu-pop-leave-active {
    transition: none;
  }
  .task-btn-export.has_saved:hover svg { animation: none; }
}
</style>
