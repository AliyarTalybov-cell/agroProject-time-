<script setup lang="ts">
import { Input } from '@/components/ui/shadcn/input'
import { Button } from '@/components/ui/shadcn/button'
import { BoxIcon, PencilIcon, PlusIcon, SearchIcon } from '@lucide/vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
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
  error.value = null
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
    error.value = mapError(e, 'Не удалось сохранить место хранения')
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
  } finally {
    saving.value = false
  }
}

function typePillClass(typeName: string): string {
  if (typeName === 'Ток') return 'storage-type-pill--tok'
  if (typeName === 'Силос') return 'storage-type-pill--silos'
  if (typeName === 'Склад') return 'storage-type-pill--warehouse'
  return 'storage-type-pill--burt'
}

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
  <section class="fields-page">
    <div class="fields-page-inner">
      <header class="fields-header page-enter-item">
        <div class="fields-header-text">
          <p class="fields-subtitle">Склады, силосы, тока и бурты для хранения зерна</p>
        </div>
        <Button variant="default" class="fields-add-btn" type="button" @click="openCreateModal">
          <PlusIcon class="fields-add-btn-icon" />
          Добавить место хранения
        </Button>
      </header>

      <section class="fields-card">
      <div v-if="!isSupabaseConfigured()" class="storage-alert" role="status">
        Supabase не настроен. Добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в `frontend/.env.local`.
      </div>
      <div v-else-if="error" class="storage-alert storage-alert--error" role="alert">{{ error }}</div>

      <div class="fields-toolbar">
        <div class="fields-search-wrap">
          <SearchIcon class="fields-search-icon" />
          <input v-model.trim="search" class="fields-search-input" type="search" placeholder="Поиск по названию или адресу..." autocomplete="off" />
        </div>
      </div>

      <div v-if="loading" class="fields-loading" role="status" aria-live="polite">
        <UiLoadingBar />
      </div>

      <div v-else-if="pagedPlaces.length" class="fields-table-wrap">
        <table class="fields-table storage-table" aria-label="Список мест хранения" v-card-table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Тип</th>
              <th>Адрес</th>
              <th>Вместимость</th>
              <th>Код ФГИС Зерно</th>
              <th>Лежит</th>
              <th>Культуры</th>
              <th>Статус места</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="place in pagedPlaces" :key="place.id">
              <td>
                <div class="storage-name-cell">
                  <strong class="storage-name-text storage-cell-ellipsis" :title="place.name">{{ place.name }}</strong>
                </div>
              </td>
              <td>
                <span class="storage-type-pill" :class="typePillClass(storageLocationTypeName(place))">{{ storageLocationTypeName(place) }}</span>
              </td>
              <td><span class="storage-cell-ellipsis storage-address-text" :title="place.address">{{ place.address }}</span></td>
              <td class="storage-capacity">{{ formatCapacityCell(place.capacity_tons) }}</td>
              <td class="storage-code"><span class="storage-cell-ellipsis storage-code-text" :title="place.fgis_grain_code || '—'">{{ place.fgis_grain_code || '—' }}</span></td>
              <td class="storage-capacity">{{ stockByPlace[place.id] ? formatTons(stockByPlace[place.id].tons) : '—' }}</td>
              <td class="storage-crop"><span class="storage-cell-ellipsis" :title="stockCropsLabel(place.id)">{{ stockCropsLabel(place.id) }}</span></td>
              <td>
                <span class="storage-status" :class="{ 'storage-status--off': storageLocationMarksInactive(place) }">
                  {{ storageLocationStatusName(place) }}
                </span>
              </td>
              <td class="storage-td-actions" @click.stop>
                <div class="fields-actions-row">
                  <Button variant="ghost" size="icon-sm" type="button" class="fields-action-btn" aria-label="Редактировать" title="Редактировать" @click="openEditModal(place)">
                    <PencilIcon :size="18" />
                  </Button>
                  <UiDeleteButton size="sm" class="storage-delete-btn" @click="requestDeletePlace(place.id)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="storage-empty">
        <div class="storage-empty-icon" aria-hidden="true">
          <BoxIcon :size="52" :stroke-width="1.7" />
        </div>
        <h3>Нет мест хранения</h3>
        <p>Добавьте первый склад или ток для начала работы</p>
        <Button variant="default" type="button" class="fields-add-btn" @click="openCreateModal">
          <PlusIcon class="fields-add-btn-icon" />
          Добавить место хранения
        </Button>
      </div>

      <UiPagination
        v-if="!loading && total > 0"
        :page="page"
        :page-size="pageSize"
        :total="total"
        @update:page="setPage"
        @update:page-size="onPageSizeChange"
      />
    </section>

    <teleport to="body">
      <UiModal
        v-if="modalOpen"
        :title="editingId ? 'Редактирование места хранения' : 'Новое место хранения'"
        :close-disabled="saving"
        @close="closeModal"
      >
        <div class="task-form-row task-form-row--design">
          <div class="task-form-field">
            <label class="task-form-label">Название *</label>
            <Input v-model.trim="form.name" type="text" class="task-form-input task-form-input--title" placeholder="Например: Склад А" />
          </div>
        </div>

        <div class="task-form-row task-form-row--two task-form-row--design">
          <div class="task-form-field">
            <label class="task-form-label task-form-label--with-help">Тип *
              <RefFieldHelp text="Нет нужного типа? Добавьте его в" :to="{ path: '/lands', query: { tab: 'storage-types' } }" link-label="Справочники хранения" />
            </label>
            <UiSelect v-model="form.typeId" :options="storageTypes.map((t) => ({ value: t.id, label: t.name }))" :placeholder="storageTypes.length ? 'Выберите тип' : 'Сначала добавьте типы в справочниках'" class="task-form-select" />
          </div>
          <div class="task-form-field">
            <label class="task-form-label task-form-label--with-help">Статус места *
              <RefFieldHelp text="Нужен другой статус? Создайте его в" :to="{ path: '/lands', query: { tab: 'storage-statuses' } }" link-label="Справочники хранения" />
            </label>
            <UiSelect v-model="form.statusId" :options="storageStatuses.map((s) => ({ value: s.id, label: s.name }))" :placeholder="storageStatuses.length ? 'Выберите статус' : 'Сначала добавьте статусы в справочниках'" class="task-form-select" />
          </div>
        </div>

        <div class="task-form-row task-form-row--design">
          <div class="task-form-field">
            <label class="task-form-label">Адрес *</label>
            <Input v-model.trim="form.address" type="text" class="task-form-input" placeholder="Укажите адрес места хранения" />
          </div>
        </div>

        <div class="task-form-row task-form-row--design">
          <div class="task-form-field">
            <label class="task-form-label">Вместительность, т *</label>
            <Input
              v-model.trim="form.capacityTons"
              type="text"
              inputmode="decimal"
              class="task-form-input"
              placeholder="Например: 2500 или 120,5"
              autocomplete="off" />
            <p class="storage-field-hint">Номинальная масса зерна, которую можно разместить (тонны).</p>
          </div>
        </div>

        <div class="task-form-row task-form-row--design">
          <div class="task-form-field">
            <label class="task-form-label">Код ФГИС Зерно (необязательно)</label>
            <Input v-model.trim="form.fgisCode" type="text" class="task-form-input" placeholder="Можно оставить пустым" />
          </div>
        </div>
        <template #actions>
          <UiButton :disabled="saving" @click="closeModal">Отмена</UiButton>
          <UiButton variant="primary" :disabled="saving || !canSavePlace" @click="savePlace">
            {{ saving ? 'Сохранение…' : 'Сохранить' }}
          </UiButton>
        </template>
      </UiModal>

      <UiConfirmModal
        v-if="deleteConfirmOpen"
        title="Удалить место хранения?"
        :busy="saving"
        @cancel="closeDeleteConfirm"
        @confirm="confirmDeletePlace"
      />
    </teleport>
    </div>
  </section>
