import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'
import { Badge } from './Badge'

type BadgeTone = 'neutral' | 'info' | 'success' | 'warning'

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-blue-50 text-blue-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
}

interface StatusDropdownProps<T extends string> {
  value: T
  options: readonly T[]
  toneMap: Record<T, BadgeTone>
  onChange: (newValue: T) => Promise<void>
  disabled?: boolean
}

export function StatusDropdown<T extends string>({
  value,
  options,
  toneMap,
  onChange,
  disabled = false,
}: StatusDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Recalculate position on open
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left: rect.left,
      minWidth: Math.max(rect.width, 180),
    })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    // Close on any scroll so menu doesn't drift away from trigger
    const handleScroll = () => setIsOpen(false)

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [isOpen])

  const handleSelect = async (option: T) => {
    if (option === value || isLoading) return
    setIsOpen(false)
    setIsLoading(true)
    try {
      await onChange(option)
    } finally {
      setIsLoading(false)
    }
  }

  const menu = (
    <div
      ref={menuRef}
      style={menuStyle}
      className={cn(
        'z-[9999] rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl shadow-slate-200/60',
        'origin-top transition-all duration-150',
        isOpen
          ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
          : 'pointer-events-none -translate-y-1 scale-95 opacity-0',
      )}
      role="listbox"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="option"
          aria-selected={option === value}
          onClick={() => void handleSelect(option)}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors duration-100',
            option === value
              ? 'bg-slate-50'
              : 'hover:bg-slate-50 active:bg-slate-100',
          )}
        >
          <Badge tone={toneMap[option]}>{option}</Badge>
          {option === value && (
            <svg
              className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      ))}
    </div>
  )

  return (
    <div className="inline-block">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || isLoading}
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2.5 py-1',
          toneClasses[toneMap[value]],
          isLoading ? 'cursor-wait opacity-60' : 'cursor-pointer',
          !isLoading && !disabled && 'transition-opacity duration-100 hover:opacity-75',
          disabled && 'pointer-events-none',
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="text-xs font-medium">{value}</span>
        {isLoading ? (
          <svg className="h-3 w-3 animate-spin opacity-60" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="28 56" />
          </svg>
        ) : (
          <svg
            className={cn('h-3 w-3 opacity-60 transition-transform duration-150', isOpen && 'rotate-180')}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>

      {createPortal(menu, document.body)}
    </div>
  )
}
