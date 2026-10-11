import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { describeFunctionError } from '@/lib/employeesSupabase'
import { fetchForecast5, fetchWeather } from '@/lib/weatherApi'
import { useWeatherCity } from '@/composables/useWeatherCity'

export type AssistantMessage = { role: 'user' | 'assistant'; content: string }

type WeatherSnapshot = { city?: string; now?: string; days?: string[] }

let weatherCache: { at: number; value: WeatherSnapshot | null } | null = null

/**
 * Погода для помощника — одной строкой «сейчас» и по строке на день.
 * Берём город со страницы «Погода»; если погода недоступна (бывает без VPN),
 * помощник просто скажет, что данных нет.
 */
async function weatherSnapshot(): Promise<WeatherSnapshot | null> {
  if (weatherCache && Date.now() - weatherCache.at < 15 * 60_000) return weatherCache.value
  let value: WeatherSnapshot | null = null
  try {
    const { city, country } = useWeatherCity()
    const now = await fetchWeather(city(), country())
    if (now) {
      const parts = [
        now.temp != null ? `${now.temp}°C` : '',
        now.description,
        now.windSpeed != null ? `ветер ${now.windSpeed} м/с` : '',
        now.humidity != null ? `влажность ${now.humidity}%` : '',
        now.precipitation ? `осадки ${now.precipitation} мм` : '',
      ].filter(Boolean)
      value = { city: now.cityName, now: parts.join(', ') }
      if (now.coord?.lat != null && now.coord?.lon != null) {
        const days = await fetchForecast5(now.coord.lat, now.coord.lon).catch(() => [])
        value.days = days.map((d) =>
          [
            `${d.dateLabel} (${d.dayLabel})`,
            `${d.tempMin}…${d.tempMax}°C`,
            d.condition,
            d.windSpeed != null ? `ветер ${d.windSpeed} м/с` : '',
            d.windGusts != null ? `порывы ${d.windGusts} м/с` : '',
            `вероятность осадков ${Math.round(d.pop)}%`,
            d.precipitationSum ? `${d.precipitationSum} мм` : '',
          ]
            .filter(Boolean)
            .join(', '),
        )
      }
    }
  } catch {
    value = null
  }
  weatherCache = { at: Date.now(), value }
  return value
}

function localYmd(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Вопрос помощнику. Ключ ИИ живёт только на сервере, в функции ai-assistant. */
export async function askAssistant(question: string, history: AssistantMessage[]): Promise<string> {
  if (!isSupabaseConfigured() || !supabase) throw new Error('Supabase не настроен')
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Требуется авторизация')

  const now = new Date()
  const { data, error } = await supabase.functions.invoke('ai-assistant', {
    body: {
      accessToken: session.access_token,
      question,
      history: history.slice(-8),
      today: localYmd(now),
      now: now.toTimeString().slice(0, 5),
      tzOffset: now.getTimezoneOffset(),
      weather: await weatherSnapshot(),
    },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) {
    const e = await describeFunctionError(error)
    // Функция ещё не развёрнута на сервере.
    if (/404|not found/i.test(e.message)) throw new Error('Помощник ещё не подключён на сервере.')
    if (e.message.startsWith('Нет прав')) throw new Error('Нет доступа к помощнику.')
    throw e
  }
  const answer = data && typeof data === 'object' ? String((data as { answer?: unknown }).answer ?? '') : ''
  if (!answer) throw new Error(String((data as { error?: unknown })?.error ?? 'Пустой ответ'))
  return answer
}
