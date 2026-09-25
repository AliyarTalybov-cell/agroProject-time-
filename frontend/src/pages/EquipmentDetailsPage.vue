<script setup lang="ts">
import ImagePreviewDialog from '@/components/ui/dialogs/ImagePreviewDialog.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  getEquipmentById,
  loadEquipmentImplementsOptions,
  loadEquipmentTypeRefs,
  loadEquipmentConditionRefs,
  loadEquipmentPhotos,
  loadEquipmentDocuments,
  addEquipmentPhoto,
  addEquipmentDocument,
  deleteEquipmentPhoto,
  deleteEquipmentDocument,
  type EquipmentPhotoRow,
  type EquipmentDocumentRow,
  type EquipmentImplementRow,
  type EquipmentRow,
} from '@/lib/equipmentSupabase'
import { loadOperationsByEquipmentFromSupabase, type EquipmentOperationHistoryRow } from '@/lib/analyticsSupabase'
import { loadProfiles, type ProfileRow } from '@/lib/tasksSupabase'
import { avatarColorByPosition } from '@/lib/avatarColors'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UserAvatar from '@/components/UserAvatar.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuth()

const DEFAULT_EQUIPMENT_TYPES: { value: string; label: string }[] = [
  { value: 'tractor', label: 'Трактор' },
  { value: 'combine', label: 'Комбайн' },
  { value: 'sprayer', label: 'Опрыскиватель' },
  { value: 'other', label: 'Другое' },
]

const DEFAULT_CONDITION_OPTIONS: { value: string; label: string }[] = [
  { value: 'operational', label: 'Исправна' },
  { value: 'repair', label: 'В ремонте' },
  { value: 'decommissioned', label: 'Выведена' },
]

const equipmentId = computed(() => (route.params.id as string | undefined) || '')

const loading = ref(true)
const error = ref<string | null>(null)

const equipment = ref<EquipmentRow | null>(null)
const photos = ref<EquipmentPhotoRow[]>([])
const documents = ref<EquipmentDocumentRow[]>([])
const photoUploading = ref(false)
const documentUploading = ref(false)

const fileInputRef = ref<HTMLInputElement | null>(null)
const documentInputRef = ref<HTMLInputElement | null>(null)
const documentPreviewOpen = ref(false)
const documentPreview = ref<{ url: string; name: string } | null>(null)

const profiles = ref<ProfileRow[]>([])
const implementOptions = ref<EquipmentImplementRow[]>([])
const equipmentTypeOptions = ref<{ value: string; label: string }[]>([])
const equipmentConditionOptions = ref<{ value: string; label: string }[]>([])

const historyLoading = ref(false)
const history = ref<EquipmentOperationHistoryRow[]>([])
const historyTotal = ref(0)

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const isManager = computed(() => auth.userRole.value === 'manager')

const profilesMap = computed(() => new Map(profiles.value.map((p) => [p.id, p])))

function equipmentTypeLabel(value: string | null): string {
  if (!value) return '—'
  const source = equipmentTypeOptions.value.length ? equipmentTypeOptions.value : DEFAULT_EQUIPMENT_TYPES
  const opt = source.find((o) => o.value === value)
  return opt?.label ?? value
}

function conditionLabel(value: string): string {
  const source = equipmentConditionOptions.value.length ? equipmentConditionOptions.value : DEFAULT_CONDITION_OPTIONS
  const opt = source.find((o) => o.value === value)
  return opt?.label ?? value
}

const responsibleLabel = computed(() => {
  const id = equipment.value?.responsible_id
  if (!id) return 'Не назначен'
  const p = profilesMap.value.get(id)
  return p?.display_name?.trim() || p?.email || 'Неизвестно'
})

const implementLabel = computed(() => {
  const id = equipment.value?.implement_id
  if (!id) return 'Не выбрано'
  const item = implementOptions.value.find((it) => it.id === id)
  return item?.name ?? 'Неизвестно'
})

