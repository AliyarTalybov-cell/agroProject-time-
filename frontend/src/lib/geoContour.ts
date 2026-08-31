/**
 * Геометрия контура поля или земельного участка.
 *
 * Раньше эти функции лежали копиями в четырёх страницах и в компоненте карты:
 * `polygonCenter` — в трёх местах (в LandsPage под именем
 * `polygonCenterFromPoints`), `toPolygonGeoJson` — в трёх,
 * `fromPolygonGeoJson` — в четырёх, а типы `LatLon` и `PolygonGeoJson`
 * объявлялись заново в пяти файлах.
 *
 * Внутри проекта точка всегда `[широта, долгота]`, а в GeoJSON порядок
 * обратный — `[долгота, широта]`. Перестановка живёт только здесь, чтобы её
 * не приходилось помнить на каждой странице.
 */

/** Точка контура во внутреннем порядке: широта, долгота. */
export type LatLon = [number, number]

/** Полигон в том виде, в каком он хранится в базе. */
export type PolygonGeoJson = { type: 'Polygon'; coordinates: number[][][] }

/** Географический центр набора точек — среднее по широте и долготе. */
export function polygonCenter(points: LatLon[]): { lat: number; lon: number } | null {
  if (!points.length) return null
  const lat = points.reduce((sum, p) => sum + p[0], 0) / points.length
  const lon = points.reduce((sum, p) => sum + p[1], 0) / points.length
  return { lat, lon }
}

/**
 * Собрать полигон для записи в базу. Кольцо замыкается: если последняя точка
 * не совпадает с первой, первая дописывается в конец. Меньше трёх точек —
 * это не полигон, возвращается null.
 */
export function toPolygonGeoJson(points: LatLon[]): PolygonGeoJson | null {
  if (!Array.isArray(points) || points.length < 3) return null
  const ring = points.map(([lat, lon]) => [lon, lat])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (!first || !last) return null
  const closed = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, [first[0], first[1]]]
  return { type: 'Polygon', coordinates: [closed] }
}

/**
 * Разобрать полигон из базы во внутренние точки. Замыкающая точка кольца
 * отбрасывается: в интерфейсе она не нужна, редактор добавит её сам при
 * сохранении. Битые координаты отсеиваются.
 *
 * `requireType` — проверять ли поле `type: 'Polygon'`. По умолчанию да, но
 * LandsPage читает контуры участков, у которых этого поля может не быть, и
 * передаёт `false`. Раньше это различие было спрятано в том, что у страницы
 * лежала своя копия функции без проверки.
 */
export function fromPolygonGeoJson(
  geojson: PolygonGeoJson | Record<string, unknown> | null | undefined,
  options: { requireType?: boolean } = {},
): LatLon[] {
  const { requireType = true } = options
  if (!geojson) return []
  if (requireType && geojson.type !== 'Polygon') return []
  const coordinates = (geojson as { coordinates?: unknown }).coordinates
  if (!Array.isArray(coordinates)) return []
  const ring = coordinates[0]
  if (!Array.isArray(ring)) return []
  const points = (ring as unknown[])
    .map((p) => (Array.isArray(p) && p.length >= 2 ? ([Number(p[1]), Number(p[0])] as LatLon) : null))
    .filter((p): p is LatLon => Boolean(p && Number.isFinite(p[0]) && Number.isFinite(p[1])))
  if (points.length >= 2) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first && last && first[0] === last[0] && first[1] === last[1]) return points.slice(0, -1)
  }
  return points
}

/**
 * Несколько точек контура для обратного геокодирования: центр и пять точек,
 * равномерно разложенных по кольцу. Пять, а не все, чтобы не отправлять
 * лишние запросы к геокодеру на контуре из сотни вершин.
 *
 * LandsPage берёт выборку иначе — первые шесть точек подряд — и поэтому
 * держит свою функцию у себя. Сводить их значило бы менять поведение одной
 * из страниц вслепую.
 */
export function contourSamplePoints(
  points: LatLon[],
  center: { lat: number; lon: number } | null,
): Array<{ lat: number; lon: number }> {
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
