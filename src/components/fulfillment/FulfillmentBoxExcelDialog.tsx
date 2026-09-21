import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FulfillmentSupplyWithBoxes } from '../../types'
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
  auditContext: FulfillmentKizAuditContext
  onClose: () => void
  onImported: () => void | Promise<void>
}

interface PreviewBox {
  boxNumber: number
  exists: boolean
  action: 'create_empty' | 'create_filled' | 'replace' | 'fill_first' | 'unchanged'
  oldPositions: number
  oldUnits: number
  newPositions: number
  newUnits: number
}

const sumUnits = (items: Array<{ qty: number }>) => items.reduce((sum, item) => sum + item.qty, 0)

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

const actionPresentation = (action: PreviewBox['action'], completed: boolean) => {
  if (action === 'create_empty') return {
    label: completed ? 'Создан пустым' : 'Будет создан пустым',
    colors: 'bg-blue-100 text-blue-700',
    icon: <path d="M5 8.5 12 5l7 3.5M5 8.5V16l7 3.5 7-3.5V8.5M12 12v7.5M12 3v4M10 5h4" />,
  }
  if (action === 'create_filled') return {
    label: completed ? 'Создан и заполнен' : 'Будет создан и заполнен',
    colors: 'bg-emerald-100 text-emerald-700',
    icon: <><path d="M5 8.5 12 5l7 3.5M5 8.5V16l7 3.5 7-3.5V8.5M12 12v7.5" /><path d="m8.5 12.5 2 2 4-4" /></>,
  }
  if (action === 'replace') return {
    label: completed ? 'Содержимое заменено' : 'Содержимое будет заменено',
    colors: 'bg-violet-100 text-violet-700',
    icon: <><path d="M7 7h9l-2.5-2.5M17 17H8l2.5 2.5" /><path d="M18 8a7 7 0 0 1 0 8M6 16a7 7 0 0 1 0-8" /></>,
  }
  if (action === 'fill_first') return {
    label: completed ? 'Заполнен впервые' : 'Пустой короб будет заполнен впервые',
    colors: 'bg-teal-100 text-teal-700',
    icon: <><path d="M5 10v6l7 3.5 7-3.5v-6M5 10l7 3.5 7-3.5M12 13.5v6" /><path d="M12 3v6M9.5 6.5 12 9l2.5-2.5" /></>,
  }
  return {
    label: completed ? 'Оставлен без изменений' : 'Останется без изменений',
    colors: 'bg-slate-100 text-slate-500',
    icon: <path d="m6 12 4 4 8-8" />,
  }
}

