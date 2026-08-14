<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import type { EmployeeRole, EmployeeRow, PositionRow } from '@/lib/employeesSupabase'
import { deleteEmployee, updateEmployee } from '@/lib/employeesSupabase'
import { avatarColorByPosition } from '@/lib/avatarColors'
import UiDeleteButton from '@/components/UiDeleteButton.vue'
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
  <teleport to="body">
    <div v-if="open && employee" class="eem-backdrop" role="dialog" aria-modal="true" aria-label="Редактирование сотрудника" @click.self="close">
      <div class="eem-modal">
        <ModalCloseButton :absolute="true" @click="close" />

        <div class="eem-body">
          <div v-if="message" class="eem-msg" :class="message.type === 'success' ? 'eem-msg--success' : 'eem-msg--error'">
            {{ message.text }}
          </div>

          <div class="eem-layout">
            <aside class="eem-aside">
              <UserAvatar class="eem-avatar" :style="{ background: avatarBg }" :url="employee?.avatar_url" :initials="avatar" />
              <div class="eem-status-card">
                <div class="eem-status-row">
                  <div>
                    <div class="eem-status-label">Статус аккаунта</div>
                    <div class="eem-status-value">
                      <span class="eem-dot" :class="{ 'eem-dot--off': !form.active }" aria-hidden="true"></span>
                      {{ form.active ? 'Активен' : 'Неактивен' }}
                    </div>
                  </div>
                  <label class="eem-acc-switch" for="eem-account-active-switch" title="Включить или отключить доступ">
                    <input
                      id="eem-account-active-switch"
                      v-model="form.active"
                      type="checkbox"
                      class="eem-acc-switch-input"
                      role="switch"
                      :aria-checked="form.active"
                      aria-label="Активен: доступ к системе включён"
                    />
                    <span class="eem-acc-switch-slider" aria-hidden="true" />
                  </label>
                </div>
                <div class="eem-meta-row">
                  <span class="eem-meta-label">Последний вход</span>
                  <span class="eem-meta-value">{{ lastLoginLabel }}</span>
                </div>
                <div class="eem-meta-row">
                  <span class="eem-meta-label">Создан</span>
                  <span class="eem-meta-value">{{ createdAtLabel }}</span>
                </div>
              </div>
            </aside>

            <section class="eem-form">
              <div class="eem-grid">
                <div class="eem-field eem-field--full">
                  <label class="eem-label" for="eem-name">ФИО сотрудника</label>
                  <input id="eem-name" v-model="form.fullName" class="eem-input" type="text" placeholder="Фамилия Имя Отчество" />
                </div>

                <div class="eem-field">
                  <label class="eem-label" for="eem-email">Email адрес</label>
                  <input id="eem-email" v-model="form.email" class="eem-input" type="email" placeholder="example@agro.ru" />
                </div>

                <div class="eem-field">
                  <label class="eem-label" for="eem-phone">Номер телефона</label>
                  <input id="eem-phone" v-model="form.phone" class="eem-input" type="tel" placeholder="+7 (___) ___-__-__" />
                </div>

                <div class="eem-field">
                  <label class="eem-label" for="eem-pos">Должность</label>
                  <select id="eem-pos" v-model="form.position" class="eem-input eem-select">
                    <option value="" disabled>Выберите должность</option>
                    <option v-for="p in positions" :key="p.id" :value="p.name">{{ p.name }}</option>
                  </select>
                </div>

                <div class="eem-field">
                  <label class="eem-label" for="eem-role">Роль в системе</label>
                  <select id="eem-role" v-model="form.role" class="eem-input eem-select">
                    <option value="worker">Сотрудник</option>
                    <option value="manager">Руководитель</option>
                  </select>
                </div>

                <div class="eem-field eem-field--full">
                  <label class="eem-label" for="eem-notes">Заметки (внутренние)</label>
                  <textarea id="eem-notes" v-model="form.additionalInfo" class="eem-input eem-textarea" rows="3" placeholder="Дополнительная информация о квалификации или доступах…"></textarea>
                </div>
              </div>
            </section>
          </div>
        </div>

        <footer class="eem-footer">
          <div class="eem-footer-delete">
            <UiDeleteButton size="md" wide :disabled="busy" @click="confirmDelete = true" />
          </div>
          <div class="eem-actions">
            <button type="button" class="eem-btn eem-btn--ghost" :disabled="busy" @click="close">Закрыть</button>
            <button type="button" class="eem-btn eem-btn--primary" :disabled="busy" @click="save">
              {{ busy ? 'Сохранение…' : 'Сохранить изменения' }}
            </button>
          </div>
        </footer>

        <div v-if="confirmDelete" class="eem-confirm" @click.self="confirmDelete = false">
          <div class="eem-confirm-modal">
            <div class="eem-confirm-title">Удалить сотрудника?</div>
            <div class="eem-confirm-text">Действие необратимо: будет удалён пользователь и профиль.</div>
            <div class="eem-confirm-actions">
              <button type="button" class="eem-btn eem-btn--ghost" :disabled="busy" @click="confirmDelete = false">Отмена</button>
              <UiDeleteButton size="md" :loading="busy" :disabled="busy" @click="doDelete" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.eem-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1400;
  background: var(--modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: auto;
}
.eem-modal {
  position: relative;
  width: 100%;
  max-width: 900px;
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
[data-theme='dark'] .eem-modal {
  background: var(--bg-elevated);
  border-color: var(--border-color);
}
/* .eem-close positioning/sizing — absolute positioning now via .modal-close--absolute */
.eem-body {
  padding: 28px 24px 20px;
  overflow: auto;
}
.eem-msg {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid transparent;
  margin-bottom: 16px;
  font-size: 0.9375rem;
}
.eem-msg--success {
  background: color-mix(in srgb, var(--accent-green) 14%, transparent);
  border-color: color-mix(in srgb, var(--accent-green) 28%, var(--border-color));
  color: #166534;
}
.eem-msg--error {
  background: color-mix(in srgb, var(--danger-red) 12%, transparent);
  border-color: color-mix(in srgb, var(--danger-red) 24%, transparent);
  color: var(--danger-red);
}
[data-theme='dark'] .eem-msg--success {
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  border-color: color-mix(in srgb, var(--accent-green) 34%, var(--border-color));
  color: color-mix(in srgb, white 82%, var(--accent-green));
}
[data-theme='dark'] .eem-msg--error {
  background: color-mix(in srgb, var(--danger-red) 22%, transparent);
  border-color: color-mix(in srgb, var(--danger-red) 36%, transparent);
  color: color-mix(in srgb, white 80%, var(--danger-red));
}
.eem-layout {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 28px;
  align-items: start;
}
@media (max-width: 760px) {
  .eem-layout {
    grid-template-columns: 1fr;
  }
}
.eem-aside {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.eem-avatar {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--accent-green);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.25rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
[data-theme='dark'] .eem-avatar {
  background: var(--accent-green);
}
.eem-status-card {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 14px 12px;
  background: var(--bg-overlay);
}
[data-theme='dark'] .eem-status-card {
  background: var(--bg-overlay);
  border-color: var(--border-color);
}
.eem-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.eem-meta-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed color-mix(in srgb, var(--border-color) 72%, transparent);
}
.eem-meta-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-secondary);
}
.eem-meta-value {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  text-align: right;
}
.eem-status-label {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-primary);
}
.eem-status-value {
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--accent-green);
}
.eem-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-green);
}
.eem-dot--off {
  background: #9ca3af;
}
/* Переключатель статуса (Uiverse / mrhyddenn), масштаб −25% */
.eem-acc-switch {
  font-size: calc(17px * 0.75);
  position: relative;
  display: inline-block;
  width: calc(62px * 0.75);
  height: calc(35px * 0.75);
  flex-shrink: 0;
  cursor: pointer;
  margin: 0;
}

