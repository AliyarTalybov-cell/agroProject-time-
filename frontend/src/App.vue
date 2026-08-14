<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from '@/composables/useTheme'
import { useAuth } from '@/stores/auth'
import { useBackendHealth } from '@/stores/backendHealth'
import AppBackendBadge from '@/components/AppBackendBadge.vue'
import AppBackendModal from '@/components/AppBackendModal.vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import NavStatusHint from '@/components/NavStatusHint.vue'
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
    if (landsTab === 'rights-refs' || landsTab === 'land-refs' || landsTab === 'crops-refs' || landsTab === 'melioration-refs' || landsTab === 'equipment-refs' || landsTab === 'field-refs' || landsTab === 'crop-rotation-refs' || landsTab === 'storage-refs' || landsTab === 'storage-types' || landsTab === 'storage-statuses' || landsTab === 'storage-fill-statuses' || landsTab === 'land-types' || landsTab === 'land-categories' || landsTab === 'land-usage') {
      return 'Справочники'
    }
  }
  return (route.meta?.title as string) || 'Обзор'
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
  return tab === 'rights-refs' || tab === 'land-refs' || tab === 'crops-refs' || tab === 'melioration-refs' || tab === 'equipment-refs' || tab === 'field-refs' || tab === 'crop-rotation-refs' || tab === 'storage-refs' || tab === 'storage-types' || tab === 'storage-statuses' || tab === 'storage-fill-statuses' || tab === 'land-types' || tab === 'land-categories' || tab === 'land-usage'
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
const grainCurrentNavActive = computed(
  () => route.path.startsWith('/grain/current'),
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
  } catch {
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

  <div v-else class="app-layout" :class="{ 'mobile-menu-open': mobileMenuOpen }">
    <Transition name="fade">
      <AppBackendBadge
        v-if="showBackendBadge"
        :checking="backendHealth.isChecking.value"
        @retry="void backendHealth.check(true)"
      />
    </Transition>
    <div class="sidebar-overlay" aria-hidden="true" @click="closeMobileMenu"></div>
    <aside class="sidebar">
      <div class="sidebar-brand">
        <RouterLink
          class="sidebar-brand-link"
          :to="{ path: '/dashboard', query: {} }"
          data-text="АГРОСИСТЕМА"
          aria-label="АГРОСИСТЕМА"
        >
          <span class="sidebar-brand-title-wrap">
            <span class="actual-text"><span>АГРО</span><span class="actual-text-accent">СИСТЕМА</span></span>
            <span aria-hidden="true" class="hover-text"><span>АГРО</span><span>СИСТЕМА</span></span>
          </span>
        </RouterLink>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section">
          <ul class="nav-menu">
            <li>
              <a
                href="/dashboard"
                class="nav-item"
                :class="{ 'router-link-active': dashboardHomeActive }"
                @click.prevent="goDashboardHome"
              >
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
                </span>
                Обзор
              </a>
            </li>
            <li>
              <RouterLink class="nav-item" to="/news">
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14l-4-2-4 2-4-2-4 2z"/><path d="M8 8h8"/><path d="M8 12h8"/></svg>
                </span>
                Новости
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/weather">
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
                </span>
                Погода
              </RouterLink>
            </li>
            <li class="nav-item-group" :class="{ 'nav-item-group--open': landsNavExpanded }">
              <button
                type="button"
                class="nav-item nav-item--group-toggle"
                :aria-expanded="landsNavExpanded"
                @click="toggleLandsNavSubmenu"
              >
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7l8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
                </span>
                <span class="nav-item-label">Земли</span>
                <svg class="nav-group-chevron" :class="{ 'is-open': landsNavExpanded, 'is-active': landsSectionActive }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <ul class="nav-submenu">
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': landsNavActive }" active-class="" exact-active-class="" to="/lands">
                    <span class="nav-item-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>
                    </span>
                    Земельные участки
                  </RouterLink>
                </li>
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': fieldsNavActive }" to="/fields">
                    <span class="nav-item-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                    </span>
                    Поля
                  </RouterLink>
                </li>
                <li>
                  <RouterLink
                    class="nav-item nav-item--sub"
                    :class="{ 'router-link-active': meliorationNavActive }"
                    active-class=""
                    exact-active-class=""
                    :to="{ path: '/lands', query: { tab: 'melioration' } }"
                  >
                    <span class="nav-item-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M7 21v-7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v7"/><path d="M12 11V3"/><path d="m8 7 4-4 4 4"/></svg>
                    </span>
                    Мелиорация
                  </RouterLink>
                </li>
              </ul>
            </li>
            <li class="nav-item-group" :class="{ 'nav-item-group--open': warehousesNavExpanded }">
              <button
                type="button"
                class="nav-item nav-item--group-toggle"
                :aria-expanded="warehousesNavExpanded"
                @click="toggleWarehousesNavSubmenu"
              >
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 10.5 12 4l9 6.5" />
                    <path d="M5 9.5V20h14V9.5" />
                    <path d="M9 20v-5h6v5" />
                  </svg>
                </span>
                <span class="nav-item-label">Склады</span>
                <NavStatusHint text="Раздел «Склады» ещё не завершён — функционал и логика будут дорабатываться." />
                <svg class="nav-group-chevron" :class="{ 'is-open': warehousesNavExpanded, 'is-active': warehousesSectionActive }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <ul class="nav-submenu">
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': warehousesNavActive }" active-class="" exact-active-class="" to="/warehouses">
                    <span class="nav-item-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                    </span>
                    Карточки складов
                  </RouterLink>
                </li>
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': storageLocationsNavActive }" to="/warehouses/storage-locations">
                    <span class="nav-item-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 7h18" />
                        <path d="M5 7v13h14V7" />
                        <path d="M9 11h6" />
                      </svg>
                    </span>
                    Места хранения
                  </RouterLink>
                </li>
              </ul>
            </li>
            <li class="nav-item-group" :class="{ 'nav-item-group--open': grainNavExpanded }">
              <button
                type="button"
                class="nav-item nav-item--group-toggle"
                :aria-expanded="grainNavExpanded"
                @click="toggleGrainNavSubmenu"
              >
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22V8" />
                    <path d="M12 8c0-2.5-1.5-4-4-4 0 2.5 1.5 4 4 4Z" />
                    <path d="M12 8c0-2.5 1.5-4 4-4 0 2.5-1.5 4-4 4Z" />
                    <path d="M12 14c0-2.5-1.5-4-4-4 0 2.5 1.5 4 4 4Z" />
                    <path d="M12 14c0-2.5 1.5-4 4-4 0 2.5-1.5 4-4 4Z" />
                  </svg>
                </span>
                <span class="nav-item-label">Учёт зерна</span>
                <NavStatusHint text="Раздел «Учёт зерна» ещё не завершён — функционал и логика будут дорабатываться." />
                <svg class="nav-group-chevron" :class="{ 'is-open': grainNavExpanded, 'is-active': grainSectionActive }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <ul class="nav-submenu">
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': grainBatchesNavActive }" to="/grain/batches">
                    <span class="nav-item-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <path d="M7 8h10M7 12h10M7 16h6" />
                      </svg>
                    </span>
                    Реестр партий
                  </RouterLink>
                </li>
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': grainCurrentNavActive }" to="/grain/current">
                    <span class="nav-item-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 2 2 7l10 5 10-5-10-5Z" />
                        <path d="m2 17 10 5 10-5" />
                        <path d="m2 12 10 5 10-5" />
                      </svg>
                    </span>
                    Текущие партии
                  </RouterLink>
                </li>
              </ul>
            </li>
            <li>
              <RouterLink class="nav-item" to="/equipment">
                <span class="nav-item-icon nav-item-icon--equipment" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 15a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/>
                    <path d="M7 15l0 .01"/>
                    <path d="M17 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/>
                    <path d="M10.5 17l6.5 0"/>
                    <path d="M20 15.2v-4.2a1 1 0 0 0 -1 -1h-6l-2 -5h-6v6.5"/>
                    <path d="M18 5h-1a1 1 0 0 0 -1 1v4"/>
                  </svg>
                </span>
                Техника
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/task-management">
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                </span>
                Задачи
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/tasks">
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                </span>
                Календарь
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/reports">
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
                </span>
                Аналитика
              </RouterLink>
            </li>
          </ul>
        </div>

        <div class="nav-section nav-section-secondary">
          <div class="nav-section-label">ОПЕРАЦИИ</div>
          <ul class="nav-menu">
            <li>
              <RouterLink class="nav-item" to="/mechanic">
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
                </span>
                Экран оператора
              </RouterLink>
            </li>
          </ul>
        </div>

        <div class="nav-section nav-section-secondary">
          <div class="nav-section-label">СВЯЗЬ</div>
          <ul class="nav-menu">
            <li>
              <RouterLink class="nav-item" to="/employees">
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </span>
                Сотрудники
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/notifications">
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V10a6 6 0 1 0-12 0v4.2c0 .53-.21 1.04-.59 1.42L4 17h5"/>
                    <path d="M9 17a3 3 0 0 0 6 0"/>
                  </svg>
                </span>
                Уведомления
                <span v-if="notificationsUnreadDisplay > 0" class="nav-item-badge">{{ notificationsUnreadDisplay > 99 ? '99+' : notificationsUnreadDisplay }}</span>
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/chat">
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </span>
                Чат
                <span v-if="chatUnreadDisplay > 0" class="nav-item-badge">{{ chatUnreadDisplay > 99 ? '99+' : chatUnreadDisplay }}</span>
              </RouterLink>
            </li>
          </ul>
        </div>

        <div class="nav-section nav-section-secondary">
          <div class="nav-section-label">НАСТРОЙКИ</div>
          <ul class="nav-menu">
            <li class="nav-item-group" :class="{ 'nav-item-group--open': settingsNavExpanded }">
              <button
                type="button"
                class="nav-item nav-item--group-toggle"
                :aria-expanded="settingsNavExpanded"
                @click="toggleSettingsNavSubmenu"
              >
                <span class="nav-item-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.55 1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 8.4a1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.6a1.7 1.7 0 0 0 1.03-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.33 1.82 1.7 1.7 0 0 0 1.55 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1.03Z"/></svg>
                </span>
                <span class="nav-item-label">Настройки</span>
                <svg class="nav-group-chevron" :class="{ 'is-open': settingsNavExpanded, 'is-active': referencesNavActive }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <ul class="nav-submenu">
                <li>
                  <RouterLink
                    class="nav-item nav-item--sub"
                    :class="{ 'router-link-active': referencesNavActive }"
                    active-class=""
                    exact-active-class=""
                    :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
                  >
                    <span class="nav-item-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h6"/><path d="M12 9v6"/><path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/></svg>
                    </span>
                    Справочники
                  </RouterLink>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </nav>

      <footer class="sidebar-footer">
        <button type="button" class="app-logout-btn" aria-label="Выйти из аккаунта" @click="handleLogout">
          <span class="app-logout-sign">
            <svg viewBox="0 0 512 512" aria-hidden="true">
              <path
                d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1-128 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l128 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z"
              />
            </svg>
          </span>
          <span class="app-logout-text">Выйти</span>
        </button>
      </footer>
    </aside>

    <teleport to="body">
      <div v-if="logoutConfirmOpen" class="app-modal-backdrop" role="dialog" aria-modal="true" aria-label="Подтверждение выхода" @click.self="closeLogoutConfirm">
        <div class="app-modal" @click.stop>
          <div class="app-modal-header">
            <div class="app-modal-title">Выйти из аккаунта?</div>
            <ModalCloseButton :disabled="logoutBusy" @click="closeLogoutConfirm" />
          </div>
          <div class="app-modal-body">
            <div class="app-modal-text">Вы действительно хотите выйти? Несохранённые изменения могут быть потеряны.</div>
          </div>
          <div class="app-modal-footer">
            <button type="button" class="app-modal-btn app-modal-btn--ghost" :disabled="logoutBusy" @click="closeLogoutConfirm">Отмена</button>
            <button type="button" class="app-modal-btn app-modal-btn--danger" :disabled="logoutBusy" @click="confirmLogout">
              {{ logoutBusy ? 'Выход…' : 'Выйти' }}
            </button>
          </div>
        </div>
      </div>
    </teleport>

    <main class="main-content">
      <header class="app-topbar">
        <button type="button" class="topbar-menu-btn" aria-label="Меню" @click="toggleMobileMenu">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
        </button>
        <h1 class="app-topbar-title">{{ pageTitle }}</h1>
        <div class="app-topbar-right">
          <div class="app-theme-cd-wrap">
            <label
              for="app-theme-cd-switch"
              class="app-theme-cd-toggle"
              :title="theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'"
            >
              <input
                id="app-theme-cd-switch"
                v-model="themeIsLight"
                type="checkbox"
                class="app-theme-cd-input"
                role="switch"
                :aria-checked="themeIsLight"
                :aria-label="theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'"
              />
              <div class="app-theme-cd-icon app-theme-cd-icon--moon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                  <path
                    fill-rule="evenodd"
                    d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
              <div class="app-theme-cd-icon app-theme-cd-icon--sun" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                  <path
                    d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z"
                  />
                </svg>
              </div>
            </label>
          </div>
          <div class="topbar-user">
            <RouterLink to="/profile" class="topbar-user-link" aria-label="Настройки профиля">
              <div class="topbar-user-avatar">
                <img v-if="userAvatarUrl" :src="userAvatarUrl" alt="" class="topbar-user-avatar-img" />
                <template v-else>{{ userInitials }}</template>
              </div>
              <div class="topbar-user-meta">
                <span class="topbar-user-name">{{ userDisplay }}</span>
              </div>
            </RouterLink>
          </div>
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
    </main>
  </div>
</template>

<style scoped>
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
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: var(--modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
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

</style>

