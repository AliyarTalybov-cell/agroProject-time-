import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbStarts: string[] = []
const insertOperation = vi.fn()
const insertDowntime = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: async () => ({ data: dbStarts.map((start_iso) => ({ start_iso })), error: null }),
        }),
      }),
    }),
  },
}))
vi.mock('@/lib/analyticsSupabase', () => ({ insertOperation, insertDowntime }))

const { syncPendingShift } = await import('./shiftSync')
const { loadOperations } = await import('./operationStorage')

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString()

function op(id: number, startISO: string, extra: Record<string, unknown> = {}) {
  return { id, employee: 'Иван', startISO, endISO: startISO, durationMinutes: 5, ...extra }
}

describe('syncPendingShift', () => {
  beforeEach(() => {
    localStorage.clear()
    dbStarts.length = 0
    insertOperation.mockReset().mockResolvedValue(undefined)
    insertDowntime.mockReset().mockResolvedValue(undefined)
  })

  it('старую запись, которая уже есть в базе, не отправляет повторно', async () => {
    const start = iso(60)
    dbStarts.push(start)
    localStorage.setItem('agro_ctrl:operations', JSON.stringify([op(1, start)]))
    const r = await syncPendingShift('u1', 'Иван')
    expect(insertOperation).not.toHaveBeenCalled()
    expect(r.sent).toBe(0)
    expect(loadOperations()[0].synced).toBe(true)
  })

  it('досылает потерянную старую запись и новую неотправленную', async () => {
    localStorage.setItem(
      'agro_ctrl:operations',
      JSON.stringify([op(1, iso(120)), op(2, iso(30), { userId: 'u1', synced: false })]),
    )
    const r = await syncPendingShift('u1', 'Иван')
    expect(insertOperation).toHaveBeenCalledTimes(2)
    expect(r).toEqual({ sent: 2, failed: 0 })
    expect(loadOperations().every((o) => o.synced === true)).toBe(true)
  })

  it('при сбое оставляет запись неотправленной', async () => {
    insertOperation.mockRejectedValue(new Error('Failed to fetch'))
    localStorage.setItem('agro_ctrl:operations', JSON.stringify([op(2, iso(30), { userId: 'u1', synced: false })]))
    const r = await syncPendingShift('u1', 'Иван')
    expect(r.failed).toBe(1)
    expect(loadOperations()[0].synced).toBe(false)
  })

  it('чужие записи на общем телефоне не трогает', async () => {
    localStorage.setItem('agro_ctrl:operations', JSON.stringify([op(3, iso(30), { userId: 'u2', synced: false })]))
    await syncPendingShift('u1', 'Иван')
    expect(insertOperation).not.toHaveBeenCalled()
  })
})
