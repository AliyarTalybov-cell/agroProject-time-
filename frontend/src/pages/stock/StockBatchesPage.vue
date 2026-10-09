<script setup lang="ts">
import { Button } from '@/components/ui/shadcn/button'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/shadcn/input-group'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/shadcn/table'
import { PackageIcon, PlusIcon, SearchIcon } from '@lucide/vue'
import PageToolbar from '@/components/ui/layout/PageToolbar.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/**
 * Партии зерна — один реестр вместо «Реестра партий» и «Текущих партий».
 * Остатки из того же журнала, что и карточки складов, поэтому сходятся.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import UiPagination from '@/components/ui/UiPagination.vue'
import StockIntakeModal from '@/components/stock/StockIntakeModal.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  formatTons,
  loadSimpleRef,
  loadStockBatches,
  stockOriginLabel,
  type BatchPlacement,
  type SimpleRefRow,
  type StockBatch,
} from '@/lib/stockLedger'

const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const batches = ref<StockBatch[]>([])
const placements = ref<BatchPlacement[]>([])
const intakeOpen = ref(false)
const purposes = ref<SimpleRefRow[]>([])

const search = ref('')
const cropFilter = ref('')
const statusFilter = ref<'open' | 'closed' | 'all'>('open')
const locationFilter = ref('')
const purposeFilter = ref('')
const page = ref(1)
const pageSize = ref(20)

