import { describe, expect, it } from 'vitest'

import {
  type LatLon,
  contourSamplePoints,
  fromPolygonGeoJson,
  polygonCenter,
  toPolygonGeoJson,
} from './geoContour'

const SQUARE: LatLon[] = [
  [45, 40],
  [45, 41],
  [46, 41],
  [46, 40],
]

describe('polygonCenter', () => {
  it('среднее по широте и долготе', () => {
    expect(polygonCenter(SQUARE)).toEqual({ lat: 45.5, lon: 40.5 })
  })

  it('пустой набор точек даёт null', () => {
    expect(polygonCenter([])).toBeNull()
  })
})

describe('toPolygonGeoJson', () => {
  it('меняет порядок на долготу-широту и замыкает кольцо', () => {
    expect(toPolygonGeoJson(SQUARE)).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [40, 45],
          [41, 45],
          [41, 46],
          [40, 46],
          [40, 45],
        ],
      ],
    })
  })

  it('уже замкнутое кольцо не замыкает повторно', () => {
    const closed: LatLon[] = [...SQUARE, [45, 40]]
    const out = toPolygonGeoJson(closed)
    expect(out!.coordinates[0]).toHaveLength(5)
  })

  it('меньше трёх точек — не полигон', () => {
    expect(toPolygonGeoJson([[45, 40]])).toBeNull()
    expect(
      toPolygonGeoJson([
        [45, 40],
        [45, 41],
      ]),
    ).toBeNull()
  })
})

describe('fromPolygonGeoJson', () => {
  const polygon = toPolygonGeoJson(SQUARE)!

  it('возвращает точки во внутреннем порядке без замыкающей', () => {
    expect(fromPolygonGeoJson(polygon)).toEqual(SQUARE)
  })

  it('без type: Polygon по умолчанию ничего не отдаёт', () => {
    const { coordinates } = polygon
    expect(fromPolygonGeoJson({ coordinates })).toEqual([])
  })

  it('с requireType: false читает контур без поля type — как это делает LandsPage', () => {
    const { coordinates } = polygon
    expect(fromPolygonGeoJson({ coordinates }, { requireType: false })).toEqual(SQUARE)
  })

  it('чужой тип геометрии не читается даже с requireType: false, если координат нет', () => {
    expect(fromPolygonGeoJson({ type: 'LineString' }, { requireType: false })).toEqual([])
  })

  it('пустое значение и мусор дают пустой список', () => {
    expect(fromPolygonGeoJson(null)).toEqual([])
    expect(fromPolygonGeoJson(undefined)).toEqual([])
    expect(fromPolygonGeoJson({ type: 'Polygon', coordinates: 'нет' } as never)).toEqual([])
    expect(fromPolygonGeoJson({ type: 'Polygon', coordinates: ['нет'] } as never)).toEqual([])
  })

  it('точки с нечисловыми координатами отсеиваются', () => {
    const broken = { type: 'Polygon', coordinates: [[[40, 45], ['x', 'y'], [41, 46]]] }
    expect(fromPolygonGeoJson(broken as never)).toEqual([
      [45, 40],
      [46, 41],
    ])
  })
})

describe('contourSamplePoints', () => {
  it('центр идёт первым, дальше точки контура', () => {
    const out = contourSamplePoints(SQUARE, { lat: 45.5, lon: 40.5 })
    expect(out[0]).toEqual({ lat: 45.5, lon: 40.5 })
    expect(out).toHaveLength(5)
  })

  it('без центра отдаёт только точки контура', () => {
    expect(contourSamplePoints(SQUARE, null)).toHaveLength(4)
  })

  it('на длинном контуре берёт пять точек, а не все', () => {
    const many: LatLon[] = Array.from({ length: 100 }, (_, i) => [45 + i / 1000, 40])
    expect(contourSamplePoints(many, null)).toHaveLength(5)
  })

  it('пусто и без центра — пустой список', () => {
    expect(contourSamplePoints([], null)).toEqual([])
  })
})
