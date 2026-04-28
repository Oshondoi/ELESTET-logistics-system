import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ToastItem {
  id: number
  message: string
  type: 'error' | 'success' | 'info'
}

let _addToast: ((msg: string, type?: ToastItem['type']) => void) | null = null

export function showToast(message: string, type: ToastItem['type'] = 'error') {
  _addToast?.(message, type)
}

export const ToastContainer = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    _addToast = (message, type = 'error') => {
      const id = Date.now()
      setToasts((prev) => [...prev, { id, message, type }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
    }
    return () => { _addToast = null }
  }, [])

  if (toasts.length === 0) return null

  return createPortal(
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg text-sm text-white ${
            t.type === 'error' ? 'bg-red-500' :
            t.type === 'success' ? 'bg-emerald-500' :
            'bg-slate-700'
          }`}
        >
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            type="button"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="flex-shrink-0 opacity-70 hover:opacity-100 transition mt-0.5"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
