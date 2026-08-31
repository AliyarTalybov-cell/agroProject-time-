<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { loadFields, type FieldRow } from '@/lib/fieldsSupabase'
import { loadCrops, type CropRow } from '@/lib/landTypesAndCrops'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  fetchWeather,
  fetchForecast5,
  fetchWeatherInsights,
  getWeatherIconUrl,
  conditionCategoryLabelRu,
  type WeatherData,
  type ForecastDayItem,
  type WeatherInsights,
  type WeatherHourlyInsight,
} from '@/lib/weatherApi'
import { parseLatLonFromGeolocationString } from '@/lib/yandexGeocode'
import { RUSSIAN_CITIES } from '@/lib/cities'
import { useWeatherCity } from '@/composables/useWeatherCity'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import YandexMap from '@/components/YandexMap.vue'

const { cityValue, setCity, city, country } = useWeatherCity()
const weather = ref<WeatherData | null>(null)
const forecastDays = ref<ForecastDayItem[]>([])
const weatherInsights = ref<WeatherInsights | null>(null)
const fields = ref<FieldRow[]>([])
const crops = ref<CropRow[]>([])
const loading = ref(true)
const insightsLoading = ref(false)
const error = ref(false)
const showLongLoadingHint = ref(false)
const pickedCoords = ref<{ lat: number; lon: number } | null>(null)
const pickedCoordsCopied = ref(false)
let pickedCoordsCopiedTimer: ReturnType<typeof setTimeout> | null = null
let longLoadingHintTimer: ReturnType<typeof setTimeout> | null = null
type LatLon = [number, number]

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

async function copyPickedCoords() {
  const p = pickedCoords.value
  if (!p) return
  const text = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      // Ни Clipboard API, ни execCommand не сработали — копирование в этом
      // браузере недоступно. Отметку «скопировано» не показываем.
      return
    }
  }
  pickedCoordsCopied.value = true
  if (pickedCoordsCopiedTimer) clearTimeout(pickedCoordsCopiedTimer)
  pickedCoordsCopiedTimer = setTimeout(() => {
    pickedCoordsCopied.value = false
    pickedCoordsCopiedTimer = null
  }, 2000)
}

/** Погода по точке поля (ключ — id поля); null в значении = нет данных / ошибка */
const fieldWeatherById = ref<Record<string, WeatherData | null>>({})
const fieldsLocationWeatherLoading = ref(false)

/** Как в таблице «Поля»: заголовок из name; иначе запасной вариант по number */
function fieldDisplayTitle(f: FieldRow): string {
  const n = (f.name ?? '').trim()
  if (n) return n
  if (f.number != null && Number.isFinite(Number(f.number))) return `Поле №${f.number}`
  return 'Поле'
}

/** Тот же порядок, что при сортировке списка полей по колонке «Название» (как на FieldsPage). */
function compareFieldsByNameThenNumber(a: FieldRow, b: FieldRow): number {
  const c = (a.name ?? '')
    .trim()
    .localeCompare((b.name ?? '').trim(), 'ru', { sensitivity: 'base' })
  if (c !== 0) return c
  return Number(a.number) - Number(b.number)
}

const fieldsSortedForWeather = computed(() => [...fields.value].sort(compareFieldsByNameThenNumber))

async function load() {
  if (longLoadingHintTimer) {
    clearTimeout(longLoadingHintTimer)
    longLoadingHintTimer = null
  }
  showLongLoadingHint.value = false
  longLoadingHintTimer = setTimeout(() => {
    if (loading.value) {
      showLongLoadingHint.value = true
    }
  }, 5000)

  loading.value = true
  insightsLoading.value = false
  error.value = false
  try {
    const data = await fetchWeather(city(), country())
    weather.value = data
    forecastDays.value = []
    weatherInsights.value = null
    if (data?.coord?.lat != null && data?.coord?.lon != null) {
      const lat = data.coord.lat
      const lon = data.coord.lon
      forecastDays.value = await fetchForecast5(lat, lon)
      insightsLoading.value = true
      try {
        weatherInsights.value = await fetchWeatherInsights(lat, lon)
        if (weatherInsights.value?.daily.length) {
          forecastDays.value = weatherInsights.value.daily
        }
      } finally {
        insightsLoading.value = false
      }
    }
    if (!data) error.value = true
  } finally {
    loading.value = false
    if (longLoadingHintTimer) {
      clearTimeout(longLoadingHintTimer)
      longLoadingHintTimer = null
    }
    showLongLoadingHint.value = false
  }
}

watch(cityValue, () => load())

function refresh() {
  void load().then(() => {
    void loadFieldsLocationWeather()
  })
}

/** Погода для карточек полей: по геолокации (+ при необходимости адрес для привязки участка к земле). */
async function loadFieldsLocationWeather() {
  if (!fields.value.length) {
    fieldWeatherById.value = {}
    return
  }
  fieldsLocationWeatherLoading.value = true
  const next: Record<string, WeatherData | null> = {}
  try {
    await Promise.all(
      fields.value.map(async (f) => {
        const coords = parseLatLonFromGeolocationString(f.geolocation)
        const hasAddress = (f.address ?? '').trim().length > 0
        if (!coords || !hasAddress) {
          next[f.id] = null
          return
        }
        next[f.id] = await fetchWeather(coords.lat, coords.lon)
      }),
    )
    fieldWeatherById.value = next
  } finally {
    fieldsLocationWeatherLoading.value = false
  }
}

onMounted(() => {
  void Promise.all([load(), loadFieldsData()])
})

onBeforeUnmount(() => {
  if (pickedCoordsCopiedTimer) clearTimeout(pickedCoordsCopiedTimer)
  if (longLoadingHintTimer) clearTimeout(longLoadingHintTimer)
})

