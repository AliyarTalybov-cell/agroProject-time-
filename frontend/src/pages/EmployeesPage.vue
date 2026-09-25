<script setup lang="ts">
import { Card } from '@/components/ui/shadcn/card'
import UiPagination from '@/components/ui/UiPagination.vue'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/shadcn/input-group'
import { Button } from '@/components/ui/shadcn/button'
import { CalendarIcon, MailIcon, PhoneIcon, PlusIcon, SearchIcon, SlidersVerticalIcon } from '@lucide/vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useAuth } from '@/stores/auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  loadPositions,
  searchEmployeesPage,
  loadEmployeesPage,
  type EmployeeRow,
  type PositionRow,
} from '@/lib/employeesSupabase'
import EmployeeCreateModal from '@/components/EmployeeCreateModal.vue'
import EmployeeEditModal from '@/components/EmployeeEditModal.vue'
import { avatarColorByPosition } from '@/lib/avatarColors'
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UserAvatar from '@/components/UserAvatar.vue'

const auth = useAuth()

const loading = ref(false)
const error = ref<string | null>(null)
const employees = ref<EmployeeRow[]>([])
const positions = ref<PositionRow[]>([])

const search = ref('')
const positionFilter = ref<string>('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
const page = ref(1)
const pageSize = ref(5)
const total = ref(0)

const createOpen = ref(false)
const editOpen = ref(false)
const selected = ref<EmployeeRow | null>(null)

const canManage = computed(() => auth.userRole.value === 'manager')

function initials(name: string | null, email: string): string {
  const base = (name && name.trim()) ? name.trim() : email.split('@')[0]
  const parts = base.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0]?.[0] || '?').toUpperCase()
}

function avatarColor(position: string | null): string {
  return avatarColorByPosition(position)
}

function roleLabel(role: string | null): string {
  return role === 'manager' ? 'Руководитель' : 'Сотрудник'
}

function roleClass(role: string | null): string {
  return role === 'manager' ? 'emp-badge--manager' : 'emp-badge--worker'
}

function isActive(e: EmployeeRow): boolean {
  return e.active !== false
}

