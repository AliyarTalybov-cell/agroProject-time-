import { describe, expect, it } from 'vitest'
import { formatSupabaseError, NETWORK_ERROR_TEXT, PERMISSION_ERROR_TEXT } from './formatSupabaseError'

describe('formatSupabaseError', () => {
  it('сбой сети — понятная фраза вместо стека', () => {
    expect(formatSupabaseError({ message: 'TypeError: Failed to fetch', details: 'TypeError: Failed to fetch at http://…' })).toBe(NETWORK_ERROR_TEXT)
    expect(formatSupabaseError(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_TEXT)
    expect(formatSupabaseError(new TypeError('Load failed'))).toBe(NETWORK_ERROR_TEXT)
  })

  it('отказ политики доступа — фраза о правах', () => {
    expect(formatSupabaseError({ name: 'StorageApiError', message: 'new row violates row-level security policy' })).toBe(PERMISSION_ERROR_TEXT)
    expect(formatSupabaseError({ code: '42501', message: 'permission denied for table tasks' })).toBe(PERMISSION_ERROR_TEXT)
  })

  it('ошибка PostgREST — message, details и hint', () => {
    expect(formatSupabaseError({ message: 'нет прав', details: 'policy', hint: 'войдите' })).toBe('нет прав — policy — войдите')
  })

  it('обычная ошибка — её текст', () => {
    expect(formatSupabaseError(new Error('Не найдено'))).toBe('Не найдено')
  })
})
