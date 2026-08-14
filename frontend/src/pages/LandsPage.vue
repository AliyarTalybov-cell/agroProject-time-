<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
import YandexMap from '@/components/YandexMap.vue'
import type { MapFieldMarker } from '@/components/YandexMap.vue'
import { resolveYandexAddressCandidates, resolveYandexAddressLine } from '@/lib/yandexGeocode'
import {
  addCropByLabel,
  addLandActualUseOption as addLandActualUseOptionApi,
  addLandCategory as addLandCategoryApi,
  addLandType as addLandTypeApi,
  deleteCrop as deleteCropApi,
  deleteLandActualUseOption as deleteLandActualUseOptionApi,
  deleteLandCategory as deleteLandCategoryApi,
  deleteLandType as deleteLandTypeApi,
  loadCrops,
  loadLandActualUseOptions,
  loadLandCategories,
  updateCrop as updateCropApi,
  updateLandActualUseOption as updateLandActualUseOptionApi,
  updateLandCategory as updateLandCategoryApi,
  updateLandType as updateLandTypeApi,
  type CropRow,
  type LandCategoryRow,
  type LandActualUseOptionRow,
} from '@/lib/landTypesAndCrops'
import {
  addLand,
  addLandRightDocumentType,
  addLandRightHolder,
  addLandRightHolderType,
  addLandRightOwnershipForm,
  addLandRightType,
  addLandRight,
  addLandCropRotation,
  addLandRealEstateObject,
  addLandUser,
  deleteLandRight,
  deleteLandRightDocumentType,
  deleteLandRightHolder,
  deleteLandRightHolderType,
  deleteLandRightOwnershipForm,
  deleteLandRightType,
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
  type LandRightRefRow,
  type LandRightHolderRow,
  type LandCropRotationRow,
  type LandRealEstateObjectRow,
  type LandMeliorationEntryRow,
  type LandRow,
  type LandTypeRow,
  type LandUserRow,
  updateLand,
  updateLandRightDocumentType,
  updateLandRightHolder,
  updateLandRightHolderType,
  updateLandRightOwnershipForm,
  updateLandMeliorationType,
  updateLandMeliorationSubtype,
  updateLandMeliorationEventType,
  updateLandRight,
  updateLandRightType,
  updateLandCropRotation,
  updateLandRealEstateObject,
  updateLandUser,
  addLandMeliorationEntry,
  addLandMeliorationType,
  addLandMeliorationSubtype,
  addLandMeliorationEventType,
  addLandCropRotationType,
  deleteLandMeliorationEntry,
  deleteLandMeliorationType,
  deleteLandMeliorationSubtype,
  deleteLandMeliorationEventType,
  deleteLandCropRotationType,
  updateLandMeliorationEntry,
  updateLandCropRotationType,
  uploadLandRightFile,
  type LandCropRotationTypeRefRow,
} from '@/lib/landsSupabase'
import {
  loadStorageLocationTypes,
  loadStorageLocationStatuses,
  loadStorageFillStatuses,
  addStorageLocationType,
  updateStorageLocationType,
  deleteStorageLocationType,
  addStorageLocationStatus,
  updateStorageLocationStatus,
  deleteStorageLocationStatus,
  addStorageFillStatus,
  updateStorageFillStatus,
  deleteStorageFillStatus,
  type StorageLocationTypeRow,
  type StorageLocationStatusRow,
  type StorageFillStatusRow,
} from '@/lib/storageRefsSupabase'
import {
  loadFields,
  updateField,
  loadFieldMunicipalitiesRefs,
  addFieldMunicipalityRef,
  updateFieldMunicipalityRef,
  deleteFieldMunicipalityRef,
  type FieldRow,
  type FieldMunicipalityRefRow,
} from '@/lib/fieldsSupabase'
import {
  loadEquipmentTypeRefs,
  addEquipmentTypeRef,
  updateEquipmentTypeRef,
  deleteEquipmentTypeRef,
  loadEquipmentConditionRefs,
  addEquipmentConditionRef,
  updateEquipmentConditionRef,
  deleteEquipmentConditionRef,
  type EquipmentTypeRefRow,
  type EquipmentConditionRefRow,
} from '@/lib/equipmentSupabase'

type LatLon = [number, number]
type PolygonGeoJson = { type: 'Polygon'; coordinates: number[][][] }

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
const landTypes = ref<LandTypeRow[]>([])
const landCategories = ref<LandCategoryRow[]>([])
const actualUseOptions = ref<LandActualUseOptionRow[]>([])
const crops = ref<CropRow[]>([])
const fields = ref<FieldRow[]>([])
const landRights = ref<LandRightRow[]>([])
const landRightOwnershipForms = ref<LandRightRefRow[]>([])
const landRightTypes = ref<LandRightRefRow[]>([])
const landRightDocumentTypes = ref<LandRightRefRow[]>([])
const landRightHolderTypes = ref<LandRightRefRow[]>([])
const landRightHolders = ref<LandRightHolderRow[]>([])
const landMeliorationTypes = ref<LandRightRefRow[]>([])
const landMeliorationSubtypes = ref<LandRightRefRow[]>([])
const landMeliorationEventTypes = ref<LandRightRefRow[]>([])
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
const landsRootTab = ref<'registry' | 'melioration' | 'land-refs' | 'rights-refs' | 'crops-refs' | 'melioration-refs' | 'equipment-refs' | 'field-refs' | 'crop-rotation-refs' | 'storage-refs'>('registry')
const landRefsTab = ref<'land-types' | 'land-categories' | 'land-usage'>('land-types')
const rightsRefsTab = ref<'ownership-forms' | 'right-types' | 'document-types' | 'holder-types' | 'holders'>('ownership-forms')
const meliorationRefsTab = ref<'types' | 'subtypes' | 'event-types'>('types')
const equipmentRefsTab = ref<'types' | 'conditions'>('types')
const fieldRefsTab = ref<'municipalities'>('municipalities')
const cropRotationRefsTab = ref<'types'>('types')
const refsLoading = ref(false)
const refsError = ref<string | null>(null)
const newLandTypeName = ref('')
const newLandCategoryName = ref('')
const newLandActualUseOptionName = ref('')
const newCropLabel = ref('')
const newOwnershipFormName = ref('')
const newRightTypeName = ref('')
const newRightDocumentTypeName = ref('')
const newHolderTypeName = ref('')
const newMeliorationTypeName = ref('')
const newMeliorationSubtypeName = ref('')
const newMeliorationEventTypeName = ref('')
const newEquipmentTypeName = ref('')
const newEquipmentConditionName = ref('')
const newFieldMunicipalityName = ref('')
const newCropRotationTypeName = ref('')
const newHolderName = ref('')
const newHolderInn = ref('')
const newHolderKpp = ref('')
const newHolderOgrn = ref('')
const newHolderTypeId = ref('')
const editingHolderId = ref<string | null>(null)
const equipmentTypeRefs = ref<EquipmentTypeRefRow[]>([])
const equipmentConditionRefs = ref<EquipmentConditionRefRow[]>([])
const fieldMunicipalityRefs = ref<FieldMunicipalityRefRow[]>([])
const cropRotationTypeRefs = ref<LandCropRotationTypeRefRow[]>([])
const storageRefsTab = ref<'types' | 'statuses' | 'fill-statuses'>('types')
const storageLocationTypeRefs = ref<StorageLocationTypeRow[]>([])
const storageLocationStatusRefs = ref<StorageLocationStatusRow[]>([])
const storageFillStatusRefs = ref<StorageFillStatusRow[]>([])
const newStorageLocationTypeName = ref('')
const newStorageLocationStatusName = ref('')
const newStorageLocationStatusMarksInactive = ref(false)
const newStorageFillStatusName = ref('')
const DEFAULT_EQUIPMENT_CONDITION_REFS: EquipmentConditionRefRow[] = [
  { code: 'operational', name: 'Исправна', sort_order: 10, created_at: '' },
  { code: 'repair', name: 'В ремонте', sort_order: 20, created_at: '' },
  { code: 'decommissioned', name: 'Выведена', sort_order: 30, created_at: '' },
]
const equipmentConditionRowsForDisplay = computed(() =>
  equipmentConditionRefs.value.length ? equipmentConditionRefs.value : DEFAULT_EQUIPMENT_CONDITION_REFS,
)

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
const ROOT_TAB_QUERY_MAP = new Set(['registry', 'melioration', 'land-refs', 'land-types', 'land-categories', 'land-usage', 'rights-refs', 'crops-refs', 'melioration-refs', 'equipment-refs', 'field-refs', 'crop-rotation-refs', 'storage-refs', 'storage-types', 'storage-statuses', 'storage-fill-statuses'])
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
const selectedLandPolygonPoints = computed<LatLon[]>(() => fromPolygonGeoJson(selectedLand.value?.contour_geojson ?? null))
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
    const polygonPoints = fromPolygonGeoJson(f.contour_geojson as Record<string, unknown> | null)
    if (polygonPoints.length >= 3) {
      const center = polygonCenterFromPoints(polygonPoints)
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
  { id: 'systems', label: 'Мелиоративные системы, расположенные на земельном участке' },
  { id: 'forest', label: 'Мелиоративные защитные лесные насаждения' },
  { id: 'events', label: 'Мелиоративные мероприятия' },
] as const
const MELIORATION_KIND_MAP: Record<(typeof MELIORATION_TABS)[number]['id'], string> = {
  systems: 'systems',
  forest: 'forest',
  events: 'events',
}
const XLS_SEP = '\t'

