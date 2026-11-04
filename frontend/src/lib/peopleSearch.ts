/**
 * Поиск людей для всех выборов сотрудника на сайте.
 *
 * Правило: список людей сразу целиком не показываем — сотрудников могут быть
 * сотни. Сначала строка поиска: ввели часть имени, email или должности —
 * показываем первые совпадения (не больше limit), остальное — «уточните».
 */
import { avatarColorByPosition } from '@/lib/avatarColors'

export type SearchablePerson = { label: string; sub?: string | null; email?: string | null }

/** Сколько символов нужно ввести, чтобы начать показывать людей. */
export const PEOPLE_MIN_QUERY = 1
export const PEOPLE_LIMIT = 30

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim()

export function searchPeople<T extends SearchablePerson>(
  list: readonly T[],
  query: string,
  limit = PEOPLE_LIMIT,
): { items: T[]; more: number; needQuery: boolean } {
  const q = norm(query)
  if (q.length < PEOPLE_MIN_QUERY) return { items: [], more: 0, needQuery: true }
  const words = q.split(/\s+/).filter(Boolean)
  const scored: { p: T; score: number }[] = []
  for (const p of list) {
    const label = norm(p.label)
    const hay = `${label} ${norm(p.email ?? '')} ${norm(p.sub ?? '')}`
    if (!words.every((w) => hay.includes(w))) continue
    // Сначала те, у кого имя начинается с запроса, потом — совпадение внутри.
    const score = label.startsWith(q) ? 0 : label.split(/\s+/).some((part) => part.startsWith(words[0])) ? 1 : 2
    scored.push({ p, score })
  }
  scored.sort((a, b) => a.score - b.score || a.p.label.localeCompare(b.p.label, 'ru'))
  return { items: scored.slice(0, limit).map((x) => x.p), more: Math.max(0, scored.length - limit), needQuery: false }
}

export function personInitials(label: string): string {
  const parts = label.split('@')[0].trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (parts[0] ?? '?').slice(0, 2).toUpperCase()
}


/** Профиль / сотрудник → пункт выбора (UiPersonPicker, UiPersonSelect). */
export function toPersonOption(
  p: { id: string; display_name?: string | null; email?: string | null; position?: string | null; avatar_url?: string | null },
  suffix = '',
) {
  const label = (p.display_name?.trim() || p.email || 'Сотрудник') + suffix
  return {
    id: p.id,
    label,
    sub: p.position?.trim() || null,
    email: p.email ?? null,
    url: p.avatar_url ?? null,
    initials: personInitials(p.display_name?.trim() || p.email || '?'),
    avatarStyle: { background: avatarColorByPosition(p.position || label) },
  }
}
