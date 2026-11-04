<script setup lang="ts">
/**
 * Выбор одного человека (ответственный, исполнитель, фильтр «Сотрудник») —
 * вместо UiSelect со всеми сотрудниками сразу.
 *
 *   <UiPersonSelect v-model="form.responsibleId" :people="people" :extra="[{ value: '', label: 'Не назначен' }]" />
 *
 * Кнопка выглядит как обычный выпадающий список и показывает выбранного.
 * В окне — строка поиска; люди появляются, когда начали вводить
 * (lib/peopleSearch). Пункты extra («Не назначен», «Все сотрудники»…)
 * видны всегда.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { CheckIcon, ChevronDownIcon, SearchIcon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import { Input } from '@/components/ui/shadcn/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover'
import UserAvatar from '@/components/UserAvatar.vue'
import type { PersonOption } from '@/components/ui/UiPersonPicker.vue'
import { searchPeople } from '@/lib/peopleSearch'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    modelValue: string
    people: PersonOption[]
    /** Особые пункты сверху: «Не назначен», «Все сотрудники», «Без исполнителя». */
    extra?: { value: string; label: string }[]
    placeholder?: string
    ariaLabel?: string
    block?: boolean
    disabled?: boolean
    size?: 'default' | 'sm'
  }>(),
  { extra: () => [], placeholder: 'Выберите сотрудника', ariaLabel: undefined, block: false, disabled: false, size: 'default' },
)
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string] }>()

const open = ref(false)
const q = ref('')
const input = ref<InstanceType<typeof Input> | null>(null)

const selectedPerson = computed(() => props.people.find((p) => p.id === props.modelValue) ?? null)
const selectedExtra = computed(() => props.extra.find((e) => e.value === props.modelValue) ?? null)
const result = computed(() => searchPeople(props.people, q.value))

watch(open, async (v) => {
  if (!v) return
  q.value = ''
  await nextTick()
  ;(input.value?.$el as HTMLInputElement | undefined)?.focus?.()
})

function choose(value: string) {
  open.value = false
  if (value === props.modelValue) return
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="outline"
        :size="size"
        :disabled="disabled"
        :aria-label="ariaLabel || placeholder"
        :class="cn('justify-between gap-2 px-3 font-normal', block && 'w-full')"
      >
        <span class="flex min-w-0 items-center gap-2">
          <UserAvatar
            v-if="selectedPerson"
            class="size-5 shrink-0 text-[9px] font-semibold text-white"
            :style="selectedPerson.avatarStyle"
            :url="selectedPerson.url"
            :initials="selectedPerson.initials"
          />
          <span class="truncate" :class="{ 'text-muted-foreground': !selectedPerson && !selectedExtra }">
            {{ selectedPerson?.label ?? selectedExtra?.label ?? placeholder }}
          </span>
        </span>
        <ChevronDownIcon class="size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="tw-scope w-(--reka-popover-trigger-width) min-w-64 p-0" align="start">
      <div class="relative border-b">
        <SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          ref="input"
          v-model="q"
          type="search"
          autocomplete="off"
          placeholder="Имя, email или должность"
          class="h-10 rounded-none border-0 pl-9 shadow-none focus-visible:ring-0"
          @keydown.enter.prevent="result.items[0] && choose(result.items[0].id)"
        />
      </div>
      <div class="max-h-72 overflow-y-auto overscroll-contain">
        <div class="grid p-1">
          <button
            v-for="e in extra"
            :key="`x-${e.value}`"
            type="button"
            class="hover:bg-accent focus-visible:bg-accent flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none"
            @click="choose(e.value)"
          >
            <span class="truncate">{{ e.label }}</span>
            <CheckIcon v-if="modelValue === e.value" class="size-4 shrink-0" />
          </button>
          <!-- Выбранный виден и без поиска, чтобы было понятно, кто сейчас стоит. -->
          <button
            v-if="selectedPerson && result.needQuery"
            type="button"
            class="hover:bg-accent focus-visible:bg-accent flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none"
            @click="choose(selectedPerson.id)"
          >
            <span class="flex min-w-0 items-center gap-2">
              <UserAvatar class="size-6 shrink-0 text-[10px] font-semibold text-white" :style="selectedPerson.avatarStyle" :url="selectedPerson.url" :initials="selectedPerson.initials" />
              <span class="truncate">{{ selectedPerson.label }}</span>
            </span>
            <CheckIcon class="size-4 shrink-0" />
          </button>
          <div v-if="extra.length || (selectedPerson && result.needQuery)" class="bg-border mx-1 my-1 h-px" />

          <p v-if="result.needQuery" class="text-muted-foreground px-3 py-4 text-center text-sm">Начните вводить имя — покажем совпадения.</p>
          <template v-else>
            <button
              v-for="o in result.items"
              :key="o.id"
              type="button"
              class="hover:bg-accent focus-visible:bg-accent flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none"
              @click="choose(o.id)"
            >
              <span class="flex min-w-0 items-center gap-2">
                <UserAvatar class="size-6 shrink-0 text-[10px] font-semibold text-white" :style="o.avatarStyle" :url="o.url" :initials="o.initials" />
                <span class="grid min-w-0">
                  <span class="truncate">{{ o.label }}</span>
                  <span v-if="o.sub" class="text-muted-foreground truncate text-xs">{{ o.sub }}</span>
                </span>
              </span>
              <CheckIcon v-if="modelValue === o.id" class="size-4 shrink-0" />
            </button>
            <p v-if="!result.items.length" class="text-muted-foreground px-3 py-4 text-center text-sm">Никого не нашли — проверьте написание.</p>
            <p v-else-if="result.more" class="text-muted-foreground px-2 py-1.5 text-xs">Ещё {{ result.more }} — уточните запрос.</p>
          </template>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
