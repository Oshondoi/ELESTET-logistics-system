import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FulfillmentItem, FulfillmentSupplyWithBoxes } from '../../types'
import {
  replaceFulfillmentBoxContentsFromExcel,
  type FulfillmentBoxExcelImportResult,
  type FulfillmentKizAuditContext,
} from '../../services/fulfillmentService'
import {
  aggregateFulfillmentBoxExcelRows,
  downloadFulfillmentBoxImportTemplate,
  parseFulfillmentBoxImportFile,
  type FulfillmentBoxExcelImportRow,
} from '../../lib/fulfillmentBoxExcelImport'

interface Props {
  supply: FulfillmentSupplyWithBoxes
  batchNumber: number | null
  batchItems: FulfillmentItem[]
  auditContext: FulfillmentKizAuditContext
  onClose: () => void
  onImported: () => void | Promise<void>
}

interface PreviewBox {
  boxNumber: number
  exists: boolean
  oldPositions: number
  oldUnits: number
  newPositions: number
  newUnits: number
}

const sumUnits = (items: Array<{ qty: number }>) => items.reduce((sum, item) => sum + item.qty, 0)

export function FulfillmentBoxExcelDialog({
  supply,
  batchNumber,
  batchItems,
  auditContext,
  onClose,
  onImported,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<FulfillmentBoxExcelImportRow[]>([])
  const [fileName, setFileName] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busyAction, setBusyAction] = useState<'template' | 'parse' | 'import' | null>(null)
  const [result, setResult] = useState<FulfillmentBoxExcelImportResult | null>(null)

  const preview = useMemo<PreviewBox[]>(() => {
    const byBox = new Map<number, FulfillmentBoxExcelImportRow[]>()
    rows.forEach((row) => byBox.set(row.box_number, [...(byBox.get(row.box_number) ?? []), row]))
    return [...byBox.entries()]
      .sort(([left], [right]) => left - right)
      .map(([boxNumber, imported]) => {
        const existing = supply.boxes.find((box) => box.box_number === boxNumber)
        return {
          boxNumber,
          exists: Boolean(existing),
          oldPositions: existing?.items.length ?? 0,
          oldUnits: sumUnits(existing?.items ?? []),
          newPositions: imported.length,
          newUnits: sumUnits(imported),
        }
      })
  }, [rows, supply.boxes])

  const totalNewUnits = preview.reduce((sum, box) => sum + box.newUnits, 0)
  const totalOldUnits = preview.reduce((sum, box) => sum + box.oldUnits, 0)
  const untouchedBoxes = Math.max(0, supply.boxes.length - preview.filter((box) => box.exists).length)

  const handleDownloadTemplate = async () => {
    setBusyAction('template')
    setErrors([])
    try {
      await downloadFulfillmentBoxImportTemplate(supply, batchNumber)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Не удалось скачать шаблон Excel.'])
    } finally {
      setBusyAction(null)
    }
  }

  const handleFile = async (file: File) => {
    setBusyAction('parse')
    setRows([])
    setErrors([])
    setResult(null)
    setFileName(file.name)
    try {
      const parsed = await parseFulfillmentBoxImportFile(file)
      const nextErrors = [...parsed.errors]
      const knownBarcodes = new Set(batchItems.filter((item) => !item.is_excluded).map((item) => item.barcode.trim()))
      const unknownBarcodes = [...new Set(parsed.rows.map((row) => row.barcode).filter((barcode) => !knownBarcodes.has(barcode)))]
      if (unknownBarcodes.length > 0) {
        nextErrors.push(`Не найдены среди товаров этой партии: ${unknownBarcodes.join(', ')}.`)
      }
      const aggregated = aggregateFulfillmentBoxExcelRows(parsed.rows)
      const tooLarge = aggregated.find((row) => !Number.isSafeInteger(row.qty) || row.qty > 2_147_483_647)
      if (tooLarge) nextErrors.push(`Короб №${tooLarge.box_number}, баркод ${tooLarge.barcode}: суммарное количество слишком большое.`)
      if (nextErrors.length > 0) {
        setErrors(nextErrors)
        return
      }
      setRows(aggregated)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Не удалось прочитать Excel-файл.'])
    } finally {
      setBusyAction(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleImport = async () => {
    if (rows.length === 0 || busyAction) return
    setBusyAction('import')
    setErrors([])
    try {
      const imported = await replaceFulfillmentBoxContentsFromExcel({
        supply_id: supply.id,
        rows,
        filename: fileName,
        context: auditContext,
      })
      await onImported()
      setResult(imported)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Не удалось заменить содержимое коробов.'])
    } finally {
      setBusyAction(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={() => { if (!busyAction) onClose() }}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-xs font-black text-emerald-700">XLS</span>
              <div>
                <h3 className="font-black text-slate-900">Действия с Excel</h3>
                <p className="text-xs text-slate-400">{supply.warehouse_name} · Поставка П-{supply.supply_number}</p>
              </div>
            </div>
          </div>
          <button type="button" disabled={Boolean(busyAction)} onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 disabled:opacity-40">×</button>
        </div>

        <div className="space-y-4 p-6">
          {errors.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-bold">Excel не применён</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
              </ul>
            </div>
          )}

          {result ? (
            <div className="space-y-4">
              <div className="rounded-2xl bg-emerald-50 p-5 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-xl font-black text-white">✓</div>
                <p className="mt-3 font-black text-emerald-900">Содержимое коробов обновлено</p>
                <p className="mt-1 text-sm text-emerald-700">
                  {result.affected_boxes} кор. · {result.total_positions} поз. · {result.total_units} ед.
                </p>
                {result.created_boxes > 0 && <p className="mt-1 text-xs text-emerald-700">Создано новых коробов: {result.created_boxes}</p>}
                {result.archived_kiz > 0 && <p className="mt-1 text-xs text-amber-700">КИЗов перенесено в историю: {result.archived_kiz}</p>}
              </div>
              <button type="button" onClick={onClose} className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white">Закрыть</button>
            </div>
          ) : rows.length === 0 ? (
            <>
              <p className="text-sm leading-relaxed text-slate-500">
                Шаблон содержит колонки «Баркод», «Количество» и «Номер короба». Номера существующих коробов уже будут добавлены в файл.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button type="button" disabled={Boolean(busyAction)} onClick={() => void handleDownloadTemplate()} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left transition hover:border-emerald-400 disabled:opacity-50">
                  <span className="block text-sm font-black text-emerald-800">Скачать шаблон</span>
                  <span className="mt-1 block text-xs leading-relaxed text-emerald-700">Пустой Excel с тремя колонками и номерами существующих коробов.</span>
                </button>
                <button type="button" disabled={Boolean(busyAction)} onClick={() => fileInputRef.current?.click()} className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-left transition hover:border-blue-400 disabled:opacity-50">
                  <span className="block text-sm font-black text-blue-800">Загрузить Excel</span>
                  <span className="mt-1 block text-xs leading-relaxed text-blue-700">Проверить файл и показать заменяемые или создаваемые короба.</span>
                </button>
              </div>
              {busyAction === 'parse' && <p className="text-center text-sm font-medium text-blue-600">Читаю и проверяю файл…</p>}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-3">
                <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{fileName}</p><p className="text-xs text-slate-400">Будут изменены только перечисленные ниже короба</p></div>
                <button type="button" disabled={Boolean(busyAction)} onClick={() => fileInputRef.current?.click()} className="text-xs font-bold text-blue-600 disabled:opacity-40">Выбрать другой</button>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <span>Короб</span><span>Было</span><span>Станет</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {preview.map((box) => (
                    <div key={box.boxNumber} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3 text-sm">
                      <span className="font-bold text-slate-800">Короб №{box.boxNumber}{!box.exists && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">будет создан</span>}</span>
                      <span className="text-right text-slate-400">{box.oldPositions} поз. · {box.oldUnits} ед.</span>
                      <span className="text-right font-bold text-blue-700">{box.newPositions} поз. · {box.newUnits} ед.</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                Содержимое указанных существующих коробов будет полностью заменено. Связанные КИЗы останутся в истории с причиной Excel-замены; при повторном скане они свяжутся с новым товаром и коробом без повторного увеличения количества.
              </div>
              <p className="text-xs text-slate-400">Изменяется: {preview.length} кор. · было {totalOldUnits} ед. · станет {totalNewUnits} ед. · без изменений {untouchedBoxes} кор.</p>
              <div className="flex gap-2">
                <button type="button" disabled={Boolean(busyAction)} onClick={() => { setRows([]); setErrors([]); setFileName('') }} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 disabled:opacity-40">Назад</button>
                <button type="button" disabled={Boolean(busyAction)} onClick={() => void handleImport()} className="flex-[1.5] rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40">
                  {busyAction === 'import' ? 'Применяю…' : `Заменить содержимое ${preview.length} кор.`}
                </button>
              </div>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file) }}
        />
      </div>
    </div>,
    document.body,
  )
}