</template>

<style scoped>
@layer legacy {
.fields-page {
  width: 100%;
}

.fields-page-inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.fields-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-md);
}

.fields-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fields-subtitle {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.fields-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: var(--control-h);
  border: 1px solid var(--accent-green);
  border-radius: var(--radius-md);
  background: var(--accent-green);
  color: #fff;
  padding: 0 14px;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.fields-add-btn:hover {
  background: var(--accent-green-hover);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(61, 92, 64, 0.3);
}

.fields-add-btn-icon {
  width: 18px;
  height: 18px;
  transform-origin: center;
  transition: transform 0.28s ease;
}

.fields-add-btn:hover .fields-add-btn-icon {
  transform: rotate(52deg) scale(1.18);
}

.fields-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  padding: 12px;
}

.fields-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: 10px;
}

.fields-search-wrap {
  position: relative;
  flex: 1;
  min-width: 200px;
  max-width: 28rem;
}

.fields-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
  pointer-events: none;
}

.fields-search-input {
  width: 100%;
  height: var(--control-h);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-md);
  background: var(--input-bg);
  color: var(--text-primary);
  padding: 0 12px 0 34px;
  font-size: 0.93rem;
  box-shadow: var(--shadow-xs);
}

.fields-search-input::placeholder {
  color: var(--text-secondary);
}

.fields-search-input:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 1px var(--accent-green);
}

[data-theme='dark'] .fields-search-input {
  background: var(--toolbar-form-surface);
  border-color: var(--toolbar-form-surface-border);
  color: var(--text-primary);
}

.fields-table-wrap {
  overflow: visible;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  position: relative;
  z-index: 1;
}

.fields-table {
  width: 100%;
  min-width: 1020px;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.fields-table thead {
  background: rgba(0, 0, 0, 0.02);
}

.fields-table th,
.fields-table td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}

