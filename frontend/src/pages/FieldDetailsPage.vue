<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import {
  getFieldById,
  loadFieldPhotos,
  addFieldPhoto,
  deleteFieldPhoto,
  updateField,
  uploadFieldScheme,
  loadFieldMunicipalitiesRefs,
  type FieldRow,
  type FieldPhotoRow,
  type FieldMunicipalityRefRow,
} from '@/lib/fieldsSupabase'
import { loadProfiles, type ProfileRow } from '@/lib/tasksSupabase'
import { loadCrops, loadLandTypes, type CropRow, type LandTypeRow } from '@/lib/landTypesAndCrops'
import { loadLands, type LandRow } from '@/lib/landsSupabase'
import { loadOperationsByFieldFromSupabase, type FieldOperationHistoryRow } from '@/lib/analyticsSupabase'
import { isSupabaseConfigured } from '@/lib/supabase'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
import YandexMap from '@/components/YandexMap.vue'
import { resolveYandexAddressLine, resolveYandexAddressCandidates, parseLatLonFromGeolocationString } from '@/lib/yandexGeocode'

const props = defineProps<{ id: string }>()

const router = useRouter()
const auth = useAuth()
const field = ref<FieldRow | null>(null)
const photos = ref<FieldPhotoRow[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const profiles = ref<ProfileRow[]>([])
const crops = ref<CropRow[]>([])
const landTypes = ref<LandTypeRow[]>([])
const lands = ref<LandRow[]>([])
const fieldMunicipalityRefs = ref<FieldMunicipalityRefRow[]>([])
const photoUploading = ref(false)
const photoFileInput = ref<HTMLInputElement | null>(null)
const schemeFileInput = ref<HTMLInputElement | null>(null)

const isEditing = ref(false)
const saveError = ref<string | null>(null)
const saving = ref(false)
const editForm = ref({
  name: '',
  area: 0,
  cadastral_number: '',
  efis_zsn_number: '',
  address: '',
  location_description: '',
  extra_info: '',
  geolocation: '',
  municipality: '',
  region: '',
  geometry_mode: 'point' as 'point' | 'polygon',
  contour_geojson: null as Record<string, unknown> | null,
  land_type: '',
  sowing_year: new Date().getFullYear(),
  responsible_id: '',
  crop_key: '',
  scheme_file_url: '',
})
const schemeUploading = ref(false)
const fieldMapAddressLoading = ref(false)
const fieldMapAddressError = ref('')
const editAddressCandidates = ref<string[]>([])
const selectedEditAddressCandidate = ref('')
const editAddressCandidatesLoading = ref(false)
const editAddressManualTouched = ref(false)
const editAddressLastAuto = ref('')
const editFieldAreaAuto = ref<number | null>(null)
const editFieldAreaManualTouched = ref(false)
const editContourDraftPoints = ref<LatLon[]>([])
const historyLoading = ref(false)
const history = ref<FieldOperationHistoryRow[]>([])
const historyPage = ref(1)
const historyPageSize = ref(5)
const historyTotal = ref(0)

const isManager = computed(() => auth.userRole.value === 'manager')

type LatLon = [number, number]
type PolygonGeoJson = { type: 'Polygon'; coordinates: number[][][] }

function fromPolygonGeoJson(geojson: Record<string, unknown> | null | undefined): LatLon[] {
  if (!geojson || geojson.type !== 'Polygon' || !Array.isArray((geojson as { coordinates?: unknown }).coordinates)) return []
  const ring = ((geojson as { coordinates: unknown[] }).coordinates[0] as unknown[]) || []
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

function toPolygonGeoJson(points: LatLon[]): PolygonGeoJson | null {
  if (!Array.isArray(points) || points.length < 3) return null
  const ring = points.map(([lat, lon]) => [lon, lat])
  const [fLon, fLat] = ring[0]!
  const [lLon, lLat] = ring[ring.length - 1]!
  if (fLon !== lLon || fLat !== lLat) ring.push([fLon, fLat])
  return { type: 'Polygon', coordinates: [ring] }
}

function polygonCenter(points: LatLon[]): { lat: number; lon: number } | null {
  if (!points.length) return null
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length
  const lon = points.reduce((s, p) => s + p[1], 0) / points.length
  return { lat, lon }
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

function applyEditAddressCandidates(candidates: string[]) {
  const list = [...new Set(candidates.map((x) => x.trim()).filter(Boolean))]
  editAddressCandidates.value = list
  selectedEditAddressCandidate.value = list[0] || ''
  const current = editForm.value.address.trim()
  if (!list.length) return
  if (!current || !editAddressManualTouched.value) {
    editForm.value.address = list[0]!
    tryFillEditRegionFromAddress(list[0]!)
    editAddressLastAuto.value = list[0]!
    editAddressManualTouched.value = false
  }
}

function onEditAddressInput() {
  if (editForm.value.address !== editAddressLastAuto.value) {
    editAddressManualTouched.value = true
  }
}

function onEditAddressCandidateChange() {
  if (!selectedEditAddressCandidate.value) return
  editForm.value.address = selectedEditAddressCandidate.value
  tryFillEditRegionFromAddress(selectedEditAddressCandidate.value)
  editAddressLastAuto.value = selectedEditAddressCandidate.value
  editAddressManualTouched.value = false
}

function extractRegionFromAddress(address: string): string {
  const match = address.match(/([А-Яа-яЁёA-Za-z\- ]+\s(?:область|край|республика|АО|автономный округ))/)
  return match?.[1]?.trim() || ''
}

function tryFillEditRegionFromAddress(address: string) {
  const region = extractRegionFromAddress(address)
  if (region) editForm.value.region = region
}

let editContourAddressRequestId = 0
async function suggestEditContourAddresses(points: LatLon[], center: { lat: number; lon: number } | null) {
  const samples = contourSamplePoints(points, center)
  if (!samples.length) return
  const reqId = ++editContourAddressRequestId
  editAddressCandidatesLoading.value = true
  try {
    const candidates = await resolveYandexAddressCandidates(samples, 8)
    if (reqId !== editContourAddressRequestId) return
    applyEditAddressCandidates(candidates)
    if (!candidates.length) {
      fieldMapAddressError.value = 'Не удалось подобрать адреса по контуру. Укажите адрес вручную.'
    } else {
      fieldMapAddressError.value = ''
    }
  } finally {
    if (reqId === editContourAddressRequestId) editAddressCandidatesLoading.value = false
  }
}

const fieldEditPolygonPoints = computed<LatLon[]>(() =>
  editContourDraftPoints.value.length ? editContourDraftPoints.value : fromPolygonGeoJson(editForm.value.contour_geojson),
)
const fieldEditPolygonCenter = computed(() => polygonCenter(fieldEditPolygonPoints.value))

const fieldEditMapCenter = computed(() => {
  if (editForm.value.geometry_mode === 'polygon' && fieldEditPolygonCenter.value) return fieldEditPolygonCenter.value
  return parseLatLonFromGeolocationString(editForm.value.geolocation) ?? { lat: 55.7558, lon: 37.6176 }
})

const selectedLandContourMarkers = computed(() => {
  const landId = field.value?.land_id
  if (!landId) return []
  const land = lands.value.find((l) => l.id === landId)
  if (!land || !land.contour_geojson) return []
  const polygonPoints = fromPolygonGeoJson(land.contour_geojson as Record<string, unknown>)
  if (polygonPoints.length < 3) return []
  const center = polygonCenter(polygonPoints)
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

/** Карта в режиме просмотра: при валидной точке или контуре. */
const fieldViewMapCoords = computed(() => {
  if (!field.value) return null
  const contourPoints = fromPolygonGeoJson((field.value as { contour_geojson?: Record<string, unknown> | null }).contour_geojson ?? null)
  if (contourPoints.length >= 3) {
    const center = polygonCenter(contourPoints)
    if (center) return center
  }
  const geo = parseLatLonFromGeolocationString((field.value as { geolocation?: string | null }).geolocation)
  return geo ?? null
})

const responsibleName = computed(() => {
  if (!field.value?.responsible_id) return '—'
  const p = profiles.value.find((x) => x.id === field.value!.responsible_id)
  return p?.display_name || p?.email || '—'
})

const cropLabel = computed(() => {
  if (!field.value?.crop_key) return '—'
  const c = crops.value.find((x) => x.key === field.value!.crop_key)
  return c?.label || field.value?.crop_key || '—'
})

const displayFieldNumber = computed(() => {
  const name = field.value?.name ?? ''
  const match = name.match(/№\s*(\d+)/)
  if (match?.[1]) return match[1]
  return field.value?.number != null ? String(field.value.number) : '—'
})

const createdFormatted = computed(() => {
  const raw = field.value?.created_at
  if (!raw) return '—'
  return new Date(raw).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
})

const updatedFormatted = computed(() => {
  const raw = field.value?.updated_at
  if (!raw) return '—'
  return new Date(raw).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
})

const historyTotalFiltered = computed(() => historyTotal.value)
const historyTotalPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / historyPageSize.value)))
const historyPaginationStart = computed(() =>
  historyTotal.value ? (historyPage.value - 1) * historyPageSize.value + 1 : 0,
)
const historyPaginationEnd = computed(() =>
  Math.min(historyPage.value * historyPageSize.value, historyTotal.value),
)
const paginatedHistory = computed(() => history.value)
const historyPageNumbers = computed(() => {
  const total = historyTotalPages.value
  const current = historyPage.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages: (number | 'ellipsis')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  if (start > 2) pages.push('ellipsis')
  for (let p = start; p <= end; p += 1) pages.push(p)
  if (end < total - 1) pages.push('ellipsis')
  pages.push(total)
  return pages
})

function goHistoryPage(page: number) {
  historyPage.value = Math.max(1, Math.min(page, historyTotalPages.value))
}

watch(historyPageSize, () => {
  historyPage.value = 1
  void refreshHistory()
})

watch(historyTotal, () => {
  if (historyPage.value > historyTotalPages.value) historyPage.value = Math.max(1, historyTotalPages.value)
})

watch(historyPage, () => {
  void refreshHistory()
})

function formatHistoryDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatHistoryTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Главное изображение: последнее фото или схема поля */
const mainMedia = computed(() => {
  const f = field.value
  if (photos.value.length > 0) {
    const p = photos.value[0]
    return {
      url: p.file_url,
      title: p.title || 'Фото поля',
      description: p.description || '',
      date: p.created_at,
      isPhoto: true,
    }
  }
  if (f?.scheme_file_url) {
    return {
      url: f.scheme_file_url,
      title: 'Схема / NDVI',
      description: 'Схема поля',
      date: f.updated_at,
      isPhoto: false,
    }
  }
  return null
})

/** Галерея: фото + карточка схемы (если есть) */
const galleryItems = computed(() => {
  const items: { url: string; title: string; id: string; isScheme?: boolean }[] = photos.value
    .slice(0, 8)
    .map((p) => ({
      url: p.file_url,
      title: p.title || 'Фото',
      id: p.id,
    }))
  if (field.value?.scheme_file_url && !items.some((i) => i.url === field.value!.scheme_file_url)) {
    items.push({
      url: field.value.scheme_file_url,
      title: 'Схема / NDVI',
      id: 'scheme',
      isScheme: true,
    })
  }
  return items
})

async function loadData() {
  if (!props.id || !isSupabaseConfigured()) {
    if (!isSupabaseConfigured()) error.value = 'База данных не настроена'
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const [fieldData, profileList, cropList, landTypesList, photosList, landsList, municipalityRefsList] = await Promise.all([
      getFieldById(props.id),
      loadProfiles(),
      loadCrops(),
      loadLandTypes(),
      loadFieldPhotos(props.id),
      loadLands(),
      loadFieldMunicipalitiesRefs(),
    ])
    field.value = fieldData
    profiles.value = profileList
    crops.value = cropList
    landTypes.value = landTypesList
    lands.value = landsList
    fieldMunicipalityRefs.value = municipalityRefsList
    photos.value = photosList
    if (!fieldData) error.value = 'Поле не найдено'
    await refreshHistory()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки'
  } finally {
    loading.value = false
  }
}

async function refreshHistory() {
  if (!props.id || !isSupabaseConfigured()) return
  historyLoading.value = true
  try {
    const onlyMine = !isManager.value
    const userId = auth.user.value?.id ?? null
    const page = await loadOperationsByFieldFromSupabase(props.id, onlyMine, userId, historyPage.value, historyPageSize.value)
    history.value = page.rows
    historyTotal.value = page.total
  } catch {
    history.value = []
    historyTotal.value = 0
  } finally {
    historyLoading.value = false
  }
}

function goBack() {
  router.push({ name: 'fields' })
}

function startEditing() {
  if (!field.value) return
  fieldMapAddressLoading.value = false
  fieldMapAddressError.value = ''
  editForm.value = {
    name: field.value.name,
    area: Number(field.value.area),
    cadastral_number: field.value.cadastral_number ?? '',
    efis_zsn_number: (field.value as { efis_zsn_number?: string | null }).efis_zsn_number ?? '',
    address: (field.value as { address?: string | null }).address ?? '',
    location_description: field.value.location_description ?? '',
    extra_info: (field.value as { extra_info?: string | null }).extra_info ?? '',
    geolocation: (field.value as { geolocation?: string | null }).geolocation ?? '',
    municipality: (field.value as { municipality?: string | null }).municipality ?? '',
    region: (field.value as { region?: string | null }).region ?? '',
    geometry_mode: (field.value as { geometry_mode?: 'point' | 'polygon' | null }).geometry_mode ?? 'point',
    contour_geojson: (field.value as { contour_geojson?: Record<string, unknown> | null }).contour_geojson ?? null,
    land_type: field.value.land_type,
    sowing_year: field.value.sowing_year ?? new Date().getFullYear(),
    responsible_id: field.value.responsible_id ?? '',
    crop_key: field.value.crop_key,
    scheme_file_url: field.value.scheme_file_url ?? '',
  }
  saveError.value = null
  editContourDraftPoints.value = fromPolygonGeoJson(editForm.value.contour_geojson)
  editAddressCandidates.value = editForm.value.address.trim() ? [editForm.value.address.trim()] : []
  selectedEditAddressCandidate.value = editAddressCandidates.value[0] || ''
  editAddressCandidatesLoading.value = false
  editAddressManualTouched.value = false
  editAddressLastAuto.value = editForm.value.address.trim()
  editFieldAreaAuto.value = null
  editFieldAreaManualTouched.value = false
  isEditing.value = true
}

function cancelEditing() {
  isEditing.value = false
  saveError.value = null
  fieldMapAddressLoading.value = false
  fieldMapAddressError.value = ''
  editAddressCandidates.value = []
  selectedEditAddressCandidate.value = ''
  editAddressCandidatesLoading.value = false
  editAddressManualTouched.value = false
  editAddressLastAuto.value = ''
  editFieldAreaAuto.value = null
  editFieldAreaManualTouched.value = false
  editContourDraftPoints.value = []
}

async function onPickFieldDetailsMap(coords: { lat: number; lon: number }) {
  editForm.value.geometry_mode = 'point'
  editForm.value.contour_geojson = null
  editFieldAreaAuto.value = null
  editFieldAreaManualTouched.value = false
  const lat = Number(coords.lat.toFixed(6))
  const lon = Number(coords.lon.toFixed(6))
  editForm.value.geolocation = `${lat}, ${lon}`
  fieldMapAddressError.value = ''
  fieldMapAddressLoading.value = true
  editAddressCandidatesLoading.value = false
  try {
    const address = await resolveYandexAddressLine(lat, lon)
    if (address) {
      applyEditAddressCandidates([address])
    } else {
      fieldMapAddressError.value = 'Не удалось определить адрес по выбранной точке.'
    }
  } finally {
    fieldMapAddressLoading.value = false
  }
}

function setEditGeometryMode(mode: 'point' | 'polygon') {
  editForm.value.geometry_mode = mode
  fieldMapAddressError.value = ''
  if (mode === 'point') {
    editForm.value.contour_geojson = null
    editContourDraftPoints.value = []
    editAddressCandidates.value = editForm.value.address.trim() ? [editForm.value.address.trim()] : []
    selectedEditAddressCandidate.value = editAddressCandidates.value[0] || ''
    editAddressCandidatesLoading.value = false
    editFieldAreaAuto.value = null
    editFieldAreaManualTouched.value = false
  } else {
    editFieldAreaManualTouched.value = false
  }
}

function onEditAreaInput() {
  if (editForm.value.geometry_mode === 'polygon') editFieldAreaManualTouched.value = true
}

function onPickFieldDetailsPolygon(payload: { points: LatLon[]; areaHa: number; center: { lat: number; lon: number } | null }) {
  editContourDraftPoints.value = payload.points
  const geojson = toPolygonGeoJson(payload.points)
  editForm.value.contour_geojson = geojson
  if (geojson) {
    editForm.value.geometry_mode = 'polygon'
    if (payload.center) {
      editForm.value.geolocation = `${payload.center.lat.toFixed(6)}, ${payload.center.lon.toFixed(6)}`
    }
    const rounded = Math.round(Math.max(0, payload.areaHa) * 100) / 100
    editFieldAreaAuto.value = rounded
    if (!editFieldAreaManualTouched.value) editForm.value.area = rounded
    if (payload.points.length >= 3) {
      void suggestEditContourAddresses(payload.points, payload.center)
    }
  } else {
    editFieldAreaAuto.value = null
  }
}

async function saveEditing() {
  if (!field.value || !isSupabaseConfigured()) return
  const name = editForm.value.name.trim()
  if (!name) {
    saveError.value = 'Введите название поля.'
    return
  }
  const area = Number(editForm.value.area)
  if (Number.isNaN(area) || area < 0) {
    saveError.value = 'Укажите корректную площадь.'
    return
  }
  saving.value = true
  saveError.value = null
  try {
    await updateField(field.value.id, {
      name,
      area,
      cadastral_number: editForm.value.cadastral_number.trim() || null,
      efis_zsn_number: editForm.value.efis_zsn_number.trim() || null,
      address: editForm.value.address.trim() || null,
      location_description: editForm.value.location_description.trim() || null,
      extra_info: editForm.value.extra_info.trim() || null,
      geolocation: editForm.value.geolocation.trim() || null,
      municipality: editForm.value.municipality.trim() || null,
      region: editForm.value.region.trim() || null,
      geometry_mode: editForm.value.geometry_mode,
      contour_geojson: editForm.value.geometry_mode === 'polygon' ? toPolygonGeoJson(editContourDraftPoints.value) : null,
      land_type: editForm.value.land_type,
      sowing_year: editForm.value.sowing_year || null,
      responsible_id: editForm.value.responsible_id.trim() || null,
      crop_key: editForm.value.crop_key,
      scheme_file_url: editForm.value.scheme_file_url.trim() || null,
    })
    await loadData()
    isEditing.value = false
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Не удалось сохранить'
  } finally {
    saving.value = false
  }
}

function triggerSchemeUpload() {
  schemeFileInput.value?.click()
}

async function onSchemeFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !props.id || !isSupabaseConfigured()) return
  schemeUploading.value = true
  try {
    const url = await uploadFieldScheme(file, props.id)
    editForm.value.scheme_file_url = url
  } catch (err) {
    console.error(err)
    saveError.value = 'Не удалось загрузить схему'
  } finally {
    schemeUploading.value = false
    input.value = ''
  }
}

