<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'

export type MapFieldMarker = {
  id: string
  lat: number
  lon: number
  title: string
  subtitle?: string
  geometryMode?: GeometryMode
  polygonPoints?: LatLon[]
  interactive?: boolean
  polygonStrokeColor?: string
  polygonFillColor?: string
  centerPreset?: string
}

type GeometryMode = 'point' | 'polygon'
type LatLon = [number, number]

const props = withDefaults(
  defineProps<{
    lat?: number
    lon?: number
    zoom?: number
    interactive?: boolean
    markerHint?: string
    fieldMarkers?: MapFieldMarker[]
    fitFieldMarkers?: boolean
    overlayHint?: boolean
    geometryMode?: GeometryMode
    polygonPoints?: LatLon[]
    geometryStrokeColor?: string
    geometryFillColor?: string
    geometryMarkerPreset?: string
  }>(),
  {
    lat: 55.7558,
    lon: 37.6176,
    zoom: 10,
    interactive: true,
    markerHint: '',
    fieldMarkers: () => [],
    fitFieldMarkers: false,
    overlayHint: false,
    geometryMode: 'point',
    polygonPoints: () => [],
    geometryStrokeColor: '#16a34a',
    geometryFillColor: 'rgba(22, 163, 74, 0.22)',
    geometryMarkerPreset: 'islands#redDotIcon',
  },
)

const emit = defineEmits<{
  (e: 'pick', coords: { lat: number; lon: number }): void
  (e: 'polygonChange', payload: { points: LatLon[]; areaHa: number; center: { lat: number; lon: number } | null }): void
}>()

const mapEl = ref<HTMLDivElement | null>(null)
const isPolygonDrawing = ref(false)
let mapInstance: any = null
let placemark: any = null
let polygonObject: any = null
let polylineObject: any = null
let ymaps: any = null
let searchControl: any = null
let mapClickHandler: ((e: any) => void) | null = null
let mapMouseMoveHandler: ((e: any) => void) | null = null
const draftPolygonPoints = ref<LatLon[]>([])
const hoverPolygonPoint = ref<LatLon | null>(null)
const fieldPlacemarks: any[] = []
const fieldPolygons: any[] = []

const isPolygonMode = computed(() => props.geometryMode === 'polygon')

function clearFieldPlacemarks() {
  if (!mapInstance) return
  for (const m of fieldPlacemarks) {
    try {
      mapInstance.geoObjects.remove(m)
    } catch {
      /* noop */
    }
  }
  fieldPlacemarks.length = 0
  for (const p of fieldPolygons) {
    try {
      mapInstance.geoObjects.remove(p)
    } catch {
      /* noop */
    }
  }
  fieldPolygons.length = 0
}

function syncFieldPlacemarks() {
  if (!mapInstance || !ymaps) return
  clearFieldPlacemarks()
  for (const p of props.fieldMarkers) {
    if (p.geometryMode === 'polygon' && Array.isArray(p.polygonPoints) && p.polygonPoints.length >= 3) {
      const markerInteractive = p.interactive !== false
      const poly = new ymaps.Polygon(
        [p.polygonPoints],
        {
          balloonContentHeader: p.title,
          balloonContentBody: p.subtitle || '',
          hintContent: p.title,
        },
        {
          fillColor: p.polygonFillColor ?? 'rgba(22, 163, 74, 0.22)',
          strokeColor: p.polygonStrokeColor ?? '#16a34a',
          strokeWidth: 2,
          draggable: false,
          interactivityModel: markerInteractive ? 'default#geoObject' : 'default#transparent',
        },
      )
      mapInstance.geoObjects.add(poly)
      fieldPolygons.push(poly)
      const centerMarker = new ymaps.Placemark(
        [p.lat, p.lon],
        {
          balloonContentHeader: p.title,
          balloonContentBody: p.subtitle || '',
          hintContent: p.title,
        },
        {
          preset: p.centerPreset ?? 'islands#darkGreenCircleDotIcon',
          draggable: false,
          interactivityModel: markerInteractive ? 'default#geoObject' : 'default#transparent',
        },
      )
      mapInstance.geoObjects.add(centerMarker)
      fieldPlacemarks.push(centerMarker)
      continue
    }
    const pm = new ymaps.Placemark(
      [p.lat, p.lon],
      {
        balloonContentHeader: p.title,
        balloonContentBody: p.subtitle || '',
        hintContent: p.title,
      },
      {
        preset: 'islands#darkGreenDotIcon',
        draggable: false,
      },
    )
    mapInstance.geoObjects.add(pm)
    fieldPlacemarks.push(pm)
  }
}

