<script setup lang="ts">
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, ref, watch } from 'vue'
import { Trash2 } from '@lucide/vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiConfirmModal from '@/components/ui/UiConfirmModal.vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Card, CardContent } from '@/components/ui/shadcn/card'
import { Input } from '@/components/ui/shadcn/input'
import { Label } from '@/components/ui/shadcn/label'
import { Separator } from '@/components/ui/shadcn/separator'
import { Switch } from '@/components/ui/shadcn/switch'
import { Textarea } from '@/components/ui/shadcn/textarea'
import type { EmployeeRole, EmployeeRow, PositionRow } from '@/lib/employeesSupabase'
import { deleteEmployee, updateEmployee } from '@/lib/employeesSupabase'
import { avatarColorByPosition } from '@/lib/avatarColors'
import UserAvatar from '@/components/UserAvatar.vue'

const props = defineProps<{
  open: boolean
  employee: EmployeeRow | null
  positions: PositionRow[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'updated'): void
}>()

const form = ref({
  fullName: '',
  email: '',
  phone: '',
  position: '',
  role: 'worker' as EmployeeRole,
  additionalInfo: '',
  active: true,
})

const busy = ref(false)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)
const confirmDelete = ref(false)

const createdAtLabel = computed(() => {
  const raw = props.employee?.created_at
  if (!raw) return '—'
  return new Date(raw).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
})

const lastLoginLabel = computed(() => {
  const raw = props.employee?.last_activity_at
  if (!raw) return 'Не входил'
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

function initials(name: string | null, email: string): string {
  const base = name?.trim() ? name.trim() : email.split('@')[0]
  const parts = base.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0]?.[0] || '?').toUpperCase()
}

const avatar = computed(() => {
  const e = props.employee
  if (!e) return '—'
  return initials(e.display_name, e.email)
})

const avatarBg = computed(() => {
  return avatarColorByPosition(form.value.position || props.employee?.position)
})

function close() {
  if (busy.value) return
  emit('close')
}

async function save() {
  if (!props.employee) return
  message.value = null
  busy.value = true
  try {
    const emailPrefix = props.employee.email.split('@')[0] || ''
    const trimmedFullName = form.value.fullName.trim()
    const resolvedFullName =
      trimmedFullName.length >= 2 ? trimmedFullName : emailPrefix.trim()

    if (resolvedFullName.length < 2) {
      throw new Error('Введите ФИО (минимум 2 символа).')
    }

    await updateEmployee({
      id: props.employee.id,
      fullName: resolvedFullName,
      email: form.value.email.trim().toLowerCase(),
      phone: form.value.phone.trim() || null,
      position: form.value.position || null,
      additionalInfo: form.value.additionalInfo.trim() || null,
      role: form.value.role,
      active: form.value.active,
    })
    message.value = { type: 'success', text: 'Изменения сохранены.' }
    emit('updated')
  } catch (e) {
    message.value = { type: 'error', text: e instanceof Error ? e.message : 'Не удалось сохранить изменения.' }
  } finally {
    busy.value = false
  }
}

async function doDelete() {
  if (!props.employee) return
  busy.value = true
  message.value = null
  try {
    await deleteEmployee(props.employee.id)
    emit('updated')
    emit('close')
  } catch (e) {
    message.value = { type: 'error', text: e instanceof Error ? e.message : 'Не удалось удалить сотрудника.' }
  } finally {
    busy.value = false
    confirmDelete.value = false
  }
}

watch(
  () => props.employee?.id,
  () => {
    const e = props.employee
    if (!e) return
    const emailPrefix = e.email?.split('@')[0] || ''
    form.value.fullName = (e.display_name && e.display_name.trim().length >= 2) ? e.display_name : emailPrefix
    form.value.email = e.email || ''
    form.value.phone = e.phone || ''
    form.value.position = e.position || ''
    form.value.role = (e.role === 'manager' ? 'manager' : 'worker') as EmployeeRole
    form.value.additionalInfo = e.additional_info || ''
    form.value.active = e.active !== false
    message.value = null
    confirmDelete.value = false
  },
  { immediate: true },
)
</script>