watch(fields, () => {
  void loadFieldsLocationWeather()
})

const updatedAt = computed(() => {
  const d = new Date()
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
})

const dateStr = computed(() => {
  const d = new Date()
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
})

const timeStr = computed(() => {
  const d = new Date()
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
})

const todayStr = computed(() => new Date().toISOString().slice(0, 10))
const tomorrowStr = computed(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10))

const forecastWithLabels = computed(() => {
  return forecastDays.value.map((day, i) => {
    let label = `${day.dayLabel}, ${day.dateLabel}`
    if (day.date === todayStr.value) label = 'Сегодня'
    else if (day.date === tomorrowStr.value) label = 'Завтра'
    return { ...day, displayLabel: label }
  })
})

const windStrong = computed(() => (weather.value?.windSpeed ?? 0) > 5)
const windExtreme = computed(() => (weather.value?.windSpeed ?? 0) > 10)
const tempExtreme = computed(() => {
  const t = weather.value?.temp
  return t != null && (t < -15 || t > 35)
})

const daylightDuration = computed(() => {
  if (!weather.value?.sunrise || !weather.value?.sunset) return '—'
  if (weather.value.sunrise === '—' || weather.value.sunset === '—') return '—'
  
  const parse = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    return h * 60 + m
  }
  
  const diff = parse(weather.value.sunset) - parse(weather.value.sunrise)
  if (diff <= 0) return '—'
  const hrs = Math.floor(diff / 60)
  const mins = diff % 60
  return `${hrs} ч ${mins} мин`
})

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`
}

function formatValue(value: number | null | undefined, unit = '', digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits).replace(/\.0+$/, '')}${unit}`
}

type HourlyRiskLevel = 'safe' | 'warn' | 'risk'

type HourlyRiskAssessment = {
  level: HourlyRiskLevel
  probability: number
  severity: number
  score: number
  action: string
}

function factorMatrix(probability: number, severity: number): HourlyRiskAssessment {
  const score = probability * severity
  const level: HourlyRiskLevel = score >= 13 ? 'risk' : score >= 7 ? 'warn' : 'safe'
  const action =
    score >= 20
      ? 'Критично: остановить работы на открытом воздухе'
      : score >= 13
        ? 'Высокий риск: ограничить открытые/высотные работы'
        : score >= 7
          ? 'Средний риск: работать с мерами защиты'
          : 'Низкий риск: работы допустимы'
  return { level, probability, severity, score, action }
}

function assessHourlyRisk(hour: WeatherHourlyInsight): HourlyRiskAssessment {
  const rainProb = hour.precipitationProbability ?? 0
  const rainMm = hour.precipitation ?? 0
  const gust = hour.windGusts ?? 0
  const temp = hour.soilTemperature ?? weather.value?.temp ?? 0
  const uv = hour.uvIndex ?? weatherInsights.value?.airQuality?.uvIndex ?? 0

  // 1) Осадки: интенсивность + вероятность
  let rainP = 1
  let rainS = 1
  if (rainMm > 6 || rainProb >= 70) {
    rainP = 5
    rainS = 4
  } else if (rainMm >= 2 || rainProb >= 40) {
    rainP = 4
    rainS = 3
  } else if (rainMm >= 0.5 || rainProb >= 20) {
    rainP = 3
    rainS = 2
  }

  // 2) Ветер: порывы
  let windP = 1
  let windS = 1
  if (gust > 20) {
    windP = 5
    windS = 5
  } else if (gust > 15) {
    windP = 5
    windS = 4
  } else if (gust > 10) {
    windP = 4
    windS = 3
  } else if (gust >= 6) {
    windP = 3
    windS = 2
  }

  // 3) Температура/микроклимат
  let tempP = 1
  let tempS = 1
  if (temp > 32.5) {
    tempP = 4
    tempS = 4
  } else if (temp < -30) {
    tempP = 5
    tempS = 5
  } else if (temp <= -15) {
    tempP = 4
    tempS = 4
  }

  // 4) UV
  let uvP = 1
  let uvS = 1
  if (uv >= 8) {
    uvP = 4
    uvS = 4
  } else if (uv >= 6) {
    uvP = 3
    uvS = 3
  } else if (uv >= 3) {
    uvP = 2
    uvS = 2
  }

  const probability = Math.max(rainP, windP, tempP, uvP)
  const severity = Math.max(rainS, windS, tempS, uvS)
  return factorMatrix(probability, severity)
}

function aqiLabel(value: number | null | undefined): string {
  if (value == null) return 'Нет данных'
  if (value <= 20) return 'Хорошо'
  if (value <= 40) return 'Умеренно'
  if (value <= 60) return 'Нежелательно'
  if (value <= 80) return 'Плохо'
  if (value <= 100) return 'Очень плохо'
  return 'Экстремально'
}

const nextHours = computed<WeatherHourlyInsight[]>(() => weatherInsights.value?.hourly.slice(0, 8) ?? [])

const nextHoursWithRisk = computed(() => {
  return nextHours.value.map((hour) => ({ ...hour, risk: assessHourlyRisk(hour) }))
})

const bestSprayWindow = computed(() => {
  const hours = weatherInsights.value?.hourly ?? []
  const good = hours.find((h) => {
    const gust = h.windGusts ?? 0
    const rainRisk = h.precipitationProbability ?? 0
    const precip = h.precipitation ?? 0
    return gust <= 5 && rainRisk <= 30 && precip <= 0.2
  })
  if (!good) return { title: 'Окно не найдено', subtitle: 'В ближайшие 24 часа есть ограничения по ветру или осадкам', status: 'warn' }
  return { title: good.hourLabel, subtitle: `Порывы ${formatValue(good.windGusts, ' м/с', 1)}, осадки ${formatValue(good.precipitationProbability, '%')}`, status: 'ok' }
})

