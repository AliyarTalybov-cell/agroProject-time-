<script setup lang="ts">
import { MoonIcon, SunIcon } from '@lucide/vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from '@/composables/useTheme'
import { useAuth } from '@/stores/auth'
import { useBackendHealth } from '@/stores/backendHealth'
import AppBackendBadge from '@/components/AppBackendBadge.vue'
import AppBackendModal from '@/components/AppBackendModal.vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import { Toaster } from '@/components/ui/shadcn/sonner'
import UiPromptHost from '@/components/ui/UiPromptHost.vue'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import AppSidebar from '@/components/ui/app/AppSidebar.vue'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/shadcn/sidebar'
import { Separator } from '@/components/ui/shadcn/separator'
import { Button } from '@/components/ui/shadcn/button'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/shadcn/breadcrumb'
import { chatTotalUnread, refreshChatTotalUnread } from '@/lib/chatSupabase'
import { countMyUnreadNotifications } from '@/lib/notificationsSupabase'
import { startActivityHeartbeat, stopActivityHeartbeat } from '@/lib/activityHeartbeat'
import { loadProfileById } from '@/lib/tasksSupabase'
import { isSupabaseConfigured } from '@/lib/supabase'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const backendHealth = useBackendHealth()
const isAuthLayout = computed(() => route.meta?.public === true)
const showAuthBootstrapLoading = computed(
  () => !isAuthLayout.value && auth.loading.value && auth.isAuthConfigured(),
)
const showBackendBanner = computed(
  () => backendHealth.isUnavailable.value && backendHealth.errorMessage.value,
)
const backendBannerMessage = computed(() => backendHealth.errorMessage.value ?? '')

/** Модалка недоступности на экране входа (можно закрыть, появляется снова при новой ошибке). */
const backendModalDismissed = ref(false)
const showAuthBackendModal = computed(
  () => isAuthLayout.value && Boolean(showBackendBanner.value) && !backendModalDismissed.value,
)
/** Плавающий бейдж «Нет связи с БД» в кабинете (на экране входа вместо него — модалка). */
const showBackendBadge = computed(
  () => !isAuthLayout.value && Boolean(showBackendBanner.value),
)
watch(
  () => backendHealth.status.value,
  (s) => { if (s === 'error' || s === 'not_configured') backendModalDismissed.value = false },
)
const pageTitle = computed(() => {
  if (route.name === 'dashboard' && route.query.tab === 'about') return 'О сервисе'
  if (route.path.startsWith('/lands')) {
    const landsTab = String(route.query.tab || '')
    if (landsTab === 'melioration') return 'Мелиорация'
    if (landsTab === 'rights-refs' || landsTab === 'land-refs' || landsTab === 'crops-refs' || landsTab === 'melioration-refs' || landsTab === 'equipment-refs' || landsTab === 'field-refs' || landsTab === 'crop-rotation-refs' || landsTab === 'storage-refs' || landsTab === 'storage-types' || landsTab === 'storage-statuses' || landsTab === 'storage-fill-statuses' || landsTab === 'storage-writeoff-reasons' || landsTab === 'storage-consumption-targets' || landsTab === 'storage-purposes' || landsTab === 'land-types' || landsTab === 'land-categories' || landsTab === 'land-usage') {
      return 'Справочники'
    }
  }
  return (route.meta?.title as string) || 'Обзор'
})

/** Родительский раздел для внутренних страниц — первое звено Breadcrumb в шапке. */
const breadcrumbParent = computed<{ label: string; to: string } | null>(() => {
  const map: Record<string, { label: string; to: string }> = {
    'land-details': { label: 'Земельные участки', to: '/lands' },
    'field-details': { label: 'Поля', to: '/fields' },
    'warehouse-cell': { label: 'Склады', to: '/warehouses' },
    'grain-batch': { label: 'Партии', to: '/grain/batches' },
    'equipment-details': { label: 'Техника', to: '/equipment' },
    'news-details': { label: 'Новости', to: '/news' },
    'news-edit': { label: 'Новости', to: '/news' },
  }
  return map[String(route.name ?? '')] ?? null
})

