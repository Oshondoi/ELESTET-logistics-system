import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

export const Input = ({ label, hint, className, ...props }: InputProps) => (
  <label className="flex min-w-0 flex-col gap-2 text-sm text-slate-700">
    <span className="font-medium">{label}</span>
    <input
      className={cn(
        'block w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-0 focus-visible:border-brand-500 focus-visible:ring-0',
        className,
      )}
      {...props}
    />
    {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
  </label>
)
