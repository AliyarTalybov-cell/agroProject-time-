<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import type { ProfileRow } from '@/lib/tasksSupabase'
import { isSupabaseConfigured, ensureProfileRow, loadProfileById, upsertMyProfile, uploadMyAvatar, removeMyAvatar } from '@/lib/tasksSupabase'
import { deleteMyAccount } from '@/lib/accountSupabase'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { PHOTO_MAX_BYTES, PHOTO_MAX_LABEL } from '@/lib/uploadLimits'
import { compressImageFile } from '@/lib/imageCompress'

const PROFILE_STORAGE_KEY = 'agro:profile'

const POSITIONS = [
  'Главный агроном',
  'Агроном',
  'Инженер',
  'Механик',
  'Диспетчер',
  'Специалист',
]

const auth = useAuth()
const router = useRouter()
const activeTab = ref<'personal' | 'security' | 'notifications'>('personal')

const profileForm = ref({
  firstName: '',
  lastName: '',
  patronymic: '',
  email: '',
  phone: '',
  position: '',
  additionalInfo: '',
})

const myProfile = ref<{ display_name: string | null; role: string | null } | null>(null)
const avatarUrl = ref<string | null>(null)

const displayName = computed(() => {
  const name = myProfile.value?.display_name || auth.user.value?.user_metadata?.full_name
  if (name && typeof name === 'string') return name.trim()
  const email = auth.user.value?.email ?? ''
  return email.split('@')[0] || 'Пользователь'
})

const roleLabel = computed(() => {
  const role = auth.userRole.value
  return role === 'manager' ? 'Руководитель' : 'Работник'
})

const userInitials = computed(() => {
  const name = displayName.value
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (name.length >= 2) return name.slice(0, 2).toUpperCase()
  return name.slice(0, 1).toUpperCase() || '?'
})

