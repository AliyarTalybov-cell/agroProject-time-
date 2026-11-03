<script setup lang="ts">
/**
 * Исправить рабочий день или добавить забытый.
 *
 * Причина обязательна: она уходит в журнал вместе с «было → стало», а день
 * в табеле помечается «Исправлено». Ниже — история прошлых исправлений.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Button } from '@/components/ui/shadcn/button'
import { Input } from '@/components/ui/shadcn/input'
import { Textarea } from '@/components/ui/shadcn/textarea'
import FormField from '@/components/ui/layout/FormField.vue'
import FormGrid from '@/components/ui/layout/FormGrid.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiDatePicker from '@/components/ui/UiDatePicker.vue'
import UiDateTimePicker from '@/components/ui/UiDateTimePicker.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  correctWorkDay,
  formatHoursShort,
  formatWorkMinutes,
  loadWorkDayEdits,
  moscowDate,
  type WorkDay,
  type WorkDayEdit,
} from '@/lib/timesheet'

const props = defineProps<{
  /** null — добавить забытый день. */
  day: WorkDay | null
  /** Подпись сотрудника в заголовке (когда правит руководитель). */
  personName?: string
  /** Имена тех, кто правил, по id. */
  nameOf: (userId: string | null) => string
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const pad = (n: number) => String(n).padStart(2, '0')
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const isNew = computed(() => !props.day)
const workDate = ref(props.day?.work_date ?? moscowDate(new Date(Date.now() - 86_400_000)))
const startedAt = ref(props.day ? toLocalInput(props.day.started_at) : `${workDate.value}T08:00`)
const endedAt = ref(props.day?.ended_at ? toLocalInput(props.day.ended_at) : props.day ? '' : `${workDate.value}T17:00`)
const breakMinutes = ref<number>(props.day?.break_minutes ?? 60)
const reason = ref('')
const saving = ref(false)
const error = ref<string | null>(null)
const edits = ref<WorkDayEdit[]>([])

onMounted(async () => {
  if (!props.day) return
  try {
    edits.value = await loadWorkDayEdits(props.day.id)
  } catch {
    edits.value = []
  }
})

/** Новый день: смена даты переносит и время начала/конца на эту дату. */
function onDateChange(d: string) {
  workDate.value = d
  if (!d) return
  startedAt.value = `${d}${startedAt.value.slice(10) || 'T08:00'}`
  endedAt.value = `${d}${endedAt.value.slice(10) || 'T17:00'}`
}

const durationMinutes = computed(() => {
  const s = Date.parse(startedAt.value)
  const e = Date.parse(endedAt.value)
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null
  return Math.round((e - s) / 60000)
})

const workedPreview = computed(() => {
  if (durationMinutes.value == null) return null
  return Math.max(0, durationMinutes.value - (Number(breakMinutes.value) || 0))
})

/* «Отработано» можно вписать самому: конец дня = начало + отработано + перерыв. */
const workedText = ref('')
const workedFocused = ref(false)
watch(
  workedPreview,
  (v) => {
    if (!workedFocused.value) workedText.value = v != null ? formatHoursShort(v) : ''
  },
  { immediate: true },
)

