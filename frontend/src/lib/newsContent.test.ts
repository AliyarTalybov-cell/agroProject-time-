import { describe, expect, it } from 'vitest'

import {
  extractTextFromNewsHtml,
  hasMeaningfulNewsContent,
  looksLikeHtml,
  normalizeNewsContentToHtml,
  plainNewsTextToHtml,
  sanitizeNewsHtml,
} from './newsContent'

/**
 * Тело новости выводится через `v-html`, поэтому дыра в санитайзере — это
 * сразу хранимый XSS: разметку сохраняет один пользователь, а исполняется она
 * у всех читателей. Сценарии ниже повторяют те, что были проверены вручную
 * при замене самописного санитайзера на DOMPurify.
 */

/** Признаки того, что через очистку прошло что-то исполняемое. */
function assertNoExecutableMarkup(html: string): void {
  expect(html).not.toMatch(/<script/i)
  expect(html).not.toMatch(/<iframe/i)
  expect(html).not.toMatch(/<svg/i)
  expect(html).not.toMatch(/<style/i)
  expect(html).not.toMatch(/\son\w+\s*=/i)
  expect(html).not.toMatch(/javascript\s*:/i)
}

describe('sanitizeNewsHtml — векторы XSS', () => {
  it('срезает onerror, оставляя саму картинку', () => {
    const html = sanitizeNewsHtml('<img src="/photo.png" onerror="alert(1)">')

    expect(html).toContain('<img')
    expect(html).not.toContain('onerror')
    assertNoExecutableMarkup(html)
  })

  it('срезает onclick у ссылки', () => {
    const html = sanitizeNewsHtml('<a href="/page" onclick="alert(1)">текст</a>')

    expect(html).toContain('текст')
    expect(html).not.toContain('onclick')
    assertNoExecutableMarkup(html)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'JAVASCRIPT:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
  ])('вырезает ссылку со схемой %j', (href) => {
    const html = sanitizeNewsHtml(`<a href="${href}">клик</a>`)

    expect(html).toContain('клик')
    expect(html).not.toMatch(/href\s*=\s*"[^"]*script/i)
    assertNoExecutableMarkup(html)
  })

  it('не пропускает опасное содержимое, обёрнутое в неизвестный тег', () => {
    // Прежняя реализация переносила содержимое запрещённого тега к родителю
    // без повторной проверки — именно так дыра и открывалась.
    const html = sanitizeNewsHtml('<xss-wrapper><img src="/photo.png" onerror="alert(1)"></xss-wrapper>')

    expect(html).not.toContain('xss-wrapper')
    expect(html).not.toContain('onerror')
    assertNoExecutableMarkup(html)
  })

  it('удаляет script вместе с его содержимым', () => {
    const html = sanitizeNewsHtml('<p>до</p><script>alert(1)</script><p>после</p>')

    expect(html).toContain('до')
    expect(html).toContain('после')
    expect(html).not.toContain('alert')
    assertNoExecutableMarkup(html)
  })

  it('удаляет svg вместе со вложенным script', () => {
    const html = sanitizeNewsHtml('<svg><script>alert(1)</script></svg><p>текст</p>')

    expect(html).toContain('текст')
    expect(html).not.toContain('alert')
    assertNoExecutableMarkup(html)
  })

  it('удаляет iframe', () => {
    const html = sanitizeNewsHtml('<iframe src="https://example.com/evil"></iframe><p>текст</p>')

    expect(html).toContain('текст')
    expect(html).not.toContain('example.com')
    assertNoExecutableMarkup(html)
  })

  it('удаляет style вместе с @import', () => {
    // Порядок важен: <style> в самом начале ввода парсер уносит в head,
    // и проверка прошла бы мимо тела. После абзаца тег остаётся в body.
    const html = sanitizeNewsHtml('<p>текст</p><style>@import url("https://example.com/evil.css");</style>')

    expect(html).toContain('текст')
    expect(html).not.toContain('@import')
    assertNoExecutableMarkup(html)
  })

  it('не принимает data:-источник у картинки', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
    const html = sanitizeNewsHtml(`<img src="${png}"><p>текст</p>`)

    expect(html).toContain('текст')
    expect(html).not.toContain('data:')
    expect(html).not.toContain('<img')
  })

  it('срезает style-атрибут: его нет в списке разрешённых', () => {
    const html = sanitizeNewsHtml('<p style="background:url(javascript:alert(1))">текст</p>')

    expect(html).toContain('текст')
    expect(html).not.toContain('style=')
    assertNoExecutableMarkup(html)
  })
})

