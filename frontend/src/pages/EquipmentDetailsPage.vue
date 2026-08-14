<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
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
  } catch {
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
                <select v-model.number="historyPageSize" class="equipment-task-pagination-select">
                  <option :value="5">5</option>
                  <option :value="10">10</option>
                  <option :value="20">20</option>
                  <option :value="50">50</option>
                </select>
              </label>
            </div>
          </div>
        </template>
      </section>
    </template>

    <teleport to="body">
      <div v-if="documentPreviewOpen && documentPreview" class="doc-preview-backdrop" role="dialog" aria-modal="true" aria-label="Предпросмотр документа" @click.self="closeDocumentPreview">
        <div class="doc-preview-modal">
          <div class="doc-preview-head">
            <div class="doc-preview-title">{{ documentPreview.name }}</div>
            <button type="button" class="doc-preview-close" aria-label="Закрыть предпросмотр" @click="closeDocumentPreview">×</button>
          </div>
          <div class="doc-preview-body">
            <img :src="documentPreview.url" :alt="documentPreview.name" class="doc-preview-image" />
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
/* Дизайн как на `FieldDetailsPage.vue` (классы field-details-*) */
.field-details {
  padding-bottom: 24px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
.field-details-header {
  margin-bottom: 20px;
}
.field-details-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 0.95rem;
  cursor: pointer;
  transition: color 0.2s;
}
.field-details-back:hover {
  color: var(--text-primary);
}
.field-details-grid {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 24px;
  align-items: start;
}
/* До десктопа: одна колонка (инфо + фото друг под другом) */
@media (max-width: 1024px) {
  .field-details-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}
.field-details-card {
  background: var(--bg-panel);
  border-radius: 12px;
  border: 1px solid var(--topbar-border);
  box-shadow: var(--shadow-card);
  padding: 24px;
}
.field-details-card--left {
  min-width: 0;
}
.field-details-card--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
}
.field-details-card--right {
  min-width: 0;
}
.field-details-media-subtitle--history {
  min-height: 36px;
  display: flex;
  align-items: center;
}
.equipment-history-loading-wrap {
  display: flex;
  justify-content: center;
  padding: 12px 0 8px;
}
.field-details-title-row {
  display: flex;
  gap: 14px;
  margin-bottom: 24px;
  align-items: flex-start;
}
.field-details-title-block {
  flex: 1;
  min-width: 0;
}
.field-details-title-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
  color: #2e7d32;
  display: flex;
  align-items: center;
  justify-content: center;
}
[data-theme='dark'] .field-details-title-icon {
  background: linear-gradient(135deg, #1b3d1f 0%, #2e5c32 100%);
  color: #81c784;
}
.field-details-name {
  margin: 0 0 4px;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}
.field-details-meta {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}
.field-details-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field-details-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: start;
  font-size: 0.9rem;
}
.field-details-item-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
  margin-top: 2px;
}
.field-details-item-label {
  color: var(--text-secondary);
  font-weight: 500;
}
.field-details-item-value {
  color: var(--text-primary);
  text-align: right;
  word-break: break-word;
}
.field-details-muted {
  color: var(--text-secondary);
  margin: 0;
}
.field-details-notes {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed var(--topbar-border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.equipment-documents-block {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed var(--topbar-border);
}
.equipment-documents-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.equipment-documents-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
}
.equipment-documents-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.equipment-documents-item {
  border: 1px solid var(--topbar-border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--bg-base);
  display: flex;
  align-items: center;
  gap: 12px;
}
.equipment-documents-thumb-btn {
  width: 56px;
  height: 56px;
  border: 1px solid var(--topbar-border);
  border-radius: 8px;
  padding: 0;
  overflow: hidden;
  background: var(--bg-panel);
  cursor: zoom-in;
  flex-shrink: 0;
}
.equipment-documents-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.equipment-documents-icon {
  width: 56px;
  height: 56px;
  border-radius: 8px;
  border: 1px solid var(--topbar-border);
  background: linear-gradient(135deg, rgba(61, 92, 64, 0.12), rgba(61, 92, 64, 0.2));
  color: var(--text-primary);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.equipment-documents-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
}
.equipment-documents-link {
  color: var(--text-primary);
  font-weight: 600;
  text-decoration: none;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.equipment-documents-link:hover {
  text-decoration: underline;
}
.equipment-documents-meta {
  color: var(--text-secondary);
  font-size: 0.78rem;
  white-space: nowrap;
}
.equipment-documents-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}
.equipment-documents-open-link {
  font-size: 0.78rem;
  color: var(--text-secondary);
  text-decoration: none;
  border: 1px solid var(--topbar-border);
  border-radius: 8px;
  padding: 4px 8px;
}
.equipment-documents-open-link:hover {
  color: var(--text-primary);
  border-color: var(--text-secondary);
}
.doc-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: rgba(15, 23, 42, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.doc-preview-modal {
  width: min(1100px, 96vw);
  max-height: 92vh;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
}
.doc-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
}
.doc-preview-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-preview-close {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-base);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 1.3rem;
  line-height: 1;
}
.doc-preview-body {
  padding: 12px;
  max-height: calc(92vh - 58px);
  overflow: auto;
}
.doc-preview-image {
  display: block;
  margin: 0 auto;
  max-width: 100%;
  max-height: calc(92vh - 92px);
  border-radius: 10px;
  border: 1px solid var(--topbar-border);
}
.field-details-notes-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.field-details-notes-text {
  margin: 4px 0 0;
  font-size: 0.9rem;
  color: var(--text-primary);
  white-space: pre-wrap;
}
.field-details-error {
  color: var(--danger);
  margin: 0 0 16px;
}
.field-details-btn {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  background: var(--primary);
  color: white;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.field-details-media-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.field-details-media-title {
  margin: 0 0 4px;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
}
.field-details-media-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.field-details-file-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.field-details-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid var(--topbar-border);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, transform 0.2s ease, box-shadow 0.2s ease;
}
.field-details-upload-btn:hover:not(:disabled) {
  background: var(--bg-panel);
  border-color: var(--text-secondary);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(45, 90, 61, 0.14);
}
.field-details-upload-btn svg {
  transition: transform 0.22s ease;
}
.field-details-upload-btn:hover:not(:disabled) svg {
  animation: equipment-upload-hover 0.65s ease;
}
@keyframes equipment-upload-hover {
  0% { transform: translateY(0); }
  40% { transform: translateY(-2px); }
  100% { transform: translateY(0); }
}
.field-details-upload-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.field-details-main-media {
  margin-bottom: 24px;
}
.field-details-main-media-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.field-details-main-media-frame {
  width: 100%;
  aspect-ratio: 16/10;
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-base);
  border: 1px solid var(--topbar-border);
  display: flex;
  align-items: center;
  justify-content: center;
}
.field-details-main-media-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.field-details-main-media-placeholder {
  width: 100%;
  aspect-ratio: 16/10;
  border-radius: 10px;
  border: 1px dashed var(--topbar-border);
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}
.field-details-main-media-placeholder svg {
  opacity: 0.5;
}
.field-details-main-media-desc {
  margin: 8px 0 4px;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.field-details-main-media-date {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.field-details-gallery {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1100px) {
  .field-details-gallery {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 720px) {
  .field-details-gallery {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 380px) {
  .field-details-gallery {
    grid-template-columns: 1fr;
  }
}
.field-details-gallery-item {
  min-width: 0;
}
.field-details-gallery-thumb {
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-base);
  border: 1px solid var(--topbar-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}
.field-details-gallery-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: absolute;
  inset: 0;
}
.field-details-gallery-title {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 6px 8px;
  font-size: 0.75rem;
  font-weight: 500;
  color: #fff;
  background: linear-gradient(to top, rgba(0,0,0,0.6), transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.field-details-gallery-delete-wrap {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
}

.equipment-history-section {
  margin-top: 24px;
}

.equipment-details-header {
  margin-bottom: var(--space-xl);
  align-items: flex-start;
}

.equipment-details-subtitle {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
}

.equipment-details-loading,
.equipment-details-error {
  padding: var(--space-xl);
}

.equipment-details-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-xl);
  align-items: start;
  margin-bottom: var(--space-xl);
}

.equipment-details-panel {
  padding: var(--space-lg);
}

.panel-title {
  margin: 0 0 var(--space-md);
  font-size: 1rem;
  font-weight: 800;
}

.panel-head-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-md);
}

.equipment-details-kv {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.kv-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
}

.kv-label {
  color: var(--text-secondary);
  font-weight: 650;
}

.kv-value {
  font-weight: 700;
  text-align: right;
}

.kv-value--muted {
  color: var(--text-secondary);
  font-weight: 600;
  max-width: 420px;
  text-align: left;
}

.equipment-details-photo-add {
  margin-left: auto;
}

.equipment-details-photos-empty {
  color: var(--text-secondary);
  font-weight: 600;
  padding: var(--space-lg);
  border: 1px dashed var(--border-color);
  border-radius: 12px;
  background: var(--bg-panel);
}

.equipment-details-photos-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-sm);
}

