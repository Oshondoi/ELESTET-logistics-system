import { useState } from 'react'
import type { FulfillmentSupplyWithBoxes } from '../../types'
import {
  BARCODE_EXPORT_COLUMNS,
  BOX_EXPORT_OPTIONAL_COLUMNS,
  BOX_EXPORT_STORAGE_KEY,
  SYSTEM_BOX_EXPORT_COLUMNS,
  getStoredBoxExportColumns,
  hasCompleteWbBoxCodes,
  type FulfillmentExcelMode,
  type OptionalBoxExportColumnKey,
} from '../../lib/fulfillmentBoxExportConfig'

interface Props {
  supply: FulfillmentSupplyWithBoxes
  onDownloadSystem: (
    optionalColumns: OptionalBoxExportColumnKey[],
    mode: FulfillmentExcelMode,
  ) => Promise<void>
  onDownloadWb: () => Promise<void>
}

const LockIcon = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="5" y="10" width="14" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
)

export function FulfillmentSupplyExcelExport({ supply, onDownloadSystem, onDownloadWb }: Props) {
  const [barcodeSource, setBarcodeSource] = useState<'system' | 'wb'>('system')
  const [mode, setMode] = useState<FulfillmentExcelMode>('boxes')
  const [selectedColumns, setSelectedColumns] = useState<OptionalBoxExportColumnKey[]>(getStoredBoxExportColumns)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wbAvailable = hasCompleteWbBoxCodes(supply.boxes)

  const toggleColumn = (key: OptionalBoxExportColumnKey) => {
    setSelectedColumns((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
      localStorage.setItem(BOX_EXPORT_STORAGE_KEY, JSON.stringify(next))
      return next
    })
    setError(null)
  }

  const download = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (barcodeSource === 'wb') await onDownloadWb()
      else await onDownloadSystem(selectedColumns, mode)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось скачать Excel')
    } finally {
      setBusy(false)
    }
  }

  const leadingColumns = barcodeSource === 'wb'
    ? SYSTEM_BOX_EXPORT_COLUMNS.slice(0, 2)
    : mode === 'barcodes'
      ? BARCODE_EXPORT_COLUMNS
      : SYSTEM_BOX_EXPORT_COLUMNS.slice(0, 2)
  const trailingSystemColumns = mode === 'barcodes' ? [] : SYSTEM_BOX_EXPORT_COLUMNS.slice(3)

  const renderColumn = (column: typeof SYSTEM_BOX_EXPORT_COLUMNS[number] | typeof BARCODE_EXPORT_COLUMNS[number]) => {
    if (!column.required) {
      const key = column.key as OptionalBoxExportColumnKey
      const selected = selectedColumns.includes(key)
      return (
        <button
          key={column.key}
          type="button"
          disabled={busy}
          onClick={() => toggleColumn(key)}
          className={`flex h-9 w-full items-center gap-2 rounded-xl border px-3 text-xs font-medium transition-colors disabled:opacity-40 ${selected ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-400'}`}
        >
          <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300 bg-white'}`}>
            {selected && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m2 6 2.5 2.5L10 3" /></svg>}
          </span>
          {column.label}
        </button>
      )
    }
    return (
      <div key={column.key} title="Обязательная колонка" className="flex h-9 w-full cursor-not-allowed items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 text-xs font-medium text-slate-600">
        <LockIcon />
        {column.label}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {barcodeSource === 'system' && (
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {([
            ['boxes', 'По коробам'],
            ['barcodes', 'По баркодам'],
            ['both', 'Оба'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={busy}
              onClick={() => { setMode(value); setError(null) }}
              className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${mode === value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {leadingColumns.map(renderColumn)}

        {(barcodeSource === 'wb' || mode !== 'barcodes') && (
          <div className="grid min-h-11 grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => { setBarcodeSource('system'); setError(null) }}
              className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${barcodeSource === 'system' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
            >
              Системный ШК короба
            </button>
            <button
              type="button"
              disabled={busy || !wbAvailable}
              onClick={() => { setBarcodeSource('wb'); setError(null) }}
              className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed ${barcodeSource === 'wb' ? 'bg-white text-violet-700 shadow-sm' : wbAvailable ? 'text-slate-500 hover:text-violet-700' : 'text-slate-400'}`}
            >
              <span className="block">ШК короба WB</span>
              {!wbAvailable && <span className="block text-[10px] font-medium text-amber-600">Отсутствует</span>}
            </button>
          </div>
        )}

        {barcodeSource === 'system' && trailingSystemColumns.map(renderColumn)}

        {barcodeSource === 'wb' && (
          <div className="space-y-1.5">
            <div title="Обязательная колонка" className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 text-xs font-medium text-slate-600"><LockIcon />Срок годности</div>
            <div title="Обязательная колонка" className="flex min-h-9 items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600"><LockIcon />ШК короба для печати в стороннем сервисе</div>
          </div>
        )}
      </div>

      {barcodeSource === 'wb' && (
        <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs leading-relaxed text-violet-700">
          Будет скачан готовый однолистный шаблон WB с распределением товаров по коробам.
        </p>
      )}
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      <div className="flex justify-end border-t border-slate-100 pt-4">
        <button
          type="button"
          disabled={busy || (barcodeSource === 'wb' && !wbAvailable)}
          onClick={() => void download()}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {busy ? 'Подготовка…' : 'Скачать Excel'}
        </button>
      </div>
    </div>
  )
}