function areaHaFromPolygon(points: LatLon[]): number {
  if (points.length < 3) return 0
  const R = 6378137
  const avgLatRad = points.reduce((s, p) => s + (p[0] * Math.PI) / 180, 0) / points.length
  const toXY = (p: LatLon): [number, number] => {
    const latRad = (p[0] * Math.PI) / 180
    const lonRad = (p[1] * Math.PI) / 180
    return [R * lonRad * Math.cos(avgLatRad), R * latRad]
  }
  const xy = points.map(toXY)
  let area = 0
  for (let i = 0; i < xy.length; i += 1) {
    const [x1, y1] = xy[i]!
    const [x2, y2] = xy[(i + 1) % xy.length]!
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area) / 2 / 10000
}

function polygonCenter(points: LatLon[]): { lat: number; lon: number } | null {
  if (!points.length) return null
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length
  const lon = points.reduce((s, p) => s + p[1], 0) / points.length
  return { lat, lon }
}

function emitPolygonChange() {
  const points = draftPolygonPoints.value
  emit('polygonChange', {
    points,
    areaHa: areaHaFromPolygon(points),
    center: polygonCenter(points),
  })
}

function ensurePolygonObject() {
  if (!mapInstance || !ymaps) return
  if (draftPolygonPoints.value.length < 3) {
    removePolygonObject()
    return
  }
  if (!polygonObject) {
    polygonObject = new ymaps.Polygon(
      [draftPolygonPoints.value],
      {},
      {
          fillColor: props.geometryFillColor,
          strokeColor: props.geometryStrokeColor,
        strokeWidth: 2,
        interactivityModel: 'default#transparent',
      },
    )
    mapInstance.geoObjects.add(polygonObject)
  } else {
    polygonObject.geometry.setCoordinates([draftPolygonPoints.value])
  }
}

function removePolygonObject() {
  if (!mapInstance || !polygonObject) return
  try {
    mapInstance.geoObjects.remove(polygonObject)
  } catch {
    /* noop */
  }
  polygonObject = null
}

function ensurePolylineObject() {
  if (!mapInstance || !ymaps) return
  const base = draftPolygonPoints.value
  const withHover = hoverPolygonPoint.value && isPolygonDrawing.value ? [...base, hoverPolygonPoint.value] : base
  if (withHover.length < 2) {
    removePolylineObject()
    return
  }
  if (!polylineObject) {
    polylineObject = new ymaps.Polyline(
      withHover,
      {},
      {
        strokeColor: props.geometryStrokeColor,
        strokeWidth: 2,
        strokeStyle: 'solid',
        opacity: 0.95,
        // Линия не должна перехватывать клики по карте (иначе следующая точка не ставится).
        interactivityModel: 'default#transparent',
      },
    )
    mapInstance.geoObjects.add(polylineObject)
  } else {
    polylineObject.geometry.setCoordinates(withHover)
  }
}

function removePolylineObject() {
  if (!mapInstance || !polylineObject) return
  try {
    mapInstance.geoObjects.remove(polylineObject)
  } catch {
    /* noop */
  }
  polylineObject = null
}

function clearPointMarker() {
  if (!mapInstance || !placemark) return
  try {
    mapInstance.geoObjects.remove(placemark)
  } catch {
    /* noop */
  }
  placemark = null
}

function placeMark(lat: number, lon: number) {
  if (!mapInstance || !ymaps) return
  clearPointMarker()
  const hint = props.markerHint?.trim()
  placemark = new ymaps.Placemark(
    [lat, lon],
    hint ? { hintContent: hint, balloonContent: hint } : {},
    { preset: props.geometryMarkerPreset, draggable: false },
  )
  mapInstance.geoObjects.add(placemark)
}

function startPolygonDrawing() {
  if (!props.interactive || !isPolygonMode.value) return
  isPolygonDrawing.value = true
  if (draftPolygonPoints.value.length >= 3) {
    draftPolygonPoints.value = []
    emitPolygonChange()
  }
  ensurePolygonObject()
}

function finishPolygonDrawing() {
  isPolygonDrawing.value = false
  hoverPolygonPoint.value = null
  ensurePolygonObject()
  removePolylineObject()
  emitPolygonChange()
}

function clearPolygonDrawing() {
  draftPolygonPoints.value = []
  isPolygonDrawing.value = false
  hoverPolygonPoint.value = null
  removePolygonObject()
  removePolylineObject()
  emitPolygonChange()
}

