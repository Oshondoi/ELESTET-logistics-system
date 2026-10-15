import { useEffect, useState } from 'react'

export type ScanSuccessKind = 'product' | 'fbs' | 'kiz' | 'box' | 'address' | 'cancelled'

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
  if (kind === 'cancelled') return 'Заказ FBS отменён'
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
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-[300] h-[45dvh] w-full transition-opacity duration-1000 ease-linear ${fading ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className={`flex h-full w-full flex-col items-center justify-center overflow-hidden border-t px-4 py-4 text-center text-white shadow-2xl backdrop-blur-md sm:px-7 ${entry.kind === 'cancelled' ? 'border-red-300/70 bg-red-700/95' : 'border-white/60 bg-[#191919]/95'}`}>
        <div className={`text-xs font-bold uppercase tracking-[0.18em] ${entry.kind === 'cancelled' ? 'text-red-100' : 'text-emerald-300'}`}>
          {entry.title || defaultTitle(entry.kind)}
        </div>
        <div className="mt-2 max-w-full break-all font-mono font-black leading-none tracking-wider" style={{ fontSize: entry.primary.length > 12 ? 'clamp(24px, 6dvh, 48px)' : `clamp(32px, min(18dvh, ${130 / Math.max(entry.primary.length, 4)}vw), 160px)` }}>
          {entry.primary}
        </div>
        {entry.details?.filter(Boolean).map((detail, index) => (
          <div key={`${detail}-${index}`} className={`mt-2 text-sm font-semibold ${entry.kind === 'cancelled' ? 'text-white' : 'text-slate-200'}`}>
            {detail}
          </div>
        ))}
      </div>
    </div>
  )
}
