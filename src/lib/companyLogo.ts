/** Возвращает URL логотипа компании (БЕСПЛАТНО — для всех мест кроме white-label) */
export function getLogoUrl(account: {
  logo_url?: string | null
}): string | null {
  return account.logo_url ?? null
}

// Paid presentation is resolved server-side by resolve_company_brand.
// A free company logo or the premium plan alone must not enable branding.

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
