import DOMPurify from 'dompurify'

/**
 * Санитайзер тела новости.
 *
 * Очистку выполняет DOMPurify, а не собственный обход дерева. Прежняя
 * реализация имела две дыры: атрибуты у `<img>` и `<a>` вычищались по чёрному
 * списку, из-за чего `onerror` и `onclick` доживали до вывода, а содержимое
 * запрещённого тега переносилось к родителю уже без повторной проверки.
 * Тело новости попадает в шаблон через `v-html`, так что обе давали хранимый XSS.
 *
 * Ниже DOMPurify отвечает за безопасность, а код в этом файле — только за
 * приведение разметки к принятому в проекте виду.
 */

const ALLOWED_TAGS = [
  'p', 'br', 'h2', 'h3', 'h4', 'div', 'span',
  'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption',
  'hr', 'pre', 'code', 'strong', 'b', 'em', 'i', 'u', 'a', 'img',
]

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'width', 'data-size', 'target', 'rel', 'loading']

/**
 * `ALLOWED_URI_REGEXP` здесь намеренно не задаётся. DOMPurify сверяет с этим
 * выражением значения всех атрибутов, а не только ссылочных, поэтому сужение
 * схем вырезает и обычные значения вроде `width="300"`. Схемы по умолчанию
 * блокируют `javascript:` в том числе в запутанном виде — проверено тестами.
 */
const PURIFY_CONFIG = { ALLOWED_TAGS, ALLOWED_ATTR } as const

/**
 * DOMPurify по умолчанию разрешает `data:`-ссылки для картинок. Как вектор
 * исполнения это не опасно (картинка не выполняет разметку), но проект такие
 * источники не использует, и в теле новости они означали бы либо мусор, либо
 * попытку что-то спрятать. Поэтому оставляем только http(s) и корневые пути.
 */
function isAllowedImageSrc(value: string): boolean {
  const src = value.trim()
  if (!src) return false
  if (src.startsWith('/')) return true
  return /^https?:/i.test(src)
}

/** Приводит уже очищенную разметку к виду, принятому в проекте. */
function normalizeElement(el: HTMLElement): void {
  if (el.tagName === 'A') {
    el.setAttribute('target', '_blank')
    el.setAttribute('rel', 'noopener noreferrer')
    return
  }

  if (el.tagName === 'IMG') {
    if (!isAllowedImageSrc(el.getAttribute('src') || '')) {
      el.remove()
      return
    }
    if (!el.getAttribute('alt')) el.setAttribute('alt', 'Изображение новости')

    const size = el.getAttribute('data-size')
    el.setAttribute('data-size', size === '50' || size === '75' ? size : '100')

    const width = Number.parseInt(el.getAttribute('width') || '', 10)
    if (Number.isFinite(width) && width >= 120 && width <= 1400) {
      el.setAttribute('width', String(width))
    } else {
      el.removeAttribute('width')
    }

    el.setAttribute('loading', 'lazy')
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function sanitizeNewsHtml(rawHtml: string): string {
  if (!rawHtml.trim()) return ''

  const clean = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG)
  if (!clean.trim()) return ''

  // Разметка уже безопасна — дальше только нормализация оформления.
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  doc.body.querySelectorAll('a, img').forEach((el) => normalizeElement(el as HTMLElement))
  return doc.body.innerHTML.trim()
}

export function looksLikeHtml(content: string): boolean {
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(content)
}

export function plainNewsTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function normalizeNewsContentToHtml(content: string): string {
  const source = (content || '').trim()
  if (!source) return ''
  if (looksLikeHtml(source)) return sanitizeNewsHtml(source)
  return sanitizeNewsHtml(plainNewsTextToHtml(source))
}

export function extractTextFromNewsHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  return (doc.body.textContent || '').trim()
}

export function hasMeaningfulNewsContent(html: string): boolean {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  if ((doc.body.textContent || '').trim().length > 0) return true
  return Boolean(doc.body.querySelector('img, hr'))
}
