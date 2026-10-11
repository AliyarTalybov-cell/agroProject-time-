<script setup lang="ts">
/**
 * Мини-чат с помощником на «Обзоре». Переписка живёт только на странице:
 * помощник отвечает по свежей сводке, история нужна лишь для уточнений.
 */
import { computed, nextTick, ref } from 'vue'
import { ArrowUpIcon, RotateCcwIcon, SparklesIcon } from '@lucide/vue'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card'
import { Button } from '@/components/ui/shadcn/button'
import { Textarea } from '@/components/ui/shadcn/textarea'
import { Spinner } from '@/components/ui/shadcn/spinner'
import { askAssistant, type AssistantMessage } from '@/lib/aiAssistant'

const props = defineProps<{ isManager: boolean }>()

const messages = ref<AssistantMessage[]>([])
const draft = ref('')
const pending = ref(false)
const error = ref('')
const scroller = ref<HTMLElement | null>(null)

const suggestions = computed(() =>
  props.isManager
    ? ['Что важно сегодня?', 'Кто сейчас в поле?', 'Что ждёт моей проверки?', 'Погода для работ в поле']
    : ['Что у меня сегодня?', 'Что просрочено?', 'Погода для работ в поле'],
)

async function scrollDown() {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
}

async function send(text?: string) {
  const question = (text ?? draft.value).trim()
  if (!question || pending.value) return
  const history = messages.value.slice()
  messages.value.push({ role: 'user', content: question })
  draft.value = ''
  error.value = ''
  pending.value = true
  void scrollDown()
  try {
    const answer = await askAssistant(question, history)
    messages.value.push({ role: 'assistant', content: answer })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось получить ответ'
  } finally {
    pending.value = false
    void scrollDown()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}

function reset() {
  messages.value = []
  error.value = ''
}
</script>

<template>
  <Card class="gap-4">
    <CardHeader>
      <CardTitle class="flex items-center gap-2"><SparklesIcon class="size-4 text-primary" /> Помощник</CardTitle>
      <p class="text-sm text-muted-foreground">Спросите о задачах, полях, складах или погоде — ответ по данным портала.</p>
      <CardAction v-if="messages.length">
        <Button variant="ghost" size="sm" @click="reset"><RotateCcwIcon /> Новый разговор</Button>
      </CardAction>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <div v-if="messages.length || pending" ref="scroller" class="flex max-h-96 flex-col gap-4 overflow-y-auto">
        <div
          v-for="(m, i) in messages"
          :key="i"
          :class="m.role === 'user'
            ? 'max-w-[85%] self-end rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground'
            : 'max-w-full self-start whitespace-pre-line text-sm leading-relaxed'"
        >{{ m.content }}</div>
        <div v-if="pending" class="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner class="size-4" /> Смотрю данные…
        </div>
      </div>

      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

      <div v-if="!messages.length && !pending" class="flex flex-wrap gap-2">
        <Button v-for="s in suggestions" :key="s" variant="outline" size="sm" class="rounded-full" @click="send(s)">{{ s }}</Button>
      </div>

      <form class="flex items-end gap-2" @submit.prevent="send()">
        <Textarea
          v-model="draft"
          rows="1"
          maxlength="1000"
          placeholder="Ваш вопрос…"
          aria-label="Вопрос помощнику"
          class="max-h-32 min-h-9 resize-none"
          @keydown="onKeydown"
        />
        <Button type="submit" size="icon" :disabled="pending || !draft.trim()" aria-label="Отправить">
          <ArrowUpIcon />
        </Button>
      </form>
    </CardContent>
  </Card>
</template>
