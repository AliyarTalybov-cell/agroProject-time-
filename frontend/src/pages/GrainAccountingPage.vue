<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { loadPdfTools } from '@/lib/pdfExport'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  isStorageBatchClosed,
  loadStorageBatchesRegistry,
  storageBatchCropLabel,
  storageBatchUiStatus,
  storageBatchUiStatusLabel,
  type StorageBatchRow,
} from '@/lib/storageBatchesSupabase'
import {
  loadStorageIntakesPage,
  storageIntakeCropLabel,
  storageIntakeFieldLabel,
  storageIntakeLocationName,
  type StorageIntakeWithLocationRow,
} from '@/lib/storageIntakesSupabase'
import {
  loadStorageWriteoffsPage,
  storageWriteoffTypeLabel,
  type StorageWriteoffWithLocationRow,
} from '@/lib/storageWriteoffsSupabase'
import { loadStorageLocations } from '@/lib/storageLocationsSupabase'

type GrainTab = 'batches' | 'intakes' | 'writeoffs'
const TABS: { id: GrainTab; label: string }[] = [
  { id: 'batches', label: 'Текущие партии' },
  { id: 'intakes', label: 'Поступления' },
  { id: 'writeoffs', label: 'Списания' },
]

const router = useRouter()
const activeTab = ref<GrainTab>('batches')

const loading = ref(false)
const error = ref<string | null>(null)
const exportError = ref<string | null>(null)
const exportMenuOpen = ref(false)
const exportingAll = ref(false)

const batches = ref<StorageBatchRow[]>([])
const intakes = ref<StorageIntakeWithLocationRow[]>([])
const writeoffs = ref<StorageWriteoffWithLocationRow[]>([])
const warehouses = ref<{ id: string; name: string }[]>([])

const batchSearch = ref('')
const intakeSearch = ref('')
const writeoffSearch = ref('')

const intakeWarehouseId = ref('')

