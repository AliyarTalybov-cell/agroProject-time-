<template>
  <div class="calendar-popover-wrap" ref="wrapRef">
    <button
      type="button"
      class="calendar-popover-trigger"
      :class="{ 'calendar-popover-trigger--open': isOpen }"
      @click="toggle"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
    >
      {{ displayText }}
    </button>
    <Teleport to="body">
      <div v-if="isOpen" class="calendar-popover-backdrop" @click="close" aria-hidden="true"></div>
      <div
        v-show="isOpen"
        class="calendar-popover-dropdown"
        :style="dropdownStyle"
        role="dialog"
        aria-label="Выбор даты"
      >
        <div class="calendar-popover-header">
          <span class="calendar-popover-title">{{ monthYearTitle }}</span>
          <div class="calendar-popover-nav">
            <button type="button" class="calendar-popover-nav-btn" aria-label="Предыдущий месяц" @click="prevMonth">&larr;</button>
            <button type="button" class="calendar-popover-nav-btn calendar-popover-nav-btn--dot" aria-label="Текущий месяц" @click="goToToday">&#9679;</button>
            <button type="button" class="calendar-popover-nav-btn" aria-label="Следующий месяц" @click="nextMonth">&rarr;</button>
          </div>
        </div>
        <div class="calendar-popover-weekdays">
          <span v-for="d in weekDays" :key="d" class="calendar-popover-weekday">{{ d }}</span>
        </div>
        <div class="calendar-popover-grid">
          <button
            v-for="cell in gridCells"
            :key="cell.key"
            type="button"
            class="calendar-popover-cell"
            :class="{
              'calendar-popover-cell--other': cell.otherMonth,
              'calendar-popover-cell--selected': cell.selected,
              'calendar-popover-cell--today': cell.today && !cell.selected,
            }"
            :disabled="cell.empty"
            @click="cell.empty ? null : select(cell)"
          >
            {{ cell.label }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
  }>(),
  { placeholder: 'Выберите дату' }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const monthNames = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

const wrapRef = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const viewDate = ref({ year: 0, month: 0 })

function parseYyyyMmDd(s: string): { y: number; m: number; d: number } | null {
  if (!s || s.length < 10) return null
  const y = parseInt(s.slice(0, 4), 10)
  const m = parseInt(s.slice(5, 7), 10)
  const d = parseInt(s.slice(8, 10), 10)
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null
  return { y, m, d }
}

function toYyyyMmDd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const displayText = computed(() => {
  const p = parseYyyyMmDd(props.modelValue)
  if (!p) return props.placeholder
  const d = new Date(p.y, p.m - 1, p.d)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}.${p.y}`
})

const monthYearTitle = computed(() => {
  const y = viewDate.value.year
  const m = viewDate.value.month
  if (!y || !m) return ''
  const name = monthNames[m - 1]
  return `${name} ${y} г.`
})

function initView() {
  const p = parseYyyyMmDd(props.modelValue)
  if (p) {
    viewDate.value = { year: p.y, month: p.m }
  } else {
    const now = new Date()
    viewDate.value = { year: now.getFullYear(), month: now.getMonth() + 1 }
  }
}

const gridCells = computed(() => {
  const { year, month } = viewDate.value
  if (!year || !month) return []
  const first = new Date(year, month - 1, 1)
  let start = first.getDay() - 1
  if (start < 0) start += 7
  const daysInMonth = new Date(year, month, 0).getDate()
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const daysInPrev = new Date(prevYear, prevMonth, 0).getDate()
  const selected = parseYyyyMmDd(props.modelValue)
  const today = new Date()
  const todayStr = toYyyyMmDd(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const out: Array<{
    key: string
    label: string
    otherMonth: boolean
    selected: boolean
    today: boolean
    empty: boolean
    y: number
    m: number
    d: number
  }> = []
  let index = 0
  for (let i = 0; i < start; i++) {
    const d = daysInPrev - start + i + 1
    out.push({
      key: `p-${d}`,
      label: String(d),
      otherMonth: true,
      selected: false,
      today: toYyyyMmDd(prevYear, prevMonth, d) === todayStr,
      empty: false,
      y: prevYear,
      m: prevMonth,
      d,
    })
    index++
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `c-${d}`
    const valueStr = toYyyyMmDd(year, month, d)
    const sel = !!(selected && selected.y === year && selected.m === month && selected.d === d)
    out.push({
      key,
      label: String(d),
      otherMonth: false,
      selected: sel,
      today: valueStr === todayStr,
      empty: false,
      y: year,
      m: month,
      d,
    })
    index++
  }
  const rest = 42 - out.length
  for (let i = 0; i < rest; i++) {
    const d = i + 1
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const valueStr = toYyyyMmDd(nextYear, nextMonth, d)
    out.push({
      key: `n-${d}`,
      label: String(d),
      otherMonth: true,
      selected: false,
      today: valueStr === todayStr,
      empty: false,
      y: nextYear,
      m: nextMonth,
      d,
    })
  }
  return out
})

const dropdownStyle = ref<Record<string, string>>({})

function updatePosition() {
  if (!wrapRef.value || !isOpen.value) return
  const rect = wrapRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.bottom + 4}px`,
    minWidth: `${Math.max(rect.width, 260)}px`,
  }
}

