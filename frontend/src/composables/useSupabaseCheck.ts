import { ref, onMounted } from 'vue'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

export function useSupabaseCheck() {
  const status = ref<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  async function check() {
    if (!isSupabaseConfigured() || !supabase) {
      status.value = 'idle'
      return
    }
    status.value = 'checking'
    errorMessage.value = null
    try {
      const { error } = await supabase.from('downtimes').select('id').limit(1)
      if (error) throw error
      status.value = 'ok'
    } catch (e) {
      status.value = 'error'
      errorMessage.value = e instanceof Error ? e.message : String(e)
    }
  }

  onMounted(check)

  return { status, errorMessage, check }
}