/** «10», «10:30», «10.5», «10,5» → минуты. */
function parseHours(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  const hm = /^(\d{1,2}):(\d{1,2})$/.exec(t)
  if (hm) return Number(hm[1]) * 60 + Number(hm[2])
  if (/^\d{1,2}(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60)
  return null
}

function onWorkedInput(text: string) {
  workedText.value = text
  const minutes = parseHours(text)
  const s = Date.parse(startedAt.value)
  if (minutes == null || Number.isNaN(s)) return
  const end = new Date(s + (minutes + (Number(breakMinutes.value) || 0)) * 60000)
  endedAt.value = toLocalInput(end.toISOString())
}

function onWorkedBlur() {
  workedFocused.value = false
  workedText.value = workedPreview.value != null ? formatHoursShort(workedPreview.value) : ''
}

const quickDates = computed(() => {
  const d1 = moscowDate(new Date(Date.now() - 86_400_000))
  const d2 = moscowDate(new Date(Date.now() - 2 * 86_400_000))
  return [
    { label: 'Вчера', value: d1 },
    { label: 'Позавчера', value: d2 },
  ]
})

const validation = computed<string | null>(() => {
  if (!startedAt.value || !endedAt.value) return 'Укажите начало и конец дня.'
  if (durationMinutes.value == null) return 'Конец дня должен быть позже начала.'
  if (durationMinutes.value > 24 * 60) return 'Рабочий день не может быть длиннее суток.'
  if (Date.parse(endedAt.value) > Date.now() + 5 * 60000) return 'Конец дня не может быть в будущем.'
  const b = Number(breakMinutes.value)
  if (!Number.isFinite(b) || b < 0) return 'Перерыв — число минут, не меньше нуля.'
  if (b >= durationMinutes.value) return 'Перерыв должен быть меньше длительности дня.'
  if (reason.value.trim().length < 3) return 'Напишите причину исправления.'
  return null
})

async function save() {
  if (validation.value || saving.value) {
    error.value = validation.value
    return
  }
  saving.value = true
  error.value = null
  try {
    await correctWorkDay({
      dayId: props.day?.id ?? null,
      workDate: workDate.value,
      startedAt: new Date(startedAt.value).toISOString(),
      endedAt: new Date(endedAt.value).toISOString(),
      breakMinutes: Math.round(Number(breakMinutes.value) || 0),
      reason: reason.value.trim(),
    })
    emit('saved')
  } catch (e) {
    error.value = formatSupabaseError(e) || 'Не удалось сохранить'
  } finally {
    saving.value = false
  }
}

const dtFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const t = (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : '—')

const title = computed(() => {
  if (isNew.value) return 'Добавить забытый день'
  const d = new Date(`${props.day!.work_date}T12:00:00`)
  return `Исправить день ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
})
</script>

<template>
  <UiModal :title="title" :description="personName" :max-width="560" :close-disabled="saving" @close="emit('close')">
    <form id="work-day-form" class="tw-scope grid gap-4" @submit.prevent="save">
      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <FormGrid :cols="2">
        <FormField v-if="isNew" label="Дата" wide required>
          <div class="flex flex-wrap gap-2">
            <UiDatePicker :model-value="workDate" :max="moscowDate()" :clearable="false" class="min-w-40 flex-1" @update:model-value="onDateChange" />
            <Button
              v-for="q in quickDates"
              :key="q.value"
              type="button"
              variant="outline"
              :class="workDate === q.value ? 'bg-accent text-accent-foreground' : ''"
              @click="onDateChange(q.value)"
            >
              {{ q.label }}
            </Button>
          </div>
        </FormField>
        <FormField label="Начало" required>
          <UiDateTimePicker v-model="startedAt" />
        </FormField>
        <FormField label="Конец" required :hint="isNew || day?.ended_at ? undefined : 'День не был закрыт — укажите, когда вы закончили.'">
          <UiDateTimePicker v-model="endedAt" />
        </FormField>
        <FormField label="Перерывы за день, мин" for="wd-break">
          <Input id="wd-break" v-model.number="breakMinutes" type="number" min="0" step="5" inputmode="numeric" />
        </FormField>
        <FormField label="Отработано, ч:мм" for="wd-worked" hint="Можно вписать — конец дня пересчитается.">
          <Input
            id="wd-worked"
            :model-value="workedText"
            inputmode="decimal"
            placeholder="8:00"
            class="tabular-nums"
            @focus="workedFocused = true"
            @blur="onWorkedBlur"
            @update:model-value="(v) => onWorkedInput(String(v))"
          />
        </FormField>
        <FormField :label="isNew ? 'Почему день не отмечен' : 'Причина исправления'" for="wd-reason" wide required :count="reason.length" :max="500">
          <Textarea id="wd-reason" v-model="reason" rows="2" maxlength="500" placeholder="Например: забыл закончить день на экране оператора" />
        </FormField>
      </FormGrid>

      <section v-if="edits.length" class="grid gap-2">
        <h3 class="text-sm font-medium">История исправлений</h3>
        <ul class="grid gap-2">
          <li v-for="e in edits" :key="e.id" class="bg-muted/40 grid gap-1 rounded-lg px-3 py-2 text-xs">
            <div class="text-muted-foreground flex flex-wrap justify-between gap-2">
              <span>{{ nameOf(e.edited_by) }}</span>
              <span class="tabular-nums">{{ dtFmt.format(new Date(e.edited_at)) }}</span>
            </div>
            <div class="tabular-nums">
              <template v-if="e.before">
                Было {{ t(e.before.started_at) }}–{{ t(e.before.ended_at) }}, перерыв {{ formatWorkMinutes(e.before.break_minutes) }} →
              </template>
              <template v-else>Добавлен день: </template>
              {{ t(e.after.started_at) }}–{{ t(e.after.ended_at) }}, перерыв {{ formatWorkMinutes(e.after.break_minutes) }}
            </div>
            <div>«{{ e.reason }}»</div>
          </li>
        </ul>
      </section>
    </form>

    <template #actions>
      <UiButton :disabled="saving" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" type="submit" form="work-day-form" :disabled="saving">{{ saving ? 'Сохранение…' : 'Сохранить' }}</UiButton>
    </template>
  </UiModal>
</template>
