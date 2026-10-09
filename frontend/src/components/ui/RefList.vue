<script setup lang="ts" generic="T extends { id: string }">
/**
 * Справочник: заголовок, строка добавления и список значений с правкой и удалением.
 * Один вид для всех справочников (земли, культуры, хранение, техника и т. д.).
 *
 *   <RefList title="Типы земли" v-model="newName" :items="types" :get-label="(t) => t.name"
 *            @add="add" @edit="edit" @remove="(t) => askDelete(t.id)" />
 *
 * Своя подпись строки — слот `label` ({ item }), дополнительные поля строки
 * добавления (например, флажок) — слот `add-extra`, свои кнопки строки — слот
 * `actions` ({ item }). `canRemove: false` прячет удаление (нет прав).
 */
import { Button } from '@/components/ui/shadcn/button'
import { Input } from '@/components/ui/shadcn/input'
import { PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    title?: string
    hint?: string
    items: T[]
    getLabel?: (item: T) => string
    placeholder?: string
    busy?: boolean
    emptyText?: string
    /** Ошибка списка (загрузки, сохранения). */
    error?: string | null
    canRemove?: boolean
  }>(),
  { title: undefined, hint: undefined, getLabel: undefined, placeholder: 'Новое значение', busy: false, emptyText: 'Пока пусто.', error: null, canRemove: true },
)

const newValue = defineModel<string>({ default: '' })
const emit = defineEmits<{ add: []; edit: [item: T]; remove: [item: T] }>()

function labelOf(item: T): string {
  if (props.getLabel) return props.getLabel(item)
  const rec = item as unknown as Record<string, unknown>
  return String(rec.label ?? rec.name ?? '')
}

function add() {
  if (props.busy || !newValue.value.trim()) return
  emit('add')
}
</script>

<template>
  <section class="tw-scope grid gap-4">
    <header v-if="title || hint" class="grid gap-1">
      <h2 v-if="title" class="text-base font-semibold">{{ title }}</h2>
      <p v-if="hint" class="text-sm text-muted-foreground">{{ hint }}</p>
    </header>
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

    <form class="flex flex-col gap-2 sm:flex-row sm:items-center" @submit.prevent="add">
      <Input v-model="newValue" type="text" class="sm:max-w-md" :placeholder="placeholder" :aria-label="title ? `Новое значение: ${title}` : 'Новое значение'" />
      <slot name="add-extra" />
      <Button type="submit" :disabled="busy || !newValue.trim()">
        <PlusIcon />
        Добавить
      </Button>
    </form>

    <ul v-if="items.length" class="overflow-hidden rounded-xl border bg-card">
      <li v-for="item in items" :key="item.id" class="flex min-h-12 items-center gap-2 border-b py-1.5 pr-2 pl-4 last:border-b-0">
        <span class="min-w-0 flex-1 text-sm break-words">
          <slot name="label" :item="item">{{ labelOf(item) }}</slot>
        </span>
        <slot name="actions" :item="item" />
        <Button variant="ghost" size="icon-sm" type="button" class="shrink-0 text-muted-foreground" :aria-label="`Изменить «${labelOf(item)}»`" :disabled="busy" @click="emit('edit', item)">
          <PencilIcon />
        </Button>
        <Button
          v-if="canRemove"
          variant="ghost"
          size="icon-sm"
          type="button"
          class="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          :aria-label="`Удалить «${labelOf(item)}»`"
          :disabled="busy"
          @click="emit('remove', item)"
        >
          <Trash2Icon />
        </Button>
      </li>
    </ul>
    <p v-else class="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{{ emptyText }}</p>
  </section>
</template>
