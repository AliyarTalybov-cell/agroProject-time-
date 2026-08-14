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
  } catch {
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

<style scoped>
.weather-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.weather-dashboard-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.85fr) minmax(320px, 0.95fr);
  align-items: start;
  gap: var(--space-lg);
}

.weather-dashboard-main,
.weather-dashboard-side {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.weather-dashboard-side {
  gap: var(--space-md);
}

/* Компактная верхняя полоса (город / обновить): без лишних отступов от .header-area */
.weather-page > .header-weather.header-area {
  justify-content: space-between;
  align-items: center;
  padding-top: 0;
  padding-bottom: 6px;
  margin-bottom: 10px;
  gap: 8px;
}

.weather-page-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.weather-page-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: #fff;
  background: var(--accent-green);
  box-shadow: var(--shadow-card);
  flex-shrink: 0;
}

.weather-page-title h1 {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.weather-page-title p {
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 500;
}

.weather-detail-loading,
.weather-detail-error {
  grid-column: 1 / -1;
}

/* Чуть плотнее блоки погоды (контент тот же) */
.weather-page :deep(.weather-hero) {
  margin-bottom: 0;
  border-radius: 22px;
  min-height: 228px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent-green) 78%, #064e3b) 0%, #064e3b 100%);
  box-shadow: 0 18px 36px -26px color-mix(in srgb, var(--accent-green) 80%, black);
}

.weather-page :deep(.weather-hero-wave) {
  opacity: 0.08;
}

.weather-page :deep(.weather-hero-inner) {
  display: grid;
  grid-template-columns: minmax(160px, 0.9fr) minmax(240px, 1.15fr) minmax(220px, 0.95fr);
  min-height: 228px;
  padding: 22px;
  gap: 18px;
  align-items: stretch;
}

.weather-page :deep(.weather-hero-main) {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.weather-page :deep(.weather-hero-coords),
.weather-page :deep(.weather-hero-datetime) {
  margin: 0;
  white-space: normal;
  word-break: break-word;
}

.weather-page :deep(.weather-hero .weather-current-icon) {
  width: 88px;
  height: 88px;
  padding: 0;
  border-radius: 0;
  background: transparent;
  border: 0;
  filter: drop-shadow(0 14px 20px rgba(0, 0, 0, 0.18));
}

.weather-page :deep(.weather-hero-temp-block) {
  padding: 14px 0 14px 6px;
  gap: 16px;
  margin-right: 10px;
}

@media (min-width: 1024px) {
  .weather-page :deep(.weather-hero-temp-block) {
    padding: 0 18px 0 4px;
  }
}

.weather-page :deep(.weather-hero-temp-wrap) {
  min-width: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 16px;
}

.weather-page :deep(.weather-hero-temp) {
  font-size: clamp(2.1rem, 3.6vw, 3.1rem);
}

.weather-page :deep(.weather-hero-city) {
  font-size: 1.5rem;
}

.weather-page :deep(.weather-hero-desc) {
  font-size: 0.95rem;
}

.weather-page :deep(.weather-hero-datetime) {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.weather-page :deep(.weather-hero-datetime-sep) {
  opacity: 0.7;
}

.weather-page :deep(.weather-recommendation-inline) {
  width: 100%;
  max-width: 360px;
  padding: 16px;
  border-radius: 18px;
  background: color-mix(in srgb, white 12%, transparent);
  border: 1px solid color-mix(in srgb, white 22%, transparent);
  backdrop-filter: blur(12px);
  min-width: 0;
}

.weather-page :deep(.weather-recommendation-inline h3) {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.9rem;
  gap: 10px;
}

.weather-page :deep(.weather-recommendation-inline p) {
  margin-bottom: 8px;
  font-size: 0.82rem;
  line-height: 1.2;
}

.weather-page :deep(.weather-recommendation-inline ul) {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.weather-page :deep(.weather-recommendation-inline li) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.76rem;
  line-height: 1.15;
}

.weather-page :deep(.weather-recommendation-inline li > span:first-child) {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
}

.weather-page :deep(.weather-recommendation-inline li > span:last-child) {
  margin-left: auto;
  flex-shrink: 0;
  font-weight: 700;
  white-space: nowrap;
  font-size: 0.72rem;
}

.weather-page :deep(.weather-section-title) {
  display: flex;
  align-items: center;
  gap: 0;
  margin: 8px 0 0;
  font-size: 1.05rem;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text-primary);
}

.weather-page :deep(.weather-section-title)::before {
  content: none;
}

.weather-side-panel {
  min-width: 0;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 24px;
  padding: 24px;
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.05),
    0 1px 2px rgba(15, 23, 42, 0.03);
}

