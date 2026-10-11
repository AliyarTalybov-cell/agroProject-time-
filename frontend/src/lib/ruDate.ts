/** Дата из базы «2026-04-01» (или ISO со временем) → «01.04.2026»; пусто → «—». */
export function ruDate(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value || '—'
}