function clearScheme() {
  editForm.value.scheme_file_url = ''
}

function triggerPhotoUpload() {
  photoFileInput.value?.click()
}

async function onPhotoFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !props.id || !isSupabaseConfigured()) return
  if (!file.type.startsWith('image/')) return
  photoUploading.value = true
  try {
    await addFieldPhoto(props.id, file, file.name.replace(/\.[^.]+$/, ''))
    photos.value = await loadFieldPhotos(props.id)
  } catch (err) {
    console.error(err)
  } finally {
    photoUploading.value = false
    input.value = ''
  }
}

async function removePhoto(id: string) {
  if (!props.id || !isSupabaseConfigured()) return
  if (!confirm('Удалить это фото поля?')) return
  try {
    await deleteFieldPhoto(id)
    photos.value = await loadFieldPhotos(props.id)
  } catch (err) {
    console.error(err)
  }
}

async function removeScheme() {
  if (!field.value || !isSupabaseConfigured()) return
  if (!field.value.scheme_file_url) return
  if (!confirm('Удалить схему поля?')) return
  try {
    await updateField(field.value.id, { scheme_file_url: null })
    await loadData()
  } catch (err) {
    console.error(err)
  }
}

onMounted(loadData)
watch(
  () => props.id,
  () => {
    historyPage.value = 1
    historyTotal.value = 0
    void loadData()
  },
)
</script>