const agroRiskCards = computed(() => {
  const w = weather.value
  const daily = forecastWithLabels.value[0]
  const hourly = weatherInsights.value?.hourly ?? []
  const maxRainRisk = Math.max(0, ...hourly.map((h) => h.precipitationProbability ?? 0))
  const maxGust = Math.max(w?.windGusts ?? 0, daily?.windGusts ?? 0, ...hourly.map((h) => h.windGusts ?? 0))
  const soilMoisture = w?.soilMoisture ?? hourly.find((h) => h.soilMoisture != null)?.soilMoisture ?? null
  const vpd = w?.vapourPressureDeficit ?? hourly.find((h) => h.vapourPressureDeficit != null)?.vapourPressureDeficit ?? null
  const et0 = daily?.evapotranspiration ?? null

  return [
    {
      title: 'Опрыскивание',
      value: bestSprayWindow.value.status === 'ok' ? `с ${bestSprayWindow.value.title}` : 'отложить',
      text: bestSprayWindow.value.subtitle,
      status: bestSprayWindow.value.status,
    },
    {
      title: 'Осадки 24ч',
      value: `${Math.round(maxRainRisk)}%`,
      text: maxRainRisk > 60 ? 'Высокий риск дождя, проверьте план работ' : 'Критичных осадков не видно',
      status: maxRainRisk > 60 ? 'risk' : maxRainRisk > 35 ? 'warn' : 'ok',
    },
    {
      title: 'Порывы ветра',
      value: formatValue(maxGust, ' м/с', 1),
      text: maxGust > 10 ? 'Лучше не проводить обработку и точные работы' : 'Условия по ветру рабочие',
      status: maxGust > 10 ? 'risk' : maxGust > 6 ? 'warn' : 'ok',
    },
    {
      title: 'Влага почвы',
      value: formatValue(soilMoisture, '', 3),
      text: soilMoisture == null ? 'Нет данных по верхнему слою' : soilMoisture < 0.18 ? 'Верхний слой сухой' : 'Верхний слой в норме',
      status: soilMoisture == null ? 'muted' : soilMoisture < 0.18 ? 'warn' : 'ok',
    },
    {
      title: 'Испарение ET₀',
      value: formatValue(et0, ' мм', 1),
      text: et0 != null && et0 > 4 ? 'Высокая потеря влаги за день' : 'Потеря влаги умеренная',
      status: et0 != null && et0 > 4 ? 'warn' : 'ok',
    },
    {
      title: 'Стресс растений',
      value: formatValue(vpd, ' кПа', 2),
      text: vpd != null && vpd > 1.6 ? 'Воздух сушит лист, следите за поливом' : 'VPD в спокойной зоне',
      status: vpd != null && vpd > 1.6 ? 'warn' : 'ok',
    },
  ]
})

const weatherHistoryCards = computed(() => {
  const h = weatherInsights.value?.history
  if (!h) return []
  return [
    { label: 'Осадки за 7 дней', value: formatValue(h.precipitationSum, ' мм', 1), sub: `${h.rainyDays} дн. с дождем` },
    { label: 'Испарение за 7 дней', value: formatValue(h.evapotranspirationSum, ' мм', 1), sub: 'ET₀ по архиву' },
    { label: 'Температурный диапазон', value: `${formatValue(h.tempMin, '°')} / ${formatValue(h.tempMax, '°')}`, sub: `${h.startDate} — ${h.endDate}` },
  ]
})

/** Класс сценки неба по condition из API (Clear, Clouds, Rain, Snow, Mist и т.д.) */
const weatherSkyClass = computed(() => {
  const c = (weather.value?.condition ?? '').toLowerCase()
  if (c === 'clear') return 'weather-sky--clear'
  if (c === 'clouds') return 'weather-sky--clouds'
  if (c === 'rain' || c === 'drizzle') return 'weather-sky--rain'
  if (c === 'snow') return 'weather-sky--snow'
  if (c === 'mist' || c === 'fog' || c === 'haze' || c === 'smoke') return 'weather-sky--fog'
  if (c === 'thunderstorm') return 'weather-sky--rain'
  return 'weather-sky--clear'
})

async function loadFieldsData() {
  if (!isSupabaseConfigured()) {
    fields.value = []
    crops.value = []
    return
  }
  try {
    const [fieldRows, cropRows] = await Promise.all([loadFields(), loadCrops()])
    fields.value = fieldRows
    crops.value = cropRows
  } catch (e) {
    // Поля и культуры нужны выпадающим спискам, а не самому прогнозу.
    console.error('Справочники полей и культур', e)
    fields.value = []
    crops.value = []
  }
}

/** Краткая рекомендация для блока в герой-карточке (как на макете) */
const heroRecommendation = computed(() => {
  const data = weather.value
  if (!data) return { title: '', items: [] }
  const wind = data.windSpeed ?? 0
  const precip = data.precProbability ?? 0
  const okForSpray = wind <= 5 && (data.temp ?? 15) >= 5 && (data.temp ?? 15) <= 28
  const title = okForSpray ? 'Идеально для опрыскивания' : wind > 5 ? 'Отложите опрыскивание' : 'Умеренные условия'
  const items = [
    { label: wind <= 5 ? 'Ветер в норме' : 'Ветер повышен', value: `${wind} м/с` },
    { label: 'Вер. осадков', value: `${Math.round(precip)}%` },
  ]
  return { title, items }
})

