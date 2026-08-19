import { createRouter, createWebHistory } from 'vue-router'

import { AUTH_INIT_TIMEOUT_MS, getAuthUser, getUserRole, isAuthLoading } from '@/stores/auth'
import { isSupabaseConfigured } from '@/lib/supabase'

// Страницы подключаются динамическим import(): Vite выносит каждую в
// отдельный чанк, и при входе на портал не грузятся все 25 разделов сразу.
// Роутер дожидается загрузки чанка до смены маршрута, поэтому RouterView
// в App.vue получает уже готовый компонент — Suspense не нужен.
const DashboardPage = () => import('@/pages/DashboardPage.vue')
const FieldDetailsPage = () => import('@/pages/FieldDetailsPage.vue')
const FieldsPage = () => import('@/pages/FieldsPage.vue')
const LandsPage = () => import('@/pages/LandsPage.vue')
const LoginPage = () => import('@/pages/LoginPage.vue')
const ReportsPage = () => import('@/pages/ReportsPage.vue')
const TasksPage = () => import('@/pages/TasksPage.vue')
const TaskManagementPage = () => import('@/pages/TaskManagementPage.vue')
const MechanicPage = () => import('@/pages/MechanicPage.vue')
const WeatherPage = () => import('@/pages/WeatherPage.vue')
const EquipmentPage = () => import('@/pages/EquipmentPage.vue')
const EquipmentDetailsPage = () => import('@/pages/EquipmentDetailsPage.vue')
const WarehousesPage = () => import('@/pages/WarehousesPage.vue')
const WarehouseCellPage = () => import('@/pages/WarehouseCellPage.vue')
const StorageLocationsPage = () => import('@/pages/StorageLocationsPage.vue')
const WarehouseBatchRegistryPage = () => import('@/pages/WarehouseBatchRegistryPage.vue')
const GrainAccountingPage = () => import('@/pages/GrainAccountingPage.vue')
const ProfilePage = () => import('@/pages/ProfilePage.vue')
const EmployeesPage = () => import('@/pages/EmployeesPage.vue')
const ChatPage = () => import('@/pages/ChatPage.vue')
const PortalRulesPage = () => import('@/pages/PortalRulesPage.vue')
const NotificationsPage = () => import('@/pages/NotificationsPage.vue')
const NewsPage = () => import('@/pages/NewsPage.vue')
const NewsDetailsPage = () => import('@/pages/NewsDetailsPage.vue')
const NewsEditorPage = () => import('@/pages/NewsEditorPage.vue')

