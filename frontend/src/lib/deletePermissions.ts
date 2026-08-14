import { getAuthUser } from '@/stores/auth'

const DELETE_FORBIDDEN_MESSAGE = 'У вас недостаточно прав для удаления.'

function isManagerRole(role: unknown): boolean {
  return String(role ?? '').toLowerCase() === 'manager'
}

export function canCurrentUserDelete(): boolean {
  const user = getAuthUser()
  if (!user) return false
  const meta = user.user_metadata ?? {}
  const appMeta = user.app_metadata ?? {}
  return isManagerRole(meta.role) || isManagerRole(appMeta.role)
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
