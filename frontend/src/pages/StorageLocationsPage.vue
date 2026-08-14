<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  addStorageLocation,
  deleteStorageLocation,
  loadStorageLocationsPage,
  updateStorageLocation,
  storageLocationCropLabel,
  storageLocationFillStatusName,
  storageLocationMarksInactive,
  storageLocationStatusName,
  storageLocationTypeName,
  type StorageLocationRow,
} from '@/lib/storageLocationsSupabase'
import { loadCrops, type CropRow } from '@/lib/landTypesAndCrops'
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
const pageSize = ref(6)

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
const pageStart = computed(() => (total.value ? (page.value - 1) * pageSize.value + 1 : 0))
const pageEnd = computed(() => Math.min(page.value * pageSize.value, total.value))

const pagedPlaces = computed(() => storagePlaces.value)

const pageNumbers = computed(() => {
  if (totalPages.value <= 7) return Array.from({ length: totalPages.value }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  if (page.value > 4) pages.push('ellipsis')
  for (let p = Math.max(2, page.value - 1); p <= Math.min(totalPages.value - 1, page.value + 1); p += 1) pages.push(p)
  if (page.value < totalPages.value - 3) pages.push('ellipsis')
  pages.push(totalPages.value)
  return pages
})

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
  } catch {
    storageTypes.value = []
    storageStatuses.value = []
    storageFillStatuses.value = []
    crops.value = []
  }
}

