const OPENMETEO_TIMEOUT_MS = 20000

export type WeatherData = {
  cityName: string
  condition: string
  coord: { lon?: number; lat?: number }
  temp: number | null
  feelsLike: number | null
  description: string
  icon: string
  humidity: number | null
  pressure: number | null
  seaLevel: number | null
  grndLevel: number | null
  visibility: number | null
  windSpeed: number | null
  windDeg: number | null
  windDirection: string
  clouds: number | null
  precProbability: number | null
  sunrise: string
  sunset: string
  dt: number
  timezone: number
  uvIndex?: number | null
  soilTemperature?: number | null
  soilMoisture?: number | null
  leafWetnessIndex?: boolean | null
  precType?: number | null
  precStrength?: number | null
  isThunder?: boolean | null
  dewPoint?: number | null
  kpIndex?: number | null
  meanSeaLevelPressure?: number | null
  altitude?: number | null
  pressureNorm?: number | null
  windGusts?: number | null
  precipitation?: number | null
  rain?: number | null
  showers?: number | null
  vapourPressureDeficit?: number | null
  apparentPressure?: number | null
}


async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}


import { RUSSIAN_CITIES } from './cities'

export async function fetchWeather(cityOrLat: string | number, lonOrNull: number | string = 'ru'): Promise<WeatherData | null> {
  // По умолчанию ставим координаты Москвы, они переопределятся при наличии cityOrLat
  let lat = 55.7558;
  let lon = 37.6173;
  let label = typeof cityOrLat === 'string' ? cityOrLat : 'Локация пользователя';

  if (typeof cityOrLat === 'number' && typeof lonOrNull === 'number') {
    lat = cityOrLat;
    lon = lonOrNull;
  } else if (typeof cityOrLat === 'string') {
    // Ищем город в нашем словаре
    const cityData = RUSSIAN_CITIES.find(c => c.value.startsWith(cityOrLat));
    if (cityData) {
      lat = cityData.lat;
      lon = cityData.lon;
      label = cityData.label; // Переводим на русский (например, "Москва" вместо "Moscow")
    }
  }

  const direct = await fetchWeatherFallback(lat, lon, label)
  if (direct) {
    setCachedWeather(lat, lon, direct)
    return direct
  }
  return getCachedWeather(lat, lon)
}

export function getWeatherIconUrl(iconOrUrl: string): string {
  // Поскольку GraphQL сразу отдает абсолютный URL SVG, возвращаем как есть 
  if (iconOrUrl && (iconOrUrl.startsWith('http') || iconOrUrl.startsWith('data:'))) {
    return iconOrUrl
  }
  return `https://yastatic.net/weather/i/icons/funky/dark/${iconOrUrl}.svg`
}

/** Короткая подпись погоды для компактных карточек (категория после parseCondition). */
export function conditionCategoryLabelRu(category: string): string {
  const c = (category || 'clear').toLowerCase()
  const map: Record<string, string> = {
    clear: 'Ясно',
    clouds: 'Облачно',
    rain: 'Дождь',
    snow: 'Снег',
    thunderstorm: 'Гроза',
  }
  return map[c] ?? '—'
}

// ——— Прогноз на 5 дней (по дням) ———
export type ForecastDayItem = {
  date: string
  dayLabel: string
  dateLabel: string
  tempMin: number
  tempMax: number
  icon: string
  condition: string
  windSpeed: number | null
  pop: number
  alert?: string
  precipitationSum?: number | null
  precipitationHours?: number | null
  windGusts?: number | null
  windDirection?: string
  uvIndexMax?: number | null
  sunshineDuration?: number | null
  daylightDuration?: number | null
  shortwaveRadiationSum?: number | null
  evapotranspiration?: number | null
  apparentTempMin?: number | null
  apparentTempMax?: number | null
}

