/**
 * Ссылки на вложенные файлы. Хранятся списком URL в текстовом поле формы,
 * поэтому подпись и признак картинки считаются по самой ссылке.
 *
 * Обе функции лежали в LandsPage и вызывались только из окон права владения и
 * землепользователя; при выносе окон в компоненты им понадобилось общее место.
 */

/** Ссылка ведёт на картинку — значит, можно показать мини-превью. */
export function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url)
}

/** Подпись файла — последний сегмент пути без строки запроса. */
export function fileLabelFromUrl(url: string): string {
  const noQuery = url.split('?')[0] ?? url
  const parts = noQuery.split('/')
  return parts.at(-1) || url
}
