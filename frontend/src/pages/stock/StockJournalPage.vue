<script setup lang="ts">
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import PageToolbar from '@/components/ui/layout/PageToolbar.vue'
import UiDatePicker from '@/components/ui/UiDatePicker.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/** Журнал складских операций по всем складам с фильтрами по виду и датам. */
import { onMounted, ref, watch } from 'vue'
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
  <section class="tw-scope flex flex-col gap-6">
    <PageToolbar>
      <div class="w-full sm:w-56">
        <UiSelect v-model="group" block :options="TYPE_GROUPS.map((g, i) => ({ value: i, label: g.label }))" aria-label="Вид операции" />
      </div>
      <div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        <div class="sm:w-36"><UiDatePicker v-model="dateFrom" block clearable placeholder="Дата с" aria-label="Дата с" /></div>
        <div class="sm:w-36"><UiDatePicker v-model="dateTo" block clearable placeholder="Дата по" aria-label="Дата по" /></div>
      </div>
    </PageToolbar>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="loading && !rows.length" class="grid gap-2">
      <Skeleton v-for="i in 5" :key="i" class="h-12 w-full" />
    </div>
    <template v-else>
      <StockDocumentsTable :documents="rows" empty-text="Операций по фильтру нет." @changed="load" />
      <UiPagination v-if="total > 0" v-model:page="page" v-model:page-size="pageSize" :total="total" :page-size-options="[10, 20, 50]" />
      <p class="-mt-2 text-xs text-muted-foreground">
        Нажмите на строку, чтобы увидеть движения, транспорт и документы. Ошибочную операцию руководитель отменяет: она не удаляется, а сторнируется.
      </p>
    </template>
  </section>
</template>
