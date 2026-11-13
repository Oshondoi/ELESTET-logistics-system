import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildKizPdf, downloadKizCsv, openKizPdf } from '../../lib/kizLabel'
import { pagesToPdf, renderSheet, renderSystemCombined, type LabelTemplate } from '../../lib/labelSheet'
import { fetchLabelGoods, resolvePrintCodes, type PrintCode } from '../../services/kizCacheService'
import { fetchLabelTemplates, goodsForPrint } from '../../services/labelTemplateService'

type PrintKind = 'csv' | 'kiz' | 'combined'

const ACTIONS: Array<{ kind: PrintKind; label: string }> = [
  { kind: 'csv', label: 'CSV' },
  { kind: 'kiz', label: 'Печать КИЗ' },
  { kind: 'combined', label: 'Печать КИЗ + ШК' },
]

export function KizOperationPrint({
  accountId,
  storeId,
  operationId,
  gtin,
  product,
  expectedCount = 0,
  enabled = true,
  onError,
  onDone,
}: {
  accountId: string
  storeId: string
  operationId: string
  gtin?: string
  product: Record<string, unknown> | null
  expectedCount?: number
  enabled?: boolean
  onError: (message: string) => void
  onDone: (message: string) => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null)
  const [choice, setChoice] = useState<{ kind: 'kiz' | 'combined'; codes: PrintCode[]; options: LabelTemplate[] } | null>(null)

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

  const printSheets = async (kind: 'kiz' | 'combined', codes: PrintCode[], template: LabelTemplate | null) => {
    if (kind === 'kiz' && !template) {
      const linked = await fetchLabelGoods(storeId, gtin ?? codes[0]?.gtin ?? '')
      const { pdf, limited } = buildKizPdf(codes, product, linked)
      openKizPdf(pdf, operationId)
      onDone(limited ? 'В PDF первые 1000 кодов. Полный список — в CSV.' : 'PDF сохранён.')
      return
    }
    const codeGtin = gtin || codes[0]?.gtin || ''
    const loaded = await goodsForPrint(storeId, codeGtin, product)
    if (kind === 'combined' && !loaded.linked) {
      throw new Error('Сначала свяжите штрихкод товара с этим GTIN. Кнопка «Связать» на вкладке КИЗы.')
    }
    const canvases: HTMLCanvasElement[] = []
    let skipped = 0
    let firstError = ''
    codes.forEach((code) => {
      try {
        const page = { goods: loaded.goods, code, number: canvases.length + 1 }
        const canvas = template
          ? renderSheet(template, page).canvas
          : renderSystemCombined(page)
        canvases.push(canvas)
      } catch (reason) {
        skipped += 1
        if (!firstError) firstError = reason instanceof Error ? reason.message : 'Код нельзя напечатать.'
      }
    })
    if (canvases.length === 0) throw new Error(firstError || 'Нет кодов, которые можно напечатать.')
    const size = template?.size ?? '58x40'
    pagesToPdf(size, canvases).save(`kiz-${operationId}.pdf`)
    onDone(skipped
      ? `PDF сохранён. Не напечатано ${skipped}: ${firstError}`
      : 'PDF сохранён.')
  }

  const run = async (kind: PrintKind) => {
    if (busy) return
    setMenu(null)
    setBusy(true)
    try {
      const codes = await resolvePrintCodes(storeId, operationId, expectedCount)
      if (codes.length === 0) {
        onError('В этой операции нет кодов для печати.')
        return
      }
      if (kind === 'csv') {
        downloadKizCsv(codes, operationId)
        onDone(`CSV: ${codes.length} кодов. Не открывайте файл в Excel.`)
        return
      }
      const templates = accountId ? await fetchLabelTemplates(accountId) : []
      const options = templates.filter((item) => item.mode === kind)
      if (options.length > 0) {
        setChoice({ kind, codes, options })
        return
      }
      await printSheets(kind, codes, null)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Не удалось подготовить печать.')
    } finally {
      setBusy(false)
    }
  }

  const choose = async (template: LabelTemplate | null) => {
    if (!choice) return
    const current = choice
    setChoice(null)
    setBusy(true)
    try {
      await printSheets(current.kind, current.codes, template)
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
        disabled={busy || !enabled}
        onClick={() => menu ? setMenu(null) : openMenu()}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:text-slate-200 disabled:hover:bg-transparent"
        title={enabled ? 'Печать' : 'Сначала заберите CSV'}
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
      {choice && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <p className="text-sm font-semibold text-slate-900">Какой лист печатать?</p>
            <div className="mt-3 flex flex-col gap-1">
              <button type="button" onClick={() => void choose(null)} className="rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50">Наш лист</button>
              {choice.options.map((template) => (
                <button key={template.id} type="button" onClick={() => void choose(template)} className="rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50">{template.name}</button>
              ))}
            </div>
            <button type="button" onClick={() => setChoice(null)} className="mt-3 text-sm text-slate-500">Отмена</button>
          </div>
        </div>
      )}
    </>
  )
}
