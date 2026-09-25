<script setup lang="ts">
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, ref, onMounted, nextTick, watch } from 'vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
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
import { downloadDelimited, escapeHtml, openPdfInNewTab, renderTablePdfFitPage } from '@/lib/tableExport'
import { type LatLon, type PolygonGeoJson, contourSamplePoints, fromPolygonGeoJson, toPolygonGeoJson } from '@/lib/geoContour'

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

const router = useRouter()
const route = useRoute()

/** Сообщение о неудавшейся загрузке. Пустая строка — сообщения нет. */
const loadError = ref('')
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
  downloadDelimited(headers, rows, `список_полей_${new Date().toISOString().slice(0, 10)}.csv`)
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
    const doc = await renderTablePdfFitPage(el)
    document.body.removeChild(el)
    openPdfInNewTab(doc)
  } catch (e) {
    // Раньше по нажатию «Выгрузить в PDF» при сбое не происходило вообще
    // ничего: ни файла, ни объяснения.
    document.body.removeChild(el)
    loadError.value = formatSupabaseError(e) || 'Не удалось сформировать PDF'
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
    <p v-if="loadError" class="page-load-error" role="alert">{{ loadError }}</p>
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
          <table class="fields-table" aria-label="Список полей" v-card-table>
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
                  <UiSelect
                    :model-value="f.responsibleId || ''"
                    :options="[{ value: '', label: 'Не назначен' }, ...profiles.map((p) => ({ value: p.id, label: p.display_name || p.email || '' }))]"
                    class="fields-responsible-select"
                    @update:model-value="(v) => onResponsibleChange(f.id, String(v))"
                  />
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
            <UiSelect v-model="pageSize" :options="[5, 10, 20, 50].map((n) => ({ value: n, label: String(n) }))" class="fields-pagination-select" @change="onPageSizeChange" />
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
              <UiSelect v-model="newReasonCategory" :options="(Object.keys(CATEGORY_LABELS) as DowntimeCategory[]).map((key) => ({ value: key, label: CATEGORY_LABELS[key] }))" class="refs-select" />
              <button type="button" class="refs-btn" :disabled="refsLoading || !newReasonLabel.trim()" @click="addReason">Добавить</button>
            </div>
            <div class="refs-table-wrap">
              <table class="refs-table" v-card-table>
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
                  <UiSelect v-model="refsPageSize" :options="REFS_PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: String(n) }))" class="refs-pagination-select" @change="onRefsPageSizeChange" />
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
              <table class="refs-table" v-card-table>
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
                  <UiSelect v-model="refsPageSize" :options="REFS_PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: String(n) }))" class="refs-pagination-select" @change="onRefsPageSizeChange" />
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
                  <UiSelect v-model="selectedAddressCandidate" :options="newFieldAddressCandidates.map((a) => ({ value: a, label: a }))" class="modal-select field-address-candidates-select" @change="onAddressCandidateChange" />
                </div>
                <p v-if="fieldMapAddressCandidatesLoading" class="field-map-picker-status">Подбираем адреса по контуру...</p>
              </label>
            </div>
            <div class="modal-form-section">
              <div class="modal-field modal-field--full">
                <span class="modal-label">Карта участка</span>
                <label class="modal-field modal-field--full field-map-land-select">
                  <span class="modal-label">Земельный участок (контур для ориентира)</span>
                  <UiSelect v-model="newFieldLandId" :options="[{ value: '', label: '— Выберите участок, чтобы показать контур —' }, ...(lands).map((land) => ({ value: land.id, label: `${land.cadastral_number || `Участок №${land.number}`}${land.address ? ` — ${land.address}` : ''}` }))]" class="modal-select" />
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
                <UiSelect v-model="newFieldLandType" :options="[...(landTypeOptions).map((t) => ({ value: t.name, label: String(t.name) }))]" class="modal-select" />
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
                <UiSelect v-model="newFieldCropKey" :options="[...(cropOptions).map((opt) => ({ value: opt.key, label: String(opt.label) }))]" class="modal-select" />
              </label>
              <label class="modal-field">
                <span class="modal-label">Год посева</span>
                <input v-model.number="newFieldSowingYear" type="number" class="modal-input" min="2000" :max="new Date().getFullYear() + 2" />
              </label>
              <label class="modal-field">
                <span class="modal-label">Ответственный</span>
                <UiSelect v-model="newFieldResponsibleId" :options="[{ value: '', label: 'Не назначен' }, ...(profiles).map((p) => ({ value: p.id, label: String(p.display_name || p.email) }))]" class="modal-select" />
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
                <UiSelect v-model="newFieldMunicipality" :options="[{ value: '', label: '—' }, ...(fieldMunicipalityRefs).map((row) => ({ value: row.name, label: String(row.name) }))]" class="modal-select" />
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

<style scoped src="./FieldsPage.css"></style>

