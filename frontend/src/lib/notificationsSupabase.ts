import { supabase } from '@/lib/supabase'

export type NotificationType =
  | 'task_assigned'
  | 'calendar_invited'
  | 'task_status_changed'
  | 'task_comment_added'
  | 'task_participant_added'
export type NotificationFilter = 'all' | 'read' | 'unread'

export type NotificationRow = {
  id: string
  type: NotificationType
  is_read: boolean
  created_at: string
  task_id: string | null
  task_number: number | null
  task_title: string | null
  calendar_task_id: string | null
  calendar_title: string | null
  calendar_date: string | null
  actor_name: string | null
}

export async function loadMyNotifications(args?: {
  filter?: NotificationFilter
  limit?: number
  offset?: number
}): Promise<NotificationRow[]> {
  if (!supabase) return []
  const filter = args?.filter ?? 'all'
  const limit = Math.min(100, Math.max(1, Math.floor(args?.limit ?? 20)))
  const offset = Math.max(0, Math.floor(args?.offset ?? 0))
  const { data, error } = await supabase.rpc('list_my_notifications', {
    p_filter: filter,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return (data ?? []) as NotificationRow[]
}

export async function countMyUnreadNotifications(): Promise<number> {
  if (!supabase) return 0
  const { count, error } = await supabase
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false)
  if (error) throw error
  return Number(count ?? 0)
}

export async function markMyNotificationsRead(ids?: string[]): Promise<number> {
  if (!supabase) return 0
  const clean = (ids ?? []).filter(Boolean)
  const { data, error } = await supabase.rpc('mark_my_notifications_read', {
    p_ids: clean.length ? clean : null,
  })
  if (error) throw error
  return Number(data ?? 0)
}