.weather-side-panel--forecast {
  padding-top: 24px;
}

.weather-side-panel .weather-section-title {
  margin: 0 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.weather-side-panel--forecast .weather-section-title {
  margin-bottom: 16px;
  color: #334155;
  font-size: 0.875rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.weather-page :deep(.weather-indicators-grid) {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 0;
}

@media (min-width: 768px) {
  .weather-page :deep(.weather-indicators-grid) {
    gap: 10px;
  }
}

.weather-page :deep(.weather-indicator-card) {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  grid-template-areas:
    "icon label"
    "value value"
    "sub sub";
  align-content: start;
  row-gap: 4px;
  column-gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  box-shadow: var(--shadow-card);
  min-height: 104px;
}

.weather-page :deep(.weather-indicator-icon) {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  grid-area: icon;
  align-self: start;
}

.weather-page :deep(.weather-indicator-icon svg) {
  width: 18px;
  height: 18px;
}

.weather-page :deep(.weather-indicator-value) {
  font-size: 0.875rem;
  line-height: 1.2;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
  grid-area: value;
}

.weather-page :deep(.weather-indicator-label) {
  font-size: 0.66rem;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  color: #94a3b8;
  line-height: 1.1;
  grid-area: label;
  align-self: center;
}

.weather-page :deep(.weather-indicator-sub) {
  font-size: 0.625rem;
  line-height: 1.25;
  color: #94a3b8;
  margin-top: 4px;
  grid-area: sub;
}

.weather-page :deep(.weather-indicator-card > div:last-child) {
  display: contents;
}

.weather-page :deep(.weather-indicator-card--bottom) {
  grid-column: 1 / -1;
  min-height: 88px;
  padding: 12px 14px;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.weather-page :deep(.weather-indicator-value-sun) {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 0.875rem;
  line-height: 1.2;
}

.weather-page :deep(.weather-indicator-value-sun span) {
  display: inline-block;
}

.weather-page :deep(.weather-indicator-sub-sun) {
  margin-top: 2px;
  color: #ef4444;
  font-weight: 700;
  font-size: 0.625rem;
}

.weather-page :deep(.weather-indicator-value-dew) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.875rem;
  line-height: 1.2;
}

.weather-page :deep(.weather-dew-pill) {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  background: #eef2ff;
  border: 1px solid #e0e7ff;
  color: #4f46e5;
  font-size: 0.625rem;
  font-weight: 700;
  white-space: nowrap;
}

.weather-page :deep(.weather-indicator-card--sun .weather-indicator-label),
.weather-page :deep(.weather-indicator-card--dew .weather-indicator-label) {
  font-size: 0.68rem;
}

.weather-icon-wind { color: #2563eb; background: color-mix(in srgb, #dbeafe 82%, transparent); }
.weather-icon-humidity { color: #0891b2; background: color-mix(in srgb, #cffafe 82%, transparent); }
.weather-icon-pressure { color: #9333ea; background: color-mix(in srgb, #f3e8ff 82%, transparent); }
.weather-icon-visibility { color: #ea580c; background: color-mix(in srgb, #ffedd5 82%, transparent); }
.weather-icon-clouds { color: #64748b; background: color-mix(in srgb, #f1f5f9 82%, transparent); }
.weather-icon-precip { color: #0284c7; background: color-mix(in srgb, #e0f2fe 82%, transparent); }
.weather-icon-uv { color: #d97706; background: color-mix(in srgb, #fef3c7 82%, transparent); }
.weather-icon-sun { color: #e11d48; background: color-mix(in srgb, #ffe4e6 82%, transparent); }

.weather-page :deep(.weather-forecast-strip) {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 0;
  margin-top: 0;
  overflow: visible;
}

.weather-page :deep(.weather-forecast-card) {
  width: 100%;
  min-width: 0;
  min-height: 72px;
  padding: 12px;
  border-radius: 16px;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  text-align: left;
  gap: 2px 12px;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  box-shadow: none;
}

.weather-page :deep(.weather-forecast-card:first-child) {
  background: #ecfdf5;
  border-color: #d1fae5;
}

.weather-page :deep(.weather-forecast-card-alert) {
  background: #f8fafc;
  border-color: #f1f5f9;
  box-shadow: none;
}

.weather-page :deep(.weather-forecast-card-alert::before) {
  content: none;
}

.weather-page :deep(.weather-forecast-card img) {
  display: block;
  grid-column: 1;
  grid-row: 1 / span 3;
  margin: 0 !important;
  width: 40px;
  height: 40px;
  padding: 9px;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  object-fit: contain;
  align-self: center;
}

.weather-page :deep(.weather-forecast-day),
.weather-page :deep(.weather-forecast-date) {
  grid-column: 2;
}

.weather-page :deep(.weather-forecast-temps) {
  grid-column: 3;
  grid-row: 1 / span 2;
}

.weather-page :deep(.weather-forecast-extra),
.weather-page :deep(.weather-forecast-alert) {
  grid-column: 2;
}

.weather-page :deep(.weather-forecast-temps) {
  justify-content: flex-end;
  font-size: 0.875rem;
  font-weight: 800;
  align-self: center;
  color: #0f172a;
}

.weather-page :deep(.weather-forecast-day) {
  font-size: 0.875rem;
  font-weight: 800;
  margin: 0;
  line-height: 1.15;
  color: #0f172a;
}

.weather-page :deep(.weather-forecast-date) {
  font-size: 0.625rem;
  color: #94a3b8;
  margin: 0;
  line-height: 1.2;
}

.weather-agro-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  margin-top: 0;
}

.weather-agro-card {
  padding: 10px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: var(--shadow-card);
}

.weather-agro-card--ok {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.weather-agro-card--warn {
  border-color: #fed7aa;
  background: #fff7ed;
}

.weather-agro-card--risk {
  border-color: #fecaca;
  background: #fef2f2;
}

.weather-agro-card-label,
.weather-air-label,
.weather-history-label {
  font-size: 0.62rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.weather-agro-card-value,
.weather-air-value,
.weather-history-value {
  margin-top: 4px;
  font-size: 1.08rem;
  line-height: 1.1;
  font-weight: 800;
  color: var(--text-primary);
}

.weather-agro-card p,
.weather-air-sub,
.weather-history-sub {
  margin: 4px 0 0;
  font-size: 0.66rem;
  line-height: 1.25;
  color: var(--text-secondary);
}

.weather-insights-row {
  display: block;
  margin-top: 0;
}

.weather-insight-panel {
  min-width: 0;
  border-radius: 24px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: var(--shadow-card);
}

.weather-insight-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.weather-help {
  position: relative;
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  margin-left: 6px;
  vertical-align: baseline;
  outline: none;
}

.weather-help::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 32px;
  height: 12px;
}

.weather-help-icon {
  width: auto;
  height: auto;
  border-radius: 0;
  border: 0;
  color: #64748b;
  background: transparent;
  font-size: 0.970rem;
  font-weight: 900;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: help;
}

.weather-help-tooltip {
  position: absolute;
  left: 50%;
  top: calc(100% + 6px);
  transform: translateX(-50%);
  z-index: 30;
  min-width: 240px;
  max-width: 300px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: var(--shadow-card);
  display: none;
  color: #334155;
  text-transform: none;
  letter-spacing: normal;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 500;
}

.weather-help:hover .weather-help-tooltip,
.weather-help:focus .weather-help-tooltip,
.weather-help:focus-within .weather-help-tooltip {
  display: block;
}

.weather-insight-panel .weather-block-title {
  display: inline-flex;
  align-items: baseline;
  margin: 0 0 8px;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.weather-insight-panel .weather-block-subtitle {
  margin-bottom: 0;
  font-size: 0.75rem;
  color: #94a3b8;
}

.weather-mini-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-green) 14%, transparent);
  color: var(--accent-green);
  font-size: 0.72rem;
  font-weight: 700;
}

.weather-hourly-strip {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
}

.weather-hourly-card {
  min-width: 0;
  padding: 10px 8px;
  border-radius: 12px;
  border: 1px solid #f1f5f9;
  background: #f8fafc;
  text-align: center;
  overflow: hidden;
}

.weather-hourly-card--safe {
  background: #ecfdf5;
  border-color: #a7f3d0;
}

.weather-hourly-card--warn {
  background: #fff7ed;
  border-color: #fed7aa;
}

.weather-hourly-card--risk {
  background: #fef2f2;
  border-color: #fecaca;
}

.weather-hourly-time {
  font-size: 0.625rem;
  font-weight: 700;
  color: #94a3b8;
}

.weather-hourly-main {
  margin-top: 2px;
  font-size: 0.875rem;
  font-weight: 800;
  color: #0f172a;
}

.weather-hourly-sub,
.weather-hourly-meta {
  font-size: 0.58rem;
  color: #64748b;
  line-height: 1.2;
  white-space: normal;
  word-break: break-word;
}

.weather-hourly-meta:last-child {
  color: #ea580c;
  font-weight: 700;
}

.weather-air-card {
  display: grid;
  grid-template-columns: minmax(140px, 0.7fr) minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
  padding: 0;
  border-radius: 16px;
  background: transparent;
  border: 0;
}

.weather-air-value {
  margin: 0;
  font-size: 2.5rem;
  line-height: 0.95;
  letter-spacing: -0.04em;
  font-weight: 800;
  color: #1e293b;
}

.weather-air-main {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  justify-content: start;
  gap: 10px;
  padding: 8px 4px;
}

.weather-air-main .weather-air-sub {
  grid-column: 1 / -1;
  font-size: 0.72rem;
}

.weather-air-wind-icon {
  margin-bottom: 2px;
  color: #10b981;
}

.weather-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
}

.weather-side-head .weather-section-title {
  margin-bottom: 0;
}

.weather-air-status {
  padding: 6px 14px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #bbf7d0;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
}

.weather-air-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.weather-air-metrics span,
.weather-forecast-extra span {
  display: inline-flex;
  align-items: center;
  padding: 4px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-panel) 72%, transparent);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 0.62rem;
  white-space: nowrap;
}

.weather-air-metrics span {
  min-height: 66px;
  justify-content: center;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  border-radius: 14px;
  color: #1e293b;
  box-shadow: var(--shadow-card);
}

.weather-air-metrics b {
  color: #94a3b8;
  font-size: 0.58rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.weather-air-metrics strong {
  color: #1e293b;
  font-size: 0.82rem;
  font-weight: 800;
}

.weather-forecast-extra span:nth-child(n + 3) {
  display: none;
}

.weather-forecast-extra span {
  border: 0;
  background: transparent;
  padding: 0;
  color: #94a3b8;
  font-size: 0.625rem;
  font-weight: 600;
}

.weather-page :deep(.weather-forecast-card:first-child .weather-forecast-extra span) {
  color: #059669;
  font-weight: 800;
}

.weather-page :deep(.weather-forecast-card:not(:first-child) .weather-forecast-extra span:first-child) {
  color: #94a3b8;
}

.weather-history-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.weather-history-card {
  padding: 8px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  box-shadow: var(--shadow-card);
}

.weather-history-card .weather-history-label {
  font-size: 0.58rem;
  letter-spacing: 0.06em;
}

.weather-history-card .weather-history-value {
  font-size: 0.82rem;
}

.weather-history-card .weather-history-sub {
  font-size: 0.68rem;
}

.weather-forecast-extra {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 6px;
  margin-top: 3px;
  max-width: 170px;
  color: var(--text-secondary);
}

.weather-forecast-alert {
  display: none;
}

.weather-page :deep(.weather-current-icon) {
  width: 80px;
  height: 80px;
}

.weather-page :deep(.card-rounded) {
  padding: var(--space-md);
}

.weather-page :deep(.weather-block-title) {
  margin-bottom: 6px;
  font-size: 1.05rem;
  font-weight: 800;
}

.weather-fields-block > .weather-block-title,
.weather-recommendations > .weather-block-title {
  margin: 0 0 12px;
}

.weather-page :deep(.weather-block-subtitle) {
  margin-bottom: 10px;
  font-size: 0.85rem;
  color: #94a3b8;
}

.weather-page :deep(.weather-fields-list) {
  gap: 10px;
}

.weather-page :deep(.weather-field-mini) {
  padding: 12px 14px;
  gap: 8px;
}

.weather-page :deep(.weather-field-mini-extras) {
  padding-top: 8px;
}

.weather-map-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.weather-map-hint {
  margin: 0;
  padding: 0 2px;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--text-secondary);
  max-width: 48rem;
}

.weather-map-wrap :deep(.ymap-container) {
  height: 320px;
}

.ymap-picked-coords {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  padding: 8px 12px;
  background: var(--chip-bg);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.ymap-picked-coords-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.ymap-copy-coords-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.ymap-copy-coords-btn:hover {
  background: var(--bg-panel-hover);
  color: var(--text-primary);
  border-color: color-mix(in srgb, var(--accent-green) 35%, var(--border-color));
}

.ymap-copy-coords-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-green) 50%, transparent);
  outline-offset: 2px;
}

.header-weather {
  flex-wrap: wrap;
  gap: 8px;
}

.weather-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* Селект и кнопка: свои стили (классы .btn в проекте заданы только в других страницах со scoped) */
.weather-city-select {
  min-width: 168px;
  max-width: 100%;
  padding: 9px 36px 9px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background-color: var(--bg-panel);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25;
  cursor: pointer;
  min-height: 40px;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  box-shadow: var(--shadow-card);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.weather-city-select:hover {
  border-color: color-mix(in srgb, var(--accent-green) 35%, var(--border-color));
  background-color: var(--bg-panel-hover);
}

.weather-city-select:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-green) 22%, transparent);
}

.weather-city-select:focus-visible {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-green) 22%, transparent);
}