.equipment-photo-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-panel);
}

.equipment-photo-img {
  width: 100%;
  height: 140px;
  object-fit: cover;
  display: block;
}

.equipment-photo-actions {
  padding: var(--space-xs);
  display: flex;
  justify-content: flex-end;
}

.equipment-photo-delete {
  border: none;
  background: transparent;
  color: var(--danger-red);
  cursor: pointer;
  font-weight: 700;
  font-size: 0.8rem;
  text-decoration: underline;
}

.equipment-details-history {
  padding: var(--space-md);
}

.equipment-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.equipment-history-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-panel);
  overflow: hidden;
  min-width: 0;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.equipment-history-card:hover {
  border-color: rgba(15, 23, 42, 0.12);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.05);
}

.equipment-history-card-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}

.equipment-history-card-toggle:hover {
  background: var(--bg-base);
}

.equipment-history-op-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.equipment-history-op-text {
  flex: 1;
  min-width: 0;
}

.equipment-history-toggle-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.equipment-history-toggle-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.equipment-history-toggle-employee {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.equipment-history-toggle-employee-name {
  font-weight: 900;
  font-size: 0.85rem;
  color: var(--text-primary);
  word-break: break-word;
}

.equipment-history-condition-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-weight: 900;
  font-size: 0.8rem;
  border: 1px solid transparent;
}

