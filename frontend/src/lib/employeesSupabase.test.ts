import { describe, expect, it } from 'vitest'
import { describeFunctionError } from './employeesSupabase'

describe('describeFunctionError', () => {
  it('отказ 403 — про права, с причиной из ответа функции', async () => {
    const context = new Response(JSON.stringify({ error: 'Только руководитель' }), { status: 403 })
    const err = await describeFunctionError({ message: 'Edge Function returned a non-2xx status code', context })
    expect(err.message).toBe('Нет прав на это действие: Только руководитель')
  })

  it('сервер недоступен — без технических слов', async () => {
    const err = await describeFunctionError({ message: 'Failed to send a request to the Edge Function' })
    expect(err.message).toBe('Сервер не отвечает. Проверьте подключение и попробуйте ещё раз.')
  })

  it('прочая ошибка — причина из ответа', async () => {
    const context = new Response(JSON.stringify({ error: 'Почта уже занята' }), { status: 400 })
    const err = await describeFunctionError({ message: 'Edge Function returned a non-2xx status code', context })
    expect(err.message).toBe('Почта уже занята')
  })
})