const dashboardHomeActive = computed(
  () => route.name === 'dashboard' && route.query.tab !== 'about',
)
const refsTabs = new Set(['downtime-reasons', 'work-operations'])
const isFieldsReferencesTab = computed(
  () => route.path.startsWith('/fields') && refsTabs.has(String(route.query.tab || '')),
)
const isLandsReferencesTab = computed(() => {
  if (!route.path.startsWith('/lands')) return false
  const tab = String(route.query.tab || '')
  return tab === 'rights-refs' || tab === 'land-refs' || tab === 'crops-refs' || tab === 'melioration-refs' || tab === 'equipment-refs' || tab === 'field-refs' || tab === 'crop-rotation-refs' || tab === 'storage-refs' || tab === 'storage-types' || tab === 'storage-statuses' || tab === 'storage-fill-statuses' || tab === 'storage-writeoff-reasons' || tab === 'storage-consumption-targets' || tab === 'storage-purposes' || tab === 'land-types' || tab === 'land-categories' || tab === 'land-usage'
})
const isLandsMeliorationTab = computed(
  () => route.path.startsWith('/lands') && String(route.query.tab || '') === 'melioration',
)
const landsNavActive = computed(() => route.path.startsWith('/lands') && !isLandsReferencesTab.value && !isLandsMeliorationTab.value)
const fieldsNavActive = computed(
  () => route.path.startsWith('/field-details') || (route.path.startsWith('/fields') && !isFieldsReferencesTab.value),
)
const meliorationNavActive = computed(
  () => isLandsMeliorationTab.value,
)
const storageLocationsNavActive = computed(
  () => route.path.startsWith('/warehouses/storage-locations'),
)
const warehousesNavActive = computed(
  () => route.path.startsWith('/warehouses') && !route.path.startsWith('/warehouses/storage-locations'),
)
const grainBatchesNavActive = computed(
  () => route.path.startsWith('/grain/batches'),
)
const grainJournalNavActive = computed(
  () => route.path.startsWith('/grain/journal'),
)
const grainCounterpartiesNavActive = computed(
  () => route.path.startsWith('/grain/counterparties'),
)
const landsSectionActive = computed(
  () => landsNavActive.value || fieldsNavActive.value || meliorationNavActive.value,
)
const warehousesSectionActive = computed(
  () => route.path.startsWith('/warehouses'),
)
const grainSectionActive = computed(
  () => route.path.startsWith('/grain'),
)
const settingsNavExpanded = ref(isFieldsReferencesTab.value || isLandsReferencesTab.value)
const referencesNavActive = computed(() => isFieldsReferencesTab.value || isLandsReferencesTab.value)
const landsNavExpanded = ref(
  landsNavActive.value || route.path.startsWith('/fields') || route.path.startsWith('/field-details') || isLandsMeliorationTab.value,
)
const warehousesNavExpanded = ref(
  route.path.startsWith('/warehouses'),
)
const grainNavExpanded = ref(
  route.path.startsWith('/grain'),
)

// Раздел открытой страницы раскрыт, как в Sidebar shadcn: при прямом заходе по
// ссылке маршрут известен не сразу, поэтому раскрываем по его изменению.
// Свернуть раздел вручную можно по-прежнему, другие разделы не трогаем.
watch(landsSectionActive, (on) => { if (on) landsNavExpanded.value = true }, { immediate: true })
watch(warehousesSectionActive, (on) => { if (on) warehousesNavExpanded.value = true }, { immediate: true })
watch(grainSectionActive, (on) => { if (on) grainNavExpanded.value = true }, { immediate: true })
watch(referencesNavActive, (on) => { if (on) settingsNavExpanded.value = true }, { immediate: true })

function toggleLandsNavSubmenu() {
  landsNavExpanded.value = !landsNavExpanded.value
}

function toggleSettingsNavSubmenu() {
  settingsNavExpanded.value = !settingsNavExpanded.value
}

function toggleWarehousesNavSubmenu() {
  warehousesNavExpanded.value = !warehousesNavExpanded.value
}

function toggleGrainNavSubmenu() {
  grainNavExpanded.value = !grainNavExpanded.value
}

function goDashboardHome() {
  closeMobileMenu()
  void router.push({ path: '/dashboard', query: {} })
}
const { theme, setTheme } = useTheme()
/** checked = светлая тема (Uiverse Creatlydev: солнце); не отмечено = луна / тёмная */
const themeIsLight = computed({
  get: () => theme.value === 'light',
  set: (v: boolean) => setTheme(v ? 'light' : 'dark'),
})
const logoutConfirmOpen = ref(false)
const logoutBusy = ref(false)

const userDisplay = computed(() => {
  if (auth.user.value?.email) return auth.user.value.email
  return 'Пользователь'
})
const userInitials = computed(() => {
  const email = auth.user.value?.email ?? ''
  const part = email.split('@')[0]
  if (part.length >= 2) return part.slice(0, 2).toUpperCase()
  return part.slice(0, 1).toUpperCase() || '?'
})
const userAvatarUrl = computed(() => auth.profileCache.value?.avatar_url ?? null)

