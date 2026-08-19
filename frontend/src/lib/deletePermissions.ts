import { getAuthUser, getUserRole } from '@/stores/auth'

const DELETE_FORBIDDEN_MESSAGE = 'У вас недостаточно прав для удаления.'

export function canCurrentUserDelete(): boolean {
  // Роль читается из profiles (см. stores/auth.ts): user_metadata и app_metadata
  // здесь не годятся — первое пользователь редактирует сам.
  if (!getAuthUser()) return false
  return getUserRole() === 'manager'
}

/** Удаление сущностей реестра (поля, техника и т.д.) — только руководитель. */
export function assertCanDelete(): void {
  if (!canCurrentUserDelete()) {
    throw new Error(DELETE_FORBIDDEN_MESSAGE)
  }
}

/**
 * Удаление задачи: руководитель — любую; работник — только созданную им.
 */
export function canDeleteTask(createdBy: string | null | undefined): boolean {
  const user = getAuthUser()
  if (!user) return false
  if (canCurrentUserDelete()) return true
  return Boolean(createdBy && createdBy === user.id)
}

export function assertCanDeleteTask(createdBy: string | null | undefined): void {
  if (!canDeleteTask(createdBy)) {
    throw new Error(DELETE_FORBIDDEN_MESSAGE)
  }
}