.equipment-history-op-title {
  font-weight: 800;
  font-size: 0.95rem;
  color: var(--text-primary);
  line-height: 1.25;
}

.equipment-history-op-meta {
  margin-top: 2px;
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.equipment-history-chevron {
  flex-shrink: 0;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
  transition: transform 0.2s ease;
}

.equipment-history-chevron--open {
  transform: rotate(180deg);
}

.equipment-history-card-body {
  padding: 0 12px 12px;
}

.equipment-history-cols {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.95fr) minmax(0, 1fr);
  gap: 10px 14px;
  align-items: start;
}

.equipment-history-col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.equipment-history-col-icon {
  display: inline-flex;
  color: var(--text-secondary);
  opacity: 0.9;
}

.equipment-history-col-icon svg {
  width: 13px;
  height: 13px;
}

.equipment-history-col-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.equipment-history-fuel {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.equipment-history-fuel-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.equipment-history-fuel-block-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.equipment-history-fuel-block--final {
  padding-top: 6px;
  border-top: 1px dashed var(--topbar-border);
}

.equipment-history-fuel-row--final {
  margin-top: 2px;
}

.equipment-history-fuel-pct {
  font-weight: 800;
  font-size: 0.9rem;
  color: var(--text-primary);
}

.equipment-history-fuel-track {
  height: 6px;
  border-radius: 999px;
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  overflow: hidden;
}

.equipment-history-fuel-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.25s ease;
  min-width: 0;
}

