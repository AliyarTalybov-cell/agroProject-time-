<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import { Button } from '@/components/ui/shadcn/button'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/shadcn/empty'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/shadcn/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/shadcn/table'
import { ArrowLeftRightIcon, ChevronDownIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import UiBadge from '@/components/ui/UiBadge.vue'
/**
 * Карточка склада на складском журнале: ячейки и что в них лежит, операции,
 * история. Все цифры — из журнала движений (lib/stockLedger).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import StockDocumentsTable from '@/components/stock/StockDocumentsTable.vue'
import StockIntakeModal from '@/components/stock/StockIntakeModal.vue'
import StockTransferModal from '@/components/stock/StockTransferModal.vue'
import StockOutgoingModal from '@/components/stock/StockOutgoingModal.vue'
import StockProcessingModal from '@/components/stock/StockProcessingModal.vue'
import StockInventoryModal from '@/components/stock/StockInventoryModal.vue'
import StorageCellModal from '@/components/stock/StorageCellModal.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  deleteStorageCell,
  formatTons,
  loadStockBatches,
  loadStockDocumentsFor,
  loadWarehousesOverview,
  type BatchPlacement,
  type CellWithStock,
  type StockBatch,
  type StockDocument,
  type StockOutgoingType,
  type WarehouseOverview,
} from '@/lib/stockLedger'

const props = defineProps<{ id: string }>()
const router = useRouter()

const loading = ref(true)
const error = ref<string | null>(null)
const warehouse = ref<WarehouseOverview | null>(null)
const placements = ref<BatchPlacement[]>([])
const batches = ref<Map<string, StockBatch>>(new Map())
const documents = ref<StockDocument[]>([])
const tab = ref<'cells' | 'journal'>('cells')

type Dialog =
  | { kind: 'intake' }
  | { kind: 'transfer' }
  | { kind: 'processing' }
  | { kind: 'inventory' }
  | { kind: 'outgoing'; type: StockOutgoingType }
  | { kind: 'cell'; cell: CellWithStock | null }
  | { kind: 'delete-cell'; cell: CellWithStock }
const dialog = ref<Dialog | null>(null)
const deleting = ref(false)

async function load() {
  error.value = null
  try {
    const [w, b, docs] = await Promise.all([
      loadWarehousesOverview(props.id),
      loadStockBatches(),
      loadStockDocumentsFor({ locationId: props.id }),
    ])
    warehouse.value = w[0] ?? null
    batches.value = new Map(b.batches.map((x) => [x.id, x]))
    placements.value = b.placements.filter((p) => p.locationId === props.id)
    documents.value = docs
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

function onDone() {
  dialog.value = null
  void load()
}

const fillPercent = computed(() => {
  const w = warehouse.value
  if (!w?.capacityTons) return null
  return Math.round((w.tons / w.capacityTons) * 100)
})

function cellPlacements(cellId: string) {
  return placements.value
    .filter((p) => p.cellId === cellId)
    .map((p) => ({ ...p, batch: batches.value.get(p.batchId) }))
}

function cellFill(c: CellWithStock): number | null {
  return c.capacity_tons ? Math.round((c.tons / c.capacity_tons) * 100) : null
}

const hasStock = computed(() => (warehouse.value?.tons ?? 0) > 0)

const OUTGOING: { type: StockOutgoingType; label: string }[] = [
  { type: 'sale', label: 'Продажа' },
  { type: 'seeding', label: 'На посев' },
  { type: 'consumption', label: 'Переработка / корм' },
  { type: 'writeoff', label: 'Списание' },
]

async function confirmDeleteCell() {
  if (dialog.value?.kind !== 'delete-cell') return
  deleting.value = true
  try {
    await deleteStorageCell(dialog.value.cell.id)
    dialog.value = null
    await load()
  } catch (e) {
    const msg = formatSupabaseError(e)
    error.value = msg.includes('foreign key') ? 'По ячейке уже есть операции — удалить её нельзя, можно переименовать.' : msg
    dialog.value = null
  } finally {
    deleting.value = false
  }
}

function openBatch(batchId: string) {
  void router.push({ name: 'grain-batch', params: { id: batchId } })
}
</script>

<template>
  <section class="tw-scope flex flex-col gap-6">
    <div v-if="loading" class="grid gap-4">
      <Skeleton class="h-8 w-72" />
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-64 w-full" />
    </div>
    <Alert v-else-if="error && !warehouse" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
    <Empty v-else-if="!warehouse" class="rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyTitle>Склад не найден</EmptyTitle>
        <EmptyDescription>Возможно, ссылка устарела. Вернитесь к списку складов.</EmptyDescription>
      </EmptyHeader>
    </Empty>

    <template v-else>
      <header class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="grid min-w-0 gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-xl font-semibold">{{ warehouse.name }}</h1>
            <UiBadge :tone="warehouse.inactive ? 'neutral' : 'success'">{{ warehouse.statusName || 'Активен' }}</UiBadge>
          </div>
          <p class="text-sm text-muted-foreground">{{ [warehouse.typeName, warehouse.address].filter(Boolean).join(' · ') }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button type="button" @click="dialog = { kind: 'intake' }">
            <PlusIcon />
            Приёмка
          </Button>
          <Button variant="outline" type="button" :disabled="!hasStock" @click="dialog = { kind: 'transfer' }">
            <ArrowLeftRightIcon />
            Перемещение
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" type="button" :disabled="!hasStock">
                Операция
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-52">
              <DropdownMenuItem v-for="o in OUTGOING" :key="o.type" @select="dialog = { kind: 'outgoing', type: o.type }">{{ o.label }}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem @select="dialog = { kind: 'processing' }">Подработка</DropdownMenuItem>
              <DropdownMenuItem @select="dialog = { kind: 'inventory' }">Инвентаризация</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        <div class="grid content-start gap-1 bg-card p-4">
          <dt class="text-xs text-muted-foreground">Лежит</dt>
          <dd class="text-lg font-semibold tabular-nums">{{ formatTons(warehouse.tons) }}</dd>
        </div>
        <div class="grid content-start gap-1 bg-card p-4">
          <dt class="text-xs text-muted-foreground">Вместимость</dt>
          <dd class="text-lg font-semibold tabular-nums">{{ warehouse.capacityTons ? formatTons(warehouse.capacityTons) : '—' }}</dd>
        </div>
        <div class="grid content-start gap-1 bg-card p-4">
          <dt class="text-xs text-muted-foreground">Заполнено</dt>
          <dd class="grid gap-2">
            <span class="text-lg font-semibold tabular-nums" :class="(fillPercent ?? 0) > 100 ? 'text-destructive' : ''">{{ fillPercent == null ? '—' : `${fillPercent}%` }}</span>
            <span v-if="fillPercent != null" class="block h-1.5 overflow-hidden rounded-full bg-muted">
              <span class="block h-full rounded-full" :class="fillPercent > 100 ? 'bg-destructive' : 'bg-primary'" :style="{ width: `${Math.min(100, fillPercent)}%` }" />
            </span>
          </dd>
        </div>
        <div class="grid content-start gap-1 bg-card p-4">
          <dt class="text-xs text-muted-foreground">Культуры</dt>
          <dd class="text-sm font-medium">{{ warehouse.crops.map((c) => c.label).join(', ') || '—' }}</dd>
        </div>
      </dl>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Tabs :model-value="tab" @update:model-value="(v) => (tab = v as 'cells' | 'journal')">
            <TabsList>
              <TabsTrigger value="cells">Ячейки и партии</TabsTrigger>
              <TabsTrigger value="journal">Журнал<span class="ml-1 text-muted-foreground tabular-nums">{{ documents.length }}</span></TabsTrigger>
            </TabsList>
          </Tabs>
          <Button v-if="tab === 'cells'" variant="outline" size="sm" type="button" @click="dialog = { kind: 'cell', cell: null }">
            <PlusIcon />
            Ячейка
          </Button>
        </div>

        <template v-if="tab === 'cells'">
          <div class="sm:overflow-hidden sm:rounded-xl sm:border sm:bg-card">
            <Table v-card-table class="min-w-[48rem]">
              <TableHeader class="bg-muted/50">
                <TableRow>
                  <TableHead class="pl-4">Ячейка</TableHead>
                  <TableHead>Культура</TableHead>
                  <TableHead>Партии</TableHead>
                  <TableHead class="text-right">Лежит</TableHead>
                  <TableHead class="w-40 text-right">Вместимость</TableHead>
                  <TableHead class="w-px pr-4"><span class="sr-only">Действия</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="c in warehouse.cells" :key="c.id">
                  <TableCell class="pl-4">
                    <span class="font-medium">{{ c.name }}</span>
                    <span v-if="c.typeName" class="block text-xs text-muted-foreground">{{ c.typeName }}</span>
                  </TableCell>
                  <TableCell>{{ c.cropLabel ?? '—' }}</TableCell>
                  <TableCell class="whitespace-normal">
                    <span v-if="!cellPlacements(c.id).length" class="text-muted-foreground">пусто</span>
                    <span v-else class="flex flex-wrap gap-x-3 gap-y-1">
                      <button
                        v-for="p in cellPlacements(c.id)"
                        :key="p.batchId"
                        type="button"
                        class="text-left tabular-nums underline-offset-4 hover:text-primary hover:underline"
                        @click="openBatch(p.batchId)"
                      >
                        {{ p.batch?.code ?? '—' }} · {{ formatTons(p.tons) }}
                      </button>
                    </span>
                  </TableCell>
                  <TableCell class="text-right font-medium tabular-nums">{{ formatTons(c.tons) }}</TableCell>
                  <TableCell class="text-right tabular-nums">
                    {{ c.capacity_tons ? formatTons(c.capacity_tons) : '—' }}
                    <span v-if="cellFill(c) != null" class="mt-1.5 ml-auto block h-1 w-24 overflow-hidden rounded-full bg-muted">
                      <span class="block h-full rounded-full" :class="(cellFill(c) ?? 0) > 100 ? 'bg-destructive' : 'bg-primary'" :style="{ width: `${Math.min(100, cellFill(c) ?? 0)}%` }" />
                    </span>
                  </TableCell>
                  <TableCell class="pr-4">
                    <div class="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" type="button" class="text-muted-foreground" :aria-label="`Изменить ячейку «${c.name}»`" @click="dialog = { kind: 'cell', cell: c }">
                        <PencilIcon />
                      </Button>
                      <Button
                        v-if="c.kind !== 'main' && c.tons === 0"
                        variant="ghost"
                        size="icon-sm"
                        type="button"
                        class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        :aria-label="`Удалить ячейку «${c.name}»`"
                        @click="dialog = { kind: 'delete-cell', cell: c }"
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p class="-mt-2 text-xs text-muted-foreground">В одной ячейке — одна культура. Разные культуры кладите в разные ячейки.</p>
        </template>

        <StockDocumentsTable v-else :documents="documents" :scope-location-id="warehouse.id" @changed="load" />
      </div>
    </template>

    <template v-if="warehouse && dialog">
      <StockIntakeModal v-if="dialog.kind === 'intake'" :location-id="warehouse.id" @close="dialog = null" @done="onDone" />
      <StockTransferModal v-else-if="dialog.kind === 'transfer'" :location-id="warehouse.id" @close="dialog = null" @done="onDone" />
      <StockProcessingModal v-else-if="dialog.kind === 'processing'" :location-id="warehouse.id" @close="dialog = null" @done="onDone" />
      <StockInventoryModal v-else-if="dialog.kind === 'inventory'" :location-id="warehouse.id" @close="dialog = null" @done="onDone" />
      <StockOutgoingModal v-else-if="dialog.kind === 'outgoing'" :type="dialog.type" :location-id="warehouse.id" @close="dialog = null" @done="onDone" />
      <StorageCellModal v-else-if="dialog.kind === 'cell'" :location-id="warehouse.id" :cell="dialog.cell" @close="dialog = null" @done="onDone" />
      <UiConfirmModal
        v-else-if="dialog.kind === 'delete-cell'"
        :title="`Удалить ячейку «${dialog.cell.name}»?`"
        :busy="deleting"
        @cancel="dialog = null"
        @confirm="confirmDeleteCell"
      />
    </template>
  </section>
</template>
