/** Возвращает URL логотипа компании (БЕСПЛАТНО — для всех мест кроме white-label) */
export function getLogoUrl(account: {
  logo_url?: string | null
}): string | null {
  return account.logo_url ?? null
}

/** Возвращает URL логотипа ТОЛЬКО если подписка активна (ПЛАТНО — только для white-label мест:
 *  верхний угол сайдбара, title/favicon вкладки) */
export function getWhitelabelLogoUrl(account: {
  logo_url?: string | null
  logo_subscription_until?: string | null
}): string | null {
  if (!account.logo_url || !account.logo_subscription_until) return null
  if (new Date(account.logo_subscription_until) < new Date()) return null
  return account.logo_url
}

const MAX_SIZE_BYTES = 2 * 1024 * 1024 // 2 MB

/** Конвертирует File в WebP Blob через canvas, возвращает Blob */
export async function convertToWebP(file: File, quality = 0.85): Promise<Blob> {
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error('Файл слишком большой. Максимум 2 МБ.')
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas error')); return }
      ctx.drawImage(img, 0, 0)
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Ошибка конвертации')); return }
          resolve(blob)
        },
        'image/webp',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось загрузить изображение')) }
    img.src = url
  })
}