<template>
  <div class="field-details">
    <div class="field-details-header">
      <button type="button" class="field-details-back" @click="goBack" aria-label="Назад к списку полей">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        К списку полей
      </button>
    </div>

    <div v-if="loading" class="field-details-grid">
      <div class="field-details-card field-details-card--left field-details-card--loading">
        <UiLoadingBar size="md" />
      </div>
    </div>

    <div v-else-if="error" class="field-details-card field-details-card--left">
      <p class="field-details-error">{{ error }}</p>
      <button type="button" class="field-details-btn" @click="goBack">Вернуться к списку</button>
    </div>

    <template v-else-if="field">
      <div class="field-details-grid">
        <div class="field-details-card field-details-card--left">
          <div class="field-details-title-row">
            <span class="field-details-title-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
            </span>
            <div class="field-details-title-block">
              <h1 class="field-details-name">{{ isEditing ? editForm.name : field.name }}</h1>
              <p class="field-details-meta">
                № {{ displayFieldNumber }} · {{ isEditing ? editForm.area : field.area }} га
                <span class="field-details-status" v-if="!isEditing">
                  <span class="field-details-status-dot" aria-hidden="true"></span>
                  Активно
                </span>
              </p>
            </div>
            <div class="field-details-actions">
              <button
                type="button"
                class="field-details-edit-btn"
                @click="startEditing"
                aria-label="Редактировать"
                v-if="!isEditing"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                Редактировать
              </button>
            </div>
          </div>

          <template v-if="!isEditing">
            <ul class="field-details-list">
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </span>
                <span class="field-details-item-label">Кадастровый номер</span>
                <span class="field-details-item-value">{{ field.cadastral_number || '—' }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                </span>
                <span class="field-details-item-label">Адрес</span>
                <span class="field-details-item-value">{{ field.address || '—' }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3h6"/><path d="M10 21h4"/><path d="M12 17v4"/><path d="m5 8 7-5 7 5"/><path d="M5 8h14v9H5z"/></svg>
                </span>
                <span class="field-details-item-label">№ ПОЛЯ ЕФИС ЗСН</span>
                <span class="field-details-item-value">{{ (field as any).efis_zsn_number || '—' }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z"/><path d="M12 6v6l3 3"/></svg>
                </span>
                <span class="field-details-item-label">Геолокация</span>
                <span class="field-details-item-value">{{ (field as any).geolocation || '—' }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 10h.01"/><path d="M15 10h.01"/></svg>
                </span>
                <span class="field-details-item-label">Муниципальное образование</span>
                <span class="field-details-item-value">{{ (field as any).municipality || '—' }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="M3 17l9 5 9-5"/></svg>
                </span>
                <span class="field-details-item-label">Регион</span>
                <span class="field-details-item-value">{{ (field as any).region || '—' }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22v-7"/><path d="M12 15a3 3 0 0 0 3-3c0-2-3-5-3-5s-3 3-3 5a3 3 0 0 0 3 3z"/><path d="M4 15s1.5 2 4 2 4-2 4-2"/></svg>
                </span>
                <span class="field-details-item-label">Тип земли</span>
                <span class="field-details-item-value">{{ field.land_type || '—' }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                </span>
                <span class="field-details-item-label">Год посева</span>
                <span class="field-details-item-value">{{ field.sowing_year ?? '—' }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                </span>
                <span class="field-details-item-label">Культура</span>
                <span class="field-details-item-value">{{ cropLabel }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </span>
                <span class="field-details-item-label">Ответственный</span>
                <span class="field-details-item-value field-details-item-value--link">{{ responsibleName }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </span>
                <span class="field-details-item-label">Создано</span>
                <span class="field-details-item-value">{{ createdFormatted }}</span>
              </li>
              <li class="field-details-item">
                <span class="field-details-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </span>
                <span class="field-details-item-label">Обновлено</span>
                <span class="field-details-item-value">{{ updatedFormatted }}</span>
              </li>
            </ul>
            <div
              v-if="field.location_description || (field as any).extra_info"
              class="field-details-notes"
            >
              <div v-if="field.location_description" class="field-details-notes-block">
                <div class="field-details-notes-label">Описание местоположения</div>
                <p class="field-details-notes-text">
                  {{ field.location_description }}
                </p>
              </div>
              <div v-if="(field as any).extra_info" class="field-details-notes-block">
                <div class="field-details-notes-label">Доп. информация</div>
                <p class="field-details-notes-text">
                  {{ (field as any).extra_info }}
                </p>
              </div>
            </div>
            <div v-if="fieldViewMapCoords" class="field-details-view-map">
              <div class="field-details-view-map-head">
                <span class="field-details-view-map-title">Местоположение на карте</span>
                <span class="field-details-view-map-coords" aria-hidden="true">
                  {{ fieldViewMapCoords.lat.toFixed(6) }}, {{ fieldViewMapCoords.lon.toFixed(6) }}
                </span>
              </div>
              <YandexMap
                :key="'field-view-' + field.id"
                :interactive="false"
                :lat="fieldViewMapCoords.lat"
                :lon="fieldViewMapCoords.lon"
                :zoom="14"
                :geometry-mode="((field as any).geometry_mode ?? 'point')"
                :polygon-points="fromPolygonGeoJson((field as any).contour_geojson)"
                :field-markers="selectedLandContourMarkers"
                :fit-field-markers="selectedLandContourMarkers.length > 0"
                :marker-hint="(field.address || '').trim()"
              />
            </div>
          </template>

          <form v-else class="field-details-edit-form" @submit.prevent="saveEditing">
            <p v-if="saveError" class="field-details-save-error">{{ saveError }}</p>
            <div class="field-details-edit-grid">
              <label class="field-details-edit-field field-details-edit-field--full">
                <span class="field-details-edit-label">Название <span class="field-details-edit-required">*</span></span>
                <input v-model="editForm.name" type="text" class="field-details-edit-input" required placeholder="Название поля" />
              </label>
              <label class="field-details-edit-field">
                <span class="field-details-edit-label">Площадь, га <span class="field-details-edit-required">*</span></span>
                <input v-model.number="editForm.area" type="number" class="field-details-edit-input" min="0" step="0.01" required @input="onEditAreaInput" />
                <span v-if="editForm.geometry_mode === 'polygon' && editFieldAreaAuto != null" class="field-details-geometry-area-hint">
                  Авто по контуру: {{ editFieldAreaAuto }} га
                </span>
              </label>
              <label class="field-details-edit-field">
                <span class="field-details-edit-label">Кадастровый номер</span>
                <input v-model="editForm.cadastral_number" type="text" class="field-details-edit-input" placeholder="XX:XX:XXXXXXX:XX" />
              </label>
              <label class="field-details-edit-field field-details-edit-field--full">
                <span class="field-details-edit-label">Адрес</span>
                <input v-model="editForm.address" type="text" class="field-details-edit-input" placeholder="Адрес" @input="onEditAddressInput" />
                <div v-if="editAddressCandidates.length" class="field-details-address-candidates">
                  <span class="field-details-address-candidates-label">Варианты адреса по контуру</span>
                  <select
                    v-model="selectedEditAddressCandidate"
                    class="field-details-edit-select field-details-address-candidates-select"
                    @change="onEditAddressCandidateChange"
                  >
                    <option v-for="addr in editAddressCandidates" :key="addr" :value="addr">{{ addr }}</option>
                  </select>
                </div>
                <p v-if="editAddressCandidatesLoading" class="field-details-map-status">Подбираем адреса по контуру...</p>
              </label>
              <div class="field-details-edit-field field-details-edit-field--full">
                <span class="field-details-edit-label">Карта участка</span>
                <div class="field-details-geometry-head">
                  <span class="field-details-edit-label">Режим геометрии</span>
                  <div class="field-details-geometry-switch" role="group" aria-label="Режим геометрии поля">
                    <button
                      type="button"
                      class="field-details-geometry-switch-btn"
                      :class="{ 'field-details-geometry-switch-btn--active': editForm.geometry_mode === 'point' }"
                      @click="setEditGeometryMode('point')"
                    >
                      Точка
                    </button>
                    <button
                      type="button"
                      class="field-details-geometry-switch-btn"
                      :class="{ 'field-details-geometry-switch-btn--active': editForm.geometry_mode === 'polygon' }"
                      @click="setEditGeometryMode('polygon')"
                    >
                      Контур
                    </button>
                  </div>
                </div>
                <div class="field-details-map-picker">
                  <YandexMap
                    :key="'field-edit-' + (field?.id ?? props.id)"
                    :lat="fieldEditMapCenter.lat"
                    :lon="fieldEditMapCenter.lon"
                    :zoom="12"
                    :geometry-mode="editForm.geometry_mode"
                    :polygon-points="fieldEditPolygonPoints"
                    :field-markers="selectedLandContourMarkers"
                    :fit-field-markers="selectedLandContourMarkers.length > 0"
                    @pick="onPickFieldDetailsMap"
                    @polygonChange="onPickFieldDetailsPolygon"
                  />
                </div>
                <p class="field-details-map-hint">
                  <template v-if="editForm.geometry_mode === 'polygon'">
                    Постройте контур поля на карте. Площадь считается автоматически, но может быть изменена вручную.
                  </template>
                  <template v-else>
                    Нажмите на карту, чтобы заполнить геолокацию и адрес.
                  </template>
                </p>
                <p v-if="fieldMapAddressLoading" class="field-details-map-status">Определяем адрес по координатам...</p>
                <p
                  v-else-if="fieldMapAddressError"
                  class="field-details-map-status field-details-map-status--error"
                >
                  {{ fieldMapAddressError }}
                </p>
              </div>
              <label class="field-details-edit-field field-details-edit-field--full">
                <span class="field-details-edit-label">Описание местоположения</span>
                <textarea v-model="editForm.location_description" class="field-details-edit-textarea" rows="2" placeholder="Описание границ"></textarea>
              </label>
              <label class="field-details-edit-field">
                <span class="field-details-edit-label">Геолокация</span>
                <input v-model="editForm.geolocation" type="text" class="field-details-edit-input" placeholder="Например: 55.7558, 37.6173" />
              </label>
              <label class="field-details-edit-field">
                <span class="field-details-edit-label field-details-edit-label--with-help">
                  Муниципальное образование
                  <RefFieldHelp
                    text="Нет нужного муниципального образования? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'field-refs' } }"
                    link-label="Справочники полей"
                  />
                </span>
                <select v-model="editForm.municipality" class="field-details-edit-select">
                  <option value="">—</option>
                  <option v-for="row in fieldMunicipalityRefs" :key="row.id" :value="row.name">{{ row.name }}</option>
                </select>
              </label>
              <label class="field-details-edit-field">
                <span class="field-details-edit-label">Регион</span>
                <input v-model="editForm.region" type="text" class="field-details-edit-input" placeholder="Например: Ростовская область" />
              </label>
              <label class="field-details-edit-field">
                <span class="field-details-edit-label">№ ПОЛЯ ЕФИС ЗСН</span>
                <input v-model="editForm.efis_zsn_number" type="text" class="field-details-edit-input" placeholder="Например: EFIS-000123" />
              </label>
              <label class="field-details-edit-field">
                <span class="field-details-edit-label field-details-edit-label--with-help">
                  Тип земли
                  <RefFieldHelp
                    text="Нет нужного типа земли? Добавьте его в"
                    :to="{ path: '/lands', query: { tab: 'land-refs' } }"
                    link-label="Справочники земель"
                  />
                </span>
                <select v-model="editForm.land_type" class="field-details-edit-select">
                  <option v-if="editForm.land_type && !landTypes.some((t) => t.name === editForm.land_type)" :value="editForm.land_type">{{ editForm.land_type }}</option>
                  <option v-for="t in landTypes" :key="t.name" :value="t.name">{{ t.name }}</option>
                </select>
              </label>
              <label class="field-details-edit-field">
                <span class="field-details-edit-label field-details-edit-label--with-help">
                  Культура
                  <RefFieldHelp
                    text="Нет нужной культуры? Добавьте ее в"
                    :to="{ path: '/lands', query: { tab: 'crops-refs' } }"
                    link-label="Справочники СХ культур"
                  />
                </span>
                <select v-model="editForm.crop_key" class="field-details-edit-select">
                  <option v-for="c in crops" :key="c.key" :value="c.key">{{ c.label }}</option>
                </select>
              </label>
              <label class="field-details-edit-field">
                <span class="field-details-edit-label">Год посева</span>
                <input v-model.number="editForm.sowing_year" type="number" class="field-details-edit-input" min="2000" :max="new Date().getFullYear() + 2" />
              </label>
              <label class="field-details-edit-field">
                <span class="field-details-edit-label">Ответственный</span>
                <select v-model="editForm.responsible_id" class="field-details-edit-select">
                  <option value="">Не назначен</option>
                  <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.display_name || p.email }}</option>
                </select>
              </label>
              <label class="field-details-edit-field field-details-edit-field--full">
                <span class="field-details-edit-label">Доп. информация</span>
                <textarea
                  v-model="editForm.extra_info"
                  class="field-details-edit-textarea"
                  rows="3"
                  placeholder="Любые заметки о поле, особенностях, рекомендациях и т.п."
                ></textarea>
              </label>
            </div>
            <div class="field-details-edit-scheme">
              <span class="field-details-edit-label">Схема поля</span>
              <input
                ref="schemeFileInput"
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,image/*,application/pdf"
                class="field-details-file-hidden"
                aria-hidden="true"
                @change="onSchemeFileChange"
              />
              <div class="field-details-scheme-row">
                <button type="button" class="field-details-scheme-btn" :disabled="schemeUploading" @click="triggerSchemeUpload">
                  {{ schemeUploading ? 'Загрузка…' : 'Загрузить схему' }}
                </button>
                <UiDeleteButton v-if="editForm.scheme_file_url" size="xs" @click="clearScheme" />
                <span v-if="editForm.scheme_file_url" class="field-details-scheme-hint">Схема прикреплена</span>
              </div>
            </div>
            <div class="field-details-edit-actions">
              <button
                type="button"
                class="field-details-cancel-btn"
                @click="cancelEditing"
              >
                Отмена
              </button>
              <button
                type="submit"
                class="field-details-save-btn"
                :disabled="saving"
              >
                {{ saving ? 'Сохранение…' : 'Сохранить' }}
              </button>
            </div>
          </form>
        </div>

        <div class="field-details-card field-details-card--right">
          <div class="field-details-media-header">
            <div>
              <h2 class="field-details-media-title">Медиафайлы и схемы поля</h2>
              <p class="field-details-media-subtitle">Фотографии состояния посевов и спутниковые снимки</p>
            </div>
            <input
              ref="photoFileInput"
              type="file"
              accept="image/*"
              class="field-details-file-hidden"
              aria-hidden="true"
              @change="onPhotoFileChange"
            />
            <button
              type="button"
              class="field-details-upload-btn"
              :disabled="photoUploading"
              @click="triggerPhotoUpload"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
              {{ photoUploading ? 'Загрузка…' : 'Загрузить фото' }}
            </button>
          </div>

          <div class="field-details-main-media">
            <template v-if="mainMedia">
              <div class="field-details-main-media-label">
                {{ mainMedia.title }}
                <span class="field-details-main-media-badge" v-if="mainMedia.isPhoto">
                  <span class="field-details-status-dot"></span>
                  Последнее фото
                </span>
              </div>
              <div class="field-details-main-media-frame">
                <img
                  v-if="mainMedia.isPhoto || /\.(jpe?g|png|gif|webp)$/i.test(mainMedia.url)"
                  :src="mainMedia.url"
                  :alt="mainMedia.title"
                  class="field-details-main-media-img"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
                <a
                  v-else
                  :href="mainMedia.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="field-details-main-media-link"
                >
                  Открыть схему
                </a>
              </div>
              <p class="field-details-main-media-desc">{{ mainMedia.description || '—' }}</p>
              <p class="field-details-main-media-date">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                {{ mainMedia.date ? new Date(mainMedia.date).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—' }}
              </p>
            </template>
            <template v-else>
              <div class="field-details-main-media-label">Нет фото и схем</div>
              <div class="field-details-main-media-placeholder">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
                <span>Загрузите фото или прикрепите схему в карточке поля</span>
              </div>
            </template>
          </div>

          <div v-if="galleryItems.length > 0" class="field-details-gallery">
            <div
              v-for="item in galleryItems"
              :key="item.id"
              class="field-details-gallery-item"
            >
              <a
                v-if="item.isScheme && !/\.(jpe?g|png|gif|webp)$/i.test(item.url)"
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer"
                class="field-details-gallery-thumb field-details-gallery-thumb--link"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span class="field-details-gallery-title">{{ item.title }}</span>
                <div class="field-details-gallery-delete-wrap">
                  <UiDeleteButton size="xs" @click.prevent="removeScheme" />
                </div>
              </a>
              <div v-else class="field-details-gallery-thumb">
                <img
                  :src="item.url"
                  :alt="item.title"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
                />
                <span class="field-details-gallery-title">{{ item.title }}</span>
                <div class="field-details-gallery-delete-wrap">
                  <UiDeleteButton size="xs" @click="item.isScheme ? removeScheme() : removePhoto(item.id)" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section class="field-details-card field-history-section">
        <div class="field-details-media-header">
          <div>
            <h2 class="field-details-media-title">История взаимодействия с полем</h2>
            <p class="field-details-media-subtitle">
              <template v-if="historyLoading">
                <UiLoadingBar size="compact" />
              </template>
              <template v-else>Записей: {{ history.length }}</template>
            </p>
          </div>
        </div>

        <div v-if="historyLoading" class="field-history-loading-wrap">
          <UiLoadingBar size="md" />
        </div>
        <div v-else-if="!history.length" class="field-details-muted">
          По этому полю пока нет зафиксированных взаимодействий.
        </div>
        <template v-else>
          <ul class="field-history-list">
            <li v-for="h in paginatedHistory" :key="h.id" class="field-history-item">
              <div class="field-history-head">
                <div class="field-history-title-wrap">
                  <span class="field-history-op-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 22v-7" />
                      <path d="M12 15a3 3 0 0 0 3-3c0-2-3-5-3-5s-3 3-3 5a3 3 0 0 0 3 3z" />
                      <path d="M4 15s1.5 2 4 2 4-2 4-2" />
                    </svg>
                  </span>
                  <div>
                    <div class="field-history-title">{{ h.operation || 'Операция' }}</div>
                    <div class="field-history-meta">{{ formatHistoryDate(h.startISO) }} • {{ formatHistoryTime(h.startISO) }}</div>
                  </div>
                </div>
                <div class="field-history-duration">Длительность: {{ h.durationMinutes }} мин</div>
              </div>

              <div class="field-history-grid">
                <div class="field-history-cell">
                  <span class="field-history-label">Кто</span>
                  <span class="field-history-value">{{ h.employee || '—' }}</span>
                </div>
                <div class="field-history-cell">
                  <span class="field-history-label">Когда</span>
                  <span class="field-history-value">{{ formatHistoryDate(h.startISO) }}</span>
                </div>
                <div class="field-history-cell">
                  <span class="field-history-label">Во сколько</span>
                  <span class="field-history-value">{{ formatHistoryTime(h.startISO) }}</span>
                </div>
                <div class="field-history-cell">
                  <span class="field-history-label">Техника</span>
                  <RouterLink
                    v-if="h.equipmentId"
                    class="field-history-eq-link"
                    :to="{ name: 'equipment-details', params: { id: h.equipmentId } }"
                  >
                    {{ h.equipmentLabel || 'Открыть технику' }}
                  </RouterLink>
                  <span v-else class="field-history-value">Не указана</span>
                </div>
                <div class="field-history-cell">
                  <span class="field-history-label">Обработано, Га</span>
                  <span class="field-history-value">{{ h.processedHectares ?? '—' }}</span>
                </div>
                <div class="field-history-cell field-history-cell--full">
                  <span class="field-history-label">Список дел после выполнения</span>
                  <span class="field-history-value field-history-value--multiline">{{ h.notes || '—' }}</span>
                </div>
              </div>
            </li>
          </ul>

          <div v-if="historyTotalFiltered > 0" class="field-history-pagination">
            <span class="field-history-pagination-info">
              Показано {{ historyPaginationStart }}–{{ historyPaginationEnd }} из {{ historyTotalFiltered }}
            </span>
            <div class="field-history-pagination-right">
              <div class="field-history-pagination-nav">
                <button
                  type="button"
                  class="field-history-pagination-arrow"
                  :disabled="historyPage <= 1"
                  aria-label="Предыдущая страница"
                  @click="historyPage = historyPage - 1"
                >
                  &lt;
                </button>
                <template v-for="(p, i) in historyPageNumbers" :key="p === 'ellipsis' ? `e-${i}` : p">
                  <button
                    v-if="p !== 'ellipsis'"
                    type="button"
                    class="field-history-pagination-num"
                    :class="{ 'field-history-pagination-num--active': p === historyPage }"
                    @click="goHistoryPage(p)"
                  >
                    {{ p }}
                  </button>
                  <span v-else class="field-history-pagination-ellipsis">…</span>
                </template>
                <button
                  type="button"
                  class="field-history-pagination-arrow"
                  :disabled="historyPage >= historyTotalPages"
                  aria-label="Следующая страница"
                  @click="historyPage = historyPage + 1"
                >
                  &gt;
                </button>
              </div>
              <label class="field-history-pagination-size">
                <span class="field-history-pagination-size-label">На странице</span>
                <select v-model.number="historyPageSize" class="field-history-pagination-select">
                  <option :value="5">5</option>
                  <option :value="10">10</option>
                  <option :value="20">20</option>
                  <option :value="50">50</option>
                </select>
              </label>
            </div>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.field-details {
  padding-bottom: 24px;
}
.field-details-header {
  margin-bottom: 20px;
}
.field-details-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 0.95rem;
  cursor: pointer;
  transition: color 0.2s;
}
.field-details-back:hover {
  color: var(--text-primary);
}

.field-details-grid {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 24px;
  align-items: start;
}
@media (max-width: 900px) {
  .field-details-grid {
    grid-template-columns: 1fr;
  }
}

.field-details-card {
  background: var(--bg-panel);
  border-radius: 12px;
  border: 1px solid var(--topbar-border);
  box-shadow: var(--shadow-card);
  padding: 24px;
}
.field-details-card--left {
  min-width: 0;
}
.field-details-card--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
}
.field-details-card--right {
  min-width: 0;
}

.field-details-title-row {
  display: flex;
  gap: 14px;
  margin-bottom: 24px;
  align-items: flex-start;
}
.field-details-title-block {
  flex: 1;
  min-width: 0;
}
.field-details-actions {
  flex-shrink: 0;
}
.field-details-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--topbar-border);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
.field-details-edit-btn:hover {
  background: var(--bg-panel);
  border-color: var(--text-secondary);
}
.field-details-edit-form {
  margin-top: 4px;
}
.field-details-save-error {
  color: var(--danger);
  font-size: 0.875rem;
  margin: 0 0 12px;
}
.field-details-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  margin-bottom: 16px;
}
.field-details-edit-field--full {
  grid-column: 1 / -1;
}
.field-details-edit-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-details-map-picker {
  border: 1px solid var(--topbar-border);
  border-radius: 10px;
  overflow: hidden;
}
.field-details-map-picker :deep(.ymap-container) {
  height: 280px;
}
.field-details-map-hint {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.field-details-geometry-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.field-details-geometry-switch {
  display: inline-flex;
  border: 1px solid var(--topbar-border);
  border-radius: 9px;
  overflow: hidden;
}
.field-details-geometry-switch-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  padding: 7px 12px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.field-details-geometry-switch-btn + .field-details-geometry-switch-btn {
  border-left: 1px solid var(--topbar-border);
}
.field-details-geometry-switch-btn--active {
  background: color-mix(in srgb, var(--accent-green) 14%, transparent);
  color: var(--accent-green);
}
.field-details-geometry-area-hint {
  margin-top: 4px;
  font-size: 0.72rem;
  color: var(--text-secondary);
}
.field-details-map-status {
  margin: 6px 0 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.field-details-map-status--error {
  color: var(--warning-orange, #d97706);
}
.field-details-address-candidates {
  margin-top: 8px;
  display: grid;
  gap: 4px;
}
.field-details-address-candidates-label {
  font-size: 0.76rem;
  color: var(--text-secondary);
}
.field-details-address-candidates-select {
  width: 100%;
}
.field-details-view-map {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--topbar-border);
}
.field-details-view-map-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.field-details-view-map-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.field-details-view-map-coords {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.field-details-view-map :deep(.ymap-container) {
  height: 280px;
}
.field-details-edit-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
}
.field-details-edit-label--with-help {
  display: inline-flex;
  align-items: center;
}
.field-details-edit-required {
  color: var(--danger);
}
.field-details-edit-input,
.field-details-edit-textarea,
.field-details-edit-select {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--topbar-border);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: inherit;
}
.field-details-edit-textarea {
  resize: vertical;
  min-height: 56px;
}
.field-details-edit-scheme {
  margin-bottom: 16px;
}
.field-details-edit-scheme .field-details-edit-label {
  display: block;
  margin-bottom: 6px;
}
.field-details-scheme-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.field-details-scheme-btn {
  padding: 8px 14px;
  border-radius: 6px;
  border: 1px solid var(--topbar-border);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
}
.field-details-scheme-btn:hover:not(:disabled) {
  background: var(--bg-panel);
}
.field-details-scheme-btn:disabled {
  opacity: 0.7;
}
.field-details-scheme-hint {
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.field-details-edit-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.field-details-cancel-btn {
  padding: 10px 18px;
  border-radius: 8px;
  border: 1px solid var(--topbar-border);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
}
.field-details-cancel-btn:hover {
  background: var(--bg-panel);
}
.field-details-save-btn {
  padding: 10px 18px;
  border-radius: 8px;
  border: none;
  background: var(--accent-green);
  color: #ffffff;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
}
.field-details-save-btn:hover:not(:disabled) {
  background: var(--accent-green-hover);
}
.field-details-save-btn:hover:not(:disabled) {
  opacity: 0.95;
}
.field-details-save-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.field-details-cancel-btn--compact,
.field-details-save-btn--compact {
  padding: 6px 12px;
  font-size: 0.8rem;
}
.field-details-title-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
  color: #2e7d32;
  display: flex;
  align-items: center;
  justify-content: center;
}
[data-theme='dark'] .field-details-title-icon {
  background: linear-gradient(135deg, #1b3d1f 0%, #2e5c32 100%);
  color: #81c784;
}
.field-details-name {
  margin: 0 0 4px;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}
.field-details-meta {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}
.field-details-status {
  margin-left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.field-details-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
}
.field-details-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field-details-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: start;
  font-size: 0.9rem;
}
.field-details-item-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
  margin-top: 2px;
}
.field-details-item-label {
  color: var(--text-secondary);
  font-weight: 500;
}
.field-details-item-value {
  color: var(--text-primary);
  text-align: right;
  word-break: break-word;
}
.field-details-item-value--link {
  color: #16a34a;
}
[data-theme='dark'] .field-details-item-value--link {
  color: #4ade80;
}

.field-details-muted {
  color: var(--text-secondary);
  margin: 0;
}
.field-details-notes {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed var(--topbar-border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field-details-notes-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.field-details-notes-text {
  margin: 4px 0 0;
  font-size: 0.9rem;
  color: var(--text-primary);
  white-space: pre-wrap;
}
.field-details-error {
  color: var(--danger);
  margin: 0 0 16px;
}
.field-details-btn {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  background: var(--primary);
  color: white;
  font-weight: 500;
  cursor: pointer;
}

.field-details-media-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.field-details-media-title {
  margin: 0 0 4px;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
}
.field-details-media-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.field-details-file-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.field-details-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid var(--topbar-border);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, transform 0.2s ease, box-shadow 0.2s ease;
}
.field-details-upload-btn:hover:not(:disabled) {
  background: var(--bg-panel);
  border-color: var(--text-secondary);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(45, 90, 61, 0.14);
}
.field-details-upload-btn svg {
  transition: transform 0.22s ease;
}
.field-details-upload-btn:hover:not(:disabled) svg {
  animation: field-details-upload-hover 0.65s ease;
}
@keyframes field-details-upload-hover {
  0% { transform: translateY(0); }
  40% { transform: translateY(-2px); }
  100% { transform: translateY(0); }
}
.field-details-upload-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.field-details-main-media {
  margin-bottom: 24px;
}
.field-details-main-media-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.field-details-main-media-badge {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.field-details-main-media-frame {
  width: 100%;
  aspect-ratio: 16/10;
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-base);
  border: 1px solid var(--topbar-border);
  display: flex;
  align-items: center;
  justify-content: center;
}
.field-details-main-media-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.field-details-main-media-link {
  padding: 16px;
  color: var(--primary);
  text-decoration: underline;
}
.field-details-main-media-placeholder {
  width: 100%;
  aspect-ratio: 16/10;
  border-radius: 10px;
  border: 1px dashed var(--topbar-border);
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}
.field-details-main-media-placeholder svg {
  opacity: 0.5;
}
.field-details-main-media-desc {
  margin: 8px 0 4px;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.field-details-main-media-date {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.field-details-gallery {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 600px) {
  .field-details-gallery {
    grid-template-columns: repeat(2, 1fr);
  }
}
.field-details-gallery-item {
  min-width: 0;
}
.field-details-gallery-thumb {
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-base);
  border: 1px solid var(--topbar-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}
.field-details-gallery-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: absolute;
  inset: 0;
}
.field-details-gallery-thumb--link {
  text-decoration: none;
  color: var(--text-secondary);
  transition: background 0.2s;
}
.field-details-gallery-thumb--link:hover {
  background: var(--bg-panel);
}
.field-details-gallery-thumb--link svg {
  flex-shrink: 0;
  margin-bottom: 4px;
}
.field-details-gallery-title {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 6px 8px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-primary);
  background: linear-gradient(to top, rgba(0,0,0,0.6), transparent);
  color: #fff;
}
.field-details-gallery-thumb--link .field-details-gallery-title {
  position: static;
  background: none;
  color: inherit;
  padding: 4px 0 0;
}

.field-details-gallery-delete-wrap {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
}

.field-history-section {
  margin-top: 24px;
}

.field-history-loading-wrap {
  display: flex;
  justify-content: center;
  padding: 12px 0 8px;
}

.field-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-history-item {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-panel);
  padding: 12px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.field-history-item:hover {
  border-color: rgba(15, 23, 42, 0.12);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.05);
}

.field-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.field-history-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.field-history-op-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(34, 197, 94, 0.2);
  color: #16a34a;
}

.field-history-title {
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--text-primary);
}

.field-history-meta {
  margin-top: 2px;
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.field-history-duration {
  font-size: 0.8rem;
  font-weight: 800;
  color: var(--text-secondary);
  white-space: nowrap;
}

.field-history-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}

.field-history-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field-history-cell--full {
  grid-column: 1 / -1;
}

.field-history-label {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.field-history-value {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-word;
}

.field-history-value--multiline {
  white-space: pre-wrap;
}

.field-history-eq-link {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(76, 175, 80, 0.5);
  background: rgba(76, 175, 80, 0.15);
  color: var(--text-primary);
  font-size: 0.82rem;
  font-weight: 700;
  text-decoration: none;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.field-history-eq-link:hover {
  background: rgba(76, 175, 80, 0.22);
}

.field-history-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-md);
  padding: var(--space-md) 0 0;
  border-top: 1px solid var(--border-color);
}

.field-history-pagination-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.field-history-pagination-right {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  flex-wrap: wrap;
}

.field-history-pagination-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.field-history-pagination-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 1rem;
  cursor: pointer;
}

.field-history-pagination-arrow:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.field-history-pagination-num {
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
  cursor: pointer;
}

.field-history-pagination-num--active {
  background: rgba(76, 175, 80, 0.15);
  border-color: rgba(76, 175, 80, 0.5);
}

.field-history-pagination-ellipsis {
  min-width: 28px;
  text-align: center;
  color: var(--text-secondary);
}

.field-history-pagination-size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.field-history-pagination-select {
  min-width: 72px;
  height: 36px;
  padding: 0 28px 0 10px;
  border-radius: 8px;
  font-size: 0.875rem;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
  color: var(--text-primary);
}

@media (max-width: 900px) {
  .field-history-grid {
    grid-template-columns: 1fr;
  }
  .field-history-head {
    flex-wrap: wrap;
    align-items: flex-start;
  }
}

@media (max-width: 640px) {
  .field-history-pagination {
    flex-direction: column;
    align-items: stretch;
  }
  .field-history-pagination-right {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .field-history-pagination-nav {
    justify-content: center;
    flex-wrap: wrap;
  }
  .field-history-pagination-size {
    justify-content: space-between;
  }
}
</style>