[data-theme='dark'] .weather-city-select {
  background-color: color-mix(in srgb, var(--bg-panel) 86%, black);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2' stroke-opacity='0.65'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
}

[data-theme='dark'] .weather-city-select:hover {
  background-color: color-mix(in srgb, var(--bg-panel) 92%, white);
}

[data-theme='dark'] .weather-page :deep(.weather-side-panel),
[data-theme='dark'] .weather-page :deep(.weather-insight-panel),
[data-theme='dark'] .weather-fields-block,
[data-theme='dark'] .weather-recommendations {
  background: var(--bg-panel);
  border-color: var(--border-color);
}

[data-theme='dark'] .weather-page :deep(.weather-forecast-card),
[data-theme='dark'] .weather-page :deep(.weather-indicator-card),
[data-theme='dark'] .weather-page :deep(.weather-hourly-card),
[data-theme='dark'] .weather-page :deep(.weather-air-metrics span),
[data-theme='dark'] .weather-history-card,
[data-theme='dark'] .weather-field-mini {
  background: var(--bg-panel-hover);
  border-color: color-mix(in srgb, var(--border-color) 60%, #1b3b2b);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--border-color) 30%, transparent),
    0 2px 8px rgba(0, 0, 0, 0.18);
}

[data-theme='dark'] .weather-page :deep(.weather-forecast-card img) {
  background: var(--bg-panel);
  box-shadow: none;
}

[data-theme='dark'] .weather-page :deep(.weather-indicator-card:hover),
[data-theme='dark'] .weather-page :deep(.weather-forecast-card:hover),
[data-theme='dark'] .weather-page :deep(.weather-hourly-card:hover),
[data-theme='dark'] .weather-field-link:hover,
[data-theme='dark'] .weather-air-metrics span:hover,
[data-theme='dark'] .weather-history-card:hover {
  border-color: color-mix(in srgb, var(--border-color) 45%, white);
}

[data-theme='dark'] .weather-page :deep(.weather-forecast-card:first-child),
[data-theme='dark'] .weather-page :deep(.weather-hourly-card--safe) {
  background: color-mix(in srgb, var(--accent-green) 18%, var(--bg-panel));
  border-color: color-mix(in srgb, var(--accent-green) 35%, var(--border-color));
}

[data-theme='dark'] .weather-page :deep(.weather-hourly-card--warn) {
  background: color-mix(in srgb, var(--warning-orange) 16%, var(--bg-panel));
  border-color: color-mix(in srgb, var(--warning-orange) 38%, var(--border-color));
}

[data-theme='dark'] .weather-page :deep(.weather-hourly-card--risk) {
  background: color-mix(in srgb, var(--danger-red) 16%, var(--bg-panel));
  border-color: color-mix(in srgb, var(--danger-red) 38%, var(--border-color));
}

[data-theme='dark'] .weather-agro-card {
  background: var(--bg-panel-hover);
  border-color: var(--border-color);
}

[data-theme='dark'] .weather-agro-card--ok {
  background: color-mix(in srgb, var(--accent-green) 14%, var(--bg-panel));
  border-color: color-mix(in srgb, var(--accent-green) 32%, var(--border-color));
}

[data-theme='dark'] .weather-agro-card--warn {
  background: color-mix(in srgb, var(--warning-orange) 14%, var(--bg-panel));
  border-color: color-mix(in srgb, var(--warning-orange) 32%, var(--border-color));
}

[data-theme='dark'] .weather-agro-card--risk {
  background: color-mix(in srgb, var(--danger-red) 14%, var(--bg-panel));
  border-color: color-mix(in srgb, var(--danger-red) 32%, var(--border-color));
}

[data-theme='dark'] .weather-page :deep(.weather-section-title),
[data-theme='dark'] .weather-page :deep(.weather-block-title),
[data-theme='dark'] .weather-field-mini-name,
[data-theme='dark'] .weather-field-mini-temp,
[data-theme='dark'] .weather-page :deep(.weather-indicator-value),
[data-theme='dark'] .weather-page :deep(.weather-air-value),
[data-theme='dark'] .weather-page :deep(.weather-history-value),
[data-theme='dark'] .weather-crop-item strong {
  color: var(--text-primary);
}

[data-theme='dark'] .weather-page :deep(.weather-block-subtitle),
[data-theme='dark'] .weather-page :deep(.weather-indicator-label),
[data-theme='dark'] .weather-page :deep(.weather-indicator-sub),
[data-theme='dark'] .weather-page :deep(.weather-forecast-date),
[data-theme='dark'] .weather-page :deep(.weather-forecast-extra span),
[data-theme='dark'] .weather-field-mini-crop,
[data-theme='dark'] .weather-field-mini-wind,
[data-theme='dark'] .weather-field-mini-extras,
[data-theme='dark'] .weather-crop-desc,
[data-theme='dark'] .weather-map-hint,
[data-theme='dark'] .weather-page :deep(.weather-air-sub),
[data-theme='dark'] .weather-page :deep(.weather-history-sub),
[data-theme='dark'] .weather-page :deep(.weather-air-metrics b) {
  color: var(--text-secondary);
}

[data-theme='dark'] .weather-page :deep(.weather-forecast-day),
[data-theme='dark'] .weather-page :deep(.weather-forecast-temps),
[data-theme='dark'] .weather-page :deep(.weather-air-metrics strong),
[data-theme='dark'] .weather-page :deep(.weather-history-value),
[data-theme='dark'] .weather-page :deep(.weather-air-status),
[data-theme='dark'] .weather-page :deep(.weather-crop-status),
[data-theme='dark'] .weather-field-mini-extra-em {
  color: var(--text-primary);
}

[data-theme='dark'] .weather-page :deep(.weather-forecast-card .weather-forecast-extra span:first-child),
[data-theme='dark'] .weather-page :deep(.weather-forecast-card .weather-forecast-extra span) {
  color: color-mix(in srgb, var(--text-secondary) 92%, white);
}

[data-theme='dark'] .weather-page :deep(.weather-forecast-card:first-child .weather-forecast-extra span:first-child) {
  color: color-mix(in srgb, var(--accent-green) 60%, white);
}

[data-theme='dark'] .weather-page :deep(.weather-air-label),
[data-theme='dark'] .weather-page :deep(.weather-history-label),
[data-theme='dark'] .weather-page :deep(.weather-agro-card-label),
[data-theme='dark'] .weather-page :deep(.weather-hourly-time),
[data-theme='dark'] .weather-page :deep(.weather-hourly-sub),
[data-theme='dark'] .weather-page :deep(.weather-hourly-meta) {
  color: color-mix(in srgb, var(--text-secondary) 95%, white);
}

[data-theme='dark'] .weather-page :deep(.weather-hourly-main) {
  color: var(--text-primary);
}

[data-theme='dark'] .weather-map-hint {
  color: color-mix(in srgb, var(--text-secondary) 90%, white);
}

[data-theme='dark'] .weather-page :deep(.weather-help-icon) {
  color: color-mix(in srgb, var(--text-secondary) 92%, white);
}

[data-theme='dark'] .weather-page :deep(.weather-progress) {
  background: color-mix(in srgb, var(--border-color) 70%, transparent);
}

[data-theme='dark'] .weather-page :deep(.weather-help-tooltip) {
  background: var(--bg-elevated);
  border-color: var(--border-color);
  color: var(--text-primary);
}


.weather-refresh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 18px;
  min-height: 40px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  border: 1px solid var(--accent-green);
  background: var(--accent-green);
  color: #fff;
  box-shadow: var(--shadow-card);
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    filter 0.2s ease,
    box-shadow 0.2s ease;
}

