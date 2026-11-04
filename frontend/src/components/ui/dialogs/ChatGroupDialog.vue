<script setup lang="ts">
/** «Новая команда» — Dialog + Input + Checkbox + ScrollArea из shadcn-vue. */
import { computed, ref } from 'vue'
import type { EmployeeRow } from '@/lib/employeesSupabase'
import { SearchIcon } from '@lucide/vue'
import { Checkbox } from '@/components/ui/shadcn/checkbox'
import { Input } from '@/components/ui/shadcn/input'
import { Label } from '@/components/ui/shadcn/label'
import { ScrollArea } from '@/components/ui/shadcn/scroll-area'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'

const props = defineProps<{ employees: EmployeeRow[]; selected: Set<string>; busy: boolean }>()
const search = ref('')
const visibleEmployees = computed(() => { const q = search.value.trim().toLowerCase(); return q ? props.employees.filter(e => `${e.display_name || ''} ${e.email || ''} ${e.position || ''}`.toLowerCase().includes(q)) : [] })
const title = defineModel<string>('title', { required: true })
const emit = defineEmits<{ close: []; toggle: [id: string]; submit: [] }>()
</script>

<template>
  <UiModal
    title="Новая команда"
    description="Выберите участников — вы будете добавлены автоматически."
    :max-width="480"
    :close-disabled="busy"
    @close="emit('close')"
  >
    <div class="grid gap-2">
      <Label for="chat-group-title">Название</Label>
      <Input id="chat-group-title" v-model="title" placeholder="Например: Бригада поля №3" />
    </div>
    <div class="relative"><SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" /><Input v-model="search" placeholder="Поиск по имени, email или должности" class="pl-9" /></div>
    <ScrollArea class="h-72 rounded-lg border">
      <div class="grid p-1">
        <Label
          v-for="row in visibleEmployees"
          :key="row.id"
          :for="`chat-group-${row.id}`"
          class="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 font-normal"
        >
          <Checkbox :id="`chat-group-${row.id}`" :model-value="selected.has(row.id)" @update:model-value="emit('toggle', row.id)" />
          <span class="min-w-0 flex-1 truncate">{{ row.display_name?.trim() || row.email }}</span>
          <span class="text-muted-foreground shrink-0 text-xs">{{ row.position || '' }}</span>
        </Label>
          <p v-if="!visibleEmployees.length" class="text-muted-foreground py-8 text-center text-sm">Введите имя или email</p>
      </div>
    </ScrollArea>
    <template #actions>
      <UiButton :disabled="busy" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" :disabled="busy" @click="emit('submit')">{{ busy ? 'Создание…' : 'Создать' }}</UiButton>
    </template>
  </UiModal>
</template>