function escapeXlsCell(val: string): string {
  const s = String(val ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""')
  return s.includes(XLS_SEP) || s.includes('"') || s.includes('\r') ? `"${s}"` : s
}

function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
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
  const line = (arr: string[]) => arr.map(escapeXlsCell).join(XLS_SEP)
  const csv = '\uFEFF' + [line(headers), ...rows.map((r) => line(r))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
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
    ['№ ПОЛЯ ЕФИС ЗСН', landEfisNumberDisplay(land)],
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
  '№ ПОЛЯ ЕФИС ЗСН',
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
  '№ ПОЛЯ ЕФИС ЗСН',
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
  '№ ПОЛЯ ЕФИС ЗСН',
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
    '№ ПОЛЯ ЕФИС ЗСН',
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
  const line = (arr: string[]) => arr.map(escapeXlsCell).join(XLS_SEP)
  const csv = '\uFEFF' + [line(headers), ...rows.map((r) => line(r))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `реестр_земель_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function exportLandsToPdf() {
  if (!lands.value.length) return
  const headers = [
    'Кадастровый номер',
    '№ ПОЛЯ ЕФИС ЗСН',
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
  mapContourDraftPoints.value = fromPolygonGeoJson(land.contour_geojson)
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
  return Number(value).toFixed(fractionDigits)
}

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url)
}

function fileLabelFromUrl(url: string): string {
  const noQuery = url.split('?')[0] ?? url
  const parts = noQuery.split('/')
  return parts.at(-1) || url
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
      '№ ПОЛЯ ЕФИС ЗСН',
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
      '№ ПОЛЯ ЕФИС ЗСН',
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
    '№ ПОЛЯ ЕФИС ЗСН',
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

function polygonCenterFromPoints(points: LatLon[]): { lat: number; lon: number } | null {
  if (!points.length) return null
  const lat = points.reduce((sum, p) => sum + p[0], 0) / points.length
  const lon = points.reduce((sum, p) => sum + p[1], 0) / points.length
  return { lat, lon }
}

function toPolygonGeoJson(points: LatLon[]): PolygonGeoJson | null {
  if (points.length < 3) return null
  const ring = points.map((p) => [p[1], p[0]])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (!first || !last) return null
  const closed = first[0] === last[0] && first[1] === last[1]
    ? ring
    : [...ring, [first[0], first[1]]]
  return { type: 'Polygon', coordinates: [closed] }
}

function fromPolygonGeoJson(contour: Record<string, unknown> | null): LatLon[] {
  const coordinates = (contour as { coordinates?: unknown })?.coordinates
  if (!Array.isArray(coordinates) || !Array.isArray(coordinates[0])) return []
  const ring = coordinates[0] as unknown[]
  const points = ring
    .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[1]), Number(p[0])] as LatLon : null))
    .filter((p): p is LatLon => Boolean(p && Number.isFinite(p[0]) && Number.isFinite(p[1])))
  if (points.length > 1) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first && last && first[0] === last[0] && first[1] === last[1]) return points.slice(0, -1)
  }
  return points
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

function ensureRefsSupabaseConfigured(): boolean {
  if (isSupabaseConfigured()) return true
  refsError.value = 'Справочники недоступны: подключите Supabase (проверьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY).'
  return false
}

async function addLandType() {
  const name = newLandTypeName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandTypeApi(name)
    landTypes.value = [...landTypes.value, row]
    newLandTypeName.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить тип земли'
  } finally {
    refsLoading.value = false
  }
}

async function addLandCategory() {
  const name = newLandCategoryName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandCategoryApi(name)
    landCategories.value = [...landCategories.value, row]
    newLandCategoryName.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить категорию земли'
  } finally {
    refsLoading.value = false
  }
}

async function removeLandType(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandTypeApi(id)
    landTypes.value = landTypes.value.filter((item) => item.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить тип земли'
  } finally {
    refsLoading.value = false
  }
}

async function editLandType(row: { id: string; name: string }) {
  const next = prompt('Новое название типа земли', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandTypeApi(row.id, next)
    landTypes.value = landTypes.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить тип земли'
  } finally {
    refsLoading.value = false
  }
}

async function removeLandCategory(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandCategoryApi(id)
    landCategories.value = landCategories.value.filter((item) => item.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить категорию земли'
  } finally {
    refsLoading.value = false
  }
}

async function editLandCategory(row: { id: string; name: string }) {
  const next = prompt('Новое название категории земли', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandCategoryApi(row.id, next)
    landCategories.value = landCategories.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить категорию земли'
  } finally {
    refsLoading.value = false
  }
}

async function addLandActualUseOption() {
  const name = newLandActualUseOptionName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandActualUseOptionApi(name)
    actualUseOptions.value = [...actualUseOptions.value, row]
    newLandActualUseOptionName.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить использование участка'
  } finally {
    refsLoading.value = false
  }
}

async function removeLandActualUseOption(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandActualUseOptionApi(id)
    actualUseOptions.value = actualUseOptions.value.filter((item) => item.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить использование участка'
  } finally {
    refsLoading.value = false
  }
}

async function editLandUsageOption(row: { id: string; name: string }) {
  const next = prompt('Новое значение использования участка', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandActualUseOptionApi(row.id, next)
    actualUseOptions.value = actualUseOptions.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить использование участка'
  } finally {
    refsLoading.value = false
  }
}

async function addCropRef() {
  const label = newCropLabel.value.trim()
  if (!label) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addCropByLabel(label)
    crops.value = [...crops.value, row]
    newCropLabel.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить культуру'
  } finally {
    refsLoading.value = false
  }
}

async function editCropRef(row: CropRow) {
  const next = prompt('Новое название культуры', row.label)?.trim()
  if (!next || next === row.label || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateCropApi(row.id, row.key, next)
    crops.value = crops.value.map((x) => (x.id === row.id ? { ...x, label: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить культуру'
  } finally {
    refsLoading.value = false
  }
}

async function removeCropRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteCropApi(id)
    crops.value = crops.value.filter((item) => item.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить культуру'
  } finally {
    refsLoading.value = false
  }
}

async function addCropRotationTypeRef() {
  const name = newCropRotationTypeName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandCropRotationType(name)
    cropRotationTypeRefs.value = [...cropRotationTypeRefs.value, row]
    newCropRotationTypeName.value = ''
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось добавить тип севооборота')
  } finally {
    refsLoading.value = false
  }
}

async function editCropRotationTypeRef(row: LandCropRotationTypeRefRow) {
  const next = prompt('Новое название типа севооборота', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandCropRotationType(row.id, next)
    cropRotationTypeRefs.value = cropRotationTypeRefs.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось обновить тип севооборота')
  } finally {
    refsLoading.value = false
  }
}

async function removeCropRotationTypeRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandCropRotationType(id)
    cropRotationTypeRefs.value = cropRotationTypeRefs.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось удалить тип севооборота')
  } finally {
    refsLoading.value = false
  }
}

async function addStorageLocationTypeRef() {
  const name = newStorageLocationTypeName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addStorageLocationType(name)
    storageLocationTypeRefs.value = [...storageLocationTypeRefs.value, row]
    newStorageLocationTypeName.value = ''
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось добавить тип места хранения')
  } finally {
    refsLoading.value = false
  }
}

async function editStorageLocationTypeRef(row: StorageLocationTypeRow) {
  const next = prompt('Новое название типа места хранения', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateStorageLocationType(row.id, next)
    storageLocationTypeRefs.value = storageLocationTypeRefs.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось обновить тип места хранения')
  } finally {
    refsLoading.value = false
  }
}

async function removeStorageLocationTypeRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteStorageLocationType(id)
    storageLocationTypeRefs.value = storageLocationTypeRefs.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось удалить тип места хранения')
  } finally {
    refsLoading.value = false
  }
}

async function addStorageLocationStatusRef() {
  const name = newStorageLocationStatusName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addStorageLocationStatus({
      name,
      marks_inactive: newStorageLocationStatusMarksInactive.value,
    })
    storageLocationStatusRefs.value = [...storageLocationStatusRefs.value, row]
    newStorageLocationStatusName.value = ''
    newStorageLocationStatusMarksInactive.value = false
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось добавить статус места хранения')
  } finally {
    refsLoading.value = false
  }
}

async function editStorageLocationStatusRef(row: StorageLocationStatusRow) {
  const next = prompt('Новое название статуса', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateStorageLocationStatus(row.id, { name: next })
    storageLocationStatusRefs.value = storageLocationStatusRefs.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось обновить статус места хранения')
  } finally {
    refsLoading.value = false
  }
}

async function removeStorageLocationStatusRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteStorageLocationStatus(id)
    storageLocationStatusRefs.value = storageLocationStatusRefs.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось удалить статус места хранения')
  } finally {
    refsLoading.value = false
  }
}

async function addStorageFillStatusRef() {
  const name = newStorageFillStatusName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addStorageFillStatus(name)
    storageFillStatusRefs.value = [...storageFillStatusRefs.value, row]
    newStorageFillStatusName.value = ''
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось добавить статус заполнения')
  } finally {
    refsLoading.value = false
  }
}

async function editStorageFillStatusRef(row: StorageFillStatusRow) {
  const next = prompt('Новое название статуса заполнения', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateStorageFillStatus(row.id, next)
    storageFillStatusRefs.value = storageFillStatusRefs.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось обновить статус заполнения')
  } finally {
    refsLoading.value = false
  }
}

async function removeStorageFillStatusRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteStorageFillStatus(id)
    storageFillStatusRefs.value = storageFillStatusRefs.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось удалить статус заполнения')
  } finally {
    refsLoading.value = false
  }
}

async function addOwnershipForm() {
  const name = newOwnershipFormName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandRightOwnershipForm(name)
    landRightOwnershipForms.value = [...landRightOwnershipForms.value, row]
    newOwnershipFormName.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить форму собственности'
  } finally {
    refsLoading.value = false
  }
}

async function removeOwnershipForm(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandRightOwnershipForm(id)
    landRightOwnershipForms.value = landRightOwnershipForms.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить форму собственности'
  } finally {
    refsLoading.value = false
  }
}

async function editOwnershipForm(row: LandRightRefRow) {
  const next = prompt('Новое название формы собственности', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandRightOwnershipForm(row.id, next)
    landRightOwnershipForms.value = landRightOwnershipForms.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить форму собственности'
  } finally {
    refsLoading.value = false
  }
}

async function addRightTypeRef() {
  const name = newRightTypeName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandRightType(name)
    landRightTypes.value = [...landRightTypes.value, row]
    newRightTypeName.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить вид права'
  } finally {
    refsLoading.value = false
  }
}

async function removeRightTypeRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandRightType(id)
    landRightTypes.value = landRightTypes.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить вид права'
  } finally {
    refsLoading.value = false
  }
}

async function editRightTypeRef(row: LandRightRefRow) {
  const next = prompt('Новое название вида права', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandRightType(row.id, next)
    landRightTypes.value = landRightTypes.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить вид права'
  } finally {
    refsLoading.value = false
  }
}

async function addRightDocumentTypeRef() {
  const name = newRightDocumentTypeName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandRightDocumentType(name)
    landRightDocumentTypes.value = [...landRightDocumentTypes.value, row]
    newRightDocumentTypeName.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить тип подтверждающего документа'
  } finally {
    refsLoading.value = false
  }
}

async function removeRightDocumentTypeRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandRightDocumentType(id)
    landRightDocumentTypes.value = landRightDocumentTypes.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить тип документа'
  } finally {
    refsLoading.value = false
  }
}

async function editRightDocumentTypeRef(row: LandRightRefRow) {
  const next = prompt('Новое название типа документа', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandRightDocumentType(row.id, next)
    landRightDocumentTypes.value = landRightDocumentTypes.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить тип документа'
  } finally {
    refsLoading.value = false
  }
}

async function addHolderTypeRef() {
  const name = newHolderTypeName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandRightHolderType(name)
    landRightHolderTypes.value = [...landRightHolderTypes.value, row]
    newHolderTypeName.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить вид правообладания'
  } finally {
    refsLoading.value = false
  }
}

async function removeHolderTypeRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandRightHolderType(id)
    landRightHolderTypes.value = landRightHolderTypes.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить вид правообладания'
  } finally {
    refsLoading.value = false
  }
}

async function editHolderTypeRef(row: LandRightRefRow) {
  const next = prompt('Новое название вида правообладания', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandRightHolderType(row.id, next)
    landRightHolderTypes.value = landRightHolderTypes.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить вид правообладания'
  } finally {
    refsLoading.value = false
  }
}

async function addRightHolderRef() {
  const name = newHolderName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    if (editingHolderId.value) {
      await updateLandRightHolder(editingHolderId.value, {
        name,
        holder_type_id: newHolderTypeId.value || null,
        inn: newHolderInn.value || null,
        kpp: newHolderKpp.value || null,
        ogrn: newHolderOgrn.value || null,
      })
      landRightHolders.value = landRightHolders.value.map((x) => (x.id === editingHolderId.value
        ? {
          ...x,
          name,
          holder_type_id: newHolderTypeId.value || null,
          inn: newHolderInn.value || null,
          kpp: newHolderKpp.value || null,
          ogrn: newHolderOgrn.value || null,
        }
        : x))
    } else {
      const row = await addLandRightHolder({
        name,
        holder_type_id: newHolderTypeId.value || null,
        inn: newHolderInn.value || null,
        kpp: newHolderKpp.value || null,
        ogrn: newHolderOgrn.value || null,
      })
      landRightHolders.value = [...landRightHolders.value, row]
    }
    editingHolderId.value = null
    newHolderName.value = ''
    newHolderInn.value = ''
    newHolderKpp.value = ''
    newHolderOgrn.value = ''
    newHolderTypeId.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить правообладателя'
  } finally {
    refsLoading.value = false
  }
}

async function removeRightHolderRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandRightHolder(id)
    landRightHolders.value = landRightHolders.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить правообладателя'
  } finally {
    refsLoading.value = false
  }
}

function editRightHolderRef(row: LandRightHolderRow) {
  editingHolderId.value = row.id
  newHolderName.value = row.name
  newHolderTypeId.value = row.holder_type_id ?? ''
  newHolderInn.value = row.inn ?? ''
  newHolderKpp.value = row.kpp ?? ''
  newHolderOgrn.value = row.ogrn ?? ''
}

async function addMeliorationTypeRef() {
  const name = newMeliorationTypeName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandMeliorationType(name)
    landMeliorationTypes.value = [...landMeliorationTypes.value, row]
    newMeliorationTypeName.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить тип мелиорации'
  } finally {
    refsLoading.value = false
  }
}

async function editMeliorationTypeRef(row: LandRightRefRow) {
  const next = prompt('Новое название типа мелиорации', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandMeliorationType(row.id, next)
    landMeliorationTypes.value = landMeliorationTypes.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить тип мелиорации'
  } finally {
    refsLoading.value = false
  }
}

async function removeMeliorationTypeRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandMeliorationType(id)
    landMeliorationTypes.value = landMeliorationTypes.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить тип мелиорации'
  } finally {
    refsLoading.value = false
  }
}

async function addMeliorationSubtypeRef() {
  const name = newMeliorationSubtypeName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandMeliorationSubtype(name)
    landMeliorationSubtypes.value = [...landMeliorationSubtypes.value, row]
    newMeliorationSubtypeName.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить вид мелиорации'
  } finally {
    refsLoading.value = false
  }
}

async function editMeliorationSubtypeRef(row: LandRightRefRow) {
  const next = prompt('Новое название вида мелиорации', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandMeliorationSubtype(row.id, next)
    landMeliorationSubtypes.value = landMeliorationSubtypes.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить вид мелиорации'
  } finally {
    refsLoading.value = false
  }
}

async function removeMeliorationSubtypeRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandMeliorationSubtype(id)
    landMeliorationSubtypes.value = landMeliorationSubtypes.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить вид мелиорации'
  } finally {
    refsLoading.value = false
  }
}

async function addMeliorationEventTypeRef() {
  const name = newMeliorationEventTypeName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addLandMeliorationEventType(name)
    landMeliorationEventTypes.value = [...landMeliorationEventTypes.value, row]
    newMeliorationEventTypeName.value = ''
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось добавить тип мероприятия'
  } finally {
    refsLoading.value = false
  }
}

async function editMeliorationEventTypeRef(row: LandRightRefRow) {
  const next = prompt('Новое название типа мероприятия', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateLandMeliorationEventType(row.id, next)
    landMeliorationEventTypes.value = landMeliorationEventTypes.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось обновить тип мероприятия'
  } finally {
    refsLoading.value = false
  }
}

async function removeMeliorationEventTypeRef(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteLandMeliorationEventType(id)
    landMeliorationEventTypes.value = landMeliorationEventTypes.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = e instanceof Error ? e.message : 'Не удалось удалить тип мероприятия'
  } finally {
    refsLoading.value = false
  }
}

function normalizeEquipmentTypeCode(value: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  const translit = value
    .trim()
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
  return translit.replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
}

function makeUniqueConditionCode(name: string): string {
  const base = normalizeEquipmentTypeCode(name) || `condition-${Date.now()}`
  const used = new Set(equipmentConditionRefs.value.map((x) => x.code))
  if (!used.has(base)) return base
  let idx = 2
  let candidate = `${base}-${idx}`
  while (used.has(candidate)) {
    idx += 1
    candidate = `${base}-${idx}`
  }
  return candidate
}

async function addEquipmentTypeReference() {
  const name = newEquipmentTypeName.value.trim()
  const code = normalizeEquipmentTypeCode(name)
  if (!name || !code) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addEquipmentTypeRef({ code, name })
    equipmentTypeRefs.value = [...equipmentTypeRefs.value, row]
    newEquipmentTypeName.value = ''
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось добавить тип техники')
  } finally {
    refsLoading.value = false
  }
}

async function editEquipmentTypeReference(row: EquipmentTypeRefRow) {
  const next = prompt('Новое название типа техники', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateEquipmentTypeRef(row.id, { name: next })
    equipmentTypeRefs.value = equipmentTypeRefs.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось обновить тип техники')
  } finally {
    refsLoading.value = false
  }
}

async function removeEquipmentTypeReference(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteEquipmentTypeRef(id)
    equipmentTypeRefs.value = equipmentTypeRefs.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось удалить тип техники')
  } finally {
    refsLoading.value = false
  }
}

async function editEquipmentConditionReference(row: EquipmentConditionRefRow) {
  const next = prompt('Новое название состояния техники', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateEquipmentConditionRef(row.code, { name: next })
    equipmentConditionRefs.value = equipmentConditionRefs.value.map((x) => (x.code === row.code ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось обновить состояние техники')
  } finally {
    refsLoading.value = false
  }
}

async function removeEquipmentConditionReference(code: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteEquipmentConditionRef(code)
    equipmentConditionRefs.value = equipmentConditionRefs.value.filter((x) => x.code !== code)
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось удалить состояние техники')
  } finally {
    refsLoading.value = false
  }
}

async function addEquipmentConditionReference() {
  const name = newEquipmentConditionName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addEquipmentConditionRef({
      code: makeUniqueConditionCode(name),
      name,
    })
    equipmentConditionRefs.value = [...equipmentConditionRefs.value, row]
    newEquipmentConditionName.value = ''
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось добавить состояние техники')
  } finally {
    refsLoading.value = false
  }
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
  } catch {
    // Не даем справочникам техники ломать загрузку раздела "Земли"
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
  } catch {
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
  } catch {
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
  } catch {
    storageLocationTypeRefs.value = []
    storageLocationStatusRefs.value = []
    storageFillStatusRefs.value = []
  }
}

async function addFieldMunicipalityReference() {
  const name = newFieldMunicipalityName.value.trim()
  if (!name) return
  if (!ensureRefsSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    const row = await addFieldMunicipalityRef({ name })
    fieldMunicipalityRefs.value = [...fieldMunicipalityRefs.value, row]
    newFieldMunicipalityName.value = ''
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось добавить муниципальное образование')
  } finally {
    refsLoading.value = false
  }
}

async function editFieldMunicipalityReference(row: FieldMunicipalityRefRow) {
  const next = prompt('Новое название муниципального образования', row.name)?.trim()
  if (!next || next === row.name || !isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await updateFieldMunicipalityRef(row.id, { name: next })
    fieldMunicipalityRefs.value = fieldMunicipalityRefs.value.map((x) => (x.id === row.id ? { ...x, name: next } : x))
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось обновить муниципальное образование')
  } finally {
    refsLoading.value = false
  }
}

async function removeFieldMunicipalityReference(id: string) {
  if (!isSupabaseConfigured()) return
  refsLoading.value = true
  refsError.value = null
  try {
    await deleteFieldMunicipalityRef(id)
    fieldMunicipalityRefs.value = fieldMunicipalityRefs.value.filter((x) => x.id !== id)
  } catch (e) {
    refsError.value = extractErrorMessage(e, 'Не удалось удалить муниципальное образование')
  } finally {
    refsLoading.value = false
  }
}

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
  if (!skipConfirm && !confirm('Удалить землю? Поля останутся, но будут отвязаны.')) return
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

function requestDeleteLandType(id: string) {
  deleteTarget.value = { type: 'land-type', id }
  deleteConfirmTitle.value = 'Удаление типа земли'
  deleteConfirmText.value = 'Тип земли будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteLandCategory(id: string) {
  deleteTarget.value = { type: 'land-category', id }
  deleteConfirmTitle.value = 'Удаление категории земли'
  deleteConfirmText.value = 'Категория земли будет удалена из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteLandUsage(id: string) {
  deleteTarget.value = { type: 'land-usage', id }
  deleteConfirmTitle.value = 'Удаление варианта использования'
  deleteConfirmText.value = 'Вариант использования участка будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteCropRef(id: string) {
  deleteTarget.value = { type: 'crop-ref', id }
  deleteConfirmTitle.value = 'Удаление культуры'
  deleteConfirmText.value = 'Культура будет удалена из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteCropRotationType(id: string) {
  deleteTarget.value = { type: 'crop-rotation-type', id }
  deleteConfirmTitle.value = 'Удаление типа севооборота'
  deleteConfirmText.value = 'Тип севооборота будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteStorageLocationType(id: string) {
  deleteTarget.value = { type: 'storage-location-type', id }
  deleteConfirmTitle.value = 'Удаление типа места хранения'
  deleteConfirmText.value = 'Тип будет удалён из справочника. Убедитесь, что ни одно место хранения на него не ссылается.'
  deleteConfirmOpen.value = true
}

function requestDeleteStorageLocationStatus(id: string) {
  deleteTarget.value = { type: 'storage-location-status', id }
  deleteConfirmTitle.value = 'Удаление статуса места хранения'
  deleteConfirmText.value = 'Статус будет удалён из справочника. Убедитесь, что ни одно место хранения на него не ссылается.'
  deleteConfirmOpen.value = true
}

function requestDeleteStorageFillStatus(id: string) {
  deleteTarget.value = { type: 'storage-fill-status', id }
  deleteConfirmTitle.value = 'Удаление статуса заполнения'
  deleteConfirmText.value = 'Статус будет удалён из справочника. Убедитесь, что ни одно место хранения на него не ссылается.'
  deleteConfirmOpen.value = true
}

function requestDeleteMelioration(id: string) {
  deleteTarget.value = { type: 'melioration', id }
  deleteConfirmTitle.value = 'Удаление записи мелиорации'
  deleteConfirmText.value = 'Запись будет удалена без возможности восстановления.'
  deleteConfirmOpen.value = true
}

function requestDeleteOwnershipForm(id: string) {
  deleteTarget.value = { type: 'ownership-form', id }
  deleteConfirmTitle.value = 'Удаление формы собственности'
  deleteConfirmText.value = 'Форма собственности будет удалена из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteRightType(id: string) {
  deleteTarget.value = { type: 'right-type', id }
  deleteConfirmTitle.value = 'Удаление вида права'
  deleteConfirmText.value = 'Вид права будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteRightDocumentType(id: string) {
  deleteTarget.value = { type: 'right-document-type', id }
  deleteConfirmTitle.value = 'Удаление типа документа'
  deleteConfirmText.value = 'Тип подтверждающего документа будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteHolderType(id: string) {
  deleteTarget.value = { type: 'holder-type', id }
  deleteConfirmTitle.value = 'Удаление вида правообладания'
  deleteConfirmText.value = 'Вид правообладания будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteRightHolder(id: string) {
  deleteTarget.value = { type: 'right-holder', id }
  deleteConfirmTitle.value = 'Удаление правообладателя'
  deleteConfirmText.value = 'Правообладатель будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteMeliorationType(id: string) {
  deleteTarget.value = { type: 'melioration-type', id }
  deleteConfirmTitle.value = 'Удаление типа мелиорации'
  deleteConfirmText.value = 'Тип мелиорации будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteMeliorationSubtype(id: string) {
  deleteTarget.value = { type: 'melioration-subtype', id }
  deleteConfirmTitle.value = 'Удаление вида мелиорации'
  deleteConfirmText.value = 'Вид мелиорации будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteMeliorationEventType(id: string) {
  deleteTarget.value = { type: 'melioration-event-type', id }
  deleteConfirmTitle.value = 'Удаление типа мероприятия'
  deleteConfirmText.value = 'Тип мероприятия будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteEquipmentType(id: string) {
  deleteTarget.value = { type: 'equipment-type', id }
  deleteConfirmTitle.value = 'Удаление типа техники'
  deleteConfirmText.value = 'Тип техники будет удален из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteEquipmentCondition(code: string) {
  deleteTarget.value = { type: 'equipment-condition', id: code }
  deleteConfirmTitle.value = 'Удаление состояния техники'
  deleteConfirmText.value = 'Состояние техники будет удалено из справочника.'
  deleteConfirmOpen.value = true
}

function requestDeleteFieldMunicipality(id: string) {
  deleteTarget.value = { type: 'field-municipality', id }
  deleteConfirmTitle.value = 'Удаление муниципального образования'
  deleteConfirmText.value = 'Муниципальное образование будет удалено из справочника.'
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
  if (saving.value || refsLoading.value) return
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
  const line = (arr: string[]) => arr.map(escapeXlsCell).join(XLS_SEP)
  const csv = '\uFEFF' + [line(headers), ...rows.map((r) => line(r))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `мелиорация_${meliorationTab.value}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
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
  } else if (deleteTarget.value.type === 'land-type') {
    await removeLandType(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'land-category') {
    await removeLandCategory(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'land-usage') {
    await removeLandActualUseOption(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'melioration') {
    const id = deleteTarget.value.id
    await deleteLandMeliorationEntry(id)
    if (!isDetailsMode.value && landsRootTab.value === 'melioration') {
      await reloadMeliorationList()
    } else {
      landMeliorationEntries.value = landMeliorationEntries.value.filter((x) => x.id !== id)
    }
  } else if (deleteTarget.value.type === 'ownership-form') {
    await removeOwnershipForm(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'right-type') {
    await removeRightTypeRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'right-document-type') {
    await removeRightDocumentTypeRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'holder-type') {
    await removeHolderTypeRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'right-holder') {
    await removeRightHolderRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'melioration-type') {
    await removeMeliorationTypeRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'melioration-subtype') {
    await removeMeliorationSubtypeRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'melioration-event-type') {
    await removeMeliorationEventTypeRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'equipment-type') {
    await removeEquipmentTypeReference(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'equipment-condition') {
    await removeEquipmentConditionReference(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'field-municipality') {
    await removeFieldMunicipalityReference(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'storage-location-type') {
    await removeStorageLocationTypeRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'storage-location-status') {
    await removeStorageLocationStatusRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'storage-fill-status') {
    await removeStorageFillStatusRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'crop-rotation-type') {
    await removeCropRotationTypeRef(deleteTarget.value.id)
  } else if (deleteTarget.value.type === 'land') {
    await removeLand(true)
  } else {
    await removeCropRef(deleteTarget.value.id)
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
  if (tab === 'storage-types' || tab === 'storage-statuses' || tab === 'storage-fill-statuses') {
    landsRootTab.value = 'storage-refs'
    storageRefsTab.value =
      tab === 'storage-types' ? 'types' : tab === 'storage-statuses' ? 'statuses' : 'fill-statuses'
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
        <button v-if="isDetailsMode" type="button" class="lands-back-btn" @click="goToRegistry" aria-label="Назад к списку земель">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Назад к списку земель
        </button>
        <p v-if="!isDetailsMode" class="lands-subtitle">{{ landsListSubtitle }}</p>
      </div>
      <div class="lands-top-actions">
        <button
          v-if="isDetailsMode && selectedLand && !landInlineEditOpen"
          type="button"
          class="lands-edit-btn"
          @click="startInlineEdit()"
        >
          Редактировать участок
        </button>
        <button
          v-if="isDetailsMode && selectedLand && landInlineEditOpen"
          type="button"
          class="lands-edit-btn"
          :disabled="saving"
          @click="closeLandEditor"
        >
          Отменить редактирование
        </button>
        <button v-if="!isDetailsMode && landsRootTab === 'registry'" type="button" class="lands-create-btn lands-btn--add" @click="openCreateLand">Новая земля</button>
      </div>
    </header>

    <p v-if="error" class="lands-error">{{ error }}</p>
    <div v-if="loading"><UiLoadingBar /></div>

    <div v-else class="lands-content">
      <section v-if="!isDetailsMode" class="lands-card page-enter-item">
        <div class="lands-tabs lands-tabs--top">
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
            <h2>Реестр земель</h2>
            <div class="lands-table-tools">
              <input v-model.trim="landsSearch" class="lands-search" type="text" placeholder="Поиск по адресу или кадастровому номеру..." />
              <div class="task-export-btns">
                <button
                  type="button"
                  class="task-btn-export action_has has_saved"
                  :disabled="!lands.length"
                  title="Экспорт в PDF"
                  @click="exportLandsToPdf"
                >
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" data-path="box" />
                    <path d="M14 2v6h6" data-path="line-top" />
                    <path d="M12 18v-6" data-path="line-bottom" />
                    <path d="M9 15h6" />
                  </svg>
                  PDF
                </button>
                <button
                  type="button"
                  class="task-btn-export action_has has_saved"
                  :disabled="!lands.length"
                  title="Экспорт в Excel"
                  @click="exportLandsToExcel"
                >
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" data-path="box" />
                    <path d="M14 2v6h6" data-path="line-top" />
                    <path d="M8 13h2" data-path="line-bottom" />
                    <path d="M8 17h2" />
                    <path d="M14 13h2" />
                    <path d="M14 17h2" />
                  </svg>
                  Excel
                </button>
              </div>
            </div>
          </div>
          <div class="lands-table-wrap">
            <table class="lands-table">
              <thead>
                <tr>
                  <th>Кадастровый номер</th>
                  <th>№ ПОЛЯ ЕФИС ЗСН</th>
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
                  <td>{{ Number(land.area || 0).toFixed(2) }}</td>
                  <td>{{ land.permitted_use_docs || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!lands.length && landsSearch.trim()" class="lands-muted">По вашему запросу ничего не найдено.</p>
          <p v-else-if="!lands.length" class="lands-muted">Пока нет созданных земель.</p>

          <footer v-if="landsTotal > 0" class="fields-pagination">
            <p class="fields-pagination-info">
              Показано
              <span class="fields-pagination-num">{{ landsPageStart }}</span>
              –
              <span class="fields-pagination-num">{{ landsPageEnd }}</span>
              из
              <span class="fields-pagination-num">{{ landsTotal }}</span>
            </p>
            <div class="fields-pagination-right">
              <nav class="fields-pagination-nav" aria-label="Пагинация">
                <button
                  type="button"
                  class="fields-page-btn fields-page-btn--edge"
                  :disabled="landsPage <= 1"
                  aria-label="Предыдущая страница"
                  @click="setLandsPage(landsPage - 1)"
                >
                  &lt;
                </button>
                <template v-for="(p, i) in landsPageNumbers" :key="p === 'ellipsis' ? `lands-e-${i}` : p">
                  <button
                    v-if="p !== 'ellipsis'"
                    type="button"
                    class="fields-page-btn"
                    :class="{ 'fields-page-btn--active': p === landsPage }"
                    @click="setLandsPage(p as number)"
                  >
                    {{ p }}
                  </button>
                  <span v-else class="fields-page-ellipsis">…</span>
                </template>
                <button
                  type="button"
                  class="fields-page-btn fields-page-btn--edge"
                  :disabled="landsPage >= landsTotalPages"
                  aria-label="Следующая страница"
                  @click="setLandsPage(landsPage + 1)"
                >
                  &gt;
                </button>
              </nav>
              <label class="fields-pagination-size">
                <span class="fields-pagination-size-label">На странице</span>
                <select
                  v-model.number="landsPageSize"
                  class="fields-pagination-select"
                  @change="onLandsPageSizeChange"
                >
                  <option :value="10">10</option>
                  <option :value="25">25</option>
                  <option :value="50">50</option>
                </select>
              </label>
            </div>
          </footer>
        </template>

        <template v-else-if="landsRootTab === 'melioration'">
          <div class="lands-tabs lands-tabs--sub lands-tabs--melioration">
            <button
              v-for="tab in MELIORATION_TABS"
              :key="tab.id"
              type="button"
              class="lands-tab-btn"
              :class="{ 'is-active': meliorationTab === tab.id }"
              @click="meliorationTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
          <div class="lands-melioration-head">
            <div class="task-export-btns">
              <button type="button" class="task-btn-export action_has has_saved" :disabled="!meliorationEntriesByTab.length" @click="exportMeliorationTabToPdf">
                <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M12 18v-6" />
                  <path d="M9 15h6" />
                </svg>
                PDF
              </button>
              <button type="button" class="task-btn-export action_has has_saved" :disabled="!meliorationEntriesByTab.length" @click="exportMeliorationTabToExcel">
                <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M8 13h2" />
                  <path d="M8 17h2" />
                  <path d="M14 13h2" />
                  <path d="M14 17h2" />
                </svg>
                Excel
              </button>
            </div>
            <button type="button" class="lands-btn lands-btn--save lands-btn--add" @click="openMeliorationModal">Добавить</button>
          </div>
          <div class="lands-table-wrap lands-table-wrap--melioration">
            <table class="lands-table">
              <thead>
                <tr v-if="meliorationTab === 'systems'">
                  <th>№ ПОЛЯ ЕФИС ЗСН</th>
                  <th>Тип мелиорации</th>
                  <th>Вид мелиорации</th>
                  <th>Описание системы и местоположения</th>
                  <th>Кадастровый номер земельного участка</th>
                  <th>Дата ввода в эксплуатацию</th>
                  <th>Площадь орошаемых (осушаемых) земель, га</th>
                  <th>Действия</th>
                </tr>
                <tr v-else-if="meliorationTab === 'forest'">
                  <th>№ ПОЛЯ ЕФИС ЗСН</th>
                  <th>Площадь МЗЛН, га</th>
                  <th>Количественные, качественные характеристики</th>
                  <th>Год создания</th>
                  <th>Информация о реконструкции насаждений</th>
                  <th>Кадастровый номер земельного участка</th>
                  <th>Действия</th>
                </tr>
                <tr v-else>
                  <th>№ ПОЛЯ ЕФИС ЗСН</th>
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
                    <td>{{ entry.commissioned_at || '—' }}</td>
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
                    <td>{{ entry.event_date || '—' }}</td>
                    <td>{{ formatRotationMetric(entry.area_ha) }}</td>
                    <td>{{ entry.project_approval || '—' }}</td>
                  </template>
                  <td @click.stop>
                    <div class="lands-item-actions">
                      <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="openMeliorationEditModal(entry)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                      </button>
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
          <footer v-if="meliorationTotal > 0" class="fields-pagination">
            <p class="fields-pagination-info">
              Показано
              <span class="fields-pagination-num">{{ meliorationPageStart }}</span>
              –
              <span class="fields-pagination-num">{{ meliorationPageEnd }}</span>
              из
              <span class="fields-pagination-num">{{ meliorationTotal }}</span>
            </p>
            <div class="fields-pagination-right">
              <nav class="fields-pagination-nav" aria-label="Пагинация мелиорации">
                <button
                  type="button"
                  class="fields-page-btn fields-page-btn--edge"
                  :disabled="meliorationPage <= 1"
                  aria-label="Предыдущая страница"
                  @click="setMeliorationPage(meliorationPage - 1)"
                >
                  &lt;
                </button>
                <template v-for="(p, i) in meliorationPageNumbers" :key="p === 'ellipsis' ? `mel-e-${i}` : p">
                  <button
                    v-if="p !== 'ellipsis'"
                    type="button"
                    class="fields-page-btn"
                    :class="{ 'fields-page-btn--active': p === meliorationPage }"
                    @click="setMeliorationPage(p as number)"
                  >
                    {{ p }}
                  </button>
                  <span v-else class="fields-page-ellipsis">…</span>
                </template>
                <button
                  type="button"
                  class="fields-page-btn fields-page-btn--edge"
                  :disabled="meliorationPage >= meliorationTotalPages"
                  aria-label="Следующая страница"
                  @click="setMeliorationPage(meliorationPage + 1)"
                >
                  &gt;
                </button>
              </nav>
              <label class="fields-pagination-size">
                <span class="fields-pagination-size-label">На странице</span>
                <select
                  v-model.number="meliorationPageSize"
                  class="fields-pagination-select"
                  @change="onMeliorationPageSizeChange"
                >
                  <option :value="10">10</option>
                  <option :value="25">25</option>
                  <option :value="50">50</option>
                </select>
              </label>
            </div>
          </footer>
        </template>
        <template v-else-if="landsRootTab === 'land-refs'">
          <p v-if="refsError" class="lands-error">{{ refsError }}</p>
          <div class="lands-tabs lands-tabs--sub">
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landRefsTab === 'land-types' }" @click="landRefsTab = 'land-types'">
              Типы земли
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landRefsTab === 'land-categories' }" @click="landRefsTab = 'land-categories'">
              Категории земли
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': landRefsTab === 'land-usage' }" @click="landRefsTab = 'land-usage'">
              Использование участка
            </button>
          </div>
          <div v-if="landRefsTab === 'land-types'" class="lands-ref-block">
            <h2>Типы земли</h2>
            <div class="lands-ref-add-row">
              <input v-model="newLandTypeName" class="lands-search" type="text" placeholder="Например: Пашня, Залежь" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newLandTypeName.trim()" @click="addLandType">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="type in landTypes" :key="type.id" class="lands-list-plain-item">
                <span>{{ type.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editLandType(type)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteLandType(type.id)" />
                </div>
              </div>
              <p v-if="!landTypes.length" class="lands-muted">Пока нет типов земли.</p>
            </div>
          </div>
          <div v-else-if="landRefsTab === 'land-categories'" class="lands-ref-block">
            <h2>Категории земли</h2>
            <div class="lands-ref-add-row">
              <input v-model="newLandCategoryName" class="lands-search" type="text" placeholder="Например: Земли сельскохозяйственного назначения" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newLandCategoryName.trim()" @click="addLandCategory">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="category in landCategories" :key="category.id" class="lands-list-plain-item">
                <span>{{ category.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editLandCategory(category)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteLandCategory(category.id)" />
                </div>
              </div>
              <p v-if="!landCategories.length" class="lands-muted">Пока нет категорий земли.</p>
            </div>
          </div>
          <div v-else class="lands-ref-block">
            <h2>Использование участка</h2>
            <div class="lands-ref-add-row">
              <input v-model="newLandActualUseOptionName" class="lands-search" type="text" placeholder="Например: Используется" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newLandActualUseOptionName.trim()" @click="addLandActualUseOption">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="option in actualUseOptions" :key="option.id" class="lands-list-plain-item">
                <span>{{ option.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editLandUsageOption(option)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteLandUsage(option.id)" />
                </div>
              </div>
              <p v-if="!actualUseOptions.length" class="lands-muted">Пока нет вариантов использования участка.</p>
            </div>
          </div>
        </template>
        <template v-else-if="landsRootTab === 'crops-refs'">
          <p v-if="refsError" class="lands-error">{{ refsError }}</p>
          <div class="lands-ref-block">
            <h2>Справочники СХ культур</h2>
            <div class="lands-ref-add-row">
              <input v-model="newCropLabel" class="lands-search" type="text" placeholder="Например: Пшеница" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newCropLabel.trim()" @click="addCropRef">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in crops" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.label }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editCropRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteCropRef(row.id)" />
                </div>
              </div>
              <p v-if="!crops.length" class="lands-muted">Пока нет культур.</p>
            </div>
          </div>
        </template>
        <template v-else-if="landsRootTab === 'melioration-refs'">
          <p v-if="refsError" class="lands-error">{{ refsError }}</p>
          <div class="lands-tabs lands-tabs--sub">
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': meliorationRefsTab === 'types' }" @click="meliorationRefsTab = 'types'">
              Типы мелиорации
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': meliorationRefsTab === 'subtypes' }" @click="meliorationRefsTab = 'subtypes'">
              Виды мелиорации
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': meliorationRefsTab === 'event-types' }" @click="meliorationRefsTab = 'event-types'">
              Типы мероприятий
            </button>
          </div>
          <div v-if="meliorationRefsTab === 'types'" class="lands-ref-block">
            <h2>Типы мелиорации</h2>
            <div class="lands-ref-add-row">
              <input v-model="newMeliorationTypeName" class="lands-search" type="text" placeholder="Например: Оросительная" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newMeliorationTypeName.trim()" @click="addMeliorationTypeRef">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in landMeliorationTypes" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editMeliorationTypeRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteMeliorationType(row.id)" />
                </div>
              </div>
              <p v-if="!landMeliorationTypes.length" class="lands-muted">Пока нет типов мелиорации.</p>
            </div>
          </div>
          <div v-else-if="meliorationRefsTab === 'subtypes'" class="lands-ref-block">
            <h2>Виды мелиорации</h2>
            <div class="lands-ref-add-row">
              <input v-model="newMeliorationSubtypeName" class="lands-search" type="text" placeholder="Например: Осушительная" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newMeliorationSubtypeName.trim()" @click="addMeliorationSubtypeRef">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in landMeliorationSubtypes" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editMeliorationSubtypeRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteMeliorationSubtype(row.id)" />
                </div>
              </div>
              <p v-if="!landMeliorationSubtypes.length" class="lands-muted">Пока нет видов мелиорации.</p>
            </div>
          </div>
          <div v-else class="lands-ref-block">
            <h2>Типы мероприятий</h2>
            <div class="lands-ref-add-row">
              <input v-model="newMeliorationEventTypeName" class="lands-search" type="text" placeholder="Например: Реконструкция" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newMeliorationEventTypeName.trim()" @click="addMeliorationEventTypeRef">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in landMeliorationEventTypes" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editMeliorationEventTypeRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteMeliorationEventType(row.id)" />
                </div>
              </div>
              <p v-if="!landMeliorationEventTypes.length" class="lands-muted">Пока нет типов мероприятий.</p>
            </div>
          </div>
        </template>
        <template v-else-if="landsRootTab === 'equipment-refs'">
          <p v-if="refsError" class="lands-error">{{ refsError }}</p>
          <div class="lands-tabs lands-tabs--sub">
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': equipmentRefsTab === 'types' }" @click="equipmentRefsTab = 'types'">
              Тип техники
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': equipmentRefsTab === 'conditions' }" @click="equipmentRefsTab = 'conditions'">
              Состояние техники
            </button>
          </div>
          <div v-if="equipmentRefsTab === 'types'" class="lands-ref-block">
            <h2>Тип техники</h2>
            <div class="lands-ref-add-row">
              <input v-model="newEquipmentTypeName" class="lands-search" type="text" placeholder="Например: Трактор" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newEquipmentTypeName.trim()" @click="addEquipmentTypeReference">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in equipmentTypeRefs" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editEquipmentTypeReference(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteEquipmentType(row.id)" />
                </div>
              </div>
              <p v-if="!equipmentTypeRefs.length" class="lands-muted">Пока нет типов техники.</p>
            </div>
          </div>
          <div v-else class="lands-ref-block">
            <h2>Состояние техники</h2>
            <div class="lands-ref-add-row">
              <input v-model="newEquipmentConditionName" class="lands-search" type="text" placeholder="Например: Требует ТО" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newEquipmentConditionName.trim()" @click="addEquipmentConditionReference">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in equipmentConditionRowsForDisplay" :key="row.code" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editEquipmentConditionReference(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteEquipmentCondition(row.code)" />
                </div>
              </div>
              <p v-if="!equipmentConditionRefs.length" class="lands-muted">Показаны базовые состояния. После применения миграции изменения будут сохраняться в БД.</p>
            </div>
          </div>
        </template>
        <template v-else-if="landsRootTab === 'field-refs'">
          <p v-if="refsError" class="lands-error">{{ refsError }}</p>
          <div class="lands-tabs lands-tabs--sub">
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': fieldRefsTab === 'municipalities' }" @click="fieldRefsTab = 'municipalities'">
              Муниципальные образования
            </button>
          </div>
          <div class="lands-ref-block">
            <h2>Муниципальные образования</h2>
            <div class="lands-ref-add-row">
              <input v-model="newFieldMunicipalityName" class="lands-search" type="text" placeholder="Например: Новотроицкий сельсовет" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newFieldMunicipalityName.trim()" @click="addFieldMunicipalityReference">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in fieldMunicipalityRefs" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editFieldMunicipalityReference(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteFieldMunicipality(row.id)" />
                </div>
              </div>
              <p v-if="!fieldMunicipalityRefs.length" class="lands-muted">Пока нет муниципальных образований.</p>
            </div>
          </div>
        </template>
        <template v-else-if="landsRootTab === 'crop-rotation-refs'">
          <p v-if="refsError" class="lands-error">{{ refsError }}</p>
          <div class="lands-tabs lands-tabs--sub">
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': cropRotationRefsTab === 'types' }" @click="cropRotationRefsTab = 'types'">
              Типы севооборота
            </button>
          </div>
          <div class="lands-ref-block">
            <h2>Типы севооборота</h2>
            <div class="lands-ref-add-row">
              <input v-model="newCropRotationTypeName" class="lands-search" type="text" placeholder="Например: Полевой" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newCropRotationTypeName.trim()" @click="addCropRotationTypeRef">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in cropRotationTypeRefs" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editCropRotationTypeRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteCropRotationType(row.id)" />
                </div>
              </div>
              <p v-if="!cropRotationTypeRefs.length" class="lands-muted">Пока нет типов севооборота.</p>
            </div>
          </div>
        </template>
        <template v-else-if="landsRootTab === 'storage-refs'">
          <p v-if="refsError" class="lands-error">{{ refsError }}</p>
          <div class="lands-tabs lands-tabs--sub">
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': storageRefsTab === 'types' }" @click="storageRefsTab = 'types'">
              Типы мест хранения
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': storageRefsTab === 'statuses' }" @click="storageRefsTab = 'statuses'">
              Статусы мест хранения
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': storageRefsTab === 'fill-statuses' }" @click="storageRefsTab = 'fill-statuses'">
              Статус заполнения
            </button>
          </div>
          <div v-if="storageRefsTab === 'types'" class="lands-ref-block">
            <h2>Типы мест хранения</h2>
            <div class="lands-ref-add-row">
              <input v-model="newStorageLocationTypeName" class="lands-search" type="text" placeholder="Например: Элеватор" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newStorageLocationTypeName.trim()" @click="addStorageLocationTypeRef">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in storageLocationTypeRefs" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editStorageLocationTypeRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteStorageLocationType(row.id)" />
                </div>
              </div>
              <p v-if="!storageLocationTypeRefs.length" class="lands-muted">Пока нет типов мест хранения.</p>
            </div>
          </div>
          <div v-else-if="storageRefsTab === 'statuses'" class="lands-ref-block">
            <h2>Статусы мест хранения</h2>
            <p class="lands-muted lands-ref-hint">Статус с признаком «не используется» визуально выделяет неактивные места в реестре.</p>
            <div class="lands-ref-add-row lands-ref-add-row--wrap">
              <input v-model="newStorageLocationStatusName" class="lands-search" type="text" placeholder="Например: На ремонте" />
              <label class="lands-checkbox-inline">
                <input v-model="newStorageLocationStatusMarksInactive" type="checkbox" />
                <span>Не используется (неактивно)</span>
              </label>
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newStorageLocationStatusName.trim()" @click="addStorageLocationStatusRef">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in storageLocationStatusRefs" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}<template v-if="row.marks_inactive"> — не используется</template></span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editStorageLocationStatusRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteStorageLocationStatus(row.id)" />
                </div>
              </div>
              <p v-if="!storageLocationStatusRefs.length" class="lands-muted">Пока нет статусов мест хранения.</p>
            </div>
          </div>
          <div v-else class="lands-ref-block">
            <h2>Статус заполнения</h2>
            <p class="lands-muted lands-ref-hint">Используется для учёта партии зерна в месте хранения (пусто / наполняется / сформировано). Можно добавить свои варианты.</p>
            <div class="lands-ref-add-row">
              <input v-model="newStorageFillStatusName" class="lands-search" type="text" placeholder="Например: На отгрузке" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newStorageFillStatusName.trim()" @click="addStorageFillStatusRef">
                Добавить
              </button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in storageFillStatusRefs" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editStorageFillStatusRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteStorageFillStatus(row.id)" />
                </div>
              </div>
              <p v-if="!storageFillStatusRefs.length" class="lands-muted">Пока нет статусов заполнения.</p>
            </div>
          </div>
        </template>
        <template v-else>
          <p v-if="refsError" class="lands-error">{{ refsError }}</p>
          <div class="lands-tabs lands-tabs--sub">
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': rightsRefsTab === 'ownership-forms' }" @click="rightsRefsTab = 'ownership-forms'">
              Формы собственности
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': rightsRefsTab === 'right-types' }" @click="rightsRefsTab = 'right-types'">
              Виды прав
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': rightsRefsTab === 'document-types' }" @click="rightsRefsTab = 'document-types'">
              Типы подтверждающих документов
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': rightsRefsTab === 'holder-types' }" @click="rightsRefsTab = 'holder-types'">
              Виды правообладания
            </button>
            <button type="button" class="lands-tab-btn" :class="{ 'is-active': rightsRefsTab === 'holders' }" @click="rightsRefsTab = 'holders'">
              Правообладатели
            </button>
          </div>

          <div v-if="rightsRefsTab === 'ownership-forms'" class="lands-ref-block">
            <h2>Формы собственности</h2>
            <div class="lands-ref-add-row">
              <input v-model="newOwnershipFormName" class="lands-search" type="text" placeholder="Например: Частная собственность" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newOwnershipFormName.trim()" @click="addOwnershipForm">Добавить</button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in landRightOwnershipForms" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editOwnershipForm(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteOwnershipForm(row.id)" />
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="rightsRefsTab === 'right-types'" class="lands-ref-block">
            <h2>Виды прав</h2>
            <div class="lands-ref-add-row">
              <input v-model="newRightTypeName" class="lands-search" type="text" placeholder="Например: Аренда земельных участков" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newRightTypeName.trim()" @click="addRightTypeRef">Добавить</button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in landRightTypes" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editRightTypeRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteRightType(row.id)" />
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="rightsRefsTab === 'document-types'" class="lands-ref-block">
            <h2>Типы подтверждающих документов</h2>
            <div class="lands-ref-add-row">
              <input v-model="newRightDocumentTypeName" class="lands-search" type="text" placeholder="Например: Договор аренды" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newRightDocumentTypeName.trim()" @click="addRightDocumentTypeRef">Добавить</button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in landRightDocumentTypes" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editRightDocumentTypeRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteRightDocumentType(row.id)" />
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="rightsRefsTab === 'holder-types'" class="lands-ref-block">
            <h2>Виды правообладания</h2>
            <div class="lands-ref-add-row">
              <input v-model="newHolderTypeName" class="lands-search" type="text" placeholder="Например: Юридическое лицо" />
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newHolderTypeName.trim()" @click="addHolderTypeRef">Добавить</button>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in landRightHolderTypes" :key="row.id" class="lands-list-plain-item">
                <span>{{ row.name }}</span>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editHolderTypeRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteHolderType(row.id)" />
                </div>
              </div>
            </div>
          </div>

          <div v-else class="lands-ref-block">
            <h2>Правообладатели</h2>
            <div class="lands-form-grid lands-form-grid--mel">
              <label class="lands-field"><span>Наименование</span><input v-model="newHolderName" type="text" /></label>
              <label class="lands-field">
                <span>Вид правообладания</span>
                <select v-model="newHolderTypeId">
                  <option value="">—</option>
                  <option v-for="t in landRightHolderTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
                </select>
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field"><span>ИНН</span><input v-model="newHolderInn" type="text" /></label>
              <label class="lands-field"><span>КПП</span><input v-model="newHolderKpp" type="text" /></label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field"><span>ОГРН</span><input v-model="newHolderOgrn" type="text" /></label>
              <div class="lands-field lands-field--inline-end">
                <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="refsLoading || !newHolderName.trim()" @click="addRightHolderRef">
                  {{ editingHolderId ? 'Сохранить' : 'Добавить' }}
                </button>
              </div>
            </div>
            <div class="lands-list-plain">
              <div v-for="row in landRightHolders" :key="row.id" class="lands-list-plain-item lands-list-plain-item--stack">
                <div>
                  <strong>{{ row.name }}</strong>
                  <div class="lands-muted-line">
                    {{ landRightHolderTypeMap.get(row.holder_type_id || '') || '—' }} · ИНН: {{ row.inn || '—' }} · КПП: {{ row.kpp || '—' }} · ОГРН: {{ row.ogrn || '—' }}
                  </div>
                </div>
                <div class="lands-item-actions">
                  <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="editRightHolderRef(row)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" :disabled="refsLoading" @click="requestDeleteRightHolder(row.id)" />
                </div>
              </div>
            </div>
          </div>
        </template>
      </section>

      <section v-if="isDetailsMode" class="lands-card page-enter-item">
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
              <select v-if="landInlineEditOpen" v-model="form.landCategory" class="lands-passport-input">
                <option value="">—</option>
                <option v-for="category in landCategories" :key="category.id" :value="category.name">{{ category.name }}</option>
              </select>
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
              <select v-if="landInlineEditOpen" v-model="form.actualUseStatus" class="lands-passport-input">
                <option value="">—</option>
                <option v-for="option in actualUseOptions" :key="option.id" :value="option.name">{{ option.name }}</option>
              </select>
              <strong v-else>{{ selectedLand.actual_use_status || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>Регион</span>
              <input v-if="landInlineEditOpen" v-model.trim="form.region" class="lands-passport-input" type="text" />
              <strong v-else>{{ selectedLand.region || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>Адрес</span>
              <input v-if="landInlineEditOpen" v-model.trim="form.address" class="lands-passport-input" type="text" />
              <strong v-else>{{ selectedLand.address || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>Площадь, га</span>
              <input v-if="landInlineEditOpen" v-model.number="form.area" class="lands-passport-input" type="number" min="0" step="0.01" />
              <strong v-else>{{ Number(selectedLand.area || 0).toFixed(2) }}</strong>
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
              <select v-if="landInlineEditOpen" v-model="form.permittedUseDocs" class="lands-passport-input">
                <option value="">—</option>
                <option v-for="row in landRightTypes" :key="row.id" :value="row.name">{{ row.name }}</option>
              </select>
              <strong v-else>{{ selectedLand.permitted_use_docs || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>Кадастровый номер</span>
              <input v-if="landInlineEditOpen" v-model.trim="form.cadastralNumber" class="lands-passport-input" type="text" />
              <strong v-else>{{ selectedLand.cadastral_number || '—' }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>№ ПОЛЯ ЕФИС ЗСН</span>
              <strong>{{ landEfisNumberDisplay(selectedLand) }}</strong>
            </div>
            <div class="lands-overview-item">
              <span>Геолокация</span>
              <input v-if="landInlineEditOpen" v-model.trim="form.geolocation" class="lands-passport-input" type="text" />
              <strong v-else>{{ selectedLand.center_lat != null && selectedLand.center_lon != null ? `${selectedLand.center_lat}, ${selectedLand.center_lon}` : '—' }}</strong>
            </div>
          </div>
          <div class="lands-actions lands-actions--map">
            <button type="button" class="lands-btn" @click="showDetailsMap = !showDetailsMap">
              {{ showDetailsMap ? 'Скрыть карту' : 'Показать карту' }}
            </button>
          </div>
          <div v-if="showDetailsMap" class="lands-map-wrap">
            <div v-if="landInlineEditOpen" class="lands-map-head">
              <span class="lands-map-title">Редактирование геометрии участка</span>
              <div class="lands-map-switch" role="group" aria-label="Режим геометрии земли">
                <button type="button" class="lands-map-switch-btn" :class="{ 'lands-map-switch-btn--active': mapGeometryMode === 'point' }" @click="mapGeometryMode = 'point'">Точка</button>
                <button type="button" class="lands-map-switch-btn" :class="{ 'lands-map-switch-btn--active': mapGeometryMode === 'polygon' }" @click="mapGeometryMode = 'polygon'">Контур</button>
              </div>
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
              <button type="button" class="lands-mini-btn" :disabled="resolvingAddress" @click="detectAddressFromMap">
                {{ resolvingAddress ? 'Определяем адрес...' : 'Определить адрес по карте' }}
              </button>
              <span class="lands-muted">
                <template v-if="mapGeometryMode === 'polygon'">Можно менять контур — площадь и адрес обновятся автоматически.</template>
                <template v-else>Можно перемещать точку участка и подтягивать адрес по карте.</template>
              </span>
            </div>
          </div>
          <div v-if="landInlineEditOpen && (addressCandidatesLoading || addressCandidates.length)" class="lands-address-candidates lands-address-candidates--details">
            <span class="lands-address-candidates-label">Варианты адреса по геометрии</span>
            <select v-model="selectedAddressCandidate" class="lands-address-candidates-select" @change="onAddressCandidateChange">
              <option value="" disabled>Выберите вариант адреса</option>
              <option v-for="candidate in addressCandidates" :key="candidate" :value="candidate">
                {{ candidate }}
              </option>
            </select>
            <span v-if="addressCandidatesLoading" class="lands-muted">Подбираем варианты адреса...</span>
          </div>
        </template>

        <div class="lands-tabs">
          <button type="button" class="lands-tab-btn" :class="{ 'is-active': activeTab === 'info' }" @click="activeTab = 'info'">
            Сведения об участке
          </button>
          <button type="button" class="lands-tab-btn" :class="{ 'is-active': activeTab === 'fields' }" @click="activeTab = 'fields'">
            Поля
          </button>
          <button type="button" class="lands-tab-btn" :class="{ 'is-active': activeTab === 'rights' }" @click="activeTab = 'rights'">
            Права владения
          </button>
          <button type="button" class="lands-tab-btn" :class="{ 'is-active': activeTab === 'users' }" @click="activeTab = 'users'">
            Землепользователи
          </button>
          <button type="button" class="lands-tab-btn" :class="{ 'is-active': activeTab === 'crop-rotation' }" @click="activeTab = 'crop-rotation'">
            Севооборот
          </button>
          <button type="button" class="lands-tab-btn" :class="{ 'is-active': activeTab === 'real-estate' }" @click="activeTab = 'real-estate'">
            Объекты недвижимости
          </button>
        </div>

        <template v-if="selectedLand && activeTab === 'info'">
          <div class="lands-section-head">
            <h2>Сведения об участке</h2>
            <div class="task-export-btns">
              <button type="button" class="task-btn-export action_has has_saved" :disabled="!landInfoExportRows.length" title="Экспорт в PDF" @click="exportLandInfoToPdf">
                <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M12 18v-6" />
                  <path d="M9 15h6" />
                </svg>
                PDF
              </button>
              <button type="button" class="task-btn-export action_has has_saved" :disabled="!landInfoExportRows.length" title="Экспорт в Excel" @click="exportLandInfoToExcel">
                <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M8 13h2" />
                  <path d="M8 17h2" />
                  <path d="M14 13h2" />
                  <path d="M14 17h2" />
                </svg>
                Excel
              </button>
            </div>
          </div>
          <div v-if="!landInlineEditOpen" class="lands-overview-grid">
            <div class="lands-overview-item"><span>Общая площадь по документам, га</span><strong>{{ selectedLand.document_area_ha ?? '—' }}</strong></div>
            <div class="lands-overview-item"><span>Площадь земельного участка, га</span><strong>{{ Number(selectedLand.area || 0).toFixed(2) }}</strong></div>
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
              <input v-model.number="form.documentAreaHa" type="number" min="0" step="0.01" />
            </label>
            <label class="lands-field">
              <span>Площадь земельного участка, га</span>
              <input v-model.number="form.area" type="number" min="0" step="0.01" />
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
              <select v-model="form.isAgriLand">
                <option value="">—</option>
                  <option v-for="type in landTypes" :key="type.id" :value="type.id">{{ type.name }}</option>
              </select>
            </label>
            <label class="lands-field">
              <span>Площадь сельхозугодий, га</span>
              <input v-model.number="form.agriLandAreaHa" type="number" min="0" step="0.01" />
            </label>
          </div>
          <div v-if="landInlineEditOpen" class="lands-form-grid">
            <label class="lands-field">
              <span>Особо ценные продуктивные угодья</span>
              <div class="lands-yesno-toggle" role="group" aria-label="Особо ценные продуктивные угодья">
                <button type="button" class="lands-yesno-btn" :class="{ 'is-active': form.isValuableAgriLand === 'yes' }" @click="form.isValuableAgriLand = 'yes'">Да</button>
                <button type="button" class="lands-yesno-btn" :class="{ 'is-active': form.isValuableAgriLand === 'no' }" @click="form.isValuableAgriLand = 'no'">Нет</button>
              </div>
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
                <select v-model="form.actualUseStatus">
                  <option value="">—</option>
                  <option v-for="option in actualUseOptions" :key="option.id" :value="option.name">{{ option.name }}</option>
                </select>
            </label>
          </div>
          <div v-if="landInlineEditOpen" class="lands-form-grid">
            <label class="lands-field">
              <span>Фактически орошаемая площадь, га</span>
              <input v-model.number="form.irrigatedAreaHa" type="number" min="0" step="0.01" />
            </label>
            <label class="lands-field">
              <span>Фактически осушаемая площадь, га</span>
              <input v-model.number="form.drainedAreaHa" type="number" min="0" step="0.01" />
            </label>
          </div>
          <div v-if="landInlineEditOpen" class="lands-form-grid">
            <label class="lands-field">
              <span>Использование для племенного/селекции/семеноводства</span>
              <div class="lands-yesno-toggle" role="group" aria-label="Использование для племенного или селекции">
                <button type="button" class="lands-yesno-btn" :class="{ 'is-active': form.breedingUse === 'yes' }" @click="form.breedingUse = 'yes'">Да</button>
                <button type="button" class="lands-yesno-btn" :class="{ 'is-active': form.breedingUse === 'no' }" @click="form.breedingUse = 'no'">Нет</button>
              </div>
            </label>
            <label class="lands-field">
              <span>Иные сведения об использовании</span>
              <input v-model.trim="form.otherUseInfo" type="text" />
            </label>
          </div>
          <div v-if="landInlineEditOpen" class="lands-actions lands-actions--end">
            <button type="button" class="lands-btn lands-btn--save" :disabled="saving" @click="saveLand">
              Сохранить сведения
            </button>
            <button type="button" class="lands-btn lands-btn--danger" :disabled="saving" @click="requestDeleteCurrentLand">
              Удалить участок
            </button>
          </div>
        </template>

        <template v-else-if="selectedLand && activeTab === 'fields'">
          <div class="lands-section-head">
            <h2>Поля земли</h2>
            <div class="task-export-btns">
              <button type="button" class="task-btn-export action_has has_saved" :disabled="!landFieldsExportRows.length" title="Экспорт в PDF" @click="exportLandFieldsToPdf">
                <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M12 18v-6" />
                  <path d="M9 15h6" />
                </svg>
                PDF
              </button>
              <button type="button" class="task-btn-export action_has has_saved" :disabled="!landFieldsExportRows.length" title="Экспорт в Excel" @click="exportLandFieldsToExcel">
                <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M8 13h2" />
                  <path d="M8 17h2" />
                  <path d="M14 13h2" />
                  <path d="M14 17h2" />
                </svg>
                Excel
              </button>
            </div>
          </div>
          <div v-if="assignedFields.length" class="lands-table-wrap">
            <table class="lands-table lands-fields-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>№ ПОЛЯ ЕФИС ЗСН</th>
                  <th>Площадь, га</th>
                  <th>Культура</th>
                  <th>Тип земли</th>
                  <th>Муниципальное образование</th>
                  <th>Регион</th>
                  <th>Описание</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="field in assignedFields" :key="field.id" class="lands-list-row" @click="goToFieldDetails(field.id)">
                  <td>
                    <div class="lands-field-cell-title lands-list-title-main">Поле №{{ field.number }} {{ field.name }}</div>
                    <div class="lands-field-cell-subtitle">{{ field.cadastral_number ? `Кад. №: ${field.cadastral_number}` : 'Нет кад. номера' }}</div>
                  </td>
                  <td>{{ (field as any).efis_zsn_number || '—' }}</td>
                  <td>{{ Number(field.area || 0).toFixed(2) }}</td>
                  <td>
                    <span :class="fieldCropPillClass(field.crop_key)">
                      {{ fieldCropLabel(field.crop_key) }}
                    </span>
                  </td>
                  <td>{{ field.land_type || '—' }}</td>
                  <td>{{ field.municipality || '—' }}</td>
                  <td>{{ field.region || '—' }}</td>
                  <td class="lands-field-description">{{ field.location_description || '—' }}</td>
                  <td @click.stop>
                    <div class="lands-item-actions">
                      <button type="button" class="lands-action-btn" aria-label="Открыть поле" title="Открыть поле" @click="goToFieldDetails(field.id)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v7H3V3h7"/></svg>
                      </button>
                      <button v-if="landInlineEditOpen" type="button" class="lands-action-btn lands-action-btn--danger" aria-label="Отвязать поле" title="Отвязать поле" @click="unlinkField(field.id)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="lands-muted">К этой земле пока не привязаны поля.</p>
        </template>

        <template v-else-if="selectedLand && activeTab === 'rights'">
          <div class="lands-section-head">
            <h2>Права владения</h2>
            <div class="lands-section-actions">
              <div class="task-export-btns">
                <button type="button" class="task-btn-export action_has has_saved" :disabled="!landRightsExportRows.length" title="Экспорт в PDF" @click="exportLandRightsToPdf">
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M12 18v-6" />
                    <path d="M9 15h6" />
                  </svg>
                  PDF
                </button>
                <button type="button" class="task-btn-export action_has has_saved" :disabled="!landRightsExportRows.length" title="Экспорт в Excel" @click="exportLandRightsToExcel">
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M8 13h2" />
                    <path d="M8 17h2" />
                    <path d="M14 13h2" />
                    <path d="M14 17h2" />
                  </svg>
                  Excel
                </button>
              </div>
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" @click="openRightModal">
                Добавить
              </button>
            </div>
          </div>
          <div v-if="landRights.length" class="lands-list-plain">
            <div v-for="right in landRights" :key="right.id" class="lands-list-plain-item lands-list-plain-item--stack">
              <div class="lands-right-card-main">
                <div class="lands-right-metric-row">
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Наименование</span>
                    <span class="lands-right-metric-value lands-right-metric-value--nowrap">{{ right.holder_name || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">ИНН</span>
                    <span class="lands-right-metric-value">{{ right.holder_inn || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">КПП</span>
                    <span class="lands-right-metric-value">{{ right.holder_kpp || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">ОГРН</span>
                    <span class="lands-right-metric-value">{{ right.holder_ogrn || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Кадастровый номер</span>
                    <span class="lands-right-metric-value lands-right-metric-value--nowrap">{{ right.cadastral_number || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Форма собственности</span>
                    <span class="lands-right-metric-value lands-right-metric-value--nowrap">{{ right.ownership_form || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Вид права</span>
                    <span class="lands-right-metric-value lands-right-metric-value--nowrap">{{ right.right_type || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Начало</span>
                    <span class="lands-right-metric-value">{{ right.starts_at || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Окончание</span>
                    <span class="lands-right-metric-value">{{ right.ends_at || '—' }}</span>
                  </div>
                </div>
              </div>
              <div class="lands-item-actions">
                <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="openRightEditModal(right)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
                <UiDeleteButton size="sm" @click="removeLandRight(right.id)" />
              </div>
            </div>
          </div>
          <p v-else class="lands-muted">Права владения пока не заполнены.</p>
        </template>

        <template v-else-if="selectedLand && activeTab === 'users'">
          <h2>Землепользователи</h2>
          <div class="lands-actions lands-actions--crop">
            <button type="button" class="lands-btn lands-btn--save lands-btn--add" @click="openUserModal">
              Добавить
            </button>
          </div>
          <div v-if="landUsers.length" class="lands-list-plain">
            <div v-for="user in landUsers" :key="user.id" class="lands-list-plain-item lands-list-plain-item--stack">
              <div class="lands-right-card-main">
                <div class="lands-right-metric-row">
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Наименование</span>
                    <span class="lands-right-metric-value">{{ user.holder_name || user.organization_name || user.person_name || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">ИНН</span>
                    <span class="lands-right-metric-value">{{ user.holder_inn || user.inn || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">КПП</span>
                    <span class="lands-right-metric-value">{{ user.holder_kpp || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">ОГРН</span>
                    <span class="lands-right-metric-value">{{ user.holder_ogrn || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Вид права</span>
                    <span class="lands-right-metric-value">{{ user.right_type || user.basis || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Тип документа</span>
                    <span class="lands-right-metric-value">{{ user.document_type || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Начало</span>
                    <span class="lands-right-metric-value">{{ user.starts_at || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Окончание</span>
                    <span class="lands-right-metric-value">{{ user.ends_at || '—' }}</span>
                  </div>
                  <div class="lands-right-metric">
                    <span class="lands-right-metric-label">Площадь использования, га</span>
                    <span class="lands-right-metric-value">{{ formatRotationMetric(user.usage_area_ha) }}</span>
                  </div>
                </div>
              </div>
              <div class="lands-item-actions">
                <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="openUserEditModal(user)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
                <UiDeleteButton size="sm" @click="removeLandUser(user.id)" />
              </div>
            </div>
          </div>
          <p v-else class="lands-muted">Землепользователи пока не заполнены.</p>
        </template>

        <template v-else-if="selectedLand && activeTab === 'crop-rotation'">
          <div class="lands-section-head">
            <h2>Севооборот</h2>
            <div class="lands-section-actions">
              <div class="task-export-btns">
                <button type="button" class="task-btn-export action_has has_saved" :disabled="!landCropRotationExportRows.length" title="Экспорт в PDF" @click="exportLandCropRotationToPdf">
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M12 18v-6" />
                    <path d="M9 15h6" />
                  </svg>
                  PDF
                </button>
                <button type="button" class="task-btn-export action_has has_saved" :disabled="!landCropRotationExportRows.length" title="Экспорт в Excel" @click="exportLandCropRotationToExcel">
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M8 13h2" />
                    <path d="M8 17h2" />
                    <path d="M14 13h2" />
                    <path d="M14 17h2" />
                  </svg>
                  Excel
                </button>
              </div>
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" @click="openCropRotationModal">
                Добавить
              </button>
            </div>
          </div>
          <div v-if="landCropRotations.length" class="lands-list-plain">
            <div v-for="rotation in landCropRotations" :key="rotation.id" class="lands-list-plain-item lands-list-plain-item--stack">
              <div class="lands-crop-rotation-card-main">
                <div class="lands-crop-rotation-metric-row">
                  <div class="lands-crop-rotation-metric">
                    <span class="lands-crop-rotation-metric-label">№ ПОЛЯ ЕФИС ЗСН</span>
                    <span class="lands-crop-rotation-metric-value lands-crop-rotation-metric-value--nowrap">{{ realEstateFieldLabel(rotation.field_id) }}</span>
                  </div>
                  <div class="lands-crop-rotation-metric">
                    <span class="lands-crop-rotation-metric-label">Сезон</span>
                    <span class="lands-crop-rotation-metric-value">{{ rotation.season || '—' }}</span>
                  </div>
                  <div class="lands-crop-rotation-metric">
                    <span class="lands-crop-rotation-metric-label">Тип</span>
                    <span class="lands-crop-rotation-metric-value">{{ rotation.rotation_type || '—' }}</span>
                  </div>
                  <div class="lands-crop-rotation-metric">
                    <span class="lands-crop-rotation-metric-label">Культура</span>
                    <span class="lands-crop-rotation-metric-value">{{ cropLabelMap.get(rotation.crop_key || '') || '—' }}</span>
                  </div>
                  <div class="lands-crop-rotation-metric">
                    <span class="lands-crop-rotation-metric-label">Площадь, га</span>
                    <span class="lands-crop-rotation-metric-value">{{ formatRotationMetric(cropRotationFieldMap.get(rotation.field_id)?.area) }}</span>
                  </div>
                  <div class="lands-crop-rotation-metric">
                    <span class="lands-crop-rotation-metric-label">Площадь для выращивания сельхозкультур, га *</span>
                    <span class="lands-crop-rotation-metric-value">{{ formatRotationMetric(rotation.area_for_crops_ha) }}</span>
                  </div>
                  <div class="lands-crop-rotation-metric">
                    <span class="lands-crop-rotation-metric-label">Масса произведенной сельхозкультуры, т</span>
                    <span class="lands-crop-rotation-metric-value">{{ formatRotationMetric(rotation.produced_crop_mass_tons) }}</span>
                  </div>
                </div>
              </div>
              <div class="lands-item-actions">
                <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="openCropRotationEditModal(rotation)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
                <UiDeleteButton size="sm" @click="requestDeleteCropRotation(rotation.id)" />
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="selectedLand && activeTab === 'real-estate'">
          <div class="lands-section-head">
            <h2>Объекты недвижимости</h2>
            <div class="lands-section-actions">
              <div class="task-export-btns">
                <button type="button" class="task-btn-export action_has has_saved" :disabled="!landRealEstateExportRows.length" title="Экспорт в PDF" @click="exportLandRealEstateToPdf">
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M12 18v-6" />
                    <path d="M9 15h6" />
                  </svg>
                  PDF
                </button>
                <button type="button" class="task-btn-export action_has has_saved" :disabled="!landRealEstateExportRows.length" title="Экспорт в Excel" @click="exportLandRealEstateToExcel">
                  <svg class="task-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M8 13h2" />
                    <path d="M8 17h2" />
                    <path d="M14 13h2" />
                    <path d="M14 17h2" />
                  </svg>
                  Excel
                </button>
              </div>
              <button type="button" class="lands-btn lands-btn--save lands-btn--add" @click="openRealEstateModal">
                Добавить
              </button>
            </div>
          </div>
          <div v-if="landRealEstateObjects.length" class="lands-list-plain">
            <div v-for="obj in landRealEstateObjects" :key="obj.id" class="lands-list-plain-item lands-list-plain-item--stack">
              <div class="lands-re-card-main">
                <div class="lands-re-metric-row">
                  <div class="lands-re-metric">
                    <span class="lands-re-metric-label">№ ПОЛЯ ЕФИС ЗСН</span>
                    <span class="lands-re-metric-value lands-re-metric-value--nowrap">{{ realEstateFieldLabel(obj.field_id) }}</span>
                  </div>
                  <div class="lands-re-metric">
                    <span class="lands-re-metric-label">Кадастровый номер *</span>
                    <span class="lands-re-metric-value lands-re-metric-value--nowrap">{{ obj.cadastral_number || '—' }}</span>
                  </div>
                  <div class="lands-re-metric">
                    <span class="lands-re-metric-label">Наименование</span>
                    <span class="lands-re-metric-value lands-re-metric-value--nowrap">{{ obj.name?.trim() || '—' }}</span>
                  </div>
                  <div class="lands-re-metric">
                    <span class="lands-re-metric-label">Адрес</span>
                    <span class="lands-re-metric-value lands-re-metric-value--nowrap">{{ obj.address?.trim() || '—' }}</span>
                  </div>
                  <div class="lands-re-metric">
                    <span class="lands-re-metric-label">Площадь, кв.м.</span>
                    <span class="lands-re-metric-value">{{ formatRotationMetric(obj.area_sqm) }}</span>
                  </div>
                </div>
              </div>
              <div class="lands-item-actions">
                <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Редактировать" title="Редактировать" @click="openRealEstateEditModal(obj)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
                <UiDeleteButton size="sm" @click="requestDeleteRealEstate(obj.id)" />
              </div>
            </div>
          </div>
          <p v-else class="lands-muted">Объекты недвижимости пока не добавлены.</p>
        </template>
        <p v-else class="lands-muted">Участок не найден или не выбран.</p>
      </section>
    </div>

    <teleport to="body">
      <div v-if="landEditorOpen" class="lands-modal-backdrop" role="dialog" aria-modal="true" aria-label="Редактор земли" @click.self="closeLandEditor">
        <div class="lands-modal">
          <div class="lands-modal-head">
            <h2>{{ landEditorMode === 'create' ? 'Новая земля' : 'Редактирование земли' }}</h2>
            <ModalCloseButton @click="closeLandEditor" />
          </div>
          <div class="lands-modal-body">
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Номер</span>
                <input v-model.number="form.number" type="number" min="1" />
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
                <select v-model="form.landCategory">
                  <option value="">—</option>
                  <option v-for="category in landCategories" :key="category.id" :value="category.name">{{ category.name }}</option>
                </select>
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
                <select v-model="form.landTypeId">
                  <option value="">— Не указан —</option>
                  <option v-for="type in landTypes" :key="type.id" :value="type.id">{{ type.name }}</option>
                </select>
              </label>
              <label class="lands-field">
                <span>Регион</span>
                <input v-model.trim="form.region" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Площадь, га</span>
                <input v-model.number="form.area" type="number" min="0" step="0.01" />
              </label>
              <label class="lands-field">
                <span>Кадастровый номер</span>
                <input v-model.trim="form.cadastralNumber" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Вид разрешенного использования (документы)</span>
                <select v-model="form.permittedUseDocs">
                  <option value="">—</option>
                  <option v-for="row in landRightTypes" :key="row.id" :value="row.name">{{ row.name }}</option>
                </select>
              </label>
              <label class="lands-field">
                <span>№ ПОЛЯ ЕФИС ЗСН</span>
                <span class="lands-muted-line">Заполняется автоматически из привязанных полей (раздел «Поля»).</span>
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Геолокация (широта, долгота)</span>
                <input v-model.trim="form.geolocation" type="text" placeholder="53.195878, 45.018316" />
              </label>
              <label class="lands-field">
                <span>Площадь по документам, га (ручной ввод)</span>
                <input v-model.number="form.documentAreaHa" type="number" min="0" step="0.01" />
              </label>
            </div>
            <label class="lands-field">
              <span>Адрес</span>
              <input v-model.trim="form.address" type="text" placeholder="Адрес или ориентир" />
            </label>
            <div v-if="addressCandidatesLoading || addressCandidates.length" class="lands-address-candidates">
              <span class="lands-address-candidates-label">Варианты адреса по геометрии</span>
              <select v-model="selectedAddressCandidate" class="lands-address-candidates-select" @change="onAddressCandidateChange">
                <option value="" disabled>Выберите вариант адреса</option>
                <option v-for="candidate in addressCandidates" :key="candidate" :value="candidate">
                  {{ candidate }}
                </option>
              </select>
              <span v-if="addressCandidatesLoading" class="lands-muted">Подбираем варианты адреса...</span>
            </div>
            <div class="lands-map-wrap">
              <div class="lands-map-head">
                <span class="lands-map-title">Геометрия земельного участка</span>
                <div class="lands-map-switch" role="group" aria-label="Режим геометрии земли">
                  <button type="button" class="lands-map-switch-btn" :class="{ 'lands-map-switch-btn--active': mapGeometryMode === 'point' }" @click="mapGeometryMode = 'point'">Точка</button>
                  <button type="button" class="lands-map-switch-btn" :class="{ 'lands-map-switch-btn--active': mapGeometryMode === 'polygon' }" @click="mapGeometryMode = 'polygon'">Контур</button>
                </div>
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
                <button type="button" class="lands-mini-btn" :disabled="resolvingAddress" @click="detectAddressFromMap">
                  {{ resolvingAddress ? 'Определяем адрес...' : 'Определить адрес по карте' }}
                </button>
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
          <div class="lands-modal-actions">
            <button type="button" class="lands-btn" :disabled="saving" @click="closeLandEditor">Отмена</button>
            <button type="button" class="lands-btn lands-btn--save" :disabled="saving" @click="saveLand">
              {{ saving ? 'Сохранение...' : landEditorMode === 'create' ? 'Создать землю' : 'Сохранить изменения' }}
            </button>
            <UiDeleteButton
              v-if="landEditorMode === 'edit' && selectedLand"
              size="md"
              :disabled="saving"
              @click="() => removeLand()"
            />
          </div>
        </div>
      </div>

      <div v-if="cropRotationModalOpen" class="lands-modal-backdrop" role="dialog" aria-modal="true" aria-label="Добавление записи севооборота" @click.self="closeCropRotationModal">
        <div class="lands-modal lands-modal--compact lands-modal--success">
          <div class="lands-modal-head">
            <h2>Добавить запись севооборота</h2>
            <ModalCloseButton @click="closeCropRotationModal" />
          </div>
          <div class="lands-modal-body">
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>№ ПОЛЯ ЕФИС ЗСН</span>
                <select v-model="cropRotationForm.fieldId">
                  <option value="">— Выберите поле —</option>
                  <option v-for="field in assignedFields" :key="field.id" :value="field.id">
                    №{{ field.number }} — {{ field.name }}
                  </option>
                </select>
              </label>
              <label class="lands-field">
                <span>Площадь, га</span>
                <input :value="cropRotationForm.areaForCropsHa ?? ''" type="number" disabled />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Сезон *</span>
                <input v-model.trim="cropRotationForm.season" type="text" placeholder="Например: 2026" />
              </label>
              <label class="lands-field">
                <span class="lands-label-with-help">
                  Тип севооборота *
                  <RefFieldHelp
                    text="Нет нужного типа севооборота? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'crop-rotation-refs' } }"
                    link-label="Справочники севооборота"
                  />
                </span>
                <select v-model="cropRotationForm.rotationType">
                  <option value="">— Выберите тип —</option>
                  <option v-for="type in cropRotationTypeOptions" :key="type" :value="type">{{ type }}</option>
                </select>
              </label>
            </div>
            <label class="lands-field">
              <span class="lands-label-with-help">
                Сельскохозяйственная культура *
                <RefFieldHelp
                  text="Нет нужной культуры? Добавьте ее в"
                  :to="{ path: '/lands', query: { tab: 'crops-refs' } }"
                  link-label="Справочники СХ культур"
                />
              </span>
              <select v-model="cropRotationForm.cropKey">
                <option value="">— Выберите культуру —</option>
                <option v-for="crop in crops" :key="crop.id" :value="crop.key">{{ crop.label }}</option>
              </select>
            </label>
            <label class="lands-field">
              <span>Наименование семян (посадочный материал)</span>
              <textarea v-model.trim="cropRotationForm.seedMaterialName" rows="2" />
            </label>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Площадь для выращивания сельхозкультур, га *</span>
                <input v-model.number="cropRotationForm.areaForCropsHa" type="number" min="0" step="0.01" />
              </label>
              <label class="lands-field">
                <span>Площадь с улучшенными характеристиками, га</span>
                <input v-model.number="cropRotationForm.areaWithImprovedProductsHa" type="number" min="0" step="0.01" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Площадь для органической продукции, га</span>
                <input v-model.number="cropRotationForm.areaForOrganicHa" type="number" min="0" step="0.01" />
              </label>
              <label class="lands-field">
                <span>Площадь для селекции и семеноводства, га</span>
                <input v-model.number="cropRotationForm.areaForSelectionSeedHa" type="number" min="0" step="0.01" />
              </label>
            </div>
            <label class="lands-field">
              <span>Сведения о производимой продукции</span>
              <textarea v-model.trim="cropRotationForm.producedProductsInfo" rows="3" />
            </label>
            <label class="lands-field">
              <span>Масса произведенной сельхозкультуры, т</span>
              <input v-model.number="cropRotationForm.producedCropMassTons" type="number" min="0" step="0.01" />
            </label>
          </div>
          <div class="lands-modal-actions">
            <button type="button" class="lands-btn" @click="closeCropRotationModal">Отмена</button>
            <button type="button" class="lands-btn lands-btn--save" :disabled="!cropRotationForm.fieldId || !cropRotationForm.season || !cropRotationForm.rotationType || !cropRotationForm.cropKey || saving" @click="saveCropRotation">
              {{ editingCropRotationId ? 'Сохранить' : 'Добавить' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="rightModalOpen" class="lands-modal-backdrop" role="dialog" aria-modal="true" aria-label="Право владения" @click.self="closeRightModal">
        <div class="lands-modal">
          <div class="lands-modal-head">
            <h2>{{ editingRightId ? 'Редактировать право владения' : 'Добавить право владения' }}</h2>
            <ModalCloseButton :disabled="saving || rightFileUploading" @click="closeRightModal" />
          </div>
          <div class="lands-modal-body">
            <div class="lands-owner-mode-section">
              <div class="lands-owner-mode-label">Правообладатель</div>
              <div class="lands-owner-mode-toggle" role="group" aria-label="Режим ввода правообладателя">
                <button type="button" class="lands-owner-mode-btn" :class="{ 'is-active': rightForm.holderMode === 'reference' }" @click="rightForm.holderMode = 'reference'">
                  Выбрать из справочника
                </button>
                <button type="button" class="lands-owner-mode-btn" :class="{ 'is-active': rightForm.holderMode === 'manual' }" @click="rightForm.holderMode = 'manual'">
                  Ввести вручную
                </button>
              </div>
            </div>
            <div v-if="rightForm.holderMode === 'reference'" class="lands-form-grid">
              <label class="lands-field">
                <span>Правообладатель из справочника</span>
                <select v-model="rightForm.holderRefId">
                  <option value="">— Выберите правообладателя —</option>
                  <option v-for="holder in landRightHolders" :key="holder.id" :value="holder.id">
                    {{ holder.name }} · ИНН: {{ holder.inn || '—' }}
                  </option>
                </select>
              </label>
              <div />
            </div>

            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Наименование *</span>
                <input v-model.trim="rightForm.holderName" type="text" placeholder="СПК «Урожайный»" />
              </label>
              <label class="lands-field">
                <span>Вид правообладания</span>
                <select v-model="rightForm.holderTypeId" :disabled="rightForm.holderMode === 'reference'">
                  <option value="">—</option>
                  <option v-for="row in landRightHolderTypes" :key="row.id" :value="row.id">{{ row.name }}</option>
                </select>
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>ИНН *</span>
                <input v-model.trim="rightForm.holderInn" type="text" />
              </label>
              <label class="lands-field">
                <span>КПП</span>
                <input v-model.trim="rightForm.holderKpp" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>ОГРН *</span>
                <input v-model.trim="rightForm.holderOgrn" type="text" />
              </label>
              <div />
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Кадастровый номер *</span>
                <input v-model.trim="rightForm.cadastralNumber" type="text" />
              </label>
              <label class="lands-field">
                <span class="lands-label-with-help">
                  Форма собственности *
                  <RefFieldHelp
                    text="Нет нужной формы собственности? Добавьте ее в"
                    :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
                    link-label="Справочники прав"
                  />
                </span>
                <select v-model="rightForm.ownershipForm">
                  <option value="">— Выберите форму собственности —</option>
                  <option v-for="row in landRightOwnershipForms" :key="row.id" :value="row.name">{{ row.name }}</option>
                </select>
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span class="lands-label-with-help">
                  Вид права *
                  <RefFieldHelp
                    text="Нет нужного вида права? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
                    link-label="Справочники прав"
                  />
                </span>
                <select v-model="rightForm.rightType">
                  <option value="">— Выберите вид права —</option>
                  <option v-for="row in landRightTypes" :key="row.id" :value="row.name">{{ row.name }}</option>
                </select>
              </label>
              <label class="lands-field">
                <span class="lands-label-with-help">
                  Тип подтверждающего документа *
                  <RefFieldHelp
                    text="Нет нужного типа документа? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
                    link-label="Справочники прав"
                  />
                </span>
                <select v-model="rightForm.documentType">
                  <option value="">— Выберите тип документа —</option>
                  <option v-for="row in landRightDocumentTypes" :key="row.id" :value="row.name">{{ row.name }}</option>
                </select>
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Подтверждающие документы *</span>
                <div class="lands-docs-compact-box">
                  <div class="lands-docs-compact-head">
                    <span class="lands-docs-compact-state" :class="{ 'is-filled': rightSupportingLinks.length > 0 }">
                      {{ rightSupportingLinks.length ? `Приложено файлов: ${rightSupportingLinks.length}` : 'Файлы не приложены' }}
                    </span>
                  </div>
                  <div v-if="rightSupportingLinks.length" class="lands-docs-preview-grid lands-docs-preview-grid--compact">
                    <div v-for="link in rightSupportingLinks" :key="link" class="lands-docs-preview-card-wrap">
                      <a
                        :href="link"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="lands-docs-preview-card"
                      >
                        <div class="lands-docs-preview-thumb-wrap">
                          <img v-if="isImageUrl(link)" class="lands-docs-preview-thumb" :src="link" :alt="fileLabelFromUrl(link)" loading="lazy" />
                          <svg v-else class="lands-docs-preview-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
                          </svg>
                        </div>
                        <span class="lands-docs-preview-name">{{ fileLabelFromUrl(link) }}</span>
                      </a>
                      <button type="button" class="lands-docs-remove-btn" title="Удалить файл" aria-label="Удалить файл" :disabled="rightFileUploading || saving" @click="requestRemoveRightSupportingFile(link)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </label>
              <label class="lands-field">
                <span>Загрузить документ/фото</span>
                <label class="lands-file-upload">
                  <span class="lands-file-upload-btn">{{ rightFileUploading ? 'Загрузка...' : 'Выбрать файл' }}</span>
                  <span class="lands-file-upload-hint">PDF, JPG, PNG, DOC, DOCX, ZIP</span>
                  <input class="lands-file-upload-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.zip" :disabled="rightFileUploading || saving" @change="uploadRightSupportingFile" />
                </label>
                <span class="lands-muted">{{ rightFileUploading ? 'Файл загружается...' : 'После загрузки появится мини-превью.' }}</span>
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Документ (наименование)</span>
                <input v-model.trim="rightForm.documentName" type="text" />
              </label>
              <label class="lands-field">
                <span>Номер документа</span>
                <input v-model.trim="rightForm.documentNumber" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Дата документа</span>
                <input v-model="rightForm.documentDate" type="date" />
              </label>
              <label class="lands-field">
                <span>Примечание</span>
                <input v-model.trim="rightForm.notes" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Начало владения *</span>
                <input v-model="rightForm.startsAt" type="date" />
              </label>
              <label class="lands-field">
                <span>Окончание *</span>
                <input v-model="rightForm.endsAt" type="date" />
              </label>
            </div>
          </div>
          <div class="lands-modal-actions">
            <button type="button" class="lands-btn" :disabled="saving || rightFileUploading" @click="closeRightModal">Отмена</button>
            <button type="button" class="lands-btn lands-btn--save" :disabled="saving || rightFileUploading" @click="saveLandRight">
              {{ saving ? 'Сохранение...' : editingRightId ? 'Сохранить' : 'Добавить' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="realEstateModalOpen" class="lands-modal-backdrop" role="dialog" aria-modal="true" aria-label="Объект недвижимости" @click.self="closeRealEstateModal">
        <div class="lands-modal">
          <div class="lands-modal-head">
            <h2>{{ editingRealEstateId ? 'Редактировать объект недвижимости' : 'Добавить объект недвижимости' }}</h2>
            <ModalCloseButton @click="closeRealEstateModal" />
          </div>
          <div class="lands-modal-body">
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>№ ПОЛЯ ЕФИС ЗСН</span>
                <select v-model="realEstateForm.fieldId">
                  <option value="">—</option>
                  <option v-for="field in assignedFields" :key="field.id" :value="field.id">
                    №{{ field.number }} — {{ field.name }}
                  </option>
                </select>
              </label>
              <label class="lands-field">
                <span>Кадастровый номер *</span>
                <input v-model.trim="realEstateForm.cadastralNumber" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Наименование</span>
                <input v-model.trim="realEstateForm.name" type="text" />
              </label>
              <label class="lands-field">
                <span>Описание местоположения</span>
                <input v-model.trim="realEstateForm.locationDescription" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Площадь, кв.м.</span>
                <input v-model.number="realEstateForm.areaSqm" type="number" min="0" step="0.01" />
              </label>
              <label class="lands-field">
                <span>Вид разрешенного использования</span>
                <input v-model.trim="realEstateForm.permittedUse" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Назначение</span>
                <input v-model.trim="realEstateForm.purpose" type="text" />
              </label>
              <label class="lands-field">
                <span>Адрес</span>
                <input v-model.trim="realEstateForm.address" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Глубина, м</span>
                <input v-model.number="realEstateForm.depthM" type="number" min="0" step="0.01" />
              </label>
              <label class="lands-field">
                <span>Высота, м</span>
                <input v-model.number="realEstateForm.heightM" type="number" min="0" step="0.01" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Протяженность, м</span>
                <input v-model.number="realEstateForm.lengthM" type="number" min="0" step="0.01" />
              </label>
              <label class="lands-field">
                <span>Объем, м³</span>
                <input v-model.number="realEstateForm.volumeM3" type="number" min="0" step="0.01" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Глубина залегания, м</span>
                <input v-model.number="realEstateForm.burialDepthM" type="number" min="0" step="0.01" />
              </label>
              <label class="lands-field">
                <span>План застройки</span>
                <input v-model.trim="realEstateForm.developmentPlan" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Этажность</span>
                <input v-model.trim="realEstateForm.floors" type="text" />
              </label>
              <label class="lands-field">
                <span>Подземная этажность</span>
                <input v-model.trim="realEstateForm.undergroundFloors" type="text" />
              </label>
            </div>
          </div>
          <div class="lands-modal-actions">
            <button type="button" class="lands-btn" @click="closeRealEstateModal">Отмена</button>
            <button type="button" class="lands-btn lands-btn--save" :disabled="!realEstateForm.cadastralNumber.trim() || saving" @click="saveRealEstate">
              {{ editingRealEstateId ? 'Сохранить' : 'Добавить' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="userModalOpen" class="lands-modal-backdrop" role="dialog" aria-modal="true" aria-label="Землепользователь" @click.self="closeUserModal">
        <div class="lands-modal">
          <div class="lands-modal-head">
            <h2>{{ editingUserId ? 'Редактировать землепользователя' : 'Добавить землепользователя' }}</h2>
            <ModalCloseButton :disabled="saving || userFileUploading" @click="closeUserModal" />
          </div>
          <div class="lands-modal-body">
            <label class="lands-field">
              <span class="lands-label-with-help">
                Правообладатель *
                <RefFieldHelp
                  text="Нет нужного правообладателя? Добавьте его в"
                  :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
                  link-label="Справочники прав"
                />
              </span>
              <div class="lands-owner-mode">
                <button type="button" class="lands-owner-mode-btn" :class="{ 'is-active': userForm.holderMode === 'reference' }" @click="userForm.holderMode = 'reference'">
                  Выбрать из справочника
                </button>
                <button type="button" class="lands-owner-mode-btn" :class="{ 'is-active': userForm.holderMode === 'manual' }" @click="userForm.holderMode = 'manual'">
                  Ввести вручную
                </button>
              </div>
            </label>
            <div v-if="userForm.holderMode === 'reference'" class="lands-form-grid">
              <label class="lands-field">
                <span>Справочник правообладателей</span>
                <select v-model="userForm.holderRefId">
                  <option value="">—</option>
                  <option v-for="holder in landRightHolders" :key="holder.id" :value="holder.id">
                    {{ holder.name }}
                  </option>
                </select>
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Наименование *</span>
                <input v-model.trim="userForm.holderName" type="text" placeholder="СПК «Урожайный»" />
              </label>
              <label class="lands-field">
                <span>ИНН *</span>
                <input v-model.trim="userForm.holderInn" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>КПП</span>
                <input v-model.trim="userForm.holderKpp" type="text" />
              </label>
              <label class="lands-field">
                <span>ОГРН *</span>
                <input v-model.trim="userForm.holderOgrn" type="text" />
              </label>
            </div>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span class="lands-label-with-help">
                  Вид права *
                  <RefFieldHelp
                    text="Нет нужного вида права? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
                    link-label="Справочники прав"
                  />
                </span>
                <select v-model="userForm.rightType">
                  <option value="">—</option>
                  <option v-for="row in landRightTypes" :key="row.id" :value="row.name">{{ row.name }}</option>
                </select>
              </label>
              <label class="lands-field">
                <span class="lands-label-with-help">
                  Тип подтверждающего документа *
                  <RefFieldHelp
                    text="Нет нужного типа документа? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
                    link-label="Справочники прав"
                  />
                </span>
                <select v-model="userForm.documentType">
                  <option value="">—</option>
                  <option v-for="row in landRightDocumentTypes" :key="row.id" :value="row.name">{{ row.name }}</option>
                </select>
              </label>
            </div>
            <label class="lands-field">
              <span>Подтверждающие документы *</span>
              <div class="lands-docs-compact-box">
                <div class="lands-docs-compact-head">
                  <span class="lands-docs-compact-state" :class="{ 'is-filled': userSupportingLinks.length > 0 }">
                    {{ userSupportingLinks.length ? `Приложено файлов: ${userSupportingLinks.length}` : 'Файлы не приложены' }}
                  </span>
                </div>
                <div v-if="userSupportingLinks.length" class="lands-docs-preview-grid lands-docs-preview-grid--compact">
                  <div v-for="link in userSupportingLinks" :key="link" class="lands-docs-preview-card-wrap">
                    <a
                      :href="link"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="lands-docs-preview-card"
                    >
                      <div class="lands-docs-preview-thumb-wrap">
                        <img v-if="isImageUrl(link)" class="lands-docs-preview-thumb" :src="link" :alt="fileLabelFromUrl(link)" loading="lazy" />
                        <svg v-else class="lands-docs-preview-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
                        </svg>
                      </div>
                      <span class="lands-docs-preview-name">{{ fileLabelFromUrl(link) }}</span>
                    </a>
                    <button type="button" class="lands-docs-remove-btn" title="Удалить файл" aria-label="Удалить файл" :disabled="userFileUploading || saving" @click="requestRemoveUserSupportingFile(link)">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </label>
            <label class="lands-field">
              <span>Загрузить документ/фото</span>
              <label class="lands-file-upload">
                <span class="lands-file-upload-btn">{{ userFileUploading ? 'Загрузка...' : 'Выбрать файл' }}</span>
                <span class="lands-file-upload-hint">PDF, JPG, PNG, DOC, DOCX, ZIP</span>
                <input class="lands-file-upload-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.zip" :disabled="userFileUploading || saving" @change="uploadUserSupportingFile" />
              </label>
              <span class="lands-muted">{{ userFileUploading ? 'Файл загружается...' : 'После загрузки появится мини-превью.' }}</span>
            </label>
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>Начало *</span>
                <input v-model="userForm.startsAt" type="date" />
              </label>
              <label class="lands-field">
                <span>Окончание *</span>
                <input v-model="userForm.endsAt" type="date" />
              </label>
            </div>
            <label class="lands-field">
              <span>Площадь использования поля, га *</span>
              <input v-model.number="userForm.usageAreaHa" type="number" min="0" step="0.01" placeholder="7.49" />
            </label>
          </div>
          <div class="lands-modal-actions">
            <button type="button" class="lands-btn" :disabled="saving || userFileUploading" @click="closeUserModal">Отмена</button>
            <button type="button" class="lands-btn lands-btn--save" :disabled="saving || userFileUploading" @click="saveLandUser">
              {{ saving ? 'Сохранение...' : editingUserId ? 'Сохранить' : 'Добавить' }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="userFileDeleteConfirmOpen"
        class="lands-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Удаление файла"
        @click.self="closeUserFileDeleteConfirm"
      >
        <div class="lands-modal lands-modal--compact">
          <div class="lands-modal-head">
            <h2>Удалить файл?</h2>
            <ModalCloseButton :disabled="saving || userFileUploading" @click="closeUserFileDeleteConfirm" />
          </div>
          <div class="lands-modal-body">
            <p class="lands-confirm-text">Ссылка на файл будет удалена из формы землепользователя.</p>
          </div>
          <div class="lands-modal-actions">
            <button type="button" class="lands-btn" :disabled="saving || userFileUploading" @click="closeUserFileDeleteConfirm">Отмена</button>
            <button type="button" class="lands-btn lands-btn--danger" :disabled="saving || userFileUploading" @click="confirmRemoveUserSupportingFile">
              Удалить
            </button>
          </div>
        </div>
      </div>

      <div v-if="meliorationModalOpen" class="lands-modal-backdrop" role="dialog" aria-modal="true" aria-label="Мелиорация" @click.self="closeMeliorationModal">
        <div class="lands-modal lands-modal--compact">
          <div class="lands-modal-head">
            <h2>Добавить запись мелиорации</h2>
            <ModalCloseButton :disabled="saving" @click="closeMeliorationModal" />
          </div>
          <div class="lands-modal-body">
            <div class="lands-form-grid">
              <label class="lands-field">
                <span>№ ПОЛЯ ЕФИС ЗСН</span>
                <select v-model="meliorationForm.fieldId">
                  <option value="">—</option>
                  <option v-for="field in meliorationFieldOptions" :key="field.id" :value="field.id">
                    {{ meliorationFieldLabel(field.id) }}
                  </option>
                </select>
              </label>
              <label v-if="meliorationTab === 'systems'" class="lands-field">
                <span class="lands-label-with-help">
                  Тип мелиорации
                  <RefFieldHelp
                    text="Нет нужного типа мелиорации? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'melioration-refs' } }"
                    link-label="Справочники мелиорации"
                  />
                </span>
                <select v-model="meliorationForm.meliorationType">
                  <option value="">—</option>
                  <option v-for="row in landMeliorationTypes" :key="row.id" :value="row.name">
                    {{ row.name }}
                  </option>
                </select>
              </label>
              <label v-else-if="meliorationTab === 'forest'" class="lands-field">
                <span>Год создания</span>
                <input v-model.number="meliorationForm.forestYearCreated" type="number" min="1900" step="1" />
              </label>
              <label v-else class="lands-field">
                <span class="lands-label-with-help">
                  Тип мероприятия
                  <RefFieldHelp
                    text="Нет нужного типа мероприятия? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'melioration-refs' } }"
                    link-label="Типы мероприятий"
                  />
                </span>
                <select v-model="meliorationForm.eventType">
                  <option value="">—</option>
                  <option v-for="row in landMeliorationEventTypes" :key="row.id" :value="row.name">
                    {{ row.name }}
                  </option>
                </select>
              </label>
            </div>
            <div v-if="meliorationTab === 'systems'" class="lands-form-grid lands-form-grid--mel">
              <label class="lands-field">
                <span class="lands-label-with-help">
                  Вид мелиорации
                  <RefFieldHelp
                    text="Нет нужного вида мелиорации? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'melioration-refs' } }"
                    link-label="Справочники мелиорации"
                  />
                </span>
                <select v-model="meliorationForm.meliorationSubtype">
                  <option value="">—</option>
                  <option v-for="row in landMeliorationSubtypes" :key="row.id" :value="row.name">
                    {{ row.name }}
                  </option>
                </select>
              </label>
              <label class="lands-field">
                <span>Кадастровый номер земельного участка</span>
                <input v-model.trim="meliorationForm.cadastralNumber" type="text" />
              </label>
            </div>
            <div v-if="meliorationTab === 'systems'" class="lands-form-grid lands-form-grid--mel">
              <label class="lands-field">
                <span>Дата ввода в эксплуатацию</span>
                <input v-model="meliorationForm.commissionedAt" type="date" />
              </label>
              <label class="lands-field">
                <span>Площадь орошаемых (осушаемых) земель, га</span>
                <input v-model.number="meliorationForm.areaHa" type="number" min="0" step="0.01" />
              </label>
            </div>
            <label v-if="meliorationTab === 'systems'" class="lands-field">
              <span>Описание мелиоративной системы и местоположения</span>
              <input v-model.trim="meliorationForm.descriptionLocation" type="text" />
            </label>

            <div v-if="meliorationTab === 'forest'" class="lands-form-grid lands-form-grid--mel">
              <label class="lands-field">
                <span>Площадь МЗЛН, га</span>
                <input v-model.number="meliorationForm.areaHa" type="number" min="0" step="0.01" />
              </label>
              <label class="lands-field">
                <span>Кадастровый номер земельного участка</span>
                <input v-model.trim="meliorationForm.cadastralNumber" type="text" />
              </label>
            </div>
            <label v-if="meliorationTab === 'forest'" class="lands-field">
              <span>Количественные, качественные характеристики</span>
              <input v-model.trim="meliorationForm.forestCharacteristics" type="text" />
            </label>
            <label v-if="meliorationTab === 'forest'" class="lands-field">
              <span>Информация о реконструкции насаждений</span>
              <input v-model.trim="meliorationForm.reconstructionInfo" type="text" />
            </label>

            <div v-if="meliorationTab === 'events'" class="lands-form-grid lands-form-grid--mel">
              <label class="lands-field">
                <span>Дата проведения</span>
                <input v-model="meliorationForm.eventDate" type="date" />
              </label>
              <label class="lands-field">
                <span>Площадь земельного участка, га</span>
                <input v-model.number="meliorationForm.areaHa" type="number" min="0" step="0.01" />
              </label>
            </div>
            <label v-if="meliorationTab === 'events'" class="lands-field">
              <span>Согласование проектов мелиорации</span>
              <input v-model.trim="meliorationForm.projectApproval" type="text" />
            </label>
          </div>
          <div class="lands-modal-actions">
            <button type="button" class="lands-btn" :disabled="saving" @click="closeMeliorationModal">Отмена</button>
            <button type="button" class="lands-btn lands-btn--save" :disabled="saving || !meliorationForm.fieldId" @click="saveMeliorationEntry">
              {{ saving ? 'Сохранение...' : 'Сохранить' }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="deleteConfirmOpen"
        class="lands-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Подтверждение удаления"
        @click.self="closeDeleteConfirm"
      >
        <div class="lands-modal lands-modal--compact">
          <div class="lands-modal-head">
            <h2>{{ deleteConfirmTitle }}</h2>
            <ModalCloseButton :disabled="saving || refsLoading" @click="closeDeleteConfirm" />
          </div>
          <div class="lands-modal-body">
            <p class="lands-confirm-text">{{ deleteConfirmText }}</p>
          </div>
          <div class="lands-modal-actions">
            <button type="button" class="lands-btn" :disabled="saving || refsLoading" @click="closeDeleteConfirm">Отмена</button>
            <button type="button" class="lands-btn lands-btn--danger" :disabled="saving || refsLoading" @click="confirmDeleteTarget">
              {{ saving || refsLoading ? 'Удаление...' : 'Удалить' }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="rightFileDeleteConfirmOpen"
        class="lands-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Удаление файла"
        @click.self="closeRightFileDeleteConfirm"
      >
        <div class="lands-modal lands-modal--compact">
          <div class="lands-modal-head">
            <h2>Удалить файл?</h2>
            <ModalCloseButton :disabled="saving || rightFileUploading" @click="closeRightFileDeleteConfirm" />
          </div>
          <div class="lands-modal-body">
            <p class="lands-confirm-text">Файл будет удален из списка подтверждающих документов.</p>
          </div>
          <div class="lands-modal-actions">
            <button type="button" class="lands-btn" :disabled="saving || rightFileUploading" @click="closeRightFileDeleteConfirm">Отмена</button>
            <button type="button" class="lands-btn lands-btn--danger" :disabled="saving || rightFileUploading" @click="confirmRemoveRightSupportingFile">
              Удалить
            </button>
          </div>
        </div>
      </div>
      <div
        v-if="successModalOpen"
        class="lands-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Успешно"
        @click.self="closeSuccessModal"
      >
        <div class="lands-modal lands-modal--compact">
          <div class="lands-modal-head">
            <h2>Готово</h2>
            <ModalCloseButton @click="closeSuccessModal" />
          </div>
          <div class="lands-modal-body">
            <p class="lands-confirm-text">{{ successModalText }}</p>
          </div>
          <div class="lands-modal-actions">
            <button type="button" class="lands-btn lands-btn--save" @click="closeSuccessModal">Закрыть</button>
          </div>
        </div>
      </div>
    </teleport>
  </section>
</template>

<style scoped>
.lands-page { display:flex; flex-direction:column; gap:1rem; min-width:0; }
.lands-top { display:flex; justify-content:space-between; align-items:flex-start; gap:.75rem; flex-wrap:wrap; }
.lands-top-text { display:flex; flex-direction:column; gap:4px; }
.lands-back-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  font-size: 1.05rem;
  font-weight: 500;
  cursor: pointer;
  width: fit-content;
}
.lands-back-btn:hover {
  color: var(--text-primary);
}
.lands-subtitle { margin:0; color:var(--text-secondary); font-size:.9rem; }
.lands-top-actions { display:flex; gap:8px; flex-wrap:wrap; }
.lands-create-btn {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  height:38px;
  border:1px solid var(--accent-green);
  border-radius:10px;
  background:var(--accent-green);
  color:#fff;
  padding:0 14px;
  cursor:pointer;
  font-weight:600;
  transition:transform .2s ease, box-shadow .2s ease, background .2s ease;
}
.lands-create-btn:hover { background:var(--accent-green-hover); transform:translateY(-1px) scale(1.01); box-shadow:0 6px 14px rgba(61, 92, 64, 0.3); }
.lands-btn--add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.lands-btn--add::before {
  content: '';
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  background-repeat: no-repeat;
  background-position: center;
  background-size: 18px 18px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round'%3E%3Cline x1='12' y1='5' x2='12' y2='19'/%3E%3Cline x1='5' y1='12' x2='19' y2='12'/%3E%3C/svg%3E");
  transform-origin: center;
  transition: transform 0.28s ease;
}
.lands-btn--add:hover::before {
  transform: rotate(52deg) scale(1.18);
}
.lands-edit-btn {
  height: 38px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text-primary);
  padding: 0 14px;
  cursor: pointer;
  font-weight: 500;
  transition: border-color .2s ease, background .2s ease, transform .2s ease;
}
.lands-edit-btn:hover {
  border-color: var(--accent-green);
  background: var(--bg-panel-hover);
  transform: translateY(-1px);
}
.lands-error { margin:0; color:#b42318; }
.lands-content { display:flex; flex-direction:column; gap:12px; min-width:0; }
.lands-card {
  background:var(--bg-panel);
  border:1px solid var(--border-color);
  border-radius:12px;
  box-shadow:0 1px 3px rgba(0,0,0,.06);
  padding:12px;
}
.lands-card h2 { margin:0 0 .7rem; font-size:1rem; }
.lands-overview-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-bottom:10px; }
.lands-overview-item { border:1px solid var(--border-color); border-radius:10px; padding:8px 10px; background:#fff; display:flex; flex-direction:column; gap:2px; }
.lands-overview-item > span { font-size:.75rem; color:var(--text-secondary); }
.lands-overview-item > strong { font-size:.9rem; color:var(--text-primary); font-weight:500; }
.lands-passport-input { width:100%; border:1px solid var(--border-color); border-radius:8px; padding:7px 9px; font-size:.88rem; color:var(--text-primary); background:#fff; }
.lands-table-top { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap; }
.lands-table-tools { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:nowrap; width:100%; }
.lands-table-tools .lands-search { flex: 0 1 620px; width: min(620px, 100%); min-width: 260px; max-width: 620px; margin: 0; }
.lands-table-tools .task-export-btns { flex: 0 0 auto; margin-left: auto; align-items: center; }
@media (max-width: 980px) {
  .lands-table-tools { flex-wrap: wrap; }
  .lands-table-tools .task-export-btns { margin-left: 0; }
}
.lands-table-wrap { overflow:auto; border:1px solid var(--border-color); border-radius:12px; }
.lands-table { width:100%; border-collapse:collapse; min-width:920px; font-size:.875rem; }
.lands-table thead { background: rgba(0, 0, 0, 0.02); }
.lands-table th, .lands-table td { padding:14px 16px; border-bottom:1px solid var(--border-color); text-align:left; font-size:.88rem; }
.lands-table th { color:var(--text-secondary); font-size:.75rem; font-weight:600; text-transform:uppercase; letter-spacing:.05em; }
.lands-list-row {
  cursor: pointer;
  transition:
    background-color 0.22s ease,
    box-shadow 0.22s ease;
}

.lands-table tbody tr.lands-list-row:hover {
  background-color: color-mix(in srgb, var(--accent-green) 9%, var(--bg-panel));
  box-shadow: inset 3px 0 0 var(--accent-green);
}

.lands-table tbody tr.lands-list-row:hover .lands-list-title-main {
  color: var(--accent-green);
}

.lands-list-title-main {
  transition: color 0.22s ease;
}

.lands-table tbody tr.lands-list-row.is-active {
  background: color-mix(in srgb, var(--accent-green) 10%, var(--bg-panel));
}

.lands-table tbody tr.lands-list-row.is-active:hover {
  background-color: color-mix(in srgb, var(--accent-green) 14%, var(--bg-panel));
  box-shadow: inset 3px 0 0 var(--accent-green);
}

@media (prefers-reduced-motion: reduce) {
  .lands-list-row {
    transition: background-color 0.15s ease, box-shadow 0.15s ease;
  }

  .lands-table tbody tr.lands-list-row:hover .lands-list-title-main {
    transition: none;
  }
}

[data-theme='dark'] .lands-table tbody tr.lands-list-row:hover {
  background-color: color-mix(in srgb, var(--accent-green) 16%, var(--bg-elevated));
  box-shadow: inset 3px 0 0 var(--accent-green);
}

[data-theme='dark'] .lands-table tbody tr.lands-list-row.is-active {
  background: color-mix(in srgb, var(--accent-green) 12%, var(--bg-elevated));
}

[data-theme='dark'] .lands-table tbody tr.lands-list-row.is-active:hover {
  background-color: color-mix(in srgb, var(--accent-green) 18%, var(--bg-elevated));
}

[data-theme='dark'] .lands-table tbody tr.lands-list-row:hover .lands-list-title-main,
[data-theme='dark'] .lands-table tbody tr.lands-list-row.is-active:hover .lands-list-title-main {
  color: color-mix(in srgb, #fff 75%, var(--accent-green));
}
.lands-search {
  width:100%;
  height:36px;
  border:1px solid var(--border-color);
  border-radius:8px;
  padding:0 10px;
  margin-bottom:10px;
  background:var(--bg-panel);
  color:var(--text-primary);
  transition:border-color .2s ease, box-shadow .2s ease;
}
.lands-search:focus { outline:none; border-color:var(--accent-green); box-shadow:0 0 0 1px var(--accent-green); }
.lands-map-wrap { border:1px solid var(--border-color); border-radius:12px; overflow:hidden; margin-bottom:10px; }
.lands-address-candidates { display:flex; flex-direction:column; gap:6px; margin-bottom:10px; }
.lands-address-candidates--details { max-width: min(680px, 100%); }
.lands-address-candidates-label { font-size:.82rem; font-weight:600; color:var(--text-secondary); }
.lands-address-candidates-select { width:100%; border:1px solid var(--border-color); border-radius:9px; padding:8px 10px; background:#fff; color:var(--text-primary); }
.lands-map-head { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px; border-bottom:1px solid var(--border-color); background:#fff; flex-wrap:wrap; }
.lands-map-title { font-size:.84rem; font-weight:600; color:var(--text-primary); }
.lands-map-switch { display:flex; border:1px solid var(--border-color); border-radius:9px; overflow:hidden; }
.lands-map-switch-btn { height:30px; border:none; border-right:1px solid var(--border-color); background:#fff; padding:0 10px; font-size:.8rem; font-weight:600; cursor:pointer; }
.lands-map-switch-btn:last-child { border-right:none; }
.lands-map-switch-btn--active { background:color-mix(in srgb, var(--accent-green) 16%, #fff); color:var(--text-primary); }
.lands-map-actions { display:flex; align-items:center; gap:8px; padding:8px; flex-wrap:wrap; border-top:1px solid var(--border-color); }
.lands-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: var(--space-lg);
  border-bottom: 1px solid var(--border-color);
}
.lands-tabs--top { margin-bottom: var(--space-lg); }
.lands-tabs--sub { margin-bottom: 12px; }
.lands-tab-btn {
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
.lands-tab-btn:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-green) 2.5%, transparent);
  transform: translateY(-1px);
}
.lands-tab-btn.is-active {
  color: var(--accent-green);
  border-bottom-color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 4%, transparent);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--accent-green) 8%, transparent);
  animation: lands-tab-pill-in 0.28s ease;
}
.lands-wip-mini {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.lands-wip-mini-loader {
  width: 40px;
  height: 40px;
}
.lands-wip-mini-loader path {
  stroke: #000;
  stroke-width: 0.9px;
  fill: none;
  animation:
    lands-wip-mini-dash-array 4s ease-in-out infinite,
    lands-wip-mini-dash-offset 4s linear infinite;
}
.lands-wip-mini-caption {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-secondary);
}
.land-list-item { width:100%; text-align:left; border:1px solid var(--border-color); border-radius:10px; background:#fff; padding:8px 10px; cursor:pointer; margin-bottom:8px; }
.land-list-item.is-active { border-color:color-mix(in srgb, var(--accent-green) 48%, var(--border-color)); background:color-mix(in srgb, var(--accent-green) 12%, #fff); }
.lands-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.lands-form-grid--passport { margin-bottom:10px; }
.lands-field { display:flex; flex-direction:column; gap:6px; margin-bottom:10px; }
.lands-field--inline-end { justify-content:flex-end; }
.lands-field > span { font-size:.85rem; font-weight:600; }
.lands-label-with-help {
  display: inline-flex;
  align-items: center;
}
.lands-field input, .lands-field textarea, .lands-field select { border:1px solid var(--border-color); border-radius:10px; padding:9px 11px; font-size:.93rem; background:#fff; color:var(--text-primary); }
.lands-yesno-toggle {
  display: inline-flex;
  gap: 8px;
}
.lands-yesno-btn {
  height: 36px;
  min-width: 76px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-weight: 600;
  cursor: pointer;
  transition: border-color .2s ease, background .2s ease, transform .2s ease;
}
.lands-yesno-btn:hover {
  border-color: var(--accent-green);
  background: var(--bg-panel-hover);
  transform: translateY(-1px);
}
.lands-yesno-btn.is-active {
  border-color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 10%, var(--bg-panel));
  color: var(--accent-green);
}
.lands-actions { display:flex; gap:8px; flex-wrap:wrap; border-top:1px solid var(--border-color); padding-top:10px; }
.lands-actions--end { justify-content: flex-end; }
.lands-actions--map { border-top:none; padding-top:0; margin-bottom:8px; justify-content:flex-end; }
.lands-actions--crop { border-top:none; padding-top:0; margin-bottom:12px; justify-content:flex-end; }
.lands-section-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:12px; }
.lands-section-head h2 { margin:0; }
.lands-section-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
.lands-melioration-head { display:flex; align-items:center; justify-content:flex-end; gap:8px; margin-bottom:10px; }
.lands-melioration-empty { text-align:center; padding:18px 12px; }
.lands-form-grid--mel { align-items: end; }
.lands-tabs--melioration {
  gap: 0;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  scrollbar-width: thin;
}
.lands-tabs--melioration .lands-tab-btn {
  font-size: 0.86rem;
  padding: 9px 12px;
  white-space: normal;
  min-width: 260px;
  text-align: left;
  line-height: 1.25;
}
.lands-table-wrap--melioration .lands-table {
  min-width: 1280px;
}
.lands-table-wrap--melioration .lands-table td,
.lands-table-wrap--melioration .lands-table th {
  vertical-align: top;
}
.lands-table-wrap--melioration .lands-item-actions {
  justify-content: flex-end;
}
.lands-btn {
  height:38px;
  border-radius:10px;
  border:1px solid transparent;
  padding:0 12px;
  cursor:pointer;
  font-weight:600;
  transition: border-color .2s ease, background .2s ease, transform .2s ease, box-shadow .2s ease;
}
.lands-btn:not(.lands-btn--save):not(.lands-btn--danger) {
  border-color: var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
}
.lands-btn:not(.lands-btn--save):not(.lands-btn--danger):hover {
  border-color: var(--accent-green);
  background: var(--bg-panel-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px color-mix(in srgb, var(--accent-green) 12%, transparent);
}
.lands-btn--save { background:var(--accent-green); color:#fff; }
.lands-btn--danger { background:#fff; border-color:#fca5a5; color:#b42318; }
.lands-btn--save:hover { background:var(--accent-green-hover); }
.task-export-btns {
  display: flex;
  gap: 8px;
}
.task-header-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.task-btn-export {
  height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: .875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}
.task-btn-export:hover:not(:disabled) {
  background: var(--sidebar-hover-bg);
  color: var(--text-primary);
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
  transition: transform 0.22s ease;
}
.task-btn-export.has_saved:hover:not(:disabled) svg {
  animation: task-export-file-hover 0.65s ease;
}
@keyframes task-export-file-hover {
  0% { transform: translateY(0) scale(1) rotate(0deg); }
  35% { transform: translateY(-2px) scale(1.11) rotate(-8deg); }
  70% { transform: translateY(-1px) scale(1.06) rotate(6deg); }
  100% { transform: translateY(0) scale(1) rotate(0deg); }
}
.task-btn-export:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.lands-ref-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 10px;
}
.lands-ref-block { border:1px solid var(--border-color); border-radius:12px; padding:10px; margin-bottom:0; }
.lands-ref-block h2 { margin:0 0 10px; font-size:1rem; }
.lands-ref-add-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.lands-ref-add-row .lands-search {
  margin-bottom: 0;
  min-width: 0;
  height: 38px;
}
.lands-ref-add-row .lands-btn {
  min-width: 108px;
}
.lands-ref-add-row--wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.lands-ref-add-row--wrap .lands-search {
  flex: 1 1 220px;
  min-width: 0;
  margin-bottom: 0;
  height: 38px;
}
.lands-ref-hint {
  margin: 0 0 8px;
  font-size: 0.82rem;
}
.lands-checkbox-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}
.lands-checkbox-inline input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-green);
}
.lands-fields-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.lands-list-plain { display:flex; flex-direction:column; gap:8px; }
.lands-list-plain-item { display:flex; justify-content:space-between; gap:10px; align-items:center; border:1px solid var(--border-color); border-radius:10px; padding:8px 10px; }
.lands-list-plain-item--stack { align-items:flex-start; }
.lands-item-actions { display:flex; align-items:center; gap:4px; }
.lands-action-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color .15s ease, background .15s ease, transform .15s ease;
}
.lands-action-btn svg {
  transform-origin: center;
  transition: transform 0.24s ease;
}
.lands-action-btn:hover {
  color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 8%, transparent);
  transform: translateY(-1px);
}
.lands-action-btn--edit:hover svg {
  transform: rotate(16deg) scale(1.08);
}
.lands-action-btn--danger:hover {
  color: #dc2626;
  background: color-mix(in srgb, #dc2626 10%, transparent);
}
.lands-fields-table { min-width: 1120px; }
.lands-field-cell-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: .9rem;
}
.lands-field-cell-subtitle {
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: .77rem;
}
.lands-field-description {
  max-width: 280px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lands-crop-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: .74rem;
  font-weight: 600;
  border: 1px solid transparent;
  white-space: nowrap;
}
.lands-crop-pill--wheat {
  background: color-mix(in srgb, #f59e0b 18%, #fff);
  color: #92400e;
  border-color: color-mix(in srgb, #f59e0b 28%, #fff);
}
.lands-crop-pill--soy {
  background: color-mix(in srgb, #16a34a 16%, #fff);
  color: #166534;
  border-color: color-mix(in srgb, #16a34a 26%, #fff);
}
.lands-crop-pill--sunflower {
  background: color-mix(in srgb, #f97316 16%, #fff);
  color: #9a3412;
  border-color: color-mix(in srgb, #f97316 24%, #fff);
}
.lands-crop-pill--meadow {
  background: color-mix(in srgb, #22c55e 14%, #fff);
  color: #15803d;
  border-color: color-mix(in srgb, #22c55e 24%, #fff);
}
.lands-crop-pill--grey {
  background: color-mix(in srgb, #6b7280 12%, #fff);
  color: #4b5563;
  border-color: color-mix(in srgb, #6b7280 22%, #fff);
}
.lands-mini-btn { height:30px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-panel); padding:0 10px; cursor:pointer; transition:border-color .15s ease, background .15s ease; }
.lands-mini-btn:hover { border-color:var(--accent-green); background:var(--bg-panel-hover); }
.lands-muted { margin:0; color:var(--text-secondary); font-size:.9rem; }
.lands-muted-line { color:var(--text-secondary); font-size:.84rem; margin-top:2px; }

/* Пагинация реестра — как на «Полях» / «Складах» */
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
.fields-pagination-right {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  flex-wrap: wrap;
}
.fields-pagination-nav {
  display: flex;
  align-items: center;
  gap: 4px;
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
}
.fields-page-btn:hover:not(:disabled):not(.fields-page-btn--active) {
  background: var(--bg-panel-hover);
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
@media (prefers-reduced-motion: reduce) {
  .fields-page-btn {
    transition: none;
  }
}
.lands-crop-rotation-card-main {
  min-width: 0;
  flex: 1;
}
.lands-crop-rotation-metric-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(120px, 1fr));
  column-gap: 14px;
  row-gap: 8px;
  margin-top: 0;
  padding-top: 0;
  border-top: none;
  align-items: start;
}
.lands-crop-rotation-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.lands-crop-rotation-metric-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-secondary);
  line-height: 1.25;
}
.lands-crop-rotation-metric-value {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
}
.lands-crop-rotation-metric-value--nowrap {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 1440px) {
  .lands-crop-rotation-metric-row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 980px) {
  .lands-crop-rotation-metric-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .lands-crop-rotation-metric-row {
    grid-template-columns: 1fr;
  }
}
.lands-re-card-main {
  min-width: 0;
  flex: 1;
}
.lands-re-metric-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(120px, 1fr));
  column-gap: 14px;
  row-gap: 8px;
  align-items: start;
}
.lands-re-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.lands-re-metric-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-secondary);
  line-height: 1.25;
}
.lands-re-metric-value {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
}
.lands-re-metric-value--nowrap {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lands-owner-mode-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.lands-owner-mode-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}
.lands-owner-mode-label {
  font-size: .88rem;
  font-weight: 600;
  color: var(--text-primary);
}
.lands-owner-mode-btn {
  height: 34px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0 12px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-weight: 600;
  cursor: pointer;
  transition: border-color .2s ease, background .2s ease, color .2s ease;
}
.lands-owner-mode-btn:hover {
  border-color: var(--accent-green);
  color: var(--text-primary);
}
.lands-owner-mode-btn.is-active {
  background: color-mix(in srgb, var(--accent-green) 10%, var(--bg-panel));
  border-color: var(--accent-green);
  color: var(--accent-green);
}
.lands-right-card-main {
  min-width: 0;
  flex: 1;
}
.lands-right-metric-row {
  display: grid;
  grid-template-columns: repeat(9, minmax(120px, 1fr));
  column-gap: 14px;
  row-gap: 8px;
  align-items: start;
}
.lands-right-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.lands-right-metric-label {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-secondary);
  line-height: 1.25;
}
.lands-right-metric-value {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
}
.lands-right-metric-value--nowrap {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lands-docs-preview-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.lands-docs-preview-grid--compact {
  margin-top: 6px;
  max-height: 124px;
  overflow: auto;
}
.lands-docs-preview-card {
  width: 92px;
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  text-decoration: none;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-panel);
  padding: 5px;
  transition: border-color .2s ease, background .2s ease, transform .2s ease;
}
.lands-docs-preview-card-wrap {
  position: relative;
}
.lands-docs-remove-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border: 1px solid #fecaca;
  border-radius: 999px;
  background: #fff;
  color: #b42318;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform .15s ease, background .15s ease, border-color .15s ease;
}
.lands-docs-remove-btn:hover {
  transform: scale(1.06);
  background: #fef2f2;
  border-color: #fca5a5;
}
.lands-docs-remove-btn:disabled {
  opacity: .6;
  cursor: not-allowed;
}
.lands-docs-preview-card:hover {
  border-color: var(--accent-green);
  background: var(--bg-panel-hover);
  transform: translateY(-1px);
}
.lands-docs-preview-thumb-wrap {
  width: 100%;
  height: 54px;
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--accent-green) 7%, var(--bg-panel));
  display: flex;
  align-items: center;
  justify-content: center;
}
.lands-docs-preview-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lands-docs-preview-icon {
  color: var(--text-secondary);
}
.lands-docs-preview-name {
  font-size: 0.68rem;
  line-height: 1.25;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lands-docs-compact-box {
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  padding: 8px;
  background: color-mix(in srgb, var(--accent-green) 2%, var(--bg-panel));
}
.lands-docs-compact-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.lands-docs-compact-state {
  font-size: 0.76rem;
  color: var(--text-secondary);
  font-weight: 600;
}
.lands-docs-compact-state.is-filled {
  color: var(--accent-green);
}
.lands-file-upload {
  position: relative;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-panel);
  transition: border-color .2s ease, background .2s ease, transform .2s ease, box-shadow .2s ease;
  cursor: pointer;
}
.lands-file-upload:hover {
  border-color: var(--accent-green);
  background: var(--bg-panel-hover);
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(45, 90, 61, 0.14);
}
.lands-file-upload-btn {
  height: 30px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: #fff;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  font-size: .85rem;
  font-weight: 600;
  transition: border-color .2s ease, color .2s ease, background .2s ease;
}
.lands-file-upload:hover .lands-file-upload-btn {
  border-color: color-mix(in srgb, var(--accent-green) 60%, var(--border-color));
  color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 6%, var(--bg-panel));
}
.lands-file-upload-hint {
  font-size: .78rem;
  color: var(--text-secondary);
}
.lands-file-upload-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
@media (max-width: 1540px) {
  .lands-right-metric-row {
    grid-template-columns: repeat(5, minmax(120px, 1fr));
  }
}
@media (max-width: 1100px) {
  .lands-right-metric-row {
    grid-template-columns: repeat(3, minmax(120px, 1fr));
  }
}
@media (max-width: 760px) {
  .lands-right-metric-row {
    grid-template-columns: repeat(2, minmax(120px, 1fr));
  }
}
@media (max-width: 520px) {
  .lands-right-metric-row {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 1280px) {
  .lands-re-metric-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 820px) {
  .lands-re-metric-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .lands-re-metric-row {
    grid-template-columns: 1fr;
  }
}
.lands-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2200;
  background: var(--modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  animation: landsModalFadeIn 0.2s ease;
}
.lands-modal { width:min(1100px, 96vw); max-height:92vh; overflow:hidden; border-radius:16px; border:1px solid var(--border-color); background:#fff; display:flex; flex-direction:column; }
.lands-modal--compact { width:min(560px, 96vw); }
.lands-modal--success { animation: lands-success-pop .24s ease; }
.lands-modal-head { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid var(--border-color); }
.lands-modal-head h2 { margin:0; font-size:1.05rem; }
/* .lands-modal-close styles are now in global.css */
.lands-modal-body { padding:12px; overflow:auto; }
.lands-modal-actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; padding:10px 12px; border-top:1px solid var(--border-color); }
.lands-confirm-text { margin: 0; color: var(--text-secondary); font-size: .95rem; line-height: 1.45; }
@keyframes landsModalFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes lands-success-pop {
  0% { transform: translateY(8px) scale(.985); opacity: .72; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}

@keyframes lands-tab-pill-in {
  0% {
    transform: scale(0.94);
    opacity: 0.85;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes lands-wip-mini-dash-array {
  0%,
  100% {
    stroke-dasharray: 0 1 359 0;
  }
  50% {
    stroke-dasharray: 0 359 1 0;
  }
}
@keyframes lands-wip-mini-dash-offset {
  0% { stroke-dashoffset: 365; }
  100% { stroke-dashoffset: 5; }
}
@media (prefers-reduced-motion: reduce) {
  .lands-wip-mini-loader path {
    animation: none;
  }
}
[data-theme='dark'] .lands-wip-mini-loader path { stroke: color-mix(in srgb, white 88%, var(--accent-green)); }
[data-theme='dark'] .lands-list,
[data-theme='dark'] .lands-card,
[data-theme='dark'] .lands-overview-item,
[data-theme='dark'] .lands-passport-input,
[data-theme='dark'] .lands-modal,
[data-theme='dark'] .lands-table th,
[data-theme='dark'] .lands-map-head,
[data-theme='dark'] .lands-map-actions,
[data-theme='dark'] .lands-address-candidates-select,
[data-theme='dark'] .lands-search,
[data-theme='dark'] .land-list-item,
[data-theme='dark'] .lands-map-switch-btn,
[data-theme='dark'] .lands-tab-btn,
[data-theme='dark'] .lands-mini-btn,
[data-theme='dark'] .lands-btn--danger,
[data-theme='dark'] .lands-field input,
[data-theme='dark'] .lands-field textarea,
[data-theme='dark'] .lands-field select { background:var(--bg-panel); }
[data-theme='dark'] .lands-page {
  --lands-input-bg: color-mix(in srgb, var(--bg-elevated) 76%, black);
  --lands-input-border: var(--border-color);
}
[data-theme='dark'] .lands-modal {
  background: var(--bg-elevated);
  border-color: var(--border-color);
  box-shadow: var(--shadow-card);
}
[data-theme='dark'] .lands-modal-head,
[data-theme='dark'] .lands-modal-actions {
  border-color: var(--border-color);
}
[data-theme='dark'] .lands-modal .lands-field input,
[data-theme='dark'] .lands-modal .lands-field textarea,
[data-theme='dark'] .lands-modal .lands-field select {
  background: var(--lands-input-bg);
  border-color: var(--border-color);
  color: var(--text-primary);
}
[data-theme='dark'] .lands-modal .lands-field input:focus,
[data-theme='dark'] .lands-modal .lands-field textarea:focus,
[data-theme='dark'] .lands-modal .lands-field select:focus {
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px var(--focus-ring);
}
[data-theme='dark'] .lands-modal .lands-field span {
  color: var(--text-secondary);
}
[data-theme='dark'] .lands-modal .lands-field input::placeholder,
[data-theme='dark'] .lands-modal .lands-field textarea::placeholder {
  color: var(--text-muted);
}

[data-theme='dark'] .lands-tabs--melioration .lands-tab-btn {
  color: var(--text-secondary);
}
[data-theme='dark'] .lands-tabs--melioration .lands-tab-btn.is-active {
  color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 12%, var(--bg-panel));
}
[data-theme='dark'] .lands-table-wrap--melioration .lands-table thead {
  background: color-mix(in srgb, var(--bg-panel-hover) 70%, transparent);
}
[data-theme='dark'] .lands-table-wrap--melioration .lands-table td {
  color: var(--text-primary);
}
@media (max-width:980px) {
  .lands-table { min-width:760px; }
}
@media (max-width:760px) {
  .lands-overview-grid,
  .lands-form-grid, .lands-fields-grid { grid-template-columns:1fr; }
  .lands-ref-grid { grid-template-columns: 1fr; }
  .lands-melioration-head {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .lands-tabs--melioration .lands-tab-btn {
    min-width: 220px;
    font-size: 0.82rem;
  }
  .lands-table-wrap--melioration .lands-table {
    min-width: 980px;
  }
}
</style>
