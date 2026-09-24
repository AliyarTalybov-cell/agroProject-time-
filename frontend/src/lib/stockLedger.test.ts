import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: null, isSupabaseConfigured: () => false }))

import {
  computeCreditedWeight,
  formatTons,
  isIncomingDocType,
  parseDecimalInput,
  stockDocTypeLabel,
  stockPurposeLabel,
} from './stockLedger'

/**
 * Зачётный вес должен совпадать с прежней формой приёмки (WarehouseCellPage):
 * там же формула, округление каждого шага до 0,01 т и отсечка в ноль.
 */
describe('computeCreditedWeight', () => {
  it('при базовой влажности и без примесей зачётный вес равен массе', () => {
    expect(
      computeCreditedWeight({
        massTons: 222,
        moisturePercent: 14,
        baseMoisturePercent: 14,
        weedImpurityPercent: 0,
        grainImpurityPercent: 0,
      }),
    ).toEqual({ dryMassTons: 222, impurityLossTons: 0, netTons: 222 })
  })

  it('влажное зерно с примесями: сушка, потом вычет примесей', () => {
    // 100 × (100 − 18) / (100 − 14) = 95,35; примеси 100 × (2 + 1,5) / 100 = 3,5
    expect(
      computeCreditedWeight({
        massTons: 100,
        moisturePercent: 18,
        baseMoisturePercent: 14,
        weedImpurityPercent: 2,
        grainImpurityPercent: 1.5,
      }),
    ).toEqual({ dryMassTons: 95.35, impurityLossTons: 3.5, netTons: 91.85 })
  })

  it('сухое зерно даёт зачётный вес больше физической массы — как и было', () => {
    const r = computeCreditedWeight({
      massTons: 50,
      moisturePercent: 12,
      baseMoisturePercent: 14,
      weedImpurityPercent: 0,
      grainImpurityPercent: 0,
    })
    expect(r?.netTons).toBe(51.16)
  })

  it('не уходит в минус при огромных примесях', () => {
    const r = computeCreditedWeight({
      massTons: 10,
      moisturePercent: 14,
      baseMoisturePercent: 14,
      weedImpurityPercent: 80,
      grainImpurityPercent: 40,
    })
    expect(r?.netTons).toBe(0)
  })

  it('незаполненные или невозможные значения — null, а не число', () => {
    const base = { massTons: 10, moisturePercent: 14, baseMoisturePercent: 14, weedImpurityPercent: 0, grainImpurityPercent: 0 }
    expect(computeCreditedWeight({ ...base, massTons: null })).toBeNull()
    expect(computeCreditedWeight({ ...base, moisturePercent: 100 })).toBeNull()
    expect(computeCreditedWeight({ ...base, weedImpurityPercent: -1 })).toBeNull()
    expect(computeCreditedWeight({ ...base, baseMoisturePercent: 100 })).toBeNull()
  })
})

describe('parseDecimalInput', () => {
  it('понимает запятую, точку и пробелы в тысячах', () => {
    expect(parseDecimalInput('12,5')).toBe(12.5)
    expect(parseDecimalInput('12.5')).toBe(12.5)
    expect(parseDecimalInput('1 217,16')).toBe(1217.16)
  })

  it('пустое и мусор — null', () => {
    expect(parseDecimalInput('')).toBeNull()
    expect(parseDecimalInput('  ')).toBeNull()
    expect(parseDecimalInput('abc')).toBeNull()
    expect(parseDecimalInput(null)).toBeNull()
  })
})

describe('подписи', () => {
  it('виды документов, назначения и ячейки по-русски, неизвестное — как есть', () => {
    expect(stockDocTypeLabel('sale')).toBe('Продажа')
    expect(stockDocTypeLabel('opening')).toBe('Ввод остатков')
    expect(stockDocTypeLabel('xxx')).toBe('xxx')
    expect(stockPurposeLabel('export')).toBe('На экспорт')
  })

  it('приход — только приёмка и ввод остатков', () => {
    expect(isIncomingDocType('intake')).toBe(true)
    expect(isIncomingDocType('opening')).toBe(true)
    expect(isIncomingDocType('transfer')).toBe(false)
  })

  it('тонны форматируются по-русски', () => {
    expect(formatTons(1217.16).replace(/\s/g, ' ')).toBe('1 217,16 т')
    expect(formatTons(0)).toBe('0 т')
  })
})
