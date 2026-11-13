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
  labelOnBorder?: boolean
}

export const FbsStoreSelect = ({ value, stores, onChange, disabled = false, groupConnected = false, labelOnBorder = false }: FbsStoreSelectProps) => {
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

  const borderLabel = (
    <span className={`elestet-store-label${disabled ? ' is-disabled' : ''}`}>
      Магазин
    </span>
  )

  if (!groupConnected && !labelOnBorder) {
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
        className={`elestet-store-row${current ? ' is-current' : ''}`}
      >
        <span className={`elestet-store-dot ${tone === 'emerald' ? 'is-connected' : 'is-disconnected'}`} />
        <span className="elestet-store-option">{getStoreSelectorLabel(store)}</span>
      </button>
    )
  }

  const label = selected ? getStoreSelectorLabel(selected) : 'Выберите магазин'

  return (
    <div ref={rootRef} className={labelOnBorder ? 'elestet-store' : 'w-72 shrink-0 space-y-1.5 text-xs font-semibold text-slate-600'}>
      {labelOnBorder ? borderLabel : <span className="block">Магазин</span>}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (open) { setOpen(false); return }
          placeMenu()
          setOpen(true)
        }}
        className={`elestet-store-button${open ? ' is-open' : ''}`}
      >
        <span className={`elestet-store-name${!selected ? ' is-empty' : groupConnected ? (selected.teksher_login ? ' is-connected' : ' is-disconnected') : ''}`}>
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
          <button type="button" onClick={() => pick('')} className={`block w-full whitespace-normal break-words px-3 py-1.5 text-left hover:bg-slate-50 ${groupConnected ? 'text-black' : 'text-slate-500'}`}>
            <span className="elestet-store-option">Выберите магазин</span>
          </button>
          {!groupConnected && [...stores].sort(byLabel).map((store) => {
            const current = store.id === value
            return (
              <button
                key={store.id}
                type="button"
                onClick={() => pick(store.id)}
                className={`block w-full whitespace-normal break-words px-3 py-1.5 text-left text-slate-800 ${current ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                <span className="elestet-store-option">{getStoreSelectorLabel(store)}</span>
              </button>
            )
          })}
          {groupConnected && connected.map((store) => row(store, 'emerald'))}
          {groupConnected && disconnected.map((store) => row(store, 'red'))}
        </div>,
        document.body,
      )}
    </div>
  )
}
