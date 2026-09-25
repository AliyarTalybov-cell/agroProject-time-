<script setup lang="ts">
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, ref, watch } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Input } from '@/components/ui/shadcn/input'
import { Label } from '@/components/ui/shadcn/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/shadcn/radio-group'
import { Textarea } from '@/components/ui/shadcn/textarea'
import { createEmployee, type EmployeeRole, type PositionRow } from '@/lib/employeesSupabase'

const props = defineProps<{
  open: boolean
  positions: PositionRow[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created'): void
}>()

const form = ref({
  fullName: '',
  email: '',
  phone: '',
  position: '',
  role: 'worker' as EmployeeRole,
  password: '',
  passwordConfirm: '',
  additionalInfo: '',
})

const roles: { value: EmployeeRole; title: string; desc: string }[] = [
  { value: 'worker', title: 'Сотрудник', desc: 'Базовый доступ к системе' },
  { value: 'manager', title: 'Руководитель', desc: 'Расширенные права управления' },
]

const submitting = ref(false)
const message = ref<{ type: 'success' | 'error'; text: string } | null>(null)

const canSubmit = computed(() => {
  return (
    form.value.fullName.trim().length >= 2 &&
    form.value.email.trim().includes('@') &&
    form.value.password.length >= 6 &&
    form.value.password === form.value.passwordConfirm
  )
})

function close() {
  if (submitting.value) return
  emit('close')
}

async function submit() {
  message.value = null
  if (!canSubmit.value) {
    message.value = { type: 'error', text: 'Проверьте поля: email и пароль (мин. 6 символов) и подтверждение.' }
    return
  }
  submitting.value = true
  try {
    await createEmployee({
      fullName: form.value.fullName.trim(),
      email: form.value.email.trim().toLowerCase(),
      phone: form.value.phone.trim() || null,
      position: form.value.position.trim() || null,
      additionalInfo: form.value.additionalInfo.trim() || null,
      role: form.value.role,
      password: form.value.password,
    })
    message.value = { type: 'success', text: 'Сотрудник создан.' }
    emit('created')
    emit('close')
    form.value = {
      fullName: '',
      email: '',
      phone: '',
      position: '',
      role: 'worker',
      password: '',
      passwordConfirm: '',
      additionalInfo: '',
    }
  } catch (e) {
    const text = e instanceof Error ? e.message : 'Не удалось создать сотрудника.'
    message.value = { type: 'error', text }
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.open,
  (v) => {
    if (!v) message.value = null
  },
)
</script>

<template>
  <UiModal v-if="open" title="Новый сотрудник" description="Учётная запись с доступом к порталу" :max-width="600" :close-disabled="submitting" @close="close">
    <Alert v-if="message" :variant="message.type === 'error' ? 'destructive' : 'default'">
      <AlertDescription>{{ message.text }}</AlertDescription>
    </Alert>

    <div class="grid gap-4 sm:grid-cols-2">
      <div class="grid gap-2 sm:col-span-2">
        <Label for="emp-fullname">Фамилия Имя Отчество</Label>
        <Input id="emp-fullname" v-model="form.fullName" type="text" placeholder="Иванов Иван Иванович" autocomplete="name" />
      </div>

      <div class="grid gap-2">
        <Label for="emp-email">Электронная почта</Label>
        <Input id="emp-email" v-model="form.email" type="email" placeholder="example@agro.ru" autocomplete="email" />
      </div>

      <div class="grid gap-2">
        <Label for="emp-phone">Телефон</Label>
        <Input id="emp-phone" v-model="form.phone" type="tel" placeholder="+7 (___) ___-__-__" autocomplete="tel" />
      </div>

      <div class="grid gap-2 sm:col-span-2">
        <Label for="emp-position">Должность</Label>
        <UiSelect id="emp-position" v-model="form.position" :options="positions.map((p) => ({ value: p.name, label: p.name }))" placeholder="Выберите должность" block />
      </div>

      <div class="grid gap-2 sm:col-span-2">
        <Label>Роль доступа</Label>
        <RadioGroup v-model="form.role" class="grid gap-3 sm:grid-cols-2">
          <Label
            v-for="r in roles"
            :key="r.value"
            :for="`emp-role-${r.value}`"
            class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
          >
            <RadioGroupItem :id="`emp-role-${r.value}`" :value="r.value" class="mt-0.5" />
            <span class="grid gap-1">
              <span class="text-sm font-medium">{{ r.title }}</span>
              <span class="text-muted-foreground text-xs">{{ r.desc }}</span>
            </span>
          </Label>
        </RadioGroup>
      </div>

      <div class="grid gap-2">
        <Label for="emp-pass">Пароль</Label>
        <Input id="emp-pass" v-model="form.password" type="password" placeholder="Минимум 6 символов" autocomplete="new-password" />
      </div>

      <div class="grid gap-2">
        <Label for="emp-pass2">Подтверждение пароля</Label>
        <Input id="emp-pass2" v-model="form.passwordConfirm" type="password" placeholder="Повторите пароль" autocomplete="new-password" />
      </div>

      <div class="grid gap-2 sm:col-span-2">
        <Label for="emp-notes">Заметки (внутренние)</Label>
        <Textarea id="emp-notes" v-model="form.additionalInfo" rows="3" placeholder="Дополнительная информация..." />
      </div>
    </div>

    <template #actions>
      <UiButton :disabled="submitting" @click="close">Отмена</UiButton>
      <UiButton variant="primary" :disabled="submitting || !canSubmit" @click="submit">
        {{ submitting ? 'Создание…' : 'Сохранить' }}
      </UiButton>
    </template>
  </UiModal>
</template>
