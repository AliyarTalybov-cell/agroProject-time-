import type { Directive } from 'vue'

/**
 * v-card-table — таблица реестра на телефоне превращается в карточки
 * (стили .ui-card-table в styles/ui.css, ≤ 640px).
 *
 * Директива подписывает каждую ячейку заголовком её колонки (data-label),
 * чтобы в карточке у значения была подпись, как в мобильных карточках задач.
 * Строки добавляются и меняются динамически — подписи обновляются через
 * MutationObserver. Строки с colspan (раскрытые подробности) не трогаются.
 * Ставится и на саму <table>, и на обёртку (Table из shadcn: div > table).
 */

const observers = new WeakMap<HTMLElement, MutationObserver>()

function tableOf(el: HTMLElement): HTMLElement | null {
  return el.tagName === 'TABLE' ? el : el.querySelector('table')
}

function label(table: HTMLElement) {
  const heads = Array.from(table.querySelectorAll('thead th')).map((th) => (th as HTMLElement).innerText.trim())
  table.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
    let col = 0
    for (const cell of Array.from(tr.children) as HTMLElement[]) {
      const span = Number(cell.getAttribute('colspan') || 1)
      const text = span > 1 ? '' : heads[col] ?? ''
      if (cell.getAttribute('data-label') !== text) cell.setAttribute('data-label', text)
      col += span
    }
  })
}

export const vCardTable: Directive<HTMLElement> = {
  mounted(el) {
    const table = tableOf(el)
    if (!table) return
    table.classList.add('ui-card-table')
    label(table)
    const obs = new MutationObserver(() => label(table))
    obs.observe(table, { childList: true, subtree: true })
    observers.set(el, obs)
  },
  updated(el) {
    const table = tableOf(el)
    if (table) label(table)
  },
  unmounted(el) {
    observers.get(el)?.disconnect()
    observers.delete(el)
  },
}