function formatMass(value: number): string {
  return Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateRu(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTimeRu(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function batchStatus(row: StorageBatchRow): 'open' | 'closed' {
  return storageBatchUiStatus(row)
}

function batchStatusLabel(status: 'open' | 'closed'): string {
  return storageBatchUiStatusLabel(status)
}

function batchLocationName(row: StorageBatchRow): string {
  const x = row.storage_locations
  if (!x) return '—'
  const one = Array.isArray(x) ? x[0] ?? null : x
  return one?.name?.trim() || '—'
}

const page = ref(1)
const pageSize = ref(10)
const total = ref(0)

const activeRowCount = computed(() => {
  if (activeTab.value === 'intakes') return intakes.value.length
  if (activeTab.value === 'writeoffs') return writeoffs.value.length
  return batches.value.length
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const pageStart = computed(() => (total.value ? (page.value - 1) * pageSize.value + 1 : 0))
const pageEnd = computed(() => Math.min((page.value - 1) * pageSize.value + activeRowCount.value, total.value))

const pageNumbers = computed(() => {
  if (totalPages.value <= 7) return Array.from({ length: totalPages.value }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  if (page.value > 4) pages.push('ellipsis')
  for (let p = Math.max(2, page.value - 1); p <= Math.min(totalPages.value - 1, page.value + 1); p += 1) pages.push(p)
  if (page.value < totalPages.value - 3) pages.push('ellipsis')
  pages.push(totalPages.value)
  return pages
})

function setPage(next: number) {
  page.value = Math.min(totalPages.value, Math.max(1, next))
}

watch([activeTab, batchSearch, intakeSearch, writeoffSearch, pageSize], () => {
  if (page.value !== 1) {
    page.value = 1
  } else {
    void loadActiveTab()
  }
})

watch(page, () => {
  void loadActiveTab()
})

function openBatch(row: StorageBatchRow) {
  if (!row.storage_location_id) return
  void router.push({
    name: 'warehouse-cell',
    params: { id: row.storage_location_id },
    query: { tab: 'batch', batchId: row.id },
  })
}

function openWriteoffBatch(row: StorageWriteoffWithLocationRow) {
  if (!row.batch_id || !row.storage_location_id) return
  void router.push({
    name: 'warehouse-cell',
    params: { id: row.storage_location_id },
    query: { tab: 'batch', batchId: row.batch_id },
  })
}

function goCreateIntake() {
  if (!intakeWarehouseId.value) return
  void router.push({ name: 'warehouse-cell', params: { id: intakeWarehouseId.value }, query: { intake: '1' } })
}

type ExportPayload = { title: string; filenameBase: string; headers: string[]; rows: string[][] }

const BATCH_EXPORT_HEADERS = ['№', 'Номер партии', 'Культура', 'Масса (т)', 'Статус', 'Место хранения', 'Назначение', 'Дата форм.']
const INTAKE_EXPORT_HEADERS = ['№', 'Дата', 'Склад', 'Источник', 'Культура', 'Брутто (т)', 'Влажность (%)', 'Зачётный вес (т)', 'Партия']
const WRITEOFF_EXPORT_HEADERS = ['№', 'Дата', 'Склад', 'Партия', 'Культура', 'Тип', 'Масса (т)', 'Контрагент', 'Кто списал', 'Комментарий']

function batchExportCells(row: StorageBatchRow, i: number): string[] {
  return [
    String(i + 1),
    row.code,
    storageBatchCropLabel(row),
    formatMass(row.total_net_tons),
    batchStatusLabel(batchStatus(row)),
    batchLocationName(row),
    row.purpose || '—',
    formatDateRu(row.created_at),
  ]
}

function intakeExportCells(row: StorageIntakeWithLocationRow, i: number): string[] {
  return [
    String(i + 1),
    formatDateTimeRu(row.received_at),
    storageIntakeLocationName(row),
    storageIntakeFieldLabel(row),
    storageIntakeCropLabel(row),
    formatMass(row.gross_mass_tons),
    Number(row.moisture_percent || 0).toFixed(1),
    formatMass(row.net_mass_tons),
    row.batch_code || '—',
  ]
}

function writeoffExportCells(row: StorageWriteoffWithLocationRow, i: number): string[] {
  return [
    String(i + 1),
    formatDateRu(row.operation_date),
    row.storageName,
    row.batches?.code || '—',
    row.crops?.label || '—',
    storageWriteoffTypeLabel(row.writeoff_type),
    formatMass(row.mass_tons),
    row.counterparty || '—',
    row.actorName,
    row.comment || '—',
  ]
}

const EXPORT_ALL_PAGE_SIZE = 100000

async function buildExportPayload(): Promise<ExportPayload> {
  const date = new Date().toISOString().slice(0, 10)
  if (activeTab.value === 'intakes') {
    const res = await loadStorageIntakesPage({ search: intakeSearch.value, page: 1, pageSize: EXPORT_ALL_PAGE_SIZE })
    return {
      title: 'Поступления зерна',
      filenameBase: `поступления_${date}`,
      headers: INTAKE_EXPORT_HEADERS,
      rows: res.rows.map((row, i) => intakeExportCells(row, i)),
    }
  }
  if (activeTab.value === 'writeoffs') {
    const res = await loadStorageWriteoffsPage({ search: writeoffSearch.value, page: 1, pageSize: EXPORT_ALL_PAGE_SIZE })
    return {
      title: 'Списания зерна',
      filenameBase: `списания_${date}`,
      headers: WRITEOFF_EXPORT_HEADERS,
      rows: res.rows.map((row, i) => writeoffExportCells(row, i)),
    }
  }
  const res = await loadStorageBatchesRegistry({ search: batchSearch.value, page: 1, pageSize: EXPORT_ALL_PAGE_SIZE })
  return {
    title: 'Текущие партии',
    filenameBase: `текущие_партии_${date}`,
    headers: BATCH_EXPORT_HEADERS,
    rows: res.rows.map((row, i) => batchExportCells(row, i)),
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

function exportToCsv(payload: ExportPayload, filename: string) {
  const sep = ';'
  const line = (arr: string[]) => arr.map((v) => escapeDelimitedCell(v, sep)).join(sep)
  const csv = '\uFEFF' + [line(payload.headers), ...payload.rows.map((r) => line(r))].join('\r\n')
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
}

function exportToExcel(payload: ExportPayload, filename: string) {
  const headerCells = payload.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const bodyRows = payload.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`
  downloadBlob(new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }), filename)
}

async function exportToPdf(payload: ExportPayload, filename: string) {
  const headerCells = payload.headers.map((h) => `<th style="padding:6px;border:1px solid #cbd5e1;text-align:left;">${escapeHtml(h)}</th>`).join('')
  const bodyRows = payload.rows
    .map((r) => `<tr>${r.map((c) => `<td style="padding:6px;border:1px solid #cbd5e1;">${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')
  const html = `
    <div style="position:fixed;left:-9999px;top:0;width:1300px;font-family:Arial,sans-serif;font-size:12px;background:#fff;">
      <h2 style="margin:0 0 12px 0;font-size:16px;">${escapeHtml(payload.title)}</h2>
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
    const { html2canvas, jsPDF } = await loadPdfTools()
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

function toggleExportMenu() {
  exportMenuOpen.value = !exportMenuOpen.value
}

function closeExportMenu() {
  exportMenuOpen.value = false
}

async function exportActive(format: 'excel' | 'csv' | 'pdf') {
  closeExportMenu()
  if (exportingAll.value) return
  exportError.value = null
  exportingAll.value = true
  try {
    const payload = await buildExportPayload()
    if (!payload.rows.length) {
      exportError.value = 'Нет данных для экспорта в текущей вкладке'
      return
    }
    if (format === 'excel') exportToExcel(payload, `${payload.filenameBase}.xls`)
    else if (format === 'csv') exportToCsv(payload, `${payload.filenameBase}.csv`)
    else await exportToPdf(payload, `${payload.filenameBase}.pdf`)
  } catch (e) {
    exportError.value = e instanceof Error && e.message ? e.message : 'Не удалось выполнить экспорт'
  } finally {
    exportingAll.value = false
  }
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeExportMenu()
}

function onGlobalPointerDown(event: MouseEvent) {
  if (!exportMenuOpen.value) return
  const target = event.target as HTMLElement | null
  if (target && target.closest('.registry-export')) return
  closeExportMenu()
}

async function loadWarehouses() {
  if (!isSupabaseConfigured()) {
    warehouses.value = []
    return
  }
  try {
    const locations = await loadStorageLocations()
    warehouses.value = locations
      .map((x) => ({ id: x.id, name: x.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  } catch {
    warehouses.value = []
  }
}

async function loadActiveTab() {
  if (!isSupabaseConfigured()) {
    batches.value = []
    intakes.value = []
    writeoffs.value = []
    total.value = 0
    return
  }
  loading.value = true
  error.value = null
  try {
    if (activeTab.value === 'intakes') {
      const res = await loadStorageIntakesPage({ search: intakeSearch.value, page: page.value, pageSize: pageSize.value })
      intakes.value = res.rows
      total.value = res.total
    } else if (activeTab.value === 'writeoffs') {
      const res = await loadStorageWriteoffsPage({ search: writeoffSearch.value, page: page.value, pageSize: pageSize.value })
      writeoffs.value = res.rows
      total.value = res.total
    } else {
      const res = await loadStorageBatchesRegistry({ search: batchSearch.value, page: page.value, pageSize: pageSize.value })
      batches.value = res.rows
      total.value = res.total
    }
  } catch (e) {
    error.value = e instanceof Error && e.message ? e.message : 'Не удалось загрузить данные учёта зерна'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadWarehouses()
  void loadActiveTab()
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('mousedown', onGlobalPointerDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('mousedown', onGlobalPointerDown)
})
</script>

<template>
  <section class="fields-page">
    <div class="fields-page-inner">
      <header class="fields-header page-enter-item">
        <div class="fields-header-text">
          <p class="fields-subtitle">Партии, поступления и списания по всем складам в одном месте</p>
        </div>
      </header>

      <nav class="grain-tabs" aria-label="Разделы учёта зерна">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          class="grain-tab"
          :class="{ 'grain-tab--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>

      <section class="fields-card">
        <div v-if="!isSupabaseConfigured()" class="warehouse-alert" role="status">
          Supabase не настроен. Добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в `frontend/.env.local`.
        </div>
        <div v-else-if="error" class="warehouse-alert warehouse-alert--error" role="alert">{{ error }}</div>
        <div v-if="exportError" class="warehouse-alert warehouse-alert--error" role="alert">{{ exportError }}</div>
        <div v-if="loading" class="fields-loading" role="status" aria-live="polite"><UiLoadingBar /></div>

        <template v-else>
          <div class="grain-export-bar">
            <div class="registry-export">
              <button
                type="button"
                class="grain-export-toggle"
                :class="{ 'is-open': exportMenuOpen }"
                :disabled="exportingAll"
                aria-haspopup="menu"
                :aria-expanded="exportMenuOpen"
                :aria-label="exportingAll ? 'Экспортируется' : 'Экспорт'"
                :title="exportingAll ? 'Экспортируется' : 'Экспорт'"
                @click="toggleExportMenu"
              >
                <svg class="grain-export-toggle-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
                  <button type="button" class="registry-export-item task-btn-export action_has has_saved" role="menuitem" @click="exportActive('excel')">
                    <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                    <span>Excel (.xls)</span>
                  </button>
                  <button type="button" class="registry-export-item task-btn-export action_has has_saved" role="menuitem" @click="exportActive('csv')">
                    <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 13h2" /><path d="M8 17h2" /><path d="M14 13h2" /><path d="M14 17h2" /></svg>
                    <span>CSV (.csv)</span>
                  </button>
                  <button type="button" class="registry-export-item task-btn-export action_has has_saved" role="menuitem" @click="exportActive('pdf')">
                    <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" /><line x1="10" x2="8" y1="9" y2="9" /></svg>
                    <span>PDF (.pdf)</span>
                  </button>
                </div>
              </transition>
            </div>
          </div>

          <!-- Текущие партии -->
          <div v-if="activeTab === 'batches'">
            <div class="fields-toolbar">
              <div class="fields-search-wrap">
                <svg class="fields-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input v-model.trim="batchSearch" class="fields-search-input" type="search" placeholder="Поиск по номеру, культуре, складу..." />
              </div>
            </div>
            <div v-if="batches.length" class="fields-table-wrap">
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
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in batches"
                    :key="row.id"
                    class="registry-row"
                    :class="{ 'registry-row--closed': isStorageBatchClosed(row) }"
                    @click="openBatch(row)"
                  >
                    <td><strong>{{ row.code }}</strong></td>
                    <td>{{ storageBatchCropLabel(row) }}</td>
                    <td>{{ formatMass(row.total_net_tons) }}</td>
                    <td><span class="status-pill" :class="`status-pill--${batchStatus(row)}`">{{ batchStatusLabel(batchStatus(row)) }}</span></td>
                    <td>{{ batchLocationName(row) }}</td>
                    <td>{{ row.purpose || '—' }}</td>
                    <td>{{ formatDateRu(row.created_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="warehouse-empty">
              <p class="warehouse-empty-title">Партий пока нет</p>
            </div>
          </div>

          <!-- Поступления -->
          <div v-else-if="activeTab === 'intakes'">
            <div class="fields-toolbar">
              <div class="fields-search-wrap">
                <svg class="fields-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input v-model.trim="intakeSearch" class="fields-search-input" type="search" placeholder="Поиск по складу, полю, культуре, партии..." />
              </div>
              <div class="grain-create-wrap">
                <select v-model="intakeWarehouseId" class="warehouse-filter-select" aria-label="Склад для нового поступления">
                  <option value="">Выберите склад…</option>
                  <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
                </select>
                <button type="button" class="fields-add-btn" :disabled="!intakeWarehouseId" @click="goCreateIntake">
                  <svg class="fields-add-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                  Добавить поступление
                </button>
              </div>
            </div>
            <div v-if="intakes.length" class="fields-table-wrap">
              <table class="fields-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Склад</th>
                    <th>Источник</th>
                    <th>Культура</th>
                    <th>Брутто (т)</th>
                    <th>Влажность (%)</th>
                    <th>Зачётный вес (т)</th>
                    <th>Партия</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in intakes" :key="row.id">
                    <td>{{ formatDateTimeRu(row.received_at) }}</td>
                    <td>{{ storageIntakeLocationName(row) }}</td>
                    <td>{{ storageIntakeFieldLabel(row) }}</td>
                    <td>{{ storageIntakeCropLabel(row) }}</td>
                    <td>{{ formatMass(row.gross_mass_tons) }}</td>
                    <td>{{ Number(row.moisture_percent || 0).toFixed(1) }}</td>
                    <td>{{ formatMass(row.net_mass_tons) }}</td>
                    <td>{{ row.batch_code || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="warehouse-empty">
              <p class="warehouse-empty-title">Поступлений пока нет</p>
            </div>
          </div>

          <!-- Списания (журнал, только просмотр) -->
          <div v-else>
            <p class="grain-writeoffs-hint">Журнал списаний. Создавать списание можно только из карточки открытой партии.</p>
            <div class="fields-toolbar">
              <div class="fields-search-wrap">
                <svg class="fields-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input v-model.trim="writeoffSearch" class="fields-search-input" type="search" placeholder="Поиск по складу, партии, типу, контрагенту..." />
              </div>
            </div>
            <div v-if="writeoffs.length" class="fields-table-wrap">
              <table class="fields-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Склад</th>
                    <th>Партия</th>
                    <th>Культура</th>
                    <th>Тип</th>
                    <th>Масса (т)</th>
                    <th>Контрагент</th>
                    <th>Кто списал</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in writeoffs"
                    :key="row.id"
                    class="registry-row"
                    :class="{ 'registry-row--inactive': !row.batch_id }"
                    :tabindex="row.batch_id ? 0 : undefined"
                    @click="openWriteoffBatch(row)"
                    @keydown.enter.prevent="openWriteoffBatch(row)"
                  >
                    <td>{{ formatDateRu(row.operation_date) }}</td>
                    <td>{{ row.storageName }}</td>
                    <td>{{ row.batches?.code || '—' }}</td>
                    <td>{{ row.crops?.label || '—' }}</td>
                    <td><span class="writeoff-type-pill">{{ storageWriteoffTypeLabel(row.writeoff_type) }}</span></td>
                    <td>{{ formatMass(row.mass_tons) }}</td>
                    <td>{{ row.counterparty || '—' }}</td>
                    <td>{{ row.actorName }}</td>
                    <td>{{ row.comment || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="warehouse-empty">
              <p class="warehouse-empty-title">Списаний пока нет</p>
            </div>
          </div>
        </template>
      </section>

      <div v-if="isSupabaseConfigured() && !loading && !error && total > 0" class="fields-pagination">
        <p class="fields-pagination-info">
          Показано <span class="fields-pagination-num">{{ pageStart }}</span>–<span class="fields-pagination-num">{{ pageEnd }}</span> из <span class="fields-pagination-num">{{ total }}</span>
        </p>
        <div class="fields-pagination-right">
          <nav class="fields-pagination-nav" aria-label="Пагинация">
            <button type="button" class="fields-page-btn fields-page-btn--edge" :disabled="page <= 1" aria-label="Предыдущая страница" @click="setPage(page - 1)">
              <svg class="fields-page-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <template v-for="(p, i) in pageNumbers" :key="p === 'ellipsis' ? `grain-e-${i}` : p">
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

  </section>
</template>

<style scoped>
.fields-page { width: 100%; }
.fields-page-inner { display: flex; flex-direction: column; gap: var(--space-lg); }
.fields-header { position: relative; z-index: 2; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-md); }
.fields-header-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.fields-subtitle { margin: 0; color: var(--text-secondary); font-size: 0.9rem; }
.registry-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.registry-export { position: relative; }
.grain-export-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 38px;
  min-width: 64px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-panel);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
}
.grain-export-bar {
  display: flex;
  justify-content: flex-end;
  margin: -2px 0 10px;
}
.grain-export-toggle:hover:not(:disabled) {
  background: var(--bg-panel-hover);
  border-color: color-mix(in srgb, var(--accent-green) 38%, var(--border-color));
  color: var(--accent-green);
  transform: translateY(-1px);
}
.grain-export-toggle:disabled { opacity: 0.6; cursor: not-allowed; }
.grain-export-toggle-icon { width: 18px; height: 18px; flex-shrink: 0; }
.registry-export-chevron { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.7; transition: transform 0.24s ease; }
.registry-export-chevron.is-open { transform: rotate(180deg); }
.registry-export-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
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
.task-btn-export.action_has { --color: 220 9% 46%; --color-has: 146 33% 30%; }
[data-theme='dark'] .task-btn-export.action_has { --color: 215 14% 55%; --color-has: 97 55% 52%; }
.task-btn-export.has_saved svg {
  overflow: visible;
  transform-origin: center;
  color: hsl(var(--color));
  transition: transform 0.22s ease, color 0.18s ease;
}
.task-btn-export.has_saved:hover svg { color: hsl(var(--color-has)); animation: equipment-export-file-hover 0.65s ease; }
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

.grain-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  border-bottom: 1px solid var(--border-color);
}
.grain-tab {
  padding: 10px 16px;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: color 0.26s ease, border-color 0.26s ease, background 0.26s ease, transform 0.26s ease;
}
.grain-tab:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-green) 2.5%, transparent);
  transform: translateY(-1px);
}
.grain-tab--active {
  color: var(--accent-green);
  border-bottom-color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 4%, transparent);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--accent-green) 8%, transparent);
}

.fields-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  padding: 12px;
}
.fields-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md);
  margin: -12px -12px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.fields-search-wrap { position: relative; flex: 1; min-width: 240px; max-width: 28rem; }
.fields-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
  pointer-events: none;
}
.fields-search-input {
  width: 100%;
  height: 38px;
  border: 1px solid var(--toolbar-form-surface-border);
  border-radius: 10px;
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  padding: 0 12px 0 34px;
  font-size: 0.93rem;
}
.fields-search-input::placeholder { color: var(--text-secondary); }
.fields-search-input:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px var(--accent-green);
}
.grain-create-wrap { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.warehouse-filter-select {
  height: 38px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--toolbar-form-surface-border);
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  font-size: 0.875rem;
  min-width: 200px;
}
.warehouse-filter-select:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px var(--accent-green);
}
.fields-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 38px;
  border: 1px solid var(--accent-green);
  border-radius: 10px;
  background: var(--accent-green);
  color: #fff;
  padding: 0 14px;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.fields-add-btn:hover:not(:disabled) {
  background: var(--accent-green-hover);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(61, 92, 64, 0.3);
}
.fields-add-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.fields-add-btn-icon { width: 16px; height: 16px; transform-origin: center; transition: transform 0.28s ease; }
.fields-add-btn:hover:not(:disabled) .fields-add-btn-icon { transform: rotate(52deg) scale(1.14); }

.warehouse-alert {
  margin-bottom: 12px;
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
  border: 1px solid var(--border-color);
  border-radius: 12px;
}
.fields-table {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.fields-table thead { background: rgba(0, 0, 0, 0.02); }
.fields-table th,
.fields-table td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}
.fields-table th {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  white-space: nowrap;
}
.registry-row { cursor: pointer; transition: background-color 0.2s ease, box-shadow 0.2s ease; }
.registry-row:hover {
  background-color: var(--row-hover-bg);
  box-shadow: inset 3px 0 0 var(--accent-green);
}
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
.registry-row--inactive {
  cursor: default;
}
.registry-row--inactive:hover {
  background-color: transparent;
  box-shadow: none;
  opacity: 1;
}
.grain-writeoffs-hint {
  margin: 0 0 8px;
  font-size: 0.86rem;
  color: var(--text-secondary);
}
.writeoff-type-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: .76rem;
  font-weight: 700;
  background: color-mix(in srgb, var(--accent-green) 12%, transparent);
  color: var(--accent-green);
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
.fields-page-btn:hover:not(:disabled):not(.fields-page-btn--active) { background: var(--bg-panel-hover); }
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
[data-theme='dark'] .fields-pagination-select {
  background: var(--toolbar-form-surface);
  border-color: var(--toolbar-form-surface-border);
}

[data-theme='dark'] .fields-search-input,
[data-theme='dark'] .warehouse-filter-select {
  background: var(--toolbar-form-surface);
  border-color: var(--toolbar-form-surface-border);
}
@media (max-width: 900px) {
  .fields-toolbar { flex-direction: column; align-items: stretch; }
  .fields-search-wrap { min-width: 100%; max-width: none; }
  .grain-create-wrap { width: 100%; }
  .grain-create-wrap .warehouse-filter-select { flex: 1 1 auto; min-width: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .grain-tab,
  .registry-row,
  .fields-add-btn,
  .fields-add-btn-icon,
  .grain-export-toggle,
  .registry-export-chevron,
  .fields-page-btn,
  .export-menu-pop-enter-active,
  .export-menu-pop-leave-active {
    transition: none;
  }
  .task-btn-export.has_saved:hover svg { animation: none; }
}
</style>
