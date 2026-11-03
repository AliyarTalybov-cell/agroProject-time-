<script setup lang="ts">
/**
 * Подсказка «?» у поля, значения которого берутся из справочника.
 *
 * Если передан `add`, в подсказке можно сразу дописать недостающее значение:
 * оно попадает в справочник и (это делает сам `add`) выбирается в поле —
 * заполненная форма при этом не теряется. Ссылка на раздел справочников
 * открывается в новой вкладке по той же причине.
 *
 * Popover из shadcn-vue — открывается по клику, работает и на телефоне.
 */
import { ref, watch } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
import { ArrowUpRightIcon, CircleHelpIcon } from '@lucide/vue'
import { Button } from '@/components/ui/shadcn/button'
import { Input } from '@/components/ui/shadcn/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover'

const props = withDefaults(
  defineProps<{
    text: string
    to: RouteLocationRaw
    linkLabel?: string
    /** Добавить значение в справочник и выбрать его в поле. */
    add?: (name: string) => Promise<unknown>
    addPlaceholder?: string
  }>(),
  {
    linkLabel: 'Открыть раздел',
    add: undefined,
    addPlaceholder: 'Новое значение',
  },
)

const router = useRouter()
const open = ref(false)
const draft = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

watch(open, (v) => {
  if (v) return
  draft.value = ''
  error.value = null
})

async function submit() {
  const name = draft.value.trim()
  if (!name || !props.add || busy.value) return
  busy.value = true
  error.value = null
  try {
    await props.add(name)
    open.value = false
  } catch (e) {
    const m = (e as { message?: unknown } | null)?.message
    error.value = typeof m === 'string' && m ? m : 'Не удалось добавить значение.'
  } finally {
    busy.value = false
  }
}

const href = () => router.resolve(props.to).href
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger
      type="button"
      class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle outline-none focus-visible:ring-3"
      aria-label="Подсказка: где добавить значения"
      @click.stop
    >
      <CircleHelpIcon class="size-4" />
    </PopoverTrigger>
    <PopoverContent class="tw-scope w-72 text-sm" align="start" @click.stop>
      <p class="text-muted-foreground leading-snug font-normal normal-case">{{ text }}</p>
      <form v-if="add" class="mt-3 grid gap-2" @submit.prevent="submit">
        <div class="flex gap-2">
          <Input v-model="draft" type="text" class="h-8 min-w-0 flex-1" :placeholder="addPlaceholder" :disabled="busy" aria-label="Новое значение справочника" />
          <Button type="submit" size="sm" :disabled="busy || !draft.trim()">Добавить</Button>
        </div>
        <p v-if="error" class="text-destructive text-xs font-normal normal-case" role="alert">{{ error }}</p>
      </form>
      <a :href="href()" target="_blank" rel="noopener" class="text-primary mt-3 inline-flex items-center gap-1 text-sm font-medium normal-case hover:underline">
        {{ linkLabel }}
        <ArrowUpRightIcon class="size-3.5" />
      </a>
    </PopoverContent>
  </Popover>
</template>
