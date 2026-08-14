import { createRouter, createWebHistory } from 'vue-router'

import DashboardPage from '@/pages/DashboardPage.vue'
import FieldDetailsPage from '@/pages/FieldDetailsPage.vue'
import FieldsPage from '@/pages/FieldsPage.vue'
import LandsPage from '@/pages/LandsPage.vue'
import LoginPage from '@/pages/LoginPage.vue'
import ReportsPage from '@/pages/ReportsPage.vue'
import TasksPage from '@/pages/TasksPage.vue'
import TaskManagementPage from '@/pages/TaskManagementPage.vue'
import MechanicPage from '@/pages/MechanicPage.vue'
import WeatherPage from '@/pages/WeatherPage.vue'
import EquipmentPage from '@/pages/EquipmentPage.vue'
import EquipmentDetailsPage from '@/pages/EquipmentDetailsPage.vue'
import WarehousesPage from '@/pages/WarehousesPage.vue'
import WarehouseCellPage from '@/pages/WarehouseCellPage.vue'
import StorageLocationsPage from '@/pages/StorageLocationsPage.vue'
import WarehouseBatchRegistryPage from '@/pages/WarehouseBatchRegistryPage.vue'
import GrainAccountingPage from '@/pages/GrainAccountingPage.vue'
import ProfilePage from '@/pages/ProfilePage.vue'
import EmployeesPage from '@/pages/EmployeesPage.vue'
import ChatPage from '@/pages/ChatPage.vue'
import PortalRulesPage from '@/pages/PortalRulesPage.vue'
import NotificationsPage from '@/pages/NotificationsPage.vue'
import NewsPage from '@/pages/NewsPage.vue'
import NewsDetailsPage from '@/pages/NewsDetailsPage.vue'
import NewsEditorPage from '@/pages/NewsEditorPage.vue'
import { AUTH_INIT_TIMEOUT_MS, getAuthUser, isAuthLoading } from '@/stores/auth'
import { isSupabaseConfigured } from '@/lib/supabase'

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
    const role = (user?.user_metadata as { role?: string } | undefined)?.role
    if (role !== 'manager') return { name: 'dashboard' }
  }
  return true
})

