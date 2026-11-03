<script setup lang="ts">
/**
 * «Добавить» человека в список (участники задачи, участники события) —
 * Popover shadcn-vue: кнопка, в окне строка поиска и найденные люди.
 *
 * Всех сразу не показываем (сотрудников могут быть сотни): ввели часть
 * имени, email или должности — видны первые совпадения (lib/peopleSearch).
 * Отдаёт выбранного через событие pick; список выбранных показывает страница.
 */
import { computed, nextTick, ref, watch, type StyleValue } from 'vue'
import { CirclePlusIcon, SearchIcon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import { Input } from '@/components/ui/shadcn/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover'
import UserAvatar from '@/components/UserAvatar.vue'
import { searchPeople } from '@/lib/peopleSearch'

export interface PersonOption {
  id: string
  label: string
  initials: string
  /** Должность — показывается под именем и участвует в поиске. */
  sub?: string | null
  email?: string | null
  url?: string | null
  avatarStyle?: StyleValue
}

const props = withDefaults(
  defineProps<{ options: PersonOption[]; emptyText?: string; allAddedText?: string; allAdded?: boolean; label?: string }>(),
  { emptyText: 'Никого не нашли — проверьте написание', allAddedText: 'Все уже добавлены', allAdded: false, label: 'Добавить' },
)
const emit = defineEmits<{ pick: [id: string] }>()

const open = ref(false)
const q = ref('')
const input = ref<InstanceType<typeof Input> | null>(null)
const result = computed(() => searchPeople(props.options, q.value))

watch(open, async (v) => {
  if (!v) return
  q.value = ''
  await nextTick()
  ;(input.value?.$el as HTMLInputElement | undefined)?.focus?.()
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
        {{ label }}
      </Button>
    </PopoverTrigger>
    <PopoverContent class="tw-scope w-72 p-0" align="end">
      <div class="relative border-b">
        <SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          ref="input"
          v-model="q"
          type="search"
          autocomplete="off"
          placeholder="Имя, email или должность"
          class="h-10 rounded-none border-0 pl-9 shadow-none focus-visible:ring-0"
          @keydown.enter.prevent="result.items[0] && pick(result.items[0].id)"
        />
      </div>
      <div class="max-h-64 overflow-y-auto overscroll-contain">
        <div class="grid p-1">
          <p v-if="allAdded" class="text-muted-foreground px-3 py-6 text-center text-sm">{{ allAddedText }}</p>
          <p v-else-if="result.needQuery" class="text-muted-foreground px-3 py-6 text-center text-sm">
            Начните вводить имя — покажем совпадения.
          </p>
          <template v-else>
            <button
              v-for="o in result.items"
              :key="o.id"
              type="button"
              class="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none"
              @click="pick(o.id)"
            >
              <UserAvatar class="size-6 shrink-0 text-[10px] font-semibold text-white" :style="o.avatarStyle" :url="o.url" :initials="o.initials" />
              <span class="grid min-w-0">
                <span class="truncate">{{ o.label }}</span>
                <span v-if="o.sub" class="text-muted-foreground truncate text-xs">{{ o.sub }}</span>
              </span>
            </button>
            <p v-if="!result.items.length" class="text-muted-foreground px-3 py-6 text-center text-sm">{{ emptyText }}</p>
            <p v-else-if="result.more" class="text-muted-foreground px-2 py-1.5 text-xs">Ещё {{ result.more }} — уточните запрос.</p>
          </template>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