/** Подгружаем профиль в кэш, чтобы аватар отображался в шапке после перезагрузки. */
async function ensureProfileInCache() {
  const u = auth.user.value
  if (!u || !isSupabaseConfigured()) return
  if (auth.profileCache.value?.id === u.id) return
  try {
    const p = await loadProfileById(u.id)
    if (p && auth.user.value?.id === u.id) auth.profileCache.value = p
  } catch {
    /* недоступность профиля не критична для шапки */
  }
}
watch(() => auth.user.value?.id, (id) => { if (id) void ensureProfileInCache() }, { immediate: true })

/** Ref из chatSupabase: в шаблоне используем computed для гарантированной размотки */
const chatUnreadDisplay = computed(() => Number(chatTotalUnread.value) || 0)
const notificationsUnread = ref(0)
const notificationsUnreadDisplay = computed(() => Number(notificationsUnread.value) || 0)

async function refreshHeaderUnreadCounters() {
  await refreshChatTotalUnread()
  try {
    notificationsUnread.value = await countMyUnreadNotifications()
  } catch (e) {
    // Счётчик в шапке вторичен: место для сообщения тут негде, но сбой
    // должен быть виден хотя бы в консоли.
    console.error('Счётчик непрочитанных уведомлений', e)
    notificationsUnread.value = 0
  }
}

async function handleLogout() {
  logoutConfirmOpen.value = true
}

async function confirmLogout() {
  if (logoutBusy.value) return
  logoutBusy.value = true
  try {
    await auth.logout()
    logoutConfirmOpen.value = false
    router.push('/login')
  } finally {
    logoutBusy.value = false
  }
}

function closeLogoutConfirm() {
  if (logoutBusy.value) return
  logoutConfirmOpen.value = false
}

const mobileMenuOpen = ref(false)
function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}
function closeMobileMenu() {
  mobileMenuOpen.value = false
}
watch(route, closeMobileMenu)
watch(mobileMenuOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

let unreadPoll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void backendHealth.check()
  void refreshHeaderUnreadCounters()
  unreadPoll = setInterval(() => void refreshHeaderUnreadCounters(), 45_000)
})
onUnmounted(() => {
  if (unreadPoll) clearInterval(unreadPoll)
})
watch(
  () => route.path,
  () => void refreshHeaderUnreadCounters(),
)

/** Редкий пинг last_activity_at (не чаще ~5 мин), только вне экрана входа */
watch(
  [() => auth.user.value?.id, isAuthLayout],
  ([uid, authLayout]) => {
    stopActivityHeartbeat()
    if (uid && !authLayout) startActivityHeartbeat(uid)
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="isAuthLayout" class="app-auth-shell">
    <RouterView />
    <AppBackendModal
      v-if="showAuthBackendModal"
      :message="backendBannerMessage"
      :checking="backendHealth.isChecking.value"
      @retry="void backendHealth.check(true)"
      @close="backendModalDismissed = true"
    />
  </div>

  <SidebarProvider v-else class="app-layout-shell">
    <Transition name="fade">
      <AppBackendBadge
        v-if="showBackendBadge"
        :checking="backendHealth.isChecking.value"
        @retry="void backendHealth.check(true)"
      />
    </Transition>
    <AppSidebar
      :chat-unread="chatUnreadDisplay"
      :notifications-unread="notificationsUnreadDisplay"
      :user-name="userDisplay"
      :user-email="auth.user.value?.email ?? null"
      :user-initials="userInitials"
      :user-avatar-url="userAvatarUrl"
      @logout="handleLogout"
    />
    <UiConfirmModal
      v-if="logoutConfirmOpen"
      title="Выйти из аккаунта?"
      text="Вы действительно хотите выйти? Несохранённые изменения могут быть потеряны."
      confirm-label="Выйти"
      busy-label="Выход…"
      :busy="logoutBusy"
      @cancel="closeLogoutConfirm"
      @confirm="confirmLogout"
    />
    <SidebarInset class="main-content">
      <header class="app-topbar">
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="app-topbar-sep" />
        <Breadcrumb v-if="breadcrumbParent" class="min-w-0">
          <BreadcrumbList>
            <BreadcrumbItem class="hidden sm:inline-flex">
              <BreadcrumbLink as-child>
                <RouterLink :to="breadcrumbParent.to">{{ breadcrumbParent.label }}</RouterLink>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator class="hidden sm:inline-flex" />
            <BreadcrumbItem>
              <BreadcrumbPage class="truncate font-semibold">{{ pageTitle }}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 v-else class="app-topbar-title">{{ pageTitle }}</h1>
        <div class="app-topbar-right">
          <Button
            variant="ghost"
            size="icon"
            :aria-label="theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'"
            :title="theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'"
            @click="setTheme(theme === 'dark' ? 'light' : 'dark')"
          >
            <SunIcon v-if="theme === 'dark'" />
            <MoonIcon v-else />
          </Button>
        </div>
      </header>
      <div class="main-content-inner main-content-inner--animated">
        <div v-if="showAuthBootstrapLoading" class="app-content-bootstrap" role="status" aria-live="polite">
          <UiLoadingBar label="ПОДКЛЮЧЕНИЕ" />
          <p class="app-content-bootstrap__text">Проверяем сессию и связь с сервером…</p>
        </div>
        <template v-else>
          <RouterView v-slot="{ Component }">
            <Transition name="page" mode="out-in">
              <component v-if="Component" :is="Component" :key="$route.fullPath" />
            </Transition>
          </RouterView>
        </template>
      </div>
    </SidebarInset>
  </SidebarProvider>
  <Toaster position="top-center" />
  <UiPromptHost />
</template>

<style scoped>
@layer legacy {
.app-auth-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-auth-shell__banner {
  margin: var(--space-md) var(--space-lg) 0;
  max-width: 520px;
  width: calc(100% - 2 * var(--space-lg));
  align-self: center;
}

.app-content-bootstrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  min-height: min(420px, 50vh);
  padding: var(--space-xl) var(--space-lg);
}

.app-content-bootstrap__text {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  text-align: center;
}

.app-modal-backdrop {
  z-index: 2000;
  padding: 20px;
}

.app-modal {
  width: 100%;
  max-width: 520px;
  border-radius: 20px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

[data-theme='dark'] .app-modal {
  background: var(--bg-elevated);
  border-color: var(--border-color);
}

.app-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border-color);
}

.app-modal-title {
  font-weight: 800;
  color: var(--text-primary);
  font-size: 1.05rem;
}

.app-modal-body {
  padding: 18px 20px;
}

.app-modal-text {
  color: var(--text-secondary);
  font-size: 0.9375rem;
  line-height: 1.4;
}

.app-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-overlay);
}