const fieldsWithWeather = computed(() => {
  const city = weather.value
  const cropMap = new Map(crops.value.map((c) => [c.key, c.label]))
  const cityTemp = city?.temp ?? 0
  const cityWind = Math.max(0, city?.windSpeed ?? 0)
  const cityIcon = city?.icon ?? '01d'
  const loading = fieldsLocationWeatherLoading.value

  return fieldsSortedForWeather.value.map((f) => {
    const cropName = cropMap.get(f.crop_key) ?? f.crop_key ?? '—'
    const fieldName = fieldDisplayTitle(f)
    const coords = parseLatLonFromGeolocationString(f.geolocation)
    const hasAddress = (f.address ?? '').trim().length > 0
    const eligible = coords != null && hasAddress
    const local = eligible ? fieldWeatherById.value[f.id] : undefined

    let temp: number | null
    let wind: number
    let icon: string
    let windStrong: boolean
    let wx: WeatherData | null = null

    if (eligible && local) {
      temp = local.temp
      wind = Math.max(0, local.windSpeed ?? 0)
      icon = local.icon || cityIcon
      windStrong = wind > 5
      wx = local
    } else if (eligible && loading) {
      temp = null
      wind = 0
      icon = cityIcon
      windStrong = false
      wx = null
    } else {
      temp = cityTemp
      wind = cityWind
      icon = cityIcon
      windStrong = wind > 5
      wx = city ?? null
    }

    const humidity = wx?.humidity ?? null
    const precProbability = wx?.precProbability ?? null
    const pressure = wx?.pressure ?? null
    const visibilityKm =
      wx?.visibility != null ? Number((wx.visibility / 1000).toFixed(1)) : null
    const kpIndex = wx?.kpIndex ?? null
    const conditionLabel = wx ? conditionCategoryLabelRu(wx.condition) : ''
    const windDir = wx?.windDirection?.trim() ? wx.windDirection : ''
    const loadingCard = Boolean(eligible && loading && !local)

    const hasExtras =
      !loadingCard &&
      (Boolean(conditionLabel && conditionLabel !== '—') ||
        humidity != null ||
        precProbability != null ||
        pressure != null ||
        visibilityKm != null ||
        kpIndex != null)

    return {
      id: f.id,
      name: fieldName,
      cropName,
      temp,
      wind,
      windStrong,
      icon,
      windDir,
      humidity,
      precProbability,
      pressure,
      visibilityKm,
      kpIndex,
      conditionLabel,
      hasExtras,
      loading: loadingCard,
    }
  })
})

/** Геометрия полей на карте наблюдения: point -> метка, polygon -> контур */
const weatherMapFieldMarkers = computed(() => {
  const cropMap = new Map(crops.value.map((c) => [c.key, c.label]))
  const result: Array<{
    id: string
    lat: number
    lon: number
    title: string
    subtitle?: string
    geometryMode?: 'point' | 'polygon'
    polygonPoints?: LatLon[]
  }> = []
  for (const f of fieldsSortedForWeather.value) {
    const coords = parseLatLonFromGeolocationString(f.geolocation)
    const geometryMode = ((f as { geometry_mode?: 'point' | 'polygon' | null }).geometry_mode ?? 'point')
    const polygonPoints = fromPolygonGeoJson((f as { contour_geojson?: Record<string, unknown> | null }).contour_geojson ?? null)
    if (!coords && polygonPoints.length < 3) continue
    const title = fieldDisplayTitle(f)
    const cropName = cropMap.get(f.crop_key) ?? f.crop_key ?? ''
    const addr = (f.address ?? '').trim()
    const subtitle = [cropName, addr].filter(Boolean).join(' · ') || undefined
    if (geometryMode === 'polygon' && polygonPoints.length >= 3) {
      const center = {
        lat: polygonPoints.reduce((sum, p) => sum + p[0], 0) / polygonPoints.length,
        lon: polygonPoints.reduce((sum, p) => sum + p[1], 0) / polygonPoints.length,
      }
      result.push({
        id: f.id,
        lat: center.lat,
        lon: center.lon,
        title,
        subtitle,
        geometryMode: 'polygon',
        polygonPoints,
      })
    } else if (coords) {
      result.push({ id: f.id, lat: coords.lat, lon: coords.lon, title, subtitle, geometryMode: 'point' })
    }
  }
  return result
})
</script>