.weather-refresh-btn:hover {
  background: var(--accent-green-hover);
  border-color: var(--accent-green-hover);
  filter: brightness(1.03);
}

.weather-refresh-btn:focus {
  outline: none;
}

.weather-refresh-btn:focus-visible {
  outline: none;
  box-shadow:
    var(--shadow-card),
    0 0 0 3px color-mix(in srgb, var(--accent-green) 28%, transparent);
}

.weather-refresh-btn:active {
  filter: brightness(0.96);
}

.weather-forecast5 {
  padding: var(--space-lg);
}

.weather-forecast5-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-md);
  margin-top: var(--space-md);
}

.weather-forecast5-card {
  background: var(--chip-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: var(--space-md);
  text-align: center;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.weather-forecast5-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-card);
}

.weather-forecast5-card-alert {
  border-color: var(--danger-red);
  background: rgba(211, 60, 60, 0.08);
}

.weather-forecast5-day {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.weather-forecast5-icon {
  display: block;
  margin: 0 auto 8px;
}

.weather-forecast5-temps {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.weather-forecast5-alert {
  margin-top: 8px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--danger-red);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  line-height: 1.3;
}

.weather-detail-loading,
.weather-detail-error {
  color: var(--text-secondary);
  padding: var(--space-xl);
}

.weather-detail-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.weather-loading-long-hint {
  margin: 0;
  max-width: 420px;
  font-size: 0.85rem;
  line-height: 1.35;
  text-align: center;
  color: var(--text-secondary);
}

.weather-detail-error {
  color: var(--warning-orange);
}

@keyframes weatherFadeIn {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes weatherIconBreathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

.weather-anim-card {
  opacity: 0;
  animation: weatherFadeIn 0.5s ease forwards;
  animation-delay: var(--anim-delay, 0ms);
}

.weather-icon-breathe {
  animation: weatherIconBreathe 3s ease-in-out infinite;
}

.weather-param-card {
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.2s ease;
}

.weather-param-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-card);
}

