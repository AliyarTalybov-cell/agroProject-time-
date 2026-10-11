import { ref, type Ref } from 'vue'
import { askConfirm } from '@/composables/useConfirm'
import { promptText } from '@/composables/usePromptText'
import { isSupabaseConfigured } from '@/lib/supabase'

/** Общие для всех справочников раздела: идёт запрос и последняя ошибка. */
export type RefCrudState = { busy: Ref<boolean>; error: Ref<string | null> }

type Options<T> = {
  items: Ref<T[]>
  /** Поле-ключ (по умолчанию id). */
  key?: string
  /** Поле с названием (по умолчанию name). */
  field?: string
  /** Заголовок окна переименования. */
  promptTitle: string
  /** Чего касаются ошибки: «тип земли», «культуру»… */
  errors: { add: string; update: string; remove: string }
  create: (name: string) => Promise<T>
  update: (row: T, name: string) => Promise<unknown>
  remove: (row: T) => Promise<unknown>
}

export function errorText(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message
  const m = (e as { message?: unknown } | null)?.message
  return typeof m === 'string' && m ? m : fallback
}

/**
 * Добавить / переименовать / удалить значение простого справочника.
 * Раньше у каждого из двадцати справочников был свой набор таких функций.
 */
export function useRefCrud<T>(o: Options<T>, state: RefCrudState) {
  const key = o.key ?? 'id'
  const field = o.field ?? 'name'
  const draft = ref('')
  const get = (row: T, k: string) => String((row as Record<string, unknown>)[k] ?? '')

  function ready(): boolean {
    if (isSupabaseConfigured()) return true
    state.error.value = 'Справочники недоступны: нет подключения к базе.'
    return false
  }

  async function run(fallback: string, action: () => Promise<void>) {
    state.busy.value = true
    state.error.value = null
    try {
      await action()
    } catch (e) {
      state.error.value = errorText(e, `Не удалось ${fallback}`)
    } finally {
      state.busy.value = false
    }
  }

  async function add() {
    const name = draft.value.trim()
    if (!name || !ready()) return
    await run(o.errors.add, async () => {
      const row = await o.create(name)
      o.items.value = [...o.items.value, row]
      draft.value = ''
    })
  }

  async function edit(row: T) {
    const current = get(row, field)
    const next = (await promptText(o.promptTitle, current))?.trim()
    if (!next || next === current || !ready()) return
    await run(o.errors.update, async () => {
      await o.update(row, next)
      const id = get(row, key)
      o.items.value = o.items.value.map((x) => (get(x, key) === id ? { ...x, [field]: next } : x))
    })
  }

  async function remove(row: T) {
    const name = get(row, field)
    if (!(await askConfirm(`Удалить «${name}»?`, 'Значение будет удалено из справочника.'))) return
    if (!ready()) return
    await run(o.errors.remove, async () => {
      await o.remove(row)
      const id = get(row, key)
      o.items.value = o.items.value.filter((x) => get(x, key) !== id)
    })
  }

  return { draft, add, edit, remove }
}