export const routes = [
  { path: '/', redirect: '/news' },
  { path: '/login', name: 'login', component: LoginPage, meta: { title: 'Вход', public: true } },
  { path: '/rules', name: 'rules', component: PortalRulesPage, meta: { title: 'Правила портала', public: true, allowWhenAuth: true } },
  { path: '/dashboard', name: 'dashboard', component: DashboardPage, meta: { title: 'Обзор' } },
  { path: '/weather', name: 'weather', component: WeatherPage, meta: { title: 'Погода и условия' } },
  { path: '/lands', name: 'lands', component: LandsPage, meta: { title: 'Земли' } },
  { path: '/lands/:id', name: 'land-details', component: LandsPage, props: true, meta: { title: 'Земельный участок' } },
  { path: '/fields', name: 'fields', component: FieldsPage, meta: { title: 'Поля и Культуры' } },
  { path: '/fields/:id', name: 'field-details', component: FieldDetailsPage, props: true, meta: { title: 'Поле' } },
  { path: '/warehouses', name: 'warehouses', component: WarehousesPage, meta: { title: 'Склады' } },
  { path: '/warehouses/storage-locations', name: 'storage-locations', component: StorageLocationsPage, meta: { title: 'Места хранения' } },
  { path: '/warehouses/batches', redirect: '/grain/batches' },
  { path: '/warehouses/:id', name: 'warehouse-cell', component: WarehouseCellPage, props: true, meta: { title: 'Карточка склада' } },
  { path: '/grain', redirect: '/grain/batches' },
  { path: '/grain/batches', name: 'grain-batches', component: WarehouseBatchRegistryPage, meta: { title: 'Реестр партий' } },
  { path: '/grain/current', name: 'grain-current', component: GrainAccountingPage, meta: { title: 'Текущие партии' } },
  { path: '/grain-batches', redirect: '/grain/batches' },
  { path: '/grain-transfers', redirect: '/warehouses' },
  { path: '/grain-writeoffs', redirect: '/warehouses' },
  { path: '/equipment', name: 'equipment', component: EquipmentPage, meta: { title: 'Управление техникой' } },
  { path: '/equipment/:id', name: 'equipment-details', component: EquipmentDetailsPage, props: true, meta: { title: 'Техника' } },
  { path: '/tasks', name: 'tasks', component: TasksPage, meta: { title: 'Календарь' } },
  { path: '/task-management', name: 'task-management', component: TaskManagementPage, meta: { title: 'Задачи' } },
  { path: '/mechanic', name: 'mechanic', component: MechanicPage, meta: { title: 'Экран оператора' } },
  { path: '/reports', name: 'reports', component: ReportsPage, meta: { title: 'Аналитика' } },
  { path: '/profile', name: 'profile', component: ProfilePage, meta: { title: 'Настройки профиля' } },
  { path: '/employees', name: 'employees', component: EmployeesPage, meta: { title: 'Сотрудники' } },
  { path: '/notifications', name: 'notifications', component: NotificationsPage, meta: { title: 'Уведомления' } },
  { path: '/chat', name: 'chat', component: ChatPage, meta: { title: 'Сообщения' } },
  { path: '/news', name: 'news', component: NewsPage, meta: { title: 'Новости' } },
  { path: '/news/new', name: 'news-new', component: NewsEditorPage, meta: { title: 'Новая новость', managerOnly: true } },
  { path: '/news/:id', name: 'news-details', component: NewsDetailsPage, props: true, meta: { title: 'Новость' } },
  { path: '/news/:id/edit', name: 'news-edit', component: NewsEditorPage, props: true, meta: { title: 'Редактировать новость', managerOnly: true } },
  { path: '/about', redirect: { name: 'dashboard', query: { tab: 'about' } } },
] as const

export const router = createRouter({
  history: createWebHistory(),
  routes: routes as unknown as any,
})

router.beforeEach(async (to) => {
  if (!isSupabaseConfigured()) return true
  let waited = 0
  const authWaitLimit = AUTH_INIT_TIMEOUT_MS + 500
  while (isAuthLoading() && waited < authWaitLimit) {
    await new Promise((r) => setTimeout(r, 50))
    waited += 50
  }
  const user = getAuthUser()
  if (to.meta.public && user && !to.meta.allowWhenAuth) return { name: 'dashboard' }
  if (!to.meta.public && !user) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.managerOnly) {
    // Роль берётся из profiles (см. stores/auth.ts), а не из user_metadata:
    // то поле пользователь редактирует сам.
    if (getUserRole() !== 'manager') return { name: 'dashboard' }
  }
  return true
})

// После деплоя старые чанки исчезают с сервера, и открытая вкладка получает
// на переходе ошибку загрузки модуля вместо страницы. Перезагружаем вкладку
// один раз на нужный адрес: повторной петли не будет, потому что после
// reload грузится уже свежий index.html со ссылками на новые чанки.
const CHUNK_RELOAD_KEY = 'agro:chunk-reload'

router.onError((error, to) => {
  const message = error instanceof Error ? error.message : String(error)
  const isChunkLoadError = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message)
  if (!isChunkLoadError) return
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === to.fullPath) return
  sessionStorage.setItem(CHUNK_RELOAD_KEY, to.fullPath)
  window.location.assign(to.fullPath)
})

router.afterEach(() => {
  sessionStorage.removeItem(CHUNK_RELOAD_KEY)
})