.card-rounded {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: var(--space-lg);
  box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.15);
}

.weather-current-block {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--space-xl);
  align-items: center;
}

.weather-current-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.weather-current-city {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
}

.weather-current-datetime {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.weather-current-temp-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.weather-current-temp {
  font-size: 3rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
}

.weather-current-icon {
  width: 80px;
  height: 80px;
  object-fit: contain;
}

.weather-current-desc {
  font-size: 1rem;
  color: var(--text-secondary);
  text-transform: capitalize;
}

.weather-current-feels {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.weather-current-extra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.weather-current-coords {
  padding: var(--space-md);
  background: var(--chip-bg);
  border-radius: 10px;
  align-self: start;
  border: 1px solid var(--border-color);
}

.weather-params-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-md);
}

.weather-param-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: var(--space-md);
}

.weather-param-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.weather-param-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.weather-wind-warning {
  color: var(--warning-orange) !important;
}

.weather-extreme {
  color: var(--danger-red) !important;
}

.weather-block-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 var(--space-sm);
}

.weather-block-subtitle {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: 0 0 var(--space-md);
}

.weather-crops-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 18px;
}

.weather-crop-item {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  padding: 0;
  border-bottom: 0;
}

.weather-crop-item:last-child {
  border-bottom: none;
}

.weather-crop-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.35rem;
  font-weight: 400;
  flex-shrink: 0;
}

