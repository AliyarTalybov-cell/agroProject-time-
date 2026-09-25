# Общие компоненты интерфейса

Новые экраны собираются из этих компонентов, а не из скопированной разметки и
стилей. Эталон оформления — shadcn-vue (new-york-v4): размеры, скругления, тени
и состояния взяты из его исходников, цвета — токены `global.css` (серые Zinc,
зелёный `#2d5a3d`). См. также правила в `.cursor/rules/`
(`modal-close-button.mdc`, `new-pages-ui-ux.mdc`).

| Компонент | Что это | Эталон |
|---|---|---|
| `UiModal` | Окно: подложка, заголовок с крестиком, тело (слот по умолчанию), кнопки (слот `actions`). Закрывается крестиком, кликом по подложке и Esc — всегда через событие `close`. | «Новое место хранения», StorageLocationsPage |
| `UiConfirmModal` | Подтверждение удаления вместо `window.confirm`. События `confirm` / `cancel`, `busy` на время запроса. | «Удалить место хранения?» |
| `UiButton` | Кнопки форм и окон: `secondary` (Отмена), `primary` (Сохранить), `danger` (Удалить). | task-form-cancel / task-form-submit |
| `UiPagination` | «Показано a – b из N», страницы, «На странице». `v-model:page`, `v-model:page-size`. | Pagination shadcn |
| `UiSelect` | Выпадающий список на Reka UI вместо `<select>`. `v-model` + `:options="[{ value, label, disabled? }]"`, `placeholder`. Значения любого типа, сравнение как у `v-model` нативного select. Событие `change(value)`. | Select shadcn |
| `UiDatePicker` | Дата: кнопка-поле и календарь во всплывающем окне. `v-model` — `'ГГГГ-ММ-ДД'` или `''`, как у `<input type="date">`; `min`, `max`, `clearable`. | Date Picker shadcn |
| `UiDateTimePicker` | Дата и время: календарь + поле времени. `v-model` — `'ГГГГ-ММ-ДДTЧЧ:ММ'`, как у `datetime-local`. | Date and Time picker shadcn |

Нативные `<select>` и `<input type="date">` в новых экранах не использовать —
только `UiSelect` / `UiDatePicker`. Классы, повешенные на них, ложатся на кнопку
компонента. Внутри `UiModal` Esc и клик по подложке сначала закрывают открытый
список или календарь, а не окно.

Показывать окна через `v-if` у родителя внутри `<teleport to="body">`.
Содержимое слотов принадлежит странице, поэтому её scoped-стили (поля формы
`task-form-*` и т. п.) к нему применяются как раньше.

Первым на компоненты переведён `StorageLocationsPage` — по нему видно, как
ими пользоваться.
