<script setup lang="ts">
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
  <UiModal :title="c ? 'Контрагент' : 'Новый контрагент'" :max-width="620" :close-disabled="saving" @close="emit('close')">
    <div class="ui-form-row ui-form-row--two">
      <div class="ui-form-field">
        <label class="ui-form-label">Название *</label>
        <input v-model.trim="form.name" class="ui-form-input" placeholder="ООО «Агроторг»" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Роль *</label>
        <select v-model="form.kind" class="ui-form-select">
          <option v-for="k in COUNTERPARTY_KINDS" :key="k" :value="k">{{ counterpartyKindLabel(k) }}</option>
        </select>
      </div>
    </div>
    <div class="ui-form-row ui-form-row--two">
      <div class="ui-form-field">
        <label class="ui-form-label">ИНН</label>
        <input v-model.trim="form.inn" inputmode="numeric" class="ui-form-input" />
        <p v-if="!innOk" class="ui-form-hint" style="color: var(--danger-red)">10 или 12 цифр</p>
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">КПП</label>
        <input v-model.trim="form.kpp" inputmode="numeric" class="ui-form-input" />
        <p v-if="!kppOk" class="ui-form-hint" style="color: var(--danger-red)">9 цифр</p>
      </div>
    </div>
    <div class="ui-form-field">
      <label class="ui-form-label">Адрес</label>
      <input v-model.trim="form.address" class="ui-form-input" />
    </div>
    <div class="ui-form-row ui-form-row--three">
      <div class="ui-form-field">
        <label class="ui-form-label">Контактное лицо</label>
        <input v-model.trim="form.contact_person" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Телефон</label>
        <input v-model.trim="form.phone" type="tel" class="ui-form-input" />
      </div>
      <div class="ui-form-field">
        <label class="ui-form-label">Почта</label>
        <input v-model.trim="form.email" type="email" class="ui-form-input" />
      </div>
    </div>
    <div class="ui-form-field">
      <label class="ui-form-label">Комментарий</label>
      <textarea v-model.trim="form.comment" class="ui-form-textarea" rows="2" />
    </div>
    <label v-if="c" class="ui-muted" style="display: inline-flex; gap: 8px; align-items: center">
      <input v-model="form.active" type="checkbox" /> Работаем с ним (снимите, чтобы скрыть из списков выбора)
    </label>
    <p v-if="error" class="ui-form-error">{{ error }}</p>
    <template #actions>
      <UiButton :disabled="saving" @click="emit('close')">Отмена</UiButton>
      <UiButton variant="primary" :disabled="saving || !canSave" @click="save">{{ saving ? 'Сохранение…' : 'Сохранить' }}</UiButton>
    </template>
  </UiModal>
</template>