.weather-crop-icon.wheat {
  background: rgba(232, 197, 71, 0.25);
  color: var(--wheat-gold);
}

.weather-crop-icon.sunflower {
  background: rgba(244, 211, 94, 0.25);
  color: var(--corn-yellow);
}

.weather-crop-icon.corn {
  background: #d1fae5;
  color: #059669;
}

.weather-crop-status {
  display: inline-block;
  margin-left: 6px;
  padding: 0;
  border-radius: 999px;
  font-size: inherit;
  font-weight: 800;
  text-transform: none;
  letter-spacing: 0;
}

.weather-crop-status.ok {
  background: transparent;
  color: #059669;
}

.weather-crop-status.warn {
  background: transparent;
  color: #ea580c;
}

.weather-crop-status.risk {
  background: transparent;
  color: #dc2626;
}

.weather-crop-desc {
  margin: 3px 0 0 0;
  font-size: 0.88rem;
  line-height: 1.35;
  color: #94a3b8;
}

.weather-crop-item strong {
  color: #1e293b;
  font-size: 1.05rem;
  font-weight: 800;
}

/* Макетный размер шрифтов/иконок для блока рекомендаций */
.weather-recommendations .weather-block-title {
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 8px;
}

.weather-recommendations .weather-block-subtitle {
  font-size: 10px;
  line-height: 1.35;
  color: #94a3b8;
  margin: 0 0 24px;
}

