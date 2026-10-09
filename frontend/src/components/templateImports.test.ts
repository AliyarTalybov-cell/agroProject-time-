import { describe, expect, it } from 'vitest'

/**
 * Компонент в разметке без импорта Vue рисует неизвестным тегом, а vue-tsc
 * этого не замечает: так однажды перестали открываться все окна раздела «Земли».
 * Тест проверяет, что каждый тег с заглавной буквы где-то объявлен в <script>.
 */
const sources = import.meta.glob<string>('/src/**/*.vue', { query: '?raw', import: 'default', eager: true })
const GLOBAL = new Set(['RouterLink', 'RouterView', 'Transition', 'TransitionGroup', 'Teleport', 'KeepAlive', 'Suspense', 'Component'])

describe('компоненты в разметке импортированы', () => {
  it('нет тегов без импорта', () => {
    const problems: string[] = []
    for (const [file, source] of Object.entries(sources)) {
      const start = source.indexOf('<template')
      if (start < 0) continue
      const script = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
      const tags = new Set([...source.slice(start).matchAll(/<([A-Z][A-Za-z0-9]+)/g)].map((m) => m[1]))
      const missing = [...tags].filter((tag) => !GLOBAL.has(tag) && !new RegExp(`\\b${tag}\\b`).test(script))
      if (missing.length) problems.push(`${file}: ${missing.join(', ')}`)
    }
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    expect(problems).toEqual([])
  })
})