export type WeatherHourlyInsight = {
  time: string
  hourLabel: string
  precipitationProbability: number | null
  precipitation: number | null
  windGusts: number | null
  dewPoint: number | null
  vapourPressureDeficit: number | null
  soilTemperature: number | null
  soilMoisture: number | null
  uvIndex: number | null
}

export type WeatherAirQuality = {
  europeanAqi: number | null
  pm10: number | null
  pm25: number | null
  ozone: number | null
  dust: number | null
  uvIndex: number | null
}

export type WeatherHistorySummary = {
  startDate: string
  endDate: string
  precipitationSum: number | null
  rainyDays: number
  evapotranspirationSum: number | null
  tempMin: number | null
  tempMax: number | null
}

export type WeatherInsights = {
  hourly: WeatherHourlyInsight[]
  daily: ForecastDayItem[]
  airQuality: WeatherAirQuality | null
  history: WeatherHistorySummary | null
}

type ForecastCacheEntry = {
  savedAt: number
  items: ForecastDayItem[]
}

type WeatherCacheEntry = {
  savedAt: number
  item: WeatherData
}

type WeatherInsightsCacheEntry = {
  savedAt: number
  item: WeatherInsights
}

const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000
const weatherCacheByCoords = new Map<string, WeatherCacheEntry>()

const FORECAST_CACHE_TTL_MS = 30 * 60 * 1000
const forecastCacheByCoords = new Map<string, ForecastCacheEntry>()

const WEATHER_INSIGHTS_CACHE_TTL_MS = 30 * 60 * 1000
const weatherInsightsCacheByCoords = new Map<string, WeatherInsightsCacheEntry>()

function forecastCacheKey(lat: number, lon: number): string {
  // Округляем, чтобы близкие координаты не создавали лишние ключи
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

function weatherCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

function getCachedWeather(lat: number, lon: number): WeatherData | null {
  const key = weatherCacheKey(lat, lon)
  const cached = weatherCacheByCoords.get(key)
  if (!cached) return null
  if (Date.now() - cached.savedAt > WEATHER_CACHE_TTL_MS) {
    weatherCacheByCoords.delete(key)
    return null
  }
  return cached.item
}

function setCachedWeather(lat: number, lon: number, item: WeatherData | null) {
  if (!item) return
  const key = weatherCacheKey(lat, lon)
  weatherCacheByCoords.set(key, { savedAt: Date.now(), item })
}

function getCachedForecast(lat: number, lon: number): ForecastDayItem[] | null {
  const key = forecastCacheKey(lat, lon)
  const cached = forecastCacheByCoords.get(key)
  if (!cached) return null
  if (Date.now() - cached.savedAt > FORECAST_CACHE_TTL_MS) {
    forecastCacheByCoords.delete(key)
    return null
  }
  return cached.items
}

function setCachedForecast(lat: number, lon: number, items: ForecastDayItem[]) {
  if (!items.length) return
  const key = forecastCacheKey(lat, lon)
  forecastCacheByCoords.set(key, { savedAt: Date.now(), items })
}

function getCachedWeatherInsights(lat: number, lon: number): WeatherInsights | null {
  const key = weatherCacheKey(lat, lon)
  const cached = weatherInsightsCacheByCoords.get(key)
  if (!cached) return null
  if (Date.now() - cached.savedAt > WEATHER_INSIGHTS_CACHE_TTL_MS) {
    weatherInsightsCacheByCoords.delete(key)
    return null
  }
  return cached.item
}

function setCachedWeatherInsights(lat: number, lon: number, item: WeatherInsights | null) {
  if (!item) return
  const key = weatherCacheKey(lat, lon)
  weatherInsightsCacheByCoords.set(key, { savedAt: Date.now(), item })
}

export async function fetchForecast5(lat: number, lon: number): Promise<ForecastDayItem[]> {
  const direct = await fetchForecast5Fallback(lat, lon)
  if (direct.length) {
    setCachedForecast(lat, lon, direct)
    return direct
  }
  return getCachedForecast(lat, lon) ?? []
}

// ——— Open-Meteo fallback на случай отказа Yandex ———

const OPENMETEO_FORECAST = 'https://api.open-meteo.com/v1/forecast'
const OPENMETEO_AIR_QUALITY = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const OPENMETEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const WIND_DIRECTIONS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ']

type OpenMeteoWeatherMeta = {
  condition: string
  description: string
  icon: string
}

function windDegToLabel(deg: number | null | undefined): string {
  if (deg == null) return '—'
  const index = Math.round(((deg % 360) + 360) / 45) % 8
  return WIND_DIRECTIONS[index]
}

function openMeteoWeatherMeta(code: number | null | undefined, isDay = true): OpenMeteoWeatherMeta {
  if (code == null) {
    return { condition: 'clear', description: '—', icon: openMeteoIconDataUrl('clear', isDay) }
  }
  if (code === 0) {
    return { condition: 'clear', description: 'Ясно', icon: openMeteoIconDataUrl('clear', isDay) }
  }
  if ([1, 2, 3].includes(code)) {
    return { condition: 'clouds', description: 'Переменная облачность', icon: openMeteoIconDataUrl('clouds', isDay) }
  }
  if ([45, 48].includes(code)) {
    return { condition: 'clouds', description: 'Туман', icon: openMeteoIconDataUrl('fog', isDay) }
  }
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return { condition: 'rain', description: 'Дождь', icon: openMeteoIconDataUrl('rain', isDay) }
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return { condition: 'snow', description: 'Снег', icon: openMeteoIconDataUrl('snow', isDay) }
  }
  if ([95, 96, 99].includes(code)) {
    return { condition: 'thunderstorm', description: 'Гроза', icon: openMeteoIconDataUrl('thunderstorm', isDay) }
  }
  return { condition: 'clear', description: '—', icon: openMeteoIconDataUrl('clear', isDay) }
}

