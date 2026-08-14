import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { assertCanDelete } from '@/lib/deletePermissions'
import { assertPhotoSize } from '@/lib/uploadLimits'

export type NewsPostRow = {
  id: string
  title: string
  excerpt: string | null
  cover_excerpt_position: 'left-top' | 'right-top' | 'left-bottom' | 'right-bottom'
  cover_image_url: string | null
  content: string
  gallery_urls: string[] | null
  published_at: string
  created_by: string | null
  created_at: string
  updated_at: string
}

const NEWS_TABLE = 'news_posts'
const NEWS_FILES_BUCKET = 'news-files'
const NEWS_SELECT = '*'

function normalizeGalleryUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((x) => String(x || '').trim()).filter(Boolean)
}

function normalizeNewsRow(row: Record<string, unknown>): NewsPostRow {
  const pos = String(row.cover_excerpt_position ?? 'left-bottom')
  const normalizedPos: NewsPostRow['cover_excerpt_position'] =
    pos === 'left-top' || pos === 'right-top' || pos === 'right-bottom' ? pos : 'left-bottom'
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    excerpt: row.excerpt == null ? null : String(row.excerpt),
    cover_excerpt_position: normalizedPos,
    cover_image_url: row.cover_image_url == null ? null : String(row.cover_image_url),
    content: String(row.content ?? ''),
    gallery_urls: normalizeGalleryUrls(row.gallery_urls),
    published_at: String(row.published_at ?? new Date().toISOString()),
    created_by: row.created_by == null ? null : String(row.created_by),
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  }
}

export async function loadNewsPostsPage(page: number, pageSize = 9): Promise<{ items: NewsPostRow[]; total: number }> {
  if (!supabase) return { items: [], total: 0 }
  const safePage = Math.max(1, Math.trunc(page || 1))
  const safePageSize = Math.max(1, Math.trunc(pageSize || 9))
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1
  const { count, error: countError } = await supabase
    .from(NEWS_TABLE)
    .select('id', { count: 'exact', head: true })
  if (countError) throw countError

  const { data, error } = await supabase
    .from(NEWS_TABLE)
    .select(NEWS_SELECT)
    .order('published_at', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) throw error
  return {
    items: ((data ?? []) as Record<string, unknown>[]).map(normalizeNewsRow),
    total: Number(count ?? 0),
  }
}

export async function loadNewsPosts(): Promise<NewsPostRow[]> {
  const result = await loadNewsPostsPage(1, 100)
  return result.items
}

export async function getNewsPostById(id: string): Promise<NewsPostRow | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from(NEWS_TABLE)
    .select(NEWS_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? normalizeNewsRow(data as Record<string, unknown>) : null
}

export async function createNewsPost(payload: {
  title: string
  excerpt?: string | null
  cover_excerpt_position?: NewsPostRow['cover_excerpt_position']
  cover_image_url?: string | null
  content: string
  gallery_urls?: string[]
  published_at?: string | null
  created_by?: string | null
}): Promise<NewsPostRow> {
  if (!supabase) throw new Error('Supabase не настроен')
  const now = new Date().toISOString()
  const insertPayload = {
    title: payload.title.trim(),
    excerpt: payload.excerpt?.trim() || null,
    cover_excerpt_position: payload.cover_excerpt_position ?? 'left-bottom',
    cover_image_url: payload.cover_image_url?.trim() || null,
    content: payload.content.trim(),
    gallery_urls: payload.gallery_urls ?? [],
    published_at: payload.published_at || now,
    created_by: payload.created_by || null,
    updated_at: now,
  }
  const { data, error } = await supabase
    .from(NEWS_TABLE)
    .insert(insertPayload)
    .select(NEWS_SELECT)
    .single()
  if (error) throw error
  return normalizeNewsRow(data as Record<string, unknown>)
}

export async function updateNewsPost(
  id: string,
  payload: Partial<{
    title: string
    excerpt: string | null
    cover_excerpt_position: NewsPostRow['cover_excerpt_position']
    cover_image_url: string | null
    content: string
    gallery_urls: string[]
    published_at: string
  }>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (payload.title !== undefined) updates.title = payload.title.trim()
  if (payload.excerpt !== undefined) updates.excerpt = payload.excerpt?.trim() || null
  if (payload.cover_excerpt_position !== undefined) updates.cover_excerpt_position = payload.cover_excerpt_position
  if (payload.cover_image_url !== undefined) updates.cover_image_url = payload.cover_image_url?.trim() || null
  if (payload.content !== undefined) updates.content = payload.content.trim()
  if (payload.gallery_urls !== undefined) updates.gallery_urls = payload.gallery_urls
  if (payload.published_at !== undefined) updates.published_at = payload.published_at
  const { error } = await supabase.from(NEWS_TABLE).update(updates).eq('id', id)
  if (error) throw error
}

export async function deleteNewsPost(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertCanDelete()
  const { error } = await supabase.from(NEWS_TABLE).delete().eq('id', id)
  if (error) throw error
}

function sanitizeFileName(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
  return base || `file_${Date.now()}`
}

export async function uploadNewsImage(file: File, folder = 'news'): Promise<string> {
  if (!supabase) throw new Error('Supabase не настроен')
  assertPhotoSize(file)
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const safeName = sanitizeFileName(file.name.replace(new RegExp(`\\.${ext}$`, 'i'), ''))
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from(NEWS_FILES_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined })
  if (uploadError) throw uploadError
  const { data } = supabase.storage.from(NEWS_FILES_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export { isSupabaseConfigured }
