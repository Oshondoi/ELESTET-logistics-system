import type { ReactNode } from 'react'
import { Card } from './Card'

interface ModalProps {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
}

export const Modal = ({ open, title, description, children, onClose }: ModalProps) => {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overflow-x-hidden bg-slate-950/40 p-3 sm:items-center sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <Card className="relative z-10 flex w-full max-w-3xl min-w-0 flex-col overflow-hidden p-0">
        <div className="flex min-w-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button className="text-sm text-slate-500 transition hover:text-slate-800" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="min-h-0 min-w-0 max-h-[calc(100vh-7.5rem)] overflow-y-auto overflow-x-hidden px-4 py-4 sm:max-h-[calc(100vh-9rem)] sm:px-6 sm:py-5">
          {children}
        </div>
      </Card>
    </div>
  )
}