function employeeInitials(employee: string): string {
  const base = employee.includes('@') ? employee.split('@')[0] : employee
  const parts = base.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase()
  return '?'
}

/** Как в «Задачах» / профиле: цвет от должности; иначе — стабильный хэш по строке сотрудника */
function profileByEmployeeString(employee: string): ProfileRow | undefined {
  const raw = employee.trim()
  if (!raw) return undefined
  const lower = raw.toLowerCase()
  return profiles.value.find((p) => {
    const mail = (p.email || '').trim().toLowerCase()
    const name = (p.display_name || '').trim().toLowerCase()
    return mail === lower || name === lower || (raw.includes('@') && mail === lower)
  })
}

function employeeAccentColor(employee: string): string {
  const p = profileByEmployeeString(employee)
  if (p?.position && p.position.trim()) return avatarColorByPosition(p.position)
  return avatarColorByPosition(employee)
}

function employeeAvatarStyle(employee: string): Record<string, string> {
  return { background: employeeAccentColor(employee) }
}

function employeeAvatarUrl(employee: string): string | null {
  return profileByEmployeeString(employee)?.avatar_url ?? null
}

function conditionToneClass(h: EquipmentOperationHistoryRow): string {
  const label = (h.equipmentConditionLabel ?? '').toLowerCase()
  if (label.includes('плох') || label.includes('низк')) return 'equipment-history-tone--bad'
  if (label.includes('частич') || label.includes('требует') || label.includes('ремонт')) return 'equipment-history-tone--warn'
  if (label.includes('приемл')) return 'equipment-history-tone--good'
  return 'equipment-history-tone--good'
}

type OperationVisualKind = 'analysis' | 'field' | 'control' | 'default'

function operationVisual(operation: string | null | undefined): {
  kind: OperationVisualKind
  boxBg: string
  iconColor: string
} {
  const s = (operation ?? '').toLowerCase()
  if (s.includes('агрохим') || s.includes('анализ')) {
    return { kind: 'analysis', boxBg: 'rgba(236, 72, 153, 0.2)', iconColor: '#db2777' }
  }
  if (s.includes('обработк')) {
    return { kind: 'field', boxBg: 'rgba(34, 197, 94, 0.2)', iconColor: '#16a34a' }
  }
  if (s.includes('контроль') || (s.includes('полев') && s.includes('работ'))) {
    return { kind: 'control', boxBg: 'rgba(59, 130, 246, 0.2)', iconColor: '#2563eb' }
  }
  return { kind: 'default', boxBg: 'rgba(61, 92, 64, 0.14)', iconColor: 'var(--agro)' }
}

function fuelBarClass(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return 'equipment-history-fuel-fill--empty'
  if (pct < 34) return 'equipment-history-fuel-fill--low'
  if (pct < 67) return 'equipment-history-fuel-fill--mid'
  return 'equipment-history-fuel-fill--high'
}

function fuelStartValue(h: EquipmentOperationHistoryRow): number | null {
  return h.equipmentFuelPercent ?? null
}

function fuelFinalValue(h: EquipmentOperationHistoryRow): number | null {
  return h.equipmentFuelLeftPercent ?? null
}

/** Раскрытие карточек истории */
const expandedHistory = ref<Record<number, boolean>>({})

function isHistoryExpanded(id: number): boolean {
  return expandedHistory.value[id] !== false
}

function toggleHistoryExpand(id: number) {
  expandedHistory.value = { ...expandedHistory.value, [id]: !isHistoryExpanded(id) }
}

function initHistoryExpanded() {
  const next: Record<number, boolean> = {}
  // По умолчанию раскрываем только 3 самых свежих записи (они уже отсортированы DESC по `start_iso` на бэке).
  const DEFAULT_OPEN_COUNT = 3
  const openIds = new Set(history.value.slice(0, DEFAULT_OPEN_COUNT).map((h) => h.id))

  for (const h of history.value) next[h.id] = openIds.has(h.id)
  expandedHistory.value = next
}