.weather-recommendations .weather-crops-list {
  gap: 16px;
  margin-top: 0;
}

.weather-recommendations .weather-crop-item {
  gap: 16px;
}

.weather-recommendations .weather-crop-icon {
  width: 24px;
  height: 24px;
  font-size: 12px;
  font-weight: 700;
}

.weather-recommendations .weather-crop-item strong,
.weather-recommendations .weather-crop-status {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.25;
}

.weather-recommendations .weather-crop-status {
  margin-left: 4px;
}

.weather-recommendations .weather-crop-desc {
  margin: 2px 0 0;
  font-size: 9px;
  line-height: 1.35;
  color: #94a3b8;
}

.weather-dev-widget {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  padding: 14px;
  background: color-mix(in srgb, var(--chip-bg) 75%, transparent);
}

.weather-wip-loader {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
}

.weather-wip-loader path {
  stroke: #000;
  stroke-width: 0.6px;
  fill: none;
  animation:
    weather-wip-dash-array 4s ease-in-out infinite,
    weather-wip-dash-offset 4s linear infinite;
}

[data-theme='dark'] .weather-wip-loader path {
  stroke: rgba(255, 255, 255, 0.88);
}

@keyframes weather-wip-dash-array {
  0% { stroke-dasharray: 0 1 359 0; }
  50% { stroke-dasharray: 0 359 1 0; }
  100% { stroke-dasharray: 359 1 0 0; }
}

@keyframes weather-wip-dash-offset {
  0% { stroke-dashoffset: 365; }
  100% { stroke-dashoffset: 5; }
}

