<script setup lang="ts">
/**
 * Пагинация реестров: «Показано a – b из N», номера страниц и «На странице».
 * Эталон — FieldsPage (fields-pagination), подсветка кнопок при наведении и
 * мобильная раскладка — как в StorageLocationsPage.
 *
 * Страницы нумеруются с 1. Смена размера страницы сама возвращает на первую.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    page: number
    pageSize: number
    total: number
    pageSizeOptions?: number[]
  }>(),
  { pageSizeOptions: () => [5, 10, 20, 50] },
)

const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [size: number]
}>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const rangeStart = computed(() => (props.total ? (props.page - 1) * props.pageSize + 1 : 0))
const rangeEnd = computed(() => Math.min(props.page * props.pageSize, props.total))

/** Номера страниц с многоточиями: 1 … 4 5 6 … 12. */
const pages = computed<(number | '...')[]>(() => {
  const total = totalPages.value
  const cur = props.page
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | '...')[] = [1]
  const start = Math.max(2, cur - 1)
  const end = Math.min(total - 1, cur + 1)
  if (start > 2) out.push('...')
  for (let p = start; p <= end; p += 1) out.push(p)
  if (end < total - 1) out.push('...')
  out.push(total)
  return out
})

function setPage(p: number) {
  const next = Math.max(1, Math.min(p, totalPages.value))
  if (next !== props.page) emit('update:page', next)
}

function onSizeChange(e: Event) {
  const size = Number((e.target as HTMLSelectElement).value)
  emit('update:pageSize', size)
  if (props.page !== 1) emit('update:page', 1)
}
</script>

<template>
  <footer class="fields-pagination">
    <p class="fields-pagination-info">
      Показано
      <span class="fields-pagination-num">{{ rangeStart }}</span>
      –
      <span class="fields-pagination-num">{{ rangeEnd }}</span>
      из
      <span class="fields-pagination-num">{{ total }}</span>
    </p>
    <div class="fields-pagination-right">
      <nav class="fields-pagination-nav" aria-label="Пагинация">
        <button
          type="button"
          class="fields-page-btn fields-page-btn--edge"
          :disabled="page <= 1"
          aria-label="Предыдущая страница"
          @click="setPage(page - 1)"
        >
          &lt;
        </button>
        <template v-for="(p, i) in pages" :key="p === '...' ? `ellipsis-${i}` : p">
          <button
            v-if="p !== '...'"
            type="button"
            class="fields-page-btn"
            :class="{ 'fields-page-btn--active': p === page }"
            :aria-current="p === page ? 'page' : undefined"
            @click="setPage(p)"
          >
            {{ p }}
          </button>
          <span v-else class="fields-page-ellipsis">…</span>
        </template>
        <button
          type="button"
          class="fields-page-btn fields-page-btn--edge"
          :disabled="page >= totalPages"
          aria-label="Следующая страница"
          @click="setPage(page + 1)"
        >
          &gt;
        </button>
      </nav>
      <label class="fields-pagination-size">
        <span class="fields-pagination-size-label">На странице</span>
        <select :value="pageSize" class="fields-pagination-select" @change="onSizeChange">
          <option v-for="n in pageSizeOptions" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>
    </div>
  </footer>
</template>

<style scoped>
.fields-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-md);
  padding: var(--space-md) 4px 0;
  border-top: 1px solid var(--border-color);
  min-height: 40px;
}

.fields-pagination-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
}

.fields-pagination-num {
  font-weight: 500;
}

.fields-pagination-right {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  flex-wrap: wrap;
}

.fields-pagination-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.fields-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.fields-page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fields-page-btn--edge {
  width: 36px;
}

.fields-page-btn--active {
  border-color: var(--input-border);
  background: var(--bg-panel);
  box-shadow: var(--shadow-xs);
}

.fields-page-btn:hover:not(:disabled):not(.fields-page-btn--active) {
  background: var(--muted-bg);
}

.fields-page-ellipsis {
  padding: 0 10px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.fields-pagination-size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.fields-pagination-size-label {
  white-space: nowrap;
}

.fields-pagination-select {
  height: 36px;
  min-width: 72px;
  padding: 0 28px 0 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--input-border);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 0.875rem;
  box-shadow: var(--shadow-xs);
  cursor: pointer;
}

@media (max-width: 900px) {
  .fields-pagination {
    flex-direction: column;
    align-items: flex-start;
  }

  .fields-pagination-right {
    width: 100%;
    justify-content: space-between;
  }
}

/* Телефон: номера страниц и «На странице» — одной строкой под счётчиком. */
@media (max-width: 640px) {
  .fields-pagination {
    gap: 8px;
    padding: 12px 4px 0;
  }

  .fields-pagination-right {
    flex-wrap: nowrap;
    gap: 8px;
  }

  .fields-pagination-nav {
    gap: 2px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .fields-page-btn,
  .fields-page-btn--edge {
    min-width: 34px;
    width: auto;
    height: 34px;
    padding: 0 6px;
  }

  .fields-page-ellipsis {
    padding: 0 4px;
  }

  .fields-pagination-size {
    flex-shrink: 0;
    gap: 6px;
  }

  .fields-pagination-select {
    height: 34px;
    min-width: 64px;
    padding: 0 24px 0 8px;
  }
}
</style>
