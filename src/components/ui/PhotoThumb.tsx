import { useState } from 'react'
import { createPortal } from 'react-dom'

const POP_W = 288
const POP_H = 384
const GAP = 12

interface PhotoThumbProps {
  /** URL изображения. Если null/undefined — показывает плейсхолдер */
  url: string | null | undefined
  /** Классы для миниатюры и плейсхолдера (размер + скругление). По умолчанию h-9 w-9 rounded-lg */
  className?: string
}

/**
 * PhotoThumb — миниатюра товара с всплывающим превью при наведении.
 * Превью рендерится через портал в document.body (z-50, fixed),
 * автоматически позиционируется справа/слева от миниатюры чтобы не выходить за экран.
 */
export function PhotoThumb({ url, className = 'h-9 w-9 rounded-lg' }: PhotoThumbProps) {
  const [preview, setPreview] = useState<{ url: string; x: number; y: number } | null>(null)

  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 ${className}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </div>
    )
  }

  return (
    <>
      <img
        src={url}
        alt=""
        loading="lazy"
        className={`cursor-zoom-in object-cover ${className}`}
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          // Горизонталь: предпочитаем справа, если не влезает — слева
          const x = rect.right + GAP + POP_W > window.innerWidth
            ? rect.left - GAP - POP_W
            : rect.right + GAP
          // Вертикаль: выровнять по верху миниатюры, но не выходить за низ
          const y = Math.min(rect.top, window.innerHeight - POP_H - GAP)
          setPreview({ url, x, y })
        }}
        onMouseLeave={() => setPreview(null)}
      />
      {preview && createPortal(
        <div
          className="pointer-events-none fixed z-50 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-slate-200"
          style={{ left: preview.x, top: preview.y }}
        >
          <img src={preview.url} alt="" className="h-96 w-72 object-cover" />
        </div>,
        document.body,
      )}
    </>
  )
}
