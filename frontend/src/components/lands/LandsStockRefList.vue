<script setup lang="ts">
import { PencilIcon } from '@lucide/vue'
/**
 * Простой справочник складского учёта во вкладке «Справочники хранения»:
 * причины списания, направления расхода, назначения партий. Разметка — как у
 * соседних списков раздела (landsShared.css); переименование — окном проекта,
 * а не prompt(). Значение, на которое уже ссылаются документы, удалить нельзя
 * (держат внешние ключи) — его можно скрыть из списков выбора.
 */
import { computed, onMounted, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
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
  <div class="lands-ref-block">
    <h2>{{ title }}</h2>
    <p class="lands-muted lands-ref-hint">{{ hint }}</p>
    <p v-if="error" class="lands-error">{{ error }}</p>
    <div class="lands-ref-add-row">
      <input v-model="newLabel" class="lands-search" type="text" :placeholder="placeholder" @keydown.enter="add" />
      <button type="button" class="lands-btn lands-btn--save lands-btn--add" :disabled="busy || !newLabel.trim()" @click="add">Добавить</button>
    </div>
    <div class="lands-list-plain">
      <div v-for="row in rows" :key="row.id" class="lands-list-plain-item" :class="{ 'stock-ref--hidden': !row.active }">
        <span>{{ row.label }}<template v-if="!row.active"> — скрыто</template></span>
        <div class="lands-item-actions">
          <button type="button" class="stock-ref-toggle" :disabled="busy" @click="toggleActive(row)">{{ row.active ? 'Скрыть' : 'Показать' }}</button>
          <button type="button" class="lands-action-btn lands-action-btn--edit" aria-label="Переименовать" title="Переименовать" @click="startEdit(row)">
            <PencilIcon :size="17" :stroke-width="2.1" />
          </button>
          <UiDeleteButton v-if="isManager" size="sm" :disabled="busy" @click="deleting = row" />
        </div>
      </div>
      <p v-if="!rows.length" class="lands-muted">Пока пусто.</p>
    </div>

    <teleport to="body">
      <UiModal v-if="editing" :title="title" :max-width="460" :close-disabled="busy" @close="editing = null">
        <div class="ui-form-field">
          <label class="ui-form-label">Название *</label>
          <input v-model="editLabel" class="ui-form-input" @keydown.enter="saveEdit" />
        </div>
        <template #actions>
          <UiButton :disabled="busy" @click="editing = null">Отмена</UiButton>
          <UiButton variant="primary" :disabled="busy || !editLabel.trim()" @click="saveEdit">Сохранить</UiButton>
        </template>
      </UiModal>
      <UiConfirmModal
        v-if="deleting"
        :title="`Удалить «${deleting.label}»?`"
        :busy="busy"
        @cancel="deleting = null"
        @confirm="confirmDelete"
      />
    </teleport>
  </div>
</template>

<style scoped>
.stock-ref--hidden span {
  color: var(--text-secondary);
}

.stock-ref-toggle {
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  border-radius: 8px;
  height: 30px;
  padding: 0 10px;
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.stock-ref-toggle:hover:not(:disabled) {
  color: var(--text-primary);
}
</style>
