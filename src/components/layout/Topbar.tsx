import { useEffect, useRef, useState } from 'react'

interface TopbarProps {
  title: string
  userName: string
  userEmail: string
  onProfileClick: () => void
  onSignOut: () => void
}

export const Topbar = ({ title, userName, userEmail, onProfileClick, onSignOut }: TopbarProps) => {
  const initial = userName ? userName.charAt(0).toUpperCase() : (userEmail ? userEmail.charAt(0).toUpperCase() : '?')
  const displayName = userName || userEmail || 'Профиль'
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-4">
      <div className="flex items-center gap-3">
        <div className="text-xl font-semibold tracking-tight text-slate-900">{title}</div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Уведомления"
          className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
        >
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 5a4 4 0 0 0-4 4v2.5c0 .8-.3 1.6-.9 2.2L6 15h12l-1.1-1.3a3 3 0 0 1-.9-2.2V9a4 4 0 0 0-4-4Z" />
            <path d="M10 18a2 2 0 0 0 4 0" />
          </svg>
        </button>

        {/* Профиль-дропдаун */}
        <div className="relative" ref={ref}>
          <button
            type="button"
            aria-label="Профиль"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 rounded-2xl bg-white px-1 py-1 hover:bg-slate-50"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700">
              {initial}
            </span>
            <span className="text-left">
              <span className="block text-sm font-medium leading-none text-slate-900">{displayName}</span>
              <span className="block max-w-[140px] truncate text-xs text-slate-500">{userEmail}</span>
            </span>
          </button>

          {open ? (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-2xl border border-slate-200 bg-white py-1.5 shadow-lg">
              {/* Шапка */}
              <div className="border-b border-slate-100 px-4 pb-2.5 pt-2">
                <p className="text-sm font-semibold text-slate-900 truncate">{displayName}</p>
                <p className="mt-0.5 text-xs text-slate-400 truncate">{userEmail}</p>
              </div>

              {/* Пункты */}
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => { setOpen(false); onProfileClick() }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                  Настройки профиля
                </button>
              </div>

              <div className="border-t border-slate-100 py-1">
                <button
                  type="button"
                  onClick={() => { setOpen(false); onSignOut() }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-rose-500 hover:bg-rose-50"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Выйти из аккаунта
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
