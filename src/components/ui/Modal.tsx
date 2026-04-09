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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-3xl p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button className="text-sm text-slate-500 transition hover:text-slate-800" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {children}
      </Card>
    </div>
  )
}