function toggle() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    initView()
    updatePosition()
  }
}

function close() {
  isOpen.value = false
}

function prevMonth() {
  let { year, month } = viewDate.value
  month--
  if (month < 1) {
    month = 12
    year--
  }
  viewDate.value = { year, month }
}

function nextMonth() {
  let { year, month } = viewDate.value
  month++
  if (month > 12) {
    month = 1
    year++
  }
  viewDate.value = { year, month }
}

function goToToday() {
  const now = new Date()
  viewDate.value = { year: now.getFullYear(), month: now.getMonth() + 1 }
  emit('update:modelValue', toYyyyMmDd(now.getFullYear(), now.getMonth() + 1, now.getDate()))
  close()
}

function select(cell: { y: number; m: number; d: number }) {
  emit('update:modelValue', toYyyyMmDd(cell.y, cell.m, cell.d))
  close()
}

watch(() => props.modelValue, () => initView(), { immediate: true })
watch(isOpen, (open) => {
  if (open) {
    requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
  } else {
    window.removeEventListener('resize', updatePosition)
  }
})

onMounted(() => initView())
onUnmounted(() => window.removeEventListener('resize', updatePosition))
</script>

<style scoped>
.calendar-popover-wrap {
  position: relative;
  display: inline-block;
}

.calendar-popover-trigger {
  width: 100%;
  min-width: 130px;
  height: var(--task-control-h, 38px);
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.2s ease;
}

.calendar-popover-trigger:hover {
  border-color: var(--accent-green);
}

.calendar-popover-trigger--open {
  border-color: var(--accent-green);
  outline: none;
}

.calendar-popover-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: transparent;
}

.calendar-popover-dropdown {
  z-index: 9999;
  background: #ffffff;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
}

[data-theme='dark'] .calendar-popover-dropdown {
  background: var(--bg-panel);
}

.calendar-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.calendar-popover-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.calendar-popover-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.calendar-popover-nav-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 1rem;
  cursor: pointer;
  border-radius: 6px;
}

.calendar-popover-nav-btn:hover {
  background: var(--bg-panel-hover, rgba(0, 0, 0, 0.06));
}

.calendar-popover-nav-btn--dot {
  font-size: 8px;
  line-height: 1;
}

.calendar-popover-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 8px;
}

.calendar-popover-weekday {
  text-align: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-primary);
}

.calendar-popover-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.calendar-popover-cell {
  aspect-ratio: 1;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
}

.calendar-popover-cell:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
}

[data-theme='dark'] .calendar-popover-cell:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.calendar-popover-cell--other {
  color: var(--text-secondary);
  opacity: 0.7;
}

.calendar-popover-cell--selected {
  background: rgba(0, 0, 0, 0.1);
  font-weight: 700;
}

[data-theme='dark'] .calendar-popover-cell--selected {
  background: rgba(255, 255, 255, 0.15);
}

.calendar-popover-cell--today {
  color: #1976d2;
}

.calendar-popover-cell:disabled {
  cursor: default;
}
</style>