.equipment-history-fuel-fill--low {
  background: #dc2626;
}
.equipment-history-fuel-fill--mid {
  background: #ca8a04;
}
.equipment-history-fuel-fill--high {
  background: #16a34a;
}
.equipment-history-fuel-fill--empty {
  width: 0 !important;
  background: transparent;
}

.equipment-history-avatar {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-weight: 900;
  font-size: 0.62rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.equipment-history-employee-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.equipment-history-employee-name {
  font-weight: 800;
  color: var(--text-primary);
  word-break: break-word;
  line-height: 1.2;
}

.equipment-history-pill {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.16);
  font-weight: 850;
  font-size: 0.78rem;
  color: var(--text-primary);
  border: 1px solid rgba(148, 163, 184, 0.22);
  min-width: 0;
}

.equipment-history-tone--good {
  background: rgba(34, 197, 94, 0.11);
  border-color: rgba(34, 197, 94, 0.18);
  color: #16a34a;
}

.equipment-history-tone--warn {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.22);
  color: #b45309;
}

.equipment-history-tone--bad {
  background: rgba(220, 38, 38, 0.10);
  border-color: rgba(220, 38, 38, 0.20);
  color: #b91c1c;
}

.equipment-history-body-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
  min-width: 0;
}

.equipment-history-body-col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.equipment-history-body-col-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  opacity: 0.95;
}

.equipment-history-body-col-icon svg {
  width: 14px;
  height: 14px;
}

.equipment-history-body-col-label {
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.equipment-history-body-box {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-panel);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.35;
  white-space: pre-wrap;
  max-height: 92px;
  overflow: auto;
  word-break: break-word;
}

.equipment-history-fuel-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.equipment-history-fuel-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
}

.equipment-history-fuel-row-label {
  font-size: 0.75rem;
  font-weight: 800;
  color: var(--text-secondary);
}

.equipment-history-fuel-row-track {
  height: 6px;
  border-radius: 999px;
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  overflow: hidden;
}

.equipment-history-fuel-row-track .equipment-history-fuel-fill {
  height: 100%;
}

.equipment-history-fuel-row-pct {
  font-size: 0.85rem;
  font-weight: 900;
  color: var(--text-primary);
}

.equipment-history-repair-block {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--topbar-border);
}

.equipment-history-repair-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.equipment-history-repair-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.equipment-history-repair-text {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.45;
  white-space: pre-wrap;
}

.equipment-history-notes-block {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--topbar-border);
}

.equipment-history-notes-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.equipment-history-notes-label {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.equipment-history-notes-text {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: pre-wrap;
  line-height: 1.45;
}

/* Пагинация — стиль как у «Задач» (TaskManagementPage) */
.equipment-task-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-md);
  padding: var(--space-md) 0 0;
  border-top: 1px solid var(--border-color);
  min-height: 40px;
}

.equipment-task-pagination-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.equipment-task-pagination-right {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  flex-wrap: wrap;
}

.equipment-task-pagination-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.equipment-task-pagination-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.equipment-task-pagination-arrow:hover:not(:disabled) {
  background: var(--bg-panel-hover, var(--bg-panel));
  border-color: var(--text-secondary);
}