<template>
  <section class="weather-page">
    <header class="header-area header-weather page-enter-item">
      <div class="weather-page-title">
        <span class="weather-page-title-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>
        </span>
        <div>
          <h1>АгроМетео</h1>
          <p>Мониторинг условий для полей и работ - Данные прогружаются только с VPN</p>
        </div>
      </div>
      <div class="weather-header-actions">
        <select
          :value="cityValue"
          class="weather-city-select"
          aria-label="Выбор города"
          @change="(e) => setCity((e.target as HTMLSelectElement).value)"
        >
          <option v-for="c in RUSSIAN_CITIES" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
        <button type="button" class="weather-refresh-btn" aria-label="Обновить" @click="refresh">Обновить</button>
      </div>
    </header>

    <div v-if="loading" class="weather-detail-loading" role="status" aria-live="polite">
      <UiLoadingBar size="md" />
      <p v-if="showLongLoadingHint" class="weather-loading-long-hint">
        Загрузка занимает больше времени обычного, пожалуйста подождите еще немного.
      </p>
    </div>
    <div v-else-if="error" class="weather-detail-error">Не удалось загрузить погоду</div>
    <template v-else-if="weather">
      <div class="weather-dashboard-layout">
        <main class="weather-dashboard-main">
      <!-- Герой-карточка как в design: волна + локация | температура | рекомендация -->
      <div class="weather-hero page-enter-item" style="--enter-delay: 60ms">
        <svg class="weather-hero-wave" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 320" preserveAspectRatio="none" aria-hidden="true">
          <path fill="#ffffff" fill-opacity="1" d="M0,128L48,144C96,160,192,192,288,197.3C384,203,480,181,576,170.7C672,160,768,160,864,170.7C960,181,1056,203,1152,192C1248,181,1344,139,1392,117.3L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z" />
        </svg>
        <div class="weather-hero-inner">
          <div class="weather-hero-main">
            <div class="weather-hero-location">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
              <span>Локация</span>
            </div>
            <h2 class="weather-hero-city">{{ weather.cityName }}</h2>
            <p v-if="weather.coord" class="weather-hero-coords">Координаты: {{ weather.coord.lat?.toFixed(4) }}° N, {{ weather.coord.lon?.toFixed(4) }}° E</p>
            <p class="weather-hero-datetime">
              <span>Сегодня, {{ dateStr }}</span>
              <span class="weather-hero-datetime-sep" aria-hidden="true">•</span>
              <span>{{ timeStr }}</span>
            </p>
          </div>
          <div class="weather-hero-temp-block">
            <img class="weather-current-icon" :src="getWeatherIconUrl(weather.icon)" alt="" width="96" height="96" />
            <div class="weather-hero-temp-wrap">
              <span class="weather-hero-temp">{{ weather.temp != null ? weather.temp : '—' }}°C</span>
              <div class="weather-hero-desc">{{ weather.description }}</div>
            </div>
          </div>
          <aside class="weather-recommendation-inline">
            <h3>
              <span style="background:#4ade80;color:#14532d;padding:6px;border-radius:8px;display:inline-flex;">✓</span>
              Рекомендация
            </h3>
            <p>{{ heroRecommendation.title }}</p>
            <ul>
              <li v-for="item in heroRecommendation.items" :key="`${item.label}:${item.value}`">
                <span>✓ {{ item.label }}</span>
                <span>{{ item.value }}</span>
              </li>
            </ul>
          </aside>
        </div>
      </div>

      <h2 class="weather-section-title weather-section-title--main page-enter-item" style="--enter-delay: 120ms">Подробные показатели</h2>
      <div class="weather-indicators-grid page-enter-item" style="--enter-delay: 180ms">
        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-wind">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" /><path d="M9.6 4.6A2 2 0 1 1 11 8H2" /><path d="M12.6 19.4A2 2 0 1 0 14 16H2" /></svg>
          </div>
          <div>
            <div class="weather-indicator-label">Ветер</div>
            <div class="weather-indicator-value">{{ weather.windSpeed != null ? weather.windSpeed : '—' }} <span class="weather-indicator-muted">м/с, {{ weather.windDirection || '—' }}</span></div>
            <div class="weather-indicator-sub">Порывы: {{ weather.windGusts != null ? weather.windGusts + ' м/с' : '—' }}</div>
          </div>
        </div>
        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-humidity"><!-- humidity --><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22a5 5 0 0 0 5-5c0-2-5-10-5-10S7 15 7 17a5 5 0 0 0 5 5z" /></svg></div>
          <div>
            <div class="weather-indicator-label">Влажность</div>
            <div class="weather-indicator-value">{{ weather.humidity != null ? weather.humidity : '—' }}<span class="weather-indicator-muted">%</span></div>
            <div class="weather-indicator-sub">{{ weather.humidity == null ? '—' : (weather.humidity < 40 ? 'Воздух очень сухой' : (weather.humidity > 80 ? 'Повышенная влажность' : 'Оптимальная')) }}</div>
          </div>
        </div>
        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-pressure"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg></div>
          <div>
            <div class="weather-indicator-label">Давление</div>
            <div class="weather-indicator-value">{{ weather.pressure != null ? weather.pressure : '—' }}<span class="weather-indicator-muted"> гПа</span></div>
            <div class="weather-indicator-sub">Привед. к морю: {{ weather.meanSeaLevelPressure != null ? weather.meanSeaLevelPressure + ' гПа' : '—' }}</div>
          </div>
        </div>
        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-visibility"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg></div>
          <div>
            <div class="weather-indicator-label">Видимость</div>
            <div class="weather-indicator-value">{{ weather.visibility != null ? Number((weather.visibility / 1000).toFixed(1)) : '—' }}<span class="weather-indicator-muted"> км</span></div>
            <div class="weather-indicator-sub">{{ weather.visibility == null ? '—' : (weather.visibility < 2000 ? 'Ограничена (возможен туман/осадки)' : 'Отличная видимость') }}</div>
          </div>
        </div>
        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-clouds"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></svg></div>
          <div>
            <div class="weather-indicator-label">Облачность</div>
            <div class="weather-indicator-value">{{ weather.clouds != null ? weather.clouds : '—' }}<span class="weather-indicator-muted" v-if="weather.clouds != null">%</span></div>
            <div class="weather-indicator-sub" v-if="weather.clouds != null">Прогресс: <span class="weather-progress"><span class="weather-progress-fill" :style="{ width: (weather.clouds ?? 0) + '%' }"></span></span></div>
            <div class="weather-indicator-sub" v-else>Нет данных</div>
          </div>
        </div>
        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-precip"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="M16 14v6" /><path d="M8 14v6" /><path d="M12 16v6" /></svg></div>
          <div>
            <div class="weather-indicator-label">Вер. осадков</div>
            <div class="weather-indicator-value">{{ weather.precProbability != null ? weather.precProbability : '—' }}<span class="weather-indicator-muted">%</span></div>
            <div class="weather-indicator-sub">Прогресс: <span class="weather-progress"><span class="weather-progress-fill weather-progress-fill-cyan" :style="{ width: (weather.precProbability ?? 0) + '%' }"></span></span></div>
          </div>
        </div>
        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-uv"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg></div>
          <div>
            <div class="weather-indicator-label">УФ-Индекс</div>
            <div class="weather-indicator-value">{{ forecastWithLabels[0]?.uvIndexMax ?? weatherInsights?.airQuality?.uvIndex ?? weather.uvIndex ?? '—' }} <span v-if="forecastWithLabels[0]?.uvIndexMax != null || weatherInsights?.airQuality?.uvIndex != null || weather.uvIndex != null" class="weather-badge" :class="((forecastWithLabels[0]?.uvIndexMax ?? weatherInsights?.airQuality?.uvIndex ?? weather.uvIndex ?? 0) > 5) ? 'weather-badge-high' : 'weather-badge-low'">{{ ((forecastWithLabels[0]?.uvIndexMax ?? weatherInsights?.airQuality?.uvIndex ?? weather.uvIndex ?? 0) > 5) ? 'Высокий' : 'Низкий' }}</span></div>
            <div class="weather-indicator-sub">{{ ((forecastWithLabels[0]?.uvIndexMax ?? weatherInsights?.airQuality?.uvIndex ?? weather.uvIndex ?? 0) > 5) ? 'Требуется защита' : 'Контроль УФ по прогнозу' }}</div>
          </div>
        </div>
        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-soil" style="color: #8B4513; background: rgba(139,69,19,0.15)">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" /></svg>
          </div>
          <div>
            <div class="weather-indicator-label">Темп. почвы</div>
            <div class="weather-indicator-value">{{ weather.soilTemperature != null ? weather.soilTemperature : '—' }}<span class="weather-indicator-muted" v-if="weather.soilTemperature != null">°C</span></div>
            <div class="weather-indicator-sub">{{ weather.soilTemperature != null ? 'Поверхность почвы' : 'Нет данных' }}</div>
          </div>
        </div>
        
        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-moisture" style="color: #20B2AA; background: rgba(32,178,170,0.15)">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22a5 5 0 0 0 5-5c0-2-5-10-5-10S7 15 7 17a5 5 0 0 0 5 5z" /></svg>
          </div>
          <div>
            <div class="weather-indicator-label">Влажн. почвы</div>
            <div class="weather-indicator-value">{{ weather.soilMoisture != null ? weather.soilMoisture : '—' }}</div>
            <div class="weather-indicator-sub">{{ weather.soilMoisture != null ? 'Верхний слой 0–1 см' : 'Нет данных' }}</div>
          </div>
        </div>

        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-leaf" style="color: #4ade80; background: rgba(74,222,128,0.15)">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>
          </div>
          <div>
            <div class="weather-indicator-label">Листья</div>
            <div class="weather-indicator-value">{{ weather.vapourPressureDeficit != null ? weather.vapourPressureDeficit : '—' }}<span class="weather-indicator-muted" v-if="weather.vapourPressureDeficit != null"> кПа</span></div>
            <div class="weather-indicator-sub">{{ weather.vapourPressureDeficit != null && weather.vapourPressureDeficit > 1.6 ? 'Сухой воздух, стресс листа' : 'VPD / риск пересыхания' }}</div>
          </div>
        </div>

        <div class="weather-indicator-card">
          <div class="weather-indicator-icon weather-icon-kp" style="color: #9333ea; background: rgba(147,51,234,0.15)">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <div>
            <div class="weather-indicator-label">Осадки сейчас</div>
            <div class="weather-indicator-value">{{ weather.precipitation != null ? weather.precipitation : '—' }}<span class="weather-indicator-muted" v-if="weather.precipitation != null"> мм</span></div>
            <div class="weather-indicator-sub">Дождь: {{ weather.rain != null ? weather.rain + ' мм' : '—' }}, ливни: {{ weather.showers != null ? weather.showers + ' мм' : '—' }}</div>
          </div>
        </div>

        <div class="weather-indicator-card weather-indicator-card--bottom weather-indicator-card--sun">
          <div class="weather-indicator-icon weather-icon-sun"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v8" /><path d="m4.93 10.93 1.41 1.41" /><path d="M2 18h2" /><path d="M20 18h2" /><path d="m19.07 10.93-1.41 1.41" /><path d="M22 22H2" /><path d="m8 6 4-4 4 4" /><path d="M16 18a4 4 0 0 0-8 0" /></svg></div>
          <div>
            <div class="weather-indicator-label">Солнце</div>
            <div class="weather-indicator-value weather-indicator-value-sun">
              <span>Вос: {{ weather.sunrise || '—' }}</span>
              <span>Зак: {{ weather.sunset || '—' }}</span>
            </div>
            <div class="weather-indicator-sub weather-indicator-sub-sun">День: {{ daylightDuration }}</div>
          </div>
        </div>

        <div class="weather-indicator-card weather-indicator-card--bottom weather-indicator-card--dew">
          <div class="weather-indicator-icon weather-icon-dew" style="color: #2563eb; background: rgba(37,99,235,0.15)">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7l-3.3 3.3a4.67 4.67 0 0 0 0 6.6 4.67 4.67 0 0 0 6.6 0 4.67 4.67 0 0 0 0-6.6Z"/></svg>
          </div>
          <div>
            <div class="weather-indicator-label">Точка росы</div>
            <div class="weather-indicator-value weather-indicator-value-dew">
              <span>{{ weather.dewPoint != null ? weather.dewPoint : '—' }}<span class="weather-indicator-muted" v-if="weather.dewPoint != null">°C</span></span>
              <span v-if="weather.dewPoint != null" class="weather-dew-pill">Риск конденсата и росы</span>
            </div>
            <div v-if="weather.dewPoint == null" class="weather-indicator-sub">Нет данных</div>
          </div>
        </div>
      </div>

      <h2 class="weather-section-title weather-section-title--main page-enter-item" style="--enter-delay: 220ms">Агро-условия на ближайшие сутки</h2>
      <div class="weather-agro-grid page-enter-item" style="--enter-delay: 240ms">
        <div
          v-for="card in agroRiskCards"
          :key="card.title"
          class="weather-agro-card"
          :class="`weather-agro-card--${card.status}`"
        >
          <div class="weather-agro-card-label">{{ card.title }}</div>
          <div class="weather-agro-card-value">{{ card.value }}</div>
          <p>{{ card.text }}</p>
        </div>
      </div>

      <div class="weather-insights-row page-enter-item" style="--enter-delay: 260ms">
        <div class="weather-insight-panel card-rounded">
          <div class="weather-insight-head">
            <div>
              <h2 class="weather-block-title">
                Почасовой риск работ
                <span class="weather-help" tabindex="0" aria-label="Как рассчитывается риск">
                  <span class="weather-help-icon">?</span>
                  <span class="weather-help-tooltip">
                    Риск = Вероятность (1-5) x Тяжесть (1-5).<br>
                    Факторы: осадки (мм/ч и %), порывы ветра, температура, UV.<br>
                    Ключевые пороги: ветер &gt;10 м/с, дождь &gt;2 мм/ч или &gt;40%, жара &gt;32.5°C, UV &gt;=6.<br>
                    Итог: 1-6 низкий, 7-12 средний, 13-25 высокий.
                  </span>
                </span>
              </h2>
              <p class="weather-block-subtitle">Осадки, порывы ветра, почва и УФ на ближайшие часы.</p>
            </div>
            <span v-if="insightsLoading" class="weather-mini-badge">обновляем</span>
          </div>
          <div v-if="nextHoursWithRisk.length" class="weather-hourly-strip">
            <div
              v-for="hour in nextHoursWithRisk"
              :key="hour.time"
              class="weather-hourly-card"
              :class="`weather-hourly-card--${hour.risk.level}`"
              :title="hour.risk.action"
            >
              <div class="weather-hourly-time">{{ hour.hourLabel }}</div>
              <div class="weather-hourly-main">{{ hour.precipitationProbability ?? 0 }}%</div>
              <div class="weather-hourly-sub">риск {{ hour.risk.score }}/25</div>
              <div class="weather-hourly-meta">порывы {{ formatValue(hour.windGusts, ' м/с', 1) }}</div>
              <div class="weather-hourly-meta">почва {{ formatValue(hour.soilTemperature, '°', 1) }} • UV {{ formatValue(hour.uvIndex, '') }}</div>
            </div>
          </div>
          <p v-else class="weather-block-subtitle">Расширенный почасовой прогноз пока недоступен.</p>
        </div>
      </div>

      <div class="weather-fields-block card-rounded weather-anim-card" style="--anim-delay: 550ms">
        <h2 class="weather-block-title">Состояние полей</h2>
        <p v-if="!fieldsWithWeather.length" class="weather-block-subtitle">Поля не найдены.</p>
        <div v-else class="weather-fields-list">
          <RouterLink
            v-for="(f, idx) in fieldsWithWeather"
            :key="f.id"
            class="weather-field-mini weather-anim-card weather-field-link"
            :to="{ name: 'field-details', params: { id: f.id } }"
            :style="{ '--anim-delay': 600 + idx * 60 + 'ms' }"
          >
            <div class="weather-field-mini-main">
              <div>
                <div class="weather-field-mini-name">{{ f.name }}</div>
                <div class="weather-field-mini-crop">{{ f.cropName }}</div>
              </div>
              <div class="weather-field-mini-weather" :class="{ 'weather-field-mini-weather--loading': f.loading }">
                <img :src="getWeatherIconUrl(f.icon)" alt="" width="28" height="28" />
                <span class="weather-field-mini-temp">{{ f.loading ? '…' : f.temp != null ? `${f.temp}°C` : '—' }}</span>
                <span class="weather-field-mini-wind" :class="{ 'wind-strong': f.windStrong && !f.loading }">{{
                  f.loading ? '…' : `Ветер ${f.wind} м/с${f.windDir ? ', ' + f.windDir : ''}`
                }}</span>
              </div>
            </div>
            <div v-if="f.hasExtras" class="weather-field-mini-extras" aria-label="Дополнительно по погоде">
              <span v-if="f.conditionLabel && f.conditionLabel !== '—'" class="weather-field-mini-extra-em">{{ f.conditionLabel }}</span>
              <span v-if="f.humidity != null" class="weather-field-mini-extra">Влажность {{ f.humidity }}%</span>
              <span v-if="f.precProbability != null" class="weather-field-mini-extra">Осадки {{ f.precProbability }}%</span>
              <span v-if="f.pressure != null" class="weather-field-mini-extra">Давл. {{ f.pressure }} мм</span>
              <span v-if="f.visibilityKm != null" class="weather-field-mini-extra">Видимость {{ f.visibilityKm }} км</span>
              <span v-if="f.kpIndex != null" class="weather-field-mini-extra">Kp {{ f.kpIndex }}</span>
            </div>
          </RouterLink>
        </div>
      </div>
        </main>

        <aside class="weather-dashboard-side">

      <div class="weather-side-panel weather-side-panel--forecast page-enter-item" style="--enter-delay: 280ms">
        <h2 class="weather-section-title weather-section-title--side">Прогноз на 5 дней</h2>
        <div class="weather-forecast-strip">
          <div
            v-for="day in forecastWithLabels"
            :key="day.date"
            class="weather-forecast-card"
            :class="{ 'weather-forecast-card-alert': day.alert }"
          >
            <div class="weather-forecast-day">{{ day.displayLabel }}</div>
            <div class="weather-forecast-date">{{ day.dateLabel }}</div>
            <img :src="getWeatherIconUrl(day.icon)" alt="" width="40" height="40" style="margin-bottom:12px;" />
            <div class="weather-forecast-temps">
              <span class="weather-forecast-temp-high">{{ day.tempMax }}°</span>
              <span class="weather-forecast-temp-low">{{ day.tempMin }}°</span>
            </div>
            <div class="weather-forecast-extra">
              <span>Осадки {{ day.pop }}%</span>
              <span v-if="day.precipitationSum != null">{{ day.precipitationSum }} мм</span>
              <span v-if="day.windGusts != null">Порывы {{ day.windGusts }} м/с</span>
              <span v-if="day.evapotranspiration != null">ET₀ {{ day.evapotranspiration }} мм</span>
              <span v-if="day.sunshineDuration != null">Солнце {{ formatDuration(day.sunshineDuration) }}</span>
            </div>
            <div v-if="day.alert" class="weather-forecast-alert">{{ day.alert }}</div>
          </div>
        </div>
      </div>

      <div class="weather-side-panel weather-side-panel--air page-enter-item" style="--enter-delay: 320ms">
        <div class="weather-side-head">
          <h2 class="weather-section-title weather-section-title--side">Качество воздуха</h2>
          <span class="weather-air-status">{{ aqiLabel(weatherInsights?.airQuality?.europeanAqi) }}</span>
        </div>
        <div class="weather-air-card">
          <div class="weather-air-main">
            <div class="weather-air-value">{{ weatherInsights?.airQuality?.europeanAqi ?? '—' }}</div>
            <svg class="weather-air-wind-icon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 8h10a3 3 0 1 0-3-3" />
              <path d="M3 12h15a3 3 0 1 1-3 3" />
              <path d="M3 16h8" />
            </svg>
            <div class="weather-air-sub">European AQI</div>
          </div>
          <div class="weather-air-metrics">
            <span><b>PM2.5</b><strong>{{ formatValue(weatherInsights?.airQuality?.pm25, '') }}</strong></span>
            <span><b>PM10</b><strong>{{ formatValue(weatherInsights?.airQuality?.pm10, '') }}</strong></span>
            <span><b>O₃</b><strong>{{ formatValue(weatherInsights?.airQuality?.ozone, '') }}</strong></span>
            <span><b>Пыль</b><strong>{{ formatValue(weatherInsights?.airQuality?.dust, '') }}</strong></span>
          </div>
        </div>
        <div v-if="weatherHistoryCards.length" class="weather-history-grid">
          <div v-for="item in weatherHistoryCards" :key="item.label" class="weather-history-card">
            <div class="weather-history-label">{{ item.label }}</div>
            <div class="weather-history-value">{{ item.value }}</div>
            <div class="weather-history-sub">{{ item.sub }}</div>
          </div>
        </div>
      </div>

      <!-- Карта -->
      <div class="weather-side-panel weather-side-panel--map page-enter-item" style="--enter-delay: 360ms">
        <h2 class="weather-section-title weather-section-title--side">Карта наблюдения полей</h2>
        <div class="weather-map-wrap">
          <YandexMap
            :lat="weather.coord?.lat ?? 55.7558"
            :lon="weather.coord?.lon ?? 37.6176"
            :zoom="10"
            :field-markers="weatherMapFieldMarkers"
            :fit-field-markers="weatherMapFieldMarkers.length > 0"
            @pick="(c) => pickedCoords = c"
          />
          <div v-if="pickedCoords" class="ymap-picked-coords">
            <div class="ymap-picked-coords-main">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <span
                >Выбрана точка:
                <strong>{{ pickedCoords.lat.toFixed(5) }}° N, {{ pickedCoords.lon.toFixed(5) }}° E</strong></span
              >
            </div>
            <button
              type="button"
              class="ymap-copy-coords-btn"
              :title="pickedCoordsCopied ? 'Скопировано' : 'Копировать координаты'"
              :aria-label="pickedCoordsCopied ? 'Скопировано в буфер' : 'Копировать координаты в буфер обмена'"
              @click="copyPickedCoords"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
            </button>
          </div>
          <p class="weather-map-hint">
            Поля на карте показаны по их геометрии: точечные — зелёными метками, контурные — зелёными полигонами. Красная метка —
            точка, которую вы выбрали на карте или в поиске.
          </p>
        </div>
      </div>

      <div class="weather-recommendations card-rounded weather-anim-card" style="--anim-delay: 450ms">
        <h2 class="weather-block-title">Рекомендации на сегодня</h2>
        <p class="weather-block-subtitle">Быстрые правила по текущему прогнозу</p>
        <div class="weather-crops-list">
          <div v-for="card in agroRiskCards.slice(0, 4)" :key="card.title" class="weather-crop-item">
            <div class="weather-crop-icon corn">✓</div>
            <div>
              <div>
                <strong>{{ card.title }}</strong>
                <span class="weather-crop-status" :class="card.status === 'risk' ? 'risk' : card.status === 'warn' ? 'warn' : 'ok'">{{ card.value }}</span>
              </div>
              <p class="weather-crop-desc">{{ card.text }}</p>
            </div>
          </div>
        </div>
      </div>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped src="./WeatherPage.css"></style>
