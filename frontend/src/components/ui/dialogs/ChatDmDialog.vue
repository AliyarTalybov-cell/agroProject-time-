<script setup lang="ts">
/**
 * «Кому написать» — Dialog shadcn-vue: поле поиска (Input) и список сотрудников
 * в ScrollArea. Ищет сервер (dmSearch на странице), поэтому без Command-фильтра.
 */
import type { EmployeeRow } from '@/lib/employeesSupabase'
import { Search } from '@lucide/vue'
import { Input } from '@/components/ui/shadcn/input'
import { ScrollArea } from '@/components/ui/shadcn/scroll-area'
import UiModal from '@/components/ui/UiModal.vue'

defineProps<{ results: EmployeeRow[]; loading: boolean }>()
const search = defineModel<string>('search', { required: true })
const emit = defineEmits<{ close: []; pick: [row: EmployeeRow] }>()

function name(row: EmployeeRow) {
  return row.display_name?.trim() || row.email || ''
}
</script>

<template>
  <UiModal title="Кому написать" description="Личный диалог с сотрудником" :max-width="460" @close="emit('close')">
    <div class="relative">
      <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input v-model="search" type="search" placeholder="Поиск по сотрудникам…" class="pl-9" autocomplete="off" autofocus />
    </div>
    <ScrollArea class="tw-scope h-72 rounded-lg border">
      <div class="grid p-1">
        <button
          v-for="row in results"
          :key="row.id"
          type="button"
          class="hover:bg-accent focus-visible:bg-accent flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm outline-none"
          @click="emit('pick', row)"
        >
          <span class="truncate font-medium">{{ name(row) }}</span>
          <span class="text-muted-foreground shrink-0 text-xs">{{ row.position || row.role || '—' }}</span>
        </button>
        <p v-if="!results.length" class="text-muted-foreground py-8 text-center text-sm">
          {{ loading ? 'Поиск…' : 'Никого не найдено' }}
        </p>
      </div>
    </ScrollArea>
  </UiModal>
</template>