async function load() {
  error.value = null
  try {
    const [r, pu] = await Promise.all([loadStockBatches(), loadSimpleRef('stock_batch_purposes')])
    purposes.value = pu
    batches.value = r.batches
    placements.value = r.placements
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const placementsByBatch = computed(() => {
  const m = new Map<string, BatchPlacement[]>()
  for (const p of placements.value) {
    const list = m.get(p.batchId) ?? []
    list.push(p)
    m.set(p.batchId, list)
  }
  return m
})

const cropOptions = computed(() =>
  Array.from(new Map(batches.value.map((b) => [b.crop_key, b.cropLabel]))).sort((a, b) => a[1].localeCompare(b[1], 'ru')),
)
const locationOptions = computed(() =>
  Array.from(new Map(placements.value.map((p) => [p.locationId, p.locationName]))).sort((a, b) => a[1].localeCompare(b[1], 'ru')),
)

const statusOptions: { value: 'open' | 'closed' | 'all'; label: string }[] = [
  { value: 'open', label: 'С остатком' },
  { value: 'closed', label: 'Закрытые (0 т)' },
  { value: 'all', label: 'Все партии' },
]
const cropSelectOptions = computed(() => [
  { value: '', label: 'Все культуры' },
  ...cropOptions.value.map(([value, label]) => ({ value, label })),
])
const locationSelectOptions = computed(() => [
  { value: '', label: 'Все склады' },
  ...locationOptions.value.map(([value, label]) => ({ value, label })),
])
const purposeSelectOptions = computed(() => [
  { value: '', label: 'Все назначения' },
  ...purposes.value.map((p) => ({ value: p.id, label: p.label })),
])

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return batches.value.filter((b) => {
    if (statusFilter.value === 'open' && b.tons <= 0) return false
    if (statusFilter.value === 'closed' && b.tons > 0) return false
    if (cropFilter.value && b.crop_key !== cropFilter.value) return false
    if (purposeFilter.value && b.purpose !== purposeFilter.value) return false
    if (locationFilter.value && !(placementsByBatch.value.get(b.id) ?? []).some((p) => p.locationId === locationFilter.value)) return false
    if (q) {
      const hay = [b.code, b.variety, b.fgis_batch_number, b.fieldName, b.supplierName].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

watch([search, cropFilter, statusFilter, locationFilter, purposeFilter, pageSize], () => (page.value = 1))

const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const totalTons = computed(() => filtered.value.reduce((s, b) => s + b.tons, 0))

function whereLabel(b: StockBatch): string {
  const list = placementsByBatch.value.get(b.id) ?? []
  if (!list.length) return '—'
  return list.map((p) => `${p.locationName}, ${p.cellName}`).join('; ')
}

function sourceLabel(b: StockBatch): string {
  if (b.origin === 'field') return b.fieldName ?? 'С поля'
  if (b.origin === 'purchase') return b.supplierName ?? 'Закупка'
  return b.fieldName ?? stockOriginLabel(b.origin)
}

function resetFilters() {
  search.value = ''
  cropFilter.value = ''
  statusFilter.value = 'open'
  locationFilter.value = ''
  purposeFilter.value = ''
}

function onIntakeDone() {
  intakeOpen.value = false
  void load()
}
</script>

<template>
  <section class="tw-scope flex flex-col gap-6">
    <PageToolbar>
      <InputGroup class="w-full sm:w-80">
        <InputGroupAddon><SearchIcon /></InputGroupAddon>
        <InputGroupInput v-model="search" type="search" placeholder="№ партии, сорт, поле, поставщик, № ФГИС" aria-label="Поиск партии" />
      </InputGroup>
      <template #actions>
        <Button type="button" @click="intakeOpen = true">
          <PlusIcon />
          Приёмка зерна
        </Button>
      </template>
    </PageToolbar>
    <div class="-mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <div class="sm:w-44"><UiSelect v-model="statusFilter" block :options="statusOptions" aria-label="Статус" /></div>
      <div class="sm:w-44"><UiSelect v-model="cropFilter" block :options="cropSelectOptions" aria-label="Культура" /></div>
      <div class="sm:w-44"><UiSelect v-model="locationFilter" block :options="locationSelectOptions" aria-label="Склад" /></div>
      <div class="sm:w-48"><UiSelect v-model="purposeFilter" block :options="purposeSelectOptions" aria-label="Назначение" /></div>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="loading" class="grid gap-2">
      <Skeleton v-for="i in 6" :key="i" class="h-12 w-full" />
    </div>
    <Empty v-else-if="!filtered.length" class="rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon"><PackageIcon /></EmptyMedia>
        <EmptyTitle>Партий не найдено</EmptyTitle>
        <EmptyDescription>Измените фильтры или проведите приёмку зерна.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" type="button" @click="resetFilters">Сбросить фильтры</Button>
      </EmptyContent>
    </Empty>
    <template v-else>
      <div class="sm:overflow-hidden sm:rounded-xl sm:border sm:bg-card">
        <Table v-card-table class="min-w-[56rem]">
          <TableHeader class="bg-muted/50">
            <TableRow>
              <TableHead class="pl-4">Партия</TableHead>
              <TableHead>Культура</TableHead>
              <TableHead>Откуда</TableHead>
              <TableHead>Назначение</TableHead>
              <TableHead>Где лежит</TableHead>
              <TableHead class="pr-4 text-right">Остаток</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="b in pageRows" :key="b.id" class="cursor-pointer" @click="router.push({ name: 'grain-batch', params: { id: b.id } })">
              <TableCell class="pl-4">
                <span class="font-medium tabular-nums">{{ b.code }}</span>
                <span class="block text-xs text-muted-foreground">урожай {{ b.harvest_year ?? '—' }}{{ b.variety ? ` · ${b.variety}` : '' }}</span>
              </TableCell>
              <TableCell class="whitespace-normal">{{ b.cropLabel }}</TableCell>
              <TableCell class="max-w-56 whitespace-normal">{{ sourceLabel(b) }}</TableCell>
              <TableCell class="whitespace-normal">{{ b.purposeLabel }}</TableCell>
              <TableCell class="max-w-56 whitespace-normal">{{ whereLabel(b) }}</TableCell>
              <TableCell class="pr-4 text-right font-medium tabular-nums">
                <template v-if="b.tons > 0">{{ formatTons(b.tons) }}</template>
                <UiBadge v-else tone="neutral">закрыта</UiBadge>
              </TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colspan="5" class="pl-4">Итого по фильтру · партий: {{ filtered.length }}</TableCell>
              <TableCell class="pr-4 text-right tabular-nums">{{ formatTons(totalTons) }}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <UiPagination v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" :page-size-options="[10, 20, 50, 100]" />
    </template>

    <StockIntakeModal v-if="intakeOpen" @close="intakeOpen = false" @done="onIntakeDone" />
  </section>
</template>
