import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
}

const variants = {
  primary:
    'border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 hover:border-blue-700',
  secondary:
    'border border-transparent bg-[#F3F6FD] text-slate-900 hover:bg-[#E9EEF8]',
  ghost: 'border border-transparent bg-transparent text-slate-600 hover:bg-[#F3F6FD] hover:text-slate-900',
}

export const Button = ({ children, className, variant = 'primary', ...props }: ButtonProps) => (
  <button
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-[18px] px-4 py-2.5 text-sm font-medium leading-none transition-colors duration-150 ease-out outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 active:outline-none active:ring-0 active:translate-y-0 active:scale-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      variants[variant],
      className,
    )}
    {...props}
  >
    {children}
  </button>
)
