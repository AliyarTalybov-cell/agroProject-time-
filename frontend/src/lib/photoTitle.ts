/**
 * Подпись фото для показа. Если вместо подписи сохранено служебное имя
 * файла (uuid или 32 hex-символа, с расширением или без), пользователю оно
 * ничего не говорит — показываем общее название.
 */
const SERVICE_NAME = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(\.\w+)?$/i

export function photoTitle(title: string | null | undefined, fallback: string): string {
  const t = (title ?? '').trim()
  return !t || SERVICE_NAME.test(t) ? fallback : t
}
