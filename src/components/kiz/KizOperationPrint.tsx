import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildKizPdf, downloadKizCsv, openKizPdf, type LabelLayout } from '../../lib/kizLabel'
import { fetchLabelGoods, resolvePrintCodes } from '../../services/kizCacheService'

type PrintKind = 'csv' | 'pdf-vertical' | 'pdf-horizontal' | 'print-vertical' | 'print-horizontal'

const ACTIONS: Array<{ kind: PrintKind; label: string }> = [
  { kind: 'csv', label: 'CSV' },
  { kind: 'pdf-horizontal', label: 'PDF горизонтальный' },
  { kind: 'pdf-vertical', label: 'PDF вертикальный' },
  { kind: 'print-horizontal', label: 'Печать горизонтально' },
  { kind: 'print-vertical', label: 'Печать вертикально' },
]

export function KizOperationPrint({
  storeId,
  operationId,
  gtin,
  product,
  onError,
  onDone,
}: {
  storeId: string
  operationId: string
  gtin?: string
  product: Record<string, unknown> | null
  onError: (message: string) => void
  onDone: (message: string) => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null)

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 220
    const height = ACTIONS.length * 32 + 8
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    const openUp = rect.bottom + height > window.innerHeight && rect.top > height
    setMenu({ top: openUp ? rect.top - height - 4 : rect.bottom + 4, left })
  }

  useEffect(() => {
    if (!menu) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setMenu(null)
    }
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const run = async (kind: PrintKind) => {
    if (busy) return
    setMenu(null)
    setBusy(true)
    try {
      const codes = await resolvePrintCodes(storeId, operationId)
      if (codes.length === 0) {
        onError('В этой операции нет кодов для печати.')
        return
      }
      if (kind === 'csv') {
        downloadKizCsv(codes, operationId)
        onDone(`CSV: ${codes.length} кодов. Не открывайте файл в Excel.`)
        return
      }
      const layout: LabelLayout = kind.endsWith('vertical') ? 'vertical' : 'horizontal'
      const linked = await fetchLabelGoods(storeId, gtin ?? codes[0]?.gtin ?? '')
      const { pdf, limited } = buildKizPdf(codes, layout, product, linked)
      openKizPdf(pdf, operationId, layout, kind.startsWith('print'))
      onDone(limited
        ? 'В PDF первые 1000 кодов: так ограничивает печатную форму Teksher. Полный список — в CSV.'
        : kind.startsWith('print') ? 'Открыто окно печати.' : 'PDF сохранён.')
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Не удалось подготовить печать.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={busy}
        onClick={() => menu ? setMenu(null) : openMenu()}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:text-slate-200 disabled:hover:bg-transparent"
        title="Печать"
        aria-label="Печать"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
          <path d="M18 12h.01" />
        </svg>
      </button>
      {menu && createPortal(
        <div
          ref={menuRef}
          style={{ top: menu.top, left: menu.left }}
          className="fixed z-[80] w-[220px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {ACTIONS.map((action) => (
            <button
              key={action.kind}
              type="button"
              onClick={() => void run(action.kind)}
              className="block w-full rounded-lg px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
            >
              {action.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
