<script setup lang="ts">
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/shadcn/table'
import PageToolbar from '@/components/ui/layout/PageToolbar.vue'
import FormGrid from '@/components/ui/layout/FormGrid.vue'
import FormField from '@/components/ui/layout/FormField.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/shadcn/input-group'
import { Input } from '@/components/ui/shadcn/input'
import { Button } from '@/components/ui/shadcn/button'
import { BoxIcon, PencilIcon, PlusIcon, SearchIcon } from '@lucide/vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiPagination from '@/components/ui/UiPagination.vue'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  addStorageLocation,
  deleteStorageLocation,
  loadStorageLocationsPage,
  updateStorageLocation,
  storageLocationMarksInactive,
  storageLocationStatusName,
  storageLocationTypeName,
  type StorageLocationRow,
} from '@/lib/storageLocationsSupabase'
import { loadCrops, type CropRow } from '@/lib/landTypesAndCrops'
import { formatTons, loadWarehousesOverview, type WarehouseOverview } from '@/lib/stockLedger'
import {
  loadStorageLocationTypes,
  loadStorageLocationStatuses,
  loadStorageFillStatuses,
  type StorageLocationTypeRow,
  type StorageLocationStatusRow,
  type StorageFillStatusRow,
} from '@/lib/storageRefsSupabase'

const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
/** Ошибка сохранения — в окне, а не под ним на странице. */
const modalError = ref<string | null>(null)

const search = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

const page = ref(1)
const pageSize = ref(10)

const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteConfirmOpen = ref(false)
const deleteTargetId = ref<string | null>(null)

const route = useRoute()
const router = useRouter()

const storageTypes = ref<StorageLocationTypeRow[]>([])
const storageStatuses = ref<StorageLocationStatusRow[]>([])
const storageFillStatuses = ref<StorageFillStatusRow[]>([])
const crops = ref<CropRow[]>([])

const form = ref({
  name: '',
  typeId: '',
  statusId: '',
  fillStatusId: '',
  /** Ключ из справочника crops, пустая строка = не указано */
  cropKey: '',
  address: '',
  /** Вместимость по массе зерна, т (строка поля ввода) */
  capacityTons: '',
  fgisCode: '',
})

const storagePlaces = ref<StorageLocationRow[]>([])
const storageTotal = ref(0)

const filteredPlaces = computed(() => storagePlaces.value)
const total = computed(() => storageTotal.value)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const pagedPlaces = computed(() => storagePlaces.value)

function defaultTypeId(): string {
  return storageTypes.value[0]?.id ?? ''
}

function defaultStatusId(): string {
  const active = storageStatuses.value.find((s) => !s.marks_inactive)
  return active?.id ?? storageStatuses.value[0]?.id ?? ''
}

function defaultFillStatusId(): string {
  const row = storageFillStatuses.value.find((s) => s.code === 'empty')
  return row?.id ?? storageFillStatuses.value[0]?.id ?? ''
}

function resetForm() {
  form.value = {
    name: '',
    typeId: defaultTypeId(),
    statusId: defaultStatusId(),
    fillStatusId: defaultFillStatusId(),
    cropKey: '',
    address: '',
    capacityTons: '',
    fgisCode: '',
  }
}

