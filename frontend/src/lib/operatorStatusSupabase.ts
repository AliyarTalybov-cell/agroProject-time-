import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { assertCanDelete } from '@/lib/deletePermissions'

export type OperatorStatusKind = 'operation' | 'downtime'

export type OperatorStatusRow = {
  user_id: string
  kind: OperatorStatusKind
  employee: string
  started_at: string
  field_id: string | null
  field_name: string | null
  operation: string | null
  downtime_category: string | null
  downtime_reason: string | null
  equipment_id: string | null
  updated_at?: string
}

const TABLE = 'operator_status'

export type UpsertOperatorStatusInput = {
  userId: string
  kind: OperatorStatusKind
  employee: string
  startedAt: string
  fieldId?: string | null
  fieldName?: string | null
  operation?: string | null
  downtimeCategory?: string | null
  downtimeReason?: string | null
  equipmentId?: string | null
}

/** Записать текущее состояние оператора (операция или простой). */
export async function upsertOperatorStatus(input: UpsertOperatorStatusInput): Promise<void> {
  if (!supabase) return
  const now = new Date().toISOString()
  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: input.userId,
      kind: input.kind,
      employee: input.employee,
      started_at: input.startedAt,
      field_id: input.fieldId ?? null,
      field_name: input.fieldName ?? null,
      operation: input.operation ?? null,
      downtime_category: input.downtimeCategory ?? null,
      downtime_reason: input.downtimeReason ?? null,
      equipment_id: input.equipmentId ?? null,
      updated_at: now,
    },
    { onConflict: 'user_id' },
  )
  if (error) {
    console.warn('operator_status upsert failed', error)
  }
}

/** Убрать строку, когда операция/простой завершены. */
export async function deleteOperatorStatus(userId: string): Promise<void> {
  if (!supabase) return
  assertCanDelete()
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId)
  if (error) {
    console.warn('operator_status delete failed', error)
  }
}

export async function loadOperatorStatusesFromSupabase(
  onlyCurrentUser: boolean,
  userId: string | null,
): Promise<OperatorStatusRow[]> {
  if (!supabase) return []
  let q = supabase
    .from(TABLE)
    .select(
      'user_id, kind, employee, started_at, field_id, field_name, operation, downtime_category, downtime_reason, equipment_id, updated_at',
    )
    .order('updated_at', { ascending: false })
  if (onlyCurrentUser && userId) {
    q = q.eq('user_id', userId)
  }
  const { data, error } = await q
  if (error) {
    console.warn('loadOperatorStatusesFromSupabase', error)
    return []
  }
  return (data ?? []) as OperatorStatusRow[]
}

export { isSupabaseConfigured }
