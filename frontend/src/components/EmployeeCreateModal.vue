<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
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
  <teleport to="body">
    <div v-if="open" class="emp-modal-backdrop" role="dialog" aria-modal="true" aria-label="Новый сотрудник" @click.self="close">
      <div class="emp-modal">
        <ModalCloseButton :absolute="true" @click="close" />

        <div class="emp-modal-body">
          <div v-if="message" class="emp-modal-message" :class="message.type === 'success' ? 'emp-modal-message--success' : 'emp-modal-message--error'">
            {{ message.text }}
          </div>

          <div class="emp-form-grid">
            <div class="emp-field emp-field--full">
              <label class="emp-label" for="emp-fullname">Фамилия Имя Отчество</label>
              <input id="emp-fullname" v-model="form.fullName" class="emp-input" type="text" placeholder="Иванов Иван Иванович" autocomplete="name" />
            </div>

            <div class="emp-field">
              <label class="emp-label" for="emp-email">Электронная почта</label>
              <input id="emp-email" v-model="form.email" class="emp-input" type="email" placeholder="example@agro.ru" autocomplete="email" />
            </div>

            <div class="emp-field">
              <label class="emp-label" for="emp-phone">Телефон</label>
              <input id="emp-phone" v-model="form.phone" class="emp-input" type="tel" placeholder="+7 (___) ___-__-__" autocomplete="tel" />
            </div>

            <div class="emp-field emp-field--full">
              <label class="emp-label" for="emp-position">Должность</label>
              <select id="emp-position" v-model="form.position" class="emp-input emp-select">
                <option value="" disabled>Выберите должность</option>
                <option v-for="p in positions" :key="p.id" :value="p.name">{{ p.name }}</option>
              </select>
            </div>

            <div class="emp-field emp-field--full">
              <label class="emp-label">Роль доступа</label>
              <div class="emp-role-grid">
                <label class="emp-role-card" :class="{ 'emp-role-card--active': form.role === 'worker' }">
                  <input v-model="form.role" class="emp-role-radio" type="radio" value="worker" />
                  <div class="emp-role-title">Сотрудник</div>
                  <div class="emp-role-desc">Базовый доступ к системе</div>
                </label>
                <label class="emp-role-card" :class="{ 'emp-role-card--active': form.role === 'manager' }">
                  <input v-model="form.role" class="emp-role-radio" type="radio" value="manager" />
                  <div class="emp-role-title">Руководитель</div>
                  <div class="emp-role-desc">Расширенные права управления</div>
                </label>
              </div>
            </div>

            <div class="emp-field">
              <label class="emp-label" for="emp-pass">Пароль</label>
              <input id="emp-pass" v-model="form.password" class="emp-input" type="password" placeholder="Минимум 6 символов" autocomplete="new-password" />
            </div>

            <div class="emp-field">
              <label class="emp-label" for="emp-pass2">Подтверждение пароля</label>
              <input id="emp-pass2" v-model="form.passwordConfirm" class="emp-input" type="password" placeholder="Повторите пароль" autocomplete="new-password" />
            </div>

            <div class="emp-field emp-field--full">
              <label class="emp-label" for="emp-notes">Заметки (внутренние)</label>
              <textarea id="emp-notes" v-model="form.additionalInfo" class="emp-input emp-textarea" rows="3" placeholder="Дополнительная информация..."></textarea>
            </div>
          </div>
        </div>

        <div class="emp-modal-footer">
          <button type="button" class="emp-btn emp-btn--ghost" :disabled="submitting" @click="close">Отмена</button>
          <button type="button" class="emp-btn emp-btn--primary" :disabled="submitting || !canSubmit" @click="submit">
            {{ submitting ? 'Создание…' : 'Сохранить' }}
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.emp-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: auto;
}

.emp-modal {
  position: relative;
  width: 100%;
  max-width: 560px;
  max-height: calc(100vh - 40px);
  max-height: calc(100dvh - 40px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 20px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-card);
}

