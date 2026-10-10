<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import { Input } from '@/components/ui/shadcn/input'
import { Textarea } from '@/components/ui/shadcn/textarea'
import { Button } from '@/components/ui/shadcn/button'
import { BriefcaseIcon, CameraIcon, CheckIcon, CircleAlertIcon, LoaderCircleIcon, LockIcon, MailIcon, PhoneIcon, Trash2Icon } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/shadcn/input-group'
import FormGrid from '@/components/ui/layout/FormGrid.vue'
import FormField from '@/components/ui/layout/FormField.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import type { ProfileRow } from '@/lib/tasksSupabase'
import { isSupabaseConfigured, loadProfileById, upsertMyProfile, uploadMyAvatar, removeMyAvatar } from '@/lib/tasksSupabase'
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
    myProfile.value = { display_name: fullName || null, role: auth.userRole.value }
    return true
  } catch {
    // Черновик формы в localStorage испорчен — просто не подставляем его,
    // форма заполнится данными из профиля.
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
      // Строку профиля создаёт триггер sync_profile_from_auth_user при регистрации,
      // клиенту создавать её не нужно и нельзя (INSERT закрыт грантами).
      const p = await loadProfileById(user.id)
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
            role: auth.userRole.value,
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
        role: auth.userRole.value,
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
        fullName || null,
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
        role: auth.userRole.value,
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
  <div class="tw-scope">
    <section class="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <!-- Левая колонка: карточка пользователя, контакты, активность -->
      <aside class="flex min-w-0 flex-col gap-6">
        <div class="flex flex-col items-center gap-3 rounded-xl border bg-card p-6 text-center shadow-xs">
          <button
            type="button"
            class="group relative size-24 overflow-hidden rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait"
            :disabled="avatarUploading"
            :aria-label="avatarUrl ? 'Сменить фото профиля' : 'Загрузить фото профиля'"
            @click="triggerAvatarPick"
          >
            <img v-if="avatarUrl" :src="avatarUrl" alt="" class="size-full object-cover" />
            <span v-else class="text-3xl font-semibold">{{ userInitials }}</span>
            <span
              class="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              :class="{ 'opacity-100': avatarUploading }"
              aria-hidden="true"
            >
              <LoaderCircleIcon v-if="avatarUploading" class="size-6 animate-spin" />
              <CameraIcon v-else class="size-6" />
            </span>
          </button>
          <input
            ref="avatarInput"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            class="hidden"
            @change="onAvatarSelected"
          />
          <div class="flex flex-wrap justify-center gap-1">
            <Button variant="ghost" size="sm" type="button" :disabled="avatarUploading" @click="triggerAvatarPick">
              <CameraIcon />
              {{ avatarUploading ? 'Загрузка…' : (avatarUrl ? 'Сменить фото' : 'Загрузить фото') }}
            </Button>
            <Button
              v-if="avatarUrl && !avatarUploading"
              variant="ghost"
              size="sm"
              type="button"
              class="text-destructive hover:bg-destructive/10 hover:text-destructive"
              @click="deleteAvatar"
            >
              <Trash2Icon />
              Удалить
            </Button>
          </div>
          <p
            v-if="avatarMessage"
            class="text-xs"
            :class="avatarMessage.type === 'success' ? 'text-emerald-700 dark:text-ring' : 'text-destructive'"
            role="status"
          >
            {{ avatarMessage.text }}
          </p>
          <div class="grid gap-1">
            <div class="text-lg font-semibold">{{ displayName }}</div>
            <div v-if="profileForm.position" class="text-sm text-muted-foreground">{{ profileForm.position }}</div>
          </div>
          <UiBadge tone="primary">{{ roleLabel }}</UiBadge>
        </div>

        <div class="grid gap-3 rounded-xl border bg-card p-6 shadow-xs">
          <h3 class="text-sm font-medium">Контактная информация</h3>
          <div class="flex min-w-0 items-center gap-3 text-sm">
            <MailIcon class="size-4 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ profileForm.email || auth.user.value?.email || '—' }}</span>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <PhoneIcon class="size-4 shrink-0 text-muted-foreground" />
            <span>{{ profileForm.phone || '—' }}</span>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <BriefcaseIcon class="size-4 shrink-0 text-muted-foreground" />
            <span>Агрономическая служба</span>
          </div>
        </div>

        <div class="grid gap-3 rounded-xl border bg-card p-6 shadow-xs">
          <h3 class="text-sm font-medium">Активность аккаунта</h3>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
            <dt class="text-muted-foreground">Последний вход</dt>
            <dd class="text-right">{{ lastSignIn }}</dd>
            <dt class="text-muted-foreground">Регистрация</dt>
            <dd class="text-right">{{ createdAt }}</dd>
            <dt class="text-muted-foreground">Статус</dt>
            <dd class="flex items-center justify-end gap-1.5 text-emerald-700 dark:text-ring">
              <span class="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
              Активен
            </dd>
          </dl>
        </div>
      </aside>

      <!-- Правая колонка: вкладки и формы -->
      <div class="flex min-w-0 flex-col gap-6 rounded-xl border bg-card p-4 shadow-xs md:p-6">
        <Tabs :model-value="activeTab" @update:model-value="(v) => (activeTab = v as typeof activeTab)">
          <TabsList class="w-full sm:w-fit">
            <TabsTrigger value="personal">Личные данные</TabsTrigger>
            <TabsTrigger value="security">Безопасность</TabsTrigger>
            <TabsTrigger value="notifications">Уведомления</TabsTrigger>
          </TabsList>
        </Tabs>

        <div v-show="activeTab === 'personal'" class="flex flex-col gap-6">
          <div class="grid gap-1">
            <h2 class="text-lg font-semibold">Основная информация</h2>
            <p class="text-sm text-muted-foreground">Обновите личные данные и контакты.</p>
          </div>

          <Alert v-if="saveMessage" :variant="saveMessage.type === 'success' ? 'default' : 'destructive'">
            <CheckIcon v-if="saveMessage.type === 'success'" />
            <CircleAlertIcon v-else />
            <AlertDescription>{{ saveMessage.text }}</AlertDescription>
          </Alert>

          <FormGrid :cols="2">
            <FormField label="Имя" for="pf-first">
              <Input id="pf-first" v-model="profileForm.firstName" type="text" placeholder="Имя" />
            </FormField>
            <FormField label="Фамилия" for="pf-last">
              <Input id="pf-last" v-model="profileForm.lastName" type="text" placeholder="Фамилия" />
            </FormField>
            <FormField label="Отчество" for="pf-patronymic" hint="Необязательно">
              <Input id="pf-patronymic" v-model="profileForm.patronymic" type="text" placeholder="Отчество" />
            </FormField>
            <FormField label="Должность" for="pf-position">
              <UiSelect id="pf-position" v-model="profileForm.position" block :options="POSITIONS.map((p) => ({ value: p, label: String(p) }))" />
            </FormField>
            <FormField label="Электронная почта" for="pf-email">
              <InputGroup>
                <InputGroupAddon><MailIcon /></InputGroupAddon>
                <InputGroupInput id="pf-email" v-model="profileForm.email" type="email" placeholder="email@example.com" />
              </InputGroup>
            </FormField>
            <FormField label="Телефон" for="pf-phone">
              <InputGroup>
                <InputGroupAddon><PhoneIcon /></InputGroupAddon>
                <InputGroupInput id="pf-phone" v-model="profileForm.phone" type="tel" placeholder="+7 (___) ___-__-__" />
              </InputGroup>
            </FormField>
            <FormField label="Роль в системе" for="pf-role" wide hint="Роль меняет ИТ-отдел.">
              <InputGroup class="bg-muted/50">
                <InputGroupAddon><LockIcon /></InputGroupAddon>
                <InputGroupInput id="pf-role" :model-value="roleLabel" readonly class="cursor-default" />
              </InputGroup>
            </FormField>
            <FormField label="Дополнительная информация" for="pf-info" wide>
              <Textarea id="pf-info" v-model="profileForm.additionalInfo" rows="3" placeholder="Коротко о себе или обязанностях" />
            </FormField>
          </FormGrid>

          <div class="flex justify-end border-t pt-6">
            <Button type="button" :disabled="saving" @click="openSaveConfirmModal">
              {{ saving ? 'Сохранение…' : 'Сохранить изменения' }}
            </Button>
          </div>
        </div>

        <div v-show="activeTab === 'security'" class="flex flex-col gap-6">
          <div class="grid gap-1">
            <h2 class="text-lg font-semibold">Смена пароля</h2>
            <p class="text-sm text-muted-foreground">Новый пароль — не короче 6 символов.</p>
          </div>

          <Alert v-if="passwordMessage" :variant="passwordMessage.type === 'success' ? 'default' : 'destructive'">
            <CheckIcon v-if="passwordMessage.type === 'success'" />
            <CircleAlertIcon v-else />
            <AlertDescription>{{ passwordMessage.text }}</AlertDescription>
          </Alert>

          <FormGrid class="max-w-md">
            <FormField label="Текущий пароль" for="pw-current">
              <Input id="pw-current" v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" />
            </FormField>
            <FormField label="Новый пароль" for="pw-new">
              <Input id="pw-new" v-model="passwordForm.newPassword" type="password" autocomplete="new-password" />
            </FormField>
            <FormField label="Повторите новый пароль" for="pw-confirm">
              <Input id="pw-confirm" v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" />
            </FormField>
          </FormGrid>
          <div>
            <Button
              type="button"
              :disabled="changingPassword || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword"
              @click="changePassword"
            >
              {{ changingPassword ? 'Сохранение…' : 'Изменить пароль' }}
            </Button>
          </div>

          <div class="flex flex-col gap-3 rounded-lg border border-destructive/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="grid gap-1">
              <h3 class="text-sm font-medium">Удаление аккаунта</h3>
              <p class="text-sm text-muted-foreground">
                Аккаунт будет удалён без возможности восстановления. Связи с вами в задачах, полях и журналах очистятся автоматически.
              </p>
            </div>
            <Button
              variant="outline"
              type="button"
              class="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              :disabled="deletingAccount"
              @click="openDeleteAccountModal"
            >
              {{ deletingAccount ? 'Удаление…' : 'Удалить аккаунт' }}
            </Button>
          </div>
        </div>

        <div v-show="activeTab === 'notifications'" class="flex flex-col gap-1">
          <h2 class="text-lg font-semibold">Уведомления</h2>
          <p class="text-sm text-muted-foreground">Раздел в разработке.</p>
        </div>
      </div>
    </section>

    <UiConfirmModal
      v-if="showSaveConfirmModal"
      title="Сохранить изменения?"
      text="Изменения будут сохранены в вашем профиле."
      confirm-label="Сохранить"
      busy-label="Сохранение…"
      :danger="false"
      :busy="saving"
      @cancel="closeSaveConfirmModal"
      @confirm="confirmSaveProfile"
    />

    <UiConfirmModal
      v-if="showDeleteAccountModal"
      title="Удалить аккаунт?"
      confirm-label="Удалить аккаунт"
      :busy="deletingAccount"
      @cancel="closeDeleteAccountModal"
      @confirm="confirmDeleteAccount"
    >
      Вы удалите свой профиль и вход в систему. Это действие необратимо.
      <span v-if="deleteAccountMessage" class="mt-2 block text-destructive">{{ deleteAccountMessage.text }}</span>
    </UiConfirmModal>
  </div>
</template>