function mapError(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

function parseCapacityTonsInput(raw: string): number | null {
  const s = raw.replace(',', '.').trim()
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

const canSavePlace = computed(() => {
  if (!form.value.name.trim() || !form.value.address.trim()) return false
  if (!form.value.typeId || !form.value.statusId || !form.value.fillStatusId) return false
  return parseCapacityTonsInput(form.value.capacityTons) !== null
})

function formatCapacityCell(tons: number | null): string {
  if (tons == null || !Number.isFinite(Number(tons))) return '—'
  const n = Number(tons)
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} т`
}

async function loadStorageRefs() {
  if (!isSupabaseConfigured()) {
    storageTypes.value = []
    storageStatuses.value = []
    storageFillStatuses.value = []
    crops.value = []
    return
  }
  try {
    const [types, statuses, fills, cropRows] = await Promise.all([
      loadStorageLocationTypes(),
      loadStorageLocationStatuses(),
      loadStorageFillStatuses(),
      loadCrops(),
    ])
    storageTypes.value = types
    storageStatuses.value = statuses
    storageFillStatuses.value = fills
    crops.value = cropRows
  } catch (e) {
    console.error('Справочники мест хранения', e)
    storageTypes.value = []
    storageStatuses.value = []
    storageFillStatuses.value = []
    crops.value = []
  }
}

/**
 * Масса и культуры — по складскому журналу, а не ручные поля мест хранения:
 * ручные «Статус заполнения» и «Культура» расходились с тем, что реально лежит.
 */
const stockByPlace = ref<Record<string, WarehouseOverview>>({})

function stockCropsLabel(placeId: string): string {
  return stockByPlace.value[placeId]?.crops.map((c) => c.label).join(', ') || '—'
}

async function reloadStorageLocations() {
  if (!isSupabaseConfigured()) {
    storagePlaces.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    const [res, overview] = await Promise.all([
      loadStorageLocationsPage({ search: search.value, page: page.value, pageSize: pageSize.value }),
      loadWarehousesOverview(),
    ])
    stockByPlace.value = Object.fromEntries(overview.map((w) => [w.id, w]))
    storagePlaces.value = res.rows
    storageTotal.value = res.total
    if (page.value > totalPages.value) {
      page.value = totalPages.value
      const retry = await loadStorageLocationsPage({ search: search.value, page: page.value, pageSize: pageSize.value })
      storagePlaces.value = retry.rows
      storageTotal.value = retry.total
    }
  } catch (e) {
    error.value = mapError(e, 'Не удалось загрузить места хранения')
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
}

function tryOpenCreateFromQuery() {
  const raw = route.query.create
  if (raw === '1' || raw === 'true') openCreateModal()
}

/**
 * Убирает ?create=1 из адреса. Делать это можно только при закрытии окна:
 * App.vue пересоздаёт страницу при любом изменении адреса (:key="$route.fullPath"),
 * и замена адреса сразу после открытия уничтожала только что открытое окно.
 * Возвращает true, если адрес меняется — тогда страница перезагрузит список сама.
 */
function clearCreateQuery(): boolean {
  if (route.query.create == null) return false
  const nextQuery = { ...route.query }
  delete nextQuery.create
  void router.replace({ path: route.path, query: nextQuery })
  return true
}

function openEditModal(place: StorageLocationRow) {
  editingId.value = place.id
  const cap = place.capacity_tons
  form.value = {
    name: place.name,
    typeId: place.location_type_id,
    statusId: place.location_status_id,
    fillStatusId: place.fill_status_id,
    cropKey: place.crop_key || '',
    address: place.address,
    capacityTons:
      cap != null && Number.isFinite(Number(cap)) ? String(Number(cap)).replace('.', ',') : '',
    fgisCode: place.fgis_grain_code || '',
  }
  modalError.value = null
  modalOpen.value = true
}

function closeModal() {
  if (saving.value) return
  modalOpen.value = false
  clearCreateQuery()
}

async function savePlace() {
  if (!isSupabaseConfigured()) return
  const name = form.value.name.trim()
  const address = form.value.address.trim()
  const capacityTons = parseCapacityTonsInput(form.value.capacityTons)
  if (!name || !address || capacityTons === null) return

  saving.value = true
  modalError.value = null
  try {
    if (editingId.value) {
      await updateStorageLocation(editingId.value, {
        name,
        location_type_id: form.value.typeId,
        location_status_id: form.value.statusId,
        fill_status_id: form.value.fillStatusId,
        address,
        capacity_tons: capacityTons,
        fgis_grain_code: form.value.fgisCode.trim() || null,
        crop_key: form.value.cropKey.trim() || null,
      })
    } else {
      await addStorageLocation({
        name,
        location_type_id: form.value.typeId,
        location_status_id: form.value.statusId,
        fill_status_id: form.value.fillStatusId,
        address,
        capacity_tons: capacityTons,
        fgis_grain_code: form.value.fgisCode.trim() || null,
        crop_key: form.value.cropKey.trim() || null,
      })
    }
    modalOpen.value = false
    page.value = 1
    if (!clearCreateQuery()) await reloadStorageLocations()
  } catch (e) {
    modalError.value = mapError(e, 'Не удалось сохранить место хранения')
  } finally {
    saving.value = false
  }
}

function requestDeletePlace(id: string) {
  deleteTargetId.value = id
  deleteConfirmOpen.value = true
}

function closeDeleteConfirm() {
  if (saving.value) return
  deleteConfirmOpen.value = false
  deleteTargetId.value = null
}

async function confirmDeletePlace() {
  if (!deleteTargetId.value || !isSupabaseConfigured()) return
  saving.value = true
  error.value = null
  try {
    await deleteStorageLocation(deleteTargetId.value)
    deleteConfirmOpen.value = false
    deleteTargetId.value = null
    await reloadStorageLocations()
  } catch (e) {
    error.value = mapError(e, 'Не удалось удалить место хранения')
    deleteConfirmOpen.value = false
    deleteTargetId.value = null
  } finally {
    saving.value = false
  }
}

const deleteTargetName = computed(() => storagePlaces.value.find((p) => p.id === deleteTargetId.value)?.name ?? '')

onMounted(async () => {
  await loadStorageRefs()
  void reloadStorageLocations()
  tryOpenCreateFromQuery()
})

watch(
  () => route.query.create,
  () => {
    tryOpenCreateFromQuery()
  },
)

watch(search, () => {
  page.value = 1
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void reloadStorageLocations(), 300)
})

function setPage(next: number) {
  const clamped = Math.min(totalPages.value, Math.max(1, next))
  if (clamped === page.value) return
  page.value = clamped
  void reloadStorageLocations()
}

function onPageSizeChange(size: number) {
  pageSize.value = size
  page.value = 1
  void reloadStorageLocations()
}
</script>

<template>
  <section class="tw-scope flex flex-col gap-6">
    <PageToolbar>
      <InputGroup class="w-full sm:w-80">
        <InputGroupAddon><SearchIcon /></InputGroupAddon>
        <InputGroupInput v-model.trim="search" type="search" placeholder="Название или адрес" autocomplete="off" aria-label="Поиск места хранения" />
      </InputGroup>
      <template #actions>
        <Button type="button" @click="openCreateModal">
          <PlusIcon />
          Добавить место хранения
        </Button>
      </template>
    </PageToolbar>

    <Alert v-if="!isSupabaseConfigured()" variant="destructive">
      <AlertDescription>Нет подключения к базе: не заданы адрес и ключ Supabase.</AlertDescription>
    </Alert>
    <Alert v-else-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="loading" class="grid gap-2">
      <Skeleton v-for="i in 4" :key="i" class="h-12 w-full" />
    </div>
    <template v-else-if="pagedPlaces.length">
      <div class="sm:overflow-hidden sm:rounded-xl sm:border sm:bg-card">
        <Table v-card-table class="min-w-[60rem]" aria-label="Места хранения">
          <TableHeader class="bg-muted/50">
            <TableRow>
              <TableHead class="pl-4">Название</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Адрес</TableHead>
              <TableHead class="text-right">Вместимость</TableHead>
              <TableHead class="text-right">Лежит</TableHead>
              <TableHead>Культуры</TableHead>
              <TableHead>Код ФГИС «Зерно»</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead class="w-px pr-4"><span class="sr-only">Действия</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="place in pagedPlaces" :key="place.id">
              <TableCell class="max-w-48 pl-4">
                <RouterLink :to="{ name: 'warehouse-cell', params: { id: place.id } }" class="block truncate font-medium no-underline underline-offset-4 hover:text-primary hover:underline" :title="place.name">{{ place.name }}</RouterLink>
              </TableCell>
              <TableCell>{{ storageLocationTypeName(place) }}</TableCell>
              <TableCell class="max-w-56"><span class="block truncate" :title="place.address">{{ place.address }}</span></TableCell>
              <TableCell class="text-right tabular-nums">{{ formatCapacityCell(place.capacity_tons) }}</TableCell>
              <TableCell class="text-right font-medium tabular-nums">{{ stockByPlace[place.id] ? formatTons(stockByPlace[place.id].tons) : '—' }}</TableCell>
              <TableCell class="max-w-48"><span class="block truncate" :title="stockCropsLabel(place.id)">{{ stockCropsLabel(place.id) }}</span></TableCell>
              <TableCell class="max-w-40"><span class="block truncate text-muted-foreground tabular-nums" :title="place.fgis_grain_code || ''">{{ place.fgis_grain_code || '—' }}</span></TableCell>
              <TableCell>
                <UiBadge :tone="storageLocationMarksInactive(place) ? 'neutral' : 'success'">{{ storageLocationStatusName(place) }}</UiBadge>
              </TableCell>
              <TableCell class="pr-4">
                <div class="flex justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" type="button" class="text-muted-foreground" :aria-label="`Изменить «${place.name}»`" @click="openEditModal(place)">
                    <PencilIcon />
                  </Button>
                  <UiDeleteButton size="sm" @click="requestDeletePlace(place.id)" />
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <UiPagination
        :page="page"
        :page-size="pageSize"
        :total="total"
        @update:page="setPage"
        @update:page-size="onPageSizeChange"
      />
    </template>
    <Empty v-else class="rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon"><BoxIcon /></EmptyMedia>
        <EmptyTitle>{{ search ? 'Ничего не найдено' : 'Мест хранения пока нет' }}</EmptyTitle>
        <EmptyDescription>{{ search ? 'Измените поиск.' : 'Склады, силосы, тока и бурты для хранения зерна. Добавьте первое место.' }}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent v-if="!search">
        <Button size="sm" type="button" @click="openCreateModal"><PlusIcon />Добавить место хранения</Button>
      </EmptyContent>
    </Empty>

    <UiModal
      v-if="modalOpen"
      :title="editingId ? 'Место хранения' : 'Новое место хранения'"
      :close-disabled="saving"
      @close="closeModal"
    >
      <form id="storage-place-form" class="tw-scope" @submit.prevent="savePlace">
        <FormGrid :cols="2">
          <Alert v-if="modalError" variant="destructive" class="sm:col-span-full">
            <AlertDescription>{{ modalError }}</AlertDescription>
          </Alert>
          <FormField label="Название" for="sp-name" wide required>
            <Input id="sp-name" v-model.trim="form.name" type="text" placeholder="Например, Склад А" />
          </FormField>
          <FormField label="Тип" required>
            <template #label-actions>
              <RefFieldHelp text="Нет нужного типа? Добавьте его в" :to="{ path: '/lands', query: { tab: 'storage-types' } }" link-label="Справочники хранения" />
            </template>
            <UiSelect v-model="form.typeId" block aria-label="Тип" :options="storageTypes.map((t) => ({ value: t.id, label: t.name }))" :placeholder="storageTypes.length ? 'Выберите тип' : 'Сначала добавьте типы'" />
          </FormField>
          <FormField label="Статус" required>
            <template #label-actions>
              <RefFieldHelp text="Нужен другой статус? Создайте его в" :to="{ path: '/lands', query: { tab: 'storage-statuses' } }" link-label="Справочники хранения" />
            </template>
            <UiSelect v-model="form.statusId" block aria-label="Статус" :options="storageStatuses.map((st) => ({ value: st.id, label: st.name }))" :placeholder="storageStatuses.length ? 'Выберите статус' : 'Сначала добавьте статусы'" />
          </FormField>
          <FormField label="Адрес" for="sp-address" wide required>
            <Input id="sp-address" v-model.trim="form.address" type="text" placeholder="Населённый пункт, улица" />
          </FormField>
          <FormField label="Вместимость, т" for="sp-capacity" required hint="Сколько зерна можно разместить.">
            <Input id="sp-capacity" v-model.trim="form.capacityTons" type="text" inputmode="decimal" placeholder="2500 или 120,5" autocomplete="off" />
          </FormField>
          <FormField label="Код ФГИС «Зерно»" for="sp-fgis" hint="Необязательно.">
            <Input id="sp-fgis" v-model.trim="form.fgisCode" type="text" />
          </FormField>
        </FormGrid>
      </form>
      <template #actions>
        <UiButton :disabled="saving" @click="closeModal">Отмена</UiButton>
        <UiButton variant="primary" type="submit" form="storage-place-form" :disabled="saving || !canSavePlace">
          {{ saving ? 'Сохранение…' : 'Сохранить' }}
        </UiButton>
      </template>
    </UiModal>

    <UiConfirmModal
      v-if="deleteConfirmOpen"
      :title="deleteTargetName ? `Удалить «${deleteTargetName}»?` : 'Удалить место хранения?'"
      :busy="saving"
      @cancel="closeDeleteConfirm"
      @confirm="confirmDeletePlace"
    />
  </section>
</template>