.app-modal-btn {
  border-radius: 12px;
  padding: 11px 18px;
  font-size: 0.9375rem;
  font-weight: 650;
  border: 1px solid transparent;
  cursor: pointer;
}
.app-modal-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.app-modal-btn--ghost {
  background: var(--bg-elevated);
  border-color: var(--border-color);
  color: var(--text-primary);
}
.app-modal-btn--danger {
  background: var(--danger-red);
  color: #fff;
}
.app-modal-btn--danger:hover:not(:disabled) {
  filter: brightness(1.05);
}

/* Переключатель темы (Uiverse / Creatlydev) */
.app-theme-cd-wrap {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.app-theme-cd-toggle {
  /* ~−24% от 56px (−30% затем +8%); фон как у шапки */
  background-color: transparent;
  width: calc(56px * 0.7 * 1.08);
  height: calc(56px * 0.7 * 1.08);
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: none;
  line-height: 1;
  margin: 0;
  color: var(--text-secondary);
  border: 1px solid transparent;
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

.app-theme-cd-toggle:hover {
  background: transparent;
  color: var(--text-primary);
  border-color: transparent;
}

[data-theme='dark'] .app-theme-cd-toggle {
  background-color: transparent;
  color: rgba(255, 255, 255, 0.75);
  box-shadow: none;
}

[data-theme='dark'] .app-theme-cd-toggle:hover {
  background: transparent;
  color: #fff;
  border-color: transparent;
}

.app-theme-cd-input {
  display: none;
}

.app-theme-cd-toggle:has(.app-theme-cd-input:focus-visible) {
  outline: 2px solid var(--focus-ring);
  outline-offset: calc(3px * 0.7 * 1.08);
}

.app-theme-cd-icon {
  grid-column: 1 / 1;
  grid-row: 1 / 1;
  transition: transform 400ms;
  line-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-theme-cd-icon svg {
  width: calc(32px * 0.7 * 1.08);
  height: calc(32px * 0.7 * 1.08);
}

.app-theme-cd-icon--moon {
  transition-delay: 160ms;
}

.app-theme-cd-icon--sun {
  transform: scale(0);
  color: var(--corn-yellow);
}

.app-theme-cd-input:checked + .app-theme-cd-icon--moon {
  transform: rotate(360deg) scale(0);
}

.app-theme-cd-input:checked ~ .app-theme-cd-icon--sun {
  transition-delay: 160ms;
  transform: scale(1) rotate(360deg);
}
}
</style>

