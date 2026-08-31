import { describe, expect, it } from 'vitest'

import {
  TSV_SEP,
  buildDelimitedContent,
  buildXlsHtml,
  escapeDelimitedCell,
  escapeHtml,
} from './tableExport'

/**
 * Проверки написаны так, чтобы поймать расхождение с прежним поведением
 * страниц: ожидаемые строки повторяют то, что давали копии этих функций,
 * лежавшие в LandsPage, FieldsPage, EquipmentPage, TaskManagementPage,
 * GrainAccountingPage и WarehouseBatchRegistryPage.
 */

describe('escapeHtml', () => {
  it('обезвреживает угловые скобки и амперсанд', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;')
  })

  it('null и undefined дают пустую строку, а не текст "null"', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })

  it('числа и логические значения приводит к тексту', () => {
    expect(escapeHtml(0)).toBe('0')
    expect(escapeHtml(false)).toBe('false')
  })
})

describe('escapeDelimitedCell', () => {
  it('обычное значение остаётся без кавычек', () => {
    expect(escapeDelimitedCell('Поле №3')).toBe('Поле №3')
  })

  it('перевод строки схлопывается в пробел', () => {
    expect(escapeDelimitedCell('первая\nвторая')).toBe('первая вторая')
    expect(escapeDelimitedCell('первая\r\nвторая')).toBe('первая вторая')
  })

  it('кавычки удваиваются, и ячейка берётся в кавычки', () => {
    expect(escapeDelimitedCell('сорт "Дон"')).toBe('"сорт ""Дон"""')
  })

  it('ячейка с разделителем берётся в кавычки', () => {
    expect(escapeDelimitedCell(`а${TSV_SEP}б`)).toBe(`"а${TSV_SEP}б"`)
    expect(escapeDelimitedCell('а;б', ';')).toBe('"а;б"')
  })

  it('разделитель учитывается тот, который передали', () => {
    // При табе точка с запятой — обычный символ и кавычек не требует.
    expect(escapeDelimitedCell('а;б')).toBe('а;б')
  })

  it('null и undefined дают пустую ячейку', () => {
    expect(escapeDelimitedCell(null)).toBe('')
    expect(escapeDelimitedCell(undefined)).toBe('')
  })
})

describe('buildDelimitedContent', () => {
  it('ставит BOM, разделяет строки CRLF и экранирует ячейки', () => {
    const out = buildDelimitedContent(
      ['№', 'Название'],
      [
        ['1', 'Поле'],
        ['2', 'сорт "Дон"'],
      ],
    )
    expect(out).toBe('\uFEFF№\tНазвание\r\n1\tПоле\r\n2\t"сорт ""Дон"""')
  })

  it('без строк остаётся только шапка', () => {
    expect(buildDelimitedContent(['А', 'Б'], [])).toBe('\uFEFFА\tБ')
  })

  it('принимает другой разделитель', () => {
    expect(buildDelimitedContent(['А', 'Б'], [['1', '2']], ';')).toBe('\uFEFFА;Б\r\n1;2')
  })
})

describe('buildXlsHtml', () => {
  it('повторяет разметку, которую страницы отдавали Excel', () => {
    expect(buildXlsHtml(['А'], [['<b>1</b>']])).toBe(
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"' +
        ' xmlns:x="urn:schemas-microsoft-com:office:excel"' +
        ' xmlns="http://www.w3.org/TR/REC-html40">' +
        '<head><meta charset="utf-8"></head><body><table border="1">' +
        '<thead><tr><th>А</th></tr></thead>' +
        '<tbody><tr><td>&lt;b&gt;1&lt;/b&gt;</td></tr></tbody>' +
        '</table></body></html>',
    )
  })
})
