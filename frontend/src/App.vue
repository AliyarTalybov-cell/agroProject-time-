<script setup lang="ts">
import { ArchiveIcon, BellIcon, BookMarkedIcon, BoxesIcon, CalendarIcon, ChevronDownIcon, CloudIcon, DropletsIcon, FileTextIcon, HomeIcon, LayoutDashboardIcon, LayoutGridIcon, LogOutIcon, MapIcon, MenuIcon, MessageCircleIcon, MonitorIcon, NewspaperIcon, PackageIcon, ScrollTextIcon, SettingsIcon, SquareCheckBigIcon, TractorIcon, UsersIcon, WarehouseIcon, WheatIcon } from '@lucide/vue'
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
                  <LayoutDashboardIcon />
                </span>
                Обзор
              </a>
            </li>
            <li>
              <RouterLink class="nav-item" to="/news">
                <span class="nav-item-icon" aria-hidden="true">
                  <NewspaperIcon />
                </span>
                Новости
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/weather">
                <span class="nav-item-icon" aria-hidden="true">
                  <CloudIcon />
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
                  <PackageIcon />
                </span>
                <span class="nav-item-label">Земли</span>
                <ChevronDownIcon class="nav-group-chevron" :class="{ 'is-open': landsNavExpanded, 'is-active': landsSectionActive }" aria-hidden="true" :stroke-width="2.6" />
              </button>
              <ul class="nav-submenu">
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': landsNavActive }" active-class="" exact-active-class="" to="/lands">
                    <span class="nav-item-icon" aria-hidden="true">
                      <MapIcon />
                    </span>
                    Земельные участки
                  </RouterLink>
                </li>
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': fieldsNavActive }" to="/fields">
                    <span class="nav-item-icon" aria-hidden="true">
                      <HomeIcon />
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
                      <DropletsIcon />
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
                  <WarehouseIcon />
                </span>
                <span class="nav-item-label">Склады</span>
                <ChevronDownIcon class="nav-group-chevron" :class="{ 'is-open': warehousesNavExpanded, 'is-active': warehousesSectionActive }" aria-hidden="true" :stroke-width="2.6" />
              </button>
              <ul class="nav-submenu">
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': warehousesNavActive }" active-class="" exact-active-class="" to="/warehouses">
                    <span class="nav-item-icon" aria-hidden="true">
                      <LayoutGridIcon />
                    </span>
                    Карточки складов
                  </RouterLink>
                </li>
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': storageLocationsNavActive }" to="/warehouses/storage-locations">
                    <span class="nav-item-icon" aria-hidden="true">
                      <ArchiveIcon />
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
                  <WheatIcon />
                </span>
                <span class="nav-item-label">Учёт зерна</span>
                <ChevronDownIcon class="nav-group-chevron" :class="{ 'is-open': grainNavExpanded, 'is-active': grainSectionActive }" aria-hidden="true" :stroke-width="2.6" />
              </button>
              <ul class="nav-submenu">
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': grainBatchesNavActive }" to="/grain/batches">
                    <span class="nav-item-icon" aria-hidden="true">
                      <BoxesIcon />
                    </span>
                    Партии
                  </RouterLink>
                </li>
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': grainJournalNavActive }" to="/grain/journal">
                    <span class="nav-item-icon" aria-hidden="true">
                      <ScrollTextIcon />
                    </span>
                    Журнал операций
                  </RouterLink>
                </li>
                <li>
                  <RouterLink class="nav-item nav-item--sub" :class="{ 'router-link-active': grainCounterpartiesNavActive }" to="/grain/counterparties">
                    <span class="nav-item-icon" aria-hidden="true">
                      <UsersIcon />
                    </span>
                    Контрагенты
                  </RouterLink>
                </li>
              </ul>
            </li>
            <li>
              <RouterLink class="nav-item" to="/equipment">
                <span class="nav-item-icon nav-item-icon--equipment" aria-hidden="true">
                  <TractorIcon />
                </span>
                Техника
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/task-management">
                <span class="nav-item-icon" aria-hidden="true">
                  <SquareCheckBigIcon />
                </span>
                Задачи
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/tasks">
                <span class="nav-item-icon" aria-hidden="true">
                  <CalendarIcon />
                </span>
                Календарь
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/reports">
                <span class="nav-item-icon" aria-hidden="true">
                  <FileTextIcon />
                </span>
                Аналитика
              </RouterLink>
            </li>
          </ul>
        </div>

        <div class="nav-section nav-section-secondary">
          <div class="nav-section-label">Операции</div>
          <ul class="nav-menu">
            <li>
              <RouterLink class="nav-item" to="/mechanic">
                <span class="nav-item-icon" aria-hidden="true">
                  <MonitorIcon />
                </span>
                Экран оператора
              </RouterLink>
            </li>
          </ul>
        </div>

        <div class="nav-section nav-section-secondary">
          <div class="nav-section-label">Связь</div>
          <ul class="nav-menu">
            <li>
              <RouterLink class="nav-item" to="/employees">
                <span class="nav-item-icon" aria-hidden="true">
                  <UsersIcon />
                </span>
                Сотрудники
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/notifications">
                <span class="nav-item-icon" aria-hidden="true">
                  <BellIcon />
                </span>
                Уведомления
                <span v-if="notificationsUnreadDisplay > 0" class="nav-item-badge">{{ notificationsUnreadDisplay > 99 ? '99+' : notificationsUnreadDisplay }}</span>
              </RouterLink>
            </li>
            <li>
              <RouterLink class="nav-item" to="/chat">
                <span class="nav-item-icon" aria-hidden="true">
                  <MessageCircleIcon />
                </span>
                Чат
                <span v-if="chatUnreadDisplay > 0" class="nav-item-badge">{{ chatUnreadDisplay > 99 ? '99+' : chatUnreadDisplay }}</span>
              </RouterLink>
            </li>
          </ul>
        </div>

        <div class="nav-section nav-section-secondary">
          <div class="nav-section-label">Настройки</div>
          <ul class="nav-menu">
            <li class="nav-item-group" :class="{ 'nav-item-group--open': settingsNavExpanded }">
              <button
                type="button"
                class="nav-item nav-item--group-toggle"
                :aria-expanded="settingsNavExpanded"
                @click="toggleSettingsNavSubmenu"
              >
                <span class="nav-item-icon" aria-hidden="true">
                  <SettingsIcon />
                </span>
                <span class="nav-item-label">Настройки</span>
                <ChevronDownIcon class="nav-group-chevron" :class="{ 'is-open': settingsNavExpanded, 'is-active': referencesNavActive }" aria-hidden="true" :stroke-width="2.6" />
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
                      <BookMarkedIcon />
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
            <LogOutIcon aria-hidden="true" />
          </span>
          <span class="app-logout-text">Выйти</span>
        </button>
      </footer>
    </aside>

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

    <main class="main-content">
      <header class="app-topbar">
        <button type="button" class="topbar-menu-btn" aria-label="Меню" @click="toggleMobileMenu">
          <MenuIcon :size="24" />
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
  <Toaster position="top-center" />
  <UiPromptHost />
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

</style>

