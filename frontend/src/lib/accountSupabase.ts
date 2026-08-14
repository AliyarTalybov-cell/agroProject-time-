import { supabase } from '@/lib/supabase'

/** Удаляет текущий аккаунт (auth.uid()) через RPC в БД. */
export async function deleteMyAccount(): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.rpc('delete_my_account')
  if (error) throw error
}
