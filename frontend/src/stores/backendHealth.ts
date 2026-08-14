import { computed, ref } from 'vue'
import { isSupabaseConfigured } from '@/lib/supabase'
import { pingBackend } from '@/lib/backendHealth'

export type BackendHealthStatus = 'idle' | 'checking' | 'ok' | 'error' | 'not_configured'

const status = ref<BackendHealthStatus>('idle')
const errorMessage = ref<string | null>(null)
let checkPromise: Promise<void> | null = null

export function useBackendHealth() {
  const isChecking = computed(() => status.value === 'checking')
  const isAvailable = computed(() => status.value === 'ok')
  const isUnavailable = computed(
    () => status.value === 'error' || status.value === 'not_configured',
  )

  async function check(force = false) {
    if (!force && checkPromise) {
      await checkPromise
      return
    }

    checkPromise = (async () => {
      if (!isSupabaseConfigured()) {
        status.value = 'not_configured'
        errorMessage.value =
          'Supabase не настроен. Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в frontend/.env.local.'
        return
      }

      status.value = 'checking'
      errorMessage.value = null
      const result = await pingBackend()
      if (result.ok) {
        status.value = 'ok'
        errorMessage.value = null
      } else {
        status.value = 'error'
        errorMessage.value = result.message
      }
    })()

    try {
      await checkPromise
    } finally {
      checkPromise = null
    }
  }

  return {
    status,
    errorMessage,
    isChecking,
    isAvailable,
    isUnavailable,
    check,
  }
}

export function getBackendHealthStatus(): BackendHealthStatus {
  return status.value
}

export function getBackendHealthError(): string | null {
  return errorMessage.value
}