function formatOpenMeteoTime(value: string | null | undefined): string {
  if (!value) return '—'
  const time = value.split('T')[1]
  return time ? time.slice(0, 5) : '—'
}

function roundNullable(value: unknown, digits = 0): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function formatHourLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const time = value.split('T')[1]
  return time ? time.slice(0, 5) : '—'
}

function isoDateShift(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function openMeteoIconDataUrl(condition: string, isDay: boolean): string {
  const sun = isDay ? '#f59e0b' : '#e5e7eb'
  const cloud = isDay ? '#94a3b8' : '#cbd5e1'
  const rain = '#38bdf8'
  const snow = '#93c5fd'
  const bolt = '#facc15'
  const fog = '#94a3b8'
  const svgByCondition: Record<string, string> = {
    clear: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="14" fill="${sun}"/><path d="M32 8v8M32 48v8M8 32h8M48 32h8M15 15l6 6M43 43l6 6M49 15l-6 6M21 43l-6 6" stroke="${sun}" stroke-width="4" stroke-linecap="round"/></svg>`,
    clouds: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="23" cy="25" r="10" fill="${sun}" opacity=".9"/><path d="M19 43h31a9 9 0 0 0 0-18h-2.2A16 16 0 0 0 17 31.5 6.5 6.5 0 0 0 19 43Z" fill="${cloud}"/></svg>`,
    rain: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M18 39h32a9 9 0 0 0 0-18h-2.5A16 16 0 0 0 17 28.5 7 7 0 0 0 18 39Z" fill="${cloud}"/><path d="M23 47l-3 7M33 47l-3 7M43 47l-3 7" stroke="${rain}" stroke-width="4" stroke-linecap="round"/></svg>`,
    snow: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M18 39h32a9 9 0 0 0 0-18h-2.5A16 16 0 0 0 17 28.5 7 7 0 0 0 18 39Z" fill="${cloud}"/><circle cx="24" cy="50" r="3" fill="${snow}"/><circle cx="34" cy="54" r="3" fill="${snow}"/><circle cx="44" cy="50" r="3" fill="${snow}"/></svg>`,
    thunderstorm: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M18 39h32a9 9 0 0 0 0-18h-2.5A16 16 0 0 0 17 28.5 7 7 0 0 0 18 39Z" fill="${cloud}"/><path d="M34 39l-7 13h8l-4 10 13-16h-8l5-7z" fill="${bolt}"/></svg>`,
    fog: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M16 25h33M12 36h40M18 47h28" stroke="${fog}" stroke-width="5" stroke-linecap="round"/></svg>`,
  }
  const svg = svgByCondition[condition] ?? svgByCondition.clear
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

async function fetchWeatherFallback(lat: number, lon: number, cityName: string): Promise<WeatherData | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,pressure_msl,cloud_cover,visibility,precipitation,rain,showers,dew_point_2m,vapour_pressure_deficit,soil_temperature_0cm,soil_moisture_0_to_1cm,is_day',
    daily: 'sunrise,sunset',
    timezone: 'auto',
    forecast_days: '1',
    wind_speed_unit: 'ms',
  })

  try {
    const response = await fetchWithTimeout(`${OPENMETEO_FORECAST}?${params.toString()}`, { method: 'GET' }, OPENMETEO_TIMEOUT_MS)
    if (!response.ok) return null

    const raw = await response.json()
    const current = raw.current ?? {}
    const meta = openMeteoWeatherMeta(current.weather_code, current.is_day !== 0)
    const pressure = current.surface_pressure != null ? Math.round(current.surface_pressure) : null

    return {
      cityName,
      condition: meta.condition,
      coord: { lon, lat },
      temp: current.temperature_2m != null ? Math.round(current.temperature_2m) : null,
      feelsLike: current.apparent_temperature != null ? Math.round(current.apparent_temperature) : null,
      description: meta.description,
      icon: meta.icon,
      humidity: current.relative_humidity_2m ?? null,
      pressure,
      seaLevel: current.pressure_msl != null ? Math.round(current.pressure_msl) : null,
      grndLevel: pressure,
      visibility: current.visibility ?? null,
      windSpeed: current.wind_speed_10m ?? null,
      windDeg: current.wind_direction_10m ?? null,
      windDirection: windDegToLabel(current.wind_direction_10m),
      clouds: current.cloud_cover ?? null,
      precProbability: 0,
      sunrise: formatOpenMeteoTime(raw.daily?.sunrise?.[0]),
      sunset: formatOpenMeteoTime(raw.daily?.sunset?.[0]),
      dt: Math.floor(Date.now() / 1000),
      timezone: raw.utc_offset_seconds ?? 0,
      uvIndex: null,
      soilTemperature: roundNullable(current.soil_temperature_0cm, 1),
      soilMoisture: roundNullable(current.soil_moisture_0_to_1cm, 3),
      leafWetnessIndex: null,
      dewPoint: roundNullable(current.dew_point_2m, 1),
      meanSeaLevelPressure: current.pressure_msl != null ? Math.round(current.pressure_msl) : null,
      windGusts: roundNullable(current.wind_gusts_10m, 1),
      precipitation: roundNullable(current.precipitation, 1),
      rain: roundNullable(current.rain, 1),
      showers: roundNullable(current.showers, 1),
      vapourPressureDeficit: roundNullable(current.vapour_pressure_deficit, 2),
      apparentPressure: pressure,
    }
  } catch (error) {
    console.error('Open-Meteo Fallback error:', error)
    return null
  }
}

