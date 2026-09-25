import { ref } from 'vue'

/**
 * Замена window.prompt на окно shadcn (Dialog + Input): UiPromptHost в App.vue
 * показывает запрос, функция возвращает введённый текст или null при отмене.
 *
 *   const next = (await promptText('Новое название', row.name))?.trim()
 */
export interface PromptRequest {
  title: string
  value: string
  label: string
  resolve: (value: string | null) => void
}

export const promptRequest = ref<PromptRequest | null>(null)

export function promptText(title: string, initial = '', label = 'Название'): Promise<string | null> {
  promptRequest.value?.resolve(null)
  return new Promise((resolve) => {
    promptRequest.value = { title, value: initial ?? '', label, resolve }
  })
}