function attachMapEvents() {
  if (!mapInstance || !ymaps) return
  if (searchControl) {
    try {
      mapInstance.controls.remove(searchControl)
    } catch {
      /* noop */
    }
    searchControl = null
  }
  if (mapClickHandler) {
    mapInstance.events.remove('click', mapClickHandler)
    mapClickHandler = null
  }
  if (mapMouseMoveHandler) {
    mapInstance.events.remove('mousemove', mapMouseMoveHandler)
    mapMouseMoveHandler = null
  }
  if (!props.interactive) return

  searchControl = new ymaps.control.SearchControl({
    options: { provider: 'yandex#search', noPlacemark: true },
  })
  mapInstance.controls.add(searchControl)
  searchControl.events.add('resultselect', (e: any) => {
    const index = e.get('index')
    searchControl.getResult(index).then((res: any) => {
      const coords = res.geometry.getCoordinates()
      const [lat, lon] = coords as LatLon
      if (isPolygonMode.value) {
        if (!isPolygonDrawing.value) return
        draftPolygonPoints.value = [...draftPolygonPoints.value, [lat, lon]]
        ensurePolylineObject()
        ensurePolygonObject()
        emitPolygonChange()
      } else {
        emit('pick', { lat, lon })
        placeMark(lat, lon)
      }
    })
  })

  mapClickHandler = (e: any) => {
    const [lat, lon] = e.get('coords') as LatLon
    if (isPolygonMode.value) {
      if (!isPolygonDrawing.value) return
      draftPolygonPoints.value = [...draftPolygonPoints.value, [lat, lon]]
      hoverPolygonPoint.value = [lat, lon]
      ensurePolylineObject()
      ensurePolygonObject()
      emitPolygonChange()
      return
    }
    emit('pick', { lat, lon })
    placeMark(lat, lon)
  }
  mapInstance.events.add('click', mapClickHandler)

  mapMouseMoveHandler = (e: any) => {
    if (!isPolygonMode.value || !isPolygonDrawing.value) return
    if (!draftPolygonPoints.value.length) return
    const [lat, lon] = e.get('coords') as LatLon
    hoverPolygonPoint.value = [lat, lon]
    ensurePolylineObject()
  }
  mapInstance.events.add('mousemove', mapMouseMoveHandler)
}

function applyBoundsOrCenter() {
  if (!mapInstance) return
  const polygonPts = props.polygonPoints ?? []
  if (polygonPts.length >= 3) {
    const lats = polygonPts.map((p) => p[0])
    const lons = polygonPts.map((p) => p[1])
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const latSpan = maxLat - minLat
    const lonSpan = maxLon - minLon
    const span = Math.max(latSpan, lonSpan)
    const pad = span * 0.18 + 0.0015
    mapInstance.setBounds(
      [
        [minLat - pad, minLon - pad],
        [maxLat + pad, maxLon + pad],
      ],
      { checkZoomRange: true, zoomMargin: props.interactive ? 42 : 26 },
    )
    return
  }
  const markers = props.fieldMarkers ?? []
  if (props.fitFieldMarkers && markers.length > 0) {
    const lats: number[] = []
    const lons: number[] = []
    for (const m of markers) {
      if (m.geometryMode === 'polygon' && Array.isArray(m.polygonPoints) && m.polygonPoints.length >= 3) {
        for (const p of m.polygonPoints) {
          lats.push(p[0])
          lons.push(p[1])
        }
      } else {
        lats.push(m.lat)
        lons.push(m.lon)
      }
    }
    if (!lats.length || !lons.length) {
      mapInstance.setCenter([props.lat, props.lon], props.zoom)
      return
    }
    lats.push(props.lat)
    lons.push(props.lon)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const latSpan = maxLat - minLat
    const lonSpan = maxLon - minLon
    const pad = Math.max(latSpan, lonSpan) * 0.12 + 0.008
    if (latSpan < 0.0008 && lonSpan < 0.0008) {
      mapInstance.setCenter([props.lat, props.lon], Math.max(props.zoom, 13))
      return
    }
    mapInstance.setBounds(
      [
        [minLat - pad, minLon - pad],
        [maxLat + pad, maxLon + pad],
      ],
      { checkZoomRange: true, zoomMargin: 56 },
    )
  } else {
    mapInstance.setCenter([props.lat, props.lon], props.zoom)
  }
}

function syncGeometryVisuals() {
  if (!mapInstance || !ymaps) return
  if (isPolygonMode.value) {
    clearPointMarker()
    if (!isPolygonDrawing.value) hoverPolygonPoint.value = null
    ensurePolylineObject()
    ensurePolygonObject()
    try {
      mapInstance.behaviors.disable('dblClickZoom')
    } catch {
      /* noop */
    }
  } else {
    removePolygonObject()
    removePolylineObject()
    hoverPolygonPoint.value = null
    try {
      mapInstance.behaviors.enable('dblClickZoom')
    } catch {
      /* noop */
    }
    if (!props.interactive) placeMark(props.lat, props.lon)
  }
}

