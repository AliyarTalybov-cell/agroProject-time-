<script setup lang="ts">
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { askConfirm } from '@/composables/useConfirm'
import { Card } from '@/components/ui/shadcn/card'
import UiPagination from '@/components/ui/UiPagination.vue'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import { Input } from '@/components/ui/shadcn/input'
import { Button } from '@/components/ui/shadcn/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/shadcn/toggle-group'
import { FileSpreadsheetIcon, FileTextIcon, PencilIcon, PlusIcon } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import UiSuccessModal from '@/components/UiSuccessModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
// Общие стили раздела земель — те же, что у вынесенных окон и вкладок.
import '@/components/lands/landsShared.css'
import LandsRefsPanel from '@/components/lands/refs/LandsRefsPanel.vue'
import {
  actualUseOptions,
  cropRotationTypeRefs,
  crops,
  equipmentConditionRefs,
  equipmentTypeRefs,
  fieldMunicipalityRefs,
  landCategories,
  landMeliorationEventTypes,
  landMeliorationSubtypes,
  landMeliorationTypes,
  landRefsTab,
  landRightDocumentTypes,
  landRightHolders,
  landRightHolderTypes,
  landRightOwnershipForms,
  landRightTypes,
  landTypes,
  storageFillStatusRefs,
  storageLocationStatusRefs,
  storageLocationTypeRefs,
  storageRefsTab,
} from '@/components/lands/refs/landRefsStore'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loadPdfTools } from '@/lib/pdfExport'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import LandCropRotationModal from '@/components/lands/LandCropRotationModal.vue'
import LandCropRotationTab from '@/components/lands/LandCropRotationTab.vue'
import LandFieldsTab from '@/components/lands/LandFieldsTab.vue'
import LandRealEstateTab from '@/components/lands/LandRealEstateTab.vue'
import LandRightsTab from '@/components/lands/LandRightsTab.vue'
import LandUsersTab from '@/components/lands/LandUsersTab.vue'
import LandRightModal from '@/components/lands/LandRightModal.vue'
import LandUserModal from '@/components/lands/LandUserModal.vue'
import LandMeliorationModal from '@/components/lands/LandMeliorationModal.vue'
import LandRealEstateModal from '@/components/lands/LandRealEstateModal.vue'
import LandsConfirmModal from '@/components/lands/LandsConfirmModal.vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
import YandexMap from '@/components/YandexMap.vue'
import type { MapFieldMarker } from '@/components/YandexMap.vue'
import { resolveYandexAddressCandidates, resolveYandexAddressLine } from '@/lib/yandexGeocode'
import { downloadDelimited, escapeHtml } from '@/lib/tableExport'
import { type LatLon, fromPolygonGeoJson, polygonCenter, toPolygonGeoJson } from '@/lib/geoContour'
import {
  loadCrops,
  loadLandActualUseOptions,
  loadLandCategories,
} from '@/lib/landTypesAndCrops'
import {
  addLand,
  addLandRight,
  addLandCropRotation,
  addLandRealEstateObject,
  addLandUser,
  deleteLandRight,
  deleteLandCropRotation,
  deleteLandRealEstateObject,
  deleteLand,
  deleteLandUser,
  isSupabaseConfigured,
  loadLands,
  loadLandsPage,
  loadMaxLandNumber,
  type LandsPageResult,
  loadLandRights,
  loadLandRightDocumentTypes,
  loadLandRightHolders,
  loadLandRightHolderTypes,
  loadLandRightOwnershipForms,
  loadLandRightTypes,
  loadLandMeliorationTypes,
  loadLandMeliorationSubtypes,
  loadLandMeliorationEventTypes,
  loadLandCropRotationTypes,
  loadLandCropRotations,
  loadLandMeliorationEntries,
  loadLandMeliorationEntriesPage,
  loadLandRealEstateObjects,
  loadLandTypes,
  loadLandUsers,
  type LandRightRow,
  type LandCropRotationRow,
  type LandRealEstateObjectRow,
  type LandMeliorationEntryRow,
  type LandRow,
  type LandUserRow,
  updateLand,
  updateLandRight,
  updateLandCropRotation,
  updateLandRealEstateObject,
  updateLandUser,
  addLandMeliorationEntry,
  deleteLandMeliorationEntry,
  updateLandMeliorationEntry,
  uploadLandRightFile,
} from '@/lib/landsSupabase'
import {
  loadStorageLocationTypes,
  loadStorageLocationStatuses,
  loadStorageFillStatuses,
} from '@/lib/storageRefsSupabase'
import {
  loadFields,
  updateField,
  loadFieldMunicipalitiesRefs,
  type FieldRow,
} from '@/lib/fieldsSupabase'
import {
  loadEquipmentTypeRefs,
  loadEquipmentConditionRefs,
} from '@/lib/equipmentSupabase'

type LandForm = {
  number: number
  name: string
  landTypeId: string
  landCategory: string
  region: string
  area: number
  cadastralNumber: string
  permittedUseDocs: string
  efgisZsnFieldNumber: string
  geolocation: string
  address: string
  locationDescription: string
  documentAreaHa: number | null
  isAgriLand: string
  agriLandAreaHa: number | null
  isValuableAgriLand: '' | 'yes' | 'no'
  irrigatedAreaHa: number | null
  drainedAreaHa: number | null
  actualUseStatus: string
  breedingUse: '' | 'yes' | 'no'
  otherUseInfo: string
  notes: string
}