async function fetchForecast5Fallback(lat: number, lon: number): Promise<ForecastDayItem[]> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_hours,precipitation_probability_max,weather_code,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunshine_duration,daylight_duration,shortwave_radiation_sum,et0_fao_evapotranspiration',
    timezone: 'auto',
    forecast_days: '5',
    wind_speed_unit: 'ms',
  })

  try {
    const response = await fetchWithTimeout(`${OPENMETEO_FORECAST}?${params.toString()}`, { method: 'GET' }, OPENMETEO_TIMEOUT_MS)
    if (!response.ok) return []

    const raw = await response.json()
    const daily = raw.daily ?? {}
    const dates: string[] = daily.time ?? []
    const dayLabels = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    const monthNames: Record<number, string> = { 1: 'Янв', 2: 'Фев', 3: 'Мар', 4: 'Апр', 5: 'Май', 6: 'Июн', 7: 'Июл', 8: 'Авг', 9: 'Сен', 10: 'Окт', 11: 'Ноя', 12: 'Дек' }

    return dates.slice(0, 5).map((dateStr, index) => {
      const d = new Date(dateStr + 'T12:00:00Z')
      const meta = openMeteoWeatherMeta(daily.weather_code?.[index])
      const windSpeed = daily.wind_speed_10m_max?.[index] ?? null
      const windGusts = roundNullable(daily.wind_gusts_10m_max?.[index], 1)
      const precipitationSum = roundNullable(daily.precipitation_sum?.[index], 1)
      const alert =
        windGusts != null && windGusts > 12
          ? 'СИЛЬНЫЕ ПОРЫВЫ ВЕТРА'
          : windSpeed != null && windSpeed > 12
            ? 'СИЛЬНЫЙ ВЕТЕР ОТЛОЖИТЕ УБОРКУ'
            : precipitationSum != null && precipitationSum > 8
              ? 'ОЖИДАЮТСЯ ОСАДКИ'
              : undefined

      return {
        date: dateStr,
        dayLabel: dayLabels[d.getUTCDay()],
        dateLabel: `${d.getUTCDate()} ${monthNames[d.getUTCMonth() + 1]}`,
        tempMin: Math.round(daily.temperature_2m_min?.[index] ?? daily.temperature_2m_max?.[index] ?? 0),
        tempMax: Math.round(daily.temperature_2m_max?.[index] ?? daily.temperature_2m_min?.[index] ?? 0),
        icon: meta.icon,
        condition: meta.condition,
        windSpeed,
        pop: daily.precipitation_probability_max?.[index] ?? 0,
        alert,
        precipitationSum,
        precipitationHours: roundNullable(daily.precipitation_hours?.[index], 1),
        windGusts,
        windDirection: windDegToLabel(daily.wind_direction_10m_dominant?.[index]),
        uvIndexMax: roundNullable(daily.uv_index_max?.[index], 1),
        sunshineDuration: roundNullable(daily.sunshine_duration?.[index]),
        daylightDuration: roundNullable(daily.daylight_duration?.[index]),
        shortwaveRadiationSum: roundNullable(daily.shortwave_radiation_sum?.[index], 1),
        evapotranspiration: roundNullable(daily.et0_fao_evapotranspiration?.[index], 1),
        apparentTempMin: roundNullable(daily.apparent_temperature_min?.[index]),
        apparentTempMax: roundNullable(daily.apparent_temperature_max?.[index]),
      }
    })
  } catch (error) {
    console.error('Forecast Open-Meteo Fallback error:', error)
    return []
  }
}

