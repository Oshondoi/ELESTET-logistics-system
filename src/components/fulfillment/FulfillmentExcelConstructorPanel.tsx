import { useEffect, useMemo, useState } from 'react'
import type { FulfillmentSupplyWithBoxes } from '../../types'
import {
  EXCEL_CONSTRUCTOR_COLUMNS,
  type ExcelConstructorColumnKey,
  type ExcelConstructorProductLookup,
  downloadConstructorExcel,
} from '../../lib/fulfillmentExcelConstructor'
import {
  deleteExcelExportPreset,
  fetchExcelExportPresets,
  fetchExcelPresetActivity,
  saveExcelExportPreset,
} from '../../services/excelPresetService'
import type { ExcelExportPreset } from '../../lib/fulfillmentExcelConstructor'
import { supabase } from '../../lib/supabase'

interface Props {
  accountId: string
  supply: FulfillmentSupplyWithBoxes
  batchNumber: number | null
}

export function FulfillmentExcelConstructorPanel({ accountId, supply, batchNumber }: Props) {
  const [presets, setPresets] = useState<ExcelExportPreset[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('Мой экспорт')
  const [columns, setColumns] = useState<ExcelConstructorColumnKey[]>(['box_number', 'barcode', 'qty'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [logRows, setLogRows] = useState<Array<Record<string, unknown>>>([])

  const selected = useMemo(
    () => presets.find((preset) => preset.id === selectedId) ?? null,
    [presets, selectedId],
  )

  const reload = async () => {
    const next = await fetchExcelExportPresets(accountId)
    setPresets(next)
    if (!selectedId && next[0]) setSelectedId(next[0].id)
  }

  useEffect(() => {
    void reload().catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить наборы'))
  }, [accountId])

  useEffect(() => {
    if (!selected) return
    setName(selected.name)
    setColumns(selected.columns.length ? selected.columns : ['box_number', 'barcode', 'qty'])
  }, [selected])

  const moveColumn = (index: number, direction: -1 | 1) => {
    const next = [...columns]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setColumns(next)
  }

  const toggleColumn = (key: ExcelConstructorColumnKey) => {
    setColumns((current) => (
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    ))
  }

  const loadProducts = async () => {
    if (!supabase) return new Map<string, ExcelConstructorProductLookup>()
    const barcodes = new Set(supply.boxes.flatMap((box) => box.items.map((item) => item.barcode)))
    if (barcodes.size === 0) return new Map()
    const { data } = await supabase
      .from('products')
      .select('vendor_code,nm_id,name,barcodes')
      .eq('account_id', accountId)
    const map = new Map<string, ExcelConstructorProductLookup>()
    for (const product of data ?? []) {
      const codes = Array.isArray(product.barcodes) ? product.barcodes : []
      for (const code of codes) {
        const trimmed = String(code).trim()
        if (!barcodes.has(trimmed)) continue
        map.set(trimmed, {
          vendor_code: product.vendor_code,
          nm_id: product.nm_id,
          name: product.name,
        })
      }
    }
    return map
  }

  const exportFile = async () => {
    if (columns.length === 0) {
      setError('Выберите хотя бы одну колонку')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const products = await loadProducts()
      const suffix = batchNumber != null ? `P${batchNumber}_S${supply.supply_number}` : `S${supply.supply_number}`
      downloadConstructorExcel(supply, columns, products, `constructor_${suffix}.xlsx`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось выгрузить Excel')
    } finally {
      setBusy(false)
    }
  }

  const savePreset = async () => {
    setBusy(true)
    setError(null)
    try {
      const saved = await saveExcelExportPreset(accountId, { id: selectedId ?? undefined, name, columns })
      setSelectedId(saved.id)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить набор')
    } finally {
      setBusy(false)
    }
  }

  const removePreset = async () => {
    if (!selectedId || !selected) return
    setBusy(true)
    try {
      await deleteExcelExportPreset(accountId, selectedId, selected.name)
      setSelectedId(null)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось удалить набор')
    } finally {
      setBusy(false)
    }
  }

  const openLog = async () => {
    setShowLog(true)
    const rows = await fetchExcelPresetActivity(accountId)
    setLogRows(rows)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedId ?? ''}
          onChange={(event) => setSelectedId(event.target.value || null)}
          className="min-w-[180px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Новый набор</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>
        <button type="button" onClick={() => void openLog()} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">Журнал</button>
      </div>
      <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Имя набора" />
      <div className="grid gap-2 sm:grid-cols-2">
        {EXCEL_CONSTRUCTOR_COLUMNS.map((column) => (
          <label key={column.key} className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm">
            <input type="checkbox" checked={columns.includes(column.key)} onChange={() => toggleColumn(column.key)} />
            {column.label}
          </label>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Порядок колонок</p>
        {columns.map((key, index) => {
          const label = EXCEL_CONSTRUCTOR_COLUMNS.find((column) => column.key === key)?.label ?? key
          return (
            <div key={`${key}-${index}`} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <span className="flex-1">{label}</span>
              <button type="button" disabled={index === 0} onClick={() => moveColumn(index, -1)} className="rounded-lg px-2 py-1 text-xs text-slate-500 disabled:opacity-30">↑</button>
              <button type="button" disabled={index === columns.length - 1} onClick={() => moveColumn(index, 1)} className="rounded-lg px-2 py-1 text-xs text-slate-500 disabled:opacity-30">↓</button>
            </div>
          )
        })}
      </div>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void savePreset()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Сохранить набор</button>
        <button type="button" disabled={busy || !selectedId} onClick={() => void removePreset()} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-40">Удалить</button>
        <button type="button" disabled={busy} onClick={() => void exportFile()} className="rounded-xl border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-40">Выгрузить Excel</button>
      </div>
      {showLog && (
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-2xl border border-slate-100 p-3">
          {logRows.length === 0 ? <p className="text-sm text-slate-400">Записей нет</p> : logRows.map((row) => (
            <p key={String(row.id)} className="text-xs text-slate-600">{String(row.message)}</p>
          ))}
        </div>
      )}
    </div>
  )
}
