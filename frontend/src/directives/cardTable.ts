import type { Directive } from 'vue'

/**
 * v-card-table — таблица реестра на телефоне превращается в карточки
 * (стили .ui-card-table в styles/ui.css, ≤ 640px).
 *
 * Директива подписывает каждую ячейку заголовком её колонки (data-label),
 * чтобы в карточке у значения была подпись, как в мобильных карточках задач.
 * Строки добавляются и меняются динамически — подписи обновляются через
 * MutationObserver. Строки с colspan (раскрытые подробности) не трогаются.
 */

const observers = new WeakMap<HTMLElement, MutationObserver>()

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
    el.classList.add('ui-card-table')
    label(el)
    const obs = new MutationObserver(() => label(el))
    obs.observe(el, { childList: true, subtree: true })
    observers.set(el, obs)
  },
  updated(el) {
    label(el)
  },
  unmounted(el) {
    observers.get(el)?.disconnect()
    observers.delete(el)
  },
}
