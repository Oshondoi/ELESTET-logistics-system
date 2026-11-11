import { useEffect, useRef, useState } from 'react'
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
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
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
        className={`block w-full px-3 py-1.5 text-left text-sm ${tone === 'emerald' ? 'text-emerald-700' : 'text-red-600'} ${current ? 'bg-slate-100 font-semibold' : 'hover:bg-slate-50'}`}
      >
        {getStoreSelectorLabel(store)}
      </button>
    )
  }

  return (
    <div ref={rootRef} className="relative space-y-1.5 text-xs font-semibold text-slate-600">
      <span className="block">Магазин</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-9 min-w-[220px] items-center rounded-xl border bg-white px-3 text-left text-sm font-normal outline-none transition disabled:bg-slate-50 disabled:text-slate-400 ${open ? 'border-violet-400' : 'border-slate-200'}`}
      >
        <span className={selected ? (selected.teksher_login ? 'text-emerald-700' : 'text-red-600') : 'text-slate-400'}>
          {selected ? getStoreSelectorLabel(selected) : 'Выберите магазин'}
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-80 min-w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          <button type="button" onClick={() => pick('')} className="block w-full px-3 py-1.5 text-left text-sm font-normal text-slate-500 hover:bg-slate-50">
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
        </div>
      )}
    </div>
  )
}