.eem-acc-switch-input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
  margin: 0;
}

.eem-acc-switch-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  bottom: 0;
  background: #fff;
  transition: background-color 0.4s ease, border-color 0.4s ease;
  border-radius: calc(30px * 0.75);
  border: 1px solid #ccc;
}

.eem-acc-switch-slider::before {
  position: absolute;
  content: '';
  height: 1.9em;
  width: 1.9em;
  border-radius: calc(16px * 0.75);
  left: calc(1.2px * 0.75);
  top: 50%;
  transform: translateY(-50%);
  background-color: white;
  box-shadow: 0 calc(2px * 0.75) calc(5px * 0.75) #999999;
  transition: transform 0.4s ease;
}

.eem-acc-switch-input:checked + .eem-acc-switch-slider {
  background-color: var(--accent-green);
  border: 1px solid transparent;
}

.eem-acc-switch-input:checked + .eem-acc-switch-slider::before {
  transform: translate(calc(1.5em), -50%);
}

.eem-acc-switch-input:focus-visible + .eem-acc-switch-slider {
  outline: calc(2px * 0.75) solid color-mix(in srgb, var(--accent-green) 75%, #333);
  outline-offset: calc(3px * 0.75);
}

[data-theme='dark'] .eem-acc-switch-slider {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.22);
}