async function fetchOpenMeteoForecastInsights(lat: number, lon: number): Promise<{ hourly: WeatherHourlyInsight[]; daily: ForecastDayItem[] }> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'precipitation_probability,precipitation,rain,showers,wind_gusts_10m,dew_point_2m,vapour_pressure_deficit,soil_temperature_0cm,soil_moisture_0_to_1cm,uv_index',
    daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_hours,precipitation_probability_max,weather_code,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunshine_duration,daylight_duration,shortwave_radiation_sum,et0_fao_evapotranspiration',
    timezone: 'auto',
    forecast_days: '5',
    forecast_hours: '24',
    wind_speed_unit: 'ms',
  })

  const response = await fetchWithTimeout(`${OPENMETEO_FORECAST}?${params.toString()}`, { method: 'GET' }, OPENMETEO_TIMEOUT_MS)
  if (!response.ok) return { hourly: [], daily: [] }

  const raw = await response.json()
  const hourly = raw.hourly ?? {}
  const times: string[] = hourly.time ?? []
  const daily = raw.daily ?? {}
  const dates: string[] = daily.time ?? []
  const dayLabels = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  const monthNames: Record<number, string> = { 1: 'Янв', 2: 'Фев', 3: 'Мар', 4: 'Апр', 5: 'Май', 6: 'Июн', 7: 'Июл', 8: 'Авг', 9: 'Сен', 10: 'Окт', 11: 'Ноя', 12: 'Дек' }

  return {
    hourly: times.slice(0, 24).map((time, index) => ({
      time,
      hourLabel: formatHourLabel(time),
      precipitationProbability: roundNullable(hourly.precipitation_probability?.[index]),
      precipitation: roundNullable(hourly.precipitation?.[index], 1),
      windGusts: roundNullable(hourly.wind_gusts_10m?.[index], 1),
      dewPoint: roundNullable(hourly.dew_point_2m?.[index], 1),
      vapourPressureDeficit: roundNullable(hourly.vapour_pressure_deficit?.[index], 2),
      soilTemperature: roundNullable(hourly.soil_temperature_0cm?.[index], 1),
      soilMoisture: roundNullable(hourly.soil_moisture_0_to_1cm?.[index], 3),
      uvIndex: roundNullable(hourly.uv_index?.[index], 1),
    })),
    daily: dates.slice(0, 5).map((dateStr, index) => {
      const d = new Date(dateStr + 'T12:00:00Z')
      const meta = openMeteoWeatherMeta(daily.weather_code?.[index])
      const windSpeed = daily.wind_speed_10m_max?.[index] ?? null
      const windGusts = roundNullable(daily.wind_gusts_10m_max?.[index], 1)
      const precipitationSum = roundNullable(daily.precipitation_sum?.[index], 1)
      const alert =
        windGusts != null && windGusts > 12
          ? 'СИЛЬНЫЕ ПОРЫВЫ ВЕТРА'
          : windSpeed != null && windSpeed > 12
            ? 'СИЛЬНЫЙ ВЕТЕР ОТЛОЖИТЕ УБОРКУ'
            : precipitationSum != null && precipitationSum > 8
              ? 'ОЖИДАЮТСЯ ОСАДКИ'
              : undefined

      return {
        date: dateStr,
        dayLabel: dayLabels[d.getUTCDay()],
        dateLabel: `${d.getUTCDate()} ${monthNames[d.getUTCMonth() + 1]}`,
        tempMin: Math.round(daily.temperature_2m_min?.[index] ?? daily.temperature_2m_max?.[index] ?? 0),
        tempMax: Math.round(daily.temperature_2m_max?.[index] ?? daily.temperature_2m_min?.[index] ?? 0),
        icon: meta.icon,
        condition: meta.condition,
        windSpeed,
        pop: daily.precipitation_probability_max?.[index] ?? 0,
        alert,
        precipitationSum,
        precipitationHours: roundNullable(daily.precipitation_hours?.[index], 1),
        windGusts,
        windDirection: windDegToLabel(daily.wind_direction_10m_dominant?.[index]),
        uvIndexMax: roundNullable(daily.uv_index_max?.[index], 1),
        sunshineDuration: roundNullable(daily.sunshine_duration?.[index]),
        daylightDuration: roundNullable(daily.daylight_duration?.[index]),
        shortwaveRadiationSum: roundNullable(daily.shortwave_radiation_sum?.[index], 1),
        evapotranspiration: roundNullable(daily.et0_fao_evapotranspiration?.[index], 1),
        apparentTempMin: roundNullable(daily.apparent_temperature_min?.[index]),
        apparentTempMax: roundNullable(daily.apparent_temperature_max?.[index]),
      }
    }),
  }
}

