<script setup lang="ts">
import { Input } from '@/components/ui/shadcn/input'
import { Checkbox } from '@/components/ui/shadcn/checkbox'
import { Label } from '@/components/ui/shadcn/label'
import { Textarea } from '@/components/ui/shadcn/textarea'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import FormGrid from '@/components/ui/layout/FormGrid.vue'
import FormField from '@/components/ui/layout/FormField.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/** Контрагент: покупатель и/или поставщик зерна. */
import { computed, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import { COUNTERPARTY_KINDS, counterpartyKindLabel, saveCounterparty, type Counterparty } from '@/lib/stockLedger'

const props = defineProps<{ counterparty?: Counterparty | null }>()
const emit = defineEmits<{ close: []; done: [] }>()

const c = props.counterparty
const form = ref({
  name: c?.name ?? '',
  kind: c?.kind ?? 'buyer',
  inn: c?.inn ?? '',
  kpp: c?.kpp ?? '',
  address: c?.address ?? '',
  phone: c?.phone ?? '',
  email: c?.email ?? '',
  contact_person: c?.contact_person ?? '',
  comment: c?.comment ?? '',
  active: c?.active ?? true,
})
const saving = ref(false)
const error = ref<string | null>(null)

const innOk = computed(() => !form.value.inn.trim() || /^\d{10}(\d{2})?$/.test(form.value.inn.trim()))
const kppOk = computed(() => !form.value.kpp.trim() || /^\d{9}$/.test(form.value.kpp.trim()))
const canSave = computed(() => form.value.name.trim().length > 0 && innOk.value && kppOk.value)

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = null
  try {
    await saveCounterparty(c?.id ?? null, { ...form.value })
    emit('done')
  } catch (e) {
    const msg = formatSupabaseError(e)
    error.value = msg.includes('counterparties_inn_uidx') ? 'Контрагент с таким ИНН уже есть' : msg
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiModal :title="c ? 'Контрагент' : 'Новый контрагент'" :max-width="560" :close-disabled="saving" @close="emit('close')">
    <form id="counterparty-form" class="tw-scope" @submit.prevent="save">
      <FormGrid :cols="2">
        <Alert v-if="error" variant="destructive" class="sm:col-span-full">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <FormField label="Название" for="cp-name" required>
          <Input id="cp-name" v-model.trim="form.name" placeholder="ООО «Агроторг»" />
        </FormField>
        <FormField label="Роль">
          <UiSelect v-model="form.kind" block aria-label="Роль" :options="COUNTERPARTY_KINDS.map((k) => ({ value: k, label: String(counterpartyKindLabel(k)) }))" />
        </FormField>
        <FormField label="ИНН" for="cp-inn" :error="!innOk && '10 или 12 цифр'">
          <Input id="cp-inn" v-model.trim="form.inn" inputmode="numeric" :aria-invalid="!innOk || undefined" />
        </FormField>
        <FormField label="КПП" for="cp-kpp" :error="!kppOk && '9 цифр'">
          <Input id="cp-kpp" v-model.trim="form.kpp" inputmode="numeric" :aria-invalid="!kppOk || undefined" />
        </FormField>
        <FormField label="Адрес" for="cp-address" wide>
          <Input id="cp-address" v-model.trim="form.address" />
        </FormField>
        <FormField label="Контактное лицо" for="cp-contact" wide>
          <Input id="cp-contact" v-model.trim="form.contact_person" />
        </FormField>
        <FormField label="Телефон" for="cp-phone">
          <Input id="cp-phone" v-model.trim="form.phone" type="tel" />
        </FormField>
        <FormField label="Почта" for="cp-email">
          <Input id="cp-email" v-model.trim="form.email" type="email" />
        </FormField>
        <FormField label="Комментарий" for="cp-comment" wide>
          <Textarea id="cp-comment" v-model.trim="form.comment" rows="2" />
        </FormField>
        <FormField v-if="c" wide hint="Снимите отметку, чтобы скрыть контрагента из списков выбора.">
          <div class="flex items-center gap-2">
            <Checkbox id="cp-active" v-model="form.active" />
            <Label for="cp-active" class="font-normal">Работаем с ним</Label>
          </div>
        </FormField>
      </FormGrid>
    </form>
    <template #actions>
      <UiButton :disabled="saving" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" type="submit" form="counterparty-form" :disabled="saving || !canSave">{{ saving ? 'Сохранение…' : 'Сохранить' }}</UiButton>
    </template>
  </UiModal>
</template>
