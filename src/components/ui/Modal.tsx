import type { ReactNode } from 'react'
import { Card } from './Card'
import { cn } from '../../lib/utils'

interface ModalProps {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  className?: string
  headerContent?: ReactNode
  tall?: boolean
  fill?: boolean
}

export const Modal = ({ open, title, description, children, footer, onClose, className, headerContent, tall = false, fill = false }: ModalProps) => {
  if (!open) return null

  return (
    <div className={cn('fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-slate-950/40', !tall && 'p-3 sm:p-4')}>
      <div className="absolute inset-0" onClick={onClose} />
      <Card className={cn(
        'relative z-10 flex min-w-0 flex-col overflow-hidden p-0',
        tall ? 'h-[90vh] w-[90vw] max-h-[90vh] max-w-[90vw]' : 'w-full max-w-3xl max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)]',
        className,
      )}>
        <div className="shrink-0 border-b border-slate-200">
          <div className="flex min-w-0 items-start justify-between gap-4 px-4 pt-4 pb-3 sm:px-6 sm:pt-5 sm:pb-4">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
              {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
            </div>
            <button className="mt-0.5 shrink-0 text-sm text-slate-500 transition hover:text-slate-800" onClick={onClose}>
              Закрыть
            </button>
          </div>
          {headerContent && <div className="px-4 sm:px-6">{headerContent}</div>}
        </div>
        <div className={cn('min-h-0 min-w-0 flex-1 overflow-x-hidden', fill ? 'flex flex-col overflow-hidden' : 'overflow-y-auto px-4 py-4 sm:px-6 sm:py-5')}>
          {children}
        </div>
        {footer && (
          <div className="border-t border-slate-200 bg-white px-4 pb-3 pt-3 sm:px-6">
            {footer}
          </div>
        )}
      </Card>
    </div>
  )
}