.weather-dev-widget-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
}

.weather-dev-widget-text {
  margin: 6px 0 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.weather-fields-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-md);
}

.weather-field-mini {
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  border-radius: 10px;
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.weather-field-mini-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.weather-field-link {
  text-decoration: none;
  color: inherit;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.weather-field-link:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-card);
  border-color: #e2e8f0;
}

.weather-field-mini-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.weather-field-mini-crop {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.weather-field-mini-weather {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
  flex-wrap: wrap;
}

.weather-field-mini-weather--loading {
  opacity: 0.88;
}

.weather-field-mini-temp {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.weather-field-mini-wind {
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: normal;
  word-break: break-word;
}

.weather-field-mini-wind.wind-strong {
  color: var(--warning-orange);
  font-weight: 700;
}

.weather-field-mini-extras {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin: 0;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--text-secondary);
}

.weather-field-mini-extra-em {
  font-weight: 600;
  color: var(--text-primary);
}

.weather-page .weather-sky {
  margin-bottom: var(--space-md);
}

@media (max-width: 1024px) {
  .weather-dashboard-layout {
    grid-template-columns: 1fr;
  }

  .weather-page :deep(.weather-indicators-grid) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .weather-page :deep(.weather-indicator-card--bottom) {
    grid-column: 1 / -1;
  }

  .weather-current-block {
    grid-template-columns: 1fr;
  }

  .weather-params-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .weather-insights-row {
    grid-template-columns: 1fr;
  }

  .weather-page :deep(.weather-hero-inner) {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .weather-page :deep(.weather-hero-temp-block) {
    padding: 0;
    margin-right: 0;
  }

  .weather-page :deep(.weather-recommendation-inline) {
    width: 100%;
  }

  .weather-hourly-strip {
    grid-auto-flow: column;
    grid-auto-columns: minmax(92px, 1fr);
    grid-template-columns: none;
    overflow-x: auto;
  }

  .weather-air-card {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .weather-history-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1280px) {
  .weather-page :deep(.weather-hero-inner) {
    grid-template-columns: minmax(150px, 0.85fr) minmax(220px, 1fr) minmax(200px, 0.95fr);
    gap: 14px;
  }

  .weather-page :deep(.weather-hero-temp-block) {
    margin-right: 6px;
  }

  .weather-page :deep(.weather-recommendation-inline p) {
    font-size: 0.88rem;
  }

  .weather-page :deep(.weather-recommendation-inline li) {
    font-size: 0.84rem;
  }
}

@media (max-width: 900px) {
  .weather-page :deep(.weather-indicators-grid) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .weather-page :deep(.weather-indicator-card--bottom) {
    grid-column: span 2;
  }

  .weather-forecast5-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .weather-page :deep(.weather-indicators-grid) {
    grid-template-columns: 1fr;
  }

  .weather-page :deep(.weather-indicator-card--bottom) {
    grid-column: span 1;
  }

  .weather-page :deep(.weather-indicator-value-sun) {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    font-size: 1.6rem;
  }

  .weather-page :deep(.weather-indicator-value-dew) {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    font-size: 1.6rem;
  }

  .weather-params-grid {
    grid-template-columns: 1fr;
  }

  .weather-fields-list {
    grid-template-columns: 1fr;
  }

  .weather-forecast5-grid {
    grid-template-columns: 1fr;
  }

  .weather-agro-grid,
  .weather-history-grid {
    grid-template-columns: 1fr;
  }

  .weather-air-card {
    grid-template-columns: 1fr;
  }

  .weather-air-metrics {
    justify-content: flex-start;
  }

  .weather-hourly-strip {
    grid-auto-columns: minmax(84px, 1fr);
  }

  .weather-page :deep(.weather-hero-city) {
    font-size: 1.35rem;
  }

  .weather-page :deep(.weather-hero-temp) {
    font-size: clamp(2rem, 10vw, 3rem);
  }

  .weather-page :deep(.weather-hero-desc) {
    font-size: 0.95rem;
  }

  .weather-page :deep(.weather-hero-datetime-sep) {
    display: none;
  }

  .weather-air-metrics,
  .weather-history-grid {
    grid-template-columns: 1fr;
  }

  .weather-recommendations .weather-crop-item {
    align-items: flex-start;
  }

  .weather-recommendations .weather-crop-item > div:last-child {
    min-width: 0;
  }

  .weather-recommendations .weather-crop-desc {
    word-break: break-word;
  }

  .header-weather {
    gap: var(--space-sm);
  }

  .weather-header-actions {
    width: 100%;
  }

  .weather-city-select {
    flex: 1;
    min-width: 0;
  }
}
</style>