async function initMap() {
  if (!mapEl.value) return
  try {
    ymaps = (window as any).ymaps
    if (!ymaps) {
      console.error('ymaps не найден')
      return
    }
    await new Promise<void>((resolve) => ymaps.ready(resolve))
    mapInstance = new ymaps.Map(mapEl.value, {
      center: [props.lat, props.lon],
      zoom: props.zoom,
      controls: ['zoomControl', 'fullscreenControl'],
    })
    attachMapEvents()
    syncFieldPlacemarks()
    syncGeometryVisuals()
    applyBoundsOrCenter()
  } catch (err) {
    console.error('YandexMap init error:', err)
  }
}

watch(
  () => props.polygonPoints,
  (points) => {
    draftPolygonPoints.value = Array.isArray(points) ? points.map((p) => [p[0], p[1]]) : []
    if (mapInstance && isPolygonMode.value) ensurePolygonObject()
  },
  { deep: true, immediate: true },
)

watch(
  [
    () => props.lat,
    () => props.lon,
    () => props.zoom,
    () => props.markerHint,
    () => props.interactive,
    () => props.fitFieldMarkers,
    () => props.fieldMarkers,
    () => props.geometryMode,
  ],
  () => {
    if (!mapInstance) return
    attachMapEvents()
    syncFieldPlacemarks()
    syncGeometryVisuals()
    // Во время контурирования не двигаем/не масштабируем карту от внешних lat/lon,
    // иначе кажется, что карта «прыгает» и мешает рисовать.
    if (!(props.interactive && isPolygonMode.value && isPolygonDrawing.value)) {
      applyBoundsOrCenter()
    }
  },
  { deep: true },
)

onMounted(() => {
  void initMap()
})

onBeforeUnmount(() => {
  clearFieldPlacemarks()
  if (mapInstance && mapClickHandler) {
    mapInstance.events.remove('click', mapClickHandler)
  }
  if (mapInstance && mapMouseMoveHandler) {
    mapInstance.events.remove('mousemove', mapMouseMoveHandler)
  }
  if (mapInstance) {
    try {
      mapInstance.destroy()
    } catch {
      /* noop */
    }
    mapInstance = null
  }
  placemark = null
  polygonObject = null
  polylineObject = null
  mapClickHandler = null
  mapMouseMoveHandler = null
  searchControl = null
})
</script>

<template>
  <div class="ymap-wrapper">
    <div v-if="interactive && geometryMode === 'polygon'" class="ymap-tools">
      <button type="button" class="ymap-tool-btn" :class="{ 'ymap-tool-btn--active': isPolygonDrawing }" @click="startPolygonDrawing">
        {{ isPolygonDrawing ? 'Контур: рисование…' : 'Начать контур' }}
      </button>
      <button type="button" class="ymap-tool-btn" :disabled="!isPolygonDrawing" @click="finishPolygonDrawing">
        Завершить
      </button>
      <button type="button" class="ymap-tool-btn" :disabled="!draftPolygonPoints.length" @click="clearPolygonDrawing">
        Очистить
      </button>
    </div>
    <div ref="mapEl" class="ymap-container" />
    <div v-if="interactive && overlayHint" class="ymap-hint">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      <span class="ymap-hint-text">
        <template v-if="fieldMarkers.length">Зелёные объекты — ваши поля. </template>
        <template v-if="geometryMode === 'polygon'">
          Нажмите «Начать контур», затем кликайте по карте для вершин.
        </template>
        <template v-else>
          Нажмите на карту, чтобы выбрать точку наблюдения (красная метка).
        </template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.ymap-wrapper {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  box-shadow: 0 2px 12px -4px rgba(0, 0, 0, 0.18);
  position: relative;
  background: #e8edf2;
}

.ymap-container {
  width: 100%;
  height: 400px;
}

.ymap-tools {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-color);
}

.ymap-tool-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  border-radius: 8px;
  padding: 5px 9px;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.ymap-tool-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ymap-tool-btn--active {
  border-color: var(--accent-green);
  color: var(--accent-green);
}

.ymap-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100% - 24px);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.78rem;
  padding: 6px 14px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  backdrop-filter: blur(4px);
  z-index: 10;
}

.ymap-hint-text {
  white-space: normal;
  text-align: center;
  line-height: 1.35;
}
</style>
