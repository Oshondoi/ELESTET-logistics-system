import { useEffect, useState } from 'react'

export type ScanSuccessKind = 'product' | 'fbs' | 'kiz' | 'box' | 'address'

export interface ScanSuccessPayload {
  kind: ScanSuccessKind
  primary: string
  title?: string
  details?: string[]
}

const EVENT_NAME = 'elestet:scan-success'

export function showScanSuccess(payload: ScanSuccessPayload) {
  window.dispatchEvent(new CustomEvent<ScanSuccessPayload>(EVENT_NAME, { detail: payload }))
}

function defaultTitle(kind: ScanSuccessKind) {
  if (kind === 'product') return 'Баркод принят'
  if (kind === 'fbs') return 'Заказ FBS найден'
  if (kind === 'kiz') return 'КИЗ принят'
  if (kind === 'box') return 'Короб найден'
  return 'Адрес найден'
}

export function ScanSuccessOverlayHost() {
  const [entry, setEntry] = useState<(ScanSuccessPayload & { nonce: number }) | null>(null)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const onSuccess = (event: Event) => {
      const payload = (event as CustomEvent<ScanSuccessPayload>).detail
      if (!payload?.primary) return
      setFading(false)
      setEntry({ ...payload, nonce: Date.now() })
    }
    window.addEventListener(EVENT_NAME, onSuccess)
    return () => window.removeEventListener(EVENT_NAME, onSuccess)
  }, [])

  useEffect(() => {
    if (!entry) return
    const fadeTimer = window.setTimeout(() => setFading(true), 1500)
    const removeTimer = window.setTimeout(() => {
      setEntry(null)
      setFading(false)
    }, 2500)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(removeTimer)
    }
  }, [entry])

  if (!entry) return null

  return (
    <div
      key={entry.nonce}
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 top-[18%] z-[300] flex justify-center px-4 transition-opacity duration-1000 ease-linear ${fading ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="min-w-[260px] max-w-[min(92vw,680px)] rounded-3xl border border-white/60 bg-slate-950/92 px-7 py-5 text-center text-white shadow-2xl backdrop-blur-md">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
          {entry.title || defaultTitle(entry.kind)}
        </div>
        <div className="mt-1 break-all font-mono text-5xl font-black leading-none tracking-wider sm:text-7xl">
          {entry.primary}
        </div>
        {entry.details?.filter(Boolean).map((detail, index) => (
          <div key={`${detail}-${index}`} className="mt-2 text-sm font-semibold text-slate-200">
            {detail}
          </div>
        ))}
      </div>
    </div>
  )
}
