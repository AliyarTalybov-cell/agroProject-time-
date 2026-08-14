/** Парсит строку вида "55.7558, 37.6173" из поля геолокации. */
export function parseLatLonFromGeolocationString(raw: string | null | undefined): { lat: number; lon: number } | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const parts = s.split(',').map((p) => Number(p.trim()))
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null
  return { lat: parts[0], lon: parts[1] }
}

/** Обратное геокодирование через загруженный API Карт (ymaps.geocode). */
export async function resolveYandexAddressLine(lat: number, lon: number): Promise<string> {
  const ymaps = (window as typeof window & { ymaps?: any }).ymaps
  if (!ymaps?.geocode) return ''
  try {
    const res = await ymaps.geocode([lat, lon], { results: 1 })
    const first = res?.geoObjects?.get?.(0)
    if (!first) return ''
    return first.getAddressLine?.() || first.properties?.get?.('text') || ''
  } catch (e) {
    console.error('[yandexGeocode] error:', e)
    return ''
  }
}

/**
 * Возвращает список уникальных адресов-кандидатов по набору точек (например центр + вершины контура).
 * Первый в списке обычно наиболее релевантен (ближе к центру).
 */
export async function resolveYandexAddressCandidates(
  points: Array<{ lat: number; lon: number }>,
  maxCandidates: number = 8,
): Promise<string[]> {
  const ymaps = (window as typeof window & { ymaps?: any }).ymaps
  if (!ymaps?.geocode || !Array.isArray(points) || points.length === 0) return []

  const unique = new Set<string>()
  const addCandidate = (value: unknown) => {
    const s = String(value ?? '').trim()
    if (!s) return
    unique.add(s)
  }

  try {
    for (const p of points) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue
      const res = await ymaps.geocode([p.lat, p.lon], { results: 2 })
      const list = res?.geoObjects
      const len = Number(list?.getLength?.() ?? 0)
      for (let i = 0; i < len; i += 1) {
        const obj = list.get(i)
        addCandidate(obj?.getAddressLine?.() || obj?.properties?.get?.('text'))
        if (unique.size >= maxCandidates) return [...unique].slice(0, maxCandidates)
      }
    }
  } catch (e) {
    console.error('[yandexGeocode candidates] error:', e)
  }

  return [...unique].slice(0, maxCandidates)
}
