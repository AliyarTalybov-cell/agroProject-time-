<script setup lang="ts">
import { askConfirm } from '@/composables/useConfirm'
import { Card } from '@/components/ui/shadcn/card'
import { Button } from '@/components/ui/shadcn/button'
import { CalendarIcon, CircleCheckIcon, CircleQuestionMarkIcon, PlusIcon, ClipboardListIcon, FileIcon, GaugeIcon, IdCardIcon, PencilIcon, SlidersVerticalIcon, TextAlignJustifyIcon, TrashIcon, TruckIcon, UserIcon } from '@lucide/vue'
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
import OperationHistoryCard from '@/components/history/OperationHistoryCard.vue'
import { photoTitle } from '@/lib/photoTitle'
import { loadProfiles, type ProfileRow } from '@/lib/tasksSupabase'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'

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


const mainMedia = computed(() => {
  const p = photos.value[0]
  if (!p) return null
  return {
    url: p.file_url,
    title: photoTitle(p.title, 'Фото техники'),
    description: p.description || '',
    date: p.created_at,
    photo: p,
  }
})

const galleryItems = computed(() => {
  return photos.value.slice(0, 8).map((p) => ({
    id: p.id,
    url: p.file_url,
    title: photoTitle(p.title, 'Фото'),
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

  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки'
  } finally {
    loading.value = false
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
  if (!(await askConfirm('Удалить фото?'))) return
  try {
    await deleteEquipmentPhoto(photo.id)
    photos.value = photos.value.filter((p) => p.id !== photo.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось удалить фото'
  }
}

async function onDeleteDocument(document: EquipmentDocumentRow) {
  if (!(await askConfirm('Удалить документ?'))) return
  try {
    await deleteEquipmentDocument(document.id)
    documents.value = documents.value.filter((d) => d.id !== document.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось удалить документ'
  }
}

onMounted(refreshAll)

/** Дата из базы «ГГГГ-ММ-ДД» — по-русски «ДД.ММ.ГГГГ». */
function formatIsoDate(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value || '—'
}

/** Длительность: «45 мин», «2 ч 5 мин», «3 дн 4 ч». */
function formatDuration(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} дн ${h % 24} ч` : `${d} дн`
}
</script>

<template>
  <div class="field-details page-enter-item">

    <div v-if="loading" class="field-details-grid">
      <Card class="field-details-card field-details-card--left field-details-card--loading gap-0">
        <UiLoadingBar size="md" />
      </Card>
    </div>

    <Card v-else-if="error" class="field-details-card field-details-card--left gap-0" role="alert">
      <p class="field-details-error">{{ error }}</p>
      <Button variant="outline" type="button" class="field-details-btn" @click="goBack">Вернуться к списку</Button>
    </Card>

    <template v-else-if="equipment">
      <div class="field-details-grid">
        <Card class="field-details-card field-details-card--left gap-0">
          <div class="field-details-title-row">
            <span class="field-details-title-icon" aria-hidden="true">
              <TruckIcon :size="22" />
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
                <PencilIcon :size="18" />
              </span>
              <span class="field-details-item-label">Тип</span>
              <span class="field-details-item-value">{{ equipmentTypeLabel(equipment.equipment_type) }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <TextAlignJustifyIcon :size="18" />
              </span>
              <span class="field-details-item-label">Заводской номер (VIN/PIN)</span>
              <span class="field-details-item-value">{{ equipment.factory_number || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <IdCardIcon :size="18" />
              </span>
              <span class="field-details-item-label">ЭПСМ/ПСМ</span>
              <span class="field-details-item-value">{{ equipment.epsm_psm || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <IdCardIcon :size="18" />
              </span>
              <span class="field-details-item-label">СВР</span>
              <span class="field-details-item-value">{{ equipment.svr_number || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <FileIcon :size="18" />
              </span>
              <span class="field-details-item-label">Свидетельство о регистрации</span>
              <span class="field-details-item-value">{{ equipment.registration_certificate || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <CalendarIcon :size="18" />
              </span>
              <span class="field-details-item-label">Дата регистрации</span>
              <span class="field-details-item-value">{{ formatIsoDate(equipment.registration_date) }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <CalendarIcon :size="18" />
              </span>
              <span class="field-details-item-label">Дата снятия с учета</span>
              <span class="field-details-item-value">{{ formatIsoDate(equipment.deregistration_date) }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <CircleCheckIcon :size="18" />
              </span>
              <span class="field-details-item-label">Назначение / культура</span>
              <span class="field-details-item-value">{{ equipment.purpose_crop || '—' }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <GaugeIcon :size="18" />
              </span>
              <span class="field-details-item-label">Орудие</span>
              <span class="field-details-item-value">{{ implementLabel }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <SlidersVerticalIcon :size="18" />
              </span>
              <span class="field-details-item-label">Состояние</span>
              <span class="field-details-item-value">{{ conditionLabel(equipment.condition) }}</span>
            </li>

            <li class="field-details-item">
              <span class="field-details-item-icon" aria-hidden="true">
                <UserIcon :size="18" />
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
              <Button variant="outline" size="sm" type="button" class="field-details-upload-btn" :disabled="documentUploading" @click="triggerDocumentUpload">
                <PlusIcon v-if="!documentUploading" />
                {{ documentUploading ? 'Загрузка…' : 'Добавить документ' }}
              </Button>
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
        </Card>

        <Card class="field-details-card field-details-card--right gap-0">
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
            <Button variant="outline" size="sm" type="button" class="field-details-upload-btn" :disabled="photoUploading" @click="triggerPhotoUpload">
              <PlusIcon v-if="!photoUploading" />
              {{ photoUploading ? 'Загрузка…' : 'Добавить фото' }}
            </Button>
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
              <p v-if="mainMedia.description" class="field-details-main-media-desc">{{ mainMedia.description }}</p>
              <p class="field-details-main-media-date">
                <CalendarIcon :size="14" />
                {{ mainMedia.date ? new Date(mainMedia.date).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—' }}
              </p>
            </template>
            <template v-else>
              <div class="field-details-main-media-label">Пока нет фото</div>
              <div class="field-details-main-media-placeholder">
                <CircleQuestionMarkIcon :size="48" :stroke-width="1.5" />
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
        </Card>
      </div>

      <OperationHistoryCard
        v-if="equipmentId"
        scope="equipment"
        :id="equipmentId"
        title="История взаимодействия с техникой"
        :only-user-id="isManager ? null : (auth.user.value?.id ?? null)"
        :profiles="profiles"
      />
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

