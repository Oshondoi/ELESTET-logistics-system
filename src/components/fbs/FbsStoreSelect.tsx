import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getStoreSelectorLabel } from '../../lib/storeDisplay'
import type { Store } from '../../types'

interface FbsStoreSelectProps {
  value: string
  stores: Array<Pick<Store, 'id' | 'name' | 'supplier' | 'supplier_full' | 'store_code'> & { teksher_login?: string | null }>
  onChange: (storeId: string) => void
  disabled?: boolean
  groupConnected?: boolean
}

export const FbsStoreSelect = ({ value, stores, onChange, disabled = false, groupConnected = false }: FbsStoreSelectProps) => {
  const byLabel = (left: (typeof stores)[number], right: (typeof stores)[number]) =>
    getStoreSelectorLabel(left).localeCompare(getStoreSelectorLabel(right), 'ru')
  const connected = groupConnected ? stores.filter((store) => store.teksher_login).sort(byLabel) : []
  const disconnected = groupConnected ? stores.filter((store) => !store.teksher_login).sort(byLabel) : []
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const placeMenu = () => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    setBox({
      left: rect.left,
      top: rect.bottom + 4,
      width: rect.width,
      maxHeight: Math.max(160, Math.min(320, window.innerHeight - rect.bottom - 12)),
    })
  }

  useEffect(() => {
    if (!open) return
    placeMenu()
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onLayout = () => placeMenu()
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('scroll', onLayout, true)
    window.addEventListener('resize', onLayout)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('scroll', onLayout, true)
      window.removeEventListener('resize', onLayout)
    }
  }, [open])

  if (!groupConnected) {
    return (
      <label className="space-y-1.5 text-xs font-semibold text-slate-600">
        <span className="block">Магазин</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="h-9 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400 disabled:bg-slate-50 disabled:text-slate-400"
        >
          <option value="">Выберите магазин</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>{getStoreSelectorLabel(store)}</option>
          ))}
        </select>
      </label>
    )
  }

  const selected = stores.find((store) => store.id === value)
  const pick = (storeId: string) => {
    onChange(storeId)
    setOpen(false)
  }
  const row = (store: (typeof stores)[number], tone: 'emerald' | 'red') => {
    const current = store.id === value
    return (
      <button
        key={store.id}
        type="button"
        onClick={() => pick(store.id)}
        className={`block w-full whitespace-normal break-words px-3 py-1.5 text-left text-sm ${tone === 'emerald' ? 'text-emerald-700' : 'text-red-600'} ${current ? 'bg-slate-100 font-semibold' : 'hover:bg-slate-50'}`}
      >
        {getStoreSelectorLabel(store)}
      </button>
    )
  }

  const label = selected ? getStoreSelectorLabel(selected) : 'Выберите магазин'

  return (
    <div ref={rootRef} className="w-72 shrink-0 space-y-1.5 text-xs font-semibold text-slate-600">
      <span className="block">Магазин</span>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (open) { setOpen(false); return }
          placeMenu()
          setOpen(true)
        }}
        className={`flex h-9 w-full items-center gap-2 rounded-xl border bg-white px-3 text-left text-sm font-normal outline-none transition-colors disabled:bg-slate-50 disabled:text-slate-400 ${open ? 'border-violet-400' : 'border-slate-200'}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? (selected.teksher_login ? 'text-emerald-700' : 'text-red-600') : 'text-slate-400'}`}>
          {label}
        </span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-400" fill="currentColor" aria-hidden>
          <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && box && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[80] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
          style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
        >
          <button type="button" onClick={() => pick('')} className="block w-full whitespace-normal break-words px-3 py-1.5 text-left text-sm font-normal text-slate-500 hover:bg-slate-50">
            Выберите магазин
          </button>
          {connected.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Подключены к Teksher</p>
              {connected.map((store) => row(store, 'emerald'))}
            </>
          )}
          {disconnected.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-red-600">Без Teksher</p>
              {disconnected.map((store) => row(store, 'red'))}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
