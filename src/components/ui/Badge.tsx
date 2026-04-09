import { cn } from '../../lib/utils'

interface BadgeProps {
  children: string
  tone?: 'neutral' | 'info' | 'success' | 'warning'
}

const toneClasses = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-blue-50 text-blue-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
}

export const Badge = ({ children, tone = 'neutral' }: BadgeProps) => (
  <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', toneClasses[tone])}>
    {children}
  </span>
)