[data-theme='dark'] .emp-modal {
  background: var(--bg-elevated);
  border-color: var(--border-color);
}

/* .emp-modal-close positioning/sizing — absolute positioning now via .modal-close--absolute */

.emp-modal-body {
  padding: 28px 24px 20px;
  overflow: auto;
}

.emp-modal-message {
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 0.9375rem;
  margin-bottom: 14px;
  border: 1px solid transparent;
}
.emp-modal-message--success {
  background: color-mix(in srgb, var(--accent-green) 14%, transparent);
  border-color: color-mix(in srgb, var(--accent-green) 28%, var(--border-color));
  color: #166534;
}
.emp-modal-message--error {
  background: color-mix(in srgb, var(--danger-red) 12%, transparent);
  border-color: color-mix(in srgb, var(--danger-red) 24%, transparent);
  color: var(--danger-red);
}

[data-theme='dark'] .emp-modal-message--success {
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  border-color: color-mix(in srgb, var(--accent-green) 34%, var(--border-color));
  color: color-mix(in srgb, white 82%, var(--accent-green));
}
[data-theme='dark'] .emp-modal-message--error {
  background: color-mix(in srgb, var(--danger-red) 22%, transparent);
  border-color: color-mix(in srgb, var(--danger-red) 36%, transparent);
  color: color-mix(in srgb, white 80%, var(--danger-red));
}

.emp-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.emp-field--full {
  grid-column: 1 / -1;
}

.emp-label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.emp-input {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 0.9375rem;
  background: var(--bg-elevated);
  color: var(--text-primary);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.emp-input:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.emp-input::placeholder {
  color: var(--text-muted);
}
[data-theme='dark'] .emp-input {
  background: color-mix(in srgb, var(--bg-elevated) 86%, black);
  border-color: var(--border-color);
}
[data-theme='dark'] .emp-input:focus {
  background: color-mix(in srgb, var(--bg-elevated) 94%, black);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.emp-textarea {
  resize: vertical;
  min-height: 96px;
}

.emp-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 40px;
}
[data-theme='dark'] .emp-select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23e2e8f0' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-size: 16px 16px;
  background-position: right 14px center;
}

.emp-role-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.emp-role-card {
  border: 2px solid var(--border-color);
  border-radius: 12px;
  padding: 14px 16px;
  background: var(--bg-elevated);
  cursor: pointer;
  position: relative;
  transition: border-color 0.15s ease, background 0.15s ease;
}
[data-theme='dark'] .emp-role-card {
  background: color-mix(in srgb, var(--bg-elevated) 78%, black);
  border-color: var(--border-color);
}
.emp-role-card--active {
  border-color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 8%, transparent);
}
[data-theme='dark'] .emp-role-card--active {
  border-color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 12%, transparent);
}
.emp-role-radio {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.emp-role-title {
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 2px;
}
.emp-role-desc {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.emp-modal-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-overlay);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
[data-theme='dark'] .emp-modal-footer {
  background: var(--bg-overlay);
  border-top-color: var(--border-color);
}

.emp-btn {
  border-radius: 12px;
  padding: 11px 20px;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.emp-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.emp-btn--ghost {
  background: var(--bg-elevated);
  border-color: var(--border-color);
  color: var(--text-primary);
}
.emp-btn--ghost:hover:not(:disabled) {
  background: var(--bg-panel-hover);
  border-color: color-mix(in srgb, var(--accent-green) 30%, var(--border-color));
}
[data-theme='dark'] .emp-btn--ghost {
  background: color-mix(in srgb, var(--bg-elevated) 90%, black);
  border-color: var(--border-color);
}
.emp-btn--primary {
  background: var(--accent-green);
  color: #fff;
}
.emp-btn--primary:hover:not(:disabled) {
  background: var(--accent-green-hover);
}

@media (max-width: 720px) {
  .emp-form-grid {
    grid-template-columns: 1fr;
  }
  .emp-role-grid {
    grid-template-columns: 1fr;
  }
}
</style>

