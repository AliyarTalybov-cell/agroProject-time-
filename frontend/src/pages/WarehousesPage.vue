<script setup lang="ts">
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import PageToolbar from '@/components/ui/layout/PageToolbar.vue'
import UiBadge, { type UiBadgeTone } from '@/components/ui/UiBadge.vue'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/shadcn/input-group'
import { Button } from '@/components/ui/shadcn/button'
import { CylinderIcon, HouseIcon, PlusIcon, SearchIcon, SunIcon, WarehouseIcon } from '@lucide/vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/**
 * Склады — карточки. Масса, культуры и заполненность считаются по складскому
 * журналу (lib/stockLedger), статус заполнения — по остатку, а не вручную.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import UiPagination from '@/components/ui/UiPagination.vue'
import StockIntakeModal from '@/components/stock/StockIntakeModal.vue'
import StockTransferModal from '@/components/stock/StockTransferModal.vue'
import { isSupabaseConfigured } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { loadWarehousesOverview, stockDocTypeLabel, type WarehouseOverview } from '@/lib/stockLedger'

/** Заполнен — от 95% вместимости. */
const FULL_SHARE = 0.95

type FillState = 'empty' | 'filling' | 'formed'
const FILL_LABELS: Record<FillState, string> = { empty: 'Пусто', filling: 'Есть зерно', formed: 'Заполнен' }

const loading = ref(false)
const error = ref<string | null>(null)
const router = useRouter()
const search = ref('')
const statusFilter = ref<'all' | FillState>('all')
const cropFilter = ref<'all' | '__none__' | string>('all')
const page = ref(1)
const pageSize = ref(6)
const warehouses = ref<WarehouseOverview[]>([])

type Dialog = { kind: 'intake' | 'transfer'; locationId: string }
const dialog = ref<Dialog | null>(null)

async function reloadPlaces() {
  if (!isSupabaseConfigured()) {
    warehouses.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    warehouses.value = await loadWarehousesOverview()
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    loading.value = false
  }
}

function fillState(w: WarehouseOverview): FillState {
  if (w.tons <= 0) return 'empty'
  if (w.capacityTons && w.tons >= w.capacityTons * FULL_SHARE) return 'formed'
  return 'filling'
}

function occupancyPercent(w: WarehouseOverview): number {
  return w.capacityTons ? Math.round((w.tons / w.capacityTons) * 100) : 0
}

const cropOptions = computed(() =>
  Array.from(new Map(warehouses.value.flatMap((w) => w.crops.map((c) => [c.key, c.label] as const)))).sort((a, b) =>
    a[1].localeCompare(b[1], 'ru'),
  ),
)

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return warehouses.value.filter((w) => {
    if (q && !`${w.name} ${w.address}`.toLowerCase().includes(q)) return false
    if (statusFilter.value !== 'all' && fillState(w) !== statusFilter.value) return false
    if (cropFilter.value === '__none__' && w.crops.length) return false
    if (cropFilter.value !== 'all' && cropFilter.value !== '__none__' && !w.crops.some((c) => c.key === cropFilter.value)) return false
    return true
  })
})

const pagedRows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

watch([search, statusFilter, cropFilter, pageSize], () => (page.value = 1))

const FILL_TONES: Record<FillState, UiBadgeTone> = { empty: 'neutral', filling: 'primary', formed: 'warning' }

function formatMassTons(tons: number): string {
  const n = Math.max(0, Math.round(tons))
  return `${n.toLocaleString('ru-RU')} т`
}

function formatLastOperation(w: WarehouseOverview): string {
  if (!w.lastDocument) return '—'
  const d = new Date(w.lastDocument.date)
  if (Number.isNaN(d.getTime())) return '—'
  return `${stockDocTypeLabel(w.lastDocument.type)} ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`
}

function cropsLabel(w: WarehouseOverview): string {
  return w.crops.map((c) => `${c.label} ${formatMassTons(c.tons)}`).join(', ') || 'Нет'
}

/** Иконка типа места хранения — Lucide (набор shadcn-vue). */
function typeIcon(type: string) {
  if (type === 'Ток') return SunIcon
  if (type === 'Силос') return CylinderIcon
  if (type === 'Склад') return WarehouseIcon
  return HouseIcon
}

function openStorageCell(id: string) {
  void router.push({ name: 'warehouse-cell', params: { id } })
}

function onDialogDone() {
  dialog.value = null
  void reloadPlaces()
}

onMounted(() => {
  void reloadPlaces()
})
</script>

