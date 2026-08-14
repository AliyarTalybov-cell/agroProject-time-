<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from 'vue'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/stores/auth'
import {
  isSupabaseConfigured,
  loadDowntimeReasons,
  addDowntimeReason,
  deleteDowntimeReason,
  loadWorkOperations,
  addWorkOperation,
  deleteWorkOperation,
  type DowntimeReasonRow,
  type WorkOperationRow,
  type DowntimeCategory,
} from '@/lib/reasonsAndOperations'
import {
  loadLandTypes,
  loadCrops,
  type LandTypeRow,
  type CropRow,
} from '@/lib/landTypesAndCrops'
import { loadLands as loadLandsApi, type LandRow } from '@/lib/landsSupabase'
import {
  loadFieldsPage,
  loadMaxFieldNumber,
  addField as addFieldApi,
  updateField as updateFieldApi,
  deleteField as deleteFieldApi,
  loadFieldMunicipalitiesRefs,
  uploadFieldScheme,
  type FieldRow,
  type FieldMunicipalityRefRow,
  type FieldsServerSortKey,
} from '@/lib/fieldsSupabase'
import { loadProfiles, type ProfileRow } from '@/lib/tasksSupabase'
import { PHOTO_MAX_BYTES, PHOTO_MAX_LABEL } from '@/lib/uploadLimits'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UiSuccessModal from '@/components/UiSuccessModal.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
import YandexMap from '@/components/YandexMap.vue'
import { resolveYandexAddressLine, resolveYandexAddressCandidates } from '@/lib/yandexGeocode'

type CropKey = 'all' | 'wheat' | 'corn' | 'soy' | 'sunflower' | 'none' | 'meadow'

const CATEGORY_LABELS: Record<DowntimeCategory, string> = {
  breakdown: 'Поломка',
  rain: 'Дождь / погода',
  fuel: 'Нет топлива',
  waiting: 'Ожидание задания',
}

const LAND_TYPES_FALLBACK = ['Пашня', 'Залежь', 'Сенокос', 'Пастбище']

const CROP_KEY_TO_NAME: Record<string, string> = {
  wheat: 'Пшеница',
  corn: 'Кукуруза',
  soy: 'Соя',
  sunflower: 'Подсолнечник',
  none: 'Нет культуры',
  meadow: 'Многолетние травы',
}

type Field = {
  id: string
  number: number
  name: string
  area: number
  cadastralNumber: string
  efisZsnNumber?: string
  address: string
  locationDescription: string
  extraInfo: string
  geolocation: string
  municipality?: string
  region?: string
  geometryMode: 'point' | 'polygon'
  contourGeojson: Record<string, unknown> | null
  landId?: string | null
  landType: string
  sowingYear: number
  responsibleId: string | null
  responsiblePerson: string
  cropKey: string
  cropName: string
  schemeFileUrl: string
  stage: string
  readinessPercent: number
  forecastYield: string
  harvestDate: string
  imageUrl: string
  soilType: string
  moisture: string
  lastOperation: string
}

type LatLon = [number, number]

type PolygonGeoJson = {
  type: 'Polygon'
  coordinates: number[][][]
}

const router = useRouter()
const route = useRoute()

const fields = ref<Field[]>([])
const fieldsLoading = ref(false)
const fieldsError = ref<string | null>(null)
const profiles = ref<ProfileRow[]>([])
const highlightAddField = ref(false)
const successModalOpen = ref(false)
const successModalTitle = ref('Операция выполнена')
const successModalMessage = ref('')

function fieldRowToField(row: FieldRow, profileMap: Map<string, ProfileRow>, cropsList: CropRow[]): Field {
  const responsiblePerson = row.responsible_id ? (profileMap.get(row.responsible_id)?.display_name || profileMap.get(row.responsible_id)?.email || '') : ''
  const cropName = cropsList.find((c) => c.key === row.crop_key)?.label ?? CROP_KEY_TO_NAME[row.crop_key] ?? row.crop_key
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    area: Number(row.area),
    cadastralNumber: row.cadastral_number ?? '',
    efisZsnNumber: (row as { efis_zsn_number?: string | null }).efis_zsn_number ?? '',
    address: (row as { address?: string | null }).address ?? '',
    extraInfo: (row as { extra_info?: string | null }).extra_info ?? '',
    geolocation: (row as { geolocation?: string | null }).geolocation ?? '',
    municipality: (row as { municipality?: string | null }).municipality ?? '',
    region: (row as { region?: string | null }).region ?? '',
    locationDescription: row.location_description ?? '',
    landId: row.land_id ?? null,
    landType: row.land_type,
    geometryMode: row.geometry_mode ?? 'point',
    contourGeojson: row.contour_geojson ?? null,
    sowingYear: row.sowing_year ?? 0,
    responsibleId: row.responsible_id ?? null,
    responsiblePerson,
    cropKey: row.crop_key,
    cropName,
    schemeFileUrl: row.scheme_file_url ?? '',
    stage: '—',
    readinessPercent: 0,
    forecastYield: '—',
    harvestDate: '—',
    imageUrl: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=400&q=80',
    soilType: '—',
    moisture: '—',
    lastOperation: '—',
  }
}

function fieldsDbSortKey(): FieldsServerSortKey {
  switch (fieldsSortKey.value) {
    case 'cadastralNumber':
      return 'cadastral_number'
    case 'area':
      return 'area'
    case 'crop':
      return 'crop_key'
    case 'land':
      return 'land_type'
    case 'location':
      return 'location_description'
    case 'responsible':
      return 'responsible_id'
    default:
      return 'name'
  }
}

async function loadFieldsData() {
  if (!isSupabaseConfigured()) return
  fieldsError.value = null
  fieldsLoading.value = true
  try {
    const [pageRes, profileList, maxNumber] = await Promise.all([
      loadFieldsPage({
        search: searchText.value,
        cropKey: cropFilter.value,
        sortKey: fieldsDbSortKey(),
        sortDir: fieldsSortDir.value,
        page: currentPage.value,
        pageSize: pageSize.value,
      }),
      loadProfiles(),
      loadMaxFieldNumber(),
    ])
    profiles.value = profileList
    const profileMap = new Map(profileList.map((p) => [p.id, p]))
    fields.value = pageRes.rows.map((r) => fieldRowToField(r, profileMap, crops.value))
    fieldsTotal.value = pageRes.total
    maxFieldNumber.value = maxNumber
  } catch (e) {
    fieldsError.value = e instanceof Error ? e.message : 'Не удалось загрузить поля'
    fields.value = []
    fieldsTotal.value = 0
  } finally {
    fieldsLoading.value = false
  }
}

const DEMO_FIELDS: Field[] = [
  {
    id: 'field-12',
    number: 12,
    name: 'Пшеница',
    area: 42.5,
    cadastralNumber: '50:20:0010321:14',
    address: '',
    locationDescription: 'Северный участок, от дороги до лесополосы',
    extraInfo: '',
    geolocation: '',
    geometryMode: 'point',
    contourGeojson: null,
    landType: 'Пашня',
    sowingYear: 2024,
    responsibleId: null,
    responsiblePerson: 'Иванов А.С.',
    cropKey: 'wheat',
    cropName: 'Пшеница',
    schemeFileUrl: '',
    stage: '—',
    readinessPercent: 0,
    forecastYield: '—',
    harvestDate: '—',
    imageUrl: '',
    soilType: '—',
    moisture: '—',
    lastOperation: '—',
  },
  {
    id: 'field-2',
    number: 2,
    name: 'Участок \"Северный\"',
    area: 120,
    cadastralNumber: '',
    address: '',
    locationDescription: 'Западная граница хозяйства',
    extraInfo: '',
    geolocation: '',
    geometryMode: 'point',
    contourGeojson: null,
    landType: 'Пашня',
    sowingYear: 2024,
    responsibleId: null,
    responsiblePerson: 'Петрова М.В.',
    cropKey: 'sunflower',
    cropName: 'Подсолнечник',
    schemeFileUrl: '',
    stage: '—',
    readinessPercent: 0,
    forecastYield: '—',
    harvestDate: '—',
    imageUrl: '',
    soilType: '—',
    moisture: '—',
    lastOperation: '—',
  },
  {
    id: 'field-3',
    number: 3,
    name: 'Заречное 1',
    area: 35.8,
    cadastralNumber: '50:20:0010321:88',
    address: '',
    locationDescription: 'За рекой, южный склон',
    extraInfo: '',
    geolocation: '',
    geometryMode: 'point',
    contourGeojson: null,
    landType: 'Пашня',
    sowingYear: 2024,
    responsibleId: null,
    responsiblePerson: 'Сидоров В.И.',
    cropKey: 'soy',
    cropName: 'Соя',
    schemeFileUrl: '',
    stage: '—',
    readinessPercent: 0,
    forecastYield: '—',
    harvestDate: '—',
    imageUrl: '',
    soilType: '—',
    moisture: '—',
    lastOperation: '—',
  },
  {
    id: 'field-4',
    number: 4,
    name: 'Поле 4 (Пары)',
    area: 80,
    cadastralNumber: '50:20:0010321:05',
    address: '',
    locationDescription: 'Центральный массив',
    extraInfo: '',
    geolocation: '',
    geometryMode: 'point',
    contourGeojson: null,
    landType: 'Залежь',
    sowingYear: 0,
    responsibleId: null,
    responsiblePerson: '',
    cropKey: 'none',
    cropName: 'Нет культуры',
    schemeFileUrl: '',
    stage: '—',
    readinessPercent: 0,
    forecastYield: '—',
    harvestDate: '—',
    imageUrl: '',
    soilType: '—',
    moisture: '—',
    lastOperation: '—',
  },
  {
    id: 'field-5',
    number: 5,
    name: 'Луг 1',
    area: 15,
    cadastralNumber: '50:20:0010321:99',
    address: '',
    locationDescription: 'Пойменный луг',
    extraInfo: '',
    geolocation: '',
    geometryMode: 'point',
    contourGeojson: null,
    landType: 'Сенокос',
    sowingYear: 0,
    responsibleId: null,
    responsiblePerson: '',
    cropKey: 'meadow',
    cropName: 'Многолетние травы',
    schemeFileUrl: '',
    stage: '—',
    readinessPercent: 0,
    forecastYield: '—',
    harvestDate: '—',
    imageUrl: '',
    soilType: '—',
    moisture: '—',
    lastOperation: '—',
  },
]

const cropFilter = ref<CropKey>('all')
const searchText = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
const selectedFieldId = ref<string | null>(null)
const multiSelectedIds = ref<string[]>([])
const pageSize = ref(10)
const currentPage = ref(1)
const fieldsTotal = ref(0)
const maxFieldNumber = ref(0)

const selectedField = computed(() => fields.value.find((f) => f.id === selectedFieldId.value) ?? null)

const filteredFields = computed(() => {
  if (isSupabaseConfigured()) return fields.value
  const q = searchText.value.trim().toLowerCase()
  return fields.value.filter((f) => {
    const matchesCrop = cropFilter.value === 'all' ? true : f.cropKey === cropFilter.value
    if (!matchesCrop) return false
    return q ? (f.name || '').toLowerCase().includes(q) : true
  })
})

watch(searchText, () => {
  currentPage.value = 1
  if (!isSupabaseConfigured()) return
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    void loadFieldsData()
  }, 300)
})

watch(cropFilter, () => {
  currentPage.value = 1
  if (isSupabaseConfigured()) void loadFieldsData()
})

type FieldsSortKey = 'name' | 'cadastralNumber' | 'area' | 'crop' | 'land' | 'location' | 'responsible'

const fieldsSortKey = ref<FieldsSortKey>('name')
const fieldsSortDir = ref<'asc' | 'desc'>('asc')

function toggleFieldsSort(key: FieldsSortKey) {
  if (fieldsSortKey.value === key) {
    fieldsSortDir.value = fieldsSortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    fieldsSortKey.value = key
    fieldsSortDir.value = 'asc'
  }
  toggleFieldsSortReload()
}

function fieldsAriaSort(key: FieldsSortKey): 'ascending' | 'descending' | 'none' {
  if (fieldsSortKey.value !== key) return 'none'
  return fieldsSortDir.value === 'asc' ? 'ascending' : 'descending'
}

function fieldsSortMark(key: FieldsSortKey): string {
  if (fieldsSortKey.value !== key) return ''
  return fieldsSortDir.value === 'asc' ? '↑' : '↓'
}

function toggleFieldsSortReload() {
  currentPage.value = 1
  if (isSupabaseConfigured()) void loadFieldsData()
}

const sortedFilteredFields = computed(() => {
  if (isSupabaseConfigured()) return filteredFields.value
  const list = [...filteredFields.value]
  const dir = fieldsSortDir.value === 'asc' ? 1 : -1
  const key = fieldsSortKey.value
  list.sort((a, b) => {
    let c = 0
    switch (key) {
      case 'name':
        c = (a.name || '').localeCompare(b.name || '', 'ru', { sensitivity: 'base' })
        break
      case 'cadastralNumber':
        c = (a.cadastralNumber || '').localeCompare(b.cadastralNumber || '', 'ru', { sensitivity: 'base' })
        break
      case 'area':
        c = a.area - b.area
        break
      case 'crop':
        c = a.cropName.localeCompare(b.cropName, 'ru', { sensitivity: 'base' })
        break
      case 'land':
        c = a.landType.localeCompare(b.landType, 'ru', { sensitivity: 'base' })
        break
      case 'location':
        c = (a.locationDescription || '').localeCompare(b.locationDescription || '', 'ru', {
          sensitivity: 'base',
        })
        break
      case 'responsible':
        c = (a.responsiblePerson || '').localeCompare(b.responsiblePerson || '', 'ru', {
          sensitivity: 'base',
        })
        break
      default:
        c = 0
    }
    if (c !== 0) return c * dir
    return a.number - b.number
  })
  return list
})

const selectedFields = computed(() =>
  fields.value.filter((f) => multiSelectedIds.value.includes(f.id)),
)

const nextFieldNumber = computed(() => {
  if (isSupabaseConfigured()) return maxFieldNumber.value + 1
  const max = fields.value.reduce((m, f) => (f.number > m ? f.number : m), 0)
  return max + 1
})

const totalFiltered = computed(() => (isSupabaseConfigured() ? fieldsTotal.value : filteredFields.value.length))
const totalPages = computed(() => Math.max(1, Math.ceil(totalFiltered.value / pageSize.value)))
const paginatedFields = computed(() => {
  if (isSupabaseConfigured()) return sortedFilteredFields.value
  const start = (currentPage.value - 1) * pageSize.value
  return sortedFilteredFields.value.slice(start, start + pageSize.value)
})

const totalSelectedArea = computed(() =>
  selectedFields.value.reduce((sum, f) => sum + f.area, 0),
)

const avgSelectedReadiness = computed(() => {
  if (!selectedFields.value.length) return 0
  const total = selectedFields.value.reduce((sum, f) => sum + f.readinessPercent, 0)
  return Math.round(total / selectedFields.value.length)
})

function setCropFilter(next: CropKey) {
  cropFilter.value = next
}

function selectField(id: string) {
  selectedFieldId.value = id
}

