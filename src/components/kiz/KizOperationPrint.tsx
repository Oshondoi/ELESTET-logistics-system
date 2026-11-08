import { useState } from 'react'
import { buildKizPdf, downloadKizCsv, openKizPdf, type LabelLayout } from '../../lib/kizLabel'
import { fetchLabelGoods, fetchOperationCodes } from '../../services/kizCacheService'

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
  const [busy, setBusy] = useState(false)

  const run = async (kind: PrintKind) => {
    if (busy) return
    setBusy(true)
    try {
      const codes = await fetchOperationCodes(storeId, operationId)
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
    <div className="flex max-w-[220px] flex-wrap gap-x-2 gap-y-1">
      {ACTIONS.map((action) => (
        <button
          key={action.kind}
          type="button"
          disabled={busy}
          onClick={() => void run(action.kind)}
          className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
        >
          {busy ? '…' : action.label}
        </button>
      ))}
    </div>
  )
}
