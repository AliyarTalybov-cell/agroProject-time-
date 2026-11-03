import type { Ref } from 'vue'

const same = (a: string, b: string) => a.trim().toLocaleLowerCase('ru') === b.trim().toLocaleLowerCase('ru')

/**
 * Найти значение по названию в списке или создать его и дописать в список.
 * Пригодно и для локальных списков страниц, не только для общего хранилища.
 */
export async function findOrCreate<T>(
  items: Ref<T[]>,
  name: string,
  labelOf: (row: T) => string,
  create: (name: string) => Promise<T>,
): Promise<T> {
  const clean = name.trim()
  if (!clean) throw new Error('Введите название.')
  const existing = items.value.find((row) => same(labelOf(row), clean))
  if (existing) return existing
  const row = await create(clean)
  items.value = [...items.value, row]
  return row
}
