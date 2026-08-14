/**
 * Клиентское сжатие изображений перед загрузкой (аватары и т.п.).
 * Уменьшает картинку до maxSize по большей стороне и перекодирует в WebP/JPEG,
 * чтобы в хранилище лежали лёгкие файлы, а списки с аватарами не тормозили.
 */

export type CompressImageOptions = {
  /** Максимальный размер по большей стороне, px */
  maxSize?: number
  /** Качество для lossy-кодеков (0..1) */
  quality?: number
}

const DEFAULTS: Required<CompressImageOptions> = {
  maxSize: 512,
  quality: 0.85,
}

/** Анимированные GIF не сжимаем (canvas убьёт анимацию) — отдаём как есть. */
function shouldSkip(file: File): boolean {
  return file.type === 'image/gif'
}

function supportsWebp(): boolean {
  try {
    const c = document.createElement('canvas')
    return c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

async function loadBitmap(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    // imageOrientation: 'from-image' — корректно учитываем EXIF-поворот
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    return {
      width: bmp.width,
      height: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
      close: () => bmp.close(),
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Не удалось прочитать изображение'))
      el.src = url
    })
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      close: () => URL.revokeObjectURL(url),
    }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
}

/**
 * Возвращает сжатый File. Если что-то пошло не так (или это GIF) — возвращает исходный файл.
 */
export async function compressImageFile(file: File, opts: CompressImageOptions = {}): Promise<File> {
  if (shouldSkip(file)) return file
  const { maxSize, quality } = { ...DEFAULTS, ...opts }

  let src: Awaited<ReturnType<typeof loadBitmap>> | null = null
  try {
    src = await loadBitmap(file)
    const { width, height } = src
    if (!width || !height) return file

    const scale = Math.min(1, maxSize / Math.max(width, height))
    const targetW = Math.max(1, Math.round(width * scale))
    const targetH = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    src.draw(ctx, targetW, targetH)

    const useWebp = supportsWebp()
    const outType = useWebp ? 'image/webp' : 'image/jpeg'
    const blob = await canvasToBlob(canvas, outType, quality)
    if (!blob) return file

    // Если перекодировка вышла тяжелее оригинала и размер не уменьшался — берём исходник
    if (blob.size >= file.size && scale === 1) return file

    const ext = useWebp ? 'webp' : 'jpg'
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'avatar'
    return new File([blob], `${baseName}.${ext}`, { type: outType, lastModified: Date.now() })
  } catch {
    return file
  } finally {
    src?.close()
  }
}
