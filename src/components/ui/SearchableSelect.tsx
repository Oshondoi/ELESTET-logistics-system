import { useState, useRef, useEffect, useCallback } from 'react'

export interface SearchableSelectOption {
  value: string
  label: string
  /** дополнительные слова для поиска (ID и т.п.) */
  searchExtra?: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  emptyText?: string
}

export function SearchableSelect({ value, onChange, options, placeholder = '— выберите —', emptyText = 'Ничего не найдено' }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dropUp, setDropUp] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find((o) => o.value === value)?.label ?? ''

  const normalize = (s: string) => s.toLowerCase().replace(/[-\s]/g, '')

  const filtered = query.trim()
    ? options.filter((o) => {
        const q = normalize(query)
        return (
          normalize(o.label).includes(q) ||
          (o.searchExtra && normalize(o.searchExtra).includes(q))
        )
      })
    : options

  const openDropdown = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    setDropUp(spaceBelow < 260 && rect.top > 260)
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 10)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const select = useCallback((v: string) => {
    onChange(v)
    close()
  }, [onChange, close])

  // Клик снаружи
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  // Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, close])

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Триггер */}
      <button
        type="button"
        onClick={() => open ? close() : openDropdown()}
        className="flex h-9 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 transition hover:border-slate-300 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
      >
        <span className={value ? 'text-slate-800' : 'text-slate-400'}>
          {value ? selectedLabel : placeholder}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`ml-2 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Дропдаун */}
      {open && (
        <div
          ref={listRef}
          className={`absolute z-50 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
          style={{ maxHeight: 280 }}
        >
          {/* Поиск */}
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="relative">
              <svg viewBox="0 0 24 24" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск..."
                className="h-7 w-full rounded-lg bg-slate-50 pl-7 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
          </div>

          {/* Список */}
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400">{emptyText}</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => select(o.value)}
                  className={`flex w-full items-center px-4 py-2 text-left text-sm transition hover:bg-blue-50 ${o.value === value ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-700'}`}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
