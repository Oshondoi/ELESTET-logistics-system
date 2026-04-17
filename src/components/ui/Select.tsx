import type { SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface Option {
  label: string
  value: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: Option[]
}

export const Select = ({ label, options, className, ...props }: SelectProps) => (
  <label className="flex min-w-0 flex-col gap-2 text-sm text-slate-700">
    <span className="font-medium">{label}</span>
    <select
      className={cn(
        'block w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-0 focus-visible:border-brand-500 focus-visible:ring-0',
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
)
