/** Единый лимит на размер загружаемого фото/изображения (20 МБ). */
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024
/** Человекочитаемая подпись лимита для подсказок и сообщений. */
export const PHOTO_MAX_LABEL = '20 МБ'

/** Бросает понятную ошибку, если файл превышает лимит фото. */
export function assertPhotoSize(file: File): void {
  if (file.size > PHOTO_MAX_BYTES) {
    throw new Error(`Размер файла не должен превышать ${PHOTO_MAX_LABEL}.`)
  }
}
