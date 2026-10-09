<script setup lang="ts">
import { Button } from '@/components/ui/shadcn/button'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/shadcn/input-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/shadcn/table'
import { BuildingIcon, PlusIcon, SearchIcon, Trash2Icon } from '@lucide/vue'
import PageToolbar from '@/components/ui/layout/PageToolbar.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/** Справочник контрагентов: покупатели и поставщики зерна. */
import { computed, onMounted, ref, watch } from 'vue'
import UiPagination from '@/components/ui/UiPagination.vue'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import CounterpartyModal from '@/components/stock/CounterpartyModal.vue'
import { useAuth } from '@/stores/auth'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { counterpartyKindLabel, deleteCounterparty, loadCounterparties, type Counterparty } from '@/lib/stockLedger'

const auth = useAuth()
const isManager = computed(() => auth.userRole.value === 'manager')
const loading = ref(true)
const error = ref<string | null>(null)
const rows = ref<Counterparty[]>([])
const search = ref('')
const kind = ref('')
const page = ref(1)
const pageSize = ref(20)
const editing = ref<Counterparty | null | 'new'>(null)
const deleting = ref<Counterparty | null>(null)
const deleteBusy = ref(false)

async function load() {
  error.value = null
  try {
    rows.value = await loadCounterparties()
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (kind.value && r.kind !== kind.value && r.kind !== 'both') return false
    if (!q) return true
    return [r.name, r.inn, r.contact_person, r.phone].filter(Boolean).join(' ').toLowerCase().includes(q)
  })
})
watch([search, kind, pageSize], () => (page.value = 1))
const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

function onSaved() {
  editing.value = null
  void load()
}

async function confirmDelete() {
  if (!deleting.value) return
  deleteBusy.value = true
  try {
    await deleteCounterparty(deleting.value.id)
    deleting.value = null
    await load()
  } catch (e) {
    const msg = formatSupabaseError(e)
    error.value = msg.includes('foreign key')
      ? 'С контрагентом уже есть операции — удалить нельзя. Снимите отметку «Работаем с ним», чтобы скрыть его из списков.'
      : msg
    deleting.value = null
  } finally {
    deleteBusy.value = false
  }
}
</script>

<template>
  <section class="tw-scope flex flex-col gap-6">
    <PageToolbar>
      <InputGroup class="w-full sm:w-72">
        <InputGroupAddon><SearchIcon /></InputGroupAddon>
        <InputGroupInput v-model="search" type="search" placeholder="Название, ИНН, контакт" aria-label="Поиск контрагента" />
      </InputGroup>
      <div class="w-full sm:w-44">
        <UiSelect v-model="kind" block aria-label="Роль" :options="[{ value: '', label: 'Все роли' }, { value: 'buyer', label: 'Покупатели' }, { value: 'supplier', label: 'Поставщики' }]" />
      </div>
      <template #actions>
        <Button type="button" @click="editing = 'new'">
          <PlusIcon />
          Добавить контрагента
        </Button>
      </template>
    </PageToolbar>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <div v-if="loading" class="grid gap-2">
      <Skeleton v-for="i in 4" :key="i" class="h-12 w-full" />
    </div>
    <Empty v-else-if="!filtered.length" class="rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon"><BuildingIcon /></EmptyMedia>
        <EmptyTitle>{{ rows.length ? 'Никого не найдено' : 'Контрагентов пока нет' }}</EmptyTitle>
        <EmptyDescription>{{ rows.length ? 'Измените поиск или роль.' : 'Покупатели и поставщики выбираются при продаже и закупке зерна. Добавьте первого.' }}</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <template v-else>
      <div class="sm:overflow-hidden sm:rounded-xl sm:border sm:bg-card">
        <Table v-card-table>
          <TableHeader class="bg-muted/50">
            <TableRow>
              <TableHead class="pl-4">Название</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead>ИНН / КПП</TableHead>
              <TableHead>Контакт</TableHead>
              <TableHead class="w-12 pr-4"><span class="sr-only">Действия</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="r in pageRows" :key="r.id" class="cursor-pointer" @click="editing = r">
              <TableCell class="whitespace-normal pl-4">
                <span class="font-medium">{{ r.name }}</span>
                <span v-if="r.address" class="block text-xs text-muted-foreground">{{ r.address }}</span>
              </TableCell>
              <TableCell>
                <UiBadge :tone="r.active ? 'primary' : 'neutral'">{{ counterpartyKindLabel(r.kind) }}</UiBadge>
                <span v-if="!r.active" class="block text-xs text-muted-foreground">не работаем</span>
              </TableCell>
              <TableCell class="tabular-nums">{{ [r.inn, r.kpp].filter(Boolean).join(' / ') || '—' }}</TableCell>
              <TableCell class="whitespace-normal">
                {{ r.contact_person || '—' }}
                <span v-if="r.phone || r.email" class="block text-xs text-muted-foreground">{{ [r.phone, r.email].filter(Boolean).join(' · ') }}</span>
              </TableCell>
              <TableCell class="pr-4 text-right" @click.stop>
                <Button v-if="isManager" variant="ghost" size="icon-sm" type="button" class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" :aria-label="`Удалить «${r.name}»`" @click="deleting = r">
                  <Trash2Icon />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <UiPagination v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" :page-size-options="[10, 20, 50]" />
    </template>

    <CounterpartyModal v-if="editing" :counterparty="editing === 'new' ? null : editing" @close="editing = null" @done="onSaved" />
    <UiConfirmModal
      v-if="deleting"
      :title="`Удалить «${deleting.name}»?`"
      :busy="deleteBusy"
      @cancel="deleting = null"
      @confirm="confirmDelete"
    />
  </section>
</template>
