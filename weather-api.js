/**
 * OpenWeatherMap API для панели агронома.
 * Вызов при каждой загрузке страницы и при смене города.
 */

const OPENWEATHER_BASE = "https://api.openweathermap.org/data/2.5/weather";
const APPID = "f8a7bf6a4c76418c05f1f818fd12375f";
const UNITS = "metric";
const LANG = "ru";

/** Направление ветра по градусам (0–360) → краткая подпись */
const WIND_DIRECTIONS = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];

function windDegToLabel(deg) {
  if (deg == null) return "—";
  const index = Math.round(((deg % 360) + 360) / 45) % 8;
  return WIND_DIRECTIONS[index];
}

/**
 * Формирует URL запроса по названию города и коду страны.
 * @param {string} city - например "Kursk"
 * @param {string} [countryCode] - например "ru"
 */
function buildWeatherUrl(city, countryCode = "ru") {
  const params = new URLSearchParams({
    q: `${city},${countryCode}`,
    APPID,
    units: UNITS,
    lang: LANG,
  });
  return `${OPENWEATHER_BASE}?${params.toString()}`;
}

/**
 * Парсит ответ API в нормализованный объект для виджета.
 * @param {object} raw - ответ OpenWeatherMap
 * @returns {object|null} нормализованные данные или null при ошибке
 */
function parseWeatherResponse(raw) {
  if (!raw || raw.cod !== 200) return null;

  const weather = raw.weather && raw.weather[0];
  const main = raw.main || {};
  const wind = raw.wind || {};
  const sys = raw.sys || {};
  const clouds = raw.clouds || {};

  const temp = main.temp != null ? Math.round(main.temp) : null;
  const feelsLike = main.feels_like != null ? Math.round(main.feels_like) : null;

  const tz = raw.timezone || 0;
  const sunrise = sys.sunrise
    ? new Date((sys.sunrise + tz) * 1000)
    : null;
  const sunset = sys.sunset
    ? new Date((sys.sunset + tz) * 1000)
    : null;

  const formatTime = (date) =>
    date
      ? `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`
      : "—";

  return {
    cityName: raw.name || "—",
    coord: {
      lon: raw.coord?.lon,
      lat: raw.coord?.lat,
    },
    temp,
    feelsLike,
    description: weather?.description ?? "—",
    icon: weather?.icon ?? "01d",
    humidity: main.humidity != null ? main.humidity : null,
    pressure: main.pressure != null ? main.pressure : null,
    seaLevel: main.sea_level != null ? main.sea_level : null,
    grndLevel: main.grnd_level != null ? main.grnd_level : null,
    visibility: raw.visibility != null ? raw.visibility : null,
    windSpeed: wind.speed != null ? wind.speed : null,
    windDeg: wind.deg != null ? wind.deg : null,
    windDirection: windDegToLabel(wind.deg),
    clouds: clouds.all != null ? clouds.all : null,
    sunrise: formatTime(sunrise),
    sunset: formatTime(sunset),
    dt: raw.dt,
    timezone: raw.timezone,
  };
}

/**
 * Загружает погоду по городу. Вызывать при загрузке страницы и при смене города.
 * @param {string} city - например "Kursk" или "Курск" (API принимает латиницу и кириллицу)
 * @param {string} [countryCode] - код страны, по умолчанию "ru"
 * @returns {Promise<object|null>} нормализованные данные или null при ошибке
 */
export async function fetchWeather(city, countryCode = "ru") {
  const url = buildWeatherUrl(city, countryCode);
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const raw = await response.json();
    return parseWeatherResponse(raw);
  } catch (e) {
    console.error("Weather API error:", e);
    return null;
  }
}

/**
 * URL иконки погоды OpenWeatherMap (2x).
 * @param {string} icon - код иконки, например "01d"
 */
export function getWeatherIconUrl(icon) {
  if (!icon) icon = "01d";
  return `https://openweathermap.org/img/wn/${icon}@2x.png`;
}

export { windDegToLabel, parseWeatherResponse };