function BoxActionIcon({ action, completed = false }: { action: PreviewBox['action']; completed?: boolean }) {
  const presentation = actionPresentation(action, completed)
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${presentation.colors}`} title={presentation.label}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {presentation.icon}
      </svg>
    </span>
  )
}

export function FulfillmentBoxExcelDialog({
  supply,
  batchNumber,
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
  const [appliedPreview, setAppliedPreview] = useState<PreviewBox[]>([])

  const preview = useMemo<PreviewBox[]>(() => {
    const byBox = new Map<number, FulfillmentBoxExcelImportRow[]>()
    rows.forEach((row) => byBox.set(row.box_number, [...(byBox.get(row.box_number) ?? []), row]))
    return [...byBox.entries()]
      .sort(([left], [right]) => left - right)
      .map(([boxNumber, imported]) => {
        const existing = supply.boxes.find((box) => box.box_number === boxNumber)
        const importedContent = imported.filter((row) => row.barcode !== '' && row.qty > 0)
        const oldPositions = existing?.items.length ?? 0
        const oldUnits = sumUnits(existing?.items ?? [])
        const importedPositions = importedContent.length
        const importedUnits = sumUnits(importedContent)
        const action: PreviewBox['action'] = !existing
          ? importedPositions > 0 ? 'create_filled' : 'create_empty'
          : importedPositions === 0
            ? 'unchanged'
            : oldPositions > 0 ? 'replace' : 'fill_first'
        return {
          boxNumber,
          exists: Boolean(existing),
          action,
          oldPositions,
          oldUnits,
          newPositions: action === 'unchanged' ? oldPositions : importedPositions,
          newUnits: action === 'unchanged' ? oldUnits : importedUnits,
        }
      })
  }, [rows, supply.boxes])

  const totalNewUnits = preview.reduce((sum, box) => sum + box.newUnits, 0)
  const totalOldUnits = preview.reduce((sum, box) => sum + box.oldUnits, 0)
  const untouchedBoxes = Math.max(0, supply.boxes.length - preview.filter((box) => box.exists).length)
  const completedPreview: PreviewBox[] = result?.box_results?.length
    ? result.box_results.map((box) => ({
      boxNumber: box.box_number,
      exists: box.action !== 'create_empty' && box.action !== 'create_filled',
      action: box.action,
      oldPositions: box.old_positions,
      oldUnits: box.old_units,
      newPositions: box.new_positions,
      newUnits: box.new_units,
    }))
    : appliedPreview

  const handleDownloadTemplate = async () => {
    setBusyAction('template')
    setErrors([])
    try {
      await downloadFulfillmentBoxImportTemplate(supply, batchNumber)
    } catch (error) {
      setErrors([errorMessage(error, 'Не удалось скачать шаблон Excel.')])
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
      const aggregated = aggregateFulfillmentBoxExcelRows(parsed.rows, parsed.boxNumbers)
      const tooLarge = aggregated.find((row) => row.barcode !== '' && (!Number.isSafeInteger(row.qty) || row.qty > 2_147_483_647))
      if (tooLarge) nextErrors.push(`Короб №${tooLarge.box_number}, баркод ${tooLarge.barcode}: суммарное количество слишком большое.`)
      if (nextErrors.length > 0) {
        setErrors(nextErrors)
        return
      }
      setRows(aggregated)
    } catch (error) {
      setErrors([errorMessage(error, 'Не удалось прочитать Excel-файл.')])
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
      const plannedActions = preview
      const imported = await replaceFulfillmentBoxContentsFromExcel({
        supply_id: supply.id,
        rows,
        filename: fileName,
        context: auditContext,
      })
      setAppliedPreview(plannedActions)
      await onImported()
      setResult(imported)
    } catch (error) {
      setErrors([errorMessage(error, 'Не удалось заменить содержимое коробов.')])
    } finally {
      setBusyAction(null)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/45 p-4"
      onMouseDown={() => { if (!busyAction) onClose() }}
      onClick={(event) => event.stopPropagation()}
    >
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
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Результат по коробам</p>
                {completedPreview.map((box) => {
                  const presentation = actionPresentation(box.action, true)
                  return (
                    <div key={box.boxNumber} className="flex items-center gap-3 rounded-2xl border border-slate-100 px-4 py-3">
                      <BoxActionIcon action={box.action} completed />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-800">Короб №{box.boxNumber}</p>
                        <p className="text-xs font-semibold text-slate-500">{presentation.label}</p>
                      </div>
                      <span className="text-right text-xs font-bold text-slate-600">{box.newPositions} поз.<br />{box.newUnits} ед.</span>
                    </div>
                  )
                })}
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
                <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{fileName}</p><p className="text-xs text-slate-400">Проверка точных действий по каждому коробу из Excel</p></div>
                <button type="button" disabled={Boolean(busyAction)} onClick={() => fileInputRef.current?.click()} className="text-xs font-bold text-blue-600 disabled:opacity-40">Выбрать другой</button>
              </div>

              <div className="space-y-2">
                {preview.map((box) => {
                  const presentation = actionPresentation(box.action, false)
                  return (
                    <div key={box.boxNumber} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                      <BoxActionIcon action={box.action} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-800">Короб №{box.boxNumber}</p>
                        <p className="text-xs font-semibold text-slate-500">{presentation.label}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-right text-[11px]">
                        <div><span className="block text-slate-400">Было</span><b className="text-slate-600">{box.oldPositions} поз. · {box.oldUnits} ед.</b></div>
                        <div><span className="block text-blue-400">Станет</span><b className="text-blue-700">{box.newPositions} поз. · {box.newUnits} ед.</b></div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                Содержимое указанных существующих коробов будет полностью заменено. Связанные КИЗы останутся в истории с причиной Excel-замены; при повторном скане они свяжутся с новым товаром и коробом без повторного увеличения количества.
              </div>
              <p className="text-xs text-slate-400">В Excel: {preview.length} кор. · было {totalOldUnits} ед. · станет {totalNewUnits} ед. · вне файла без изменений: {untouchedBoxes} кор.</p>
              <div className="flex gap-2">
                <button type="button" disabled={Boolean(busyAction)} onClick={() => { setRows([]); setErrors([]); setFileName('') }} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 disabled:opacity-40">Назад</button>
                <button type="button" disabled={Boolean(busyAction)} onClick={() => void handleImport()} className="flex-[1.5] rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40">
                  {busyAction === 'import' ? 'Применяю…' : `Выполнить действия: ${preview.length} кор.`}
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