function goToFieldDetails(id: string) {
  router.push({ name: 'field-details', params: { id } })
}

function toggleMultiSelect(id: string) {
  const idx = multiSelectedIds.value.indexOf(id)
  if (idx === -1) {
    multiSelectedIds.value = [...multiSelectedIds.value, id]
  } else {
    const next = [...multiSelectedIds.value]
    next.splice(idx, 1)
    multiSelectedIds.value = next
  }
}

function openReports() {
  router.push('/reports')
}

function openJournal() {
  router.push('/tasks')
}

const CSV_SEP = '\t'

function escapeCsvCell(val: string): string {
  const s = String(val ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""')
  return s.includes(CSV_SEP) || s.includes('"') || s.includes('\r') ? `"${s}"` : s
}

function exportFieldsToExcel() {
  const list = sortedFilteredFields.value
  if (!list.length) return
  const headers = [
    '№',
    'Название',
    'Кадастровый №',
    '№ ПОЛЯ ЕФИС ЗСН',
    'Площадь (га)',
    'Культура',
    'Тип земли',
    'Описание',
    'Муниципальное образование',
    'Регион',
    'Ответственный',
  ]
  const rows = list.map((f, i) => [
    String(i + 1),
    f.name || '',
    f.cadastralNumber || '',
    f.efisZsnNumber || '',
    String(f.area ?? ''),
    f.cropName || '',
    f.landType || '',
    f.locationDescription || '',
    f.municipality || '',
    f.region || '',
    f.responsiblePerson || 'Не назначен',
  ])
  const line = (arr: (string | number)[]) => arr.map((v) => escapeCsvCell(String(v))).join(CSV_SEP)
  const csv = '\uFEFF' + [line(headers), ...rows.map((r) => line(r))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `список_полей_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

async function exportFieldsToPdf() {
  const list = sortedFilteredFields.value
  if (!list.length) return
  const headers = [
    '№',
    'Название',
    'Кадастровый №',
    '№ ПОЛЯ ЕФИС ЗСН',
    'Площадь (га)',
    'Культура',
    'Тип земли',
    'Описание',
    'Муниципальное образование',
    'Регион',
    'Ответственный',
  ]
  const rows = list.map((f, i) => [
    String(i + 1),
    escapeHtml(f.name || ''),
    escapeHtml(f.cadastralNumber || ''),
    escapeHtml(f.efisZsnNumber || ''),
    escapeHtml(String(f.area ?? '')),
    escapeHtml(f.cropName || ''),
    escapeHtml(f.landType || ''),
    escapeHtml(f.locationDescription || ''),
    escapeHtml(f.municipality || ''),
    escapeHtml(f.region || ''),
    escapeHtml(f.responsiblePerson || 'Не назначен'),
  ])
  const tableRows = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
  const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const html = `
    <div class="pdf-export-table-wrap" style="position:fixed;left:-9999px;top:0;width:1300px;font-family:Arial,sans-serif;font-size:12px;background:#fff;">
      <h2 style="margin:0 0 12px 0;font-size:16px;">Список полей</h2>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead><tr style="background:#2d5a3d;color:#fff;">${headerCells}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `
  const wrap = document.createElement('div')
  wrap.innerHTML = html.trim()
  const el = wrap.firstElementChild as HTMLElement
  document.body.appendChild(el)
  try {
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false })
    document.body.removeChild(el)
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
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch {
    document.body.removeChild(el)
  }
}

const isAddFieldOpen = ref(false)
const isFieldModalWide = ref(false)
const editingFieldId = ref<string | null>(null)
const deleteConfirmFieldId = ref<string | null>(null)
const newFieldName = ref('')
const newFieldCadastral = ref('')
const newFieldEfisZsn = ref('')
const newFieldAddress = ref('')
const newFieldAddressCandidates = ref<string[]>([])
const selectedAddressCandidate = ref('')
const fieldMapAddressCandidatesLoading = ref(false)
const newFieldAddressManualTouched = ref(false)
const newFieldAddressLastAuto = ref('')
const newFieldGeo = ref('')
const newFieldExtra = ref('')
const newFieldArea = ref<number | ''>('')
const newFieldGeometryMode = ref<'point' | 'polygon'>('point')
const newFieldContourGeojson = ref<PolygonGeoJson | null>(null)
const newFieldContourDraftPoints = ref<LatLon[]>([])
const newFieldAreaAuto = ref<number | null>(null)
const newFieldAreaManualTouched = ref(false)
const newFieldLandType = ref('Пашня')
const newFieldCropKey = ref('wheat')
const newFieldSowingYear = ref(new Date().getFullYear())
const newFieldLocationDesc = ref('')
const newFieldResponsibleId = ref('')
const newFieldSchemeUrl = ref('')
const newFieldSchemeFileName = ref('')
const fieldMapAddressLoading = ref(false)
const fieldMapAddressError = ref('')
const schemePreviewObjectUrl = ref('') // временный URL для превью до завершения загрузки
const schemeUploading = ref(false)
const schemeUploadError = ref('')
const schemeFileInputRef = ref<HTMLInputElement | null>(null)
const fieldFormError = ref('')

const isSchemeImage = computed(() => /\.(jpe?g|png|gif|webp)$/i.test(newFieldSchemeFileName.value))
const schemePreviewUrl = computed(() => newFieldSchemeUrl.value || schemePreviewObjectUrl.value)

const isFieldModalOpen = computed(() => isAddFieldOpen.value)
const fieldModalTitle = computed(() => (editingFieldId.value ? 'Редактирование поля' : 'Новое поле'))
const fieldToDelete = computed(() => (deleteConfirmFieldId.value ? fields.value.find((f) => f.id === deleteConfirmFieldId.value) : null))
const fieldMapCenter = computed(() => {
  const contourCenter = getPolygonCenterLatLon(newFieldContourGeojson.value)
  if (contourCenter) return contourCenter
  const selectedLand = selectedLandForField.value
  if (selectedLand?.contour_geojson) {
    const landContourCenter = getPolygonCenterLatLon(selectedLand.contour_geojson as PolygonGeoJson | Record<string, unknown>)
    if (landContourCenter) return landContourCenter
  }
  if (selectedLand?.center_lat != null && selectedLand.center_lon != null) {
    return { lat: Number(selectedLand.center_lat), lon: Number(selectedLand.center_lon) }
  }
  const raw = newFieldGeo.value.trim()
  if (!raw) return { lat: 55.7558, lon: 37.6176 }
  const parts = raw.split(',').map((p) => Number(p.trim()))
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return { lat: 55.7558, lon: 37.6176 }
  return { lat: parts[0], lon: parts[1] }
})

function toPolygonGeoJson(points: LatLon[]): PolygonGeoJson | null {
  if (!Array.isArray(points) || points.length < 3) return null
  const ring = points.map(([lat, lon]) => [lon, lat])
  const [firstLon, firstLat] = ring[0]!
  const [lastLon, lastLat] = ring[ring.length - 1]!
  if (firstLon !== lastLon || firstLat !== lastLat) ring.push([firstLon, firstLat])
  return { type: 'Polygon', coordinates: [ring] }
}

function fromPolygonGeoJson(geojson: PolygonGeoJson | Record<string, unknown> | null | undefined): LatLon[] {
  if (!geojson || geojson.type !== 'Polygon' || !Array.isArray(geojson.coordinates)) return []
  const ring = geojson.coordinates[0]
  if (!Array.isArray(ring)) return []
  const points = ring
    .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[1]), Number(p[0])] as LatLon : null))
    .filter((p): p is LatLon => Boolean(p && Number.isFinite(p[0]) && Number.isFinite(p[1])))
  if (points.length >= 2) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first[0] === last[0] && first[1] === last[1]) points.pop()
  }
  return points
}

function getPolygonCenterLatLon(geojson: PolygonGeoJson | Record<string, unknown> | null | undefined): { lat: number; lon: number } | null {
  const points = fromPolygonGeoJson(geojson)
  if (!points.length) return null
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length
  const lon = points.reduce((s, p) => s + p[1], 0) / points.length
  return { lat, lon }
}

const fieldMapPolygonPoints = computed<LatLon[]>(() =>
  newFieldContourDraftPoints.value.length ? newFieldContourDraftPoints.value : fromPolygonGeoJson(newFieldContourGeojson.value),
)

const CROP_OPTIONS_FALLBACK: { key: string; label: string }[] = [
  { key: 'wheat', label: 'Пшеница' },
  { key: 'corn', label: 'Кукуруза' },
  { key: 'soy', label: 'Соя' },
  { key: 'sunflower', label: 'Подсолнечник' },
  { key: 'none', label: 'Нет (пар)' },
  { key: 'meadow', label: 'Многолетние травы' },
]

const landTypes = ref<LandTypeRow[]>([])
const crops = ref<CropRow[]>([])
const lands = ref<LandRow[]>([])
const fieldMunicipalityRefs = ref<FieldMunicipalityRefRow[]>([])
const newFieldLandId = ref('')
const newFieldMunicipality = ref('')
const newFieldRegion = ref('')

const landTypeOptions = computed(() =>
  landTypes.value.length > 0 ? landTypes.value.map((t) => ({ name: t.name })) : LAND_TYPES_FALLBACK.map((name) => ({ name })),
)
const cropOptions = computed(() => (crops.value.length > 0 ? crops.value : CROP_OPTIONS_FALLBACK))
const selectedLandForField = computed(() => lands.value.find((l) => l.id === newFieldLandId.value) ?? null)
const selectedLandContourMarkers = computed(() => {
  const land = selectedLandForField.value
  if (!land || !land.contour_geojson) return []
  const polygonPoints = fromPolygonGeoJson(land.contour_geojson as PolygonGeoJson | Record<string, unknown>)
  if (polygonPoints.length < 3) return []
  const center = getPolygonCenterLatLon(land.contour_geojson as PolygonGeoJson | Record<string, unknown>)
  return [
    {
      id: `land-${land.id}`,
      lat: center?.lat ?? (land.center_lat ?? 55.7558),
      lon: center?.lon ?? (land.center_lon ?? 37.6176),
      title: `Контур земли: ${land.cadastral_number || land.name || 'Участок'}`,
      subtitle: land.address || '',
      geometryMode: 'polygon' as const,
      polygonPoints,
      interactive: false,
      polygonStrokeColor: '#2563eb',
      polygonFillColor: 'rgba(37, 99, 235, 0.16)',
      centerPreset: 'islands#blueCircleDotIcon',
    },
  ]
})

async function openAddField() {
  if (isSupabaseConfigured()) {
    try {
      const [landTypesList, cropsList, landsList, municipalRefsList] = await Promise.all([
        loadLandTypes(),
        loadCrops(),
        loadLandsApi(),
        loadFieldMunicipalitiesRefs(),
      ])
      landTypes.value = landTypesList
      crops.value = cropsList
      lands.value = landsList
      fieldMunicipalityRefs.value = municipalRefsList
    } catch (e) {
      fieldFormError.value = refsErrorMessage(e)
    }
  }
  editingFieldId.value = null
  newFieldName.value = ''
  newFieldCadastral.value = ''
  newFieldEfisZsn.value = ''
  newFieldAddress.value = ''
  newFieldAddressCandidates.value = []
  selectedAddressCandidate.value = ''
  fieldMapAddressCandidatesLoading.value = false
  newFieldAddressManualTouched.value = false
  newFieldAddressLastAuto.value = ''
  newFieldGeo.value = ''
  newFieldExtra.value = ''
  newFieldArea.value = ''
  newFieldGeometryMode.value = 'point'
  newFieldContourGeojson.value = null
  newFieldContourDraftPoints.value = []
  newFieldAreaAuto.value = null
  newFieldAreaManualTouched.value = false
  newFieldLandType.value = landTypeOptions.value[0]?.name ?? 'Пашня'
  newFieldLandId.value = ''
  newFieldMunicipality.value = ''
  newFieldRegion.value = ''
  newFieldCropKey.value = cropOptions.value[0]?.key ?? 'wheat'
  newFieldSowingYear.value = new Date().getFullYear()
  newFieldLocationDesc.value = ''
  newFieldResponsibleId.value = ''
  newFieldSchemeUrl.value = ''
  newFieldSchemeFileName.value = ''
  fieldMapAddressLoading.value = false
  fieldMapAddressError.value = ''
  if (schemePreviewObjectUrl.value) {
    URL.revokeObjectURL(schemePreviewObjectUrl.value)
    schemePreviewObjectUrl.value = ''
  }
  schemeUploadError.value = ''
  fieldFormError.value = ''
  isFieldModalWide.value = false
  isAddFieldOpen.value = true
}

async function openEditField(f: Field) {
  if (isSupabaseConfigured()) {
    try {
      const [landTypesList, cropsList, landsList, municipalRefsList] = await Promise.all([
        loadLandTypes(),
        loadCrops(),
        loadLandsApi(),
        loadFieldMunicipalitiesRefs(),
      ])
      landTypes.value = landTypesList
      crops.value = cropsList
      lands.value = landsList
      fieldMunicipalityRefs.value = municipalRefsList
    } catch (e) {
      fieldFormError.value = refsErrorMessage(e)
    }
  }
  editingFieldId.value = f.id
  newFieldName.value = f.name
  newFieldCadastral.value = f.cadastralNumber
  newFieldEfisZsn.value = f.efisZsnNumber ?? ''
  newFieldAddress.value = f.address
  newFieldAddressCandidates.value = f.address ? [f.address] : []
  selectedAddressCandidate.value = f.address || ''
  fieldMapAddressCandidatesLoading.value = false
  newFieldAddressManualTouched.value = false
  newFieldAddressLastAuto.value = f.address || ''
  newFieldGeo.value = f.geolocation
  newFieldExtra.value = f.extraInfo
  newFieldArea.value = f.area
  newFieldGeometryMode.value = f.geometryMode ?? 'point'
  newFieldContourGeojson.value = (f.contourGeojson as PolygonGeoJson | null) ?? null
  newFieldContourDraftPoints.value = fromPolygonGeoJson((f.contourGeojson as PolygonGeoJson | null) ?? null)
  newFieldAreaAuto.value = null
  newFieldAreaManualTouched.value = false
  newFieldLandType.value = f.landType
  newFieldLandId.value = f.landId ?? ''
  newFieldMunicipality.value = f.municipality ?? ''
  newFieldRegion.value = f.region ?? ''
  newFieldCropKey.value = f.cropKey
  newFieldSowingYear.value = f.sowingYear
  newFieldLocationDesc.value = f.locationDescription
  newFieldResponsibleId.value = f.responsibleId ?? ''
  newFieldSchemeUrl.value = f.schemeFileUrl
  newFieldSchemeFileName.value = f.schemeFileUrl ? new URL(f.schemeFileUrl).pathname.split('/').pop() || 'Схема' : ''
  fieldMapAddressLoading.value = false
  fieldMapAddressError.value = ''
  schemeUploadError.value = ''
  fieldFormError.value = ''
  isFieldModalWide.value = false
  isAddFieldOpen.value = true
}

function clearSchemeFile() {
  if (schemePreviewObjectUrl.value) {
    URL.revokeObjectURL(schemePreviewObjectUrl.value)
    schemePreviewObjectUrl.value = ''
  }
  newFieldSchemeUrl.value = ''
  newFieldSchemeFileName.value = ''
  schemeUploadError.value = ''
  if (schemeFileInputRef.value) schemeFileInputRef.value.value = ''
}

function onSchemeDragOver(e: DragEvent) {
  e.dataTransfer && (e.dataTransfer.dropEffect = 'copy')
}

function onSchemeDragLeave() {
  /* no-op */
}

function onSchemeDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file) processSchemeFile(file)
}

async function onSchemeFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = ''
  await processSchemeFile(file)
}

async function processSchemeFile(file: File) {
  if (schemePreviewObjectUrl.value) {
    URL.revokeObjectURL(schemePreviewObjectUrl.value)
    schemePreviewObjectUrl.value = ''
  }
  newFieldSchemeFileName.value = file.name
  newFieldSchemeUrl.value = ''
  schemeUploadError.value = ''
  fieldFormError.value = ''

  if (file.size > PHOTO_MAX_BYTES) {
    schemeUploadError.value = `Файл не должен превышать ${PHOTO_MAX_LABEL}.`
    newFieldSchemeFileName.value = ''
    return
  }
  const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
  if (!allowed.includes(file.type)) {
    schemeUploadError.value = 'Допустимы только JPG, PNG и PDF.'
    newFieldSchemeFileName.value = ''
    return
  }
  if (/^image\//.test(file.type)) {
    schemePreviewObjectUrl.value = URL.createObjectURL(file)
  }
  if (!isSupabaseConfigured()) {
    schemeUploadError.value = 'Загрузка файлов доступна при подключённом Supabase.'
    return
  }

  schemeUploading.value = true
  schemeUploadError.value = ''
  await nextTick()

  try {
    const url = await uploadFieldScheme(file, editingFieldId.value ?? undefined)
    if (schemePreviewObjectUrl.value) {
      URL.revokeObjectURL(schemePreviewObjectUrl.value)
      schemePreviewObjectUrl.value = ''
    }
    newFieldSchemeUrl.value = url
    newFieldSchemeFileName.value = file.name
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Не удалось загрузить файл.'
    schemeUploadError.value = msg
    console.error('[Fields] scheme upload failed:', err)
    if (typeof msg === 'string' && (msg.includes('policy') || msg.includes('row-level security') || msg.includes('RLS'))) {
      schemeUploadError.value = 'Доступ к хранилищу запрещён. В Supabase: Storage → field-schemes → Policies — добавьте политику на загрузку (INSERT).'
    }
  } finally {
    schemeUploading.value = false
  }
}

function closeFieldModal() {
  isAddFieldOpen.value = false
  isFieldModalWide.value = false
  editingFieldId.value = null
  newFieldAreaManualTouched.value = false
  fieldMapAddressCandidatesLoading.value = false
  newFieldAddressCandidates.value = []
  selectedAddressCandidate.value = ''
  fieldMapAddressLoading.value = false
  fieldMapAddressError.value = ''
}

function toggleFieldModalWidth() {
  isFieldModalWide.value = !isFieldModalWide.value
}

watch(isFieldModalWide, async () => {
  if (!isAddFieldOpen.value) return
  await nextTick()
  window.dispatchEvent(new Event('resize'))
  setTimeout(() => window.dispatchEvent(new Event('resize')), 180)
})

async function onPickFieldMap(coords: { lat: number; lon: number }) {
  newFieldGeometryMode.value = 'point'
  newFieldContourGeojson.value = null
  newFieldContourDraftPoints.value = []
  newFieldAreaAuto.value = null
  const lat = Number(coords.lat.toFixed(6))
  const lon = Number(coords.lon.toFixed(6))
  newFieldGeo.value = `${lat}, ${lon}`
  fieldMapAddressError.value = ''
  fieldMapAddressLoading.value = true
  fieldMapAddressCandidatesLoading.value = false
  try {
    const address = await resolveYandexAddressLine(lat, lon)
    if (address) {
      applyAddressCandidates([address])
    } else {
      fieldMapAddressError.value = 'Не удалось определить адрес по выбранной точке.'
    }
  } finally {
    fieldMapAddressLoading.value = false
  }
}

function onFieldAddressInput() {
  if (newFieldAddress.value !== newFieldAddressLastAuto.value) {
    newFieldAddressManualTouched.value = true
  }
}

function applyAddressCandidates(candidates: string[]) {
  const list = [...new Set(candidates.map((x) => x.trim()).filter(Boolean))]
  newFieldAddressCandidates.value = list
  selectedAddressCandidate.value = list[0] || ''
  const current = newFieldAddress.value.trim()
  if (!list.length) return
  if (!current || !newFieldAddressManualTouched.value) {
    newFieldAddress.value = list[0]!
    newFieldAddressLastAuto.value = list[0]!
    newFieldAddressManualTouched.value = false
    tryFillFieldRegionFromAddress(list[0]!)
    tryFillMunicipalityFromAddress(list[0]!)
  }
}

function contourSamplePoints(points: LatLon[], center: { lat: number; lon: number } | null): Array<{ lat: number; lon: number }> {
  const src = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (!src.length && !center) return []
  const out: Array<{ lat: number; lon: number }> = []
  if (center) out.push({ lat: center.lat, lon: center.lon })
  if (src.length) {
    const idx = new Set<number>([
      0,
      Math.floor(src.length * 0.25),
      Math.floor(src.length * 0.5),
      Math.floor(src.length * 0.75),
      src.length - 1,
    ])
    for (const i of idx) {
      const p = src[Math.max(0, Math.min(i, src.length - 1))]!
      out.push({ lat: p[0], lon: p[1] })
    }
  }
  return out
}

let contourAddressRequestId = 0
async function suggestContourAddresses(points: LatLon[], center: { lat: number; lon: number } | null) {
  const samples = contourSamplePoints(points, center)
  if (!samples.length) return
  const reqId = ++contourAddressRequestId
  fieldMapAddressCandidatesLoading.value = true
  try {
    const candidates = await resolveYandexAddressCandidates(samples, 8)
    if (reqId !== contourAddressRequestId) return
    applyAddressCandidates(candidates)
    if (!candidates.length) {
      fieldMapAddressError.value = 'Не удалось подобрать адреса по контуру. Укажите адрес вручную.'
    } else {
      fieldMapAddressError.value = ''
    }
  } finally {
    if (reqId === contourAddressRequestId) fieldMapAddressCandidatesLoading.value = false
  }
}

function onAddressCandidateChange() {
  if (!selectedAddressCandidate.value) return
  newFieldAddress.value = selectedAddressCandidate.value
  newFieldAddressLastAuto.value = selectedAddressCandidate.value
  newFieldAddressManualTouched.value = false
  tryFillFieldRegionFromAddress(selectedAddressCandidate.value)
  tryFillMunicipalityFromAddress(selectedAddressCandidate.value)
}

function extractRegionFromAddress(address: string): string {
  const match = address.match(/([А-Яа-яЁёA-Za-z\- ]+\s(?:область|край|республика|АО|автономный округ))/)
  return match?.[1]?.trim() || ''
}

function tryFillFieldRegionFromAddress(address: string) {
  const region = extractRegionFromAddress(address)
  if (region) newFieldRegion.value = region
}

function tryFillMunicipalityFromAddress(address: string) {
  if (newFieldMunicipality.value.trim()) return
  const normalizedAddress = address.toLowerCase()
  const match = fieldMunicipalityRefs.value.find((row) => normalizedAddress.includes(row.name.toLowerCase()))
  if (match) newFieldMunicipality.value = match.name
}

function onFieldAreaManualInput() {
  if (newFieldGeometryMode.value === 'polygon') newFieldAreaManualTouched.value = true
}

function setFieldGeometryMode(mode: 'point' | 'polygon') {
  newFieldGeometryMode.value = mode
  fieldMapAddressError.value = ''
  if (mode === 'point') {
    newFieldContourGeojson.value = null
    newFieldContourDraftPoints.value = []
    newFieldAreaAuto.value = null
    newFieldAreaManualTouched.value = false
    newFieldAddressCandidates.value = newFieldAddress.value.trim() ? [newFieldAddress.value.trim()] : []
    selectedAddressCandidate.value = newFieldAddressCandidates.value[0] || ''
    fieldMapAddressCandidatesLoading.value = false
    return
  }
  newFieldAreaManualTouched.value = false
}

function onFieldMapPolygonChange(payload: { points: LatLon[]; areaHa: number; center: { lat: number; lon: number } | null }) {
  newFieldContourDraftPoints.value = payload.points
  const geojson = toPolygonGeoJson(payload.points)
  newFieldContourGeojson.value = geojson
  if (geojson) {
    newFieldGeometryMode.value = 'polygon'
    if (payload.center) {
      newFieldGeo.value = `${payload.center.lat.toFixed(6)}, ${payload.center.lon.toFixed(6)}`
    }
    const roundedArea = Math.round(Math.max(0, payload.areaHa) * 100) / 100
    newFieldAreaAuto.value = roundedArea
    if (!newFieldAreaManualTouched.value) {
      newFieldArea.value = roundedArea
    }
    if (payload.points.length >= 3) {
      void suggestContourAddresses(payload.points, payload.center)
    }
  } else {
    newFieldAreaAuto.value = null
  }
}

async function onResponsibleChange(fieldId: string, value: string) {
  if (!isSupabaseConfigured()) {
    const prof = profiles.value.find((p) => p.id === value)
    const name = prof ? (prof.display_name || prof.email) : ''
    const f = fields.value.find((x) => x.id === fieldId)
    if (f) {
      f.responsibleId = value || null
      f.responsiblePerson = name
    }
    return
  }
  try {
    await updateFieldApi(fieldId, { responsible_id: value || null })
    await loadFieldsData()
  } catch {
    // можно показать toast
  }
}

function openDeleteConfirm(f: Field) {
  deleteConfirmFieldId.value = f.id
}

function closeDeleteConfirm() {
  deleteConfirmFieldId.value = null
}

async function confirmDelete() {
  const id = deleteConfirmFieldId.value
  if (!id) return
  closeDeleteConfirm()
  await deleteField(id)
}

async function addField() {
  const name = newFieldName.value.trim()
  if (!name) {
    fieldFormError.value = 'Введите название поля.'
    return
  }
  const area = typeof newFieldArea.value === 'number' ? newFieldArea.value : parseFloat(String(newFieldArea.value))
  if (Number.isNaN(area) || area < 0) {
    fieldFormError.value = 'Площадь не может быть отрицательной.'
    return
  }
  if (area === 0 && newFieldArea.value !== '' && newFieldArea.value !== 0) {
    fieldFormError.value = 'Укажите площадь.'
    return
  }
  fieldFormError.value = ''
  const cropOpt = cropOptions.value.find((o) => o.key === newFieldCropKey.value)
  const cropName = cropOpt?.label ?? 'Пшеница'
  const geometryMode = newFieldGeometryMode.value
  const contourGeojson = geometryMode === 'polygon' ? toPolygonGeoJson(newFieldContourDraftPoints.value) : null
  const geolocation = newFieldGeo.value.trim() || null

  if (editingFieldId.value) {
    if (isSupabaseConfigured()) {
      try {
        await updateFieldApi(editingFieldId.value, {
          name,
          area: Number.isNaN(area) ? 0 : area,
          cadastral_number: newFieldCadastral.value.trim() || null,
          efis_zsn_number: newFieldEfisZsn.value.trim() || null,
          address: newFieldAddress.value.trim() || null,
          location_description: newFieldLocationDesc.value.trim() || null,
          extra_info: newFieldExtra.value.trim() || null,
          geolocation,
          municipality: newFieldMunicipality.value.trim() || null,
          region: newFieldRegion.value.trim() || null,
          geometry_mode: geometryMode,
          contour_geojson: contourGeojson,
          land_id: newFieldLandId.value || null,
          land_type: newFieldLandType.value,
          sowing_year: newFieldSowingYear.value,
          responsible_id: newFieldResponsibleId.value.trim() || null,
          crop_key: newFieldCropKey.value,
          scheme_file_url: newFieldSchemeUrl.value || null,
        })
        await loadFieldsData()
      } catch (e) {
        fieldFormError.value = e instanceof Error ? e.message : 'Не удалось сохранить изменения'
        return
      }
    } else {
      const f = fields.value.find((x) => x.id === editingFieldId.value)
      if (f) {
        f.name = name
        f.area = Number.isNaN(area) ? 0 : area
        f.cadastralNumber = newFieldCadastral.value.trim()
        f.efisZsnNumber = newFieldEfisZsn.value.trim()
        f.address = newFieldAddress.value.trim()
        f.locationDescription = newFieldLocationDesc.value.trim()
        f.extraInfo = newFieldExtra.value.trim()
        f.geolocation = geolocation || ''
        f.municipality = newFieldMunicipality.value.trim()
        f.region = newFieldRegion.value.trim()
        f.geometryMode = geometryMode
        f.contourGeojson = contourGeojson
        f.landId = newFieldLandId.value || null
        f.landType = newFieldLandType.value
        f.sowingYear = newFieldSowingYear.value
        f.responsibleId = newFieldResponsibleId.value || null
        f.responsiblePerson = profiles.value.find((p) => p.id === newFieldResponsibleId.value)?.display_name || profiles.value.find((p) => p.id === newFieldResponsibleId.value)?.email || ''
        f.cropKey = newFieldCropKey.value
        f.cropName = cropName
        f.schemeFileUrl = newFieldSchemeUrl.value
      }
    }
    closeFieldModal()
    return
  }

  const num = nextFieldNumber.value
  if (isSupabaseConfigured()) {
    try {
      await addFieldApi({
        number: num,
        name,
        area: Number.isNaN(area) ? 0 : area,
        cadastral_number: newFieldCadastral.value.trim() || null,
        efis_zsn_number: newFieldEfisZsn.value.trim() || null,
        address: newFieldAddress.value.trim() || null,
        location_description: newFieldLocationDesc.value.trim() || null,
        extra_info: newFieldExtra.value.trim() || null,
        geolocation,
        municipality: newFieldMunicipality.value.trim() || null,
        region: newFieldRegion.value.trim() || null,
        geometry_mode: geometryMode,
        contour_geojson: contourGeojson,
        land_id: newFieldLandId.value || null,
        land_type: newFieldLandType.value,
        sowing_year: newFieldSowingYear.value,
        responsible_id: newFieldResponsibleId.value.trim() || null,
        crop_key: newFieldCropKey.value,
        scheme_file_url: newFieldSchemeUrl.value || null,
      })
      await loadFieldsData()
      const added = fields.value.find((f) => f.number === num)
      if (added) selectedFieldId.value = added.id
    } catch (e) {
      fieldFormError.value = e instanceof Error ? e.message : 'Не удалось сохранить поле'
      return
    }
  } else {
    const id = `field-${num}`
    fields.value = [
      ...fields.value,
      {
        id,
        number: num,
        name,
        area: Number.isNaN(area) ? 0 : area,
        cadastralNumber: newFieldCadastral.value.trim(),
        efisZsnNumber: newFieldEfisZsn.value.trim(),
        address: newFieldAddress.value.trim(),
        locationDescription: newFieldLocationDesc.value.trim(),
        extraInfo: newFieldExtra.value.trim(),
        geolocation: geolocation || '',
        municipality: newFieldMunicipality.value.trim(),
        region: newFieldRegion.value.trim(),
        geometryMode,
        contourGeojson,
        landId: newFieldLandId.value || null,
        landType: newFieldLandType.value,
        sowingYear: newFieldSowingYear.value,
        responsibleId: newFieldResponsibleId.value || null,
        responsiblePerson: profiles.value.find((p) => p.id === newFieldResponsibleId.value)?.display_name || profiles.value.find((p) => p.id === newFieldResponsibleId.value)?.email || '',
        cropKey: newFieldCropKey.value,
        cropName,
        schemeFileUrl: newFieldSchemeUrl.value,
        stage: '—',
        readinessPercent: 0,
        forecastYield: '—',
        harvestDate: '—',
        imageUrl: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=400&q=80',
        soilType: '—',
        moisture: '—',
        lastOperation: '—',
      },
    ]
    selectedFieldId.value = id
  }
  successModalTitle.value = 'Поле добавлено'
  successModalMessage.value = `Поле "${name}" успешно сохранено.`
  successModalOpen.value = true
  closeFieldModal()
}

async function deleteField(id: string) {
  if (isSupabaseConfigured()) {
    try {
      await deleteFieldApi(id)
      await loadFieldsData()
    } catch {
      // можно показать toast
    }
  } else {
    fields.value = fields.value.filter((f) => f.id !== id)
  }
  if (selectedFieldId.value === id) {
    selectedFieldId.value = fields.value[0]?.id ?? null
  }
  const total = totalFiltered.value
  const maxPage = Math.ceil(total / pageSize.value)
  if (currentPage.value > maxPage && maxPage > 0) {
    currentPage.value = maxPage
    if (isSupabaseConfigured()) void loadFieldsData()
  }
}

function setPage(p: number) {
  const next = Math.max(1, Math.min(p, totalPages.value))
  if (next === currentPage.value) return
  currentPage.value = next
  if (isSupabaseConfigured()) void loadFieldsData()
}

function onPageSizeChange() {
  currentPage.value = 1
  if (isSupabaseConfigured()) {
    void loadFieldsData()
    return
  }
  const total = totalFiltered.value
  const maxPage = Math.ceil(total / pageSize.value)
  if (currentPage.value > maxPage && maxPage > 0) currentPage.value = maxPage
}

function fieldNameIconClass(f: Field): string {
  if (f.cropName === 'Нет культуры') return 'fields-name-icon fields-name-icon--fallow'
  if (f.cropName === 'Многолетние травы') return 'fields-name-icon fields-name-icon--meadow'
  const map: Record<string, string> = {
    wheat: 'fields-name-icon fields-name-icon--wheat',
    corn: 'fields-name-icon fields-name-icon--corn',
    soy: 'fields-name-icon fields-name-icon--soy',
    sunflower: 'fields-name-icon fields-name-icon--sunflower',
  }
  return map[f.cropKey] ?? 'fields-name-icon fields-name-icon--wheat'
}

function cropPillClass(f: Field): string {
  if (f.cropName === 'Нет культуры') return 'fields-crop-pill fields-crop-pill--grey'
  if (f.cropName === 'Многолетние травы') return 'fields-crop-pill fields-crop-pill--meadow'
  const map: Record<string, string> = {
    wheat: 'fields-crop-pill fields-crop-pill--wheat',
    corn: 'fields-crop-pill fields-crop-pill--wheat',
    sunflower: 'fields-crop-pill fields-crop-pill--sunflower',
    soy: 'fields-crop-pill fields-crop-pill--soy',
  }
  return map[f.cropKey] ?? 'fields-crop-pill fields-crop-pill--wheat'
}

const paginationPages = computed(() => {
  const total = totalPages.value
  const cur = currentPage.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | string)[] = [1]
  const start = Math.max(2, cur - 1)
  const end = Math.min(total - 1, cur + 1)
  if (start > 2) pages.push('...')
  for (let p = start; p <= end; p += 1) pages.push(p)
  if (end < total - 1) pages.push('...')
  pages.push(total)
  return pages
})

function updateFieldName(id: string, name: string) {
  const trimmed = name.trim()
  fields.value = fields.value.map((f) =>
    f.id === id ? { ...f, name: trimmed || f.name } : f,
  )
}

// Справочники: причины простоя и операции (из БД)
const auth = useAuth()
const REFS_PAGE_SIZE_OPTIONS = [5, 10, 20] as const
const refsPageSize = ref(10)
const refsPageReasons = ref(1)
const refsPageOperations = ref(1)

function refsPaginationPages(total: number, cur: number): (number | string)[] {
  const totalP = Math.max(1, total)
  if (totalP <= 7) return Array.from({ length: totalP }, (_, i) => i + 1)
  const pages: (number | string)[] = [1]
  const start = Math.max(2, cur - 1)
  const end = Math.min(totalP - 1, cur + 1)
  if (start > 2) pages.push('...')
  for (let p = start; p <= end; p += 1) pages.push(p)
  if (end < totalP - 1) pages.push('...')
  pages.push(totalP)
  return pages
}

const downtimeReasons = ref<DowntimeReasonRow[]>([])
const workOperations = ref<WorkOperationRow[]>([])
const refsLoading = ref(false)

const paginatedReasons = computed(() => {
  const size = refsPageSize.value
  const start = (refsPageReasons.value - 1) * size
  return downtimeReasons.value.slice(start, start + size)
})
const totalPagesReasons = computed(() => Math.max(1, Math.ceil(downtimeReasons.value.length / refsPageSize.value)))
const paginatedOperations = computed(() => {
  const size = refsPageSize.value
  const start = (refsPageOperations.value - 1) * size
  return workOperations.value.slice(start, start + size)
})
const totalPagesOperations = computed(() => Math.max(1, Math.ceil(workOperations.value.length / refsPageSize.value)))

function onRefsPageSizeChange() {
  refsPageReasons.value = Math.max(1, Math.min(refsPageReasons.value, totalPagesReasons.value))
  refsPageOperations.value = Math.max(1, Math.min(refsPageOperations.value, totalPagesOperations.value))
}

function setRefsPageReasons(p: number) {
  refsPageReasons.value = Math.max(1, Math.min(p, totalPagesReasons.value))
}
function setRefsPageOperations(p: number) {
  refsPageOperations.value = Math.max(1, Math.min(p, totalPagesOperations.value))
}
const newReasonLabel = ref('')
const newReasonDesc = ref('')
const newReasonCategory = ref<DowntimeCategory>('breakdown')
const newOperationName = ref('')
const refsError = ref<string | null>(null)

const deleteConfirmReasonId = ref<string | null>(null)
const deleteConfirmOperationId = ref<string | null>(null)

const reasonToDelete = computed(() => deleteConfirmReasonId.value ? downtimeReasons.value.find((r) => r.id === deleteConfirmReasonId.value) : null)
const operationToDelete = computed(() => deleteConfirmOperationId.value ? workOperations.value.find((op) => op.id === deleteConfirmOperationId.value) : null)

function refsErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') return (e as { message: string }).message
  const s = String(e)
  if (s === '[object Object]') return 'Произошла ошибка при обращении к базе данных.'
  return s
}

async function loadRefs() {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const [reasons, operations, landTypesList, cropsList] = await Promise.all([
      loadDowntimeReasons(),
      loadWorkOperations(),
      loadLandTypes(),
      loadCrops(),
    ])
    downtimeReasons.value = reasons
    workOperations.value = operations
    landTypes.value = landTypesList
    crops.value = cropsList
  } catch (e) {
    refsError.value = refsErrorMessage(e)
  } finally {
    refsLoading.value = false
  }
}

async function addReason() {
  const label = newReasonLabel.value.trim()
  if (!label) return
  refsError.value = null
  try {
    const createdBy = auth.user.value?.email ?? null
    const row = await addDowntimeReason(label, newReasonDesc.value.trim(), newReasonCategory.value, createdBy)
    downtimeReasons.value = [...downtimeReasons.value, row]
    newReasonLabel.value = ''
    newReasonDesc.value = ''
  } catch (e) {
    refsError.value = refsErrorMessage(e)
  }
}

async function addOperation() {
  const name = newOperationName.value.trim()
  if (!name) return
  refsError.value = null
  try {
    const createdBy = auth.user.value?.email ?? null
    const row = await addWorkOperation(name, createdBy)
    workOperations.value = [...workOperations.value, row]
    newOperationName.value = ''
  } catch (e) {
    refsError.value = refsErrorMessage(e)
  }
}

function openDeleteReasonConfirm(r: DowntimeReasonRow) {
  deleteConfirmReasonId.value = r.id
}
function closeDeleteReasonConfirm() {
  deleteConfirmReasonId.value = null
}
async function confirmDeleteReason() {
  const id = deleteConfirmReasonId.value
  if (!id) return
  closeDeleteReasonConfirm()
  refsError.value = null
  try {
    await deleteDowntimeReason(id)
    downtimeReasons.value = downtimeReasons.value.filter((r) => r.id !== id)
    refsPageReasons.value = Math.max(1, Math.min(refsPageReasons.value, totalPagesReasons.value))
  } catch (e) {
    refsError.value = refsErrorMessage(e)
  }
}

function openDeleteOperationConfirm(op: WorkOperationRow) {
  deleteConfirmOperationId.value = op.id
}
function closeDeleteOperationConfirm() {
  deleteConfirmOperationId.value = null
}
async function confirmDeleteOperation() {
  const id = deleteConfirmOperationId.value
  if (!id) return
  closeDeleteOperationConfirm()
  refsError.value = null
  try {
    await deleteWorkOperation(id)
    workOperations.value = workOperations.value.filter((op) => op.id !== id)
    refsPageOperations.value = Math.max(1, Math.min(refsPageOperations.value, totalPagesOperations.value))
  } catch (e) {
    refsError.value = refsErrorMessage(e)
  }
}

function formatRefDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

type PageTab = 'fields' | 'downtime-reasons' | 'work-operations'
const activeTab = ref<PageTab>('fields')
const TABS: { id: PageTab; label: string }[] = [
  { id: 'fields', label: 'Управление полями' },
  { id: 'downtime-reasons', label: 'Причины простоя' },
  { id: 'work-operations', label: 'Операции для работы' },
]
const ROUTE_TAB_MAP: Record<string, PageTab> = {
  fields: 'fields',
  'downtime-reasons': 'downtime-reasons',
  'work-operations': 'work-operations',
  crops: 'fields',
  references: 'downtime-reasons',
}

watch(
  () => String(route.query.tab || ''),
  (tab) => {
    const normalized = ROUTE_TAB_MAP[tab]
    if (normalized && normalized !== activeTab.value) activeTab.value = normalized
  },
  { immediate: true },
)

onMounted(async () => {
  if (route.query.highlightAddField === '1') {
    highlightAddField.value = true
    setTimeout(() => {
      highlightAddField.value = false
    }, 1600)
  }
  if (isSupabaseConfigured()) {
    await loadRefs()
    await loadFieldsData()
  } else {
    fields.value = [...DEMO_FIELDS]
    selectedFieldId.value = DEMO_FIELDS[0]?.id ?? null
    loadRefs()
  }
})
</script>

<template>
  <section class="fields-page">
    <div class="fields-page-inner">
      <header class="fields-header page-enter-item">
        <div class="fields-header-text">
          <p v-show="activeTab === 'fields'" class="fields-subtitle">Реестр сельскохозяйственных угодий и назначение ответственных</p>
        </div>
        <button
          v-show="activeTab === 'fields'"
          class="fields-add-btn"
          :class="{ 'fields-add-btn--highlight': highlightAddField }"
          type="button"
          @click="openAddField"
        >
          <svg class="fields-add-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
          Добавить поле
        </button>
      </header>

      <nav class="fields-tabs page-enter-item" aria-label="Разделы">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          class="fields-tab"
          :class="{ 'fields-tab--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div v-show="activeTab === 'fields'" class="fields-tab-panel">
      <div class="fields-card">
        <div class="fields-toolbar">
          <div class="fields-search-wrap">
            <svg class="fields-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              v-model="searchText"
              type="search"
              class="fields-search-input"
              placeholder="Поиск по названию поля..."
              autocomplete="off"
            />
          </div>
          <div class="fields-toolbar-actions">
            <button type="button" class="fields-export-btn task-btn-export action_has has_saved" :disabled="!sortedFilteredFields.length" title="Экспорт в Excel" @click="exportFieldsToExcel">
              <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
              Excel
            </button>
            <button type="button" class="fields-export-btn task-btn-export action_has has_saved" :disabled="!sortedFilteredFields.length" title="Экспорт в PDF" @click="exportFieldsToPdf">
              <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
              PDF
            </button>
          </div>
        </div>

        <p v-if="fieldsError" class="fields-load-error">{{ fieldsError }}</p>
        <div v-if="fieldsLoading" class="fields-loading" role="status" aria-live="polite">
          <UiLoadingBar />
        </div>
        <div class="fields-table-wrap">
          <table class="fields-table" aria-label="Список полей">
            <thead>
              <tr>
                <th scope="col" class="fields-th-name" :aria-sort="fieldsAriaSort('name')">
                  <button
                    type="button"
                    class="fields-th-sort-btn"
                    aria-label="Сортировать по внутреннему названию"
                    @click.stop="toggleFieldsSort('name')"
                  >
                    Внутреннее название
                    <span v-if="fieldsSortMark('name')" class="fields-th-sort-mark">{{ fieldsSortMark('name') }}</span>
                  </button>
                </th>
                <th scope="col" class="fields-th-cadastral" :aria-sort="fieldsAriaSort('cadastralNumber')">
                  <button
                    type="button"
                    class="fields-th-sort-btn"
                    aria-label="Сортировать по кадастровому номеру"
                    @click.stop="toggleFieldsSort('cadastralNumber')"
                  >
                    Кадастровый №
                    <span v-if="fieldsSortMark('cadastralNumber')" class="fields-th-sort-mark">{{ fieldsSortMark('cadastralNumber') }}</span>
                  </button>
                </th>
                <th scope="col" class="fields-th-efis">№ ПОЛЯ ЕФИС ЗСН</th>
                <th scope="col" class="fields-th-area" :aria-sort="fieldsAriaSort('area')">
                  <button
                    type="button"
                    class="fields-th-sort-btn fields-th-sort-btn--end"
                    aria-label="Сортировать по площади"
                    @click.stop="toggleFieldsSort('area')"
                  >
                    Площадь (га)
                    <span v-if="fieldsSortMark('area')" class="fields-th-sort-mark">{{ fieldsSortMark('area') }}</span>
                  </button>
                </th>
                <th scope="col" class="fields-th-crop" :aria-sort="fieldsAriaSort('crop')">
                  <button
                    type="button"
                    class="fields-th-sort-btn"
                    aria-label="Сортировать по культуре"
                    @click.stop="toggleFieldsSort('crop')"
                  >
                    Культура
                    <span v-if="fieldsSortMark('crop')" class="fields-th-sort-mark">{{ fieldsSortMark('crop') }}</span>
                  </button>
                </th>
                <th scope="col" class="fields-th-land" :aria-sort="fieldsAriaSort('land')">
                  <button
                    type="button"
                    class="fields-th-sort-btn"
                    aria-label="Сортировать по типу земли"
                    @click.stop="toggleFieldsSort('land')"
                  >
                    Тип земли
                    <span v-if="fieldsSortMark('land')" class="fields-th-sort-mark">{{ fieldsSortMark('land') }}</span>
                  </button>
                </th>
                <th scope="col" class="fields-th-location" :aria-sort="fieldsAriaSort('location')">
                  <button
                    type="button"
                    class="fields-th-sort-btn"
                    aria-label="Сортировать по описанию места"
                    @click.stop="toggleFieldsSort('location')"
                  >
                    Описание
                    <span v-if="fieldsSortMark('location')" class="fields-th-sort-mark">{{ fieldsSortMark('location') }}</span>
                  </button>
                </th>
                <th scope="col">Муниципальное образование</th>
                <th scope="col">Регион</th>
                <th scope="col" class="fields-th-responsible" :aria-sort="fieldsAriaSort('responsible')">
                  <button
                    type="button"
                    class="fields-th-sort-btn"
                    aria-label="Сортировать по ответственному"
                    @click.stop="toggleFieldsSort('responsible')"
                  >
                    Ответственный
                    <span v-if="fieldsSortMark('responsible')" class="fields-th-sort-mark">{{ fieldsSortMark('responsible') }}</span>
                  </button>
                </th>
                <th scope="col" class="fields-th-actions">Действия</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="f in paginatedFields"
                :key="f.id"
                class="fields-tr fields-list-row"
                @click="goToFieldDetails(f.id)"
              >
                <td class="fields-td-name fields-list-title-main">{{ f.name || '—' }}</td>
                <td class="fields-td-cadastral">{{ f.cadastralNumber || '—' }}</td>
                <td class="fields-td-efis">{{ f.efisZsnNumber || '—' }}</td>
                <td class="fields-td-area">{{ f.area }}</td>
                <td class="fields-td-crop">
                  <span :class="cropPillClass(f)">{{ f.cropName }}</span>
                </td>
                <td class="fields-td-land">{{ f.landType }}</td>
                <td class="fields-td-location">
                  <div class="fields-location-text" :title="f.locationDescription">{{ f.locationDescription || '—' }}</div>
                </td>
                <td>{{ f.municipality || '—' }}</td>
                <td>{{ f.region || '—' }}</td>
                <td class="fields-td-responsible" @click.stop>
                  <select
                    :value="f.responsibleId || ''"
                    class="fields-responsible-select"
                    @change="onResponsibleChange(f.id, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">Не назначен</option>
                    <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.display_name || p.email }}</option>
                  </select>
                </td>
                <td class="fields-td-actions" @click.stop>
                  <div class="fields-actions-row">
                    <a
                      v-if="f.schemeFileUrl"
                      :href="f.schemeFileUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="fields-action-btn"
                      aria-label="Открыть схему"
                      title="Открыть схему"
                      @click.stop
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    </a>
                    <span v-else class="fields-action-btn fields-action-btn--disabled" title="Нет схемы" aria-label="Нет схемы">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    </span>
                    <button type="button" class="fields-action-btn" aria-label="Редактировать" title="Редактировать" @click="openEditField(f)">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                    </button>
                    <UiDeleteButton size="sm" @click="openDeleteConfirm(f)" />
                  </div>
                </td>
              </tr>
              <tr v-if="!paginatedFields.length">
                <td colspan="9" class="fields-empty">Нет полей. Добавьте поле с помощью кнопки выше.</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
      </div>

      <div
        v-show="activeTab === 'fields' && totalFiltered > 0"
        class="fields-pagination"
      >
        <p class="fields-pagination-info">
          Показано
          <span class="fields-pagination-num">
            {{ totalFiltered ? (currentPage - 1) * pageSize + 1 : 0 }}
          </span>
          –
          <span class="fields-pagination-num">
            {{ totalFiltered ? Math.min(currentPage * pageSize, totalFiltered) : 0 }}
          </span>
          из
          <span class="fields-pagination-num">
            {{ totalFiltered }}
          </span>
        </p>
        <div class="fields-pagination-right">
          <nav class="fields-pagination-nav" aria-label="Пагинация">
            <button
              type="button"
              class="fields-page-btn fields-page-btn--edge"
              :disabled="currentPage <= 1"
              aria-label="Предыдущая страница"
              @click="setPage(currentPage - 1)"
            >
              &lt;
            </button>
            <template v-for="(p, i) in paginationPages" :key="p === '...' ? `ellipsis-${i}` : p">
              <button
                v-if="p !== '...'"
                type="button"
                class="fields-page-btn"
                :class="{ 'fields-page-btn--active': p === currentPage }"
                @click="setPage(p as number)"
              >
                {{ p }}
              </button>
              <span v-else class="fields-page-ellipsis">…</span>
            </template>
            <button
              type="button"
              class="fields-page-btn fields-page-btn--edge"
              :disabled="currentPage >= totalPages"
              aria-label="Следующая страница"
              @click="setPage(currentPage + 1)"
            >
              &gt;
            </button>
          </nav>
          <label class="fields-pagination-size">
            <span class="fields-pagination-size-label">На странице</span>
            <select
              v-model.number="pageSize"
              class="fields-pagination-select"
              @change="onPageSizeChange"
            >
              <option :value="5">5</option>
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
            </select>
          </label>
        </div>
      </div>

      <div v-show="activeTab === 'downtime-reasons'" class="fields-tab-panel">
        <div v-if="isSupabaseConfigured()" class="refs-card card">
          <h2 class="refs-title">Причины простоя</h2>
          <p class="refs-desc">Подставляются на экране «Экран оператора» при нажатии «Начать простой». Кто добавил — записывается в базу.</p>
          <div v-if="refsError" class="refs-error">{{ refsError }}</div>
          <div class="refs-block">
            <div class="refs-add-row">
              <input v-model="newReasonLabel" type="text" placeholder="Название (например: Поломка гидравлики)" class="refs-input" />
              <input v-model="newReasonDesc" type="text" placeholder="Описание (необязательно)" class="refs-input refs-input--wide" />
              <select v-model="newReasonCategory" class="refs-select">
                <option v-for="(label, key) in CATEGORY_LABELS" :key="key" :value="key">{{ label }}</option>
              </select>
              <button type="button" class="refs-btn" :disabled="refsLoading || !newReasonLabel.trim()" @click="addReason">Добавить</button>
            </div>
            <div class="refs-table-wrap">
              <table class="refs-table">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Описание</th>
                    <th>Категория</th>
                    <th>Кто добавил</th>
                    <th>Когда</th>
                    <th class="refs-th-actions">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in paginatedReasons" :key="r.id">
                    <td>{{ r.label }}</td>
                    <td class="refs-cell-muted">{{ r.description || '—' }}</td>
                    <td>{{ CATEGORY_LABELS[r.category] }}</td>
                    <td class="refs-cell-muted">{{ r.created_by || '—' }}</td>
                    <td class="refs-cell-muted">{{ formatRefDate(r.created_at) }}</td>
                    <td class="refs-cell-actions">
                      <UiDeleteButton size="sm" :disabled="refsLoading" @click="openDeleteReasonConfirm(r)" />
                    </td>
                  </tr>
                  <tr v-if="!downtimeReasons.length && !refsLoading">
                    <td colspan="6" class="refs-empty">Пока нет записей. Добавьте причину выше.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="downtimeReasons.length > 0" class="refs-pagination">
              <div class="refs-pagination-left">
                <p class="refs-pagination-info">
                  Показано от <span class="refs-pagination-num">{{ (refsPageReasons - 1) * refsPageSize + 1 }}</span> до <span class="refs-pagination-num">{{ Math.min(refsPageReasons * refsPageSize, downtimeReasons.length) }}</span> из <span class="refs-pagination-num">{{ downtimeReasons.length }}</span>
                </p>
                <label class="refs-pagination-size">
                  Строк на странице:
                  <select v-model.number="refsPageSize" class="refs-pagination-select" @change="onRefsPageSizeChange">
                    <option v-for="n in REFS_PAGE_SIZE_OPTIONS" :key="n" :value="n">{{ n }}</option>
                  </select>
                </label>
              </div>
              <nav class="refs-pagination-nav" aria-label="Пагинация">
                <button type="button" class="refs-page-btn refs-page-btn--edge" :disabled="refsPageReasons <= 1" aria-label="Предыдущая страница" @click="setRefsPageReasons(refsPageReasons - 1)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                <template v-for="(p, i) in refsPaginationPages(totalPagesReasons, refsPageReasons)" :key="p === '...' ? `reasons-ellipsis-${i}` : p">
                  <button v-if="p !== '...'" type="button" class="refs-page-btn" :class="{ 'refs-page-btn--active': p === refsPageReasons }" @click="setRefsPageReasons(p as number)">{{ p }}</button>
                  <span v-else class="refs-page-ellipsis">…</span>
                </template>
                <button type="button" class="refs-page-btn refs-page-btn--edge" :disabled="refsPageReasons >= totalPagesReasons" aria-label="Следующая страница" @click="setRefsPageReasons(refsPageReasons + 1)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </nav>
            </div>
          </div>
        </div>
        <p v-else class="refs-no-supabase">Подключите Supabase для управления справочниками.</p>
      </div>

      <div v-show="activeTab === 'work-operations'" class="fields-tab-panel">
        <div v-if="isSupabaseConfigured()" class="refs-card card">
          <h2 class="refs-title">Операции для работы</h2>
          <p class="refs-desc">Подставляются на экране «Экран оператора» при нажатии «Начать операцию». Кто добавил — записывается в базу.</p>
          <div v-if="refsError" class="refs-error">{{ refsError }}</div>
          <div class="refs-block">
            <div class="refs-add-row">
              <input v-model="newOperationName" type="text" placeholder="Название (например: Пахота, Посев)" class="refs-input refs-input--wide" />
              <button type="button" class="refs-btn" :disabled="refsLoading || !newOperationName.trim()" @click="addOperation">Добавить</button>
            </div>
            <div class="refs-table-wrap">
              <table class="refs-table">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Кто добавил</th>
                    <th>Когда</th>
                    <th class="refs-th-actions">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="op in paginatedOperations" :key="op.id">
                    <td>{{ op.name }}</td>
                    <td class="refs-cell-muted">{{ op.created_by || '—' }}</td>
                    <td class="refs-cell-muted">{{ formatRefDate(op.created_at) }}</td>
                    <td class="refs-cell-actions">
                      <UiDeleteButton size="sm" :disabled="refsLoading" @click="openDeleteOperationConfirm(op)" />
                    </td>
                  </tr>
                  <tr v-if="!workOperations.length && !refsLoading">
                    <td colspan="4" class="refs-empty">Пока нет записей. Добавьте операцию выше.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="workOperations.length > 0" class="refs-pagination">
              <div class="refs-pagination-left">
                <p class="refs-pagination-info">
                  Показано от <span class="refs-pagination-num">{{ (refsPageOperations - 1) * refsPageSize + 1 }}</span> до <span class="refs-pagination-num">{{ Math.min(refsPageOperations * refsPageSize, workOperations.length) }}</span> из <span class="refs-pagination-num">{{ workOperations.length }}</span>
                </p>
                <label class="refs-pagination-size">
                  Строк на странице:
                  <select v-model.number="refsPageSize" class="refs-pagination-select" @change="onRefsPageSizeChange">
                    <option v-for="n in REFS_PAGE_SIZE_OPTIONS" :key="n" :value="n">{{ n }}</option>
                  </select>
                </label>
              </div>
              <nav class="refs-pagination-nav" aria-label="Пагинация">
                <button type="button" class="refs-page-btn refs-page-btn--edge" :disabled="refsPageOperations <= 1" aria-label="Предыдущая страница" @click="setRefsPageOperations(refsPageOperations - 1)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                <template v-for="(p, i) in refsPaginationPages(totalPagesOperations, refsPageOperations)" :key="p === '...' ? `ops-ellipsis-${i}` : p">
                  <button v-if="p !== '...'" type="button" class="refs-page-btn" :class="{ 'refs-page-btn--active': p === refsPageOperations }" @click="setRefsPageOperations(p as number)">{{ p }}</button>
                  <span v-else class="refs-page-ellipsis">…</span>
                </template>
                <button type="button" class="refs-page-btn refs-page-btn--edge" :disabled="refsPageOperations >= totalPagesOperations" aria-label="Следующая страница" @click="setRefsPageOperations(refsPageOperations + 1)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </nav>
            </div>
          </div>
        </div>
        <p v-else class="refs-no-supabase">Подключите Supabase для управления справочниками.</p>
      </div>

      <div
        v-if="isFieldModalOpen"
        class="modal-backdrop"
        @click="closeFieldModal"
      >
        <div class="modal modal-fields modal-fields--add" :class="{ 'modal-fields--wide': isFieldModalWide }" @click.stop>
          <header class="modal-header modal-header--fields">
            <h2 class="modal-title modal-title--fields">
              {{ fieldModalTitle }}
            </h2>
            <div class="modal-header-actions">
              <button
                type="button"
                class="modal-expand-btn"
                :class="{ 'modal-expand-btn--active': isFieldModalWide }"
                :aria-label="isFieldModalWide ? 'Свернуть окно' : 'Расширить окно'"
                :title="isFieldModalWide ? 'Свернуть окно' : 'Расширить окно'"
                @click="toggleFieldModalWidth"
              >
                <svg class="modal-expand-btn-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 3H3v6" />
                  <path d="M15 3h6v6" />
                  <path d="M3 15v6h6" />
                  <path d="M21 15v6h-6" />
                </svg>
              </button>
              <ModalCloseButton @click="closeFieldModal" />
            </div>
          </header>
          <div v-if="fieldFormError" class="modal-error">{{ fieldFormError }}</div>
          <div class="modal-form modal-form--add">
            <div class="modal-form-section">
              <label class="modal-field modal-field--full">
                <span class="modal-label">Название поля <span class="modal-label-required">*</span></span>
                <input
                  v-model="newFieldName"
                  type="text"
                  class="modal-input"
                  placeholder="Например: Поле №12 – Пшеница"
                />
              </label>
            </div>
            <div class="modal-form-section modal-form-section--grid">
              <label class="modal-field">
                <span class="modal-label">Кадастровый номер <span class="modal-label-opt">(опц.)</span></span>
                <input v-model="newFieldCadastral" type="text" class="modal-input" placeholder="XX:XX:XXXXXXX:XX" />
              </label>
              <label class="modal-field">
                <span class="modal-label">№ ПОЛЯ ЕФИС ЗСН <span class="modal-label-opt">(опц.)</span></span>
                <input v-model="newFieldEfisZsn" type="text" class="modal-input" placeholder="Например: EFIS-000123" />
              </label>
            </div>
            <div class="modal-form-section modal-form-section--grid">
              <label class="modal-field">
                <span class="modal-label">Площадь, га <span class="modal-label-required">*</span></span>
                <div class="modal-input-wrap modal-input-wrap--suffix">
                  <input
                    v-model.number="newFieldArea"
                    type="number"
                    min="0"
                    step="0.01"
                    class="modal-input"
                    placeholder="0.00"
                    @input="onFieldAreaManualInput"
                  />
                  <span class="modal-input-suffix">га</span>
                </div>
                <span v-if="newFieldGeometryMode === 'polygon' && newFieldAreaAuto != null" class="field-geometry-area-hint">
                  Авто по контуру: {{ newFieldAreaAuto }} га
                </span>
              </label>
            </div>
            <div class="modal-form-section">
              <label class="modal-field modal-field--full">
                <span class="modal-label">Адрес <span class="modal-label-opt">(опц.)</span></span>
                <input
                  v-model="newFieldAddress"
                  type="text"
                  class="modal-input"
                  placeholder="Например: Московская обл., Раменский р-н, д. Вялки"
                  @input="onFieldAddressInput"
                />
                <div v-if="newFieldAddressCandidates.length" class="field-address-candidates">
                  <span class="field-address-candidates-label">Варианты адреса по контуру</span>
                  <select v-model="selectedAddressCandidate" class="modal-select field-address-candidates-select" @change="onAddressCandidateChange">
                    <option v-for="addr in newFieldAddressCandidates" :key="addr" :value="addr">{{ addr }}</option>
                  </select>
                </div>
                <p v-if="fieldMapAddressCandidatesLoading" class="field-map-picker-status">Подбираем адреса по контуру...</p>
              </label>
            </div>
            <div class="modal-form-section">
              <div class="modal-field modal-field--full">
                <span class="modal-label">Карта участка</span>
                <label class="modal-field modal-field--full field-map-land-select">
                  <span class="modal-label">Земельный участок (контур для ориентира)</span>
                  <select v-model="newFieldLandId" class="modal-select">
                    <option value="">— Выберите участок, чтобы показать контур —</option>
                    <option v-for="land in lands" :key="land.id" :value="land.id">
                      {{ land.cadastral_number || `Участок №${land.number}` }}{{ land.address ? ` — ${land.address}` : '' }}
                    </option>
                  </select>
                </label>
                <div class="field-geometry-head">
                  <span class="modal-label">Режим геометрии</span>
                  <div class="field-geometry-switch" role="group" aria-label="Режим геометрии поля">
                    <button
                      type="button"
                      class="field-geometry-switch-btn"
                      :class="{ 'field-geometry-switch-btn--active': newFieldGeometryMode === 'point' }"
                      @click="setFieldGeometryMode('point')"
                    >
                      Точка
                    </button>
                    <button
                      type="button"
                      class="field-geometry-switch-btn"
                      :class="{ 'field-geometry-switch-btn--active': newFieldGeometryMode === 'polygon' }"
                      @click="setFieldGeometryMode('polygon')"
                    >
                      Контур
                    </button>
                  </div>
                </div>
                <div class="field-map-picker-wrap">
                  <YandexMap
                    :key="`${editingFieldId ?? 'new-field'}-${isFieldModalWide ? 'wide' : 'normal'}`"
                    :lat="fieldMapCenter.lat"
                    :lon="fieldMapCenter.lon"
                    :zoom="12"
                    :geometry-mode="newFieldGeometryMode"
                    :polygon-points="fieldMapPolygonPoints"
                    :field-markers="selectedLandContourMarkers"
                    :fit-field-markers="selectedLandContourMarkers.length > 0"
                    :overlay-hint="selectedLandContourMarkers.length > 0"
                    @pick="onPickFieldMap"
                    @polygonChange="onFieldMapPolygonChange"
                  />
                </div>
                <p v-if="!newFieldLandId" class="field-map-picker-note field-map-picker-note--warn">
                  Выберите земельный участок выше, чтобы на карте отобразился его контур.
                </p>
                <p class="field-map-picker-note">
                  <template v-if="newFieldGeometryMode === 'polygon'">
                    Постройте контур поля на карте. Площадь считается автоматически, но ее можно скорректировать вручную.
                  </template>
                  <template v-else>
                    Нажмите на карту, чтобы автоматически заполнить геолокацию и адрес.
                  </template>
                </p>
                <p v-if="fieldMapAddressLoading" class="field-map-picker-status">Определяем адрес по координатам...</p>
                <p v-else-if="fieldMapAddressError" class="field-map-picker-status field-map-picker-status--error">{{ fieldMapAddressError }}</p>
              </div>
            </div>
            <div class="modal-form-section modal-form-section--grid modal-form-section--grid-4">
              <label class="modal-field">
                <span class="modal-label modal-label--with-help">
                  Тип земли
                  <RefFieldHelp
                    text="Не хватает типа земли? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'land-refs' } }"
                    link-label="Справочники земель"
                  />
                </span>
                <select v-model="newFieldLandType" class="modal-select">
                  <option v-for="t in landTypeOptions" :key="t.name" :value="t.name">{{ t.name }}</option>
                </select>
              </label>
              <label class="modal-field">
                <span class="modal-label modal-label--with-help">
                  Культура
                  <RefFieldHelp
                    text="Нет нужной культуры? Добавьте ее в"
                    :to="{ path: '/lands', query: { tab: 'crops-refs' } }"
                    link-label="Справочники СХ культур"
                  />
                </span>
                <select v-model="newFieldCropKey" class="modal-select">
                  <option v-for="opt in cropOptions" :key="opt.key" :value="opt.key">{{ opt.label }}</option>
                </select>
              </label>
              <label class="modal-field">
                <span class="modal-label">Год посева</span>
                <input v-model.number="newFieldSowingYear" type="number" class="modal-input" min="2000" :max="new Date().getFullYear() + 2" />
              </label>
              <label class="modal-field">
                <span class="modal-label">Ответственный</span>
                <select v-model="newFieldResponsibleId" class="modal-select">
                  <option value="">Не назначен</option>
                  <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.display_name || p.email }}</option>
                </select>
              </label>
              <label class="modal-field">
                <span class="modal-label modal-label--with-help">
                  Муниципальное образование
                  <RefFieldHelp
                    text="Нет нужного муниципального образования? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'field-refs' } }"
                    link-label="Справочники полей"
                  />
                </span>
                <select v-model="newFieldMunicipality" class="modal-select">
                  <option value="">—</option>
                  <option v-for="row in fieldMunicipalityRefs" :key="row.id" :value="row.name">{{ row.name }}</option>
                </select>
              </label>
              <label class="modal-field">
                <span class="modal-label">Регион</span>
                <input v-model="newFieldRegion" type="text" class="modal-input" placeholder="Например: Ростовская область" />
              </label>
            </div>
            <div class="modal-form-section">
              <label class="modal-field modal-field--full">
                <span class="modal-label">Описание местоположения</span>
                <textarea
                  v-model="newFieldLocationDesc"
                  class="modal-textarea"
                  rows="3"
                  placeholder="Опишите границы текстом (например: От дороги до ручья, прямоугольник 500×200 м...)"
                />
              </label>
            </div>
            <div class="modal-form-section modal-form-section--grid">
              <label class="modal-field">
                <span class="modal-label">Геолокация <span class="modal-label-opt">(опц.)</span></span>
                <input
                  v-model="newFieldGeo"
                  type="text"
                  class="modal-input"
                  placeholder="Например: 55.7558, 37.6173"
                />
              </label>
              <label class="modal-field modal-field--full">
                <span class="modal-label">Доп. информация <span class="modal-label-opt">(опц.)</span></span>
                <textarea
                  v-model="newFieldExtra"
                  class="modal-textarea"
                  rows="3"
                  placeholder="Любые дополнительные заметки о поле"
                />
              </label>
            </div>
            <div class="modal-form-section">
              <div class="modal-field modal-field--full">
                <span class="modal-label">Прикрепить схему/план <span class="modal-label-opt">(опц.)</span></span>
                <input
                  id="field-scheme-file-input"
                  ref="schemeFileInputRef"
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  class="modal-file-input-hidden"
                  aria-hidden="true"
                  @change="onSchemeFileSelect"
                />
                <label
                  for="field-scheme-file-input"
                  class="modal-dropzone-label"
                  :class="{ 'modal-dropzone--loading': schemeUploading }"
                  @dragover.prevent="onSchemeDragOver"
                  @dragleave.prevent="onSchemeDragLeave"
                  @drop.prevent="onSchemeDrop"
                >
                  <template v-if="schemeUploading">
                    <span class="modal-dropzone-loading-inner">
                      <UiLoadingBar size="compact" />
                    </span>
                  </template>
                  <template v-else-if="newFieldSchemeFileName">
                    <div class="modal-scheme-preview-wrap">
                      <img
                        v-if="isSchemeImage && schemePreviewUrl"
                        :src="schemePreviewUrl"
                        class="modal-scheme-preview-img"
                        alt="Превью схемы"
                        @error="($event.target as HTMLImageElement).style.display = 'none'"
                      />
                      <div v-else class="modal-scheme-preview-pdf">
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                        <span>PDF</span>
                      </div>
                      <span class="modal-dropzone-filename">{{ newFieldSchemeFileName }}</span>
                      <UiDeleteButton size="xs" @click.prevent.stop="clearSchemeFile" />
                    </div>
                  </template>
                  <template v-else>
                    <svg class="modal-dropzone-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                    <span class="modal-dropzone-text">Загрузить файл</span> или перетащите сюда
                    <span class="modal-file-hint">JPG, PNG, PDF до 20 МБ</span>
                  </template>
                </label>
                <div v-if="schemeUploadError" class="modal-error modal-error--dropzone" role="alert">{{ schemeUploadError }}</div>
              </div>
            </div>
          </div>
          <div class="modal-actions modal-actions--fields">
            <button class="modal-btn-ghost" type="button" @click="closeFieldModal">Отмена</button>
            <button class="modal-btn" type="button" @click="addField">{{ editingFieldId ? 'Сохранить' : 'Сохранить поле' }}</button>
          </div>
          </div>
        </div>
      <div
        v-if="deleteConfirmFieldId"
        class="fields-confirm-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fields-delete-confirm-title"
        @click.self="closeDeleteConfirm"
      >
        <div class="fields-confirm-modal">
          <h2 id="fields-delete-confirm-title" class="fields-confirm-title">Удаление поля</h2>
          <p class="fields-confirm-text">
            <template v-if="fieldToDelete">Вы уверены, что хотите удалить поле «{{ fieldToDelete.name }}»?</template>
            <template v-else>Вы уверены, что хотите удалить это поле?</template>
          </p>
          <div class="fields-confirm-actions">
            <button type="button" class="modal-btn-ghost" @click="closeDeleteConfirm">Отмена</button>
            <UiDeleteButton size="md" @click="confirmDelete" />
          </div>
        </div>
      </div>

      <div
        v-if="deleteConfirmReasonId"
        class="fields-confirm-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="refs-delete-reason-title"
        @click.self="closeDeleteReasonConfirm"
      >
        <div class="fields-confirm-modal">
          <h2 id="refs-delete-reason-title" class="fields-confirm-title">Удаление причины простоя</h2>
          <p class="fields-confirm-text">
            <template v-if="reasonToDelete">Вы уверены, что хотите удалить причину «{{ reasonToDelete.label }}»?</template>
            <template v-else>Вы уверены, что хотите удалить эту причину простоя?</template>
          </p>
          <div class="fields-confirm-actions">
            <button type="button" class="modal-btn-ghost" @click="closeDeleteReasonConfirm">Отмена</button>
            <UiDeleteButton size="md" @click="confirmDeleteReason" />
          </div>
        </div>
      </div>

      <div
        v-if="deleteConfirmOperationId"
        class="fields-confirm-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="refs-delete-operation-title"
        @click.self="closeDeleteOperationConfirm"
      >
        <div class="fields-confirm-modal">
          <h2 id="refs-delete-operation-title" class="fields-confirm-title">Удаление операции</h2>
          <p class="fields-confirm-text">
            <template v-if="operationToDelete">Вы уверены, что хотите удалить операцию «{{ operationToDelete.name }}»?</template>
            <template v-else>Вы уверены, что хотите удалить эту операцию?</template>
          </p>
          <div class="fields-confirm-actions">
            <button type="button" class="modal-btn-ghost" @click="closeDeleteOperationConfirm">Отмена</button>
            <UiDeleteButton size="md" @click="confirmDeleteOperation" />
          </div>
        </div>
      </div>

    </div>

    <UiSuccessModal
      :open="successModalOpen"
      :title="successModalTitle"
      :message="successModalMessage"
      button-text="Понятно"
      @close="successModalOpen = false"
    />
  </section>
</template>

<style scoped>
/* ——— Макет по design-1adafb22 (Управление полями) ——— */
.fields-page {
  padding: 0;
}
.fields-page-inner {
  width: 100%;
}
.fields-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}
.fields-header-text {
  flex: 1;
  min-width: 0;
}
.fields-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.3;
}
.fields-subtitle {
  margin: 4px 0 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.4;
}
.fields-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: var(--space-lg);
  border-bottom: 1px solid var(--border-color);
}
.fields-tab {
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
  transition:
    color 0.26s ease,
    border-color 0.26s ease,
    background 0.26s ease,
    transform 0.22s ease,
    box-shadow 0.26s ease;
}
.fields-tab:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-green) 2.5%, transparent);
  transform: translateY(-1px);
}
.fields-tab--active {
  color: var(--accent-green);
  border-bottom-color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 4%, transparent);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--accent-green) 8%, transparent);
  animation: fields-tab-pill-in 0.28s ease;
}
.fields-tab-panel {
  min-height: 200px;
  animation: fields-tab-panel-in 0.3s ease;
}

@keyframes fields-tab-pill-in {
  0% {
    transform: scale(0.94);
    opacity: 0.85;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes fields-tab-panel-in {
  0% {
    opacity: 0;
    transform: translateY(8px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
.refs-no-supabase {
  padding: var(--space-xl);
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.9375rem;
}
.fields-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  background: var(--accent-green);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.22s ease,
    box-shadow 0.22s ease,
    transform 0.22s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
.fields-add-btn--highlight {
  position: relative;
  z-index: 1;
  animation: fields-add-pulse 1.2s ease-out 0s 1;
}
@keyframes fields-add-pulse {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.75);
  }
  70% {
    transform: scale(1.03);
    box-shadow: 0 0 0 18px rgba(34, 197, 94, 0);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
  }
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

.fields-add-btn:hover .fields-add-btn-icon {
  transform: rotate(52deg) scale(1.18);
}
.fields-card {
  background: var(--bg-panel);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  margin-bottom: var(--space-xl);
}
.fields-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.fields-search-wrap {
  position: relative;
  flex: 1;
  min-width: 200px;
  max-width: 28rem;
}
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
  padding: 8px 12px 8px 40px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  transition: border-color 0.2s ease, outline 0.2s ease;
}
.fields-search-input::placeholder {
  color: var(--text-secondary);
}
.fields-search-input:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px var(--accent-green);
}
.fields-toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
}
.fields-export-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: #fafafa;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
.fields-export-btn:hover:not(:disabled) {
  background: var(--bg-panel-hover);
  border-color: var(--accent-green);
  color: var(--accent-green);
}
.fields-export-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
[data-theme='dark'] .fields-export-btn {
  background: rgba(255, 255, 255, 0.06);
}
.task-header-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.task-btn-export.action_has {
  --color: 220 9% 46%;
  --color-has: 146 33% 30%;
}
[data-theme='dark'] .task-btn-export.action_has {
  --color: 215 14% 55%;
  --color-has: 97 55% 52%;
}
.task-btn-export.has_saved:hover:not(:disabled) {
  border-color: hsl(var(--color-has));
}
.task-btn-export.has_saved:hover:not(:disabled) svg {
  color: hsl(var(--color-has));
}
.task-btn-export.has_saved svg {
  overflow: visible;
  transform-origin: center;
  color: hsl(var(--color));
  transition: transform 0.22s ease;
}
.task-btn-export.has_saved:hover:not(:disabled) svg {
  animation: equipment-export-file-hover 0.65s ease;
}
@keyframes equipment-export-file-hover {
  0% { transform: translateY(0) scale(1) rotate(0deg); }
  35% { transform: translateY(-2px) scale(1.11) rotate(-8deg); }
  70% { transform: translateY(-1px) scale(1.06) rotate(6deg); }
  100% { transform: translateY(0) scale(1) rotate(0deg); }
}
.fields-table-wrap {
  overflow-x: auto;
  padding-bottom: 52px;
}
.fields-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.fields-table thead {
  background: rgba(0, 0, 0, 0.02);
}
.fields-table th,
.fields-table td {
  padding: 14px 24px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
  text-align: left;
}
.fields-table th {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.fields-th-sort-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 6px;
  margin: -4px -6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: inherit;
  white-space: nowrap;
  text-align: inherit;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.fields-th-sort-btn:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-green) 8%, transparent);
}

.fields-th-sort-btn:focus-visible {
  outline: 2px solid var(--accent-green);
  outline-offset: 2px;
}

.fields-th-sort-btn--end {
  width: 100%;
  justify-content: flex-end;
}

.fields-th-sort-mark {
  flex-shrink: 0;
  font-size: 0.92em;
  font-weight: 800;
  color: var(--accent-green);
  line-height: 1;
}
.fields-th-name,
.fields-td-name { min-width: 220px; }
.fields-td-name { font-weight: 600; color: var(--text-primary); }
.fields-th-cadastral,
.fields-td-cadastral { min-width: 190px; }
.fields-td-cadastral { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.fields-th-efis,
.fields-td-efis { min-width: 170px; }
.fields-td-efis { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.fields-th-area,
.fields-td-area { width: 100px; min-width: 100px; text-align: right; }
.fields-td-area { font-variant-numeric: tabular-nums; font-weight: 500; color: var(--text-primary); }
.fields-th-crop,
.fields-td-crop { min-width: 180px; }
.fields-th-land,
.fields-td-land { min-width: 100px; color: var(--text-secondary); font-size: 0.875rem; }
.fields-th-location,
.fields-td-location { min-width: 250px; }
.fields-th-responsible,
.fields-td-responsible { min-width: 140px; }
.fields-responsible-select {
  width: 100%;
  min-width: 120px;
  padding: 6px 28px 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}
.fields-responsible-select:hover {
  border-color: var(--accent-green);
}
.fields-responsible-select:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px var(--accent-green);
}
.fields-th-actions,
.fields-td-actions {
  width: 168px;
  min-width: 168px;
  text-align: right;
  overflow: visible;
  vertical-align: middle;
}
.fields-table tbody tr:last-child td {
  border-bottom: none;
}

.fields-list-row {
  cursor: pointer;
  transition:
    background-color 0.22s ease,
    box-shadow 0.22s ease;
}

.fields-table tbody tr.fields-list-row:hover {
  background-color: color-mix(in srgb, var(--accent-green) 9%, var(--bg-panel));
  box-shadow: inset 3px 0 0 var(--accent-green);
}

.fields-table tbody tr.fields-list-row:hover .fields-list-title-main {
  color: var(--accent-green);
}

.fields-list-title-main {
  transition: color 0.22s ease;
}

@media (prefers-reduced-motion: reduce) {
  .fields-list-row {
    transition: background-color 0.15s ease, box-shadow 0.15s ease;
  }

  .fields-table tbody tr.fields-list-row:hover .fields-list-title-main {
    transition: none;
  }
}

[data-theme='dark'] .fields-table tbody tr.fields-list-row:hover {
  background-color: color-mix(in srgb, var(--accent-green) 16%, var(--bg-elevated));
  box-shadow: inset 3px 0 0 var(--accent-green);
}

[data-theme='dark'] .fields-table tbody tr.fields-list-row:hover .fields-list-title-main {
  color: color-mix(in srgb, #fff 75%, var(--accent-green));
}

.fields-tr {
  cursor: pointer;
}
.fields-actions-row {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex-wrap: nowrap;
}
.filter-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.chip {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}
.chip:hover {
  border-color: var(--accent-green);
  color: var(--text-primary);
}
.chip-active {
  background: var(--accent-green);
  border-color: var(--accent-green);
  color: #000;
}
.search-input input {
  width: 260px;
  max-width: 100%;
  padding: 8px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
  font-size: 0.85rem;
}
.search-input input::placeholder {
  color: var(--text-secondary);
}
.search-input input:focus-visible {
  outline: 1px solid var(--accent-green);
  outline-offset: 2px;
}

/* Пилюли культуры — по макету (amber, yellow, green, gray) */
.fields-crop-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  border: 1px solid;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
  vertical-align: middle;
}
.fields-crop-pill--wheat {
  background: #fffbeb;
  color: #b45309;
  border-color: #fcd34d;
}
.fields-crop-pill--sunflower {
  background: #fefce8;
  color: #a16207;
  border-color: #fde047;
}
.fields-crop-pill--soy {
  background: #f0fdf4;
  color: #166534;
  border-color: #bbf7d0;
}
.fields-crop-pill--grey {
  background: #f3f4f6;
  color: #374151;
  border-color: #e5e7eb;
}
.fields-crop-pill--meadow {
  background: #f0fdf4;
  color: var(--accent-green);
  border-color: #bbf7d0;
}
.fields-td-location {
  max-width: 280px;
}
.fields-location-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  color: var(--text-secondary);
}
.fields-responsible-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.fields-responsible-wrap--empty {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px dashed var(--border-color);
  color: var(--text-secondary);
  font-style: italic;
  min-width: 100px;
}
.fields-responsible-wrap--empty .fields-responsible-text {
  color: var(--text-secondary);
}
.fields-responsible-text {
  color: var(--accent-green);
  font-weight: 500;
}
.fields-responsible-arrow {
  flex-shrink: 0;
  color: var(--text-secondary);
  opacity: 0.8;
}
.fields-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-md);
  padding: var(--space-md) var(--space-lg) 0;
  border-top: 1px solid var(--border-color);
  min-height: 40px;
}
.fields-pagination-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
}
.fields-pagination-num {
  font-weight: 500;
}
.fields-pagination-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.fields-pagination-right {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  flex-wrap: wrap;
}
.fields-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.fields-page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.fields-page-btn--edge {
  width: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
}
.fields-page-btn--active {
  background: rgba(76, 175, 80, 0.15);
  border-color: rgba(76, 175, 80, 0.5);
  color: var(--text-primary);
}
.fields-page-ellipsis {
  padding: 0 10px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.fields-pagination-size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.fields-pagination-size-label {
  white-space: nowrap;
}

.fields-pagination-select {
  height: 36px;
  min-width: 72px;
  padding: 0 28px 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}

/* Кнопки действий — в один ряд, один размер */
.fields-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  color: var(--text-secondary);
  transition: background 0.2s ease, color 0.2s ease;
  flex-shrink: 0;
  text-decoration: none;
}

.fields-action-btn svg {
  transform-origin: center;
  transition: transform 0.24s ease;
}

.fields-action-btn--disabled {
  cursor: default;
  opacity: 0.45;
  pointer-events: none;
}
.fields-action-btn:hover {
  background: var(--bg-panel-hover);
  color: var(--text-primary);
}
.fields-action-btn:hover svg {
  transform: rotate(16deg) scale(1.08);
}
.fields-action-btn:first-child:hover {
  color: #2563eb;
  background: #eff6ff;
}
.fields-action-btn:nth-child(2):hover {
  color: var(--accent-green);
  background: var(--nav-active-bg);
}
.fields-load-error {
  padding: var(--space-md) 24px;
  color: var(--danger-red);
  font-size: 0.875rem;
  margin: 0;
}
.fields-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg) 24px;
}
.modal-dropzone-loading-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 12px 0;
}
.fields-empty {
  color: var(--text-secondary);
  font-style: italic;
  padding: var(--space-xl);
  text-align: center;
}
.fields-page-btn:hover:not(:disabled):not(.fields-page-btn--active) {
  background: var(--bg-panel-hover);
}

.fields-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.7fr);
  gap: var(--space-xl);
  align-items: flex-start;
}

.map-container {
  position: relative;
  height: 400px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border-color);
  overflow: hidden;
}

.map-svg {
  width: 100%;
  height: 100%;
  opacity: 0.85;
}

.field-polygon {
  stroke: #ffffff;
  stroke-width: 1.2;
  stroke-opacity: 0.6;
  cursor: pointer;
  transition:
    fill-opacity 0.2s ease,
    stroke-width 0.2s ease,
    stroke-opacity 0.2s ease,
    opacity 0.2s ease;
}

.field-polygon[data-field-id='field-5'] {
  fill: var(--wheat-gold);
  fill-opacity: 0.45;
}

.field-polygon[data-field-id='field-12'] {
  fill: var(--corn-yellow);
  fill-opacity: 0.45;
}

.field-polygon[data-field-id='field-3'] {
  fill: var(--soy-green);
  fill-opacity: 0.45;
}

.field-polygon[data-field-id='field-8'] {
  fill: var(--accent-green);
  fill-opacity: 0.45;
}

.field-polygon[data-field-id='field-21'] {
  fill: var(--accent-green);
  fill-opacity: 0.3;
}

.field-polygon:hover {
  fill-opacity: 0.7;
  stroke-width: 1.6;
}

.field-polygon.is-active {
  stroke-width: 2;
  stroke-opacity: 1;
}

.field-polygon.is-dimmed {
  opacity: 0.25;
}

.field-polygon:focus-visible {
  outline: 2px solid var(--accent-green);
  outline-offset: 3px;
}

.map-overlay {
  position: absolute;
  top: 20px;
  right: 20px;
  background: var(--bg-panel);
  padding: var(--space-md);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(10px);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.color-wheat {
  background: var(--wheat-gold);
}

.color-corn {
  background: var(--corn-yellow);
}

.color-soy {
  background: var(--soy-green);
}

.color-sunflower {
  background: var(--accent-green);
}

.fields-panel {
  display: grid;
  grid-template-rows: minmax(0, 2.2fr) minmax(0, 1.4fr);
  gap: var(--space-md);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-md);
  overflow-y: auto;
  padding-right: 4px;
}

.field-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    transform 0.1s ease;
  cursor: pointer;
}

.field-card:hover {
  border-color: var(--accent-green);
  background: var(--bg-panel-hover);
  transform: translateY(-1px);
}

.field-card.is-active {
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-green) 40%, transparent);
}

.field-image {
  height: 120px;
  background-size: cover;
  background-position: center;
  position: relative;
}

.crop-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 4px 8px;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #000;
  border-radius: 2px;
  background: var(--accent-green);
}

.field-info {
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.field-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-md);
}

.progress-bar-container {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  width: 100%;
  margin-top: 4px;
}

.progress-bar {
  height: 100%;
  background: var(--accent-green);
}

.stats-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
}

.stats-row-secondary {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 8px;
  margin-top: 4px;
  font-size: 0.8rem;
}

.field-details {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.field-details-empty {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.field-details-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
}

.field-details-main {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-md);
}

.field-details-actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.btn {
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

.btn-primary {
  border-color: var(--accent-green);
  background: var(--accent-green);
  color: #000;
}

.btn-primary:hover {
  background: var(--accent-green-hover);
  border-color: var(--accent-green-hover);
}

.btn-ghost:hover {
  border-color: var(--accent-green);
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-secondary);
}

.pill-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-green);
}

.select-checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: rgba(0, 0, 0, 0.2);
  cursor: pointer;
}

.select-checkbox input {
  display: none;
}

.select-checkbox span {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: transparent;
  transition:
    background 0.2s ease,
    box-shadow 0.2s ease;
}

.select-checkbox input:checked + span {
  background: var(--accent-green);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
}

.field-details-aggregate {
  grid-column: 1 / -1;
  padding-top: var(--space-sm);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.field-polygon.is-selected-group {
  opacity: 1;
  stroke-width: 2;
}

.refs-section {
  margin-top: var(--space-xl);
}
.refs-card {
  padding: var(--space-lg);
}
.refs-title {
  margin: 0 0 8px;
  font-size: 1.15rem;
  font-weight: 600;
}
.refs-desc {
  margin: 0 0 var(--space-lg);
  font-size: 0.9rem;
  color: var(--text-secondary);
}
.refs-desc--small {
  margin-bottom: var(--space-md);
  font-size: 0.8125rem;
}
.refs-code {
  font-size: 0.875em;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--chip-bg);
  color: var(--text-primary);
}
.refs-error {
  margin-bottom: var(--space-md);
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(185, 84, 80, 0.15);
  color: var(--danger-red);
  font-size: 0.9rem;
}
.refs-block {
  margin-bottom: var(--space-xl);
}
.refs-block:last-child {
  margin-bottom: 0;
}
.refs-block-title {
  margin: 0 0 var(--space-md);
  font-size: 1rem;
  font-weight: 600;
}
.refs-add-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  align-items: center;
  margin-bottom: var(--space-md);
}
.refs-input {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 0.9rem;
  min-width: 160px;
}
.refs-input--wide {
  flex: 1;
  min-width: 200px;
}
.refs-select {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 0.9rem;
  background: var(--bg-panel);
  color: var(--text-primary);
}
.refs-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  background: var(--accent-green);
  color: #fff;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
}
.refs-btn:hover:not(:disabled) {
  background: var(--accent-green-hover);
}
.refs-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.refs-th-actions {
  width: 132px;
  min-width: 132px;
  text-align: right;
  overflow: visible;
  vertical-align: middle;
}
.refs-cell-actions {
  text-align: right;
  overflow: visible;
  vertical-align: middle;
}
.refs-table-wrap {
  overflow-x: auto;
  padding-bottom: 52px;
}
.refs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.refs-table th,
.refs-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
  overflow: visible;
}
.refs-table th {
  color: var(--text-secondary);
  font-weight: 500;
}
.refs-cell-muted {
  color: var(--text-secondary);
}
.refs-empty {
  color: var(--text-secondary);
  font-style: italic;
}
.refs-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md) 0 0;
  margin-top: var(--space-md);
  border-top: 1px solid var(--border-color);
}
.refs-pagination-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
}
.refs-pagination-info {
  font-size: 0.875rem;
  color: var(--text-primary);
  margin: 0;
}
.refs-pagination-size {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
}
.refs-pagination-select {
  padding: 4px 8px;
  font-size: 0.875rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-primary);
  cursor: pointer;
}
.refs-pagination-select:focus {
  outline: none;
  border-color: var(--accent-green);
}
.refs-pagination-num {
  font-weight: 500;
}
.refs-pagination-nav {
  display: inline-flex;
  align-items: center;
  gap: 0;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
.refs-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.refs-page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.refs-page-btn--edge {
  padding: 0 8px;
}
.refs-page-btn--active {
  background: var(--nav-active-bg);
  border-color: var(--accent-green);
  color: var(--accent-green);
}
.refs-page-ellipsis {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--space-lg);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--border-color);
}
.modal-header .modal-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}
/* .modal-close styles are in global.css */
.modal-error {
  margin-bottom: var(--space-md);
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger-red) 12%, transparent);
  color: var(--danger-red);
  font-size: 0.875rem;
}
.modal-error--dropzone {
  margin-top: var(--space-sm);
  margin-bottom: 0;
}
.modal.modal-fields--add {
  width: min(1100px, 96vw);
  max-height: 92vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0;
  border-radius: 16px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
}
.modal.modal-fields--add.modal-fields--wide {
  width: min(1100px, 96vw);
}
.modal-header--fields {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.modal-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.modal-header--fields .modal-expand-btn {
  display: none;
}
.modal-expand-btn {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    border-color 0.24s ease,
    background 0.24s ease,
    color 0.24s ease,
    transform 0.24s ease;
}
.modal-expand-btn:hover {
  border-color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 10%, transparent);
  color: var(--text-primary);
  transform: translateY(-1px);
}
.modal-expand-btn:active {
  transform: scale(0.96);
}
.modal-expand-btn-icon {
  transition: transform 0.32s ease;
}
.modal-expand-btn:hover .modal-expand-btn-icon {
  transform: scale(1.12) rotate(8deg);
}
.modal-expand-btn--active {
  color: var(--accent-green);
  border-color: color-mix(in srgb, var(--accent-green) 56%, var(--border-color));
  background: color-mix(in srgb, var(--accent-green) 16%, transparent);
  animation: modal-expand-btn-pop 0.28s ease;
}
@keyframes modal-expand-btn-pop {
  0% { transform: scale(0.92); }
  70% { transform: scale(1.08); }
  100% { transform: scale(1); }
}
.modal-title--fields {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text-primary);
}
.modal-title-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--accent-green);
}
.modal-form--add {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}
.modal-actions--fields {
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-panel);
  border-radius: 0;
}
.modal-label-required {
  color: var(--danger-red);
}
.modal-label-opt {
  color: var(--text-secondary);
  font-weight: 400;
}
.modal-input-wrap {
  position: relative;
  width: 100%;
}
.modal-input-wrap--suffix .modal-input {
  padding-right: 48px;
}
.modal-input-suffix {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.875rem;
  color: var(--text-secondary);
  pointer-events: none;
}
.modal-form--add {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal-form-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modal-form-section--grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
  align-items: start;
}
.modal-form-section--grid-4 {
  grid-template-columns: repeat(2, 1fr);
}
@media (min-width: 760px) {
  .modal-form-section--grid-4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.modal-form--add .modal-form-section--grid,
.modal-form--add .modal-form-section--grid-4 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--space-md);
  row-gap: var(--space-md);
}
@media (max-width: 760px) {
  .modal-form--add .modal-form-section--grid,
  .modal-form--add .modal-form-section--grid-4 {
    grid-template-columns: 1fr;
  }
}
.modal-form .modal-field--full {
  grid-column: 1 / -1;
}
.modal-form .modal-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  align-items: stretch;
}
.modal-label {
  font-size: .85rem;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text-secondary);
  line-height: 1.3;
  min-height: 0;
}
.modal-label--with-help {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
}
.modal-select,
.modal-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 38px;
  padding: 9px 11px;
  font-size: .93rem;
  line-height: 1.4;
  color: var(--text-primary);
  font-family: inherit;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.modal-select:focus,
.modal-input:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-green) 20%, transparent);
}
.modal-select {
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 16px 16px;
  padding-right: 40px;
}
.modal-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.8;
}
.modal-textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 84px;
  padding: 9px 11px;
  font-size: .93rem;
  line-height: 1.4;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-family: inherit;
  resize: vertical;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.modal-textarea::placeholder {
  color: var(--text-secondary);
  opacity: 0.8;
}
.modal-textarea:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-green) 20%, transparent);
}
.modal-dropzone,
.modal-dropzone-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  min-height: 100px;
  padding: var(--space-lg) var(--space-md);
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.9375rem;
  line-height: 1.4;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, background 0.2s, transform 0.2s ease, box-shadow 0.2s ease;
}
.modal-dropzone-label {
  margin: 0;
  font-weight: inherit;
}
.modal-dropzone:hover,
.modal-dropzone-label:hover {
  border-color: var(--accent-green);
  color: var(--accent-green);
  background: var(--nav-active-bg);
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(45, 90, 61, 0.14);
}
.modal-dropzone-icon {
  width: 20px;
  height: 20px;
  color: var(--accent-green);
  opacity: 0.9;
  flex-shrink: 0;
  transition: transform 0.22s ease;
}
.modal-dropzone:hover .modal-dropzone-icon,
.modal-dropzone-label:hover .modal-dropzone-icon {
  animation: fields-file-dropzone-hover 0.65s ease;
}
@keyframes fields-file-dropzone-hover {
  0% { transform: translateY(0); }
  40% { transform: translateY(-2px); }
  100% { transform: translateY(0); }
}
.modal-dropzone-text {
  font-weight: 500;
  font-size: 0.9375rem;
}
.modal-file-hint {
  font-size: 0.75rem;
  line-height: 1.3;
  color: var(--text-secondary);
  opacity: 0.9;
}
.modal-file-input-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.modal-dropzone--loading {
  pointer-events: none;
  opacity: 0.8;
}
.modal-scheme-preview-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
}
.modal-scheme-preview-img {
  max-width: 100%;
  max-height: 180px;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-page);
}
.modal-scheme-preview-pdf {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  color: var(--text-secondary);
  font-size: 0.875rem;
}
.modal-scheme-preview-pdf svg {
  color: var(--accent-green);
  opacity: 0.9;
}
.modal-dropzone-filename {
  font-weight: 500;
  color: var(--text-primary);
  word-break: break-all;
  font-size: 0.875rem;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2200;
  padding: 14px;
}
.modal.modal-fields:not(.modal-fields--add) {
  width: min(100vw - 48px, 360px);
  background: var(--bg-panel);
  border-radius: 16px;
  border: 1px solid var(--border-color);
  padding: var(--space-lg);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}
.modal-title {
  font-size: 1.15rem;
  font-weight: 500;
  margin: 0 0 8px;
}
.modal-desc {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin: 0 0 var(--space-md);
  line-height: 1.45;
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}
.modal-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.modal-input {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  width: 100%;
}
.modal-input--readonly {
  opacity: 0.8;
  cursor: default;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
  margin-top: var(--space-md);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--border-color);
}
.modal-btn,
.modal-btn-ghost {
  height: 38px;
  border-radius: 10px;
  border: 1px solid transparent;
  padding: 0 12px;
  font-size: .875rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color .2s ease, background .2s ease, transform .2s ease, box-shadow .2s ease;
}
.modal-btn {
  background: var(--accent-green);
  border-color: transparent;
  color: #fff;
}
.modal-btn:hover:not(:disabled) {
  background: var(--accent-green-hover);
  border-color: transparent;
  color: #fff;
}
.modal-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.modal-btn-ghost {
  border-color: var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
}
.modal-btn-ghost:hover {
  border-color: var(--accent-green);
  background: var(--bg-panel-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px color-mix(in srgb, var(--accent-green) 12%, transparent);
}
/* Модальное окно подтверждения удаления (как в ProfilePage) */
.fields-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
  background: var(--modal-backdrop);
}
.fields-confirm-modal {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: var(--space-xl);
  max-width: 400px;
  width: 100%;
  box-shadow: var(--shadow-card);
}
.fields-confirm-title {
  margin: 0 0 var(--space-sm) 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}
.fields-confirm-text {
  margin: 0 0 var(--space-lg) 0;
  font-size: 0.9375rem;
  color: var(--text-secondary);
  line-height: 1.5;
}
.fields-confirm-actions {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  justify-content: flex-end;
}

/* ——— Тёмная тема: модальное окно добавления/редактирования поля ——— */
[data-theme='dark'] .fields-page .modal-backdrop {
  background: var(--modal-backdrop);
}
[data-theme='dark'] .modal.modal-fields--add {
  background: color-mix(in srgb, var(--bg-elevated) 94%, black);
  border: 1px solid var(--border-color);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px color-mix(in srgb, white 6%, transparent);
}
[data-theme='dark'] .modal-header--fields {
  border-bottom-color: var(--border-color);
  background: var(--bg-overlay);
}
[data-theme='dark'] .modal.modal-fields--add .modal-form--add {
  background: transparent;
}
[data-theme='dark'] .modal.modal-fields--add .modal-label {
  color: var(--text-secondary);
}
[data-theme='dark'] .modal.modal-fields--add .modal-input,
[data-theme='dark'] .modal.modal-fields--add .modal-select,
[data-theme='dark'] .modal.modal-fields--add .modal-textarea {
  background: color-mix(in srgb, var(--bg-elevated) 82%, black);
  border-color: var(--border-color);
  color: var(--text-primary);
}
[data-theme='dark'] .modal.modal-fields--add .modal-input::placeholder,
[data-theme='dark'] .modal.modal-fields--add .modal-textarea::placeholder {
  color: var(--text-secondary);
}
[data-theme='dark'] .modal.modal-fields--add .modal-input:focus,
[data-theme='dark'] .modal.modal-fields--add .modal-select:focus,
[data-theme='dark'] .modal.modal-fields--add .modal-textarea:focus {
  border-color: var(--accent-green);
  background: color-mix(in srgb, var(--bg-elevated) 92%, black);
  box-shadow: 0 0 0 2px var(--focus-ring);
}
[data-theme='dark'] .modal.modal-fields--add .modal-select {
  background-color: color-mix(in srgb, var(--bg-elevated) 76%, black);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 16px 16px;
  padding-right: 40px;
}
[data-theme='dark'] .modal.modal-fields--add .modal-select option {
  background: color-mix(in srgb, var(--bg-elevated) 88%, black);
  color: var(--text-primary);
}
[data-theme='dark'] .modal.modal-fields--add .modal-input-suffix {
  color: var(--text-muted);
}
[data-theme='dark'] .modal.modal-fields--add .field-geometry-switch {
  border-color: var(--border-color);
}
[data-theme='dark'] .modal.modal-fields--add .field-geometry-switch-btn {
  color: var(--text-secondary);
}
[data-theme='dark'] .modal.modal-fields--add .field-geometry-switch-btn--active {
  background: color-mix(in srgb, var(--accent-green) 22%, transparent);
  color: var(--accent-green);
}
[data-theme='dark'] .modal.modal-fields--add .field-address-candidates-label {
  color: var(--text-muted);
}
[data-theme='dark'] .modal.modal-fields--add .modal-dropzone-label {
  background: color-mix(in srgb, var(--bg-elevated) 72%, black);
  border-color: var(--border-color);
  color: var(--text-secondary);
}
[data-theme='dark'] .modal.modal-fields--add .modal-dropzone-label:hover {
  background: color-mix(in srgb, var(--accent-green) 16%, transparent);
  border-color: var(--accent-green);
  color: var(--accent-green);
}
[data-theme='dark'] .modal.modal-fields--add .modal-file-hint {
  color: var(--text-muted);
}
[data-theme='dark'] .modal.modal-fields--add .modal-actions--fields {
  background: color-mix(in srgb, var(--bg-panel) 78%, black);
  border-top-color: var(--border-color);
}
[data-theme='dark'] .modal.modal-fields--add .modal-btn-ghost {
  background: color-mix(in srgb, var(--accent-green) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent-green) 22%, var(--border-color));
  color: var(--text-primary);
}
[data-theme='dark'] .modal.modal-fields--add .modal-btn-ghost:hover {
  background: color-mix(in srgb, var(--accent-green) 16%, transparent);
  border-color: color-mix(in srgb, var(--accent-green) 34%, var(--border-color));
  color: var(--text-primary);
}
[data-theme='dark'] .modal.modal-fields--add .modal-btn {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
[data-theme='dark'] .modal.modal-fields--add .modal-scheme-preview-img {
  background: color-mix(in srgb, var(--bg-elevated) 74%, black);
  border-color: var(--border-color);
}
[data-theme='dark'] .modal.modal-fields--add .modal-scheme-preview-pdf {
  color: var(--text-secondary);
}
[data-theme='dark'] .modal.modal-fields--add .modal-dropzone-filename {
  color: var(--text-primary);
}
[data-theme='dark'] .modal.modal-fields--add .modal-expand-btn {
  border-color: var(--border-color);
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-elevated) 72%, black);
}
[data-theme='dark'] .modal.modal-fields--add .modal-expand-btn:hover {
  border-color: color-mix(in srgb, var(--accent-green) 58%, var(--border-color));
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  color: var(--text-primary);
}
[data-theme='dark'] .modal.modal-fields--add .modal-expand-btn--active {
  border-color: color-mix(in srgb, var(--accent-green) 72%, var(--border-color));
  background: color-mix(in srgb, var(--accent-green) 24%, transparent);
  color: var(--accent-green);
}
/* dark-theme .modal-close:hover handled by global.css */

.field-map-picker-wrap {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
}

.field-map-picker-wrap :deep(.ymap-container) {
  height: 280px;
}

.field-map-land-select {
  margin-bottom: 8px;
}

.field-map-picker-note {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.field-map-picker-note--warn {
  color: #b45309;
}

.field-geometry-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.field-geometry-switch {
  display: inline-flex;
  border: 1px solid var(--border-color);
  border-radius: 9px;
  overflow: hidden;
  width: fit-content;
}

.field-geometry-switch-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  padding: 7px 12px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.field-geometry-switch-btn + .field-geometry-switch-btn {
  border-left: 1px solid var(--border-color);
}

.field-geometry-switch-btn--active {
  background: color-mix(in srgb, var(--accent-green) 14%, transparent);
  color: var(--accent-green);
}

.field-geometry-area-hint {
  display: inline-block;
  margin-top: 4px;
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.field-address-candidates {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-address-candidates-label {
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.field-address-candidates-select {
  font-size: 0.82rem;
}

.field-map-picker-status {
  margin: 6px 0 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.field-map-picker-status--error {
  color: var(--warning-orange);
}

@media (max-width: 1024px) {
  .fields-layout {
    grid-template-columns: 1fr;
  }

  .fields-panel {
    grid-template-rows: auto auto;
  }
}
</style>