const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const lands = ref<LandRow[]>([])
const fields = ref<FieldRow[]>([])
const landRights = ref<LandRightRow[]>([])
const landUsers = ref<LandUserRow[]>([])
const landCropRotations = ref<LandCropRotationRow[]>([])
const landRealEstateObjects = ref<LandRealEstateObjectRow[]>([])
const landMeliorationEntries = ref<LandMeliorationEntryRow[]>([])
const selectedLandId = ref<string>('')
const activeTab = ref<'info' | 'fields' | 'rights' | 'users' | 'crop-rotation' | 'real-estate'>('info')
const landsSearch = ref('')
const landsPage = ref(1)
const landsPageSize = ref(10)
const landsTotal = ref(0)
const meliorationPage = ref(1)
const meliorationPageSize = ref(10)
const meliorationTotal = ref(0)
let meliorationRequestId = 0
const maxLandNumber = ref(0)
const mapLat = ref(55.7558)
const mapLon = ref(37.6176)
const resolvingAddress = ref(false)
const mapGeometryMode = ref<'point' | 'polygon'>('polygon')
const mapContourDraftPoints = ref<LatLon[]>([])
const addressCandidates = ref<string[]>([])
const selectedAddressCandidate = ref('')
const addressCandidatesLoading = ref(false)
const landEditorOpen = ref(false)
const landEditorMode = ref<'create' | 'edit'>('create')
const landInlineEditOpen = ref(false)
const showDetailsMap = ref(false)
/** Телефон: группы справочников — выпадающим списком, а не восемью вкладками. */
const isPhone = useMediaQuery('(max-width: 639px)')
/** Группы справочников — для выпадающего списка на телефоне вместо восьми вкладок. */
const REF_GROUPS = [
  { value: 'rights-refs', label: 'Справочники прав' },
  { value: 'land-refs', label: 'Справочники земель' },
  { value: 'crops-refs', label: 'Справочники СХ культур' },
  { value: 'melioration-refs', label: 'Справочники мелиорации' },
  { value: 'equipment-refs', label: 'Справочники техники' },
  { value: 'field-refs', label: 'Справочники полей' },
  { value: 'crop-rotation-refs', label: 'Справочники севооборота' },
  { value: 'storage-refs', label: 'Справочники хранения' },
] as const
const landsRootTab = ref<'registry' | 'melioration' | 'land-refs' | 'rights-refs' | 'crops-refs' | 'melioration-refs' | 'equipment-refs' | 'field-refs' | 'crop-rotation-refs' | 'storage-refs'>('registry')

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return fallback
}
const cropRotationModalOpen = ref(false)
const editingCropRotationId = ref<string | null>(null)
const cropRotationForm = ref({
  fieldId: '',
  season: '',
  rotationType: '',
  cropKey: '',
  seedMaterialName: '',
  areaForCropsHa: null as number | null,
  areaWithImprovedProductsHa: null as number | null,
  areaForOrganicHa: null as number | null,
  areaForSelectionSeedHa: null as number | null,
  producedProductsInfo: '',
  producedCropMassTons: null as number | null,
})
const realEstateModalOpen = ref(false)
const editingRealEstateId = ref<string | null>(null)
const meliorationModalOpen = ref(false)
const editingMeliorationId = ref<string | null>(null)
const meliorationTab = ref<'systems' | 'forest' | 'events'>('systems')
const meliorationForm = ref({
  fieldId: '',
  cropKey: '',
  areaHa: null as number | null,
  meliorationType: '',
  meliorationSubtype: '',
  descriptionLocation: '',
  cadastralNumber: '',
  commissionedAt: '',
  forestCharacteristics: '',
  forestYearCreated: null as number | null,
  reconstructionInfo: '',
  eventType: '',
  eventDate: '',
  projectApproval: '',
})
const deleteConfirmOpen = ref(false)
const deleteConfirmTitle = ref('')
const deleteConfirmText = ref('')
const deleteTarget = ref<{
  type: 'crop-rotation' | 'real-estate' | 'land-type' | 'land-category' | 'land-usage' | 'crop-ref' | 'melioration'
    | 'ownership-form' | 'right-type' | 'right-document-type' | 'holder-type' | 'right-holder'
    | 'melioration-type' | 'melioration-subtype' | 'melioration-event-type' | 'equipment-type' | 'equipment-condition' | 'field-municipality' | 'crop-rotation-type'
    | 'storage-location-type' | 'storage-location-status' | 'storage-fill-status' | 'land'
  id: string
} | null>(null)
const successModalOpen = ref(false)
const successModalText = ref('')
const realEstateForm = ref({
  fieldId: '',
  cadastralNumber: '',
  name: '',
  locationDescription: '',
  areaSqm: null as number | null,
  permittedUse: '',
  purpose: '',
  address: '',
  depthM: null as number | null,
  heightM: null as number | null,
  lengthM: null as number | null,
  volumeM3: null as number | null,
  burialDepthM: null as number | null,
  developmentPlan: '',
  floors: '',
  undergroundFloors: '',
})
let landsSearchDebounce: ReturnType<typeof setTimeout> | null = null
let landsSearchRequestId = 0
let addressCandidatesRequestId = 0
const route = useRoute()
const router = useRouter()
const ROOT_TAB_QUERY_MAP = new Set(['registry', 'melioration', 'land-refs', 'land-types', 'land-categories', 'land-usage', 'rights-refs', 'crops-refs', 'melioration-refs', 'equipment-refs', 'field-refs', 'crop-rotation-refs', 'storage-refs', 'storage-types', 'storage-statuses', 'storage-fill-statuses', 'storage-writeoff-reasons', 'storage-consumption-targets', 'storage-purposes'])
/** Площадь в гектарах по-русски: «50 879,03». */
function formatHa(v: number | string | null | undefined): string {
  return Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const routeLandId = computed(() => String(route.params.id || ''))
const isDetailsMode = computed(() => Boolean(routeLandId.value))
const landsListSubtitle = computed(() => (
  landsRootTab.value === 'rights-refs'
    ? 'Справочники для заполнения документов по правам владения'
    : landsRootTab.value === 'land-refs'
      ? 'Справочники земельных участков'
      : landsRootTab.value === 'crops-refs'
        ? 'Справочник сельскохозяйственных культур'
      : landsRootTab.value === 'melioration-refs'
        ? 'Справочники для заполнения данных по мелиорации'
      : landsRootTab.value === 'equipment-refs'
        ? 'Справочники для заполнения данных по технике'
      : landsRootTab.value === 'field-refs'
        ? 'Справочники для заполнения данных по полям'
      : landsRootTab.value === 'crop-rotation-refs'
        ? 'Справочники для заполнения севооборота'
      : landsRootTab.value === 'storage-refs'
        ? 'Справочники мест хранения (склады, силосы, тока, бурты)'
      : landsRootTab.value === 'melioration'
        ? 'Сведения по мелиорации'
        : 'Реестр, паспорты и справочники земельных участков'
))
const form = ref<LandForm>({
  number: 1,
  name: '',
  landTypeId: '',
  landCategory: '',
  region: '',
  area: 0,
  cadastralNumber: '',
  permittedUseDocs: '',
  efgisZsnFieldNumber: '',
  geolocation: '',
  address: '',
  locationDescription: '',
  documentAreaHa: null,
  isAgriLand: '',
  agriLandAreaHa: null,
  isValuableAgriLand: '',
  irrigatedAreaHa: null,
  drainedAreaHa: null,
  actualUseStatus: '',
  breedingUse: '',
  otherUseInfo: '',
  notes: '',
})

const rightForm = ref({
  holderMode: 'manual' as 'manual' | 'reference',
  holderRefId: '',
  holderTypeId: '',
  ownershipForm: '',
  rightType: 'Собственность',
  holderName: '',
  holderInn: '',
  holderKpp: '',
  holderOgrn: '',
  cadastralNumber: '',
  documentType: '',
  supportingDocuments: '',
  documentName: '',
  documentNumber: '',
  documentDate: '',
  startsAt: '',
  endsAt: '',
  notes: '',
})
const rightModalOpen = ref(false)
const editingRightId = ref<string | null>(null)
const rightFileUploading = ref(false)
const rightFileDeleteConfirmOpen = ref(false)
const rightFileToDelete = ref('')
const userModalOpen = ref(false)
const editingUserId = ref<string | null>(null)
const userFileUploading = ref(false)
const userFileDeleteConfirmOpen = ref(false)
const userFileToDelete = ref('')

const userForm = ref({
  holderMode: 'manual' as 'manual' | 'reference',
  holderRefId: '',
  holderName: '',
  holderInn: '',
  holderKpp: '',
  holderOgrn: '',
  rightType: '',
  documentType: '',
  supportingDocuments: '',
  startsAt: '',
  endsAt: '',
  usageAreaHa: null as number | null,
})

const selectedLand = computed(() => lands.value.find((x) => x.id === selectedLandId.value) ?? null)
const landTypeLabelMap = computed(() => new Map(landTypes.value.map((t) => [t.id, t.name])))
const selectedLandPolygonPoints = computed<LatLon[]>(() => fromPolygonGeoJson(selectedLand.value?.contour_geojson ?? null, { requireType: false }))
const detailsMapLat = computed(() => selectedLand.value?.center_lat ?? mapLat.value)
const detailsMapLon = computed(() => selectedLand.value?.center_lon ?? mapLon.value)
const landEfisNumbersMap = computed(() => {
  const map = new Map<string, string>()
  const byLand = new Map<string, Set<string>>()
  for (const f of fields.value) {
    const landId = f.land_id
    const efis = String((f as { efis_zsn_number?: string | null }).efis_zsn_number ?? '').trim()
    if (!landId || !efis) continue
    if (!byLand.has(landId)) byLand.set(landId, new Set<string>())
    byLand.get(landId)!.add(efis)
  }
  for (const [landId, values] of byLand.entries()) {
    map.set(landId, Array.from(values).join(', '))
  }
  return map
})
const assignedFields = computed(() => fields.value.filter((f) => f.land_id === selectedLandId.value))
const unassignedFields = computed(() => fields.value.filter((f) => !f.land_id || f.land_id !== selectedLandId.value))
const assignedFieldMapMarkers = computed<MapFieldMarker[]>(() => assignedFields.value
  .reduce<MapFieldMarker[]>((markers, f) => {
    const polygonPoints = fromPolygonGeoJson(f.contour_geojson as Record<string, unknown> | null, { requireType: false })
    if (polygonPoints.length >= 3) {
      const center = polygonCenter(polygonPoints)
      markers.push({
        id: f.id,
        lat: center?.lat ?? detailsMapLat.value,
        lon: center?.lon ?? detailsMapLon.value,
        title: `Поле №${f.number} ${f.name}`,
        subtitle: f.cadastral_number ?? '',
        geometryMode: 'polygon' as const,
        polygonPoints,
      })
      return markers
    }
    const geo = parseGeolocationString(f.geolocation ?? '')
    if (!geo) return markers
    markers.push({
      id: f.id,
      lat: geo.lat,
      lon: geo.lon,
      title: `Поле №${f.number} ${f.name}`,
      subtitle: f.cadastral_number ?? '',
      geometryMode: 'point' as const,
    })
    return markers
  }, []))
const cropRotationFieldMap = computed(() => new Map(fields.value.map((f) => [f.id, f])))
const cropLabelMap = computed(() => new Map(crops.value.map((c) => [c.key, c.label])))
const meliorationEntriesByTab = computed(() => {
  const kind = MELIORATION_KIND_MAP[meliorationTab.value]
  if (!isDetailsMode.value && landsRootTab.value === 'melioration') {
    return landMeliorationEntries.value
  }
  return landMeliorationEntries.value.filter((x) => x.melioration_kind === kind)
})
const meliorationFieldOptions = computed(() => fields.value)
const landRightHolderTypeMap = computed(() => new Map(landRightHolderTypes.value.map((x) => [x.id, x.name])))
const rightSupportingLinks = computed(() => rightForm.value.supportingDocuments
  .split(/\s+/)
  .map((x) => x.trim())
  .filter((x) => /^https?:\/\//i.test(x)))
const userSupportingLinks = computed(() => userForm.value.supportingDocuments
  .split(/\s+/)
  .map((x) => x.trim())
  .filter((x) => /^https?:\/\//i.test(x)))
const CROP_KEY_TO_NAME: Record<string, string> = {
  wheat: 'Пшеница',
  corn: 'Кукуруза',
  soy: 'Соя',
  sunflower: 'Подсолнечник',
  none: 'Нет культуры',
  meadow: 'Многолетние травы',
}
const DEFAULT_CROP_ROTATION_TYPE_OPTIONS = ['Полевой', 'Кормовой', 'Специальный'] as const
const cropRotationTypeOptions = computed(() => (
  cropRotationTypeRefs.value.length
    ? cropRotationTypeRefs.value.map((x) => x.name)
    : [...DEFAULT_CROP_ROTATION_TYPE_OPTIONS]
))
const MELIORATION_TABS = [
  { id: 'systems', label: 'Мелиоративные системы, расположенные на земельном участке', short: 'Системы' },
  { id: 'forest', label: 'Мелиоративные защитные лесные насаждения', short: 'Защитные лесные насаждения' },
  { id: 'events', label: 'Мелиоративные мероприятия', short: 'Мероприятия' },
] as const
const MELIORATION_KIND_MAP: Record<(typeof MELIORATION_TABS)[number]['id'], string> = {
  systems: 'systems',
  forest: 'forest',
  events: 'events',
}

function formatLandArea(area: number | null): string {
  const n = Number(area ?? 0)
  if (!Number.isFinite(n)) return '0'
  return String(n)
}

function landEfisNumberDisplay(land: LandRow): string {
  const linked = landEfisNumbersMap.value.get(land.id)
  if (linked) return linked
  return land.efgis_zsn_field_number || 'Нет данных'
}

function exportCellValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  const normalized = String(value).trim()
  return normalized || '—'
}

function downloadCsv(headers: string[], rows: string[][], fileName: string) {
  if (!rows.length) return
  downloadDelimited(headers, rows, fileName)
}

async function downloadPdfTable(title: string, headers: string[], rows: string[][], fileName: string, width = 1100) {
  if (!rows.length) return
  const escapedRows = rows.map((r) => r.map((c) => escapeHtml(c)))
  const tableRows = escapedRows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
  const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const html = `
    <div style="position:fixed;left:-9999px;top:0;width:${width}px;font-family:Arial,sans-serif;font-size:12px;background:#fff;">
      <h2 style="margin:0 0 12px 0;font-size:16px;">${escapeHtml(title)}</h2>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead><tr style="background:#225533;color:#fff;">${headerCells}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `
  const wrap = document.createElement('div')
  wrap.innerHTML = html.trim()
  const el = wrap.firstElementChild as HTMLElement
  document.body.appendChild(el)
  try {
    const { html2canvas, jsPDF } = await loadPdfTools()
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('l', 'mm', 'a4')
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const m = 8
    const drawW = pageW - m * 2
    const drawH = (canvas.height * drawW) / canvas.width
    let remain = drawH
    let y = m
    let offset = 0
    while (remain > 0) {
      pdf.addImage(imgData, 'PNG', m, y - offset, drawW, drawH)
      remain -= pageH - m * 2
      offset += pageH - m * 2
      if (remain > 0) pdf.addPage()
    }
    pdf.save(fileName)
  } finally {
    document.body.removeChild(el)
  }
}

const LAND_INFO_EXPORT_HEADERS = ['Показатель', 'Значение']

const landInfoExportRows = computed(() => {
  const land = selectedLand.value
  if (!land) return [] as string[][]
  const geolocation = land.center_lat != null && land.center_lon != null ? `${land.center_lat}, ${land.center_lon}` : '—'
  return [
    ['Тип земли', landTypeLabelMap.value.get(land.land_type_id || '') || '—'],
    ['Категория земель', exportCellValue(land.land_category)],
    ['Регион', exportCellValue(land.region)],
    ['Площадь земельного участка, га', exportCellValue(Number(land.area || 0).toFixed(2))],
    ['Вид разрешенного использования по документам', exportCellValue(land.permitted_use_docs)],
    ['Кадастровый номер', exportCellValue(land.cadastral_number)],
    ['№ поля ЕФИС ЗСН', landEfisNumberDisplay(land)],
    ['Геолокация', geolocation],
    ['Адрес', exportCellValue(land.address)],
    ['Описание местоположения', exportCellValue(land.location_description)],
    ['Общая площадь по документам, га', exportCellValue(land.document_area_ha)],
    ['Площадь сельхозугодий, га', exportCellValue(land.agri_land_area_ha)],
    ['Отнесение к сельхозугодьям', landTypeLabelMap.value.get(land.agri_land_type_id || '') || '—'],
    ['Особо ценные продуктивные угодья', land.is_valuable_agri_land == null ? '—' : land.is_valuable_agri_land ? 'Да' : 'Нет'],
    ['Использование участка', exportCellValue(land.actual_use_status)],
    ['Фактически орошаемая площадь, га', exportCellValue(land.irrigated_area_ha)],
    ['Фактически осушаемая площадь, га', exportCellValue(land.drained_area_ha)],
    ['Использование для племенного/селекции/семеноводства', land.breeding_use == null ? '—' : land.breeding_use ? 'Да' : 'Нет'],
    ['Иные сведения об использовании', exportCellValue(land.other_use_info)],
    ['Примечание', exportCellValue(land.notes)],
  ]
})

const landRightsExportHeaders = [
  'Наименование',
  'ИНН',
  'КПП',
  'ОГРН',
  'Кадастровый номер',
  'Форма собственности',
  'Вид права',
  'Начало',
  'Окончание',
]

const landRightsExportRows = computed(() => landRights.value.map((right) => ([
  exportCellValue(right.holder_name),
  exportCellValue(right.holder_inn),
  exportCellValue(right.holder_kpp),
  exportCellValue(right.holder_ogrn),
  exportCellValue(right.cadastral_number),
  exportCellValue(right.ownership_form),
  exportCellValue(right.right_type),
  exportCellValue(right.starts_at),
  exportCellValue(right.ends_at),
])))

const landCropRotationExportHeaders = [
  '№ поля ЕФИС ЗСН',
  'Сезон',
  'Тип',
  'Культура',
  'Площадь, га',
  'Площадь для выращивания сельхозкультур, га',
  'Масса произведенной сельхозкультуры, т',
]

const landCropRotationExportRows = computed(() => landCropRotations.value.map((rotation) => ([
  exportCellValue(realEstateFieldLabel(rotation.field_id)),
  exportCellValue(rotation.season),
  exportCellValue(rotation.rotation_type),
  exportCellValue(cropLabelMap.value.get(rotation.crop_key || '') || '—'),
  exportCellValue(formatRotationMetric(cropRotationFieldMap.value.get(rotation.field_id)?.area)),
  exportCellValue(formatRotationMetric(rotation.area_for_crops_ha)),
  exportCellValue(formatRotationMetric(rotation.produced_crop_mass_tons)),
])))

const landRealEstateExportHeaders = [
  '№ поля ЕФИС ЗСН',
  'Кадастровый номер',
  'Наименование',
  'Адрес',
  'Площадь, кв.м.',
]

const landRealEstateExportRows = computed(() => landRealEstateObjects.value.map((obj) => ([
  exportCellValue(realEstateFieldLabel(obj.field_id)),
  exportCellValue(obj.cadastral_number),
  exportCellValue(obj.name),
  exportCellValue(obj.address),
  exportCellValue(formatRotationMetric(obj.area_sqm)),
])))

const landFieldsExportHeaders = [
  'Название',
  '№ поля ЕФИС ЗСН',
  'Площадь, га',
  'Культура',
  'Тип земли',
  'Муниципальное образование',
  'Регион',
  'Описание',
]

const landFieldsExportRows = computed(() => assignedFields.value.map((field) => ([
  exportCellValue(`Поле №${field.number} ${field.name}`),
  exportCellValue((field as { efis_zsn_number?: string | null }).efis_zsn_number),
  exportCellValue(Number(field.area || 0).toFixed(2)),
  exportCellValue(fieldCropLabel(field.crop_key)),
  exportCellValue(field.land_type),
  exportCellValue(field.municipality),
  exportCellValue(field.region),
  exportCellValue(field.location_description),
])))

function exportLandInfoToExcel() {
  if (!selectedLand.value || !landInfoExportRows.value.length) return
  downloadCsv(
    LAND_INFO_EXPORT_HEADERS,
    landInfoExportRows.value,
    `сведения_об_участке_${selectedLand.value.cadastral_number || selectedLand.value.id}_${new Date().toISOString().slice(0, 10)}.csv`,
  )
}

async function exportLandInfoToPdf() {
  if (!selectedLand.value || !landInfoExportRows.value.length) return
  await downloadPdfTable(
    'Сведения об участке',
    LAND_INFO_EXPORT_HEADERS,
    landInfoExportRows.value,
    `сведения_об_участке_${selectedLand.value.cadastral_number || selectedLand.value.id}_${new Date().toISOString().slice(0, 10)}.pdf`,
    920,
  )
}

function exportLandRightsToExcel() {
  if (!landRightsExportRows.value.length) return
  downloadCsv(
    landRightsExportHeaders,
    landRightsExportRows.value,
    `права_владения_${new Date().toISOString().slice(0, 10)}.csv`,
  )
}

async function exportLandRightsToPdf() {
  if (!landRightsExportRows.value.length) return
  await downloadPdfTable(
    'Права владения',
    landRightsExportHeaders,
    landRightsExportRows.value,
    `права_владения_${new Date().toISOString().slice(0, 10)}.pdf`,
  )
}

function exportLandCropRotationToExcel() {
  if (!landCropRotationExportRows.value.length) return
  downloadCsv(
    landCropRotationExportHeaders,
    landCropRotationExportRows.value,
    `севооборот_${new Date().toISOString().slice(0, 10)}.csv`,
  )
}

async function exportLandCropRotationToPdf() {
  if (!landCropRotationExportRows.value.length) return
  await downloadPdfTable(
    'Севооборот',
    landCropRotationExportHeaders,
    landCropRotationExportRows.value,
    `севооборот_${new Date().toISOString().slice(0, 10)}.pdf`,
  )
}

function exportLandRealEstateToExcel() {
  if (!landRealEstateExportRows.value.length) return
  downloadCsv(
    landRealEstateExportHeaders,
    landRealEstateExportRows.value,
    `объекты_недвижимости_${new Date().toISOString().slice(0, 10)}.csv`,
  )
}

async function exportLandRealEstateToPdf() {
  if (!landRealEstateExportRows.value.length) return
  await downloadPdfTable(
    'Объекты недвижимости',
    landRealEstateExportHeaders,
    landRealEstateExportRows.value,
    `объекты_недвижимости_${new Date().toISOString().slice(0, 10)}.pdf`,
  )
}

function exportLandFieldsToExcel() {
  if (!landFieldsExportRows.value.length) return
  downloadCsv(
    landFieldsExportHeaders,
    landFieldsExportRows.value,
    `поля_земли_${new Date().toISOString().slice(0, 10)}.csv`,
  )
}

async function exportLandFieldsToPdf() {
  if (!landFieldsExportRows.value.length) return
  await downloadPdfTable(
    'Поля земли',
    landFieldsExportHeaders,
    landFieldsExportRows.value,
    `поля_земли_${new Date().toISOString().slice(0, 10)}.pdf`,
    1260,
  )
}

function exportLandsToExcel() {
  if (!lands.value.length) return
  const headers = [
    'Кадастровый номер',
    '№ поля ЕФИС ЗСН',
    'Адрес земельного участка',
    'Категория земель',
    'Площадь земельного участка, га',
    'Вид разрешенного использования по документам',
  ]
  const rows = lands.value.map((land) => ([
    land.cadastral_number || 'Нет данных',
    landEfisNumberDisplay(land),
    land.address || 'Нет данных',
    land.land_category || 'Нет данных',
    formatLandArea(land.area),
    land.permitted_use_docs || 'Нет данных',
  ]))
  downloadDelimited(headers, rows, `реестр_земель_${new Date().toISOString().slice(0, 10)}.csv`)
}

async function exportLandsToPdf() {
  if (!lands.value.length) return
  const headers = [
    'Кадастровый номер',
    '№ поля ЕФИС ЗСН',
    'Адрес земельного участка',
    'Категория земель',
    'Площадь земельного участка, га',
    'Вид разрешенного использования по документам',
  ]
  const rows = lands.value.map((land) => ([
    escapeHtml(land.cadastral_number || 'Нет данных'),
    escapeHtml(landEfisNumberDisplay(land)),
    escapeHtml(land.address || 'Нет данных'),
    escapeHtml(land.land_category || 'Нет данных'),
    escapeHtml(formatLandArea(land.area)),
    escapeHtml(land.permitted_use_docs || 'Нет данных'),
  ]))
  const tableRows = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
  const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const html = `
    <div style="position:fixed;left:-9999px;top:0;width:1200px;font-family:Arial,sans-serif;font-size:12px;background:#fff;">
      <h2 style="margin:0 0 12px 0;font-size:16px;">Реестр земель</h2>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead><tr style="background:#225533;color:#fff;">${headerCells}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `
  const wrap = document.createElement('div')
  wrap.innerHTML = html.trim()
  const el = wrap.firstElementChild as HTMLElement
  document.body.appendChild(el)
  try {
    const { html2canvas, jsPDF } = await loadPdfTools()
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('l', 'mm', 'a4')
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const m = 8
    const drawW = pageW - m * 2
    const drawH = (canvas.height * drawW) / canvas.width
    let remain = drawH
    let y = m
    let offset = 0
    while (remain > 0) {
      pdf.addImage(imgData, 'PNG', m, y - offset, drawW, drawH)
      remain -= pageH - m * 2
      offset += pageH - m * 2
      if (remain > 0) pdf.addPage()
    }
    pdf.save(`реестр_земель_${new Date().toISOString().slice(0, 10)}.pdf`)
  } finally {
    document.body.removeChild(el)
  }
}
function getLandDisplayName(): string {
  const cadastral = form.value.cadastralNumber.trim()
  const address = form.value.address.trim()
  return cadastral || address || `Участок ${Math.max(1, Math.trunc(form.value.number || 1))}`
}

function isDateRangeValid(start: string, end: string): boolean {
  if (!start || !end) return true
  return start <= end
}

function resetRightForm() {
  rightForm.value = {
    holderMode: 'manual',
    holderRefId: '',
    holderTypeId: '',
    ownershipForm: '',
    rightType: 'Собственность',
    holderName: '',
    holderInn: '',
    holderKpp: '',
    holderOgrn: '',
    cadastralNumber: '',
    documentType: '',
    supportingDocuments: '',
    documentName: '',
    documentNumber: '',
    documentDate: '',
    startsAt: '',
    endsAt: '',
    notes: '',
  }
}

function openRightModal() {
  editingRightId.value = null
  resetRightForm()
  rightModalOpen.value = true
}

function openRightEditModal(right: LandRightRow) {
  editingRightId.value = right.id
  rightForm.value = {
    holderMode: right.holder_mode ?? 'manual',
    holderRefId: '',
    holderTypeId: '',
    ownershipForm: right.ownership_form ?? '',
    rightType: right.right_type ?? '',
    holderName: right.holder_name ?? '',
    holderInn: right.holder_inn ?? '',
    holderKpp: right.holder_kpp ?? '',
    holderOgrn: right.holder_ogrn ?? '',
    cadastralNumber: right.cadastral_number ?? '',
    documentType: right.document_type ?? '',
    supportingDocuments: right.supporting_documents ?? '',
    documentName: right.document_name ?? '',
    documentNumber: right.document_number ?? '',
    documentDate: right.document_date ?? '',
    startsAt: right.starts_at ?? '',
    endsAt: right.ends_at ?? '',
    notes: right.notes ?? '',
  }
  rightModalOpen.value = true
}

function closeRightModal() {
  if (saving.value || rightFileUploading.value) return
  rightModalOpen.value = false
  editingRightId.value = null
  rightFileDeleteConfirmOpen.value = false
  rightFileToDelete.value = ''
}

async function uploadRightSupportingFile(event: Event) {
  if (!selectedLandId.value) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  rightFileUploading.value = true
  error.value = null
  try {
    const url = await uploadLandRightFile(file, selectedLandId.value, editingRightId.value ?? undefined)
    const current = rightForm.value.supportingDocuments.trim()
    rightForm.value.supportingDocuments = current ? `${current}\n${url}` : url
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить файл'
  } finally {
    rightFileUploading.value = false
    input.value = ''
  }
}

function requestRemoveRightSupportingFile(link: string) {
  rightFileToDelete.value = link
  rightFileDeleteConfirmOpen.value = true
}

function closeRightFileDeleteConfirm() {
  if (saving.value || rightFileUploading.value) return
  rightFileDeleteConfirmOpen.value = false
  rightFileToDelete.value = ''
}

function confirmRemoveRightSupportingFile() {
  const target = rightFileToDelete.value
  if (!target) return
  const links = rightForm.value.supportingDocuments
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//i.test(x))
  const index = links.indexOf(target)
  if (index >= 0) links.splice(index, 1)
  rightForm.value.supportingDocuments = links.join('\n')
  rightFileDeleteConfirmOpen.value = false
  rightFileToDelete.value = ''
}

function resetUserForm() {
  userForm.value = {
    holderMode: 'manual',
    holderRefId: '',
    holderName: '',
    holderInn: '',
    holderKpp: '',
    holderOgrn: '',
    rightType: '',
    documentType: '',
    supportingDocuments: '',
    startsAt: '',
    endsAt: '',
    usageAreaHa: null,
  }
}

function openUserModal() {
  editingUserId.value = null
  resetUserForm()
  userModalOpen.value = true
}

function openUserEditModal(user: LandUserRow) {
  editingUserId.value = user.id
  userForm.value = {
    holderMode: user.holder_mode ?? 'manual',
    holderRefId: user.right_holder_id ?? '',
    holderName: user.holder_name ?? user.organization_name ?? user.person_name ?? '',
    holderInn: user.holder_inn ?? user.inn ?? '',
    holderKpp: user.holder_kpp ?? '',
    holderOgrn: user.holder_ogrn ?? '',
    rightType: user.right_type ?? '',
    documentType: user.document_type ?? '',
    supportingDocuments: user.supporting_documents ?? '',
    startsAt: user.starts_at ?? '',
    endsAt: user.ends_at ?? '',
    usageAreaHa: user.usage_area_ha ?? null,
  }
  userModalOpen.value = true
}

function closeUserModal() {
  if (saving.value || userFileUploading.value) return
  userModalOpen.value = false
  editingUserId.value = null
  userFileDeleteConfirmOpen.value = false
  userFileToDelete.value = ''
}

async function uploadUserSupportingFile(event: Event) {
  if (!selectedLandId.value) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  userFileUploading.value = true
  error.value = null
  try {
    const url = await uploadLandRightFile(file, selectedLandId.value, editingUserId.value ?? undefined)
    const current = userForm.value.supportingDocuments.trim()
    userForm.value.supportingDocuments = current ? `${current}\n${url}` : url
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить файл'
  } finally {
    userFileUploading.value = false
    input.value = ''
  }
}

function requestRemoveUserSupportingFile(link: string) {
  userFileToDelete.value = link
  userFileDeleteConfirmOpen.value = true
}

function closeUserFileDeleteConfirm() {
  if (saving.value || userFileUploading.value) return
  userFileDeleteConfirmOpen.value = false
  userFileToDelete.value = ''
}

function confirmRemoveUserSupportingFile() {
  const target = userFileToDelete.value
  if (!target) return
  const links = userForm.value.supportingDocuments
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//i.test(x))
  const index = links.indexOf(target)
  if (index >= 0) links.splice(index, 1)
  userForm.value.supportingDocuments = links.join('\n')
  userFileDeleteConfirmOpen.value = false
  userFileToDelete.value = ''
}

function setFormFromLand(land: LandRow | null) {
  if (!land) {
    form.value = {
      number: (isLandsRegistryPaginated() ? maxLandNumber.value : (lands.value.at(-1)?.number ?? 0)) + 1,
      name: '',
      landTypeId: '',
      landCategory: '',
      region: '',
      area: 0,
      cadastralNumber: '',
      permittedUseDocs: '',
      efgisZsnFieldNumber: '',
      geolocation: '',
      address: '',
      locationDescription: '',
      documentAreaHa: null,
      isAgriLand: '',
      agriLandAreaHa: null,
      isValuableAgriLand: '',
      irrigatedAreaHa: null,
      drainedAreaHa: null,
      actualUseStatus: '',
      breedingUse: '',
      otherUseInfo: '',
      notes: '',
    }
    mapLat.value = 55.7558
    mapLon.value = 37.6176
    mapGeometryMode.value = 'polygon'
    mapContourDraftPoints.value = []
    addressCandidates.value = []
    selectedAddressCandidate.value = ''
    return
  }
  form.value = {
    number: land.number,
    name: land.name,
    landTypeId: land.land_type_id ?? '',
    landCategory: land.land_category ?? '',
    region: land.region ?? '',
    area: Number(land.area ?? 0),
    cadastralNumber: land.cadastral_number ?? '',
    permittedUseDocs: land.permitted_use_docs ?? '',
    efgisZsnFieldNumber: land.efgis_zsn_field_number ?? '',
    geolocation: land.center_lat != null && land.center_lon != null ? `${land.center_lat}, ${land.center_lon}` : '',
    address: land.address ?? '',
    locationDescription: land.location_description ?? '',
    documentAreaHa: land.document_area_ha,
    isAgriLand: land.agri_land_type_id ?? '',
    agriLandAreaHa: land.agri_land_area_ha,
    isValuableAgriLand: land.is_valuable_agri_land == null ? '' : land.is_valuable_agri_land ? 'yes' : 'no',
    irrigatedAreaHa: land.irrigated_area_ha,
    drainedAreaHa: land.drained_area_ha,
    actualUseStatus: land.actual_use_status ?? '',
    breedingUse: land.breeding_use == null ? '' : land.breeding_use ? 'yes' : 'no',
    otherUseInfo: land.other_use_info ?? '',
    notes: land.notes ?? '',
  }
  const center = getLandContourCenter(land.contour_geojson)
  mapGeometryMode.value = land.geometry_mode ?? 'polygon'
  mapContourDraftPoints.value = fromPolygonGeoJson(land.contour_geojson, { requireType: false })
  if (center) {
    mapLat.value = center.lat
    mapLon.value = center.lon
    form.value.geolocation = `${Number(center.lat.toFixed(6))}, ${Number(center.lon.toFixed(6))}`
  }
  if (form.value.address.trim()) {
    addressCandidates.value = [form.value.address.trim()]
    selectedAddressCandidate.value = form.value.address.trim()
  } else {
    addressCandidates.value = []
    selectedAddressCandidate.value = ''
  }
}

function parseGeolocationString(raw: string): { lat: number; lon: number } | null {
  const parts = raw.split(',').map((x) => Number(x.trim()))
  if (parts.length !== 2 || parts.some((x) => Number.isNaN(x))) return null
  const [lat, lon] = parts
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}

function selectLand(id: string) {
  selectedLandId.value = id
  setFormFromLand(lands.value.find((x) => x.id === id) ?? null)
}

function openLandPage(id: string) {
  selectLand(id)
  void router.push({ name: 'land-details', params: { id } })
}

function goToRegistry() {
  void router.push({ name: 'lands' })
}

function goToFieldDetails(fieldId: string) {
  void router.push({ name: 'field-details', params: { id: fieldId } })
}

function fieldCropLabel(cropKey: string | null): string {
  if (!cropKey) return '—'
  return cropLabelMap.value.get(cropKey) ?? CROP_KEY_TO_NAME[cropKey] ?? cropKey
}

function fieldCropPillClass(cropKey: string | null): string {
  if (!cropKey || cropKey === 'none') return 'lands-crop-pill lands-crop-pill--grey'
  if (cropKey === 'meadow') return 'lands-crop-pill lands-crop-pill--meadow'
  if (cropKey === 'sunflower') return 'lands-crop-pill lands-crop-pill--sunflower'
  if (cropKey === 'soy') return 'lands-crop-pill lands-crop-pill--soy'
  return 'lands-crop-pill lands-crop-pill--wheat'
}

function formatRotationMetric(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
}

/** Дата из базы «ГГГГ-ММ-ДД» — по-русски «ДД.ММ.ГГГГ». */
function formatIsoDate(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value || '—'
}

function realEstateFieldLabel(fieldId: string | null): string {
  if (!fieldId) return '—'
  const f = cropRotationFieldMap.value.get(fieldId)
  return f ? `№${f.number} ${f.name}` : '—'
}

function meliorationFieldLabel(fieldId: string | null): string {
  if (!fieldId) return '—'
  const f = cropRotationFieldMap.value.get(fieldId)
  if (!f) return '—'
  const name = f.name?.trim() || `Поле №${f.number}`
  const cad = f.cadastral_number?.trim() ? ` · Кад: ${f.cadastral_number}` : ' · Кад: —'
  return `${name}${cad}`
}

function meliorationExportData() {
  if (meliorationTab.value === 'systems') {
    const headers = [
      '№ поля ЕФИС ЗСН',
      'Тип мелиорации',
      'Вид мелиорации',
      'Описание системы и местоположения',
      'Кадастровый номер земельного участка',
      'Дата ввода в эксплуатацию',
      'Площадь орошаемых (осушаемых) земель, га',
    ]
    const rows = meliorationEntriesByTab.value.map((x) => [
      meliorationFieldLabel(x.field_id),
      x.melioration_type || '—',
      x.melioration_subtype || '—',
      x.description_location || '—',
      x.cadastral_number || '—',
      x.commissioned_at || '—',
      formatRotationMetric(x.irrigated_area_ha ?? x.area_ha),
    ])
    return { headers, rows }
  }
  if (meliorationTab.value === 'forest') {
    const headers = [
      '№ поля ЕФИС ЗСН',
      'Площадь МЗЛН, га',
      'Количественные, качественные характеристики',
      'Год создания',
      'Информация о реконструкции насаждений',
      'Кадастровый номер земельного участка',
    ]
    const rows = meliorationEntriesByTab.value.map((x) => [
      meliorationFieldLabel(x.field_id),
      formatRotationMetric(x.forest_area_ha ?? x.area_ha),
      x.forest_characteristics || '—',
      x.forest_year_created == null ? '—' : String(x.forest_year_created),
      x.reconstruction_info || '—',
      x.cadastral_number || '—',
    ])
    return { headers, rows }
  }
  const headers = [
    '№ поля ЕФИС ЗСН',
    'Тип мероприятия',
    'Дата проведения',
    'Площадь земельного участка, га',
    'Согласование проектов мелиорации',
  ]
  const rows = meliorationEntriesByTab.value.map((x) => [
    meliorationFieldLabel(x.field_id),
    x.event_type || '—',
    x.event_date || '—',
    formatRotationMetric(x.area_ha),
    x.project_approval || '—',
  ])
  return { headers, rows }
}

function openCreateLand() {
  selectedLandId.value = ''
  activeTab.value = 'info'
  landEditorMode.value = 'create'
  landEditorOpen.value = true
  setFormFromLand(null)
}

function showSuccess(message: string) {
  successModalText.value = message
  setTimeout(() => {
    successModalOpen.value = true
  }, 120)
}

function closeSuccessModal() {
  successModalOpen.value = false
}

function openEditLand(landId: string) {
  const land = lands.value.find((x) => x.id === landId)
  if (!land) return
  selectedLandId.value = landId
  activeTab.value = 'info'
  setFormFromLand(land)
  landEditorMode.value = 'edit'
  landEditorOpen.value = true
}

function startInlineEdit() {
  if (!selectedLand.value) return
  setFormFromLand(selectedLand.value)
  activeTab.value = 'info'
  landInlineEditOpen.value = true
}

function closeLandEditor() {
  landEditorOpen.value = false
  landInlineEditOpen.value = false
}

function getLandContourCenter(contour: Record<string, unknown> | null): { lat: number; lon: number } | null {
  const coordinates = (contour as { coordinates?: unknown })?.coordinates
  if (!Array.isArray(coordinates) || !Array.isArray(coordinates[0])) return null
  const ring = coordinates[0] as unknown[]
  const points = ring
    .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] : null))
    .filter((p): p is [number, number] => Boolean(p && Number.isFinite(p[0]) && Number.isFinite(p[1])))
  if (!points.length) return null
  const lon = points.reduce((sum, p) => sum + p[0], 0) / points.length
  const lat = points.reduce((sum, p) => sum + p[1], 0) / points.length
  return { lat, lon }
}

function tryFillRegionFromAddress(address: string) {
  if (form.value.region.trim()) return
  const match = address.match(/([А-Яа-яЁёA-Za-z\- ]+\s(?:область|край|республика|АО|автономный округ))/)
  if (match?.[1]) form.value.region = match[1].trim()
}

function applyAddressCandidates(candidates: string[]) {
  const unique = Array.from(new Set(candidates.map((x) => x.trim()).filter(Boolean)))
  addressCandidates.value = unique
  if (!unique.length) {
    selectedAddressCandidate.value = ''
    return
  }
  if (!form.value.address.trim()) {
    form.value.address = unique[0] ?? ''
  }
  selectedAddressCandidate.value = form.value.address.trim() || unique[0] || ''
}

function onAddressCandidateChange() {
  if (!selectedAddressCandidate.value) return
  form.value.address = selectedAddressCandidate.value
  tryFillRegionFromAddress(selectedAddressCandidate.value)
}

async function loadEquipmentRefsSafe() {
  if (!isSupabaseConfigured()) {
    equipmentTypeRefs.value = []
    equipmentConditionRefs.value = []
    return
  }
  try {
    const [types, conditions] = await Promise.all([
      loadEquipmentTypeRefs(),
      loadEquipmentConditionRefs(),
    ])
    equipmentTypeRefs.value = types
    equipmentConditionRefs.value = conditions
  } catch (err) {
    // Справочники техники не должны ломать раздел «Земли»: показываем пустые
    // списки, но сбой больше не исчезает бесследно.
    console.error('Справочники техники', err)
    equipmentTypeRefs.value = []
    equipmentConditionRefs.value = []
  }
}

async function loadFieldMunicipalityRefsSafe() {
  if (!isSupabaseConfigured()) {
    fieldMunicipalityRefs.value = []
    return
  }
  try {
    fieldMunicipalityRefs.value = await loadFieldMunicipalitiesRefs()
  } catch (err) {
    console.error('Справочник муниципалитетов', err)
    fieldMunicipalityRefs.value = []
  }
}

async function loadCropRotationTypeRefsSafe() {
  if (!isSupabaseConfigured()) {
    cropRotationTypeRefs.value = []
    return
  }
  try {
    cropRotationTypeRefs.value = await loadLandCropRotationTypes()
  } catch (err) {
    console.error('Справочник типов севооборота', err)
    cropRotationTypeRefs.value = []
  }
}

async function loadStorageRefsSafe() {
  if (!isSupabaseConfigured()) {
    storageLocationTypeRefs.value = []
    storageLocationStatusRefs.value = []
    storageFillStatusRefs.value = []
    return
  }
  try {
    const [types, statuses, fills] = await Promise.all([
      loadStorageLocationTypes(),
      loadStorageLocationStatuses(),
      loadStorageFillStatuses(),
    ])
    storageLocationTypeRefs.value = types
    storageLocationStatusRefs.value = statuses
    storageFillStatusRefs.value = fills
  } catch (err) {
    console.error('Справочники мест хранения', err)
    storageLocationTypeRefs.value = []
    storageLocationStatusRefs.value = []
    storageFillStatusRefs.value = []
  }
}

/**
 * Выборка точек контура для обратного геокодирования. Намеренно своя: здесь
 * берутся первые шесть точек подряд, а общая `contourSamplePoints` из
 * `@/lib/geoContour` раскладывает пять точек равномерно по кольцу. Какое
 * поведение верное — вопрос к разделу земель, поэтому оставлено как было.
 */
function contourSamplePoints(points: LatLon[], center: { lat: number; lon: number } | null): Array<{ lat: number; lon: number }> {
  const sample: Array<{ lat: number; lon: number }> = []
  if (center) sample.push({ lat: center.lat, lon: center.lon })
  const limit = Math.min(points.length, 6)
  for (let i = 0; i < limit; i += 1) {
    const p = points[i]
    if (!p) continue
    sample.push({ lat: p[0], lon: p[1] })
  }
  return sample
}

async function reloadLandDetails() {
  if (!selectedLandId.value || !isSupabaseConfigured()) {
    landRights.value = []
    landUsers.value = []
    landCropRotations.value = []
    landRealEstateObjects.value = []
    landMeliorationEntries.value = []
    return
  }
  const [rightsRows, usersRows, cropRotationRows, realEstateRows, meliorationRows] = await Promise.all([
    loadLandRights(selectedLandId.value),
    loadLandUsers(selectedLandId.value),
    loadLandCropRotations(selectedLandId.value),
    loadLandRealEstateObjects(selectedLandId.value),
    loadLandMeliorationEntries(selectedLandId.value),
  ])
  landRights.value = rightsRows
  landUsers.value = usersRows
  landCropRotations.value = cropRotationRows
  landRealEstateObjects.value = realEstateRows
  landMeliorationEntries.value = meliorationRows
}

function isLandsRegistryPaginated(): boolean {
  return !isDetailsMode.value && landsRootTab.value === 'registry'
}

async function loadLandsForCurrentView(): Promise<LandsPageResult> {
  if (isLandsRegistryPaginated()) {
    return loadLandsPage({ search: landsSearch.value, page: landsPage.value, pageSize: landsPageSize.value })
  }
  const rows = await loadLands('')
  return { rows, total: rows.length }
}

async function reloadMeliorationList() {
  if (!isSupabaseConfigured() || isDetailsMode.value || landsRootTab.value !== 'melioration') return
  const requestId = ++meliorationRequestId
  try {
    const result = await loadLandMeliorationEntriesPage({
      melioration_kind: MELIORATION_KIND_MAP[meliorationTab.value],
      page: meliorationPage.value,
      pageSize: meliorationPageSize.value,
    })
    if (requestId !== meliorationRequestId) return
    landMeliorationEntries.value = result.rows
    meliorationTotal.value = result.total
  } catch (e) {
    if (requestId !== meliorationRequestId) return
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить мелиорацию'
  }
}

async function reloadAll() {
  if (!isSupabaseConfigured()) return
  loading.value = true
  error.value = null
  try {
    const [
      landsResult,
      landTypeRows,
      landCategoryRows,
      fieldRows,
      useOptions,
      cropsRows,
      ownershipFormsRows,
      rightTypesRows,
      rightDocumentTypesRows,
      holderTypesRows,
      holdersRows,
      meliorationTypesRows,
      meliorationSubtypesRows,
      meliorationEventTypesRows,
      cropRotationTypeRows,
      storageLocTypeRows,
      storageLocStatusRows,
      storageFillStatusRows,
    ] = await Promise.all([
      loadLandsForCurrentView(),
      loadLandTypes(),
      loadLandCategories(),
      loadFields(),
      loadLandActualUseOptions(),
      loadCrops(),
      loadLandRightOwnershipForms(),
      loadLandRightTypes(),
      loadLandRightDocumentTypes(),
      loadLandRightHolderTypes(),
      loadLandRightHolders(),
      loadLandMeliorationTypes(),
      loadLandMeliorationSubtypes(),
      loadLandMeliorationEventTypes(),
      loadLandCropRotationTypes(),
      loadStorageLocationTypes(),
      loadStorageLocationStatuses(),
      loadStorageFillStatuses(),
    ])
    const landsRows = landsResult.rows
    lands.value = landsRows
    landsTotal.value = landsResult.total
    if (isLandsRegistryPaginated()) maxLandNumber.value = await loadMaxLandNumber()
    landTypes.value = landTypeRows
    landCategories.value = landCategoryRows
    actualUseOptions.value = useOptions
    crops.value = cropsRows
    fields.value = fieldRows
    landRightOwnershipForms.value = ownershipFormsRows
    landRightTypes.value = rightTypesRows
    landRightDocumentTypes.value = rightDocumentTypesRows
    landRightHolderTypes.value = holderTypesRows
    landRightHolders.value = holdersRows
    landMeliorationTypes.value = meliorationTypesRows
    landMeliorationSubtypes.value = meliorationSubtypesRows
    landMeliorationEventTypes.value = meliorationEventTypesRows
    cropRotationTypeRefs.value = cropRotationTypeRows
    storageLocationTypeRefs.value = storageLocTypeRows
    storageLocationStatusRefs.value = storageLocStatusRows
    storageFillStatusRefs.value = storageFillStatusRows
    await Promise.all([loadEquipmentRefsSafe(), loadFieldMunicipalityRefsSafe()])
    const targetId = routeLandId.value || selectedLandId.value
    if (targetId) {
      selectedLandId.value = targetId
      const exists = landsRows.some((x) => x.id === selectedLandId.value)
      if (!exists) selectedLandId.value = ''
    }
    if (selectedLandId.value) setFormFromLand(landsRows.find((x) => x.id === selectedLandId.value) ?? null)
    else setFormFromLand(null)
    if (isDetailsMode.value || selectedLandId.value) {
      await reloadLandDetails()
    } else if (landsRootTab.value === 'melioration') {
      await reloadMeliorationList()
    } else {
      landMeliorationEntries.value = []
      meliorationTotal.value = 0
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить земли'
  } finally {
    loading.value = false
  }
}

async function reloadLandsRegistryList() {
  if (!isSupabaseConfigured() || isDetailsMode.value || landsRootTab.value !== 'registry') return
  const requestId = ++landsSearchRequestId
  try {
    const result = await loadLandsForCurrentView()
    if (requestId !== landsSearchRequestId) return
    lands.value = result.rows
    landsTotal.value = result.total
    if (isLandsRegistryPaginated()) maxLandNumber.value = await loadMaxLandNumber()
  } catch (e) {
    if (requestId !== landsSearchRequestId) return
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить земли'
  }
}

async function saveLand() {
  if (!isSupabaseConfigured()) return
  saving.value = true
  error.value = null
  try {
    const geo = parseGeolocationString(form.value.geolocation)
    const centerLat = geo?.lat ?? null
    const centerLon = geo?.lon ?? null
    if (selectedLandId.value) {
      await updateLand(selectedLandId.value, {
        number: Math.max(1, Math.trunc(form.value.number || 1)),
        name: getLandDisplayName(),
        land_type_id: form.value.landTypeId || null,
        land_category: form.value.landCategory || null,
        region: form.value.region || null,
        area: Number(form.value.area || 0),
        cadastral_number: form.value.cadastralNumber || null,
        permitted_use_docs: form.value.permittedUseDocs || null,
        center_lat: centerLat,
        center_lon: centerLon,
        address: form.value.address || null,
        location_description: form.value.locationDescription || null,
        document_area_ha: form.value.documentAreaHa,
        coordinate_area_ha: mapGeometryMode.value === 'polygon' ? Number(form.value.area || 0) : null,
        geometry_mode: mapGeometryMode.value,
        contour_geojson: mapGeometryMode.value === 'polygon' ? toPolygonGeoJson(mapContourDraftPoints.value) : null,
        is_agri_land: form.value.isAgriLand ? true : null,
        agri_land_type_id: form.value.isAgriLand || null,
        agri_land_area_ha: form.value.agriLandAreaHa,
        is_valuable_agri_land: form.value.isValuableAgriLand === '' ? null : form.value.isValuableAgriLand === 'yes',
        irrigated_area_ha: form.value.irrigatedAreaHa,
        drained_area_ha: form.value.drainedAreaHa,
        actual_use_status: form.value.actualUseStatus || null,
        breeding_use: form.value.breedingUse === '' ? null : form.value.breedingUse === 'yes',
        other_use_info: form.value.otherUseInfo || null,
        notes: form.value.notes || null,
      })
    } else {
      const created = await addLand({
        number: Math.max(1, Math.trunc(form.value.number || 1)),
        name: getLandDisplayName(),
        land_type_id: form.value.landTypeId || null,
        land_category: form.value.landCategory || null,
        region: form.value.region || null,
        area: Number(form.value.area || 0),
        cadastral_number: form.value.cadastralNumber || null,
        permitted_use_docs: form.value.permittedUseDocs || null,
        center_lat: centerLat,
        center_lon: centerLon,
        address: form.value.address || null,
        location_description: form.value.locationDescription || null,
        document_area_ha: form.value.documentAreaHa,
        coordinate_area_ha: mapGeometryMode.value === 'polygon' ? Number(form.value.area || 0) : null,
        geometry_mode: mapGeometryMode.value,
        contour_geojson: mapGeometryMode.value === 'polygon' ? toPolygonGeoJson(mapContourDraftPoints.value) : null,
        is_agri_land: form.value.isAgriLand ? true : null,
        agri_land_type_id: form.value.isAgriLand || null,
        agri_land_area_ha: form.value.agriLandAreaHa,
        is_valuable_agri_land: form.value.isValuableAgriLand === '' ? null : form.value.isValuableAgriLand === 'yes',
        irrigated_area_ha: form.value.irrigatedAreaHa,
        drained_area_ha: form.value.drainedAreaHa,
        actual_use_status: form.value.actualUseStatus || null,
        breeding_use: form.value.breedingUse === '' ? null : form.value.breedingUse === 'yes',
        other_use_info: form.value.otherUseInfo || null,
        notes: form.value.notes || null,
      })
      selectedLandId.value = created.id
    }
    await reloadAll()
    if (isDetailsMode.value) landInlineEditOpen.value = false
    else landEditorOpen.value = false
    showSuccess(selectedLandId.value ? 'Данные участка успешно сохранены' : 'Участок успешно добавлен')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось сохранить землю'
  } finally {
    saving.value = false
  }
}

async function removeLand(skipConfirm = false) {
  if (!selectedLandId.value || !isSupabaseConfigured()) return
  if (!skipConfirm && !(await askConfirm('Удалить землю?', 'Поля останутся, но будут отвязаны от этой земли.'))) return
  saving.value = true
  error.value = null
  try {
    await deleteLand(selectedLandId.value)
    selectedLandId.value = ''
    landEditorOpen.value = false
    landInlineEditOpen.value = false
    if (isDetailsMode.value) {
      goToRegistry()
    }
    await reloadAll()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось удалить землю'
  } finally {
    saving.value = false
  }
}

async function linkFieldToSelectedLand(fieldId: string) {
  if (!selectedLandId.value || !isSupabaseConfigured()) return
  try {
    await updateField(fieldId, { land_id: selectedLandId.value })
    fields.value = await loadFields()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось привязать поле'
  }
}

async function unlinkField(fieldId: string) {
  if (!isSupabaseConfigured()) return
  try {
    await updateField(fieldId, { land_id: null })
    fields.value = await loadFields()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось отвязать поле'
  }
}

async function saveLandRight() {
  if (!selectedLandId.value || !isSupabaseConfigured()) return
  if (!rightForm.value.holderName.trim()) {
    error.value = 'Заполните наименование правообладателя'
    return
  }
  if (!rightForm.value.holderInn.trim()) {
    error.value = 'Заполните ИНН правообладателя'
    return
  }
  if (!rightForm.value.holderOgrn.trim()) {
    error.value = 'Заполните ОГРН правообладателя'
    return
  }
  if (!rightForm.value.cadastralNumber.trim()) {
    error.value = 'Заполните кадастровый номер'
    return
  }
  if (!rightForm.value.ownershipForm.trim()) {
    error.value = 'Заполните форму собственности'
    return
  }
  if (!rightForm.value.rightType.trim()) {
    error.value = 'Заполните вид права'
    return
  }
  if (!rightForm.value.documentType.trim()) {
    error.value = 'Заполните тип подтверждающего документа'
    return
  }
  if (!isDateRangeValid(rightForm.value.startsAt, rightForm.value.endsAt)) {
    error.value = 'Проверьте период права: дата окончания раньше даты начала'
    return
  }
  saving.value = true
  error.value = null
  try {
    if (editingRightId.value) {
      await updateLandRight(editingRightId.value, {
        holder_mode: rightForm.value.holderMode,
        right_type: rightForm.value.rightType,
        holder_name: rightForm.value.holderName,
        holder_inn: rightForm.value.holderInn || null,
        holder_kpp: rightForm.value.holderKpp || null,
        holder_ogrn: rightForm.value.holderOgrn || null,
        cadastral_number: rightForm.value.cadastralNumber || null,
        ownership_form: rightForm.value.ownershipForm || null,
        document_type: rightForm.value.documentType || null,
        supporting_documents: rightForm.value.supportingDocuments || null,
        document_name: rightForm.value.documentName || null,
        document_number: rightForm.value.documentNumber || null,
        document_date: rightForm.value.documentDate || null,
        starts_at: rightForm.value.startsAt || null,
        ends_at: rightForm.value.endsAt || null,
        notes: rightForm.value.notes || null,
      })
    } else {
      await addLandRight({
        land_id: selectedLandId.value,
        holder_mode: rightForm.value.holderMode,
        right_type: rightForm.value.rightType,
        holder_name: rightForm.value.holderName,
        holder_inn: rightForm.value.holderInn || null,
        holder_kpp: rightForm.value.holderKpp || null,
        holder_ogrn: rightForm.value.holderOgrn || null,
        cadastral_number: rightForm.value.cadastralNumber || null,
        ownership_form: rightForm.value.ownershipForm || null,
        document_type: rightForm.value.documentType || null,
        supporting_documents: rightForm.value.supportingDocuments || null,
        document_name: rightForm.value.documentName || null,
        document_number: rightForm.value.documentNumber || null,
        document_date: rightForm.value.documentDate || null,
        starts_at: rightForm.value.startsAt || null,
        ends_at: rightForm.value.endsAt || null,
        notes: rightForm.value.notes || null,
      })
    }
    resetRightForm()
    rightModalOpen.value = false
    editingRightId.value = null
    await reloadLandDetails()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось сохранить право владения'
  } finally {
    saving.value = false
  }
}

async function removeLandRight(id: string) {
  if (!isSupabaseConfigured()) return
  saving.value = true
  error.value = null
  try {
    await deleteLandRight(id)
    await reloadLandDetails()
    showSuccess('Право владения удалено')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось удалить право владения'
  } finally {
    saving.value = false
  }
}

async function saveLandUser() {
  if (!selectedLandId.value || !isSupabaseConfigured()) return
  if (!userForm.value.holderName.trim()) {
    error.value = 'Заполните наименование правообладателя'
    return
  }
  if (!userForm.value.holderInn.trim()) {
    error.value = 'Заполните ИНН'
    return
  }
  if (!userForm.value.holderOgrn.trim()) {
    error.value = 'Заполните ОГРН'
    return
  }
  if (!userForm.value.rightType.trim()) {
    error.value = 'Выберите вид права'
    return
  }
  if (!userForm.value.documentType.trim()) {
    error.value = 'Выберите тип подтверждающего документа'
    return
  }
  if (!userForm.value.supportingDocuments.trim()) {
    error.value = 'Загрузите подтверждающий документ'
    return
  }
  if (!userForm.value.startsAt || !userForm.value.endsAt) {
    error.value = 'Заполните даты начала и окончания'
    return
  }
  if (userForm.value.usageAreaHa == null || Number(userForm.value.usageAreaHa) <= 0) {
    error.value = 'Укажите площадь использования поля, га'
    return
  }
  if (!isDateRangeValid(userForm.value.startsAt, userForm.value.endsAt)) {
    error.value = 'Проверьте период пользования: дата окончания раньше даты начала'
    return
  }
  saving.value = true
  error.value = null
  try {
    const payload = {
      holder_mode: userForm.value.holderMode,
      right_holder_id: userForm.value.holderMode === 'reference' ? (userForm.value.holderRefId || null) : null,
      holder_name: userForm.value.holderName || null,
      holder_inn: userForm.value.holderInn || null,
      holder_kpp: userForm.value.holderKpp || null,
      holder_ogrn: userForm.value.holderOgrn || null,
      right_type: userForm.value.rightType || null,
      document_type: userForm.value.documentType || null,
      supporting_documents: userForm.value.supportingDocuments || null,
      starts_at: userForm.value.startsAt || null,
      ends_at: userForm.value.endsAt || null,
      usage_area_ha: userForm.value.usageAreaHa,
      organization_name: userForm.value.holderName || null,
      person_name: null,
      inn: userForm.value.holderInn || null,
      basis: userForm.value.rightType || null,
      notes: null,
    }
    if (editingUserId.value) {
      await updateLandUser(editingUserId.value, payload)
    } else {
      await addLandUser({
        land_id: selectedLandId.value,
        ...payload,
      })
    }
    resetUserForm()
    editingUserId.value = null
    userModalOpen.value = false
    await reloadLandDetails()
    showSuccess('Землепользователь успешно сохранен')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось сохранить землепользователя'
  } finally {
    saving.value = false
  }
}

async function removeLandUser(id: string) {
  if (!isSupabaseConfigured()) return
  saving.value = true
  error.value = null
  try {
    await deleteLandUser(id)
    await reloadLandDetails()
    showSuccess('Землепользователь удален')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось удалить землепользователя'
  } finally {
    saving.value = false
  }
}

function openCropRotationModal() {
  editingCropRotationId.value = null
  cropRotationForm.value = {
    fieldId: '',
    season: '',
    rotationType: '',
    cropKey: '',
    seedMaterialName: '',
    areaForCropsHa: null,
    areaWithImprovedProductsHa: null,
    areaForOrganicHa: null,
    areaForSelectionSeedHa: null,
    producedProductsInfo: '',
    producedCropMassTons: null,
  }
  cropRotationModalOpen.value = true
}

function openCropRotationEditModal(rotation: LandCropRotationRow) {
  editingCropRotationId.value = rotation.id
  cropRotationForm.value = {
    fieldId: rotation.field_id,
    season: rotation.season ?? '',
    rotationType: rotation.rotation_type ?? '',
    cropKey: rotation.crop_key ?? '',
    seedMaterialName: rotation.seed_material_name ?? '',
    areaForCropsHa: rotation.area_for_crops_ha,
    areaWithImprovedProductsHa: rotation.area_with_improved_products_ha,
    areaForOrganicHa: rotation.area_for_organic_ha,
    areaForSelectionSeedHa: rotation.area_for_selection_seed_ha,
    producedProductsInfo: rotation.produced_products_info ?? '',
    producedCropMassTons: rotation.produced_crop_mass_tons,
  }
  cropRotationModalOpen.value = true
}

function closeCropRotationModal() {
  editingCropRotationId.value = null
  cropRotationModalOpen.value = false
}

async function saveCropRotation() {
  if (!selectedLandId.value || !cropRotationForm.value.fieldId || !isSupabaseConfigured()) return
  saving.value = true
  error.value = null
  try {
    if (editingCropRotationId.value) {
      await updateLandCropRotation(editingCropRotationId.value, {
        field_id: cropRotationForm.value.fieldId,
        season: cropRotationForm.value.season || null,
        rotation_type: cropRotationForm.value.rotationType || null,
        crop_key: cropRotationForm.value.cropKey || null,
        seed_material_name: cropRotationForm.value.seedMaterialName || null,
        area_for_crops_ha: cropRotationForm.value.areaForCropsHa,
        area_with_improved_products_ha: cropRotationForm.value.areaWithImprovedProductsHa,
        area_for_organic_ha: cropRotationForm.value.areaForOrganicHa,
        area_for_selection_seed_ha: cropRotationForm.value.areaForSelectionSeedHa,
        produced_products_info: cropRotationForm.value.producedProductsInfo || null,
        produced_crop_mass_tons: cropRotationForm.value.producedCropMassTons,
      })
    } else {
      await addLandCropRotation({
        land_id: selectedLandId.value,
        field_id: cropRotationForm.value.fieldId,
        season: cropRotationForm.value.season || null,
        rotation_type: cropRotationForm.value.rotationType || null,
        crop_key: cropRotationForm.value.cropKey || null,
        seed_material_name: cropRotationForm.value.seedMaterialName || null,
        area_for_crops_ha: cropRotationForm.value.areaForCropsHa,
        area_with_improved_products_ha: cropRotationForm.value.areaWithImprovedProductsHa,
        area_for_organic_ha: cropRotationForm.value.areaForOrganicHa,
        area_for_selection_seed_ha: cropRotationForm.value.areaForSelectionSeedHa,
        produced_products_info: cropRotationForm.value.producedProductsInfo || null,
        produced_crop_mass_tons: cropRotationForm.value.producedCropMassTons,
      })
    }
    closeCropRotationModal()
    await reloadLandDetails()
    showSuccess('Запись севооборота успешно сохранена')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось сохранить запись севооборота'
  } finally {
    saving.value = false
  }
}

watch(() => cropRotationForm.value.fieldId, (fieldId) => {
  const field = assignedFields.value.find((f) => f.id === fieldId)
  cropRotationForm.value.areaForCropsHa = field ? Number(field.area) : null
})

watch(() => rightForm.value.holderRefId, (holderId) => {
  if (!holderId || rightForm.value.holderMode !== 'reference') return
  const holder = landRightHolders.value.find((x) => x.id === holderId)
  if (!holder) return
  rightForm.value.holderTypeId = holder.holder_type_id ?? ''
  rightForm.value.holderName = holder.name
  rightForm.value.holderInn = holder.inn ?? ''
  rightForm.value.holderKpp = holder.kpp ?? ''
  rightForm.value.holderOgrn = holder.ogrn ?? ''
})

watch(() => userForm.value.holderRefId, (holderId) => {
  if (!holderId || userForm.value.holderMode !== 'reference') return
  const holder = landRightHolders.value.find((x) => x.id === holderId)
  if (!holder) return
  userForm.value.holderName = holder.name
  userForm.value.holderInn = holder.inn ?? ''
  userForm.value.holderKpp = holder.kpp ?? ''
  userForm.value.holderOgrn = holder.ogrn ?? ''
})

async function removeCropRotation(id: string) {
  if (!id || !isSupabaseConfigured()) return
  saving.value = true
  error.value = null
  try {
    await deleteLandCropRotation(id)
    await reloadLandDetails()
    showSuccess('Запись севооборота удалена')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось удалить запись севооборота'
  } finally {
    saving.value = false
  }
}

function openRealEstateModal() {
  editingRealEstateId.value = null
  realEstateForm.value = {
    fieldId: '',
    cadastralNumber: '',
    name: '',
    locationDescription: '',
    areaSqm: null,
    permittedUse: '',
    purpose: '',
    address: '',
    depthM: null,
    heightM: null,
    lengthM: null,
    volumeM3: null,
    burialDepthM: null,
    developmentPlan: '',
    floors: '',
    undergroundFloors: '',
  }
  realEstateModalOpen.value = true
}

function openRealEstateEditModal(row: LandRealEstateObjectRow) {
  editingRealEstateId.value = row.id
  realEstateForm.value = {
    fieldId: row.field_id ?? '',
    cadastralNumber: row.cadastral_number,
    name: row.name ?? '',
    locationDescription: row.location_description ?? '',
    areaSqm: row.area_sqm,
    permittedUse: row.permitted_use ?? '',
    purpose: row.purpose ?? '',
    address: row.address ?? '',
    depthM: row.depth_m,
    heightM: row.height_m,
    lengthM: row.length_m,
    volumeM3: row.volume_m3,
    burialDepthM: row.burial_depth_m,
    developmentPlan: row.development_plan ?? '',
    floors: row.floors ?? '',
    undergroundFloors: row.underground_floors ?? '',
  }
  realEstateModalOpen.value = true
}

function closeRealEstateModal() {
  editingRealEstateId.value = null
  realEstateModalOpen.value = false
}

function requestDeleteCropRotation(id: string) {
  deleteTarget.value = { type: 'crop-rotation', id }
  deleteConfirmTitle.value = 'Удаление записи севооборота'
  deleteConfirmText.value = 'Эта запись будет удалена без возможности восстановления.'
  deleteConfirmOpen.value = true
}

function requestDeleteRealEstate(id: string) {
  deleteTarget.value = { type: 'real-estate', id }
  deleteConfirmTitle.value = 'Удаление объекта недвижимости'
  deleteConfirmText.value = 'Объект недвижимости будет удален без возможности восстановления.'
  deleteConfirmOpen.value = true
}

function requestDeleteMelioration(id: string) {
  deleteTarget.value = { type: 'melioration', id }
  deleteConfirmTitle.value = 'Удаление записи мелиорации'
  deleteConfirmText.value = 'Запись будет удалена без возможности восстановления.'
  deleteConfirmOpen.value = true
}

function requestDeleteCurrentLand() {
  if (!selectedLandId.value) return
  deleteTarget.value = { type: 'land', id: selectedLandId.value }
  deleteConfirmTitle.value = 'Удаление участка'
  deleteConfirmText.value = 'Удалить участок? Все привязанные поля останутся в системе, но будут отвязаны от этого участка.'
  deleteConfirmOpen.value = true
}

function closeDeleteConfirm() {
  if (saving.value) return
  deleteConfirmOpen.value = false
  deleteTarget.value = null
}

async function saveRealEstate() {
  if (!selectedLandId.value || !realEstateForm.value.cadastralNumber.trim() || !isSupabaseConfigured()) return
  saving.value = true
  error.value = null
  try {
    const payload = {
      field_id: realEstateForm.value.fieldId || null,
      cadastral_number: realEstateForm.value.cadastralNumber,
      name: realEstateForm.value.name || null,
      location_description: realEstateForm.value.locationDescription || null,
      area_sqm: realEstateForm.value.areaSqm,
      permitted_use: realEstateForm.value.permittedUse || null,
      purpose: realEstateForm.value.purpose || null,
      address: realEstateForm.value.address || null,
      depth_m: realEstateForm.value.depthM,
      height_m: realEstateForm.value.heightM,
      length_m: realEstateForm.value.lengthM,
      volume_m3: realEstateForm.value.volumeM3,
      burial_depth_m: realEstateForm.value.burialDepthM,
      development_plan: realEstateForm.value.developmentPlan || null,
      floors: realEstateForm.value.floors || null,
      underground_floors: realEstateForm.value.undergroundFloors || null,
    }
    if (editingRealEstateId.value) {
      await updateLandRealEstateObject(editingRealEstateId.value, payload)
    } else {
      await addLandRealEstateObject({
        land_id: selectedLandId.value,
        ...payload,
      })
    }
    closeRealEstateModal()
    await reloadLandDetails()
    showSuccess('Объект недвижимости успешно сохранен')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось сохранить объект недвижимости'
  } finally {
    saving.value = false
  }
}

function openMeliorationModal() {
  editingMeliorationId.value = null
  meliorationForm.value = {
    fieldId: '',
    cropKey: '',
    areaHa: null,
    meliorationType: '',
    meliorationSubtype: '',
    descriptionLocation: '',
    cadastralNumber: '',
    commissionedAt: '',
    forestCharacteristics: '',
    forestYearCreated: null,
    reconstructionInfo: '',
    eventType: '',
    eventDate: '',
    projectApproval: '',
  }
  meliorationModalOpen.value = true
}

function openMeliorationEditModal(entry: LandMeliorationEntryRow) {
  editingMeliorationId.value = entry.id
  meliorationForm.value = {
    fieldId: entry.field_id || '',
    cropKey: entry.crop_key || '',
    areaHa: entry.area_ha,
    meliorationType: entry.melioration_type || '',
    meliorationSubtype: entry.melioration_subtype || '',
    descriptionLocation: entry.description_location || '',
    cadastralNumber: entry.cadastral_number || '',
    commissionedAt: entry.commissioned_at || '',
    forestCharacteristics: entry.forest_characteristics || '',
    forestYearCreated: entry.forest_year_created,
    reconstructionInfo: entry.reconstruction_info || '',
    eventType: entry.event_type || '',
    eventDate: entry.event_date || '',
    projectApproval: entry.project_approval || '',
  }
  meliorationModalOpen.value = true
}

function closeMeliorationModal(forceOrEvent?: boolean | PointerEvent) {
  const force = typeof forceOrEvent === 'boolean' ? forceOrEvent : false
  if (!force && saving.value) return
  meliorationModalOpen.value = false
  editingMeliorationId.value = null
}

async function saveMeliorationEntry() {
  if (!meliorationForm.value.fieldId || !isSupabaseConfigured()) return
  const field = fields.value.find((f) => f.id === meliorationForm.value.fieldId)
  const landId = field?.land_id || null
  saving.value = true
  error.value = null
  try {
    if (editingMeliorationId.value) {
      await updateLandMeliorationEntry(editingMeliorationId.value, {
        field_id: meliorationForm.value.fieldId,
        crop_key: meliorationForm.value.cropKey || null,
        area_ha: meliorationForm.value.areaHa,
        melioration_kind: MELIORATION_KIND_MAP[meliorationTab.value],
        melioration_type: meliorationForm.value.meliorationType || null,
        melioration_subtype: meliorationForm.value.meliorationSubtype || null,
        description_location: meliorationForm.value.descriptionLocation || null,
        cadastral_number: meliorationForm.value.cadastralNumber || null,
        commissioned_at: meliorationForm.value.commissionedAt || null,
        forest_characteristics: meliorationForm.value.forestCharacteristics || null,
        forest_year_created: meliorationForm.value.forestYearCreated ?? null,
        reconstruction_info: meliorationForm.value.reconstructionInfo || null,
        event_type: meliorationForm.value.eventType || null,
        event_date: meliorationForm.value.eventDate || null,
        project_approval: meliorationForm.value.projectApproval || null,
      })
    } else {
      await addLandMeliorationEntry({
        land_id: landId || null,
        field_id: meliorationForm.value.fieldId,
        crop_key: meliorationForm.value.cropKey || null,
        area_ha: meliorationForm.value.areaHa,
        melioration_kind: MELIORATION_KIND_MAP[meliorationTab.value],
        melioration_type: meliorationForm.value.meliorationType || null,
        melioration_subtype: meliorationForm.value.meliorationSubtype || null,
        description_location: meliorationForm.value.descriptionLocation || null,
        cadastral_number: meliorationForm.value.cadastralNumber || null,
        commissioned_at: meliorationForm.value.commissionedAt || null,
        forest_characteristics: meliorationForm.value.forestCharacteristics || null,
        forest_year_created: meliorationForm.value.forestYearCreated ?? null,
        reconstruction_info: meliorationForm.value.reconstructionInfo || null,
        event_type: meliorationForm.value.eventType || null,
        event_date: meliorationForm.value.eventDate || null,
        project_approval: meliorationForm.value.projectApproval || null,
      })
    }
    if (!isDetailsMode.value && landsRootTab.value === 'melioration') {
      await reloadMeliorationList()
    } else if (selectedLandId.value) {
      landMeliorationEntries.value = await loadLandMeliorationEntries(selectedLandId.value)
    }
    closeMeliorationModal(true)
    showSuccess('Запись мелиорации успешно сохранена')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось сохранить запись мелиорации'
  } finally {
    saving.value = false
  }
}

async function exportMeliorationTabToPdf() {
  const { headers, rows } = meliorationExportData()
  if (!rows.length) return
  const escapedRows = rows.map((r) => r.map((c) => escapeHtml(c)))
  const tableRows = escapedRows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
  const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const html = `
    <div style="position:fixed;left:-9999px;top:0;width:1100px;font-family:Arial,sans-serif;font-size:12px;background:#fff;">
      <h2 style="margin:0 0 12px 0;font-size:16px;">Мелиорация</h2>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead><tr style="background:#225533;color:#fff;">${headerCells}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `
  const wrap = document.createElement('div')
  wrap.innerHTML = html.trim()
  const el = wrap.firstElementChild as HTMLElement
  document.body.appendChild(el)
  try {
    const { html2canvas, jsPDF } = await loadPdfTools()
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('l', 'mm', 'a4')
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const m = 8
    const drawW = pageW - m * 2
    const drawH = (canvas.height * drawW) / canvas.width
    let remain = drawH
    let y = m
    let offset = 0
    while (remain > 0) {
      pdf.addImage(imgData, 'PNG', m, y - offset, drawW, drawH)
      remain -= pageH - m * 2
      offset += pageH - m * 2
      if (remain > 0) pdf.addPage()
    }
    pdf.save(`мелиорация_${meliorationTab.value}_${new Date().toISOString().slice(0, 10)}.pdf`)
  } finally {
    document.body.removeChild(el)
  }
}

function exportMeliorationTabToExcel() {
  const { headers, rows } = meliorationExportData()
  if (!rows.length) return
  downloadDelimited(headers, rows, `мелиорация_${meliorationTab.value}_${new Date().toISOString().slice(0, 10)}.csv`)
}

async function removeRealEstate(id: string) {
  if (!id || !isSupabaseConfigured()) return
  saving.value = true
  error.value = null
  try {
    await deleteLandRealEstateObject(id)
    await reloadLandDetails()
    showSuccess('Объект недвижимости удален')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось удалить объект недвижимости'
  } finally {
    saving.value = false
  }
}

async function confirmDeleteTarget() {
  if (!deleteTarget.value) return
  if (deleteTarget.value.type === 'crop-rotation') {
    await removeCropRotation(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'real-estate') {
    await removeRealEstate(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'melioration') {
    const id = deleteTarget.value.id
    await deleteLandMeliorationEntry(id)
    if (!isDetailsMode.value && landsRootTab.value === 'melioration') {
      await reloadMeliorationList()
    } else {
      landMeliorationEntries.value = landMeliorationEntries.value.filter((x) => x.id !== id)
    }
  } else if (deleteTarget.value.type === 'land') {
    await removeLand(true)
  }
  deleteConfirmOpen.value = false
  deleteTarget.value = null
  showSuccess('Удаление выполнено успешно')
}

watch(selectedLandId, () => {
  landInlineEditOpen.value = false
  showDetailsMap.value = false
  void reloadLandDetails()
})
watch(routeLandId, () => {
  void reloadAll()
})
watch(() => String(route.query.tab || ''), (tab) => {
  if (isDetailsMode.value) return
  if (!ROOT_TAB_QUERY_MAP.has(tab)) return
  if (tab === 'land-types' || tab === 'land-categories' || tab === 'land-usage') {
    landsRootTab.value = 'land-refs'
    landRefsTab.value = tab
    return
  }
  if (
    tab === 'storage-types' || tab === 'storage-statuses' || tab === 'storage-fill-statuses' ||
    tab === 'storage-writeoff-reasons' || tab === 'storage-consumption-targets' || tab === 'storage-purposes'
  ) {
    landsRootTab.value = 'storage-refs'
    // «Статус заполнения» больше не ведётся вручную — считается по остатку склада;
    // старые ссылки на него ведут к типам.
    storageRefsTab.value =
      tab === 'storage-statuses' ? 'statuses'
      : tab === 'storage-writeoff-reasons' ? 'writeoff-reasons'
      : tab === 'storage-consumption-targets' ? 'consumption-targets'
      : tab === 'storage-purposes' ? 'purposes'
      : 'types'
    return
  }
  landsRootTab.value = tab as typeof landsRootTab.value
  if (tab === 'melioration' && isSupabaseConfigured()) {
    meliorationPage.value = 1
    void reloadMeliorationList()
  }
}, { immediate: true })
watch([landsSearch, landsRootTab, isDetailsMode], ([, rootTab, detailsMode]) => {
  if (detailsMode || rootTab !== 'registry') return
  landsPage.value = 1
  if (landsSearchDebounce) clearTimeout(landsSearchDebounce)
  landsSearchDebounce = setTimeout(() => {
    void reloadLandsRegistryList()
  }, 320)
})
watch([meliorationTab, landsRootTab, isDetailsMode], ([, rootTab, detailsMode]) => {
  if (detailsMode || rootTab !== 'melioration') return
  meliorationPage.value = 1
  void reloadMeliorationList()
})

const landsTotalPages = computed(() => Math.max(1, Math.ceil(landsTotal.value / landsPageSize.value)))
const landsPageStart = computed(() => (landsTotal.value ? (landsPage.value - 1) * landsPageSize.value + 1 : 0))
const landsPageEnd = computed(() => Math.min(landsPage.value * landsPageSize.value, landsTotal.value))
const landsPageNumbers = computed(() => {
  const total = landsTotalPages.value
  const current = landsPage.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  if (current > 4) pages.push('ellipsis')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p += 1) pages.push(p)
  if (current < total - 3) pages.push('ellipsis')
  pages.push(total)
  return pages
})
function setLandsPage(p: number) {
  const next = Math.max(1, Math.min(p, landsTotalPages.value))
  if (next === landsPage.value) return
  landsPage.value = next
  void reloadLandsRegistryList()
}
function onLandsPageSizeChange() {
  landsPage.value = 1
  void reloadLandsRegistryList()
}

const meliorationTotalPages = computed(() => Math.max(1, Math.ceil(meliorationTotal.value / meliorationPageSize.value)))
const meliorationPageStart = computed(() => (meliorationTotal.value ? (meliorationPage.value - 1) * meliorationPageSize.value + 1 : 0))
const meliorationPageEnd = computed(() => Math.min(meliorationPage.value * meliorationPageSize.value, meliorationTotal.value))
const meliorationPageNumbers = computed(() => {
  const total = meliorationTotalPages.value
  const current = meliorationPage.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  if (current > 4) pages.push('ellipsis')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p += 1) pages.push(p)
  if (current < total - 3) pages.push('ellipsis')
  pages.push(total)
  return pages
})
function setMeliorationPage(p: number) {
  const next = Math.max(1, Math.min(p, meliorationTotalPages.value))
  if (next === meliorationPage.value) return
  meliorationPage.value = next
  void reloadMeliorationList()
}
function onMeliorationPageSizeChange() {
  meliorationPage.value = 1
  void reloadMeliorationList()
}

watch(landsRootTab, (tab) => {
  if (tab === 'equipment-refs') void loadEquipmentRefsSafe()
  if (tab === 'field-refs') void loadFieldMunicipalityRefsSafe()
  if (tab === 'crop-rotation-refs') void loadCropRotationTypeRefsSafe()
  if (tab === 'storage-refs') void loadStorageRefsSafe()
})

onBeforeUnmount(() => {
  if (landsSearchDebounce) clearTimeout(landsSearchDebounce)
})

function onMapPick(coords: { lat: number; lon: number }) {
  mapLat.value = coords.lat
  mapLon.value = coords.lon
  form.value.geolocation = `${Number(coords.lat.toFixed(6))}, ${Number(coords.lon.toFixed(6))}`
  if (mapGeometryMode.value === 'point') {
    mapContourDraftPoints.value = []
  }
}

async function detectAddressFromMap() {
  resolvingAddress.value = true
  try {
    const address = await resolveYandexAddressLine(mapLat.value, mapLon.value)
    if (address) {
      form.value.address = address
      tryFillRegionFromAddress(address)
      applyAddressCandidates([address])
    } else {
      applyAddressCandidates([])
    }
  } finally {
    resolvingAddress.value = false
  }
}

async function onPolygonChange(payload: { points: LatLon[]; areaHa: number; center: { lat: number; lon: number } | null }) {
  mapContourDraftPoints.value = payload.points
  form.value.area = Number(payload.areaHa.toFixed(2))
  if (!payload.center) return
  mapLat.value = payload.center.lat
  mapLon.value = payload.center.lon
  form.value.geolocation = `${Number(payload.center.lat.toFixed(6))}, ${Number(payload.center.lon.toFixed(6))}`
  const reqId = ++addressCandidatesRequestId
  addressCandidatesLoading.value = true
  const samples = contourSamplePoints(payload.points, payload.center)
  resolvingAddress.value = true
  try {
    const [address, candidates] = await Promise.all([
      resolveYandexAddressLine(payload.center.lat, payload.center.lon),
      resolveYandexAddressCandidates(samples, 8),
    ])
    if (reqId !== addressCandidatesRequestId) return
    if (address) {
      form.value.address = address
      tryFillRegionFromAddress(address)
    }
    applyAddressCandidates(candidates.length ? candidates : address ? [address] : [])
  } finally {
    if (reqId === addressCandidatesRequestId) addressCandidatesLoading.value = false
    resolvingAddress.value = false
  }
}

onMounted(() => void reloadAll())
</script>

<template>
  <section class="lands-page">
    <header class="lands-top page-enter-item">
      <div class="lands-top-text">
      </div>
      <div class="lands-top-actions">
        <Button variant="outline"
          v-if="isDetailsMode && selectedLand && !landInlineEditOpen"
          type="button"
          class="lands-edit-btn"
          @click="startInlineEdit()"
        >
          Редактировать участок
        </Button>
        <Button variant="outline"
          v-if="isDetailsMode && selectedLand && landInlineEditOpen"
          type="button"
          class="lands-edit-btn"
          :disabled="saving"
          @click="closeLandEditor"
        >
          Отменить редактирование
        </Button>
      </div>
    </header>

    <p v-if="error" class="lands-error">{{ error }}</p>
    <div v-if="loading"><UiLoadingBar /></div>

    <div v-else class="lands-content">
      <div v-if="!isDetailsMode" class="lands-list-shell">
        <div v-if="isPhone && (landsRootTab === 'rights-refs' || landsRootTab === 'land-refs' || landsRootTab === 'crops-refs' || landsRootTab === 'melioration-refs' || landsRootTab === 'equipment-refs' || landsRootTab === 'field-refs' || landsRootTab === 'crop-rotation-refs' || landsRootTab === 'storage-refs')" class="mb-4">
          <UiSelect
            :model-value="landsRootTab"
            block
            aria-label="Группа справочников"
            :options="[...REF_GROUPS]"
            @update:model-value="(v) => (landsRootTab = v as typeof landsRootTab)"
          />
        </div>
        <div v-if="!isPhone && (landsRootTab === 'rights-refs' || landsRootTab === 'land-refs' || landsRootTab === 'crops-refs' || landsRootTab === 'melioration-refs' || landsRootTab === 'equipment-refs' || landsRootTab === 'field-refs' || landsRootTab === 'crop-rotation-refs' || landsRootTab === 'storage-refs')" class="lands-tabs lands-tabs--top">
          <template v-if="landsRootTab === 'rights-refs' || landsRootTab === 'land-refs' || landsRootTab === 'crops-refs' || landsRootTab === 'melioration-refs' || landsRootTab === 'equipment-refs' || landsRootTab === 'field-refs' || landsRootTab === 'crop-rotation-refs' || landsRootTab === 'storage-refs'">
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landsRootTab === 'rights-refs' }" @click="landsRootTab = 'rights-refs'">
              Справочники прав
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landsRootTab === 'land-refs' }" @click="landsRootTab = 'land-refs'">
              Справочники земель
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landsRootTab === 'crops-refs' }" @click="landsRootTab = 'crops-refs'">
              Справочники СХ культур
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landsRootTab === 'melioration-refs' }" @click="landsRootTab = 'melioration-refs'">
              Справочники мелиорации
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landsRootTab === 'equipment-refs' }" @click="landsRootTab = 'equipment-refs'">
              Справочники техники
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landsRootTab === 'field-refs' }" @click="landsRootTab = 'field-refs'">
              Справочники полей
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landsRootTab === 'crop-rotation-refs' }" @click="landsRootTab = 'crop-rotation-refs'">
              Справочники севооборота
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landsRootTab === 'storage-refs' }" @click="landsRootTab = 'storage-refs'">
              Справочники хранения
            </button>
          </template>
          <template v-else-if="landsRootTab === 'melioration'">
            <button type="button" class="lands-tab-btn is-active">Мелиорация</button>
          </template>
          <template v-else>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landsRootTab === 'registry' }" @click="landsRootTab = 'registry'">
              Реестр земель
            </button>
          </template>
        </div>

        <template v-if="landsRootTab === 'registry'">
          <div class="lands-table-top">
            <h2 class="sr-only">Реестр земель</h2>
            <div class="lands-table-tools">
              <Input v-model.trim="landsSearch" class="lands-search" type="text" placeholder="Поиск по адресу или кадастровому номеру" />
              <div class="tw-scope flex flex-wrap items-center gap-2">
                <Button variant="outline" type="button" :disabled="!lands.length" @click="exportLandsToPdf">
                  <FileTextIcon />
                  PDF
                </Button>
                <Button variant="outline" type="button" :disabled="!lands.length" @click="exportLandsToExcel">
                  <FileSpreadsheetIcon />
                  Excel
                </Button>
                <Button type="button" @click="openCreateLand">
                  <PlusIcon />
                  Новая земля
                </Button>
              </div>
            </div>
          </div>
          <div class="lands-table-wrap">
            <table class="lands-table" v-card-table>
              <thead>
                <tr>
                  <th>Кадастровый номер</th>
                  <th>№ поля ЕФИС ЗСН</th>
                  <th>Адрес</th>
                  <th>Категория земли</th>
                  <th>Площадь, га</th>
                  <th>Вид разрешенного использования</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="land in lands"
                  :key="land.id"
                  class="lands-list-row"
                  :class="{ 'is-active': land.id === selectedLandId }"
                  @click="openLandPage(land.id)"
                >
                  <td class="lands-list-title-main">{{ land.cadastral_number || '—' }}</td>
                  <td>{{ landEfisNumberDisplay(land) }}</td>
                  <td>{{ land.address || '—' }}</td>
                  <td>{{ land.land_category || '—' }}</td>
                  <td>{{ formatHa(land.area || 0) }}</td>
                  <td>{{ land.permitted_use_docs || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!lands.length && landsSearch.trim()" class="lands-muted">По вашему запросу ничего не найдено.</p>
          <p v-else-if="!lands.length" class="lands-muted">Пока нет созданных земель.</p>

          <UiPagination v-if="landsTotal > 0" :page="landsPage" :page-size="landsPageSize" :total="landsTotal" :page-size-options="[10, 25, 50]" @update:page="setLandsPage" @update:page-size="(n) => { landsPageSize = n; onLandsPageSizeChange() }" />
        </template>

        <template v-else-if="landsRootTab === 'melioration'">
          <div class="tw-scope flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
            <Tabs :model-value="meliorationTab" class="min-w-0">
              <TabsList class="h-auto max-w-full flex-wrap justify-start">
                <TabsTrigger v-for="tab in MELIORATION_TABS" :key="tab.id" :value="tab.id" class="flex-none" :title="tab.label" @click="meliorationTab = tab.id">
                  {{ tab.short }}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div class="flex flex-wrap items-center gap-2">
              <Button variant="outline" type="button" :disabled="!meliorationEntriesByTab.length" @click="exportMeliorationTabToPdf">
                <FileTextIcon />
                PDF
              </Button>
              <Button variant="outline" type="button" :disabled="!meliorationEntriesByTab.length" @click="exportMeliorationTabToExcel">
                <FileSpreadsheetIcon />
                Excel
              </Button>
              <Button type="button" @click="openMeliorationModal">
                <PlusIcon />
                Добавить
              </Button>
            </div>
          </div>
          <div class="lands-table-wrap lands-table-wrap--melioration">
            <table class="lands-table" v-card-table>
              <thead>
                <tr v-if="meliorationTab === 'systems'">
                  <th>№ поля ЕФИС ЗСН</th>
                  <th>Тип мелиорации</th>
                  <th>Вид мелиорации</th>
                  <th>Описание системы и местоположения</th>
                  <th>Кадастровый номер земельного участка</th>
                  <th>Дата ввода в эксплуатацию</th>
                  <th>Площадь орошаемых (осушаемых) земель, га</th>
                  <th>Действия</th>
                </tr>
                <tr v-else-if="meliorationTab === 'forest'">
                  <th>№ поля ЕФИС ЗСН</th>
                  <th>Площадь МЗЛН, га</th>
                  <th>Количественные, качественные характеристики</th>
                  <th>Год создания</th>
                  <th>Информация о реконструкции насаждений</th>
                  <th>Кадастровый номер земельного участка</th>
                  <th>Действия</th>
                </tr>
                <tr v-else>
                  <th>№ поля ЕФИС ЗСН</th>
                  <th>Тип мероприятия</th>
                  <th>Дата проведения</th>
                  <th>Площадь земельного участка, га</th>
                  <th>Согласование проектов мелиорации</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in meliorationEntriesByTab" :key="entry.id" :class="{ 'lands-mel-row': true }">
                  <td>{{ meliorationFieldLabel(entry.field_id) }}</td>
                  <template v-if="meliorationTab === 'systems'">
                    <td>{{ entry.melioration_type || '—' }}</td>
                    <td>{{ entry.melioration_subtype || '—' }}</td>
                    <td>{{ entry.description_location || '—' }}</td>
                    <td>{{ entry.cadastral_number || '—' }}</td>
                    <td>{{ formatIsoDate(entry.commissioned_at) }}</td>
                    <td>{{ formatRotationMetric(entry.irrigated_area_ha ?? entry.area_ha) }}</td>
                  </template>
                  <template v-else-if="meliorationTab === 'forest'">
                    <td>{{ formatRotationMetric(entry.forest_area_ha ?? entry.area_ha) }}</td>
                    <td>{{ entry.forest_characteristics || '—' }}</td>
                    <td>{{ entry.forest_year_created ?? '—' }}</td>
                    <td>{{ entry.reconstruction_info || '—' }}</td>
                    <td>{{ entry.cadastral_number || '—' }}</td>
                  </template>
                  <template v-else>
                    <td>{{ entry.event_type || '—' }}</td>
                    <td>{{ formatIsoDate(entry.event_date) }}</td>
                    <td>{{ formatRotationMetric(entry.area_ha) }}</td>
                    <td>{{ entry.project_approval || '—' }}</td>
                  </template>
                  <td @click.stop>
                    <div class="lands-item-actions">
                      <Button variant="ghost" size="icon-sm" type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="openMeliorationEditModal(entry)">
                        <PencilIcon :size="17" :stroke-width="2.1" />
                      </Button>
                      <UiDeleteButton size="sm" @click="requestDeleteMelioration(entry.id)" />
                    </div>
                  </td>
                </tr>
                <tr v-if="!meliorationEntriesByTab.length && !loading">
                  <td :colspan="meliorationTab === 'systems' ? 8 : meliorationTab === 'forest' ? 7 : 6" class="lands-muted lands-melioration-empty">нет данных для отображения</td>
                </tr>
              </tbody>
            </table>
          </div>
          <UiPagination v-if="meliorationTotal > 0" :page="meliorationPage" :page-size="meliorationPageSize" :total="meliorationTotal" :page-size-options="[10, 25, 50]" @update:page="setMeliorationPage" @update:page-size="(n) => { meliorationPageSize = n; onMeliorationPageSizeChange() }" />
        </template>
        <LandsRefsPanel v-else :tab="landsRootTab" />
      </div>

      <Card v-if="isDetailsMode" class="lands-card page-enter-item gap-0">
        <template v-if="selectedLand">
          <h2>Паспорт участка</h2>
          <div class="lands-overview-grid">
            <div class="lands-overview-item">
              <span class="lands-label-with-help">
                Категория земель
                <RefFieldHelp
                  text="Нет нужной категории? Добавьте ее в"
                  :to="{ path: '/lands', query: { tab: 'land-categories' } }"
                  link-label="Справочники земель"
                />
              </span>
              <UiSelect v-model="form.landCategory" :options="[{ value: '', label: '—' }, ...(landCategories).map((category) => ({ value: category.name, label: String(category.name) }))]" v-if="landInlineEditOpen" class="lands-passport-input" />
              <strong v-else>{{ selectedLand.land_category || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span class="lands-label-with-help">
                Использование участка
                <RefFieldHelp
                  text="Нет нужного варианта? Добавьте его в"
                  :to="{ path: '/lands', query: { tab: 'land-usage' } }"
                  link-label="Использование участка"
                />
              </span>
              <UiSelect v-model="form.actualUseStatus" :options="[{ value: '', label: '—' }, ...(actualUseOptions).map((option) => ({ value: option.name, label: String(option.name) }))]" v-if="landInlineEditOpen" class="lands-passport-input" />
              <strong v-else>{{ selectedLand.actual_use_status || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>Регион</span>
              <Input v-if="landInlineEditOpen" v-model.trim="form.region" class="lands-passport-input" type="text" />
              <strong v-else>{{ selectedLand.region || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>Адрес</span>
              <Input v-if="landInlineEditOpen" v-model.trim="form.address" class="lands-passport-input" type="text" />
              <strong v-else>{{ selectedLand.address || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>Площадь, га</span>
              <Input v-if="landInlineEditOpen" v-model.number="form.area" class="lands-passport-input" type="number" min="0" step="0.01" />
              <strong v-else>{{ formatHa(selectedLand.area || 0) }}</strong>
            </div>
            <div class="lands-overview-item">
              <span class="lands-label-with-help">
                ВРИ по документам
                <RefFieldHelp
                  text="Нет нужного ВРИ? Добавьте его в"
                  :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
                  link-label="Типы прав"
                />
              </span>
              <UiSelect v-model="form.permittedUseDocs" :options="[{ value: '', label: '—' }, ...(landRightTypes).map((row) => ({ value: row.name, label: String(row.name) }))]" v-if="landInlineEditOpen" class="lands-passport-input" />
              <strong v-else>{{ selectedLand.permitted_use_docs || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>Кадастровый номер</span>
              <Input v-if="landInlineEditOpen" v-model.trim="form.cadastralNumber" class="lands-passport-input" type="text" />
              <strong v-else>{{ selectedLand.cadastral_number || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>№ поля ЕФИС ЗСН</span>
              <strong>{{ landEfisNumberDisplay(selectedLand) }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>Геолокация</span>
              <Input v-if="landInlineEditOpen" v-model.trim="form.geolocation" class="lands-passport-input" type="text" />
              <strong v-else>{{ selectedLand.center_lat != null && selectedLand.center_lon != null ? `${selectedLand.center_lat}, ${selectedLand.center_lon}` : '—' }}</strong>
            </div>
          </div>
          <div class="lands-actions lands-actions--map">
            <Button variant="outline" type="button" class="lands-btn" @click="showDetailsMap = !showDetailsMap">
              {{ showDetailsMap ? 'Скрыть карту' : 'Показать карту' }}
            </Button>
          </div>
          <div v-if="showDetailsMap" class="lands-map-wrap">
            <div v-if="landInlineEditOpen" class="lands-map-head">
              <span class="lands-map-title">Редактирование геометрии участка</span>
              <ToggleGroup type="single" variant="outline" size="sm" aria-label="Режим геометрии земли"
                :model-value="(mapGeometryMode === 'point') ? 'b0' : (mapGeometryMode === 'polygon') ? 'b1' : ''"
                @update:model-value="(v) => { if (v === 'b0') { mapGeometryMode = 'point' } else if (v === 'b1') { mapGeometryMode = 'polygon' } }"
              >
                <ToggleGroupItem value="b0" class="px-3">Точка</ToggleGroupItem>
                <ToggleGroupItem value="b1" class="px-3">Контур</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <YandexMap
              :lat="landInlineEditOpen ? mapLat : detailsMapLat"
              :lon="landInlineEditOpen ? mapLon : detailsMapLon"
              :zoom="11"
              :interactive="landInlineEditOpen"
              :geometry-mode="landInlineEditOpen ? mapGeometryMode : (selectedLand.geometry_mode || 'polygon')"
              :polygon-points="landInlineEditOpen ? mapContourDraftPoints : selectedLandPolygonPoints"
              :field-markers="assignedFieldMapMarkers"
              :fit-field-markers="assignedFieldMapMarkers.length > 0"
              geometry-stroke-color="#2563eb"
              geometry-fill-color="rgba(37, 99, 235, 0.20)"
              geometry-marker-preset="islands#blueDotIcon"
              marker-hint="Земельный участок"
              :overlay-hint="landInlineEditOpen"
              @pick="onMapPick"
              @polygonChange="onPolygonChange"
            />
            <div v-if="landInlineEditOpen" class="lands-map-actions">
              <Button variant="outline" size="sm" type="button" class="lands-mini-btn" :disabled="resolvingAddress" @click="detectAddressFromMap">
                {{ resolvingAddress ? 'Определяем адрес...' : 'Определить адрес по карте' }}
              </Button>
              <span class="lands-muted">
                <template v-if="mapGeometryMode === 'polygon'">Можно менять контур — площадь и адрес обновятся автоматически.</template>
                <template v-else>Можно перемещать точку участка и подтягивать адрес по карте.</template>
              </span>
            </div>
          </div>
          <div v-if="landInlineEditOpen && (addressCandidatesLoading || addressCandidates.length)" class="lands-address-candidates lands-address-candidates--details">
            <span class="lands-address-candidates-label">Варианты адреса по геометрии</span>
            <UiSelect v-model="selectedAddressCandidate" :options="addressCandidates.map((a) => ({ value: a, label: a }))" placeholder="Выберите вариант адреса" class="lands-address-candidates-select" @change="onAddressCandidateChange" />
            <span v-if="addressCandidatesLoading" class="lands-muted">Подбираем варианты адреса...</span>
          </div>
        </template>

        <Tabs :model-value="activeTab" class="mb-4">
          <TabsList class="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="info" @click="activeTab = 'info'">
            Сведения об участке
          </TabsTrigger>
            <TabsTrigger value="fields" @click="activeTab = 'fields'">
            Поля
          </TabsTrigger>
            <TabsTrigger value="rights" @click="activeTab = 'rights'">
            Права владения
          </TabsTrigger>
            <TabsTrigger value="users" @click="activeTab = 'users'">
            Землепользователи
          </TabsTrigger>
            <TabsTrigger value="crop-rotation" @click="activeTab = 'crop-rotation'">
            Севооборот
          </TabsTrigger>
            <TabsTrigger value="real-estate" @click="activeTab = 'real-estate'">
            Объекты недвижимости
          </TabsTrigger>
          </TabsList>
        </Tabs>

        <template v-if="selectedLand && activeTab === 'info'">
          <div class="lands-section-head">
            <h2>Сведения об участке</h2>
            <div class="lands-export-btns">
              <button type="button" class="lands-export-btn action_has has_saved" :disabled="!landInfoExportRows.length" title="Экспорт в PDF" @click="exportLandInfoToPdf">
                <FileTextIcon class="lands-export-icon" />
                PDF
              </button>
              <button type="button" class="lands-export-btn action_has has_saved" :disabled="!landInfoExportRows.length" title="Экспорт в Excel" @click="exportLandInfoToExcel">
                <FileSpreadsheetIcon class="lands-export-icon" />
                Excel
              </button>
            </div>
          </div>
          <div v-if="!landInlineEditOpen" class="lands-overview-grid">
            <div class="lands-overview-item"><span>Общая площадь по документам, га</span><strong>{{ selectedLand.document_area_ha ?? '—' }}</strong></div>
            <div class="lands-overview-item"><span>Площадь земельного участка, га</span><strong>{{ formatHa(selectedLand.area || 0) }}</strong></div>
            <div class="lands-overview-item"><span>Отнесение к сельхозугодьям</span><strong>{{ landTypeLabelMap.get(selectedLand.agri_land_type_id || '') || '—' }}</strong></div>
            <div class="lands-overview-item"><span>Площадь сельхозугодий, га</span><strong>{{ selectedLand.agri_land_area_ha ?? '—' }}</strong></div>
            <div class="lands-overview-item"><span>Особо ценные продуктивные угодья</span><strong>{{ selectedLand.is_valuable_agri_land == null ? '—' : selectedLand.is_valuable_agri_land ? 'Да' : 'Нет' }}</strong></div>
            <div class="lands-overview-item"><span>Использование участка</span><strong>{{ selectedLand.actual_use_status || '—' }}</strong></div>
            <div class="lands-overview-item"><span>Фактически орошаемая площадь, га</span><strong>{{ selectedLand.irrigated_area_ha ?? '—' }}</strong></div>
            <div class="lands-overview-item"><span>Фактически осушаемая площадь, га</span><strong>{{ selectedLand.drained_area_ha ?? '—' }}</strong></div>
            <div class="lands-overview-item"><span>Использование для племенного/селекции/семеноводства</span><strong>{{ selectedLand.breeding_use == null ? '—' : selectedLand.breeding_use ? 'Да' : 'Нет' }}</strong></div>
            <div class="lands-overview-item"><span>Иные сведения об использовании</span><strong>{{ selectedLand.other_use_info || '—' }}</strong></div>
          </div>
          <div v-else class="lands-form-grid">
            <label class="lands-field">
              <span>Общая площадь по документам, га</span>
              <Input v-model.number="form.documentAreaHa" type="number" min="0" step="0.01" />
            </label>
            <label class="lands-field">
              <span>Площадь земельного участка, га</span>
              <Input v-model.number="form.area" type="number" min="0" step="0.01" />
            </label>
          </div>
          <div v-if="landInlineEditOpen" class="lands-form-grid">
              <label class="lands-field">
              <span class="lands-label-with-help">
                Отнесение к сельхозугодьям (тип земли)
                <RefFieldHelp
                  text="Нет нужного типа земли? Добавьте его в"
                  :to="{ path: '/lands', query: { tab: 'land-types' } }"
                  link-label="Справочники земель"
                />
              </span>
              <UiSelect v-model="form.isAgriLand" :options="[{ value: '', label: '—' }, ...(landTypes).map((type) => ({ value: type.id, label: String(type.name) }))]" />
            </label>
            <label class="lands-field">
              <span>Площадь сельхозугодий, га</span>
              <Input v-model.number="form.agriLandAreaHa" type="number" min="0" step="0.01" />
            </label>
          </div>
          <div v-if="landInlineEditOpen" class="lands-form-grid">
            <label class="lands-field">
              <span>Особо ценные продуктивные угодья</span>
              <ToggleGroup type="single" variant="outline" size="sm" aria-label="Особо ценные продуктивные угодья"
                :model-value="(form.isValuableAgriLand === 'yes') ? 'b0' : (form.isValuableAgriLand === 'no') ? 'b1' : ''"
                @update:model-value="(v) => { if (v === 'b0') { form.isValuableAgriLand = 'yes' } else if (v === 'b1') { form.isValuableAgriLand = 'no' } }"
              >
                <ToggleGroupItem value="b0" class="px-3">Да</ToggleGroupItem>
                <ToggleGroupItem value="b1" class="px-3">Нет</ToggleGroupItem>
              </ToggleGroup>
            </label>
            <label class="lands-field">
              <span class="lands-label-with-help">
                Использование участка
                <RefFieldHelp
                  text="Нет нужного варианта? Добавьте его в"
                  :to="{ path: '/lands', query: { tab: 'land-usage' } }"
                  link-label="Использование участка"
                />
              </span>
                <UiSelect v-model="form.actualUseStatus" :options="[{ value: '', label: '—' }, ...(actualUseOptions).map((option) => ({ value: option.name, label: String(option.name) }))]" />
            </label>
          </div>
          <div v-if="landInlineEditOpen" class="lands-form-grid">
            <label class="lands-field">
              <span>Фактически орошаемая площадь, га</span>
              <Input v-model.number="form.irrigatedAreaHa" type="number" min="0" step="0.01" />
            </label>
            <label class="lands-field">
              <span>Фактически осушаемая площадь, га</span>
              <Input v-model.number="form.drainedAreaHa" type="number" min="0" step="0.01" />
            </label>
          </div>
          <div v-if="landInlineEditOpen" class="lands-form-grid">
            <label class="lands-field">
              <span>Использование для племенного/селекции/семеноводства</span>
              <ToggleGroup type="single" variant="outline" size="sm" aria-label="Использование для племенного или селекции"
                :model-value="(form.breedingUse === 'yes') ? 'b0' : (form.breedingUse === 'no') ? 'b1' : ''"
                @update:model-value="(v) => { if (v === 'b0') { form.breedingUse = 'yes' } else if (v === 'b1') { form.breedingUse = 'no' } }"
              >
                <ToggleGroupItem value="b0" class="px-3">Да</ToggleGroupItem>
                <ToggleGroupItem value="b1" class="px-3">Нет</ToggleGroupItem>
              </ToggleGroup>
            </label>
            <label class="lands-field">
              <span>Иные сведения об использовании</span>
              <Input v-model.trim="form.otherUseInfo" type="text" />
            </label>
          </div>
          <div v-if="landInlineEditOpen" class="lands-actions lands-actions--end">
            <Button variant="default" type="button" class="lands-btn lands-btn--save" :disabled="saving" @click="saveLand">
              Сохранить сведения
            </Button>
            <Button variant="destructive" type="button" class="lands-btn lands-btn--danger" :disabled="saving" @click="requestDeleteCurrentLand">
              Удалить участок
            </Button>
          </div>
        </template>

        <template v-else-if="selectedLand && activeTab === 'fields'">
          <LandFieldsTab
            :items="assignedFields"
            :export-rows="landFieldsExportRows"
            :inline-edit-open="landInlineEditOpen"
            :crop-label="fieldCropLabel"
            :crop-pill-class="fieldCropPillClass"
            @export-pdf="exportLandFieldsToPdf"
            @export-excel="exportLandFieldsToExcel"
            @open-field="goToFieldDetails"
            @unlink="unlinkField"
          />
        </template>

        <template v-else-if="selectedLand && activeTab === 'rights'">
          <LandRightsTab
            :items="landRights"
            :export-rows="landRightsExportRows"
            @export-pdf="exportLandRightsToPdf"
            @export-excel="exportLandRightsToExcel"
            @create="openRightModal"
            @edit="openRightEditModal"
            @remove="removeLandRight"
          />
        </template>

        <template v-else-if="selectedLand && activeTab === 'users'">
          <LandUsersTab
            :items="landUsers"
            :format-metric="formatRotationMetric"
            @create="openUserModal"
            @edit="openUserEditModal"
            @remove="removeLandUser"
          />
        </template>

        <template v-else-if="selectedLand && activeTab === 'crop-rotation'">
          <LandCropRotationTab
            :items="landCropRotations"
            :export-rows="landCropRotationExportRows"
            :crop-label-map="cropLabelMap"
            :field-map="cropRotationFieldMap"
            :format-metric="formatRotationMetric"
            :field-label="realEstateFieldLabel"
            @export-pdf="exportLandCropRotationToPdf"
            @export-excel="exportLandCropRotationToExcel"
            @create="openCropRotationModal"
            @edit="openCropRotationEditModal"
            @remove="requestDeleteCropRotation"
          />
        </template>

        <template v-else-if="selectedLand && activeTab === 'real-estate'">
          <LandRealEstateTab
            :items="landRealEstateObjects"
            :export-rows="landRealEstateExportRows"
            :format-metric="formatRotationMetric"
            :field-label="realEstateFieldLabel"
            @export-pdf="exportLandRealEstateToPdf"
            @export-excel="exportLandRealEstateToExcel"
            @create="openRealEstateModal"
            @edit="openRealEstateEditModal"
            @remove="requestDeleteRealEstate"
          />
        </template>
        <p v-else class="lands-muted">Участок не найден или не выбран.</p>
      </Card>
    </div>

    <teleport to="body">
      <UiModal v-if="landEditorOpen" :title="landEditorMode === 'create' ? 'Новая земля' : 'Редактирование земли'" :max-width="720" @close="closeLandEditor">
          <div class="lands-modal-body">
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Номер</span>
                <Input v-model.number="form.number" type="number" min="1" />
              </label>
              <label class="lands-field">
                <span class="lands-label-with-help">
                  Категория земель
                  <RefFieldHelp
                    text="Нет нужной категории? Добавьте ее в"
                    :to="{ path: '/lands', query: { tab: 'land-refs' } }"
                    link-label="Справочники земель"
                  />
                </span>
                <UiSelect v-model="form.landCategory" :options="[{ value: '', label: '—' }, ...(landCategories).map((category) => ({ value: category.name, label: String(category.name) }))]" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span class="lands-label-with-help">
                  Тип земли
                  <RefFieldHelp
                    text="Нет нужного типа? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'land-refs' } }"
                    link-label="Справочники земель"
                  />
                </span>
                <UiSelect v-model="form.landTypeId" :options="[{ value: '', label: '— Не указан —' }, ...(landTypes).map((type) => ({ value: type.id, label: String(type.name) }))]" />
              </label>
              <label class="lands-field">
                <span>Регион</span>
                <Input v-model.trim="form.region" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Площадь, га</span>
                <Input v-model.number="form.area" type="number" min="0" step="0.01" />
              </label>
              <label class="lands-field">
                <span>Кадастровый номер</span>
                <Input v-model.trim="form.cadastralNumber" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Вид разрешенного использования (документы)</span>
                <UiSelect v-model="form.permittedUseDocs" :options="[{ value: '', label: '—' }, ...(landRightTypes).map((row) => ({ value: row.name, label: String(row.name) }))]" />
              </label>
              <label class="lands-field">
                <span>№ поля ЕФИС ЗСН</span>
                <span class="lands-muted-line">Заполняется автоматически из привязанных полей (раздел «Поля»).</span>
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Геолокация (широта, долгота)</span>
                <Input v-model.trim="form.geolocation" type="text" placeholder="53.195878, 45.018316" />
              </label>
              <label class="lands-field">
                <span>Площадь по документам, га (ручной ввод)</span>
                <Input v-model.number="form.documentAreaHa" type="number" min="0" step="0.01" />
              </label>
            </div>
            <label class="lands-field">
              <span>Адрес</span>
              <Input v-model.trim="form.address" type="text" placeholder="Адрес или ориентир" />
            </label>
            <div v-if="addressCandidatesLoading || addressCandidates.length" class="lands-address-candidates">
              <span class="lands-address-candidates-label">Варианты адреса по геометрии</span>
              <UiSelect v-model="selectedAddressCandidate" :options="addressCandidates.map((a) => ({ value: a, label: a }))" placeholder="Выберите вариант адреса" class="lands-address-candidates-select" @change="onAddressCandidateChange" />
              <span v-if="addressCandidatesLoading" class="lands-muted">Подбираем варианты адреса...</span>
            </div>
            <div class="lands-map-wrap">
              <div class="lands-map-head">
                <span class="lands-map-title">Геометрия земельного участка</span>
                <ToggleGroup type="single" variant="outline" size="sm" aria-label="Режим геометрии земли"
                  :model-value="(mapGeometryMode === 'point') ? 'b0' : (mapGeometryMode === 'polygon') ? 'b1' : ''"
                  @update:model-value="(v) => { if (v === 'b0') { mapGeometryMode = 'point' } else if (v === 'b1') { mapGeometryMode = 'polygon' } }"
                >
                  <ToggleGroupItem value="b0" class="px-3">Точка</ToggleGroupItem>
                  <ToggleGroupItem value="b1" class="px-3">Контур</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <YandexMap
                :lat="mapLat"
                :lon="mapLon"
                :zoom="11"
                :interactive="true"
                :geometry-mode="mapGeometryMode"
                :polygon-points="mapContourDraftPoints"
                geometry-stroke-color="#2563eb"
                geometry-fill-color="rgba(37, 99, 235, 0.20)"
                geometry-marker-preset="islands#blueDotIcon"
                marker-hint="Точка для земли"
                :overlay-hint="true"
                @pick="onMapPick"
                @polygonChange="onPolygonChange"
              />
              <div class="lands-map-actions">
                <Button variant="outline" size="sm" type="button" class="lands-mini-btn" :disabled="resolvingAddress" @click="detectAddressFromMap">
                  {{ resolvingAddress ? 'Определяем адрес...' : 'Определить адрес по карте' }}
                </Button>
                <span class="lands-muted">
                  <template v-if="mapGeometryMode === 'polygon'">Нарисуйте контур и завершите — адрес и площадь обновятся автоматически.</template>
                  <template v-else>Кликните по карте и нажмите кнопку, чтобы подставить адрес.</template>
                </span>
              </div>
            </div>
            <label class="lands-field">
              <span>Описание местоположения</span>
              <textarea v-model.trim="form.locationDescription" rows="3" />
            </label>
            <label class="lands-field">
              <span>Примечание</span>
              <textarea v-model.trim="form.notes" rows="3" />
            </label>
          </div>
        <template #actions>
            <UiButton :disabled="saving" @click="closeLandEditor">Отмена</UiButton>
            <UiButton variant="primary" :disabled="saving" @click="saveLand">
              {{ saving ? 'Сохранение...' : landEditorMode === 'create' ? 'Создать землю' : 'Сохранить изменения' }}
            </UiButton>
            <UiDeleteButton
              v-if="landEditorMode === 'edit' && selectedLand"
              size="md"
              :disabled="saving"
              @click="() => removeLand()"
            />
        </template>
      </UiModal>

      <LandCropRotationModal
        :open="cropRotationModalOpen"
        :form="cropRotationForm"
        :assigned-fields="assignedFields"
        :crop-rotation-type-options="cropRotationTypeOptions"
        :crops="crops"
        :editing-id="editingCropRotationId"
        :saving="saving"
        @save="saveCropRotation"
        @close="closeCropRotationModal"
      />

      <LandRightModal
        :open="rightModalOpen"
        :form="rightForm"
        :holders="landRightHolders"
        :holder-types="landRightHolderTypes"
        :ownership-forms="landRightOwnershipForms"
        :right-types="landRightTypes"
        :document-types="landRightDocumentTypes"
        :supporting-links="rightSupportingLinks"
        :uploading="rightFileUploading"
        :saving="saving"
        :editing-id="editingRightId"
        @save="saveLandRight"
        @close="closeRightModal"
        @upload="uploadRightSupportingFile"
        @remove-file="requestRemoveRightSupportingFile"
      />

      <LandRealEstateModal
        :open="realEstateModalOpen"
        :form="realEstateForm"
        :assigned-fields="assignedFields"
        :editing-id="editingRealEstateId"
        :saving="saving"
        @save="saveRealEstate"
        @close="closeRealEstateModal"
      />

      <LandUserModal
        :open="userModalOpen"
        :form="userForm"
        :holders="landRightHolders"
        :right-types="landRightTypes"
        :document-types="landRightDocumentTypes"
        :supporting-links="userSupportingLinks"
        :uploading="userFileUploading"
        :saving="saving"
        :editing-id="editingUserId"
        @save="saveLandUser"
        @close="closeUserModal"
        @upload="uploadUserSupportingFile"
        @remove-file="requestRemoveUserSupportingFile"
      />

      <LandsConfirmModal
        :open="userFileDeleteConfirmOpen"
        dialog-label="Удаление файла"
        title="Удалить файл?"
        text="Ссылка на файл будет удалена из формы землепользователя."
        confirm-label="Удалить"
        :busy="saving || userFileUploading"
        @confirm="confirmRemoveUserSupportingFile"
        @close="closeUserFileDeleteConfirm"
      />

      <LandMeliorationModal
        :open="meliorationModalOpen"
        :form="meliorationForm"
        :tab="meliorationTab"
        :field-options="meliorationFieldOptions"
        :field-label="meliorationFieldLabel"
        :types="landMeliorationTypes"
        :subtypes="landMeliorationSubtypes"
        :event-types="landMeliorationEventTypes"
        :saving="saving"
        @save="saveMeliorationEntry"
        @close="closeMeliorationModal"
      />

      <LandsConfirmModal
        :open="deleteConfirmOpen"
        dialog-label="Подтверждение удаления"
        :title="deleteConfirmTitle"
        :text="deleteConfirmText"
        :confirm-label="saving ? 'Удаление...' : 'Удалить'"
        :busy="saving"
        @confirm="confirmDeleteTarget"
        @close="closeDeleteConfirm"
      />

      <LandsConfirmModal
        :open="rightFileDeleteConfirmOpen"
        dialog-label="Удаление файла"
        title="Удалить файл?"
        text="Файл будет удален из списка подтверждающих документов."
        confirm-label="Удалить"
        :busy="saving || rightFileUploading"
        @confirm="confirmRemoveRightSupportingFile"
        @close="closeRightFileDeleteConfirm"
      />
      <UiSuccessModal :open="successModalOpen" title="Готово" :message="successModalText" @close="closeSuccessModal" />
    </teleport>
  </section>
</template>

<style scoped src="./LandsPage.css"></style>
<!-- Общие стили окон раздела: без scoped, их же используют вынесенные компоненты модалок. -->