/** Пагинация (как на странице «Задачи» / TaskManagementPage) */
const historyPage = ref(1)
const historyPageSize = ref(5)

const historyTotalFiltered = computed(() => historyTotal.value)
const historyTotalPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / historyPageSize.value)))

const historyPaginationStart = computed(() =>
  historyTotal.value ? (historyPage.value - 1) * historyPageSize.value + 1 : 0,
)
const historyPaginationEnd = computed(() =>
  Math.min(historyPage.value * historyPageSize.value, historyTotal.value),
)

const paginatedHistory = computed(() => history.value)

const paginatedHistoryVm = computed(() =>
  paginatedHistory.value.map((h) => ({ h, visual: operationVisual(h.operation) })),
)

const historyPageNumbers = computed(() => {
  const total = historyTotalPages.value
  const current = historyPage.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  if (current <= 4) {
    for (let p = 2; p <= 5; p += 1) pages.push(p)
    pages.push('ellipsis')
    pages.push(total)
    return pages
  }
  if (current >= total - 3) {
    pages.push('ellipsis')
    for (let p = total - 4; p <= total; p += 1) pages.push(p)
    return pages
  }
  pages.push('ellipsis')
  for (let p = current - 1; p <= current + 1; p += 1) pages.push(p)
  pages.push('ellipsis')
  pages.push(total)
  return pages
})

function goHistoryPage(page: number) {
  historyPage.value = Math.max(1, Math.min(page, historyTotalPages.value))
}

watch(historyPageSize, () => {
  historyPage.value = 1
  void refreshHistory()
})

watch(historyTotal, () => {
  if (historyPage.value > historyTotalPages.value) {
    historyPage.value = Math.max(1, historyTotalPages.value)
  }
})

watch(historyPage, () => {
  void refreshHistory()
})

const mainMedia = computed(() => {
  const p = photos.value[0]
  if (!p) return null
  return {
    url: p.file_url,
    title: p.title || 'Фото техники',
    description: p.description || '',
    date: p.created_at,
    photo: p,
  }
})

const galleryItems = computed(() => {
  return photos.value.slice(0, 8).map((p) => ({
    id: p.id,
    url: p.file_url,
    title: p.title || 'Фото',
    photo: p,
  }))
})

async function refreshAll() {
  loading.value = true
  error.value = null
  try {
    if (!isSupabaseConfigured()) {
      equipment.value = null
      photos.value = []
      history.value = []
      error.value = 'Supabase не настроен'
      return
    }
    const id = equipmentId.value
    if (!id) {
      error.value = 'Не указан id техники'
      return
    }

    const [eq, ph, docs, profileList, implementList, typeRefs, conditionRefs] = await Promise.all([
      getEquipmentById(id),
      loadEquipmentPhotos(id),
      loadEquipmentDocuments(id),
      loadProfiles(),
      loadEquipmentImplementsOptions(),
      loadEquipmentTypeRefs(),
      loadEquipmentConditionRefs(),
    ])
    equipment.value = eq
    photos.value = ph
    documents.value = docs
    profiles.value = profileList
    implementOptions.value = implementList
    equipmentTypeOptions.value = typeRefs.map((x) => ({ value: x.code, label: x.name }))
    equipmentConditionOptions.value = conditionRefs.map((x) => ({ value: x.code, label: x.name }))

    if (!eq) error.value = 'Техника не найдена'

    await refreshHistory()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки'
  } finally {
    loading.value = false
  }
}

async function refreshHistory() {
  const id = equipmentId.value
  if (!id) return
  historyLoading.value = true
  try {
    const onlyMine = !isManager.value
    const userId = auth.user.value?.id ?? null
    const page = await loadOperationsByEquipmentFromSupabase(id, onlyMine, userId, historyPage.value, historyPageSize.value)
    history.value = page.rows
    historyTotal.value = page.total
  } catch (e) {
    // История — то, ради чего открыли вкладку. Пустой список без объяснения
    // читается как «операций не было», а это неправда.
    error.value = formatSupabaseError(e) || 'Не удалось загрузить историю операций'
    history.value = []
    historyTotal.value = 0
  } finally {
    historyLoading.value = false
    initHistoryExpanded()
  }
}