describe('sanitizeNewsHtml — нормализация оформления', () => {
  it('открывает ссылки в новой вкладке и проставляет rel', () => {
    const html = sanitizeNewsHtml('<a href="https://example.com">сайт</a>')

    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('оставляет картинку с корневым путём и с http(s)', () => {
    expect(sanitizeNewsHtml('<img src="/upload/a.png">')).toContain('<img')
    expect(sanitizeNewsHtml('<img src="https://example.com/a.png">')).toContain('<img')
  })

  it('удаляет картинку с относительным путём без ведущего слэша', () => {
    expect(sanitizeNewsHtml('<img src="a.png">')).not.toContain('<img')
  })

  it('подставляет alt и ленивую загрузку', () => {
    const html = sanitizeNewsHtml('<img src="/a.png">')

    expect(html).toContain('alt="Изображение новости"')
    expect(html).toContain('loading="lazy"')
  })

  it('не затирает уже заданный alt', () => {
    expect(sanitizeNewsHtml('<img src="/a.png" alt="Поле">')).toContain('alt="Поле"')
  })

  it.each([
    ['50', '50'],
    ['75', '75'],
    ['100', '100'],
    ['13', '100'],
    ['', '100'],
  ])('приводит data-size %j к %j', (given, expected) => {
    const attr = given ? ` data-size="${given}"` : ''
    expect(sanitizeNewsHtml(`<img src="/a.png"${attr}>`)).toContain(`data-size="${expected}"`)
  })

  it('оставляет ширину в допустимых пределах и убирает выходящую за них', () => {
    expect(sanitizeNewsHtml('<img src="/a.png" width="600">')).toContain('width="600"')
    expect(sanitizeNewsHtml('<img src="/a.png" width="10">')).not.toContain('width=')
    expect(sanitizeNewsHtml('<img src="/a.png" width="9000">')).not.toContain('width=')
    expect(sanitizeNewsHtml('<img src="/a.png" width="широко">')).not.toContain('width=')
  })

  it('возвращает пустую строку на пустом и на полностью вырезанном вводе', () => {
    expect(sanitizeNewsHtml('')).toBe('')
    expect(sanitizeNewsHtml('   ')).toBe('')
    expect(sanitizeNewsHtml('<script>alert(1)</script>')).toBe('')
  })
})

describe('plainNewsTextToHtml', () => {
  it('экранирует разметку, введённую как обычный текст', () => {
    const html = plainNewsTextToHtml('<script>alert(1)</script>')

    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('разбивает на абзацы по пустой строке и переносит одиночные', () => {
    expect(plainNewsTextToHtml('первый\n\nвторой')).toBe('<p>первый</p><p>второй</p>')
    expect(plainNewsTextToHtml('строка\nещё')).toBe('<p>строка<br>ещё</p>')
  })
})

describe('looksLikeHtml', () => {
  it('отличает разметку от текста', () => {
    expect(looksLikeHtml('<p>текст</p>')).toBe(true)
    expect(looksLikeHtml('обычный текст')).toBe(false)
    expect(looksLikeHtml('1 < 2 и 3 > 2')).toBe(false)
  })
})

describe('normalizeNewsContentToHtml', () => {
  it('обычный текст оборачивает в абзац с экранированием', () => {
    const html = normalizeNewsContentToHtml('цена 5 < 7, всё в порядке')

    expect(html).toBe('<p>цена 5 &lt; 7, всё в порядке</p>')
  })

  it('ввод, похожий на разметку, идёт в санитайзер, а не в экранирование', () => {
    // Развилка по looksLikeHtml: строку со script разбирают как разметку,
    // поэтому тег вырезается целиком, а не превращается в видимый текст.
    expect(normalizeNewsContentToHtml('<script>alert(1)</script>')).toBe('')
  })

  it('разметку прогоняет через санитайзер', () => {
    const html = normalizeNewsContentToHtml('<p onclick="alert(1)">текст</p>')

    expect(html).toContain('текст')
    expect(html).not.toContain('onclick')
  })

  it('пустой ввод даёт пустую строку', () => {
    expect(normalizeNewsContentToHtml('')).toBe('')
    expect(normalizeNewsContentToHtml('   ')).toBe('')
  })
})

describe('extractTextFromNewsHtml и hasMeaningfulNewsContent', () => {
  it('вытаскивает текст без тегов', () => {
    expect(extractTextFromNewsHtml('<p>первый</p><p>второй</p>')).toBe('первыйвторой')
    expect(extractTextFromNewsHtml('')).toBe('')
  })

  it('считает содержательными текст, картинку и разделитель', () => {
    expect(hasMeaningfulNewsContent('<p>текст</p>')).toBe(true)
    expect(hasMeaningfulNewsContent('<img src="/a.png">')).toBe(true)
    expect(hasMeaningfulNewsContent('<hr>')).toBe(true)
  })

  it('пустую разметку содержательной не считает', () => {
    expect(hasMeaningfulNewsContent('<p></p>')).toBe(false)
    expect(hasMeaningfulNewsContent('')).toBe(false)
  })
})