<template>
  <section class="tw-scope flex flex-col gap-6">
    <PageToolbar>
      <InputGroup class="w-full sm:w-72">
        <InputGroupAddon><SearchIcon /></InputGroupAddon>
        <InputGroupInput v-model.trim="search" type="search" placeholder="Название или адрес склада" autocomplete="off" aria-label="Поиск склада" />
      </InputGroup>
      <div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        <div class="sm:w-52">
          <UiSelect v-model="statusFilter" block aria-label="Заполнение" :options="[{ value: 'all', label: 'Любое заполнение' }, { value: 'empty', label: 'Пусто' }, { value: 'filling', label: 'Есть зерно' }, { value: 'formed', label: 'Заполнен' }]" />
        </div>
        <div class="sm:w-44">
          <UiSelect v-model="cropFilter" block aria-label="Культура" :options="[{ value: 'all', label: 'Все культуры' }, { value: '__none__', label: 'Пустые' }, ...cropOptions.map(([key, label]) => ({ value: key, label }))]" />
        </div>
      </div>
      <template #actions>
        <Button as-child>
          <RouterLink to="/warehouses/storage-locations?create=1">
            <PlusIcon />
            Добавить склад
          </RouterLink>
        </Button>
      </template>
    </PageToolbar>

    <Alert v-if="!isSupabaseConfigured()" variant="destructive">
      <AlertDescription>Нет подключения к базе: не заданы адрес и ключ Supabase.</AlertDescription>
    </Alert>
    <Alert v-else-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="loading" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Skeleton v-for="i in 3" :key="i" class="h-60 w-full rounded-xl" />
    </div>
    <Empty v-else-if="!warehouses.length" class="rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon"><WarehouseIcon /></EmptyMedia>
        <EmptyTitle>Складов пока нет</EmptyTitle>
        <EmptyDescription>Добавьте склад, силос, ток или бурт — здесь появятся его остатки и заполненность.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button as-child size="sm">
          <RouterLink to="/warehouses/storage-locations?create=1"><PlusIcon />Добавить склад</RouterLink>
        </Button>
      </EmptyContent>
    </Empty>
    <Empty v-else-if="!filteredRows.length" class="rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyTitle>Ничего не найдено</EmptyTitle>
        <EmptyDescription>Измените поиск или фильтры.</EmptyDescription>
      </EmptyHeader>
    </Empty>

    <template v-else>
      <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="w in pagedRows" :key="w.id" class="min-w-0">
          <article class="flex h-full flex-col rounded-xl border bg-card shadow-xs transition-colors hover:border-primary/40" :class="w.inactive ? 'opacity-70' : ''">
            <div
              class="grid flex-1 cursor-pointer content-start gap-4 rounded-t-xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
              role="link"
              tabindex="0"
              :aria-label="`Открыть склад «${w.name}»`"
              @click="openStorageCell(w.id)"
              @keydown.enter.prevent="openStorageCell(w.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 items-center gap-3">
                  <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
                    <component :is="typeIcon(w.typeName)" class="size-4" />
                  </span>
                  <div class="min-w-0">
                    <h2 class="truncate font-semibold">{{ w.name }}</h2>
                    <p class="truncate text-xs text-muted-foreground" :title="`${w.typeName} · ${w.address}`">{{ [w.typeName, w.address].filter(Boolean).join(' · ') }}</p>
                  </div>
                </div>
                <UiBadge :tone="FILL_TONES[fillState(w)]" class="shrink-0">{{ FILL_LABELS[fillState(w)] }}</UiBadge>
              </div>

              <div class="grid gap-2">
                <div class="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span class="text-2xl font-semibold tabular-nums">{{ formatMassTons(w.tons) }}</span>
                  <span v-if="w.capacityTons" class="text-sm text-muted-foreground tabular-nums">из {{ formatMassTons(w.capacityTons) }} · {{ occupancyPercent(w) }}%</span>
                </div>
                <span v-if="w.capacityTons" class="block h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" :aria-valuenow="occupancyPercent(w)" aria-valuemin="0" aria-valuemax="100" :aria-label="`Заполнено на ${occupancyPercent(w)}%`">
                  <span class="block h-full rounded-full" :class="occupancyPercent(w) > 100 ? 'bg-destructive' : 'bg-primary'" :style="{ width: `${Math.min(100, Math.max(0, occupancyPercent(w)))}%` }" />
                </span>
              </div>

              <dl class="grid gap-1.5 text-sm">
                <div class="flex gap-2">
                  <dt class="w-24 shrink-0 text-muted-foreground">Культуры</dt>
                  <dd class="min-w-0">{{ cropsLabel(w) }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-24 shrink-0 text-muted-foreground">Ячеек</dt>
                  <dd class="tabular-nums">{{ w.cells.length }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-24 shrink-0 text-muted-foreground">Операция</dt>
                  <dd class="min-w-0">{{ formatLastOperation(w) }}</dd>
                </div>
              </dl>
            </div>
            <div class="grid grid-cols-2 gap-2 border-t p-3">
              <Button variant="outline" size="sm" type="button" :disabled="w.tons <= 0" @click="dialog = { kind: 'transfer', locationId: w.id }">Перемещение</Button>
              <Button variant="outline" size="sm" type="button" @click="dialog = { kind: 'intake', locationId: w.id }">Приёмка</Button>
            </div>
          </article>
        </li>
      </ul>
      <UiPagination v-model:page="page" v-model:page-size="pageSize" :total="filteredRows.length" :page-size-options="[6, 12, 24]" />
    </template>

    <StockIntakeModal v-if="dialog?.kind === 'intake'" :location-id="dialog.locationId" @close="dialog = null" @done="onDialogDone" />
    <StockTransferModal v-if="dialog?.kind === 'transfer'" :location-id="dialog.locationId" @close="dialog = null" @done="onDialogDone" />
  </section>
</template>