.fields-table th {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.fields-table tbody tr {
  transition: background 0.15s ease;
}

.fields-table tbody tr:hover {
  background: var(--row-hover-bg);
}

.storage-name-cell {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
}

.storage-cell-ellipsis {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.storage-name-text {
  max-width: min(44vw, 420px);
}

.storage-address-text {
  max-width: min(32vw, 360px);
}

.storage-code-text {
  max-width: 150px;
}

.storage-type-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 0.74rem;
  font-weight: 700;
}

.storage-type-pill--tok {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
  border-color: rgba(245, 158, 11, 0.28);
}

.storage-type-pill--silos {
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
  border-color: rgba(59, 130, 246, 0.26);
}

.storage-type-pill--warehouse {
  background: rgba(139, 92, 246, 0.12);
  color: #6d28d9;
  border-color: rgba(139, 92, 246, 0.25);
}

.storage-type-pill--burt {
  background: rgba(217, 119, 6, 0.12);
  color: #b45309;
  border-color: rgba(217, 119, 6, 0.28);
}

[data-theme='dark'] .storage-type-pill {
  border-width: 1px;
}

[data-theme='dark'] .storage-type-pill--tok {
  background: rgba(245, 158, 11, 0.22);
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.5);
}

[data-theme='dark'] .storage-type-pill--silos {
  background: rgba(59, 130, 246, 0.22);
  color: #bfdbfe;
  border-color: rgba(59, 130, 246, 0.5);
}

[data-theme='dark'] .storage-type-pill--warehouse {
  background: rgba(139, 92, 246, 0.24);
  color: #ddd6fe;
  border-color: rgba(139, 92, 246, 0.52);
}

[data-theme='dark'] .storage-type-pill--burt {
  background: rgba(217, 119, 6, 0.24);
  color: #fed7aa;
  border-color: rgba(217, 119, 6, 0.52);
}

.storage-code {
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.8rem;
}

.storage-capacity {
  white-space: nowrap;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.storage-crop {
  max-width: 10rem;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.storage-field-hint {
  margin: 6px 0 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
  line-height: 1.35;
}

.storage-status {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #15803d;
  background: rgba(34, 197, 94, 0.1);
  font-size: 0.78rem;
  font-weight: 700;
}

.storage-status--off {
  border-color: rgba(100, 116, 139, 0.35);
  color: var(--text-secondary);
  background: rgba(148, 163, 184, 0.12);
}

.fields-actions-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.fields-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  color: var(--text-secondary);
  transition: background 0.2s ease, color 0.2s ease;
}

.fields-action-btn svg {
  transform-origin: center;
  transition: transform 0.24s ease;
}

.fields-action-btn:hover {
  background: var(--bg-panel-hover);
  color: var(--text-primary);
}

.fields-action-btn:hover svg {
  transform: rotate(16deg) scale(1.08);
}

.storage-delete-btn {
  position: relative;
  z-index: 40;
}

[data-theme='dark'] .fields-action-btn {
  color: color-mix(in srgb, var(--text-primary) 84%, white);
}

[data-theme='dark'] .fields-action-btn:hover {
  background: color-mix(in srgb, var(--accent-green) 20%, transparent);
  color: #f5f7fa;
}

[data-theme='dark'] .storage-delete-btn :deep(.ui-del-btn) {
  color: color-mix(in srgb, #f87171 88%, white);
}

[data-theme='dark'] .storage-delete-btn :deep(.ui-del-btn:hover),
[data-theme='dark'] .storage-delete-btn :deep(.ui-del-root:hover .ui-del-btn) {
  background: rgba(239, 68, 68, 0.2);
  color: #fecaca;
}

[data-theme='dark'] .storage-status {
  color: #86efac;
  background: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.45);
}

[data-theme='dark'] .storage-status--off {
  color: #cbd5e1;
  background: rgba(148, 163, 184, 0.2);
  border-color: rgba(148, 163, 184, 0.45);
}

.storage-alert {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.storage-alert--error {
  background: rgba(185, 28, 28, 0.1);
  border-color: rgba(185, 28, 28, 0.22);
  color: var(--danger-red);
}

.fields-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg) 24px;
}

.storage-empty {
  min-height: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  padding: 20px;
}

.storage-empty-icon {
  color: #94a3b8;
}

.storage-empty h3 {
  margin: 4px 0 0;
}

.storage-empty p {
  margin: 0 0 12px;
  color: var(--text-secondary);
}

.task-form-row--design {
  margin-bottom: 0;
}

.task-form-row--two {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.task-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.task-form-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 5px;
  line-height: 1.3;
}

.task-form-input,
.task-form-select {
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--input-border);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  line-height: 1.4;
  box-shadow: var(--shadow-xs);
}

.task-form-input:focus,
.task-form-select:focus {
  outline: none;
  border-color: var(--agro);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--agro) 20%, transparent);
}

.task-form-input--title {
  font-size: 0.95rem;
  font-weight: 600;
}

.task-form-label--with-help {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

@media (max-width: 900px) {
  .fields-header {
    flex-direction: column;
    align-items: stretch;
  }

  .fields-add-btn {
    width: 100%;
    justify-content: center;
  }

  .fields-search-wrap {
    max-width: none;
    width: 100%;
  }

  .task-form-row--two {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .fields-card {
    padding: 10px;
  }

  .fields-table {
    min-width: 880px;
  }

  .storage-name-text {
    max-width: 220px;
  }

  .storage-address-text {
    max-width: 180px;
  }

  .storage-code-text {
    max-width: 110px;
  }
}
}
</style>