function goBack() {
  router.push({ name: 'equipment' })
}

function triggerPhotoUpload() {
  fileInputRef.value?.click()
}

function triggerDocumentUpload() {
  documentInputRef.value?.click()
}

async function onPhotoFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!isSupabaseConfigured()) return
  const id = equipmentId.value
  if (!id) return

  photoUploading.value = true
  try {
    await addEquipmentPhoto(id, file)
    photos.value = await loadEquipmentPhotos(id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Не удалось загрузить фото'
  } finally {
    photoUploading.value = false
    input.value = ''
  }
}

function formatDocumentSize(size: number | null): string {
  if (size == null || Number.isNaN(size)) return '—'
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}

function getDocumentExt(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  return name.slice(dot + 1).toUpperCase()
}

function isImageDocument(doc: EquipmentDocumentRow): boolean {
  const mime = String(doc.mime_type || '').toLowerCase()
  if (mime.startsWith('image/')) return true
  const ext = getDocumentExt(doc.file_name).toLowerCase()
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext)
}

function openDocumentPreview(doc: EquipmentDocumentRow) {
  if (!isImageDocument(doc)) return
  documentPreview.value = { url: doc.file_url, name: doc.file_name }
  documentPreviewOpen.value = true
}

function closeDocumentPreview() {
  documentPreviewOpen.value = false
  documentPreview.value = null
}

async function onDocumentFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!isSupabaseConfigured()) return
  const id = equipmentId.value
  if (!id) return

  documentUploading.value = true
  try {
    await addEquipmentDocument(id, file)
    documents.value = await loadEquipmentDocuments(id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Не удалось загрузить документ'
  } finally {
    documentUploading.value = false
    input.value = ''
  }
}

