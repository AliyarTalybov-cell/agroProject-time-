<script setup lang="ts">
/**
 * «Добавить» человека в список (участники задачи, ответственные события) —
 * Popover shadcn-vue: кнопка, в окне поиск (Input) и список (ScrollArea) с
 * аватарами. Отдаёт выбранного через событие pick; сам список выбранных
 * показывает страница.
 */
import { computed, ref, type StyleValue } from 'vue'
import { CirclePlusIcon, SearchIcon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import { Input } from '@/components/ui/shadcn/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover'
import { ScrollArea } from '@/components/ui/shadcn/scroll-area'
import UserAvatar from '@/components/UserAvatar.vue'

export interface PersonOption {
  id: string
  label: string
  initials: string
  url?: string | null
  avatarStyle?: StyleValue
}

const props = withDefaults(
  defineProps<{ options: PersonOption[]; emptyText?: string; allAddedText?: string; allAdded?: boolean }>(),
  { emptyText: 'Ничего не найдено', allAddedText: 'Все добавлены', allAdded: false },
)
const emit = defineEmits<{ pick: [id: string] }>()

const open = ref(false)
const q = ref('')
const filtered = computed(() => {
  const s = q.value.trim().toLowerCase()
  return s ? props.options.filter((o) => o.label.toLowerCase().includes(s)) : props.options
})

function pick(id: string) {
  emit('pick', id)
  open.value = false
  q.value = ''
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button type="button" variant="outline" size="sm">
        <CirclePlusIcon />
        Добавить
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-72 p-0" align="end">
      <div class="relative border-b">
        <SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input v-model="q" placeholder="Поиск по имени или email" class="h-10 rounded-none border-0 pl-9 shadow-none focus-visible:ring-0" />
      </div>
      <ScrollArea class="max-h-64">
        <div class="grid p-1">
          <button
            v-for="o in filtered"
            :key="o.id"
            type="button"
            class="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none"
            @click="pick(o.id)"
          >
            <UserAvatar class="size-6 text-[10px] font-semibold text-white" :style="o.avatarStyle" :url="o.url" :initials="o.initials" />
            <span class="truncate">{{ o.label }}</span>
          </button>
          <p v-if="!filtered.length" class="text-muted-foreground py-6 text-center text-sm">
            {{ allAdded ? allAddedText : emptyText }}
          </p>
        </div>
      </ScrollArea>
    </PopoverContent>
  </Popover>
</template>
