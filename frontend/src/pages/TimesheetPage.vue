<script setup lang="ts">
/**
 * «Табель» — сколько отработано по дням.
 *
 * Сотрудник видит свой табель: сверху «Рабочий день» с секундомером (можно
 * начать и закончить день прямо здесь), ниже дни за период — исправить день
 * (с причиной), добавить забытый. Руководитель дополнительно видит вкладку
 * «Сотрудники» — сетку всех за период и по клику дни любого сотрудника.
 *
 * Состояние в адресе: ?tab=team&user=<id>&from=2026-11-01&to=2026-11-30.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import PageToolbar from '@/components/ui/layout/PageToolbar.vue'
import UiDateRangePicker from '@/components/ui/UiDateRangePicker.vue'
import TimesheetDays from '@/components/timesheet/TimesheetDays.vue'
import TimesheetTeam from '@/components/timesheet/TimesheetTeam.vue'
import WorkDayBar from '@/components/timesheet/WorkDayBar.vue'
import { loadActive } from '@/lib/downtimeStorage'
import { loadActiveOperation } from '@/lib/operationStorage'
import { loadProfiles, type ProfileRow } from '@/lib/tasksSupabase'
import { moscowDate } from '@/lib/timesheet'
import { useAuth } from '@/stores/auth'

const auth = useAuth()
const route = useRoute()
const router = useRouter()

const isManager = computed(() => auth.userRole.value === 'manager')
const myId = computed(() => auth.user.value?.id ?? '')
const profiles = ref<ProfileRow[]>([])
const myDays = ref<InstanceType<typeof TimesheetDays> | null>(null)

onMounted(async () => {
  try {
    profiles.value = await loadProfiles()
  } catch {
    profiles.value = []
  }
})

/* ---------- период ---------- */
const YMD = /^\d{4}-\d{2}-\d{2}$/
const today = moscowDate()
const from = computed(() => {
  const q = String(route.query.from ?? '')
  return YMD.test(q) ? q : `${today.slice(0, 7)}-01`
})
const to = computed(() => {
  const q = String(route.query.to ?? '')
  const v = YMD.test(q) ? q : today
  return v < from.value ? from.value : v
})

const tab = computed(() => (isManager.value && route.query.tab === 'team' ? 'team' : 'mine'))
const selectedUser = computed(() => (tab.value === 'team' ? String(route.query.user ?? '') : ''))

function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...patch })) if (typeof v === 'string' && v) next[k] = v
  void router.replace({ query: next })
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const at = (s: string) => new Date(`${s}T12:00:00`)

/** Целый месяц — стрелки листают по месяцам, иначе — на длину периода. */
const isWholeMonth = computed(() => {
  const f = at(from.value)
  const t = at(to.value)
  const last = new Date(f.getFullYear(), f.getMonth() + 1, 0)
  return f.getDate() === 1 && f.getMonth() === t.getMonth() && (t.getDate() === last.getDate() || to.value === today)
})

function shift(delta: number) {
  if (isWholeMonth.value) {
    const f = at(from.value)
    const start = new Date(f.getFullYear(), f.getMonth() + delta, 1)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
    const endStr = ymd(end) > today ? today : ymd(end)
    setQuery({ from: ymd(start), to: endStr })
    return
  }
  const len = Math.round((at(to.value).getTime() - at(from.value).getTime()) / 86_400_000) + 1
  const f = at(from.value)
  f.setDate(f.getDate() + delta * len)
  const t = new Date(f)
  t.setDate(f.getDate() + len - 1)
  setQuery({ from: ymd(f), to: ymd(t) > today ? today : ymd(t) })
}

const canGoNext = computed(() => to.value < today)

/* ---------- люди ---------- */
const profileById = computed(() => new Map(profiles.value.map((p) => [p.id, p])))
function nameOf(userId: string | null): string {
  if (!userId) return 'Система'
  const p = profileById.value.get(userId)
  return p?.display_name?.trim() || p?.email || 'Сотрудник'
}
const myName = computed(() => nameOf(myId.value))

/* ---------- операция на экране оператора (хранится в браузере) ---------- */
const nowTick = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => (timer = setInterval(() => (nowTick.value = Date.now()), 30_000)))
onUnmounted(() => timer && clearInterval(timer))

const busy = computed(() => {
  void nowTick.value
  return Boolean(loadActive() || loadActiveOperation())
})
const liveOperationMinutes = computed(() => {
  void nowTick.value
  const op = loadActiveOperation()
  if (!op || loadActive()) return 0
  const end = op.pausedAt ? Date.parse(op.pausedAt) : Date.now()
  const sec = (end - Date.parse(op.startISO)) / 1000 - (op.accumulatedPauseSeconds ?? 0)
  return Math.max(0, Math.floor(sec / 60))
})
</script>

<template>
  <section class="tw-scope flex min-w-0 flex-col gap-6">
    <WorkDayBar
      v-if="tab === 'mine' && myId"
      :user-id="myId"
      :busy="busy"
      :live-operation-minutes="liveOperationMinutes"
      hide-timesheet-link
      @changed="myDays?.reload()"
    />

    <PageToolbar>
      <Tabs v-if="isManager" :model-value="tab" @update:model-value="(v) => setQuery({ tab: v === 'team' ? 'team' : undefined, user: undefined })">
        <TabsList>
          <TabsTrigger value="mine">Мой табель</TabsTrigger>
          <TabsTrigger value="team">Сотрудники</TabsTrigger>
        </TabsList>
      </Tabs>
      <div class="flex min-w-0 items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Предыдущий период" @click="shift(-1)"><ChevronLeftIcon /></Button>
        <UiDateRangePicker :from="from" :to="to" :max="today" class="min-w-0 flex-1 sm:flex-none" @change="(f, t) => setQuery({ from: f, to: t })" />
        <Button variant="outline" size="icon" aria-label="Следующий период" :disabled="!canGoNext" @click="shift(1)"><ChevronRightIcon /></Button>
      </div>
    </PageToolbar>

    <TimesheetDays
      v-if="tab === 'mine' && myId"
      ref="myDays"
      :user-id="myId"
      :person-name="myName"
      :from="from"
      :to="to"
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
        :from="from"
        :to="to"
        :own="selectedUser === myId"
        can-edit
        :name-of="nameOf"
      />
    </template>

    <TimesheetTeam v-else-if="tab === 'team'" :from="from" :to="to" :profiles="profiles" @select="(id) => setQuery({ user: id })" />
  </section>
</template>