async function onDeletePhoto(photo: EquipmentPhotoRow) {
  if (!confirm('Удалить фото?')) return
  try {
    await deleteEquipmentPhoto(photo.id)
    photos.value = photos.value.filter((p) => p.id !== photo.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось удалить фото'
  }
}

async function onDeleteDocument(document: EquipmentDocumentRow) {
  if (!confirm('Удалить документ?')) return
  try {
    await deleteEquipmentDocument(document.id)
    documents.value = documents.value.filter((d) => d.id !== document.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось удалить документ'
  }
}

onMounted(refreshAll)
</script>

<template>
  <div class="field-details page-enter-item">
    <div class="field-details-header">
      <button type="button" class="field-details-back" @click="goBack" aria-label="Назад к списку техники">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Назад к списку техники
      </button>
    </div>

    <div v-if="loading" class="field-details-grid">
      <div class="field-details-card field-details-card--left field-details-card--loading">
        <UiLoadingBar size="md" />
      </div>
    </div>

    <div v-else-if="error" class="field-details-card field-details-card--left" role="alert">
      <p class="field-details-error">{{ error }}</p>
      <button type="button" class="field-details-btn" @click="goBack">Вернуться к списку</button>
    </div>

    <template v-else-if="equipment">
      <div class="field-details-grid">
        <div class="field-details-card field-details-card--left">
          <div class="field-details-title-row">
            <span class="field-details-title-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 7h13l5 5v5a2 2 0 0 1-2 2H7a4 4 0 0 1-4-4V7z" />
                <path d="M16 7v5h5" />
                <circle cx="7" cy="18" r="2" />
              </svg>
            </span>

            <div class="field-details-title-block">
              <h1 class="field-details-name">{{ equipment.brand }} — {{ equipment.license_plate }}</h1>
              <p class="field-details-meta">
                {{ equipment.model ? (equipment.year ? `${equipment.model} • ${equipment.year} г.в.` : equipment.model) : equipment.year ? `${equipment.year} г.в.` : '—' }}
              </p>
            </div>
          </div>

          <ul class="field-details-list">
            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 20h4l12-12a4 4 0 0 0-6-6L2 14v4z" />
                  <path d="M13 5l6 6" />
                </svg>
              </span>
              <span class="field-details-item-label">Тип</span>
              <span class="field-details-item-value">{{ equipmentTypeLabel(equipment.equipment_type) }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 5h18" />
                  <path d="M3 12h18" />
                  <path d="M3 19h18" />
                </svg>
              </span>
              <span class="field-details-item-label">Заводской номер (VIN/PIN)</span>
              <span class="field-details-item-value">{{ equipment.factory_number || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M7 9h10" />
                  <path d="M7 13h6" />
                </svg>
              </span>
              <span class="field-details-item-label">ЭПСМ/ПСМ</span>
              <span class="field-details-item-value">{{ equipment.epsm_psm || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M8 10h8" />
                  <path d="M8 14h4" />
                </svg>
              </span>
              <span class="field-details-item-label">СВР</span>
              <span class="field-details-item-value">{{ equipment.svr_number || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
              </span>
              <span class="field-details-item-label">Свидетельство о регистрации</span>
              <span class="field-details-item-value">{{ equipment.registration_certificate || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                  <line x1="16" x2="16" y1="2" y2="6" />
                  <line x1="8" x2="8" y1="2" y2="6" />
                  <line x1="3" x2="21" y1="10" y2="10" />
                </svg>
              </span>
              <span class="field-details-item-label">Дата регистрации</span>
              <span class="field-details-item-value">{{ equipment.registration_date || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                  <line x1="16" x2="16" y1="2" y2="6" />
                  <line x1="8" x2="8" y1="2" y2="6" />
                  <line x1="3" x2="21" y1="10" y2="10" />
                </svg>
              </span>
              <span class="field-details-item-label">Дата снятия с учета</span>
              <span class="field-details-item-value">{{ equipment.deregistration_date || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 12l2-2 4 4 12-12 2 2L9 16l-4-4z" />
                </svg>
              </span>
              <span class="field-details-item-label">Назначение / культура</span>
              <span class="field-details-item-value">{{ equipment.purpose_crop || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="8" width="18" height="8" rx="2" />
                  <path d="M7 8V5" />
                  <path d="M17 8V5" />
                </svg>
              </span>
              <span class="field-details-item-label">Орудие</span>
              <span class="field-details-item-value">{{ implementLabel }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="3" x2="6" y2="21" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                  <line x1="18" y1="3" x2="18" y2="21" />
                  <circle cx="6" cy="14" r="2" />
                  <circle cx="12" cy="10" r="2" />
                  <circle cx="18" cy="6" r="2" />
                </svg>
              </span>
              <span class="field-details-item-label">Состояние</span>
              <span class="field-details-item-value">{{ conditionLabel(equipment.condition) }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <span class="field-details-item-label">Ответственный</span>
              <span class="field-details-item-value">{{ responsibleLabel }}</span>
            </li>
          </ul>

          <div class="equipment-documents-block">
            <div class="equipment-documents-header">
              <h2 class="equipment-documents-title">Документы техники</h2>
              <input
                ref="documentInputRef"
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.rtf,.jpg,.jpeg,.png,.webp,.heic,.heif,.zip,.rar,.7z"
                class="field-details-file-hidden"
                aria-hidden="true"
                @change="onDocumentFileChange"
              />
              <button type="button" class="field-details-upload-btn" :disabled="documentUploading" @click="triggerDocumentUpload">
                {{ documentUploading ? 'Загрузка…' : '+ Добавить документ' }}
              </button>
            </div>
            <div v-if="documents.length" class="equipment-documents-list">
              <div v-for="doc in documents" :key="doc.id" class="equipment-documents-item">
                <button
                  v-if="isImageDocument(doc)"
                  type="button"
                  class="equipment-documents-thumb-btn"
                  :title="`Предпросмотр: ${doc.file_name}`"
                  @click="openDocumentPreview(doc)"
                >
                  <img :src="doc.file_url" :alt="doc.file_name" class="equipment-documents-thumb" loading="lazy" />
                </button>
                <div v-else class="equipment-documents-icon" aria-hidden="true">{{ getDocumentExt(doc.file_name) || 'FILE' }}</div>
                <div class="equipment-documents-main">
                  <a :href="doc.file_url" target="_blank" rel="noopener noreferrer" class="equipment-documents-link">
                    {{ doc.file_name }}
                  </a>
                  <span class="equipment-documents-meta">
                    {{ formatDocumentSize(doc.file_size) }} ·
                    {{ doc.created_at ? new Date(doc.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—' }}
                  </span>
                </div>
                <div class="equipment-documents-actions">
                  <a :href="doc.file_url" target="_blank" rel="noopener noreferrer" class="equipment-documents-open-link">Открыть</a>
                  <UiDeleteButton size="xs" @click.prevent="onDeleteDocument(doc)" />
                </div>
              </div>
            </div>
            <p v-else class="field-details-muted">Документы пока не добавлены.</p>
          </div>

          <div v-if="equipment.notes" class="field-details-notes">
            <div class="field-details-notes-block">
              <div class="field-details-notes-label">Примечания</div>
              <p class="field-details-notes-text">{{ equipment.notes }}</p>
            </div>
          </div>
        </div>

        <div class="field-details-card field-details-card--right">
          <div class="field-details-media-header">
            <div>
              <h2 class="field-details-media-title">Фото</h2>
              <p class="field-details-media-subtitle">Фотографии техники</p>
            </div>

            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              class="field-details-file-hidden"
              aria-hidden="true"
              @change="onPhotoFileChange"
            />
            <button type="button" class="field-details-upload-btn" :disabled="photoUploading" @click="triggerPhotoUpload">
              {{ photoUploading ? 'Загрузка…' : '+ Добавить фото' }}
            </button>
          </div>

          <div class="field-details-main-media">
            <template v-if="mainMedia">
              <div class="field-details-main-media-label">{{ mainMedia.title }}</div>
              <div class="field-details-main-media-frame">
                <img
                  :src="mainMedia.url"
                  :alt="mainMedia.title"
                  class="field-details-main-media-img"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
              </div>
              <p class="field-details-main-media-desc">{{ mainMedia.description || '—' }}</p>
              <p class="field-details-main-media-date">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                  <line x1="16" x2="16" y1="2" y2="6" />
                  <line x1="8" x2="8" y1="2" y2="6" />
                  <line x1="3" x2="21" y1="10" y2="10" />
                </svg>
                {{ mainMedia.date ? new Date(mainMedia.date).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—' }}
              </p>
            </template>
            <template v-else>
              <div class="field-details-main-media-label">Пока нет фото</div>
              <div class="field-details-main-media-placeholder">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <path d="M12 17h.01" />
                </svg>
                <span>Загрузите фото техники</span>
              </div>
            </template>
          </div>

          <div v-if="galleryItems.length > 0" class="field-details-gallery">
            <div v-for="item in galleryItems" :key="item.id" class="field-details-gallery-item">
              <div class="field-details-gallery-thumb">
                <img
                  :src="item.url"
                  :alt="item.title"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
                />
                <span class="field-details-gallery-title">{{ item.title }}</span>
                <div class="field-details-gallery-delete-wrap">
                  <UiDeleteButton size="xs" @click.prevent="onDeletePhoto(item.photo)" />
                </div>
              </div>
            </div>
          </div>
          <div v-else class="field-details-muted" style="padding-top: 12px;">Пока нет фото.</div>
        </div>
      </div>

      <section class="field-details-card equipment-history-section">
        <div class="field-details-media-header">
          <div>
            <h2 class="field-details-media-title">История взаимодействия</h2>
            <p class="field-details-media-subtitle field-details-media-subtitle--history">
              <template v-if="historyLoading">
                <UiLoadingBar size="compact" />
              </template>
              <template v-else>Записей: {{ history.length }}</template>
            </p>
          </div>
        </div>

        <div v-if="historyLoading" class="equipment-history-loading-wrap">
          <UiLoadingBar size="md" />
        </div>
        <div v-else-if="!history.length" class="field-details-muted">
          Нет записей в журнале операций с этой техникой.
        </div>
        <template v-else>
          <ul class="equipment-history-list">
            <li v-for="{ h, visual } in paginatedHistoryVm" :key="h.id" class="equipment-history-card">
              <button
                type="button"
                class="equipment-history-card-toggle"
                :aria-expanded="isHistoryExpanded(h.id)"
                @click="toggleHistoryExpand(h.id)"
              >
                <div class="equipment-history-toggle-left">
                  <span
                    class="equipment-history-op-icon"
                    :style="{ background: visual.boxBg, color: visual.iconColor }"
                    aria-hidden="true"
                  >
                    <!-- Агрохим / анализ -->
                    <template v-if="visual.kind === 'analysis'">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                      </svg>
                    </template>
                    <!-- Обработка полей -->
                    <template v-else-if="visual.kind === 'field'">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.5 2 8.8-1.73 2.61-3 4.5-8 6.2Z" />
                        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
                      </svg>
                    </template>
                    <!-- Контроль полевых работ -->
                    <template v-else-if="visual.kind === 'control'">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                        <path d="M9 14l2 2 4-4" />
                      </svg>
                    </template>
                    <template v-else>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2l-1 1 7 7 1-1-7-7z" />
                        <path d="M3 21l3-1 14-14-2-2L4 18l-1 3z" />
                        <path d="M13 6l5 5" />
                      </svg>
                    </template>
                  </span>
                  <div class="equipment-history-op-text">
                    <div class="equipment-history-op-title">{{ h.operation || 'Операция' }}</div>
                    <div class="equipment-history-op-meta">
                      {{ formatDateTime(h.startISO) }} • Длительность: {{ h.durationMinutes }} мин
                    </div>
                  </div>
                </div>

                <div class="equipment-history-toggle-right">
                  <div class="equipment-history-toggle-employee">
                    <UserAvatar class="equipment-history-avatar" :style="employeeAvatarStyle(h.employee)" :url="employeeAvatarUrl(h.employee)" :initials="employeeInitials(h.employee)" />
                    <span class="equipment-history-toggle-employee-name">{{ h.employee }}</span>
                  </div>
                  <span class="equipment-history-condition-pill" :class="conditionToneClass(h)">
                    {{ h.equipmentConditionLabel || (h.equipmentConditionValue != null ? `${h.equipmentConditionValue}%` : '—') }}
                  </span>
                  <span class="equipment-history-chevron" :class="{ 'equipment-history-chevron--open': isHistoryExpanded(h.id) }" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </div>
              </button>

              <div v-show="isHistoryExpanded(h.id)" class="equipment-history-card-body">
                <div class="equipment-history-body-grid">
                  <div class="equipment-history-body-col">
                    <div class="equipment-history-body-col-head">
                      <span class="equipment-history-body-col-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M5 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                          <path d="M7 8h4" />
                          <path d="M7 12h5" />
                          <path d="M15 7V5a1 1 0 0 1 1-1" />
                          <path d="M15 7h2a2 2 0 0 1 2 2v7a2 2 0 0 0 2 2" />
                          <path d="M19 18v2" />
                        </svg>
                      </span>
                      <span class="equipment-history-body-col-label">Топливо</span>
                    </div>

                    <div class="equipment-history-fuel-rows">
                      <div class="equipment-history-fuel-row">
                        <span class="equipment-history-fuel-row-label">Старт</span>
                        <div class="equipment-history-fuel-row-track">
                          <div
                            class="equipment-history-fuel-fill"
                            :class="fuelBarClass(fuelStartValue(h))"
                            :style="{ width: fuelStartValue(h) != null ? `${Math.min(100, Math.max(0, fuelStartValue(h) as number))}%` : '0%' }"
                          />
                        </div>
                        <span class="equipment-history-fuel-row-pct">{{ fuelStartValue(h) != null ? `${fuelStartValue(h)}%` : '—' }}</span>
                      </div>

                      <div v-if="fuelFinalValue(h) != null" class="equipment-history-fuel-row equipment-history-fuel-row--final">
                        <span class="equipment-history-fuel-row-label">Остаток</span>
                        <div class="equipment-history-fuel-row-track">
                          <div
                            class="equipment-history-fuel-fill"
                            :class="fuelBarClass(fuelFinalValue(h))"
                            :style="{ width: fuelFinalValue(h) != null ? `${Math.min(100, Math.max(0, fuelFinalValue(h) as number))}%` : '0%' }"
                          />
                        </div>
                        <span class="equipment-history-fuel-row-pct">{{ fuelFinalValue(h) != null ? `${fuelFinalValue(h)}%` : '—' }}</span>
                      </div>
                    </div>
                  </div>

                  <div class="equipment-history-body-col">
                    <div class="equipment-history-body-col-head">
                      <span class="equipment-history-body-col-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 18l-4 1 1-4Z" />
                        </svg>
                      </span>
                      <span class="equipment-history-body-col-label">Список дел / заметки</span>
                    </div>
                    <div class="equipment-history-body-box">
                      {{ h.notes || '—' }}
                    </div>
                  </div>

                  <div class="equipment-history-body-col">
                    <div class="equipment-history-body-col-head">
                      <span class="equipment-history-body-col-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                        </svg>
                      </span>
                      <span class="equipment-history-body-col-label">Починка / проблемы</span>
                    </div>
                    <div class="equipment-history-body-box">
                      {{ h.equipmentRepairNotes || '—' }}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          </ul>

          <div v-if="historyTotalFiltered > 0" class="equipment-task-pagination">
            <span class="equipment-task-pagination-info">
              Показано {{ historyPaginationStart }}–{{ historyPaginationEnd }} из {{ historyTotalFiltered }}
            </span>
            <div class="equipment-task-pagination-right">
              <div class="equipment-task-pagination-nav">
                <button
                  type="button"
                  class="equipment-task-pagination-arrow"
                  :disabled="historyPage <= 1"
                  aria-label="Предыдущая страница"
                  @click="historyPage = historyPage - 1"
                >
                  &lt;
                </button>
                <template v-for="(p, i) in historyPageNumbers" :key="p === 'ellipsis' ? `e-${i}` : p">
                  <button
                    v-if="p !== 'ellipsis'"
                    type="button"
                    class="equipment-task-pagination-num"
                    :class="{ 'equipment-task-pagination-num--active': p === historyPage }"
                    @click="goHistoryPage(p)"
                  >
                    {{ p }}
                  </button>
                  <span v-else class="equipment-task-pagination-ellipsis">…</span>
                </template>
                <button
                  type="button"
                  class="equipment-task-pagination-arrow"
                  :disabled="historyPage >= historyTotalPages"
                  aria-label="Следующая страница"
                  @click="historyPage = historyPage + 1"
                >
                  &gt;
                </button>
              </div>
              <label class="equipment-task-pagination-size">
                <span class="equipment-task-pagination-size-label">На странице</span>
                <UiSelect v-model="historyPageSize" :options="[{ value: 5, label: '5' }, { value: 10, label: '10' }, { value: 20, label: '20' }, { value: 50, label: '50' }]" class="equipment-task-pagination-select" />
              </label>
            </div>
          </div>
        </template>
      </section>
    </template>

    <ImagePreviewDialog
      v-if="documentPreviewOpen && documentPreview"
      :name="documentPreview.name"
      :url="documentPreview.url"
      @close="closeDocumentPreview"
    />
  </div>
</template>

<style scoped src="./EquipmentDetailsPage.css"></style>

