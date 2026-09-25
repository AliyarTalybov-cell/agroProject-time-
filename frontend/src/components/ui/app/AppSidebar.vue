<script setup lang="ts">
/**
 * Боковое меню портала — Sidebar из shadcn-vue (collapsible="icon"):
 * группы с подписями, раскрывающиеся разделы (Collapsible + SidebarMenuSub),
 * счётчики непрочитанного (SidebarMenuBadge), внизу — пользователь с меню
 * «Профиль / Выйти» (DropdownMenu). На телефоне меню открывается как Sheet.
 *
 * Пункты и их порядок — прежние (ui-navigation-consistency.mdc).
 */
import { computed, reactive, ref, watch, type Component } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import {
  ArchiveIcon,
  BellIcon,
  BookMarkedIcon,
  BoxesIcon,
  CalendarIcon,
  ChartColumnIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  CloudIcon,
  DropletsIcon,
  LandPlotIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  LogOutIcon,
  MapIcon,
  MessageCircleIcon,
  MonitorIcon,
  NewspaperIcon,
  ScrollTextIcon,
  SettingsIcon,
  SproutIcon,
  SquareCheckBigIcon,
  TractorIcon,
  UserIcon,
  UsersIcon,
  WarehouseIcon,
  WheatIcon,
} from '@lucide/vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/shadcn/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/shadcn/sidebar'
import UserAvatar from '@/components/UserAvatar.vue'

const props = defineProps<{
  chatUnread: number
  notificationsUnread: number
  userName: string
  userEmail?: string | null
  userInitials: string
  userAvatarUrl?: string | null
}>()
const emit = defineEmits<{ logout: [] }>()

const route = useRoute()
const router = useRouter()
const { state, isMobile, setOpenMobile } = useSidebar()

// ——— какой пункт активен (логика прежнего меню) ———
const refsTabs = new Set(['downtime-reasons', 'work-operations'])
const landsRefTabs = new Set([
  'rights-refs', 'land-refs', 'crops-refs', 'melioration-refs', 'equipment-refs', 'field-refs', 'crop-rotation-refs',
  'storage-refs', 'storage-types', 'storage-statuses', 'storage-fill-statuses', 'storage-writeoff-reasons',
  'storage-consumption-targets', 'storage-purposes', 'land-types', 'land-categories', 'land-usage',
])
const tab = computed(() => String(route.query.tab || ''))
const isFieldsRefs = computed(() => route.path.startsWith('/fields') && refsTabs.has(tab.value))
const isLandsRefs = computed(() => route.path.startsWith('/lands') && landsRefTabs.has(tab.value))
const isMelioration = computed(() => route.path.startsWith('/lands') && tab.value === 'melioration')

interface NavLeaf {
  title: string
  to: RouteLocationRaw
  icon: Component
  active: () => boolean
  badge?: () => number
}
interface NavGroup {
  key: string
  title: string
  icon: Component
  items: NavLeaf[]
}
type NavEntry = NavLeaf | NavGroup
const isGroup = (e: NavEntry): e is NavGroup => 'items' in e

const sections: { label?: string; entries: NavEntry[] }[] = [
  {
    entries: [
      { title: 'Обзор', to: { path: '/dashboard', query: {} }, icon: LayoutDashboardIcon, active: () => route.name === 'dashboard' && route.query.tab !== 'about' },
      { title: 'Новости', to: '/news', icon: NewspaperIcon, active: () => route.path.startsWith('/news') },
      { title: 'Погода', to: '/weather', icon: CloudIcon, active: () => route.path.startsWith('/weather') },
      {
        key: 'lands', title: 'Земли', icon: LandPlotIcon, items: [
          { title: 'Земельные участки', to: '/lands', icon: MapIcon, active: () => route.path.startsWith('/lands') && !isLandsRefs.value && !isMelioration.value },
          { title: 'Поля', to: '/fields', icon: SproutIcon, active: () => route.path.startsWith('/field-details') || (route.path.startsWith('/fields') && !isFieldsRefs.value) },
          { title: 'Мелиорация', to: { path: '/lands', query: { tab: 'melioration' } }, icon: DropletsIcon, active: () => isMelioration.value },
        ],
      },
      {
        key: 'warehouses', title: 'Склады', icon: WarehouseIcon, items: [
          { title: 'Карточки складов', to: '/warehouses', icon: LayoutGridIcon, active: () => route.path.startsWith('/warehouses') && !route.path.startsWith('/warehouses/storage-locations') },
          { title: 'Места хранения', to: '/warehouses/storage-locations', icon: ArchiveIcon, active: () => route.path.startsWith('/warehouses/storage-locations') },
        ],
      },
      {
        key: 'grain', title: 'Учёт зерна', icon: WheatIcon, items: [
          { title: 'Партии', to: '/grain/batches', icon: BoxesIcon, active: () => route.path.startsWith('/grain/batches') },
          { title: 'Журнал операций', to: '/grain/journal', icon: ScrollTextIcon, active: () => route.path.startsWith('/grain/journal') },
          { title: 'Контрагенты', to: '/grain/counterparties', icon: UsersIcon, active: () => route.path.startsWith('/grain/counterparties') },
        ],
      },
      { title: 'Техника', to: '/equipment', icon: TractorIcon, active: () => route.path.startsWith('/equipment') },
      { title: 'Задачи', to: '/task-management', icon: SquareCheckBigIcon, active: () => route.path.startsWith('/task-management') },
      { title: 'Календарь', to: '/tasks', icon: CalendarIcon, active: () => route.path === '/tasks' || route.path.startsWith('/tasks/') },
      { title: 'Аналитика', to: '/reports', icon: ChartColumnIcon, active: () => route.path.startsWith('/reports') },
    ],
  },
  {
    label: 'Операции',
    entries: [{ title: 'Экран оператора', to: '/mechanic', icon: MonitorIcon, active: () => route.path.startsWith('/mechanic') }],
  },
  {
    label: 'Связь',
    entries: [
      { title: 'Сотрудники', to: '/employees', icon: UsersIcon, active: () => route.path.startsWith('/employees') },
      { title: 'Уведомления', to: '/notifications', icon: BellIcon, active: () => route.path.startsWith('/notifications'), badge: () => props.notificationsUnread },
      { title: 'Чат', to: '/chat', icon: MessageCircleIcon, active: () => route.path.startsWith('/chat'), badge: () => props.chatUnread },
    ],
  },
  {
    label: 'Настройки',
    entries: [
      {
        key: 'settings', title: 'Настройки', icon: SettingsIcon, items: [
          { title: 'Справочники', to: { path: '/lands', query: { tab: 'rights-refs' } }, icon: BookMarkedIcon, active: () => isFieldsRefs.value || isLandsRefs.value },
        ],
      },
    ],
  },
]

