const ALLOWED_TAGS = new Set([
  'P',
  'BR',
  'H2',
  'H3',
  'H4',
  'DIV',
  'SPAN',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'FIGURE',
  'FIGCAPTION',
  'HR',
  'PRE',
  'CODE',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'A',
  'IMG',
])

function isSafeHref(value: string): boolean {
  const href = value.trim()
  if (!href) return false
  if (href.startsWith('#') || href.startsWith('/')) return true
  return /^(https?:|mailto:|tel:)/i.test(href)
}

function isSafeImageSrc(value: string): boolean {
  const src = value.trim()
  if (!src) return false
  if (src.startsWith('/')) return true
  return /^https?:/i.test(src)
}

function sanitizeElementAttributes(el: HTMLElement): void {
  if (el.tagName === 'A') {
    const href = el.getAttribute('href') || ''
    if (!isSafeHref(href)) {
      el.removeAttribute('href')
    }
    el.setAttribute('target', '_blank')
    el.setAttribute('rel', 'noopener noreferrer')
    ;['style', 'class', 'id'].forEach((attr) => el.removeAttribute(attr))
    return
  }

  if (el.tagName === 'IMG') {
    const src = el.getAttribute('src') || ''
    if (!isSafeImageSrc(src)) {
      el.remove()
      return
    }
    if (!el.getAttribute('alt')) el.setAttribute('alt', 'Изображение новости')
    const imageSize = el.getAttribute('data-size')
    const normalizedSize = imageSize === '50' || imageSize === '75' || imageSize === '100' ? imageSize : '100'
    el.setAttribute('data-size', normalizedSize)
    const widthRaw = el.getAttribute('width')
    const width = Number.parseInt(widthRaw || '', 10)
    if (Number.isFinite(width) && width >= 120 && width <= 1400) {
      el.setAttribute('width', String(width))
    } else {
      el.removeAttribute('width')
    }
    el.setAttribute('loading', 'lazy')
    ;['style', 'class', 'id', 'height', 'srcset', 'sizes'].forEach((attr) => el.removeAttribute(attr))
    return
  }

  Array.from(el.attributes).forEach((attr) => {
    if (attr.name !== 'title') el.removeAttribute(attr.name)
  })
}

function sanitizeNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) return
  if (node.nodeType !== Node.ELEMENT_NODE) {
    node.parentNode?.removeChild(node)
    return
  }

  const el = node as HTMLElement
  const tag = el.tagName
  if (!ALLOWED_TAGS.has(tag)) {
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
    return
  }

  sanitizeElementAttributes(el)
  Array.from(el.childNodes).forEach((child) => sanitizeNode(child))
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
  const parser = new DOMParser()
  const doc = parser.parseFromString(rawHtml, 'text/html')
  Array.from(doc.body.childNodes).forEach((node) => sanitizeNode(node))
  return doc.body.innerHTML.trim()
}

export function looksLikeHtml(content: string): boolean {
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(content)
}

export function plainNewsTextToHtml(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
  return blocks.join('')
}

export function normalizeNewsContentToHtml(content: string): string {
  const source = (content || '').trim()
  if (!source) return ''
  if (looksLikeHtml(source)) return sanitizeNewsHtml(source)
  return sanitizeNewsHtml(plainNewsTextToHtml(source))
}

export function extractTextFromNewsHtml(html: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html || '', 'text/html')
  return (doc.body.textContent || '').trim()
}

export function hasMeaningfulNewsContent(html: string): boolean {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html || '', 'text/html')
  const plainText = (doc.body.textContent || '').trim()
  if (plainText.length > 0) return true
  return Boolean(doc.body.querySelector('img, hr'))
}
