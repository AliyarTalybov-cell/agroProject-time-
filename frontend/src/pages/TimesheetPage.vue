<script setup lang="ts">
/**
 * «Табель» — сколько отработано по дням.
 *
 * Сотрудник видит свой табель: может исправить день (с причиной) и добавить
 * забытый. Руководитель дополнительно видит вкладку «Сотрудники» — сетку
 * всех за месяц, и по клику — дни любого сотрудника.
 *
 * Состояние в адресе: ?tab=team&user=<id>&month=2026-11 — ссылкой можно
 * поделиться, «Назад» возвращает к сетке.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import PageToolbar from '@/components/ui/layout/PageToolbar.vue'
import TimesheetDays from '@/components/timesheet/TimesheetDays.vue'
import TimesheetTeam from '@/components/timesheet/TimesheetTeam.vue'
import { loadProfiles, type ProfileRow } from '@/lib/tasksSupabase'
import { moscowDate } from '@/lib/timesheet'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const route = useRoute()
const router = useRouter()

const isManager = computed(() => auth.userRole.value === 'manager')
const myId = computed(() => auth.user.value?.id ?? '')
const profiles = ref<ProfileRow[]>([])

onMounted(async () => {
  try {
    profiles.value = await loadProfiles()
  } catch {
    profiles.value = []
  }
})

const month = computed(() => {
  const q = String(route.query.month ?? '')
  return /^\d{4}-\d{2}$/.test(q) ? `${q}-01` : `${moscowDate().slice(0, 7)}-01`
})
const tab = computed(() => (isManager.value && route.query.tab === 'team' ? 'team' : 'mine'))
const selectedUser = computed(() => (tab.value === 'team' ? String(route.query.user ?? '') : ''))

function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...patch })) if (typeof v === 'string' && v) next[k] = v
  void router.replace({ query: next })
}

function shiftMonth(delta: number) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  setQuery({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
}

const isCurrentMonth = computed(() => month.value.slice(0, 7) === moscowDate().slice(0, 7))
const monthLabel = computed(() => {
  const s = new Date(`${month.value}T12:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '')
  return s.charAt(0).toUpperCase() + s.slice(1)
})

const profileById = computed(() => new Map(profiles.value.map((p) => [p.id, p])))
function nameOf(userId: string | null): string {
  if (!userId) return 'Система'
  const p = profileById.value.get(userId)
  return p?.display_name?.trim() || p?.email || 'Сотрудник'
}

const myName = computed(() => nameOf(myId.value))
</script>

<template>
  <section class="tw-scope flex min-w-0 flex-col gap-6">
    <PageToolbar>
      <Tabs v-if="isManager" :model-value="tab" @update:model-value="(v) => setQuery({ tab: v === 'team' ? 'team' : undefined, user: undefined })">
        <TabsList>
          <TabsTrigger value="mine">Мой табель</TabsTrigger>
          <TabsTrigger value="team">Сотрудники</TabsTrigger>
        </TabsList>
      </Tabs>
      <div class="flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label="Предыдущий месяц" @click="shiftMonth(-1)"><ChevronLeftIcon /></Button>
        <span class="min-w-36 text-center text-sm font-medium">{{ monthLabel }}</span>
        <Button variant="outline" size="icon" aria-label="Следующий месяц" :disabled="isCurrentMonth" @click="shiftMonth(1)"><ChevronRightIcon /></Button>
      </div>
    </PageToolbar>

    <TimesheetDays
      v-if="tab === 'mine' && myId"
      :user-id="myId"
      :person-name="myName"
      :month="month"
      own
      can-edit
      :name-of="nameOf"
    />

    <template v-else-if="tab === 'team' && selectedUser">
      <div class="-mt-2 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" @click="setQuery({ user: undefined })">
          <ArrowLeftIcon />
          Все сотрудники
        </Button>
        <h2 class="text-base font-semibold">{{ nameOf(selectedUser) }}</h2>
      </div>
      <TimesheetDays
        :user-id="selectedUser"
        :person-name="nameOf(selectedUser)"
        :month="month"
        :own="selectedUser === myId"
        can-edit
        :name-of="nameOf"
      />
    </template>

    <TimesheetTeam v-else-if="tab === 'team'" :month="month" :profiles="profiles" @select="(id) => setQuery({ user: id })" />
  </section>
</template>
