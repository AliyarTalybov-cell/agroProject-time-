import { ref } from 'vue'

/**
 * Замена window.confirm на окно сайта (UiConfirmModal, AlertDialog shadcn):
 * UiConfirmHost в App.vue показывает вопрос, функция возвращает true / false.
 *
 *   if (!(await askConfirm('Удалить задачу?'))) return
 */
export interface ConfirmRequest {
  title: string
  text: string
  confirmLabel: string
  resolve: (ok: boolean) => void
}

export const confirmRequest = ref<ConfirmRequest | null>(null)

export function askConfirm(
  title: string,
  text = 'Это действие нельзя отменить.',
  confirmLabel = 'Удалить',
): Promise<boolean> {
  confirmRequest.value?.resolve(false)
  return new Promise((resolve) => {
    confirmRequest.value = { title, text, confirmLabel, resolve }
  })
}