function lastLoginLabel(e: EmployeeRow): string {
  if (!e.last_activity_at) return 'Не входил'
  const dt = new Date(e.last_activity_at)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function refresh() {
  error.value = null
  if (!isSupabaseConfigured()) {
    employees.value = []
    return
  }
  loading.value = true
  try {
    if (!positions.value.length) {
      positions.value = await loadPositions()
    }
    const q = search.value.trim()
    const pos = positionFilter.value.trim() || null
    const result = q
      ? await searchEmployeesPage(q, page.value, pageSize.value, pos)
      : await loadEmployeesPage(page.value, pageSize.value, pos)
    employees.value = result.rows
    total.value = result.total
    const maxPage = Math.max(1, Math.ceil(total.value / pageSize.value))
    if (page.value > maxPage) {
      page.value = maxPage
      return
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить сотрудников.'
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

watch(search, () => {
  page.value = 1
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => refresh(), 350)
})

watch(positionFilter, () => {
  page.value = 1
  refresh()
})
watch(pageSize, () => {
  page.value = 1
  refresh()
})
watch(page, () => refresh())

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const pageStart = computed(() => (total.value ? (page.value - 1) * pageSize.value + 1 : 0))
const pageEnd = computed(() => Math.min(page.value * pageSize.value, total.value))
const pageNumbers = computed(() => {
  const totalPagesValue = totalPages.value
  const current = page.value
  if (totalPagesValue <= 7) return Array.from({ length: totalPagesValue }, (_, i) => i + 1)
  const pages: (number | 'ellipsis')[] = [1]
  if (current <= 4) {
    for (let p = 2; p <= 5; p += 1) pages.push(p)
    pages.push('ellipsis')
    pages.push(totalPagesValue)
    return pages
  }
  if (current >= totalPagesValue - 3) {
    pages.push('ellipsis')
    for (let p = totalPagesValue - 4; p <= totalPagesValue; p += 1) pages.push(p)
    return pages
  }
  pages.push('ellipsis')
  for (let p = current - 1; p <= current + 1; p += 1) pages.push(p)
  pages.push('ellipsis')
  pages.push(totalPagesValue)
  return pages
})

function goPage(next: number) {
  page.value = Math.max(1, Math.min(next, totalPages.value))
}

function openEmployee(e: EmployeeRow) {
  if (!canManage.value) return
  selected.value = e
  editOpen.value = true
}
</script>

<template>
  <section class="emp-page page-enter-item">
    <header class="emp-header">
      <div>
        <p class="emp-subtitle">Управление персоналом и доступом к системе.</p>
      </div>

      <div class="emp-actions">
        <InputGroup class="emp-search-wrap max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput v-model.trim="search" type="text" placeholder="Поиск сотрудника..." />
        </InputGroup>

        <div class="emp-filter-wrap">
          <SlidersVerticalIcon class="emp-filter-icon" aria-hidden="true" />
          <UiSelect v-model="positionFilter" :options="[{ value: '', label: 'Должность: все' }, ...(positions).map((p) => ({ value: p.name, label: String(p.name) }))]" class="emp-filter-select" aria-label="Фильтр по должности" />
        </div>

        <Button variant="default" type="button" class="emp-btn emp-btn--primary" :disabled="!canManage" @click="createOpen = true">
          <PlusIcon class="emp-btn-icon" />
          Добавить
        </Button>
      </div>
    </header>

    <div v-if="!isSupabaseConfigured()" class="emp-empty card" role="status">
      Supabase не настроен. Добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` в `frontend/.env.local`.
    </div>

    <div v-else class="emp-content">
      <div v-if="!canManage" class="emp-alert" role="status">
        Доступен режим просмотра. Создание и редактирование сотрудников доступны только роли <b>Руководитель</b>.
      </div>
      <div v-if="error" class="emp-alert emp-alert--error" role="alert">{{ error }}</div>

      <div v-if="loading" class="emp-loading" role="status" aria-live="polite">
        <UiLoadingBar />
      </div>

      <div v-else class="emp-grid">
        <Card
          v-for="e in employees"
          :key="e.id"
          class="emp-card gap-0"
          :class="{ 'emp-card--readonly': !canManage }"
          :tabindex="canManage ? 0 : -1"
          @click="openEmployee(e)"
          @keydown.enter="openEmployee(e)"
        >
          <div class="emp-card-head">
            <UserAvatar
              class="emp-avatar"
              :style="{ background: avatarColor(e.position) }"
              :url="e.avatar_url"
              :initials="initials(e.display_name, e.email)"
            />
            <div class="emp-card-meta">
              <div class="emp-name">{{ e.display_name || e.email }}</div>
              <div class="emp-position">{{ e.position || '—' }}</div>
            </div>
          </div>

          <div class="emp-card-lines">
            <div class="emp-line">
              <MailIcon class="emp-line-icon" />
              <span class="emp-line-text">{{ e.email }}</span>
            </div>
            <div class="emp-line">
              <PhoneIcon class="emp-line-icon" />
              <span class="emp-line-text">{{ e.phone || '—' }}</span>
            </div>
            <div class="emp-line">
              <CalendarIcon class="emp-line-icon" />
              <span class="emp-line-text">Вход: {{ lastLoginLabel(e) }}</span>
            </div>
          </div>

          <div class="emp-card-footer">
            <div class="emp-status">
              <span class="emp-status-dot" :class="{ 'emp-status-dot--off': !isActive(e) }" aria-hidden="true"></span>
              <span>{{ isActive(e) ? 'Активен' : 'Отключён' }}</span>
            </div>
            <span class="emp-badge" :class="roleClass(e.role)">{{ roleLabel(e.role) }}</span>
          </div>
        </Card>
      </div>
      <UiPagination v-if="!loading && total > 0" :page="page" :page-size="pageSize" :total="total" :page-size-options="[5, 8, 12, 24, 48]" @update:page="goPage" @update:page-size="(n) => (pageSize = n)" />
    </div>

    <EmployeeCreateModal
      v-if="canManage"
      :open="createOpen"
      :positions="positions"
      @close="createOpen = false"
      @created="refresh"
    />

    <EmployeeEditModal
      v-if="canManage"
      :open="editOpen"
      :employee="selected"
      :positions="positions"
      @close="editOpen = false"
      @updated="refresh"
    />
  </section>
</template>

<style scoped>
@layer legacy {
.emp-page {
  width: 100%;
}

.emp-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 22px;
}

.emp-title {
  margin: 0 0 4px 0;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.emp-subtitle {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text-secondary);
}

.emp-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.emp-search-wrap {
  position: relative;
  min-width: 260px;
}

.emp-filter-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.emp-filter-icon {
  width: 18px;
  height: 18px;
  color: var(--text-secondary);
  opacity: 0.9;
}

.emp-filter-select {
  min-width: 220px;
  border: 1px solid var(--input-border);
  border-radius: var(--radius-xl);
  padding: 7px 12px;
  font-size: 0.875rem;
  background: #fff;
  color: var(--text-primary);
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 38px;
  box-shadow: var(--shadow-xs);
}
.emp-filter-select:focus {
  outline: none;
  border-color: var(--accent-green);
}
[data-theme='dark'] .emp-filter-select {
  background: color-mix(in srgb, var(--bg-panel) 82%, black);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-size: 16px 16px;
  background-position: right 12px center;
}

.emp-search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
  opacity: 0.9;
  pointer-events: none;
}

.emp-search-input {
  width: 100%;
  border: 1px solid var(--input-border);
  border-radius: var(--radius-xl);
  padding: 10px 12px 10px 40px;
  font-size: 0.875rem;
  background: #fff;
  color: var(--text-primary);
  box-shadow: var(--shadow-xs);
}

[data-theme='dark'] .emp-search-input {
  background: color-mix(in srgb, var(--bg-panel) 82%, black);
}

.emp-search-input:focus {
  outline: none;
  border-color: var(--accent-green);
}

.emp-btn {
  border-radius: var(--radius-xl);
  padding: 10px 14px;
  font-size: 0.9375rem;
  font-weight: 650;
  border: 1px solid transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.emp-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.emp-btn-icon {
  width: 18px;
  height: 18px;
}

.emp-btn--ghost {
  background: transparent;
  border-color: var(--border-color);
  color: var(--text-primary);
}
.emp-btn--ghost:hover:not(:disabled) {
  background: var(--row-hover-bg);
}

.emp-btn--primary {
  background: var(--accent-green);
  color: #fff;
}
.emp-btn--primary:hover:not(:disabled) {
  background: var(--accent-green-hover);
}

.emp-content {
  min-height: 160px;
}

.emp-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 1200px) {
  .emp-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 900px) {
  .emp-header {
    flex-direction: column;
    align-items: stretch;
  }
  .emp-actions {
    justify-content: flex-start;
  }
  .emp-search-wrap {
    min-width: 0;
    flex: 1;
  }
  .emp-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 520px) {
  .emp-grid {
    grid-template-columns: 1fr;
  }
}

.emp-card {
  background: #fff;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  padding: 16px;
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

[data-theme='dark'] .emp-card {
  background: var(--bg-panel);
}

.emp-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.08);
}

.emp-card--readonly {
  cursor: default;
}

.emp-card--readonly:hover {
  transform: none;
}

[data-theme='dark'] .emp-card:hover {
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.25);
}

.emp-card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.emp-avatar {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  letter-spacing: 0.02em;
  flex: 0 0 auto;
}

.emp-card-meta {
  min-width: 0;
}

.emp-name {
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.emp-position {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.emp-card-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0 14px 0;
}

.emp-line {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 0.875rem;
  min-width: 0;
}

.emp-line-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  opacity: 0.9;
}

.emp-line-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
  opacity: 0.9;
}

.emp-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

[data-theme='dark'] .emp-card-footer {
  border-top-color: var(--border-color);
}

.emp-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-weight: 650;
}

.emp-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #10b981;
}
.emp-status-dot--off {
  background: #9ca3af;
}

.emp-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 750;
  border: 1px solid transparent;
}

.emp-badge--manager {
  background: var(--accent-green);
  color: #fff;
}

.emp-badge--worker {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-secondary);
  border-color: rgba(0, 0, 0, 0.06);
}

[data-theme='dark'] .emp-badge--worker {
  background: color-mix(in srgb, var(--accent-green) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent-green) 20%, var(--border-color));
  color: var(--text-secondary);
}

.emp-empty.card {
  padding: 16px;
  border-radius: 16px;
}

.emp-alert {
  padding: 12px 14px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.emp-alert--error {
  background: rgba(185, 28, 28, 0.1);
  border-color: rgba(185, 28, 28, 0.22);
  color: var(--danger-red);
}

.emp-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
}

.emp-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-md);
  padding: var(--space-md) var(--space-lg) 0;
  border-top: 1px solid var(--border-color);
  min-height: 40px;
}

.emp-pagination-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.emp-pagination-right {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  flex-wrap: wrap;
}

.emp-pagination-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.emp-pagination-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h);
  height: var(--control-h);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.emp-pagination-arrow:hover:not(:disabled) {
  background: var(--bg-panel-hover);
  border-color: var(--text-secondary);
}

.emp-pagination-arrow:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.emp-pagination-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: var(--control-h);
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.emp-pagination-num:hover {
  background: var(--bg-panel-hover);
}

.emp-pagination-num--active {
  background: rgba(76, 175, 80, 0.15);
  border-color: rgba(76, 175, 80, 0.5);
  color: var(--text-primary);
}

[data-theme='dark'] .emp-pagination-num--active {
  background: rgba(76, 175, 80, 0.2);
  border-color: rgba(76, 175, 80, 0.5);
}

.emp-pagination-num--active:hover {
  background: rgba(76, 175, 80, 0.22);
}

.emp-pagination-dots {
  padding: 0 4px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.emp-pagination-btns {
  display: flex;
  align-items: center;
  gap: 4px;
}

.emp-pagination-size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.emp-pagination-size-label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.emp-pagination-select {
  min-width: 72px;
  height: var(--control-h);
  padding: 0 28px 0 10px;
  border: 1px solid var(--input-border);
  border-radius: var(--radius-md);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  box-shadow: var(--shadow-xs);
}

[data-theme='dark'] .emp-pagination-select {
  background: rgba(255, 255, 255, 0.06);
}

@media (max-width: 768px) {
  .emp-pagination {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-sm);
    padding: var(--space-md) 0;
  }

  .emp-pagination-info {
    text-align: center;
  }

  .emp-pagination-right {
    justify-content: center;
  }

  .emp-pagination-btns {
    flex-wrap: wrap;
    justify-content: center;
  }

  .emp-pagination-size {
    justify-content: center;
  }
}
}
</style>