// раскрытые разделы: раздел открытой страницы раскрыт сам, свернуть можно вручную
const open = reactive<Record<string, boolean>>({})
const userMenuOpen = ref(false)
function groupActive(g: NavGroup) {
  return g.items.some((i) => i.active())
}
watch(
  () => route.fullPath,
  () => {
    for (const s of sections) for (const e of s.entries) if (isGroup(e) && groupActive(e)) open[e.key] = true
    if (isMobile.value) setOpenMobile(false)
    userMenuOpen.value = false
  },
  { immediate: true },
)

const badgeText = (n: number) => (n > 99 ? '99+' : String(n))

function goFirst(g: NavGroup) {
  void router.push(g.items[0].to)
}
</script>

<template>
  <Sidebar collapsible="icon" class="app-sidebar">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child tooltip="АГРОСИСТЕМА">
            <RouterLink :to="{ path: '/dashboard', query: {} }" aria-label="АГРОСИСТЕМА — на главную">
              <span class="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <SproutIcon class="size-4" />
              </span>
              <span class="grid flex-1 text-left leading-tight">
                <span class="truncate text-sm font-semibold tracking-wide">АГРО<span class="text-primary">СИСТЕМА</span></span>
                <span class="text-muted-foreground truncate text-xs">Портал агронома</span>
              </span>
            </RouterLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup v-for="(section, si) in sections" :key="si">
        <SidebarGroupLabel v-if="section.label">{{ section.label }}</SidebarGroupLabel>
        <SidebarMenu>
          <template v-for="entry in section.entries" :key="entry.title">
            <!-- раздел с подпунктами -->
            <Collapsible v-if="isGroup(entry)" v-model:open="open[entry.key]" as-child class="group/collapsible">
              <SidebarMenuItem>
                <SidebarMenuButton
                  v-if="state === 'collapsed' && !isMobile"
                  :tooltip="entry.title"
                  :is-active="groupActive(entry)"
                  @click="goFirst(entry)"
                >
                  <component :is="entry.icon" />
                  <span>{{ entry.title }}</span>
                </SidebarMenuButton>
                <CollapsibleTrigger v-else as-child>
                  <SidebarMenuButton :tooltip="entry.title" :is-active="groupActive(entry) && !open[entry.key]">
                    <component :is="entry.icon" />
                    <span>{{ entry.title }}</span>
                    <ChevronRightIcon class="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem v-for="item in entry.items" :key="item.title">
                      <SidebarMenuSubButton as-child :is-active="item.active()">
                        <RouterLink :to="item.to">
                          <component :is="item.icon" />
                          <span>{{ item.title }}</span>
                        </RouterLink>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>

            <!-- обычный пункт -->
            <SidebarMenuItem v-else>
              <SidebarMenuButton as-child :tooltip="entry.title" :is-active="entry.active()">
                <RouterLink :to="entry.to">
                  <component :is="entry.icon" />
                  <span>{{ entry.title }}</span>
                </RouterLink>
              </SidebarMenuButton>
              <SidebarMenuBadge v-if="entry.badge && entry.badge() > 0" class="bg-primary text-primary-foreground rounded-full">
                {{ badgeText(entry.badge()) }}
              </SidebarMenuBadge>
            </SidebarMenuItem>
          </template>
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu v-model:open="userMenuOpen">
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton size="lg" class="data-[state=open]:bg-sidebar-accent" :tooltip="userName">
                <UserAvatar class="bg-primary text-primary-foreground size-8 rounded-lg text-xs font-semibold" :url="userAvatarUrl" :initials="userInitials" />
                <span class="grid flex-1 text-left text-sm leading-tight">
                  <span class="truncate font-medium">{{ userName }}</span>
                  <span v-if="userEmail" class="text-muted-foreground truncate text-xs">{{ userEmail }}</span>
                </span>
                <ChevronsUpDownIcon class="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="min-w-56 rounded-lg" :side="isMobile ? 'bottom' : 'right'" align="end" :side-offset="4">
              <DropdownMenuLabel class="font-normal">
                <div class="grid text-sm leading-tight">
                  <span class="truncate font-medium">{{ userName }}</span>
                  <span v-if="userEmail" class="text-muted-foreground truncate text-xs">{{ userEmail }}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem as-child>
                <RouterLink to="/profile"><UserIcon /> Профиль</RouterLink>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem @select="emit('logout')"><LogOutIcon /> Выйти</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>
