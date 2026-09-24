<script setup lang="ts">
/** Журнал складских операций по всем складам с фильтрами по виду и датам. */
import { onMounted, ref, watch } from 'vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UiPagination from '@/components/ui/UiPagination.vue'
import StockDocumentsTable from '@/components/stock/StockDocumentsTable.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { loadStockDocuments, type StockDocType, type StockDocument } from '@/lib/stockLedger'

const TYPE_GROUPS: { label: string; types: StockDocType[] }[] = [
  { label: 'Все операции', types: [] },
  { label: 'Приёмка', types: ['intake'] },
  { label: 'Продажа', types: ['sale'] },
  { label: 'Перемещение', types: ['transfer'] },
  { label: 'Подработка', types: ['processing'] },
  { label: 'Посев', types: ['seeding'] },
  { label: 'Переработка / корм', types: ['consumption'] },
  { label: 'Списание', types: ['writeoff'] },
  { label: 'Инвентаризация', types: ['inventory'] },
  { label: 'Сторно и ввод остатков', types: ['storno', 'opening'] },
]

const loading = ref(true)
const error = ref<string | null>(null)
const rows = ref<StockDocument[]>([])
const total = ref(0)
const group = ref(0)
const dateFrom = ref('')
const dateTo = ref('')
const page = ref(1)
const pageSize = ref(20)

async function load() {
  loading.value = true
  error.value = null
  try {
    const r = await loadStockDocuments({
      types: TYPE_GROUPS[group.value].types,
      from: dateFrom.value ? new Date(`${dateFrom.value}T00:00:00`).toISOString() : undefined,
      to: dateTo.value ? new Date(`${dateTo.value}T23:59:59`).toISOString() : undefined,
      page: page.value,
      pageSize: pageSize.value,
    })
    rows.value = r.rows
    total.value = r.total
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([group, dateFrom, dateTo, pageSize], () => {
  page.value = 1
  void load()
})
watch(page, () => void load())
</script>

<template>
  <section class="ui-page">
    <div class="ui-page-inner">
      <header class="ui-page-header">
        <p class="ui-page-subtitle">
          Все складские операции. Нажмите на строку, чтобы увидеть движения, транспорт и документы. Ошибочную операцию руководитель отменяет — она не удаляется, а сторнируется.
        </p>
      </header>
      <section class="ui-card">
        <div class="ui-toolbar">
          <select v-model.number="group" class="ui-filter-select" aria-label="Вид операции">
            <option v-for="(g, i) in TYPE_GROUPS" :key="g.label" :value="i">{{ g.label }}</option>
          </select>
          <label class="journal-date">
            <span class="ui-muted">с</span>
            <input v-model="dateFrom" type="date" class="ui-filter-select" aria-label="Дата с" />
          </label>
          <label class="journal-date">
            <span class="ui-muted">по</span>
            <input v-model="dateTo" type="date" class="ui-filter-select" aria-label="Дата по" />
          </label>
        </div>
        <p v-if="error" class="ui-alert ui-alert--error">{{ error }}</p>
        <div v-if="loading && !rows.length" class="ui-loading"><UiLoadingBar /></div>
        <template v-else>
          <StockDocumentsTable :documents="rows" empty-text="Операций по фильтру нет." @changed="load" />
          <UiPagination v-if="total > 0" v-model:page="page" v-model:page-size="pageSize" :total="total" :page-size-options="[10, 20, 50]" />
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped>
.journal-date {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
