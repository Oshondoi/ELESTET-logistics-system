import type { TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
}

export const Textarea = ({ label, className, ...props }: TextareaProps) => (
  <label className="flex min-w-0 flex-col gap-2 text-sm text-slate-700">
    <span className="font-medium">{label}</span>
    <textarea
      className={cn(
        'block min-h-[96px] w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-0 focus-visible:border-brand-500 focus-visible:ring-0',
        className,
      )}
      {...props}
    />
  </label>
)