async function fetchOpenMeteoAirQuality(lat: number, lon: number): Promise<WeatherAirQuality | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'european_aqi,pm10,pm2_5,ozone,dust,uv_index',
    timezone: 'auto',
    forecast_days: '1',
  })

  try {
    const response = await fetchWithTimeout(`${OPENMETEO_AIR_QUALITY}?${params.toString()}`, { method: 'GET' }, OPENMETEO_TIMEOUT_MS)
    if (!response.ok) return null
    const raw = await response.json()
    const current = raw.current ?? {}
    return {
      europeanAqi: roundNullable(current.european_aqi),
      pm10: roundNullable(current.pm10, 1),
      pm25: roundNullable(current.pm2_5, 1),
      ozone: roundNullable(current.ozone, 1),
      dust: roundNullable(current.dust, 1),
      uvIndex: roundNullable(current.uv_index, 1),
    }
  } catch (error) {
    console.error('Open-Meteo Air Quality error:', error)
    return null
  }
}

async function fetchOpenMeteoHistorySummary(lat: number, lon: number): Promise<WeatherHistorySummary | null> {
  const endDate = isoDateShift(-1)
  const startDate = isoDateShift(-7)
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration',
    timezone: 'auto',
    wind_speed_unit: 'ms',
  })

  try {
    const response = await fetchWithTimeout(`${OPENMETEO_ARCHIVE}?${params.toString()}`, { method: 'GET' }, OPENMETEO_TIMEOUT_MS)
    if (!response.ok) return null
    const raw = await response.json()
    const daily = raw.daily ?? {}
    const precip: number[] = ((daily.precipitation_sum ?? []) as unknown[]).filter((v: unknown): v is number => typeof v === 'number' && Number.isFinite(v))
    const et0: number[] = ((daily.et0_fao_evapotranspiration ?? []) as unknown[]).filter((v: unknown): v is number => typeof v === 'number' && Number.isFinite(v))
    const tMin: number[] = ((daily.temperature_2m_min ?? []) as unknown[]).filter((v: unknown): v is number => typeof v === 'number' && Number.isFinite(v))
    const tMax: number[] = ((daily.temperature_2m_max ?? []) as unknown[]).filter((v: unknown): v is number => typeof v === 'number' && Number.isFinite(v))

    return {
      startDate,
      endDate,
      precipitationSum: precip.length ? roundNullable(precip.reduce((sum: number, value: number) => sum + value, 0), 1) : null,
      rainyDays: precip.filter((value: number) => value > 0.2).length,
      evapotranspirationSum: et0.length ? roundNullable(et0.reduce((sum: number, value: number) => sum + value, 0), 1) : null,
      tempMin: tMin.length ? Math.round(Math.min(...tMin)) : null,
      tempMax: tMax.length ? Math.round(Math.max(...tMax)) : null,
    }
  } catch (error) {
    console.error('Open-Meteo Archive error:', error)
    return null
  }
}

export async function fetchWeatherInsights(lat: number, lon: number): Promise<WeatherInsights | null> {
  const cached = getCachedWeatherInsights(lat, lon)
  if (cached) return cached

  try {
    const [forecast, airQuality, history] = await Promise.all([
      fetchOpenMeteoForecastInsights(lat, lon),
      fetchOpenMeteoAirQuality(lat, lon),
      fetchOpenMeteoHistorySummary(lat, lon),
    ])
    const insights: WeatherInsights = {
      hourly: forecast.hourly,
      daily: forecast.daily,
      airQuality,
      history,
    }
    setCachedWeatherInsights(lat, lon, insights)
    return insights
  } catch (error) {
    console.error('Weather insights error:', error)
    return cached
  }
}

