import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface CardProps {
  children: ReactNode
  className?: string
}

export const Card = ({ children, className }: CardProps) => (
  <div className={cn('rounded-2xl border border-slate-200 bg-white shadow-soft', className)}>
    {children}
  </div>
)
