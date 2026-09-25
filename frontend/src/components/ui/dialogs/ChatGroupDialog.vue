<script setup lang="ts">
/** «Новая команда» — Dialog + Input + Checkbox + ScrollArea из shadcn-vue. */
import type { EmployeeRow } from '@/lib/employeesSupabase'
import { Checkbox } from '@/components/ui/shadcn/checkbox'
import { Input } from '@/components/ui/shadcn/input'
import { Label } from '@/components/ui/shadcn/label'
import { ScrollArea } from '@/components/ui/shadcn/scroll-area'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'

defineProps<{ employees: EmployeeRow[]; selected: Set<string>; busy: boolean }>()
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
    <ScrollArea class="h-72 rounded-lg border">
      <div class="grid p-1">
        <Label
          v-for="row in employees"
          :key="row.id"
          :for="`chat-group-${row.id}`"
          class="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 font-normal"
        >
          <Checkbox :id="`chat-group-${row.id}`" :model-value="selected.has(row.id)" @update:model-value="emit('toggle', row.id)" />
          <span class="min-w-0 flex-1 truncate">{{ row.display_name?.trim() || row.email }}</span>
          <span class="text-muted-foreground shrink-0 text-xs">{{ row.position || '' }}</span>
        </Label>
      </div>
    </ScrollArea>
    <template #actions>
      <UiButton :disabled="busy" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" :disabled="busy" @click="emit('submit')">{{ busy ? 'Создание…' : 'Создать' }}</UiButton>
    </template>
  </UiModal>
</template>
