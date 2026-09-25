<script setup lang="ts">
import { PlusIcon, SearchIcon, Trash2Icon } from '@lucide/vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/** Справочник контрагентов: покупатели и поставщики зерна. */
import { computed, onMounted, ref, watch } from 'vue'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
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
  <section class="ui-page">
    <div class="ui-page-inner">
      <header class="ui-page-header">
        <p class="ui-page-subtitle">Покупатели и поставщики зерна и семян. Выбираются при продаже и закупке.</p>
        <div class="ui-header-actions">
          <button type="button" class="ui-add-btn" @click="editing = 'new'">
            <PlusIcon />
            Добавить контрагента
          </button>
        </div>
      </header>
      <section class="ui-card">
        <div class="ui-toolbar">
          <label class="ui-search">
            <SearchIcon />
            <input v-model="search" type="search" placeholder="Название, ИНН, контакт" />
          </label>
          <UiSelect v-model="kind" :options="[{ value: '', label: 'Все' }, { value: 'buyer', label: 'Покупатели' }, { value: 'supplier', label: 'Поставщики' }]" class="ui-filter-select" aria-label="Роль" />
        </div>
        <p v-if="error" class="ui-alert ui-alert--error">{{ error }}</p>
        <div v-if="loading" class="ui-loading"><UiLoadingBar /></div>
        <div v-else-if="!filtered.length" class="ui-empty">
          <h3>{{ rows.length ? 'Никого не найдено' : 'Контрагентов пока нет' }}</h3>
          <p>{{ rows.length ? 'Измените поиск.' : 'Добавьте первого покупателя или поставщика.' }}</p>
        </div>
        <template v-else>
          <div class="ui-table-wrap">
            <table class="ui-table cp-table" v-card-table>
              <thead>
                <tr><th>Название</th><th>Роль</th><th>ИНН / КПП</th><th>Контакт</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="r in pageRows" :key="r.id" class="ui-list-row" @click="editing = r">
                  <td>
                    <span class="ui-list-title">{{ r.name }}</span>
                    <div v-if="r.address" class="ui-muted ui-small">{{ r.address }}</div>
                  </td>
                  <td>
                    <span class="ui-pill" :class="r.active ? 'ui-pill--green' : ''">{{ counterpartyKindLabel(r.kind) }}</span>
                    <div v-if="!r.active" class="ui-muted ui-small">не работаем</div>
                  </td>
                  <td class="ui-mono">{{ [r.inn, r.kpp].filter(Boolean).join(' / ') || '—' }}</td>
                  <td>
                    {{ r.contact_person || '' }}
                    <div class="ui-muted ui-small">{{ [r.phone, r.email].filter(Boolean).join(' · ') }}</div>
                  </td>
                  <td class="cp-actions" @click.stop>
                    <button v-if="isManager" type="button" class="cp-del" aria-label="Удалить контрагента" title="Удалить" @click="deleting = r">
                      <Trash2Icon :size="18" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <UiPagination v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" :page-size-options="[10, 20, 50]" />
        </template>
      </section>
    </div>
    <teleport to="body">
      <CounterpartyModal v-if="editing" :counterparty="editing === 'new' ? null : editing" @close="editing = null" @done="onSaved" />
      <UiConfirmModal
        v-if="deleting"
        :title="`Удалить «${deleting.name}»?`"
        :busy="deleteBusy"
        @cancel="deleting = null"
        @confirm="confirmDelete"
      />
    </teleport>
  </section>
</template>

<style scoped>
@layer legacy {
.cp-table {
  min-width: 720px;
}

.cp-actions {
  width: 1%;
}

.cp-del {
  display: inline-flex;
  padding: 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.cp-del:hover {
  background: var(--bg-panel-hover);
  color: var(--danger-red);
}
}
</style>