const lastSignIn = computed(() => {
  const u = auth.user.value
  if (!u) return '—'
  const last = (u as { last_sign_in_at?: string }).last_sign_in_at
  if (last) {
    const d = new Date(last)
    const today = new Date()
    const isToday = d.toDateString() === today.toDateString()
    if (isToday) return `Сегодня, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  }
  return '—'
})

const createdAt = computed(() => {
  const u = auth.user.value
  if (!u?.created_at) return '—'
  return new Date(u.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
})

function applyProfileToForm(p: ProfileRow) {
  myProfile.value = { display_name: p.display_name, role: p.role }
  avatarUrl.value = p.avatar_url ?? null
  const parts = (p.display_name || '').trim().split(/\s+/)
  profileForm.value.firstName = parts[0] || ''
  profileForm.value.lastName = parts[1] || ''
  profileForm.value.patronymic = parts[2] || ''
  profileForm.value.phone = p.phone ?? ''
  profileForm.value.position = p.position || POSITIONS[0]
  profileForm.value.additionalInfo = p.additional_info ?? ''
}

function applyFormFromLocalStorage(userId: string) {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) return false
    const data = JSON.parse(raw) as { userId?: string; firstName?: string; lastName?: string; patronymic?: string; email?: string; phone?: string; position?: string; additionalInfo?: string }
    if (data.userId !== userId) return false
    if (data.firstName != null) profileForm.value.firstName = String(data.firstName)
    if (data.lastName != null) profileForm.value.lastName = String(data.lastName)
    if (data.patronymic != null) profileForm.value.patronymic = String(data.patronymic)
    if (data.email != null) profileForm.value.email = String(data.email)
    if (data.phone != null) profileForm.value.phone = String(data.phone)
    if (data.position != null) profileForm.value.position = String(data.position)
    if (data.additionalInfo != null) profileForm.value.additionalInfo = String(data.additionalInfo)
    const fullName = [profileForm.value.firstName, profileForm.value.lastName, profileForm.value.patronymic].filter(Boolean).join(' ')
    myProfile.value = { display_name: fullName || null, role: auth.user.value?.user_metadata?.role ?? null }
    return true
  } catch {
    return false
  }
}

function saveFormToLocalStorage(userId: string) {
  try {
    localStorage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({
        userId,
        firstName: profileForm.value.firstName,
        lastName: profileForm.value.lastName,
        patronymic: profileForm.value.patronymic,
        email: profileForm.value.email,
        phone: profileForm.value.phone,
        position: profileForm.value.position,
        additionalInfo: profileForm.value.additionalInfo,
      }),
    )
  } catch {
    /* ignore */
  }
}

function profileHasData(p: ProfileRow): boolean {
  return Boolean(
    (p.display_name && p.display_name.trim()) ||
    (p.phone && p.phone.trim()) ||
    (p.position && p.position.trim()) ||
    (p.additional_info && p.additional_info.trim()),
  )
}

async function loadProfile() {
  const user = auth.user.value
  if (!user) return
  profileForm.value.email = user.email ?? ''
  const cache = auth.profileCache.value
  if (cache && cache.id === user.id) {
    applyProfileToForm(cache)
  }
  if (isSupabaseConfigured()) {
    try {
      let p = await loadProfileById(user.id)
      if (!p) {
        const fullName = (user.user_metadata?.full_name as string) || ''
        const role = (user.user_metadata?.role as string) || null
        await ensureProfileRow(user.id, user.email ?? '', fullName.trim() || null, role)
        p = await loadProfileById(user.id)
      }
      if (p) {
        const cacheWithData = cache && cache.id === user.id && profileHasData(cache)
        const dbHasData = profileHasData(p)
        if (dbHasData) {
          applyProfileToForm(p)
          auth.profileCache.value = p
          saveFormToLocalStorage(user.id)
        } else if (cacheWithData) {
          /* БД вернула пустые поля (например старая схема) — оставляем данные из кэша */
        } else if (applyFormFromLocalStorage(user.id)) {
          const fromStorage: ProfileRow = {
            id: user.id,
            email: profileForm.value.email,
            display_name: [profileForm.value.firstName, profileForm.value.lastName, profileForm.value.patronymic].filter(Boolean).join(' ') || null,
            role: user.user_metadata?.role ?? null,
            phone: profileForm.value.phone || null,
            position: profileForm.value.position || null,
            additional_info: profileForm.value.additionalInfo || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          auth.profileCache.value = fromStorage
        } else {
          applyProfileToForm(p)
          auth.profileCache.value = p
        }
        return
      }
    } catch {
      /* при ошибке сети/БД пробуем localStorage, затем user_metadata */
    }
    if (applyFormFromLocalStorage(user.id)) {
      const fromStorage: ProfileRow = {
        id: user.id,
        email: profileForm.value.email,
        display_name: [profileForm.value.firstName, profileForm.value.lastName, profileForm.value.patronymic].filter(Boolean).join(' ') || null,
        role: user.user_metadata?.role ?? null,
        phone: profileForm.value.phone || null,
        position: profileForm.value.position || null,
        additional_info: profileForm.value.additionalInfo || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      auth.profileCache.value = fromStorage
      return
    }
    if (!cache || cache.id !== user.id) {
      const fullName = (user.user_metadata?.full_name as string) || ''
      const parts = fullName.trim().split(/\s+/)
      profileForm.value.firstName = parts[0] || ''
      profileForm.value.lastName = parts[1] || ''
      profileForm.value.patronymic = parts[2] || ''
      profileForm.value.phone = (user.user_metadata?.phone as string) || ''
      profileForm.value.position = (user.user_metadata?.position as string) || POSITIONS[0]
      profileForm.value.additionalInfo = (user.user_metadata?.additional_info as string) || ''
    }
    return
  }
  if (applyFormFromLocalStorage(user.id)) return
  if (!cache || cache.id !== user.id) {
    const fullName = (user.user_metadata?.full_name as string) || ''
    const parts = fullName.trim().split(/\s+/)
    profileForm.value.firstName = parts[0] || ''
    profileForm.value.lastName = parts[1] || ''
    profileForm.value.patronymic = parts[2] || ''
    profileForm.value.phone = (user.user_metadata?.phone as string) || ''
    profileForm.value.position = (user.user_metadata?.position as string) || POSITIONS[0]
    profileForm.value.additionalInfo = (user.user_metadata?.additional_info as string) || ''
  }
}

onMounted(loadProfile)
watch(() => auth.user.value?.id, (id) => { if (id) loadProfile() })

onBeforeUnmount(() => {
  const user = auth.user.value
  if (user && (profileForm.value.firstName || profileForm.value.lastName || profileForm.value.phone || profileForm.value.position || profileForm.value.additionalInfo)) {
    saveFormToLocalStorage(user.id)
  }
})

const saving = ref(false)
const saveMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null)
let saveMessageTimer: ReturnType<typeof setTimeout> | null = null
const showSaveConfirmModal = ref(false)

const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})
const passwordMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null)
const changingPassword = ref(false)
const showDeleteAccountModal = ref(false)
const deletingAccount = ref(false)
const deleteAccountMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null)

function setSaveMessage(type: 'success' | 'error', text: string) {
  if (saveMessageTimer) clearTimeout(saveMessageTimer)
  saveMessage.value = { type, text }
  saveMessageTimer = setTimeout(() => {
    saveMessage.value = null
    saveMessageTimer = null
  }, 5000)
}

function openSaveConfirmModal() {
  showSaveConfirmModal.value = true
}

function closeSaveConfirmModal() {
  showSaveConfirmModal.value = false
}

async function confirmSaveProfile() {
  if (!auth.user.value) return
  closeSaveConfirmModal()
  saveMessage.value = null
  saving.value = true
  try {
    const fullName = [profileForm.value.firstName, profileForm.value.lastName, profileForm.value.patronymic].filter(Boolean).join(' ')
    if (isSupabaseConfigured()) {
      await upsertMyProfile(
        auth.user.value.id,
        profileForm.value.email,
        fullName || null,
        auth.user.value.user_metadata?.role ?? null,
        {
          phone: profileForm.value.phone || null,
          position: profileForm.value.position || null,
          additionalInfo: profileForm.value.additionalInfo || null,
        },
      )
      const now = new Date().toISOString()
      const savedRow: ProfileRow = {
        id: auth.user.value.id,
        email: profileForm.value.email,
        display_name: fullName || null,
        role: auth.user.value.user_metadata?.role ?? null,
        phone: profileForm.value.phone?.trim() || null,
        position: profileForm.value.position?.trim() || null,
        additional_info: profileForm.value.additionalInfo?.trim() || null,
        created_at: now,
        updated_at: now,
      }
      auth.profileCache.value = savedRow
    }
    myProfile.value = myProfile.value ? { ...myProfile.value, display_name: fullName || null } : { display_name: fullName || null, role: null }
    saveFormToLocalStorage(auth.user.value.id)
    setSaveMessage('success', 'Изменения успешно сохранены.')
  } catch (err) {
    const text = err instanceof Error ? err.message : 'Не удалось сохранить изменения.'
    setSaveMessage('error', text)
  } finally {
    saving.value = false
  }
}

const AVATAR_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const AVATAR_MAX_SIZE = PHOTO_MAX_BYTES
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarUploading = ref(false)
const avatarMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null)
let avatarMessageTimer: ReturnType<typeof setTimeout> | null = null

function setAvatarMessage(type: 'success' | 'error', text: string) {
  if (avatarMessageTimer) clearTimeout(avatarMessageTimer)
  avatarMessage.value = { type, text }
  avatarMessageTimer = setTimeout(() => {
    avatarMessage.value = null
    avatarMessageTimer = null
  }, 5000)
}

function triggerAvatarPick() {
  if (avatarUploading.value) return
  avatarInput.value?.click()
}

function syncAvatarToCache(url: string | null) {
  avatarUrl.value = url
  const cache = auth.profileCache.value
  if (cache && auth.user.value && cache.id === auth.user.value.id) {
    auth.profileCache.value = { ...cache, avatar_url: url }
  }
}

async function onAvatarSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!auth.user.value) return
  if (!isSupabaseConfigured()) {
    setAvatarMessage('error', 'Загрузка фото недоступна: база данных не подключена.')
    input.value = ''
    return
  }
  if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
    setAvatarMessage('error', 'Допустимы только изображения PNG, JPEG, WEBP или GIF.')
    input.value = ''
    return
  }
  if (file.size > AVATAR_MAX_SIZE) {
    setAvatarMessage('error', `Размер файла не должен превышать ${PHOTO_MAX_LABEL}.`)
    input.value = ''
    return
  }
  avatarMessage.value = null
  avatarUploading.value = true
  try {
    // Сжимаем на клиенте: в хранилище попадёт лёгкая версия (~512px, WebP/JPEG)
    const optimized = await compressImageFile(file, { maxSize: 512, quality: 0.85 })
    const url = await uploadMyAvatar(auth.user.value.id, optimized)
    syncAvatarToCache(url)
    setAvatarMessage('success', 'Фото профиля обновлено.')
  } catch (err) {
    const text = err instanceof Error ? err.message : 'Не удалось загрузить фото.'
    setAvatarMessage('error', text)
  } finally {
    avatarUploading.value = false
    input.value = ''
  }
}

async function deleteAvatar() {
  if (!auth.user.value || avatarUploading.value) return
  if (!isSupabaseConfigured()) return
  avatarMessage.value = null
  avatarUploading.value = true
  try {
    await removeMyAvatar(auth.user.value.id)
    syncAvatarToCache(null)
    setAvatarMessage('success', 'Фото профиля удалено.')
  } catch (err) {
    const text = err instanceof Error ? err.message : 'Не удалось удалить фото.'
    setAvatarMessage('error', text)
  } finally {
    avatarUploading.value = false
  }
}

async function changePassword() {
  const { currentPassword, newPassword, confirmPassword } = passwordForm.value
  if (!currentPassword.trim()) {
    passwordMessage.value = { type: 'error', text: 'Введите текущий пароль.' }
    return
  }
  if (!newPassword.trim()) {
    passwordMessage.value = { type: 'error', text: 'Введите новый пароль.' }
    return
  }
  if (newPassword.length < 6) {
    passwordMessage.value = { type: 'error', text: 'Новый пароль должен быть не менее 6 символов.' }
    return
  }
  if (newPassword !== confirmPassword) {
    passwordMessage.value = { type: 'error', text: 'Новый пароль и подтверждение не совпадают.' }
    return
  }
  if (!isSupabaseConfigured()) {
    passwordMessage.value = { type: 'error', text: 'Смена пароля недоступна: база данных не подключена.' }
    return
  }
  passwordMessage.value = null
  changingPassword.value = true
  try {
    await auth.updatePassword(currentPassword.trim(), newPassword)
    passwordMessage.value = { type: 'success', text: 'Пароль успешно изменён.' }
    passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  } catch (err) {
    const text = err instanceof Error ? err.message : 'Не удалось изменить пароль.'
    passwordMessage.value = { type: 'error', text }
  } finally {
    changingPassword.value = false
  }
}

function openDeleteAccountModal() {
  deleteAccountMessage.value = null
  showDeleteAccountModal.value = true
}

function closeDeleteAccountModal() {
  if (deletingAccount.value) return
  showDeleteAccountModal.value = false
}

async function confirmDeleteAccount() {
  deletingAccount.value = true
  deleteAccountMessage.value = null
  try {
    await deleteMyAccount()
    try {
      localStorage.removeItem(PROFILE_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    try {
      await auth.logout()
    } catch {
      /* пользователь уже удалён, signOut может завершиться ошибкой */
    }
    await router.replace('/login')
  } catch (err) {
    deleteAccountMessage.value = { type: 'error', text: formatSupabaseError(err) || 'Не удалось удалить аккаунт.' }
  } finally {
    deletingAccount.value = false
  }
}
</script>

<template>
  <div class="profile-page-wrapper">
  <section class="profile-page page-enter-item">
    <header class="profile-header">
      <h1 class="profile-page-title">Настройки профиля</h1>
      <p class="profile-page-subtitle">Управляйте своими личными данными и настройками учетной записи.</p>
    </header>

    <div class="profile-layout">
      <!-- Левая колонка: карточка пользователя и активность -->
      <aside class="profile-card-aside">
        <div class="profile-user-card card-rounded">
          <div class="profile-avatar-wrap">
            <button
              type="button"
              class="profile-avatar"
              :class="{ 'profile-avatar--busy': avatarUploading }"
              :disabled="avatarUploading"
              :title="avatarUrl ? 'Сменить фото профиля' : 'Загрузить фото профиля'"
              @click="triggerAvatarPick"
            >
              <img v-if="avatarUrl" :src="avatarUrl" alt="Фото профиля" class="profile-avatar-img" />
              <span v-else class="profile-avatar-initials">{{ userInitials }}</span>
              <span class="profile-avatar-overlay" aria-hidden="true">
                <svg v-if="!avatarUploading" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                <svg v-else class="profile-avatar-spinner" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              </span>
            </button>
            <input
              ref="avatarInput"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              class="profile-avatar-input"
              @change="onAvatarSelected"
            />
          </div>
          <div class="profile-avatar-actions">
            <button type="button" class="profile-avatar-link" :disabled="avatarUploading" @click="triggerAvatarPick">
              {{ avatarUploading ? 'Загрузка…' : (avatarUrl ? 'Сменить фото' : 'Загрузить фото') }}
            </button>
            <button v-if="avatarUrl && !avatarUploading" type="button" class="profile-avatar-link profile-avatar-link--danger" @click="deleteAvatar">
              Удалить
            </button>
          </div>
          <p v-if="avatarMessage" class="profile-avatar-message" :class="avatarMessage.type === 'success' ? 'profile-avatar-message--success' : 'profile-avatar-message--error'">
            {{ avatarMessage.text }}
          </p>
          <div class="profile-user-name">{{ displayName }}</div>
          <div class="profile-user-position">{{ profileForm.position || 'Главный агроном' }}</div>
          <div class="profile-badge">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            {{ roleLabel }}
          </div>
        </div>

        <div class="profile-contact-block card-rounded">
          <h3 class="profile-block-title">Контактная информация</h3>
          <div class="profile-contact-row">
            <svg class="profile-contact-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            <span>{{ profileForm.email || auth.user.value?.email || '—' }}</span>
          </div>
          <div class="profile-contact-row">
            <svg class="profile-contact-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>{{ profileForm.phone || '—' }}</span>
          </div>
          <div class="profile-contact-row">
            <svg class="profile-contact-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            <span>Агрономическая служба</span>
          </div>
        </div>

        <div class="profile-activity-block card-rounded">
          <h3 class="profile-block-title">Активность аккаунта</h3>
          <div class="profile-activity-row">
            <span class="profile-activity-label">Последний вход</span>
            <span class="profile-activity-value">{{ lastSignIn }}</span>
          </div>
          <div class="profile-activity-row">
            <span class="profile-activity-label">Дата регистрации</span>
            <span class="profile-activity-value">{{ createdAt }}</span>
          </div>
          <div class="profile-activity-row">
            <span class="profile-activity-label">Статус</span>
            <span class="profile-status-active"><span class="profile-status-dot"></span>Активен</span>
          </div>
        </div>
      </aside>

      <!-- Правая колонка: форма -->
      <div class="profile-form-area card-rounded">
        <div class="profile-tabs">
          <button type="button" class="profile-tab" :class="{ 'profile-tab--active': activeTab === 'personal' }" @click="activeTab = 'personal'">Личные данные</button>
          <button type="button" class="profile-tab" :class="{ 'profile-tab--active': activeTab === 'security' }" @click="activeTab = 'security'">Безопасность</button>
          <button type="button" class="profile-tab" :class="{ 'profile-tab--active': activeTab === 'notifications' }" @click="activeTab = 'notifications'">Уведомления</button>
        </div>

        <div v-show="activeTab === 'personal'" class="profile-tab-panel">
          <h2 class="profile-form-section-title">Основная информация</h2>
          <p class="profile-form-section-desc">Обновите ваши персональные данные и контактную информацию.</p>

          <div v-if="saveMessage" class="profile-save-message" :class="saveMessage.type === 'success' ? 'profile-save-message--success' : 'profile-save-message--error'" role="alert">
            <svg v-if="saveMessage.type === 'success'" class="profile-save-message-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <svg v-else class="profile-save-message-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
            <span>{{ saveMessage.text }}</span>
          </div>

          <div class="profile-form-grid">
            <div class="profile-field">
              <label class="profile-label" for="pf-first">Имя</label>
              <input id="pf-first" v-model="profileForm.firstName" type="text" class="profile-input" placeholder="Имя" />
            </div>
            <div class="profile-field">
              <label class="profile-label" for="pf-last">Фамилия</label>
              <input id="pf-last" v-model="profileForm.lastName" type="text" class="profile-input" placeholder="Фамилия" />
            </div>
            <div class="profile-field">
              <label class="profile-label" for="pf-patronymic">Отчество (необязательно)</label>
              <input id="pf-patronymic" v-model="profileForm.patronymic" type="text" class="profile-input" placeholder="Отчество" />
            </div>
            <div class="profile-field profile-field--full">
              <label class="profile-label" for="pf-email">Электронная почта</label>
              <div class="profile-input-wrap">
                <svg class="profile-input-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <input id="pf-email" v-model="profileForm.email" type="email" class="profile-input" placeholder="email@example.com" />
              </div>
            </div>
            <div class="profile-field profile-field--full">
              <label class="profile-label" for="pf-phone">Номер телефона</label>
              <div class="profile-input-wrap">
                <svg class="profile-input-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <input id="pf-phone" v-model="profileForm.phone" type="tel" class="profile-input" placeholder="+7 (___) ___-__-__" />
              </div>
            </div>
            <div class="profile-field">
              <label class="profile-label" for="pf-position">Должность</label>
              <select id="pf-position" v-model="profileForm.position" class="profile-input profile-select">
                <option v-for="p in POSITIONS" :key="p" :value="p">{{ p }}</option>
              </select>
            </div>
            <div class="profile-field profile-field--full">
              <label class="profile-label profile-label--with-info" for="pf-role">
                Роль в системе
                <svg class="profile-info-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="Для изменения роли обратитесь в ИТ-отдел"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              </label>
              <div class="profile-input-wrap profile-input-wrap--readonly">
                <svg class="profile-input-icon profile-input-icon--lock" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input id="pf-role" type="text" class="profile-input" :value="roleLabel" readonly />
              </div>
              <p class="profile-field-hint">Для изменения роли обратитесь в ИТ-отдел.</p>
            </div>
            <div class="profile-field profile-field--full">
              <label class="profile-label" for="pf-info">Дополнительная информация</label>
              <textarea id="pf-info" v-model="profileForm.additionalInfo" class="profile-input profile-textarea" rows="3" placeholder="Краткая информация о себе или обязанностях"></textarea>
            </div>
          </div>

          <div class="profile-form-actions">
            <button type="button" class="profile-btn profile-btn--primary" :disabled="saving" @click="openSaveConfirmModal">
              {{ saving ? 'Сохранение…' : 'Сохранить изменения' }}
            </button>
          </div>
        </div>

        <div v-show="activeTab === 'security'" class="profile-tab-panel">
          <h2 class="profile-form-section-title">Безопасность</h2>
          <p class="profile-form-section-desc">Смена пароля и настройки входа.</p>

          <div class="profile-password-section">
            <h3 class="profile-password-heading">Смена пароля</h3>
            <div v-if="passwordMessage" class="profile-save-message" :class="passwordMessage.type === 'success' ? 'profile-save-message--success' : 'profile-save-message--error'" role="alert">
              <svg v-if="passwordMessage.type === 'success'" class="profile-save-message-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              <svg v-else class="profile-save-message-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
              <span>{{ passwordMessage.text }}</span>
            </div>
            <div class="profile-form-grid">
              <div class="profile-field profile-field--full">
                <label class="profile-label" for="pw-current">Текущий пароль</label>
                <input
                  id="pw-current"
                  v-model="passwordForm.currentPassword"
                  type="password"
                  class="profile-input"
                  placeholder="Введите текущий пароль"
                  autocomplete="current-password"
                />
              </div>
              <div class="profile-field profile-field--full">
                <label class="profile-label" for="pw-new">Новый пароль</label>
                <input
                  id="pw-new"
                  v-model="passwordForm.newPassword"
                  type="password"
                  class="profile-input"
                  placeholder="Не менее 6 символов"
                  autocomplete="new-password"
                />
              </div>
              <div class="profile-field profile-field--full">
                <label class="profile-label" for="pw-confirm">Подтвердите новый пароль</label>
                <input
                  id="pw-confirm"
                  v-model="passwordForm.confirmPassword"
                  type="password"
                  class="profile-input"
                  placeholder="Повторите новый пароль"
                  autocomplete="new-password"
                />
              </div>
            </div>
            <div class="profile-form-actions">
              <button
                type="button"
                class="profile-btn profile-btn--primary"
                :disabled="changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword"
                @click="changePassword"
              >
                {{ changingPassword ? 'Сохранение…' : 'Изменить пароль' }}
              </button>
            </div>
          </div>

          <div class="profile-danger-zone">
            <h3 class="profile-password-heading">Удаление аккаунта</h3>
            <p class="profile-form-section-desc">
              Аккаунт будет удалён без возможности восстановления. Связи с пользователем в задачах, полях и журналах будут очищены автоматически.
            </p>
            <button type="button" class="profile-btn profile-btn--danger" :disabled="deletingAccount" @click="openDeleteAccountModal">
              {{ deletingAccount ? 'Удаление…' : 'Удалить аккаунт' }}
            </button>
          </div>
        </div>

        <div v-show="activeTab === 'notifications'" class="profile-tab-panel">
          <h2 class="profile-form-section-title">Уведомления</h2>
          <p class="profile-form-section-desc">Настройте способ и частоту уведомлений.</p>
          <p class="profile-placeholder">Раздел в разработке.</p>
        </div>
      </div>
    </div>
  </section>

  <div
    v-if="showSaveConfirmModal"
    class="profile-confirm-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="profile-confirm-title"
    @click.self="closeSaveConfirmModal"
  >
    <div class="profile-confirm-modal">
      <h2 id="profile-confirm-title" class="profile-confirm-title">Вы уверены в изменении данных.</h2>
      <p class="profile-confirm-text">Изменения будут сохранены в вашем профиле.</p>
      <div class="profile-confirm-actions">
        <button type="button" class="profile-btn profile-btn--secondary" @click="closeSaveConfirmModal">
          Отмена
        </button>
        <button type="button" class="profile-btn profile-btn--primary" :disabled="saving" @click="confirmSaveProfile">
          Да, сохранить
        </button>
      </div>
    </div>
  </div>

  <div
    v-if="showDeleteAccountModal"
    class="profile-confirm-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="profile-delete-title"
    @click.self="closeDeleteAccountModal"
  >
    <div class="profile-confirm-modal profile-confirm-modal--danger">
      <h2 id="profile-delete-title" class="profile-confirm-title">Удалить аккаунт?</h2>
      <p class="profile-confirm-text">
        Вы удалите свой профиль и вход в систему. Это действие необратимо.
      </p>
      <p v-if="deleteAccountMessage" class="profile-confirm-error">{{ deleteAccountMessage.text }}</p>
      <div class="profile-confirm-actions">
        <button type="button" class="profile-btn profile-btn--secondary" :disabled="deletingAccount" @click="closeDeleteAccountModal">
          Отмена
        </button>
        <button type="button" class="profile-btn profile-btn--danger" :disabled="deletingAccount" @click="confirmDeleteAccount">
          {{ deletingAccount ? 'Удаление…' : 'Да, удалить' }}
        </button>
      </div>
    </div>
  </div>
  </div>
</template>

<style scoped>
.profile-page-wrapper {
  /* Один корневой элемент для Vue Transition — иначе переходы между страницами ломаются */
  min-height: 0;
}

.profile-page {
  padding: 0 var(--space-lg);
  padding-bottom: var(--space-xl);
  max-width: 1100px;
  margin: 0 auto;
}

.profile-header {
  margin-bottom: var(--space-xl);
}

.profile-page-title {
  margin: 0 0 4px 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
}

.profile-page-subtitle {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text-secondary);
}

.profile-layout {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: var(--space-xl);
  align-items: start;
}

@media (max-width: 900px) {
  .profile-layout {
    grid-template-columns: 1fr;
  }
}

.profile-card-aside {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.card-rounded {
  background: #fff;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: var(--space-lg);
  box-shadow: var(--shadow-card);
}

[data-theme='dark'] .card-rounded {
  background: var(--bg-panel);
}

.profile-user-card {
  text-align: center;
  padding: var(--space-xl);
}

.profile-avatar-wrap {
  display: flex;
  justify-content: center;
}

.profile-avatar {
  position: relative;
  width: 100%;
  max-width: 200px;
  aspect-ratio: 1 / 1;
  height: auto;
  border-radius: 50%;
  background: var(--accent-green);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.75rem;
  font-weight: 700;
  margin: 0 auto 16px;
  padding: 0;
  border: none;
  overflow: hidden;
  cursor: pointer;
}

.profile-avatar:disabled {
  cursor: progress;
}

.profile-avatar-initials {
  line-height: 1;
}

.profile-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.profile-avatar-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.42);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.profile-avatar:hover .profile-avatar-overlay,
.profile-avatar:focus-visible .profile-avatar-overlay,
.profile-avatar--busy .profile-avatar-overlay {
  opacity: 1;
}

.profile-avatar-spinner {
  animation: profile-avatar-spin 0.8s linear infinite;
}

@keyframes profile-avatar-spin {
  to { transform: rotate(360deg); }
}

.profile-avatar-input {
  display: none;
}

.profile-avatar-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 8px;
}

.profile-avatar-link {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--accent-green);
  cursor: pointer;
}

.profile-avatar-link:hover:not(:disabled) {
  text-decoration: underline;
}

.profile-avatar-link:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.profile-avatar-link--danger {
  color: var(--danger-red);
}

.profile-avatar-message {
  margin: 0 0 10px 0;
  font-size: 0.8125rem;
}

.profile-avatar-message--success {
  color: var(--accent-green);
}

.profile-avatar-message--error {
  color: var(--danger-red);
}

[data-theme='dark'] .profile-avatar {
  color: #fff;
}

.profile-user-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.profile-user-position {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.profile-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--accent-green);
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 500;
}

.profile-block-title {
  margin: 0 0 12px 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.profile-contact-row,
.profile-activity-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.profile-contact-row:not(:last-child),
.profile-activity-row:not(:last-child) {
  border-bottom: 1px solid var(--border-color);
}

.profile-contact-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.profile-activity-label {
  color: var(--text-secondary);
  min-width: 120px;
}

.profile-activity-value {
  color: var(--text-primary);
}

.profile-status-active {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent-green);
  font-weight: 500;
}

.profile-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-green);
}

.profile-form-area {
  padding: var(--space-xl);
}

.profile-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: var(--space-lg);
}

.profile-tab {
  padding: 10px 16px;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
}

.profile-tab:hover {
  color: var(--text-primary);
}

.profile-tab--active {
  color: var(--accent-green);
  border-bottom-color: var(--accent-green);
}

.profile-form-section-title {
  margin: 0 0 4px 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.profile-form-section-desc {
  margin: 0 0 var(--space-lg) 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.profile-save-message {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.9375rem;
  margin-bottom: var(--space-lg);
}

.profile-save-message--success {
  background: color-mix(in srgb, var(--accent-green) 14%, transparent);
  color: #166534;
  border: 1px solid color-mix(in srgb, var(--accent-green) 28%, var(--border-color));
}

.profile-save-message--error {
  background: color-mix(in srgb, var(--danger-red) 12%, transparent);
  color: var(--danger-red);
  border: 1px solid color-mix(in srgb, var(--danger-red) 30%, transparent);
}

.profile-save-message-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

[data-theme='dark'] .profile-save-message--success {
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  color: color-mix(in srgb, white 82%, var(--accent-green));
  border-color: color-mix(in srgb, var(--accent-green) 34%, var(--border-color));
}

[data-theme='dark'] .profile-save-message--error {
  background: color-mix(in srgb, var(--danger-red) 22%, transparent);
  color: color-mix(in srgb, white 80%, var(--danger-red));
  border-color: color-mix(in srgb, var(--danger-red) 42%, transparent);
}

.profile-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}

.profile-field--full {
  grid-column: 1 / -1;
}

.profile-label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.profile-label--with-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.profile-info-icon {
  color: var(--text-secondary);
  cursor: help;
}

.profile-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 0.9375rem;
  background: var(--bg-panel-hover);
  color: var(--text-primary);
}

.profile-input:focus {
  outline: none;
  border-color: var(--accent-green);
  background: var(--bg-elevated);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.profile-input[readonly] {
  background: var(--chip-bg);
  cursor: default;
}

[data-theme='dark'] .profile-input {
  background: color-mix(in srgb, var(--bg-elevated) 86%, black);
  border-color: var(--border-color);
  color: var(--text-primary);
}

[data-theme='dark'] .profile-input:focus {
  background: color-mix(in srgb, var(--bg-elevated) 94%, black);
  border-color: var(--accent-green);
}

[data-theme='dark'] .profile-input[readonly] {
  background: color-mix(in srgb, var(--bg-elevated) 70%, black);
  color: var(--text-muted);
}

[data-theme='dark'] .profile-input::placeholder {
  color: var(--text-muted);
  opacity: 0.8;
}

.profile-input-wrap {
  position: relative;
}

.profile-input-wrap .profile-input {
  padding-left: 40px;
}

.profile-input-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  color: var(--text-secondary);
  pointer-events: none;
}

.profile-input-wrap--readonly .profile-input-icon--lock {
  color: var(--text-secondary);
}

.profile-select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;
}

[data-theme='dark'] .profile-select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
}

.profile-textarea {
  min-height: 80px;
  resize: vertical;
}

[data-theme='dark'] .profile-textarea {
  background: color-mix(in srgb, var(--bg-elevated) 86%, black);
  border-color: var(--border-color);
  color: var(--text-primary);
}

[data-theme='dark'] .profile-textarea:focus {
  background: color-mix(in srgb, var(--bg-elevated) 94%, black);
}

.profile-field-hint {
  margin: 6px 0 0 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.profile-form-actions {
  margin-top: var(--space-md);
}

.profile-btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}

.profile-btn--primary {
  background: var(--accent-green);
  color: #fff;
  border-color: var(--accent-green);
}

.profile-btn--primary:hover:not(:disabled) {
  background: var(--accent-green-hover);
  border-color: var(--accent-green-hover);
}

.profile-btn--secondary {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-color: var(--border-color);
}

.profile-btn--secondary:hover {
  background: var(--border-color);
}

.profile-btn--danger {
  background: color-mix(in srgb, var(--danger-red) 92%, #6e0f0f);
  color: #fff;
  border-color: color-mix(in srgb, var(--danger-red) 80%, #6e0f0f);
}

.profile-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger-red) 100%, #5f0d0d);
  border-color: color-mix(in srgb, var(--danger-red) 95%, #5f0d0d);
}

[data-theme='dark'] .profile-btn--primary {
  color: #fff;
}

[data-theme='dark'] .profile-btn--secondary {
  background: var(--bg-panel);
  color: var(--text-primary);
  border-color: var(--border-color);
}

.profile-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.profile-placeholder {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  margin: 0;
}

.profile-password-section {
  max-width: 480px;
}

.profile-password-heading {
  margin: 0 0 var(--space-md) 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.profile-password-section .profile-save-message {
  margin-bottom: var(--space-md);
}

.profile-danger-zone {
  margin-top: var(--space-xl);
  padding-top: var(--space-lg);
  border-top: 1px dashed var(--border-color);
}

[data-theme='dark'] .profile-page-title,
[data-theme='dark'] .profile-form-section-title {
  color: var(--text-primary);
}

[data-theme='dark'] .profile-page-subtitle,
[data-theme='dark'] .profile-form-section-desc,
[data-theme='dark'] .profile-field-hint {
  color: var(--text-secondary);
}

[data-theme='dark'] .profile-input-icon {
  color: var(--text-secondary);
}

/* Модальное окно подтверждения сохранения профиля */
.profile-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
  background: var(--modal-backdrop);
}

.profile-confirm-modal {
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: var(--space-xl);
  max-width: 400px;
  width: 100%;
  box-shadow: var(--shadow-card);
}

.profile-confirm-modal--danger {
  border-color: color-mix(in srgb, var(--danger-red) 40%, var(--border-color));
}

.profile-confirm-title {
  margin: 0 0 var(--space-sm) 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.profile-confirm-text {
  margin: 0 0 var(--space-lg) 0;
  font-size: 0.9375rem;
  color: var(--text-secondary);
}

.profile-confirm-error {
  margin: 0 0 var(--space-md) 0;
  color: var(--danger-red);
  font-size: 0.875rem;
}

.profile-confirm-actions {
  display: flex;
  gap: var(--space-md);
  justify-content: flex-end;
}

@media (max-width: 600px) {
  .profile-page {
    padding: 0 var(--space-md);
    padding-bottom: var(--space-lg);
  }

  .profile-user-card {
    padding: var(--space-lg);
  }

  .profile-form-area {
    padding: var(--space-lg);
  }

  .profile-form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .profile-contact-row,
  .profile-activity-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .profile-activity-label {
    min-width: 0;
  }

  .profile-tabs {
    flex-wrap: wrap;
  }

  .profile-tab {
    flex: 1 1 auto;
    text-align: center;
  }

  .profile-page-title {
    font-size: 1.25rem;
  }
}
</style>