async function reloadStorageLocations() {
  if (!isSupabaseConfigured()) {
    storagePlaces.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    const res = await loadStorageLocationsPage({ search: search.value, page: page.value, pageSize: pageSize.value })
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
  if (raw === '1' || raw === 'true') {
    openCreateModal()
    const nextQuery = { ...route.query }
    delete nextQuery.create
    void router.replace({ path: route.path, query: nextQuery })
  }
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
    await reloadStorageLocations()
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

function onPageSizeChange() {
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
        <button class="fields-add-btn" type="button" @click="openCreateModal">
          <svg class="fields-add-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
          Добавить место хранения
        </button>
      </header>

      <section class="fields-card">
      <div v-if="!isSupabaseConfigured()" class="storage-alert" role="status">
        Supabase не настроен. Добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в `frontend/.env.local`.
      </div>
      <div v-else-if="error" class="storage-alert storage-alert--error" role="alert">{{ error }}</div>

      <div class="fields-toolbar">
        <div class="fields-search-wrap">
          <svg class="fields-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input v-model.trim="search" class="fields-search-input" type="search" placeholder="Поиск по названию или адресу..." autocomplete="off" />
        </div>
      </div>

      <div v-if="loading" class="fields-loading" role="status" aria-live="polite">
        <UiLoadingBar />
      </div>

      <div v-else-if="pagedPlaces.length" class="fields-table-wrap">
        <table class="fields-table storage-table" aria-label="Список мест хранения">
          <thead>
            <tr>
              <th>Название</th>
              <th>Тип</th>
              <th>Адрес</th>
              <th>Вместимость</th>
              <th>Код ФГИС Зерно</th>
              <th>Заполнение</th>
              <th>Культура</th>
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
              <td class="storage-fill-status">{{ storageLocationFillStatusName(place) }}</td>
              <td class="storage-crop"><span class="storage-cell-ellipsis" :title="storageLocationCropLabel(place)">{{ storageLocationCropLabel(place) }}</span></td>
              <td>
                <span class="storage-status" :class="{ 'storage-status--off': storageLocationMarksInactive(place) }">
                  {{ storageLocationStatusName(place) }}
                </span>
              </td>
              <td class="storage-td-actions" @click.stop>
                <div class="fields-actions-row">
                  <button type="button" class="fields-action-btn" aria-label="Редактировать" title="Редактировать" @click="openEditModal(place)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <UiDeleteButton size="sm" class="storage-delete-btn" @click="requestDeletePlace(place.id)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="storage-empty">
        <div class="storage-empty-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
        </div>
        <h3>Нет мест хранения</h3>
        <p>Добавьте первый склад или ток для начала работы</p>
        <button type="button" class="fields-add-btn" @click="openCreateModal">
          <svg class="fields-add-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
          Добавить место хранения
        </button>
      </div>

      <footer v-if="!loading && total > 0" class="fields-pagination">
        <p class="fields-pagination-info">
          Показано
          <span class="fields-pagination-num">{{ pageStart }}</span>
          –
          <span class="fields-pagination-num">{{ pageEnd }}</span>
          из
          <span class="fields-pagination-num">{{ total }}</span>
        </p>
        <div class="fields-pagination-right">
          <nav class="fields-pagination-nav" aria-label="Пагинация">
            <button type="button" class="fields-page-btn fields-page-btn--edge" :disabled="page <= 1" aria-label="Предыдущая страница" @click="setPage(page - 1)">
              &lt;
            </button>
            <template v-for="(p, i) in pageNumbers" :key="p === 'ellipsis' ? `sp-e-${i}` : p">
              <button
                v-if="p !== 'ellipsis'"
                type="button"
                class="fields-page-btn"
                :class="{ 'fields-page-btn--active': p === page }"
                @click="setPage(p as number)"
              >
                {{ p }}
              </button>
              <span v-else class="fields-page-ellipsis">…</span>
            </template>
            <button type="button" class="fields-page-btn fields-page-btn--edge" :disabled="page >= totalPages" aria-label="Следующая страница" @click="setPage(page + 1)">
              &gt;
            </button>
          </nav>
          <label class="fields-pagination-size">
            <span class="fields-pagination-size-label">На странице</span>
            <select v-model.number="pageSize" class="fields-pagination-select" @change="onPageSizeChange">
              <option :value="5">5</option>
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
            </select>
          </label>
        </div>
      </footer>
    </section>

    <teleport to="body">
      <div v-if="modalOpen" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Место хранения" @click.self="closeModal">
        <div class="modal modal-fields modal-fields--add storage-modal" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2 class="modal-title">{{ editingId ? 'Редактирование места хранения' : 'Новое место хранения' }}</h2>
            <ModalCloseButton @click="closeModal" />
          </div>
          <div class="modal-body">
            <div class="task-form-row task-form-row--design">
              <div class="task-form-field">
                <label class="task-form-label">Название *</label>
                <input v-model.trim="form.name" type="text" class="task-form-input task-form-input--title" placeholder="Например: Склад А" />
              </div>
            </div>

            <div class="task-form-row task-form-row--two task-form-row--design">
              <div class="task-form-field">
                <label class="task-form-label task-form-label--with-help">Тип *
                  <RefFieldHelp text="Нет нужного типа? Добавьте его в" :to="{ path: '/lands', query: { tab: 'storage-types' } }" link-label="Справочники хранения" />
                </label>
                <select v-model="form.typeId" class="task-form-select" required>
                  <option v-if="!storageTypes.length" value="" disabled>Сначала добавьте типы в справочниках</option>
                  <option v-for="t in storageTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
                </select>
              </div>
              <div class="task-form-field">
                <label class="task-form-label task-form-label--with-help">Статус места *
                  <RefFieldHelp text="Нужен другой статус? Создайте его в" :to="{ path: '/lands', query: { tab: 'storage-statuses' } }" link-label="Справочники хранения" />
                </label>
                <select v-model="form.statusId" class="task-form-select" required>
                  <option v-if="!storageStatuses.length" value="" disabled>Сначала добавьте статусы в справочниках</option>
                  <option v-for="s in storageStatuses" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>
              </div>
            </div>

            <div class="task-form-row task-form-row--design">
              <div class="task-form-field">
                <label class="task-form-label task-form-label--with-help">Статус заполнения *
                  <RefFieldHelp text="Нужен другой вариант? Добавьте его в" :to="{ path: '/lands', query: { tab: 'storage-fill-statuses' } }" link-label="Справочники хранения" />
                </label>
                <select v-model="form.fillStatusId" class="task-form-select" required>
                  <option v-if="!storageFillStatuses.length" value="" disabled>Сначала добавьте статусы в справочниках</option>
                  <option v-for="s in storageFillStatuses" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>
              </div>
            </div>

            <div class="task-form-row task-form-row--design">
              <div class="task-form-field">
                <label class="task-form-label task-form-label--with-help">Культура (необязательно)
                  <RefFieldHelp text="Справочник ведётся в" :to="{ path: '/lands', query: { tab: 'crops-refs' } }" link-label="Справочники СХ культур" />
                </label>
                <select v-model="form.cropKey" class="task-form-select">
                  <option value="">Не указано</option>
                  <option v-for="c in crops" :key="c.id" :value="c.key">{{ c.label }}</option>
                </select>
              </div>
            </div>

            <div class="task-form-row task-form-row--design">
              <div class="task-form-field">
                <label class="task-form-label">Адрес *</label>
                <input v-model.trim="form.address" type="text" class="task-form-input" placeholder="Укажите адрес места хранения" />
              </div>
            </div>

            <div class="task-form-row task-form-row--design">
              <div class="task-form-field">
                <label class="task-form-label">Вместительность, т *</label>
                <input
                  v-model.trim="form.capacityTons"
                  type="text"
                  inputmode="decimal"
                  class="task-form-input"
                  placeholder="Например: 2500 или 120,5"
                  autocomplete="off"
                />
                <p class="storage-field-hint">Номинальная масса зерна, которую можно разместить (тонны).</p>
              </div>
            </div>

            <div class="task-form-row task-form-row--design">
              <div class="task-form-field">
                <label class="task-form-label">Код ФГИС Зерно (необязательно)</label>
                <input v-model.trim="form.fgisCode" type="text" class="task-form-input" placeholder="Можно оставить пустым" />
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="task-form-cancel" :disabled="saving" @click="closeModal">Отмена</button>
            <button type="button" class="task-form-submit" :disabled="saving || !canSavePlace" @click="savePlace">
              {{ saving ? 'Сохранение…' : 'Сохранить' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="deleteConfirmOpen" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Подтверждение удаления" @click.self="closeDeleteConfirm">
        <div class="modal modal-fields storage-modal storage-modal--confirm">
          <div class="modal-header">
            <h2 class="modal-title">Удалить место хранения?</h2>
            <ModalCloseButton :disabled="saving" @click="closeDeleteConfirm" />
          </div>
          <div class="modal-body">
            <p class="storage-confirm-text">Это действие нельзя отменить.</p>
          </div>
          <div class="modal-actions">
            <button type="button" class="task-form-cancel" :disabled="saving" @click="closeDeleteConfirm">Отмена</button>
            <button type="button" class="task-form-submit storage-task-delete-submit" :disabled="saving" @click="confirmDeletePlace">
              {{ saving ? 'Удаление…' : 'Удалить' }}
            </button>
          </div>
        </div>
      </div>
    </teleport>
    </div>
  </section>
</template>

<style scoped>
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
  height: 38px;
  border: 1px solid var(--accent-green);
  border-radius: 10px;
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
  border-radius: 12px;
  box-shadow: var(--shadow-card);
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
  height: 38px;
  border: 1px solid var(--toolbar-form-surface-border);
  border-radius: 10px;
  background: var(--toolbar-form-surface);
  color: var(--text-primary);
  padding: 0 12px 0 34px;
  font-size: 0.93rem;
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
  border-radius: 12px;
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
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
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

.fields-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-md);
  padding: var(--space-md) var(--space-lg) 0;
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
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.fields-page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fields-page-btn--edge {
  width: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
}

.fields-page-btn--active {
  background: rgba(76, 175, 80, 0.15);
  border-color: rgba(76, 175, 80, 0.5);
}

.fields-page-btn:hover:not(:disabled):not(.fields-page-btn--active) {
  background: var(--bg-panel-hover);
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
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.modal {
  width: min(calc(100vw - 48px), 620px);
  max-height: 90vh;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
  overscroll-behavior: contain;
}

.storage-modal {
  max-width: 560px;
}

.storage-modal--confirm {
  max-width: 460px;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-color);
}

.modal-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.modal-body {
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
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
  font-size: 0.64rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.875rem;
  line-height: 1.4;
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

.task-form-cancel,
.task-form-submit {
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  padding: 0 14px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.task-form-cancel {
  background: var(--bg-panel);
  color: var(--text-primary);
}

.task-form-submit {
  border-color: transparent;
  background: var(--accent-green);
  color: #fff;
}

.task-form-submit:hover:not(:disabled) {
  background: var(--accent-green-hover);
}

.task-form-cancel:disabled,
.task-form-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.storage-task-delete-submit {
  background: #b42318;
}

.storage-task-delete-submit:hover:not(:disabled) {
  background: #9f1f15;
}

.storage-confirm-text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.45;
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

  .fields-pagination {
    flex-direction: column;
    align-items: flex-start;
  }

  .fields-pagination-right {
    width: 100%;
    justify-content: space-between;
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
</style>