.equipment-task-pagination-arrow:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.equipment-task-pagination-num {
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

.equipment-task-pagination-num:hover {
  background: var(--bg-panel-hover, var(--bg-panel));
}

.equipment-task-pagination-num--active {
  background: rgba(76, 175, 80, 0.15);
  border-color: rgba(76, 175, 80, 0.5);
  color: var(--text-primary);
}

[data-theme='dark'] .equipment-task-pagination-num--active {
  background: rgba(76, 175, 80, 0.2);
  border-color: rgba(76, 175, 80, 0.5);
}

.equipment-task-pagination-num--active:hover {
  background: rgba(76, 175, 80, 0.22);
}

.equipment-task-pagination-ellipsis {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 36px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.equipment-task-pagination-size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.equipment-task-pagination-size-label {
  line-height: 1.5;
}

.equipment-task-pagination-select {
  min-width: 72px;
  height: 36px;
  padding: 0 28px 0 10px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  border: 1px solid var(--border-color);
  background: var(--bg-base);
  color: var(--text-primary);
  cursor: pointer;
}

@media (max-width: 1020px) {
  .equipment-details-grid {
    grid-template-columns: 1fr;
  }
  .equipment-details-photos-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .equipment-history-cols {
    grid-template-columns: 1fr;
  }
  .equipment-history-body-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }
  .equipment-history-body-box {
    max-height: 76px;
  }
}

/* Планшеты и мобильные: страница техники */
@media (max-width: 768px) {
  .field-details-header {
    margin-bottom: 14px;
  }
  .field-details-back {
    font-size: 0.88rem;
    white-space: normal;
    text-align: left;
    max-width: 100%;
  }
  .field-details-card {
    padding: 16px;
    border-radius: 10px;
  }
  .field-details-title-row {
    gap: 10px;
    margin-bottom: 18px;
  }
  .field-details-title-icon {
    width: 44px;
    height: 44px;
    border-radius: 10px;
  }
  .field-details-name {
    font-size: 1.2rem;
  }
  .field-details-list {
    gap: 12px;
  }
  .field-details-media-header {
    margin-bottom: 14px;
    gap: 12px;
  }
  .field-details-upload-btn {
    width: 100%;
    justify-content: center;
  }
  .equipment-history-section {
    margin-top: 16px;
  }
  .equipment-history-card-toggle {
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 10px;
  }
  .equipment-history-toggle-left {
    flex: 1 1 100%;
    min-width: 0;
  }
  .equipment-history-toggle-right {
    flex: 1 1 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 8px 10px;
    padding-top: 8px;
    border-top: 1px solid var(--topbar-border);
  }
  .equipment-history-toggle-employee-name {
    max-width: 100%;
  }
  .equipment-history-body-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .equipment-history-card-body {
    padding: 0 10px 10px;
  }
}

@media (max-width: 520px) {
  .field-details-item {
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    gap: 6px 10px;
    align-items: start;
  }
  .field-details-item-icon {
    grid-row: 1 / span 2;
    align-self: start;
    margin-top: 0;
  }
  .field-details-item-label {
    grid-column: 2;
    grid-row: 1;
  }
  .field-details-item-value {
    grid-column: 2;
    grid-row: 2;
    text-align: left;
  }
  .field-details-name {
    font-size: 1.05rem;
  }
  .equipment-documents-header {
    flex-direction: column;
    align-items: stretch;
  }
  .equipment-documents-item {
    align-items: flex-start;
  }
  .equipment-documents-meta {
    white-space: normal;
  }
  .equipment-documents-actions {
    margin-left: auto;
    flex-direction: column;
    align-items: flex-end;
  }
  .equipment-history-op-title {
    font-size: 0.88rem;
  }
  .equipment-history-op-meta {
    font-size: 0.72rem;
    line-height: 1.35;
  }
  .equipment-history-condition-pill {
    font-size: 0.72rem;
    padding: 5px 8px;
    max-width: 100%;
    white-space: normal;
    text-align: center;
    line-height: 1.25;
  }
  .equipment-history-fuel-row {
    grid-template-columns: auto 1fr minmax(2.5rem, auto);
    gap: 8px;
  }
  .equipment-task-pagination-info {
    font-size: 0.8rem;
    width: 100%;
    text-align: center;
  }
}

@media (max-width: 640px) {
  .equipment-task-pagination {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .equipment-task-pagination-right {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 12px;
  }
  .equipment-task-pagination-nav {
    justify-content: center;
    flex-wrap: wrap;
  }
  .equipment-task-pagination-size {
    justify-content: space-between;
    width: 100%;
  }
}
</style>