<template>
  <UiModal
    v-if="open && employee"
    title="Редактирование сотрудника"
    :description="employee.email || undefined"
    :max-width="760"
    :close-disabled="busy"
    @close="close"
  >
    <Alert v-if="message" :variant="message.type === 'error' ? 'destructive' : 'default'">
      <AlertDescription>{{ message.text }}</AlertDescription>
    </Alert>

    <div class="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <aside class="flex flex-col items-center gap-4">
        <UserAvatar class="size-24 text-2xl" :style="{ background: avatarBg }" :url="employee?.avatar_url" :initials="avatar" />
        <Card class="w-full gap-3 py-4">
          <CardContent class="grid gap-3 px-4">
            <div class="flex items-center justify-between gap-3">
              <div class="grid gap-1">
                <span class="text-muted-foreground text-xs">Статус аккаунта</span>
                <span class="flex items-center gap-2 text-sm font-medium">
                  <span class="size-2 rounded-full" :class="form.active ? 'bg-primary' : 'bg-muted-foreground'" aria-hidden="true" />
                  {{ form.active ? 'Активен' : 'Неактивен' }}
                </span>
              </div>
              <Switch v-model="form.active" aria-label="Активен: доступ к системе включён" />
            </div>
            <Separator />
            <div class="flex items-center justify-between gap-2 text-xs">
              <span class="text-muted-foreground">Последний вход</span>
              <span class="text-right">{{ lastLoginLabel }}</span>
            </div>
            <div class="flex items-center justify-between gap-2 text-xs">
              <span class="text-muted-foreground">Создан</span>
              <span class="text-right">{{ createdAtLabel }}</span>
            </div>
          </CardContent>
        </Card>
      </aside>

      <section class="grid content-start gap-4 sm:grid-cols-2">
        <div class="grid gap-2 sm:col-span-2">
          <Label for="eem-name">ФИО сотрудника</Label>
          <Input id="eem-name" v-model="form.fullName" type="text" placeholder="Фамилия Имя Отчество" />
        </div>
        <div class="grid gap-2">
          <Label for="eem-email">Email адрес</Label>
          <Input id="eem-email" v-model="form.email" type="email" placeholder="example@agro.ru" />
        </div>
        <div class="grid gap-2">
          <Label for="eem-phone">Номер телефона</Label>
          <Input id="eem-phone" v-model="form.phone" type="tel" placeholder="+7 (___) ___-__-__" />
        </div>
        <div class="grid gap-2">
          <Label for="eem-pos">Должность</Label>
          <UiSelect id="eem-pos" v-model="form.position" :options="positions.map((p) => ({ value: p.name, label: p.name }))" placeholder="Выберите должность" block />
        </div>
        <div class="grid gap-2">
          <Label for="eem-role">Роль в системе</Label>
          <UiSelect id="eem-role" v-model="form.role" :options="[{ value: 'worker', label: 'Сотрудник' }, { value: 'manager', label: 'Руководитель' }]" block />
        </div>
        <div class="grid gap-2 sm:col-span-2">
          <Label for="eem-notes">Заметки (внутренние)</Label>
          <Textarea id="eem-notes" v-model="form.additionalInfo" rows="3" placeholder="Дополнительная информация о квалификации или доступах…" />
        </div>
      </section>
    </div>

    <template #actions>
      <UiButton variant="danger" class="sm:mr-auto" :disabled="busy" @click="confirmDelete = true">
        <Trash2 />
        Удалить
      </UiButton>
      <UiButton :disabled="busy" @click="close">Закрыть</UiButton>
      <UiButton variant="primary" :disabled="busy" @click="save">
        {{ busy ? 'Сохранение…' : 'Сохранить изменения' }}
      </UiButton>
    </template>
  </UiModal>

  <UiConfirmModal
    v-if="confirmDelete"
    title="Удалить сотрудника?"
    text="Действие необратимо: будет удалён пользователь и профиль."
    :busy="busy"
    @cancel="confirmDelete = false"
    @confirm="doDelete"
  />
</template>
