import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { assertCanDelete } from '@/lib/deletePermissions'

export type CalendarTaskRow = {
  id: string
  user_id: string | null
  date: string
  title: string
  description: string | null
  start_time: string | null
  end_time: string | null
  priority: string
  assignee: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type CalendarTaskFileRow = {
  id: string
  task_id: string
  file_path: string
  file_name: string
  file_size: number | null
  created_at: string
}

export type CalendarTaskAssigneeStatus = 'pending' | 'accepted' | 'declined'

export type CalendarTaskAssigneeRow = {
  task_id: string
  user_id: string
  status: CalendarTaskAssigneeStatus
}

const TABLE = 'calendar_tasks'
const ASSIGNEES_TABLE = 'calendar_task_assignees'
const FILES_TABLE = 'calendar_task_files'
const FILES_BUCKET = 'task-attachments'

export type LoadCalendarTasksPageArgs = {
  userId: string | null
  fromDate?: string | null
  page: number
  pageSize: number
}

/** Задачи календаря: созданные пользователем или где он в исполнителях */
export async function loadCalendarTasks(userId: string | null): Promise<CalendarTaskRow[]> {
  if (!supabase) return []
  if (!userId) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, user_id, date, title, description, start_time, end_time, priority, assignee, completed_at, created_at, updated_at')
      .order('date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: false })
    if (error) throw error
    return (data ?? []) as CalendarTaskRow[]
  }
  const { data: assigneeRows, error: assigneeError } = await supabase
    .from(ASSIGNEES_TABLE)
    .select('task_id')
    .eq('user_id', userId)
  if (assigneeError) throw assigneeError
  const assigneeTaskIds = (assigneeRows ?? []).map((r) => r.task_id)
  const { data: created, error: createdError } = await supabase
    .from(TABLE)
    .select('id, user_id, date, title, description, start_time, end_time, priority, assignee, completed_at, created_at, updated_at')
    .eq('user_id', userId)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })
  if (createdError) throw createdError
  if (assigneeTaskIds.length === 0) return (created ?? []) as CalendarTaskRow[]
  const { data: assigned, error: assignedError } = await supabase
    .from(TABLE)
    .select('id, user_id, date, title, description, start_time, end_time, priority, assignee, completed_at, created_at, updated_at')
    .in('id', assigneeTaskIds)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })
  if (assignedError) throw assignedError
  const byId = new Map<string, CalendarTaskRow>()
  for (const r of (created ?? []) as CalendarTaskRow[]) {
    byId.set(r.id, r)
  }
  for (const r of (assigned ?? []) as CalendarTaskRow[]) {
    if (!byId.has(r.id)) byId.set(r.id, r)
  }
  return Array.from(byId.values()).sort((a, b) => {
    const d = a.date.localeCompare(b.date)
    if (d !== 0) return d
    return (a.start_time ?? '').localeCompare(b.start_time ?? '')
  })
}

export async function loadCalendarTasksPage(args: LoadCalendarTasksPageArgs): Promise<CalendarTaskRow[]> {
  if (!supabase) return []
  const safePage = Math.max(1, Math.floor(args.page))
  const safePageSize = Math.min(100, Math.max(1, Math.floor(args.pageSize)))
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1
  const columns =
    'id, user_id, date, title, description, start_time, end_time, priority, assignee, completed_at, created_at, updated_at'

  if (!args.userId) {
    let q = supabase
      .from(TABLE)
      .select(columns)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: false })
      .range(from, to)
    if (args.fromDate) q = q.gte('date', args.fromDate)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as CalendarTaskRow[]
  }

  const { data: assigneeRows, error: assigneeError } = await supabase
    .from(ASSIGNEES_TABLE)
    .select('task_id')
    .eq('user_id', args.userId)
  if (assigneeError) throw assigneeError
  const ids = (assigneeRows ?? []).map((r) => r.task_id).filter(Boolean)

  let q = supabase
    .from(TABLE)
    .select(columns)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })
    .range(from, to)
  if (args.fromDate) q = q.gte('date', args.fromDate)

  if (ids.length > 0) {
    const idsExpr = ids.join(',')
    q = q.or(`user_id.eq.${args.userId},id.in.(${idsExpr})`)
  } else {
    q = q.eq('user_id', args.userId)
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as CalendarTaskRow[]
}

export async function loadTaskAssignees(taskId: string): Promise<CalendarTaskAssigneeRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(ASSIGNEES_TABLE)
    .select('task_id, user_id, status')
    .eq('task_id', taskId)
  if (error) throw error
  return (data ?? []).map((r) => ({
    task_id: r.task_id as string,
    user_id: r.user_id as string,
    status: ((r.status as CalendarTaskAssigneeStatus) || 'accepted') as CalendarTaskAssigneeStatus,
  }))
}

