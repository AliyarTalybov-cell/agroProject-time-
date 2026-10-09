<script setup lang="ts">
import { Input } from '@/components/ui/shadcn/input'
import { Button } from '@/components/ui/shadcn/button'
import RefList from '@/components/ui/RefList.vue'
import FormField from '@/components/ui/layout/FormField.vue'
/**
 * Простой справочник складского учёта во вкладке «Справочники хранения»:
 * причины списания, направления расхода, назначения партий. Разметка — общий
 * список справочника (RefList); переименование — окном проекта,
 * а не prompt(). Значение, на которое уже ссылаются документы, удалить нельзя
 * (держат внешние ключи) — его можно скрыть из списков выбора.
 */
import { computed, onMounted, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import { useAuth } from '@/stores/auth'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  deleteSimpleRef,
  loadSimpleRef,
  saveSimpleRef,
  setSimpleRefActive,
  type SimpleRefRow,
  type SimpleRefTable,
} from '@/lib/stockLedger'

const props = defineProps<{ table: SimpleRefTable; title: string; hint: string; placeholder: string }>()

const auth = useAuth()
const isManager = computed(() => auth.userRole.value === 'manager')
const rows = ref<SimpleRefRow[]>([])
const busy = ref(false)
const error = ref<string | null>(null)
const newLabel = ref('')
const editing = ref<SimpleRefRow | null>(null)
const editLabel = ref('')
const deleting = ref<SimpleRefRow | null>(null)

async function load() {
  error.value = null
  try {
    rows.value = await loadSimpleRef(props.table)
  } catch (e) {
    error.value = formatSupabaseError(e)
  }
}
onMounted(load)

function dupMessage(e: unknown): string {
  const msg = formatSupabaseError(e)
  return msg.includes('duplicate') ? 'Такое значение уже есть' : msg
}

async function add() {
  const label = newLabel.value.trim()
  if (!label) return
  busy.value = true
  error.value = null
  try {
    await saveSimpleRef(props.table, null, label)
    newLabel.value = ''
    await load()
  } catch (e) {
    error.value = dupMessage(e)
  } finally {
    busy.value = false
  }
}

function startEdit(row: SimpleRefRow) {
  editing.value = row
  editLabel.value = row.label
}

async function saveEdit() {
  if (!editing.value || !editLabel.value.trim()) return
  busy.value = true
  error.value = null
  try {
    await saveSimpleRef(props.table, editing.value.id, editLabel.value)
    editing.value = null
    await load()
  } catch (e) {
    error.value = dupMessage(e)
  } finally {
    busy.value = false
  }
}

async function toggleActive(row: SimpleRefRow) {
  busy.value = true
  error.value = null
  try {
    await setSimpleRefActive(props.table, row.id, !row.active)
    await load()
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    busy.value = false
  }
}

async function confirmDelete() {
  if (!deleting.value) return
  busy.value = true
  error.value = null
  try {
    await deleteSimpleRef(props.table, deleting.value.id)
    deleting.value = null
    await load()
  } catch (e) {
    const msg = formatSupabaseError(e)
    error.value = msg.includes('foreign key')
      ? 'Значение уже используется в документах — удалить нельзя. Нажмите «Скрыть», чтобы убрать его из списков выбора.'
      : msg
    deleting.value = null
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <RefList
    v-model="newLabel"
    :title="title"
    :hint="hint"
    :items="rows"
    :placeholder="placeholder"
    :busy="busy"
    :error="error"
    :can-remove="isManager"
    @add="add"
    @edit="startEdit"
    @remove="(row) => (deleting = row)"
  >
    <template #label="{ item: row }">
      <span :class="row.active ? '' : 'text-muted-foreground'">{{ row.label }}</span>
      <span v-if="!row.active" class="ml-2 text-xs text-muted-foreground">скрыто</span>
    </template>
    <template #actions="{ item: row }">
      <Button variant="ghost" size="sm" type="button" class="shrink-0 text-muted-foreground" :disabled="busy" @click="toggleActive(row)">
        {{ row.active ? 'Скрыть' : 'Показать' }}
      </Button>
    </template>
  </RefList>

  <UiModal v-if="editing" :title="title" :max-width="460" :close-disabled="busy" @close="editing = null">
    <form id="stock-ref-edit" class="tw-scope grid gap-4" @submit.prevent="saveEdit">
      <FormField label="Название" for="stock-ref-label" required>
        <Input id="stock-ref-label" v-model="editLabel" />
      </FormField>
    </form>
    <template #actions>
      <UiButton :disabled="busy" @click="editing = null">Отмена</UiButton>
      <UiButton variant="primary" type="submit" form="stock-ref-edit" :disabled="busy || !editLabel.trim()">Сохранить</UiButton>
    </template>
  </UiModal>
  <UiConfirmModal
    v-if="deleting"
    :title="`Удалить «${deleting.label}»?`"
    :busy="busy"
    @cancel="deleting = null"
    @confirm="confirmDelete"
  />
</template>
