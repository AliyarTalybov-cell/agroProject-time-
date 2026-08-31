/**
 * Общая механика выгрузки реестров в таблицу и PDF.
 *
 * Раньше эти функции лежали копиями в страницах: `escapeHtml` — в шести,
 * экранирование ячейки разделителя — в шести (под именами `escapeCsvCell`,
 * `escapeXlsCell` и `escapeDelimitedCell`), `downloadBlob` — в двух, а
 * пересчёт canvas в страницу PDF повторялся байт в байт в пяти. Из-за этого
 * правка формата выгрузки требовала одинаковых правок в шести местах, и
 * любое пропущенное давало расхождение между отчётами.
 *
 * Здесь собрано только то, что во всех страницах совпадало дословно.
 * Осознанно НЕ вынесено: разметка таблицы для PDF (в проекте два разных
 * оформления — со сплошной рамкой и с рамкой на ячейках, плюс разные ширины
 * и цвета шапки) и способ выдачи готового файла (часть страниц скачивает
 * его, часть открывает во вкладке). Это различия по существу, а не
 * расхождения копий, и сводить их — отдельное решение.
 */

import type { jsPDF } from 'jspdf'

import { loadPdfTools } from '@/lib/pdfExport'

/** Экземпляр документа jsPDF. Импорт типа стирается при сборке и не тянет библиотеку в бандл. */
type PdfDoc = InstanceType<typeof jsPDF>

/** Разделитель по умолчанию: таб. Excel открывает такой файл без диалога импорта. */
export const TSV_SEP = '\t'

/** Экранирование текста для вставки в HTML — через textContent, без ручных замен. */
export function escapeHtml(value: unknown): string {
  const div = document.createElement('div')
  div.textContent = String(value ?? '')
  return div.innerHTML
}

/**
 * Ячейка для файла с разделителями. Переводы строк схлопываются в пробел,
 * кавычки удваиваются, и вся ячейка берётся в кавычки, если внутри есть
 * разделитель, кавычка или возврат каретки.
 */
export function escapeDelimitedCell(value: unknown, sep: string = TSV_SEP): string {
  const s = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '""')
  return s.includes(sep) || s.includes('"') || s.includes('\r') ? `"${s}"` : s
}

/**
 * Содержимое файла с разделителями: BOM в начале, чтобы Excel распознал
 * UTF-8, и CRLF между строками.
 */
export function buildDelimitedContent(
  headers: readonly unknown[],
  rows: readonly (readonly unknown[])[],
  sep: string = TSV_SEP,
): string {
  const line = (arr: readonly unknown[]) => arr.map((v) => escapeDelimitedCell(v, sep)).join(sep)
  return '\uFEFF' + [line(headers), ...rows.map((r) => line(r))].join('\r\n')
}

/**
 * Разметка книги для Excel: HTML-таблица с офисными пространствами имён.
 * Excel открывает такой файл как лист, сохраняя колонки.
 */
export function buildXlsHtml(headers: readonly unknown[], rows: readonly (readonly unknown[])[]): string {
  const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const bodyRows = rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`
}

/** Отдать пользователю готовый blob как файл. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Скачать реестр файлом с разделителями. */
export function downloadDelimited(
  headers: readonly unknown[],
  rows: readonly (readonly unknown[])[],
  filename: string,
  sep: string = TSV_SEP,
): void {
  const content = buildDelimitedContent(headers, rows, sep)
  downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8' }), filename)
}

/** Скачать реестр книгой Excel. */
export function downloadXls(
  headers: readonly unknown[],
  rows: readonly (readonly unknown[])[],
  filename: string,
): void {
  const html = buildXlsHtml(headers, rows)
  downloadBlob(new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }), filename)
}

/**
 * Снять с элемента картинку и уложить её на один альбомный лист A4, вписав
 * по большей стороне. Элемент не удаляется — уборкой занимается вызывающий
 * код, у страниц она разная.
 */
export async function renderTablePdfFitPage(el: HTMLElement): Promise<PdfDoc> {
  const { html2canvas, jsPDF } = await loadPdfTools()
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false })
  const imgData = canvas.toDataURL('image/png')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 10
  const maxW = pageW - margin * 2
  const maxH = pageH - margin * 2
  let w = maxW
  let h = (canvas.height / canvas.width) * w
  if (h > maxH) {
    h = maxH
    w = (canvas.width / canvas.height) * h
  }
  doc.addImage(imgData, 'PNG', margin, margin, w, h)
  return doc
}

/** Открыть готовый PDF в новой вкладке. Ссылку на объект отзываем через минуту, дав вкладке открыться. */
export function openPdfInNewTab(doc: PdfDoc): void {
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