export async function setTaskAssignees(
  taskId: string,
  userIds: string[],
  options?: {
    defaultStatus?: CalendarTaskAssigneeStatus
    statusByUserId?: Record<string, CalendarTaskAssigneeStatus>
  },
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error: delError } = await supabase.from(ASSIGNEES_TABLE).delete().eq('task_id', taskId)
  if (delError) throw delError
  if (userIds.length === 0) return
  const fallbackStatus = options?.defaultStatus ?? 'pending'
  const rows = userIds
    .filter((id) => id)
    .map((user_id) => ({
      task_id: taskId,
      user_id,
      status: options?.statusByUserId?.[user_id] ?? fallbackStatus,
    }))
  const { error: insError } = await supabase.from(ASSIGNEES_TABLE).insert(rows)
  if (insError) throw insError
}

export async function updateTaskAssigneeStatus(
  taskId: string,
  userId: string,
  status: CalendarTaskAssigneeStatus,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase
    .from(ASSIGNEES_TABLE)
    .update({ status })
    .eq('task_id', taskId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function removeTaskAssignee(taskId: string, userId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase
    .from(ASSIGNEES_TABLE)
    .delete()
    .eq('task_id', taskId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function insertCalendarTask(
  payload: {
    user_id: string | null
    date: string
    title: string
    description?: string | null
    start_time?: string | null
    end_time?: string | null
    priority?: string
    assignee?: string | null
    assignee_ids?: string[]
    assignee_status_by_user_id?: Record<string, CalendarTaskAssigneeStatus>
  },
): Promise<CalendarTaskRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: payload.user_id,
      date: payload.date,
      title: payload.title.trim(),
      description: payload.description?.trim() || null,
      start_time: payload.start_time?.trim() || null,
      end_time: payload.end_time?.trim() || null,
      priority: payload.priority || 'normal',
      assignee: payload.assignee?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  const row = data as CalendarTaskRow
  const ids = payload.assignee_ids?.filter((id) => id) ?? []
  if (ids.length > 0) {
    await setTaskAssignees(row.id, ids, {
      defaultStatus: 'pending',
      statusByUserId: payload.assignee_status_by_user_id,
    })
  }
  return row
}

export async function updateCalendarTask(
  id: string,
  payload: Partial<{
    date: string
    title: string
    description: string | null
    start_time: string | null
    end_time: string | null
    priority: string
    assignee: string | null
    completed_at: string | null
    assignee_ids: string[]
    assignee_status_by_user_id: Record<string, CalendarTaskAssigneeStatus>
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { assignee_ids, assignee_status_by_user_id, ...rest } = payload
  const updates: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() }
  if (payload?.title !== undefined) updates.title = (payload.title as string).trim()
  delete (updates as Record<string, unknown>).assignee_ids
  delete (updates as Record<string, unknown>).assignee_status_by_user_id
  const { error } = await supabase.from(TABLE).update(updates).eq('id', id)
  if (error) throw error
  if (assignee_ids !== undefined) {
    await setTaskAssignees(id, assignee_ids, {
      defaultStatus: 'pending',
      statusByUserId: assignee_status_by_user_id,
    })
  }
}

export async function deleteCalendarTask(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function loadTaskFiles(taskId: string): Promise<CalendarTaskFileRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from(FILES_TABLE)
    .select('id, task_id, file_path, file_name, file_size, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CalendarTaskFileRow[]
}

export async function uploadTaskFile(taskId: string, file: File): Promise<CalendarTaskFileRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  const path = `tasks/${taskId}/${Date.now()}-${safeName}`
  const { error: uploadError } = await supabase.storage.from(FILES_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (uploadError) throw uploadError
  const { data: row, error } = await supabase
    .from(FILES_TABLE)
    .insert({
      task_id: taskId,
      file_path: path,
      file_name: file.name,
      file_size: file.size,
    })
    .select()
    .single()
  if (error) {
    await supabase.storage.from(FILES_BUCKET).remove([path])
    throw error
  }
  return row as CalendarTaskFileRow
}

export async function deleteTaskFile(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { data: row, error: fetchError } = await supabase
    .from(FILES_TABLE)
    .select('id, file_path')
    .eq('id', id)
    .single()
  if (fetchError || !row) throw fetchError || new Error('Файл не найден')
  const storagePath = row.file_path as string
  const { error: delError } = await supabase.from(FILES_TABLE).delete().eq('id', id)
  if (delError) throw delError
  if (storagePath && !storagePath.startsWith('http')) {
    await supabase.storage.from(FILES_BUCKET).remove([storagePath])
  }
}

export function getTaskFilePublicUrl(filePath: string): string {
  if (!supabase) return ''
  const { data } = supabase.storage.from(FILES_BUCKET).getPublicUrl(filePath)
  return data.publicUrl
}

export { isSupabaseConfigured }