[data-theme='dark'] .eem-acc-switch-input:checked + .eem-acc-switch-slider {
  background-color: var(--accent-green);
  border-color: transparent;
}
.eem-form {
  min-width: 0;
}
.eem-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.eem-field--full {
  grid-column: 1 / -1;
}
@media (max-width: 520px) {
  .eem-grid {
    grid-template-columns: 1fr;
  }
}
.eem-label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.eem-input {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 0.9375rem;
  background: var(--bg-elevated);
  color: var(--text-primary);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.eem-input:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.eem-input::placeholder {
  color: var(--text-muted);
}
[data-theme='dark'] .eem-input {
  background: color-mix(in srgb, var(--bg-elevated) 86%, black);
  border-color: var(--border-color);
}
[data-theme='dark'] .eem-input:focus {
  background: color-mix(in srgb, var(--bg-elevated) 94%, black);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.eem-textarea {
  resize: vertical;
  min-height: 100px;
}
.eem-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 40px;
}
[data-theme='dark'] .eem-select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-size: 16px 16px;
  background-position: right 14px center;
}
.eem-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: var(--bg-overlay);
  overflow: visible;
}
[data-theme='dark'] .eem-footer {
  background: var(--bg-overlay);
  border-top-color: var(--border-color);
}
.eem-footer-delete {
  flex: 0 0 auto;
  min-width: auto;
  display: flex;
  align-items: center;
  overflow: visible;
}
.eem-actions {
  display: flex;
  gap: 12px;
}
.eem-btn {
  border-radius: 12px;
  padding: 11px 20px;
  font-size: 0.9375rem;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
}
.eem-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.eem-btn--ghost {
  background: var(--bg-elevated);
  border-color: var(--border-color);
  color: var(--text-primary);
}
.eem-btn--ghost:hover:not(:disabled) {
  background: var(--bg-panel-hover);
  border-color: color-mix(in srgb, var(--accent-green) 30%, var(--border-color));
}
.eem-btn--primary {
  background: var(--accent-green);
  color: #fff;
}
.eem-btn--primary:hover:not(:disabled) {
  background: var(--accent-green-hover);
}
[data-theme='dark'] .eem-btn--ghost {
  background: color-mix(in srgb, var(--bg-elevated) 90%, black);
  border-color: var(--border-color);
}
.eem-confirm {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: var(--modal-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.eem-confirm-modal {
  width: 100%;
  max-width: 420px;
  border-radius: 16px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-card);
  padding: 20px;
}
[data-theme='dark'] .eem-confirm-modal {
  background: var(--bg-elevated);
}
.eem-confirm-title {
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.eem-confirm-text {
  color: var(--text-secondary);
  margin-bottom: 16px;
  font-size: 0.9375rem;
}
.eem-confirm-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}
</style>

