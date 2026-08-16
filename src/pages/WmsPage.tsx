import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'
import { buildWmsLocationQrPdf, type WmsLocationQrLabel } from '../lib/wmsLocationQrPdf'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WmsWarehouse {
  id: string
  account_id: string
  name: string
  description: string
  fbs_enabled: boolean
  wb_warehouse_id: string
  created_at: string
  short_id: number
}

interface WmsZone {
  id: string
  warehouse_id: string
  account_id: string
  name: string
  cols: number
  rows: number
  upright_mode: 'interval' | 'custom'
  upright_every: number
  upright_after_cols: number[]
  sides: WmsZoneSide[]
  short_id: number
}

interface WmsZoneSide {
  id?: string
  zone_id?: string
  account_id?: string
  code: string
  name: string
  slot_count: number
  slot_columns: number
  slot_rows: number
  position: number
}

interface WmsBoxContent {
  id: string
  box_item_id: string
  barcode: string
  product_name: string
  qty_per_box: number
}

interface WmsCellItem {
  id: string
  cell_id: string
  barcode: string
  product_name: string
  qty: number
  reserved_qty: number
  item_type: 'item' | 'box'
  box_name: string
  side_id: string | null
  slot_number: number | null
  fulfillment_box_id: string | null
  contents: WmsBoxContent[]
  fulfillment_box?: {
    id: string
    box_number: number
    barcode: string
    items: Array<{
      id: string
      barcode: string
      product_name: string | null
      qty: number
    }>
  } | null
}

interface FulfillmentStorageBox {
  id: string
  supply_id: string
  account_id: string
  box_number: number
  barcode: string
  status: 'open' | 'closed'
  supply_number: number
  warehouse_name: string
  batch_name: string
  batch_short_id: number | null
}

interface WmsCell {
  id: string
  zone_id: string
  account_id: string
  col: string
  row: number
  status: 'free' | 'occupied' | 'disabled'
  items: WmsCellItem[]
}

interface VirtualCell {
  col: string
  row: number
  status: 'free' | 'occupied' | 'disabled'
  dbCell?: WmsCell
}

type ZoneSettings = {
  name: string
  cols: number
  rows: number
  uprightMode: 'interval' | 'custom'
  uprightEvery: number
  uprightAfterCols: number[]
  sides: WmsZoneSide[]
}

type WmsScanLocation = {
  kind: 'pallet' | 'slot'
  code: string
  warehouseId: string
  warehouseShortId: number
  warehouseName: string
  rackId: string
  rackShortId: number
  rackName: string
  sideId: string
  sideNumber: number
  sideName: string
  pallet: string
  col: string
  row: number
  slotNumber: number | null
  slotCount: number
  slotColumns: number
  slotRows: number
  filled: number
  full: boolean
  status: 'free' | 'occupied' | 'disabled'
  slots: Array<{
    number: number
    occupied: boolean
    boxId: string | null
    boxNumber: number | null
    boxBarcode: string | null
  }>
}

type WmsScanBox = {
  kind: 'box'
  code: string
  boxId: string
  boxNumber: number
  barcode: string
  placed: boolean
  itemId: string | null
  addressCode: string | null
  addressText: string | null
}

type WmsSearchResult = {
  item_id: string | null
  box_id: string
  box_number: number
  box_barcode: string
  supply_number: number
  destination_warehouse: string
  batch_number: number | null
  batch_name: string
  store_id: string | null
  store_name: string | null
  store_code: string | null
  store_supplier: string | null
  warehouse_id: string | null
  warehouse_name: string | null
  rack_id: string | null
  rack_name: string | null
  side_id: string | null
  side_name: string | null
  col: string | null
  row: number | null
  slot_number: number | null
  address_code: string | null
  address_text: string | null
  is_addressed: boolean
  units: number
  product_barcodes: string[]
  product_names: string[]
  vendor_articles: string[]
  wb_articles: string[]
  brands: string[]
  colors: string[]
  sizes: string[]
  store_total_boxes: number
  store_addressed_boxes: number
  store_unaddressed_boxes: number
  total_matches: number
  match_reason: string
}

type UnaddressedBox = {
  id: string
  box_number: number
  barcode: string
  supply_id: string
  supply_number: number
  batch_number: number | null
  batch_name: string
  warehouse_name: string
  units: number
}

type WmsMovement = {
  id: string
  action: 'placed' | 'moved' | 'unassigned' | 'released' | 'swapped'
  source: string
  from_address_text: string | null
  to_address_text: string | null
  created_at: string
  fulfillment_box?: { box_number: number; barcode: string } | null
}

type InventoryScanResult = {
  result: 'found' | 'wrong_address' | 'unexpected'
  boxNumber: number
  expectedAddress: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function colIndexToLetter(index: number): string {
  return String.fromCharCode(65 + index) // A=0, B=1, …
}

function generateGrid(zone: WmsZone, cells: WmsCell[]): VirtualCell[][] {
  const cellMap = new Map(cells.map((c) => [`${c.col}-${c.row}`, c]))
  const grid: VirtualCell[][] = []
  for (let r = 1; r <= zone.rows; r++) {
    const row: VirtualCell[] = []
    for (let ci = 0; ci < zone.cols; ci++) {
      const col = colIndexToLetter(ci)
      const dbCell = cellMap.get(`${col}-${r}`)
      row.push({ col, row: r, status: dbCell ? dbCell.status : 'free', dbCell })
    }
    grid.push(row)
  }
  return grid
}

function signalScan(ok: boolean) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = ok ? 880 : 220
    gain.gain.value = 0.05
    oscillator.connect(gain); gain.connect(context.destination)
    oscillator.start(); oscillator.stop(context.currentTime + (ok ? 0.09 : 0.18))
    navigator.vibrate?.(ok ? 40 : [80, 50, 80])
  } catch {
    // Browsers can block audio before the first user interaction; visual feedback remains available.
  }
}

function defaultZoneSides(): WmsZoneSide[] {
  return [
    { code: 'F1', name: 'Сторона 1', slot_count: 8, slot_columns: 2, slot_rows: 4, position: 0 },
    { code: 'F2', name: 'Сторона 2', slot_count: 8, slot_columns: 2, slot_rows: 4, position: 1 },
  ]
}

function normalizedZoneSides(zone: WmsZone): WmsZoneSide[] {
  const sides = Array.isArray(zone.sides) ? zone.sides : []
  return sides.length > 0
    ? [...sides].sort((a, b) => a.position - b.position).slice(0, 2).map((side) => ({
      ...side,
      slot_columns: side.slot_columns ?? (side.slot_count % 2 === 0 ? 2 : 1),
      slot_rows: side.slot_rows ?? (side.slot_count % 2 === 0 ? side.slot_count / 2 : side.slot_count),
    }))
    : defaultZoneSides()
}

function intervalUprights(cols: number, every: number): number[] {
  const result: number[] = []
  if (cols < 1 || every < 1) return result
  for (let column = every; column < cols; column += every) result.push(column)
  return result
}

function wmsPalletCode(accountShortId: number, warehouseShortId: number, rackShortId: number, sideNumber: number, pallet: string) {
  return `C${accountShortId}_W${warehouseShortId}_R${rackShortId}_F${sideNumber}_${pallet.toUpperCase()}`
}

function wmsSlotCode(accountShortId: number, warehouseShortId: number, rackShortId: number, sideNumber: number, pallet: string, slotNumber: number) {
  return `${wmsPalletCode(accountShortId, warehouseShortId, rackShortId, sideNumber, pallet)}_K${slotNumber}`
}

function openWmsQrPdf(labels: WmsLocationQrLabel[]) {
  const blob = buildWmsLocationQrPdf(labels)
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ─── WarehouseModal ───────────────────────────────────────────────────────────

function WarehouseModal({ editing, onClose, onSave }: {
  editing: WmsWarehouse | null
  onClose: () => void
  onSave: (name: string, description: string, fbsEnabled: boolean, wbWarehouseId: string) => Promise<void>
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [desc, setDesc] = useState(editing?.description ?? '')
  const [fbsEnabled, setFbsEnabled] = useState(editing?.fbs_enabled ?? false)
  const [wbWhId, setWbWhId] = useState(editing?.wb_warehouse_id ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    await onSave(name.trim(), desc.trim(), fbsEnabled, wbWhId.trim())
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">
            {editing ? 'Редактировать склад' : 'Новый склад'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600">Название *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave() }}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600">Описание</label>
            <input
              type="text" value={desc} onChange={(e) => setDesc(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          {/* FBS настройки */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 flex flex-col gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox" checked={fbsEnabled} onChange={(e) => setFbsEnabled(e.target.checked)}
                className="h-4 w-4 rounded accent-violet-500"
              />
              <span className="text-xs font-medium text-slate-700">Включить для FBS</span>
            </label>
            {fbsEnabled && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">WB Warehouse ID <span className="text-slate-400">(из кабинета WB → Настройки → Склады)</span></label>
                <input
                  type="text" value={wbWhId} onChange={(e) => setWbWhId(e.target.value)}
                  placeholder="например: 507"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Отмена
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={!name.trim() || saving}
            className="rounded-xl bg-violet-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-600 disabled:opacity-50">
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ZoneModal ────────────────────────────────────────────────────────────────

function ZoneModal({ editing, onClose, onSave }: {
  editing: WmsZone | null
  onClose: () => void
  onSave: (settings: ZoneSettings) => Promise<void>
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [cols, setCols] = useState(String(editing?.cols ?? 6))
  const [rows, setRows] = useState(String(editing?.rows ?? 3))
  const [uprightMode, setUprightMode] = useState<'interval' | 'custom'>(editing?.upright_mode ?? 'interval')
  const [uprightEvery, setUprightEvery] = useState(String(editing?.upright_every ?? 3))
  const [customUprights, setCustomUprights] = useState<number[]>(editing?.upright_after_cols ?? [])
  const [sides, setSides] = useState<WmsZoneSide[]>(editing ? normalizedZoneSides(editing) : defaultZoneSides())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const colNum = parseInt(cols) || 0
  const rowNum = parseInt(rows) || 0
  const uprightEveryNum = parseInt(uprightEvery) || 0
  const normalizedSides = sides.map((side, position) => ({
    ...side,
    name: side.name.trim(),
    slot_columns: Number(side.slot_columns),
    slot_rows: Number(side.slot_rows),
    slot_count: Number(side.slot_columns) * Number(side.slot_rows),
    position,
  }))
  const valid = Boolean(
    name.trim() && colNum >= 1 && colNum <= 26 && rowNum >= 1 && rowNum <= 50
    && uprightEveryNum >= 1 && uprightEveryNum <= 26
    && normalizedSides.length > 0 && normalizedSides.length <= 2
    && normalizedSides.every((side) => side.name && side.slot_columns >= 1 && side.slot_rows >= 1 && side.slot_count <= 100),
  )

  const activeUprights = uprightMode === 'interval'
    ? intervalUprights(colNum, uprightEveryNum)
    : customUprights.filter((value) => value > 0 && value < colNum).sort((a, b) => a - b)

  const handleSave = async () => {
    if (!valid) return
    setSaving(true)
    setError('')
    try {
      await onSave({
        name: name.trim(), cols: colNum, rows: rowNum,
        uprightMode, uprightEvery: uprightEveryNum,
        uprightAfterCols: activeUprights,
        sides: normalizedSides,
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      setSaving(false)
    }
  }

  const addSide = () => {
    if (sides.length >= 2) return
    const usedCodes = new Set(sides.map((side) => side.code))
    let index = 1
    while (usedCodes.has(`F${index}`)) index += 1
    setSides((previous) => [...previous, {
      code: `F${index}`,
      name: `Сторона ${index}`,
      slot_count: 8,
      slot_columns: 2,
      slot_rows: 4,
      position: previous.length,
    }])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">
            {editing ? 'Настроить стеллаж' : 'Новый стеллаж'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-5 overflow-y-auto p-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600">Название стеллажа *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus
              placeholder="Лицевая сторона, Стеллаж 1..."
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">Паллетомест по ширине (A–Z) *</label>
              <input
                type="number" value={cols} onChange={(e) => setCols(e.target.value)} min={1} max={26}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
              <span className="text-[11px] text-slate-400">Макс. 26</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-600">Ярусов (1–N) *</label>
              <input
                type="number" value={rows} onChange={(e) => setRows(e.target.value)} min={1} max={50}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
              <span className="text-[11px] text-slate-400">Макс. 50</span>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-700">Стороны и места коробов</div>
                <div className="mt-0.5 text-[11px] text-slate-400">До двух сторон. Стандартная структура паллеты — 2 места по ширине × 4 по высоте</div>
              </div>
              <button type="button" onClick={addSide} disabled={sides.length >= 2}
                className="cursor-pointer rounded-lg border border-violet-200 px-2.5 py-1.5 text-xs font-medium text-violet-600 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40">
                + Сторона
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {sides.map((side, index) => (
                <div key={side.id ?? side.code} className="grid grid-cols-[52px_1fr_84px_84px_28px] items-end gap-2 rounded-xl bg-slate-50 p-2.5">
                  <div>
                    <div className="mb-1 text-[10px] text-slate-400">Код</div>
                    <div className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-xs font-bold text-slate-600">{side.code}</div>
                  </div>
                  <label className="flex flex-col gap-1 text-[10px] text-slate-400">
                    Название
                    <input value={side.name} onChange={(event) => setSides((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-violet-400" />
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] text-slate-400">
                    По ширине
                    <input type="number" min={1} max={100} value={side.slot_columns}
                      onChange={(event) => setSides((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, slot_columns: parseInt(event.target.value) || 0 } : item))}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-violet-400" />
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] text-slate-400">
                    По высоте
                    <input type="number" min={1} max={100} value={side.slot_rows}
                      onChange={(event) => setSides((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, slot_rows: parseInt(event.target.value) || 0 } : item))}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-violet-400" />
                  </label>
                  <button type="button" title="Удалить сторону" disabled={sides.length === 1}
                    onClick={() => setSides((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}
                    className="mb-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-slate-400">Места нумеруются слева направо, затем сверху вниз: K1, K2 / K3, K4… Максимум 100 мест на сторону.</div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3">
              <div className="text-xs font-semibold text-slate-700">Вертикальные стойки стеллажа</div>
              <div className="mt-0.5 text-[11px] text-slate-400">Стойка отображается между паллетоместами и не занимает адрес</div>
            </div>
            <div className="mb-3 flex gap-2">
              <button type="button" onClick={() => setUprightMode('interval')}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${uprightMode === 'interval' ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                Через одинаковое расстояние
              </button>
              <button type="button" onClick={() => setUprightMode('custom')}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${uprightMode === 'custom' ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                Вручную
              </button>
            </div>
            {uprightMode === 'interval' ? (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Ставить стойку после каждых
                <input type="number" min={1} max={26} value={uprightEvery} onChange={(event) => setUprightEvery(event.target.value)}
                  className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-center outline-none focus:border-violet-400" />
                паллетомест
              </label>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: Math.max(0, colNum - 1) }, (_, index) => index + 1).map((afterColumn) => {
                  const checked = customUprights.includes(afterColumn)
                  return (
                    <button key={afterColumn} type="button"
                      onClick={() => setCustomUprights((previous) => checked ? previous.filter((value) => value !== afterColumn) : [...previous, afterColumn])}
                      className={`cursor-pointer rounded-lg border px-2 py-1.5 text-[11px] ${checked ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                      После {colIndexToLetter(afterColumn - 1)}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {colNum > 0 && rowNum > 0 && (
            <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              Стеллаж: <strong>{colNum}</strong> паллетомест × <strong>{rowNum}</strong> ярусов. Адреса паллет: <strong>A1</strong>…<strong>{colIndexToLetter(colNum - 1)}{rowNum}</strong>.{' '}
              Стойки после: <strong>{activeUprights.map((value) => colIndexToLetter(value - 1)).join(', ') || 'не заданы'}</strong>.
            </div>
          )}
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Отмена
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={!valid || saving}
            className="rounded-xl bg-violet-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-600 disabled:opacity-50">
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── CellModal ────────────────────────────────────────────────────────────────

function CellModal({ cell, zone, warehouse, accountId, accountShortId, zoneId, initialSideKey, canManage, onClose, onRefresh }: {
  cell: VirtualCell
  zone: WmsZone
  warehouse: WmsWarehouse
  accountId: string
  accountShortId: number | null
  zoneId: string
  initialSideKey?: string
  canManage: boolean
  onClose: () => void
  onRefresh: () => void
}) {
  const [internalItems, setInternalItems] = useState<WmsCellItem[]>(cell.dbCell?.items ?? [])
  const [internalCellId, setInternalCellId] = useState<string | null>(cell.dbCell?.id ?? null)
  const [internalStatus, setInternalStatus] = useState<'free' | 'occupied' | 'disabled'>(cell.status)
  const [expandedBoxIds, setExpandedBoxIds] = useState<Set<string>>(new Set())
  const zoneSides = normalizedZoneSides(zone)
  const initialSide = zoneSides.find((side) => (side.id ?? side.code) === initialSideKey) ?? zoneSides[0]
  const [assigningBoxId, setAssigningBoxId] = useState<string | null>(null)
  const [assignmentSideId, setAssignmentSideId] = useState(initialSide?.id ?? '')
  const [assignmentSlotNumber, setAssignmentSlotNumber] = useState('1')
  const [movingBoxId, setMovingBoxId] = useState<string | null>(null)
  const [placementTarget, setPlacementTarget] = useState<{ sideId: string; slotNumber: number } | null>(null)
  const [storageBoxes, setStorageBoxes] = useState<FulfillmentStorageBox[]>([])
  const [storageLoading, setStorageLoading] = useState(false)
  const [storageSearch, setStorageSearch] = useState('')
  const [selectedSupplyId, setSelectedSupplyId] = useState('')
  const [selectedStorageBoxIds, setSelectedStorageBoxIds] = useState<Set<string>>(new Set())
  const [boxNumberExpression, setBoxNumberExpression] = useState('')
  const [placementError, setPlacementError] = useState('')

  const [saving, setSaving] = useState(false)
  const visibleZoneSides = initialSide ? [initialSide] : zoneSides.slice(0, 1)
  const visibleSideIds = new Set(visibleZoneSides.map((side) => side.id).filter(Boolean))

  const loadStorageBoxes = useCallback(async () => {
    if (!supabase || !accountId) return
    setStorageLoading(true)
    setPlacementError('')
    try {
      const { data, error } = await (supabase as any).rpc('get_unaddressed_fulfillment_boxes', {
        p_account_id: accountId,
      })
      if (error) throw error
      setStorageBoxes(((data ?? []) as UnaddressedBox[]).map((row) => ({
        id: row.id,
        supply_id: row.supply_id,
        account_id: accountId,
        box_number: row.box_number,
        barcode: row.barcode,
        status: 'open',
        supply_number: row.supply_number,
        warehouse_name: row.warehouse_name,
        batch_name: row.batch_name,
        batch_short_id: row.batch_number,
      })))
    } catch (error: any) {
      setPlacementError(error?.message || 'Не удалось загрузить короба фулфилмента')
    } finally {
      setStorageLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    if (placementTarget) void loadStorageBoxes()
  }, [placementTarget, loadStorageBoxes])

  const ensureCell = async (): Promise<string | null> => {
    if (internalCellId) return internalCellId
    if (!supabase) return null
    const { data } = await (supabase as any)
      .from('wms_cells')
      .insert({ zone_id: zoneId, account_id: accountId, col: cell.col, row: cell.row, status: 'occupied' })
      .select().single()
    if (data) { setInternalCellId((data as WmsCell).id); setInternalStatus('occupied') }
    return (data as WmsCell)?.id ?? null
  }

  const handleToggleDisabled = async () => {
    if (!supabase || saving) return
    const disable = internalStatus !== 'disabled'
    if (disable && internalItems.length > 0) {
      alert('Нельзя заглушить паллетоместо, пока в нём находятся короба')
      return
    }
    setSaving(true)
    const { error } = await (supabase as any).rpc('set_wms_cell_disabled', {
      p_zone_id: zoneId,
      p_col: cell.col,
      p_row: cell.row,
      p_disabled: disable,
    })
    if (error) alert(error.message || 'Не удалось изменить заглушку паллетоместа')
    else {
      setInternalStatus(disable ? 'disabled' : 'free')
      if (!disable) setInternalCellId(null)
      onRefresh()
    }
    setSaving(false)
  }

  const handleMoveOrSwapBox = async (boxId: string, targetSideId: string, slotNumber: number) => {
    if (!supabase || !internalCellId || !targetSideId || slotNumber < 1) return
    const source = internalItems.find((item) => item.id === boxId)
    if (!source || source.item_type !== 'box') return
    const target = internalItems.find((item) => (
      item.item_type === 'box'
      && item.side_id === targetSideId
      && item.slot_number === slotNumber
      && item.id !== boxId
    ))
    setSaving(true)
    const { error: assignError } = await (supabase as any).rpc('move_or_swap_wms_box', {
      p_box_id: boxId,
      p_target_cell_id: internalCellId,
      p_target_side_id: targetSideId,
      p_target_slot_number: slotNumber,
    })
    if (assignError) {
      alert(assignError.message || 'Не удалось переместить короб')
      setSaving(false)
      return
    }
    setInternalItems((previous) => previous.map((item) => {
      if (item.id === boxId) return { ...item, cell_id: internalCellId, side_id: targetSideId, slot_number: slotNumber }
      if (target && item.id === target.id) {
        return { ...item, cell_id: source.cell_id, side_id: source.side_id, slot_number: source.slot_number }
      }
      return item
    }))
    setAssigningBoxId(null)
    setMovingBoxId(null)
    setSaving(false)
    onRefresh()
  }

  const handleAssignBox = async (boxId: string) => {
    await handleMoveOrSwapBox(boxId, assignmentSideId, parseInt(assignmentSlotNumber) || 0)
  }

  const handleUnassignBox = async (box: WmsCellItem) => {
    if (!supabase || !box.fulfillment_box_id || saving) return
    const boxLabel = box.fulfillment_box?.box_number
      ? `Короб №${box.fulfillment_box.box_number}`
      : box.box_name || 'Этот короб'
    if (!window.confirm(`${boxLabel}: убрать адрес хранения?\n\nСам короб, его содержимое и связь с партией/поставкой останутся без изменений.`)) return

    setSaving(true)
    const { error } = await (supabase as any).rpc('unassign_wms_fulfillment_box', {
      p_item_id: box.id,
    })
    if (error) {
      alert(error.message || 'Не удалось убрать адрес короба')
      setSaving(false)
      return
    }

    const remainingItems = internalItems.filter((item) => item.id !== box.id)
    setInternalItems(remainingItems)
    setExpandedBoxIds((previous) => {
      const next = new Set(previous)
      next.delete(box.id)
      return next
    })
    setAssigningBoxId(null)
    setMovingBoxId(null)
    if (remainingItems.length === 0) {
      setInternalCellId(null)
      setInternalStatus('free')
    }
    setSaving(false)
    onRefresh()
  }

  const placeFulfillmentBoxes = async (boxIds: string[]) => {
    if (!supabase || !placementTarget || boxIds.length === 0) return
    setSaving(true)
    setPlacementError('')
    const { error } = await (supabase as any).rpc('place_fulfillment_boxes_in_wms', {
      p_box_ids: boxIds,
      p_zone_id: zoneId,
      p_col: cell.col,
      p_row: cell.row,
      p_target_side_id: placementTarget.sideId,
      p_target_slot_number: placementTarget.slotNumber,
    })
    if (error) {
      setPlacementError(error.message || 'Не удалось разместить короба')
      setSaving(false)
      return
    }
    setPlacementTarget(null)
    setSelectedStorageBoxIds(new Set())
    setSelectedSupplyId('')
    setStorageSearch('')
    setBoxNumberExpression('')
    setSaving(false)
    onRefresh()
    onClose()
  }

  const applyBoxNumberExpression = () => {
    const supplyBoxes = storageBoxes.filter((box) => box.supply_id === selectedSupplyId)
    const requested = new Set<number>()
    for (const rawPart of boxNumberExpression.split(',')) {
      const part = rawPart.trim()
      if (!part) continue
      const range = part.match(/^(\d+)\s*-\s*(\d+)$/)
      if (range) {
        const start = Number(range[1]); const end = Number(range[2])
        for (let number = Math.min(start, end); number <= Math.max(start, end); number += 1) requested.add(number)
      } else if (/^\d+$/.test(part)) requested.add(Number(part))
    }
    const matched = supplyBoxes
      .filter((box) => requested.has(box.box_number))
      .sort((a, b) => a.box_number - b.box_number)
    const matchedNumbers = new Set(matched.map((box) => box.box_number))
    const missingNumbers = Array.from(requested).filter((number) => !matchedNumbers.has(number)).sort((a, b) => a - b)
    if (requested.size === 0) {
      setPlacementError('Укажите номера коробов: например 1, 3, 5-8')
      return
    }
    if (missingNumbers.length > 0) {
      setPlacementError(`В этой поставке нет доступных коробов №${missingNumbers.join(', ')}`)
      return
    }
    if (matched.length === 0) {
      setPlacementError('В этой поставке короба с такими номерами не найдены')
      return
    }
    setPlacementError('')
    setSelectedStorageBoxIds(new Set(matched.map((box) => box.id)))
  }

  const derivedStatus = internalStatus === 'disabled' ? 'disabled' : internalItems.length > 0 ? 'occupied' : 'free'

  const sideScopedItems = internalItems.filter((item) => (
    item.side_id ? visibleSideIds.has(item.side_id) : initialSide?.position === 0
  ))
  const singleItems = sideScopedItems.filter((x) => x.item_type !== 'box')
  const boxes       = sideScopedItems.filter((x) => x.item_type === 'box')
  const occupiedBoxSlots = new Map(
    boxes
      .filter((box) => box.side_id && box.slot_number)
      .map((box) => [`${box.side_id}-${box.slot_number}`, box]),
  )
  const selectedAssignmentSide = visibleZoneSides.find((side) => side.id === assignmentSideId)

  const firstFreeSlot = (sideId: string): number | null => {
    const side = visibleZoneSides.find((item) => item.id === sideId)
    if (!side) return null
    for (let slot = 1; slot <= side.slot_count; slot += 1) {
      if (!occupiedBoxSlots.has(`${sideId}-${slot}`)) return slot
    }
    return null
  }

  const handleBoxSlotClick = (sideId: string, slotNumber: number, box?: WmsCellItem) => {
    if (saving) return
    if (!movingBoxId) {
      if (box) {
        setMovingBoxId(box.id)
        setExpandedBoxIds((previous) => new Set([...previous, box.id]))
      } else {
        setPlacementTarget({ sideId, slotNumber })
        setSelectedStorageBoxIds(new Set())
        setPlacementError('')
      }
      return
    }
    if (box?.id === movingBoxId) {
      setMovingBoxId(null)
      return
    }
    void handleMoveOrSwapBox(movingBoxId, sideId, slotNumber)
  }

  const supplyOptions = Array.from(
    new Map(storageBoxes.map((box) => [box.supply_id, box])).values(),
  ).sort((a, b) => (b.batch_short_id ?? 0) - (a.batch_short_id ?? 0) || b.supply_number - a.supply_number)
  const selectedSupplyBoxes = storageBoxes
    .filter((box) => box.supply_id === selectedSupplyId)
    .sort((a, b) => a.box_number - b.box_number)
  const normalizedStorageSearch = storageSearch.trim().toLowerCase()
  const searchedStorageBoxes = storageBoxes
    .filter((box) => !normalizedStorageSearch
      || box.barcode.toLowerCase().includes(normalizedStorageSearch)
      || box.batch_name.toLowerCase().includes(normalizedStorageSearch))
    .slice(0, 20)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              Паллетоместо <span className="font-black">{cell.col}{cell.row}</span>
            </h2>
            <p className="text-xs text-slate-400">
              {zone.name}{initialSide ? ` · ${initialSide.name}` : ''}
            </p>
          </div>
          <button type="button" onClick={() => { onClose(); onRefresh() }} className="text-slate-400 hover:text-slate-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          {/* Status is derived from actual contents. Only the disabled state is manual. */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
            <div>
              <div className="text-[10px] text-slate-400">Статус паллетоместа</div>
              <div className={`text-xs font-semibold ${derivedStatus === 'occupied' ? 'text-red-600' : derivedStatus === 'disabled' ? 'text-slate-500' : 'text-emerald-600'}`}>
                {derivedStatus === 'occupied' ? 'Занята' : derivedStatus === 'disabled' ? 'Заглушена' : 'Свободна'}
              </div>
            </div>
            {canManage && <button type="button" onClick={() => void handleToggleDisabled()} disabled={saving || (derivedStatus === 'occupied' && internalStatus !== 'disabled')}
              className={`cursor-pointer rounded-xl border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${internalStatus === 'disabled' ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}>
              {internalStatus === 'disabled' ? 'Снять заглушку' : 'Заглушить'}
            </button>}
          </div>

          {/* Physical box places by side */}
          {internalStatus !== 'disabled' && zoneSides.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">Места коробов</span>
                <span className={`text-[10px] ${movingBoxId ? 'font-medium text-violet-600' : 'text-slate-400'}`}>
                  {movingBoxId ? 'Выберите место: свободное — перенос, занятое — обмен' : 'Свободное — разместить существующий короб ФФ, занятое — выбрать для переноса'}
                </span>
              </div>
              {movingBoxId && (
                <div className="mb-2 flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-700">
                  <span>Короб выбран. Его ШК, QR и содержимое при перемещении сохранятся.</span>
                  <button type="button" onClick={() => setMovingBoxId(null)} className="cursor-pointer font-semibold hover:text-violet-900">Отмена</button>
                </div>
              )}
              <div className="flex flex-col gap-2.5">
                {visibleZoneSides.map((side) => {
                  const filled = boxes.filter((box) => box.side_id === side.id && box.slot_number).length
                  const sideNumber = side.position + 1
                  const pallet = `${cell.col}${cell.row}`
                  const palletCode = accountShortId == null ? '' : wmsPalletCode(accountShortId, warehouse.short_id, zone.short_id, sideNumber, pallet)
                  const locationLabels = palletCode ? [
                    {
                      code: palletCode,
                      title: `ПАЛЛЕТОМЕСТО ${pallet}`,
                      warehouseName: warehouse.name,
                      rackName: zone.name,
                      sideName: side.name,
                      address: pallet,
                    },
                    ...Array.from({ length: side.slot_count }, (_, index) => index + 1).map((slotNumber) => ({
                      code: wmsSlotCode(accountShortId!, warehouse.short_id, zone.short_id, sideNumber, pallet, slotNumber),
                      title: `КОРОБОМЕСТО K${slotNumber}`,
                      warehouseName: warehouse.name,
                      rackName: zone.name,
                      sideName: side.name,
                      address: `${pallet}-K${slotNumber}`,
                    })),
                  ] : []
                  return (
                    <div key={side.id ?? side.code} className="rounded-xl border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">{side.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400">{filled} из {side.slot_count}</span>
                          <button type="button" disabled={!locationLabels.length} onClick={() => openWmsQrPdf(locationLabels)}
                            title={`Печать QR паллетоместа и K1–K${side.slot_count}`}
                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-40">
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg>
                          </button>
                        </div>
                      </div>
                      <div className="mx-auto grid w-full max-w-xs gap-1.5 rounded-xl border-4 border-amber-200/70 bg-amber-50/40 p-2"
                        style={{ gridTemplateColumns: `repeat(${side.slot_columns}, minmax(0, 1fr))` }}>
                        {Array.from({ length: side.slot_count }, (_, index) => index + 1).map((slotNumber) => {
                          const box = side.id ? occupiedBoxSlots.get(`${side.id}-${slotNumber}`) : undefined
                          const isMoving = box?.id === movingBoxId
                          const isTarget = placementTarget?.sideId === side.id && placementTarget?.slotNumber === slotNumber
                          return (
                            <button key={slotNumber} type="button"
                              title={box ? `${side.name} · ${cell.col}${cell.row}-K${slotNumber} · ${box.box_name}` : `${side.name} · ${cell.col}${cell.row}-K${slotNumber}`}
                              onClick={() => canManage && side.id && handleBoxSlotClick(side.id, slotNumber, box)}
                              className={`flex h-11 cursor-pointer flex-col items-center justify-center rounded-md border text-[10px] font-semibold transition ${isMoving ? 'border-violet-500 bg-violet-100 text-violet-700 ring-2 ring-violet-200' : isTarget ? 'border-violet-500 bg-violet-100 text-violet-700 ring-2 ring-violet-300 ring-offset-1' : box ? 'border-amber-400 bg-amber-100 text-amber-800 hover:bg-amber-200' : movingBoxId ? 'border-violet-200 bg-white text-violet-500 hover:border-violet-400 hover:bg-violet-50' : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                              <span>K{slotNumber}</span>
                              {box && <span className="max-w-full truncate px-1 text-[8px] font-normal opacity-75">{box.box_name}</span>}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

            {/* Contents — скрыто для заглушенных паллетомест */}
          {internalStatus !== 'disabled' && <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">
                Содержимое ({sideScopedItems.length})
              </span>
            </div>

            {sideScopedItems.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">Паллетоместо пусто</div>
            )}

            {/* Legacy direct items are history only. New products cannot receive an address without a box. */}
            {singleItems.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50">
                <div className="border-b border-slate-200 px-3 py-2 text-[10px] text-slate-500">
                  Ранее добавленные товары без короба — только просмотр. Новые товары напрямую не размещаются.
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-500">Баркод</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-500">Наименование</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">Кол-во</th>
                    </tr>
                  </thead>
                  <tbody>
                    {singleItems.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-slate-600">{item.barcode || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{item.product_name || '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">{item.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Boxes */}
            {boxes.map((box) => {
              const fulfillmentContents = box.fulfillment_box?.items ?? []
              const displayContents = box.fulfillment_box_id
                ? fulfillmentContents.map((item) => ({
                    id: item.id,
                    barcode: item.barcode,
                    product_name: item.product_name ?? '',
                    qty_per_box: item.qty,
                  }))
                : box.contents
              const isExpanded = expandedBoxIds.has(box.id)
              const totalUnits = displayContents.reduce((s, c) => s + c.qty_per_box * box.qty, 0)
              const boxSide = zoneSides.find((side) => side.id === box.side_id)
              const address = boxSide && box.slot_number
                ? `${boxSide.name} · ${cell.col}${cell.row}-K${box.slot_number}`
                : 'Место не назначено'
              const isAssigning = assigningBoxId === box.id
              return (
                <div key={box.id} className="mb-2 overflow-hidden rounded-xl border border-amber-100 bg-amber-50/30">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                      <line x1="12" y1="22.08" x2="12" y2="12"/>
                    </svg>
                    <span className="flex-1 text-xs font-semibold text-slate-800">{box.fulfillment_box ? `Короб №${box.fulfillment_box.box_number}` : box.box_name}</span>
                    {(box.fulfillment_box?.barcode || box.barcode) && <span className="font-mono text-[10px] text-slate-400">{box.fulfillment_box?.barcode || box.barcode}</span>}
                    {canManage && <button type="button" title="Изменить место короба"
                      onClick={() => {
                        setAssigningBoxId(isAssigning ? null : box.id)
                        setAssignmentSideId(box.side_id ?? initialSide?.id ?? '')
                        setAssignmentSlotNumber(String(box.slot_number ?? firstFreeSlot(initialSide?.id ?? '') ?? 1))
                      }}
                      className={`cursor-pointer rounded-md px-1.5 py-1 text-[10px] ${box.side_id ? 'text-violet-600 hover:bg-violet-50' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                      {address}
                    </button>}
                    {!canManage && <span className="rounded-md px-1.5 py-1 text-[10px] text-slate-500">{address}</span>}
                    {box.qty > 1 && <span className="text-xs text-slate-500">×{box.qty} кор.</span>}
                    {totalUnits > 0 && <span className="text-[10px] text-slate-400">({totalUnits} ед.)</span>}
                    {box.fulfillment_box_id && canManage && (
                      <button type="button" disabled={saving} title="Убрать адрес, не удаляя короб"
                        onClick={() => void handleUnassignBox(box)}
                        className="cursor-pointer rounded-md border border-red-100 px-1.5 py-1 text-[10px] font-medium text-red-500 hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                        Убрать адрес
                      </button>
                    )}
                    <button type="button"
                      onClick={() => setExpandedBoxIds((prev) => { const n = new Set(prev); isExpanded ? n.delete(box.id) : n.add(box.id); return n })}
                      className="text-slate-400 hover:text-slate-600">
                      <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                  </div>
                  {isAssigning && (
                    <div className="flex items-end gap-2 border-t border-amber-100 bg-white/70 px-3 py-2">
                      <div className="flex flex-1 flex-col gap-1 text-[10px] text-slate-400">
                        Сторона
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                          {initialSide?.name ?? '—'}
                        </div>
                      </div>
                      <label className="flex w-28 flex-col gap-1 text-[10px] text-slate-400">
                        Место
                        <select value={assignmentSlotNumber} onChange={(event) => setAssignmentSlotNumber(event.target.value)}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-violet-400">
                          {Array.from({ length: selectedAssignmentSide?.slot_count ?? 0 }, (_, index) => index + 1).map((slotNumber) => {
                            const occupied = occupiedBoxSlots.get(`${assignmentSideId}-${slotNumber}`)
                            return <option key={slotNumber} value={slotNumber}>K{slotNumber}{occupied && occupied.id !== box.id ? ` — обмен с ${occupied.box_name}` : ''}</option>
                          })}
                        </select>
                      </label>
                      <button type="button" onClick={() => void handleAssignBox(box.id)} disabled={saving}
                        className="cursor-pointer rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-50">
                        {occupiedBoxSlots.get(`${assignmentSideId}-${assignmentSlotNumber}`)?.id !== box.id && occupiedBoxSlots.has(`${assignmentSideId}-${assignmentSlotNumber}`) ? 'Обменять' : 'Переместить'}
                      </button>
                    </div>
                  )}
                  {isExpanded && (
                    <div className="border-t border-amber-100 px-3 py-2">
                      {(box.fulfillment_box?.barcode || box.barcode) && (
                        <div className="mb-2 flex items-center gap-2 rounded-lg bg-white/80 p-2">
                          <QRCodeSVG value={box.fulfillment_box?.barcode || box.barcode} size={48} bgColor="transparent" />
                          <div>
                            <div className="text-[10px] text-slate-400">QR короба</div>
                            <div className="font-mono text-xs font-semibold text-slate-700">{box.fulfillment_box?.barcode || box.barcode}</div>
                            <div className="mt-0.5 text-[10px] text-slate-400">{address}</div>
                          </div>
                        </div>
                      )}
                      {displayContents.length === 0 ? (
                        <p className="text-xs text-slate-400">Содержимое не указано</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-400">
                              <th className="pb-1 text-left font-normal">Баркод</th>
                              <th className="pb-1 text-left font-normal">Наименование</th>
                              <th className="pb-1 text-right font-normal">На короб</th>
                              <th className="pb-1 text-right font-normal">Итого</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayContents.map((c) => (
                              <tr key={c.id} className="border-t border-amber-100">
                                <td className="py-1 pr-2 font-mono text-slate-600">{c.barcode || '—'}</td>
                                <td className="py-1 pr-2 text-slate-700">{c.product_name || '—'}</td>
                                <td className="py-1 pr-2 text-right text-slate-600">{c.qty_per_box} шт</td>
                                <td className="py-1 pr-1 text-right font-semibold text-slate-800">= {c.qty_per_box * box.qty}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {placementTarget && (
              <div className="mt-2 rounded-2xl border border-violet-200 bg-violet-50/40 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-slate-800">Разместить существующий короб ФФ</div>
                    <div className="text-[10px] text-slate-500">
                      Адрес: {zoneSides.find((side) => side.id === placementTarget.sideId)?.name} · {cell.col}{cell.row}-K{placementTarget.slotNumber}
                    </div>
                  </div>
                  <button type="button" onClick={() => setPlacementTarget(null)} className="cursor-pointer text-xs text-slate-400 hover:text-slate-700">Закрыть</button>
                </div>

                <input
                  type="text"
                  value={storageSearch}
                  onChange={(event) => setStorageSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    const exact = storageBoxes.find((box) => box.barcode.toLowerCase() === storageSearch.trim().toLowerCase())
                    if (exact) void placeFulfillmentBoxes([exact.id])
                    else setPlacementError('Короб с таким QR / ШК не найден среди неразмещённых коробов')
                  }}
                  placeholder="Сканируйте QR / ШК или найдите короб"
                  autoFocus
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-violet-400"
                />

                {storageLoading ? (
                  <div className="py-4 text-center text-xs text-slate-400">Загрузка коробов...</div>
                ) : storageBoxes.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-400">Нет неразмещённых коробов фулфилмента</div>
                ) : (
                  <>
                    <div className="mt-2">
                      <div className="mb-1 text-[10px] font-medium text-slate-500">Неразмещённые короба</div>
                      <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                        {searchedStorageBoxes.map((box) => (
                          <button key={box.id} type="button" onClick={() => void placeFulfillmentBoxes([box.id])}
                            className="flex w-full cursor-pointer items-center justify-between border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-violet-50">
                            <span>
                              <span className="block text-xs font-semibold text-slate-700">Короб №{box.box_number}</span>
                              <span className="block text-[10px] text-slate-400">P{box.batch_short_id ?? '?'} · S{box.supply_number} · {box.batch_name}</span>
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">{box.barcode}</span>
                          </button>
                        ))}
                        {searchedStorageBoxes.length === 0 && <div className="px-3 py-4 text-center text-xs text-slate-400">Ничего не найдено</div>}
                      </div>
                    </div>

                    <div className="mt-3 border-t border-violet-100 pt-3">
                      <div className="mb-1 text-[10px] font-medium text-slate-500">Или выберите поставку</div>
                      <select value={selectedSupplyId} onChange={(event) => {
                        setSelectedSupplyId(event.target.value)
                        setSelectedStorageBoxIds(new Set())
                        setBoxNumberExpression('')
                        setPlacementError('')
                      }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-violet-400">
                        <option value="">— Поставка —</option>
                        {supplyOptions.map((supply) => (
                          <option key={supply.supply_id} value={supply.supply_id}>
                            P{supply.batch_short_id ?? '?'} · {supply.batch_name} · Поставка S{supply.supply_number} · {supply.warehouse_name || 'склад не указан'}
                          </option>
                        ))}
                      </select>

                      {selectedSupplyId && (
                        <div className="mt-2">
                          <div className="flex gap-2">
                            <input value={boxNumberExpression} onChange={(event) => setBoxNumberExpression(event.target.value)}
                              placeholder="Номера: 1, 3, 5-8"
                              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-violet-400" />
                            <button type="button" onClick={applyBoxNumberExpression}
                              className="cursor-pointer rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs text-violet-600 hover:bg-violet-50">Выбрать номера</button>
                            <button type="button" onClick={() => setSelectedStorageBoxIds(new Set(selectedSupplyBoxes.map((box) => box.id)))}
                              className="cursor-pointer rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs text-violet-600 hover:bg-violet-50">Все</button>
                          </div>
                          <div className="mt-2 grid max-h-32 grid-cols-4 gap-1.5 overflow-y-auto">
                            {selectedSupplyBoxes.map((box) => {
                              const checked = selectedStorageBoxIds.has(box.id)
                              return (
                                <label key={box.id} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] ${checked ? 'border-violet-300 bg-violet-100 text-violet-700' : 'border-slate-200 bg-white text-slate-600 hover:border-violet-200'}`}>
                                  <input type="checkbox" checked={checked} onChange={() => setSelectedStorageBoxIds((previous) => {
                                    const next = new Set(previous); checked ? next.delete(box.id) : next.add(box.id); return next
                                  })} />
                                  №{box.box_number}
                                </label>
                              )
                            })}
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="max-w-[55%] text-[10px] text-slate-400">
                              Выбрано: {selectedStorageBoxIds.size}. Несколько коробов займут свободные места стеллажа по порядку от выбранного адреса.
                            </span>
                            <button type="button" disabled={selectedStorageBoxIds.size === 0 || saving}
                              onClick={() => void placeFulfillmentBoxes(Array.from(selectedStorageBoxIds))}
                              className="cursor-pointer rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50">
                              {saving ? 'Размещение...' : `Разместить ${selectedStorageBoxIds.size || ''}`}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
                {placementError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600">{placementError}</div>}
              </div>
            )}
          </div>}
        </div>
      </div>
    </div>
  )
}

function ScanWorkspace({ location, pendingBox, error, success, busy, onScan, onSelectSlot, onConfirm, onReset, onClose }: {
  location: WmsScanLocation | null
  pendingBox: WmsScanBox | null
  error: string
  success: string
  busy: boolean
  onScan: (code: string) => void
  onSelectSlot: (slot: number) => void
  onConfirm: (action: 'move' | 'swap') => void
  onReset: () => void
  onClose: () => void
}) {
  const [manualCode, setManualCode] = useState('')
  const title = location
    ? `${location.warehouseName} · ${location.rackName} · ${location.sideName} · ${location.pallet}`
    : pendingBox ? `Короб №${pendingBox.boxNumber}` : 'Ожидание сканирования'

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-950/60 backdrop-blur-sm">
      <div className="flex min-h-0 flex-1 flex-col bg-white sm:m-3 sm:rounded-3xl sm:shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4M7 12h10" /></svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-slate-900">Адресное сканирование</h2>
            <p className="truncate text-xs text-slate-500">{title}</p>
          </div>
          <button type="button" onClick={onReset} className="cursor-pointer rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Сбросить фокус</button>
          <button type="button" onClick={onClose} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Закрыть и сбросить">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-slate-50 p-5 lg:flex-row">
          <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <form onSubmit={(event) => { event.preventDefault(); if (manualCode.trim()) { onScan(manualCode); setManualCode('') } }} className="flex min-w-[280px] flex-1 gap-2">
                <input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Сканируйте QR или введите код" autoFocus
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
                <button disabled={!manualCode.trim() || busy} className="cursor-pointer rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Применить</button>
              </form>
            </div>

            {!location ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
                <div className="mb-3 text-lg font-semibold text-slate-700">Сканируйте паллетоместо, коробоместо или короб</div>
                <p className="max-w-lg text-sm leading-6 text-slate-500">Место никогда не выбирается автоматически. После паллетоместа явно выберите K на сетке или отсканируйте QR конкретного K.</p>
              </div>
            ) : (
              <>
                <div className={`mb-4 rounded-xl border px-4 py-3 ${location.full ? 'border-red-300 bg-red-50' : 'border-violet-200 bg-violet-50'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">{location.pallet}</span>
                    <span className="text-xs text-slate-500">Заполнено {location.filled} из {location.slotCount}</span>
                    {location.full && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">Паллетоместо заполнено — новое размещение заблокировано</span>}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{location.code}</div>
                </div>
                <div className="mx-auto grid w-full max-w-lg gap-3 rounded-2xl border-[6px] border-amber-200/70 bg-amber-50 p-4"
                  style={{ gridTemplateColumns: `repeat(${location.slotColumns}, minmax(0, 1fr))` }}>
                  {location.slots.map((slot) => {
                    const selected = location.slotNumber === slot.number
                    return (
                      <button key={slot.number} type="button" onClick={() => onSelectSlot(slot.number)} disabled={busy}
                        className={`min-h-20 cursor-pointer rounded-xl border-2 p-3 text-center transition disabled:cursor-wait ${selected ? 'border-violet-500 bg-violet-100 text-violet-800 ring-4 ring-violet-100' : slot.occupied ? 'border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200' : location.full ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                        <div className="text-lg font-bold">K{slot.number}</div>
                        <div className="mt-1 text-[11px]">{slot.occupied ? `Короб №${slot.boxNumber ?? '—'}` : 'Свободно'}</div>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-4 text-center text-sm text-slate-500">
                  {location.slotNumber ? `Выбрано место K${location.slotNumber}. Теперь сканируйте короб.` : 'Выберите K на схеме или отсканируйте QR коробоместа.'}
                </div>
              </>
            )}
          </section>

          <aside className="flex w-full flex-col gap-3 lg:w-80">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Короб</div>
              {pendingBox ? (
                <div className="mt-2">
                  <div className="text-lg font-bold text-slate-800">Короб №{pendingBox.boxNumber}</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-500">{pendingBox.barcode}</div>
                  {pendingBox.placed && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">Сейчас: {pendingBox.addressText}. Перенос потребует подтверждения.</div>}
                </div>
              ) : <div className="mt-2 text-sm text-slate-400">Короб не отсканирован</div>}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-500">
              <div className="font-semibold text-slate-700">Сброс фокуса</div>
              <div>• отсканировать другое паллетоместо;</div>
              <div>• нажать «Сбросить фокус» или закрыть;</div>
              <div>• отсканировать <span className="font-mono font-semibold">EL_WMS_RESET_V1</span>.</div>
              <button type="button" onClick={() => openWmsQrPdf([{
                code: 'EL_WMS_RESET_V1',
                title: 'СБРОС ФОКУСА',
                warehouseName: 'Склад ELESTET',
                rackName: 'Адресное сканирование',
                sideName: 'Служебный QR',
                address: 'RESET',
              }])} className="mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-600">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg>
                Печать QR сброса
              </button>
            </div>
            {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{error}</div>}
            {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">{success}</div>}
            {error.includes('Перенести его') && <button type="button" onClick={() => onConfirm('move')} className="cursor-pointer rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white">Подтвердить перенос</button>}
            {error.includes('Поменять короба') && <button type="button" onClick={() => onConfirm('swap')} className="cursor-pointer rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white">Подтвердить обмен</button>}
          </aside>
        </div>
      </div>
    </div>
  )
}

// ─── WmsPage ──────────────────────────────────────────────────────────────────

export function WmsPage({ accountId, canManage = true, canViewHistory = true, canInventory = true }: {
  accountId: string
  canManage?: boolean
  canViewHistory?: boolean
  canInventory?: boolean
}) {
  const [warehouses, setWarehouses] = useState<WmsWarehouse[]>([])
  const [zonesByWarehouse, setZonesByWarehouse] = useState<Record<string, WmsZone[]>>({})
  const [cells, setCells] = useState<WmsCell[]>([])
  const [expandedWarehouseIds, setExpandedWarehouseIds] = useState<Set<string>>(new Set())
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [warehouseModal, setWarehouseModal] = useState<{ open: boolean; editing: WmsWarehouse | null }>({ open: false, editing: null })
  const [zoneModal, setZoneModal] = useState<{ open: boolean; editing: WmsZone | null; warehouseId: string }>({ open: false, editing: null, warehouseId: '' })
  const [selectedCellCoord, setSelectedCellCoord] = useState<{ col: string; row: number; sideKey: string } | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanLocation, setScanLocation] = useState<WmsScanLocation | null>(null)
  const [scanBox, setScanBox] = useState<WmsScanBox | null>(null)
  const [scanError, setScanError] = useState('')
  const [scanSuccess, setScanSuccess] = useState('')
  const [scanBusy, setScanBusy] = useState(false)
  const scanBufferRef = useRef('')
  const scanTimerRef = useRef<number | null>(null)
  const autoOpenedAccountRef = useRef<string | null>(null)
  const [accountShortId, setAccountShortId] = useState<number | null>(null)
  const [operationsModal, setOperationsModal] = useState<'search' | 'unaddressed' | 'history' | 'inventory' | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<WmsSearchResult[]>([])
  const [searchHasRun, setSearchHasRun] = useState(false)
  const [searchError, setSearchError] = useState('')
  const searchRequestRef = useRef(0)
  const [unaddressedBoxes, setUnaddressedBoxes] = useState<UnaddressedBox[]>([])
  const [movements, setMovements] = useState<WmsMovement[]>([])
  const [operationsLoading, setOperationsLoading] = useState(false)
  const [inventorySessionId, setInventorySessionId] = useState<string | null>(null)
  const [inventoryBoxCode, setInventoryBoxCode] = useState('')
  const [inventoryLocationCode, setInventoryLocationCode] = useState('')
  const [inventoryResults, setInventoryResults] = useState<InventoryScanResult[]>([])
  const [inventorySummary, setInventorySummary] = useState<Record<string, number> | null>(null)

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadWarehouses = useCallback(async () => {
    if (!supabase || !accountId) return
    const { data } = await (supabase as any)
      .from('wms_warehouses').select('*').eq('account_id', accountId).order('created_at')
    setWarehouses(data ?? [])
    setLoading(false)
  }, [accountId])

  const loadZones = useCallback(async (warehouseId: string) => {
    if (!supabase) return
    const { data } = await (supabase as any)
      .from('wms_zones').select('*, sides:wms_zone_sides(*)').eq('warehouse_id', warehouseId).order('created_at')
    setZonesByWarehouse((prev) => ({
      ...prev,
      [warehouseId]: (data ?? []).map((zone: WmsZone) => ({
        ...zone,
        upright_mode: zone.upright_mode ?? 'interval',
        upright_every: zone.upright_every ?? 3,
        upright_after_cols: zone.upright_after_cols ?? intervalUprights(zone.cols, 3),
        sides: normalizedZoneSides(zone),
      })),
    }))
  }, [])

  const loadCells = useCallback(async (zoneId: string) => {
    if (!supabase) return
    const { data, error } = await (supabase as any)
      .from('wms_cells')
      .select('*, items:wms_cell_items(*, contents:wms_box_contents(*), fulfillment_box:fulfillment_boxes(*, items:fulfillment_box_items(*)))')
      .eq('zone_id', zoneId)
    if (error) {
      console.error('[wms] Не удалось загрузить паллетоместа', error)
      return
    }
    setCells((data ?? []).map((c: any) => ({
      ...c,
      items: (c.items ?? []).map((i: any) => ({
        ...i,
        contents: i.contents ?? [],
        fulfillment_box: Array.isArray(i.fulfillment_box) ? (i.fulfillment_box[0] ?? null) : (i.fulfillment_box ?? null),
      })),
    })))
  }, [])

  const loadUnaddressedBoxes = useCallback(async (silent = false) => {
    if (!supabase || !accountId) return
    if (!silent) setOperationsLoading(true)
    const { data, error } = await (supabase as any).rpc('get_unaddressed_fulfillment_boxes', { p_account_id: accountId })
    if (error) {
      if (!silent) window.alert(error.message || 'Не удалось загрузить неразмещённые короба')
    } else {
      setUnaddressedBoxes((data ?? []) as UnaddressedBox[])
    }
    if (!silent) setOperationsLoading(false)
  }, [accountId])

  useEffect(() => {
    void loadUnaddressedBoxes(true)
  }, [loadUnaddressedBoxes])

  const runWmsSearch = useCallback(async (query = searchQuery) => {
    if (!supabase || !accountId) return
    const normalizedQuery = query.trim()
    const requestId = ++searchRequestRef.current

    if (!normalizedQuery) {
      setSearchResults([])
      setSearchHasRun(false)
      setSearchError('')
      setOperationsLoading(false)
      return
    }

    setOperationsLoading(true)
    setSearchError('')
    const { data, error } = await (supabase as any).rpc('search_wms_locations', {
      p_account_id: accountId,
      p_query: normalizedQuery,
      p_limit: 300,
    })

    if (requestId !== searchRequestRef.current) return
    if (error) {
      setSearchResults([])
      setSearchError(error.message || 'Не удалось выполнить поиск')
    } else {
      setSearchResults((data ?? []) as WmsSearchResult[])
    }
    setSearchHasRun(true)
    setOperationsLoading(false)
  }, [accountId, searchQuery])

  useEffect(() => {
    if (operationsModal !== 'search') return
    const query = searchQuery.trim()
    if (query.length < 2) {
      searchRequestRef.current += 1
      setSearchResults([])
      setSearchHasRun(false)
      setSearchError('')
      setOperationsLoading(false)
      return
    }
    const timeout = window.setTimeout(() => void runWmsSearch(query), 350)
    return () => window.clearTimeout(timeout)
  }, [operationsModal, runWmsSearch, searchQuery])

  const groupedSearchResults = useMemo(() => {
    const groups = new Map<string, {
      key: string
      storeId: string | null
      storeName: string
      storeCode: string | null
      totalBoxes: number
      addressedBoxes: number
      unaddressedBoxes: number
      results: WmsSearchResult[]
    }>()

    for (const result of searchResults) {
      const key = result.store_id ?? 'without-store'
      const current = groups.get(key) ?? {
        key,
        storeId: result.store_id,
        storeName: result.store_name || 'Магазин не указан',
        storeCode: result.store_code,
        totalBoxes: result.store_total_boxes,
        addressedBoxes: result.store_addressed_boxes,
        unaddressedBoxes: result.store_unaddressed_boxes,
        results: [],
      }
      current.results.push(result)
      groups.set(key, current)
    }

    return [...groups.values()].map((group) => {
      const supplies = new Map<string, {
        key: string
        batchName: string
        batchNumber: number | null
        supplyNumber: number
        destinationWarehouse: string
        results: WmsSearchResult[]
      }>()
      for (const result of group.results) {
        const key = `${result.batch_number ?? result.batch_name}-${result.supply_number}`
        const current = supplies.get(key) ?? {
          key,
          batchName: result.batch_name,
          batchNumber: result.batch_number,
          supplyNumber: result.supply_number,
          destinationWarehouse: result.destination_warehouse,
          results: [],
        }
        current.results.push(result)
        supplies.set(key, current)
      }
      return { ...group, supplies: [...supplies.values()] }
    })
  }, [searchResults])

  const loadMovements = useCallback(async () => {
    if (!supabase || !accountId) return
    setOperationsLoading(true)
    const { data, error } = await (supabase as any)
      .from('wms_movements')
      .select('*, fulfillment_box:fulfillment_boxes(box_number,barcode)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) window.alert(error.message || 'Не удалось загрузить историю склада')
    else setMovements((data ?? []) as WmsMovement[])
    setOperationsLoading(false)
  }, [accountId])

  useEffect(() => {
    autoOpenedAccountRef.current = null
    setLoading(true)
    setWarehouses([])
    setZonesByWarehouse({})
    setExpandedWarehouseIds(new Set())
    setSelectedZoneId(null)
    setSelectedCellCoord(null)
    setCells([])
    void loadWarehouses()
  }, [loadWarehouses])
  useEffect(() => {
    if (!supabase || !accountId) return
    void (supabase as any).from('accounts').select('short_id').eq('id', accountId).single()
      .then(({ data }: any) => { setAccountShortId(data?.short_id ?? null) })
  }, [accountId])
  useEffect(() => { if (scanError) signalScan(false) }, [scanError])
  useEffect(() => { if (scanSuccess && scanSuccess !== 'Фокус сканирования сброшен') signalScan(true) }, [scanSuccess])

  // ── Derived state ─────────────────────────────────────────────────────────

  const selectedZone = Object.values(zonesByWarehouse).flat().find((z) => z.id === selectedZoneId) ?? null
  const selectedWarehouse = selectedZone ? warehouses.find((warehouse) => warehouse.id === selectedZone.warehouse_id) ?? null : null
  const grid = selectedZone ? generateGrid(selectedZone, cells) : []
  const selectedZoneSides = selectedZone ? normalizedZoneSides(selectedZone) : []
  const currentCell = selectedCellCoord
    ? (grid.flat().find((c) => c.col === selectedCellCoord.col && c.row === selectedCellCoord.row) ?? null)
    : null
  const totalPalletPlaces = selectedZone ? selectedZone.cols * selectedZone.rows * Math.max(selectedZoneSides.length, 1) : 0
  const disabledPalletPlaces = cells.filter((cell) => cell.status === 'disabled').length * Math.max(selectedZoneSides.length, 1)
  const occupiedPalletPlaces = selectedZoneSides.reduce((total, side) => total + cells.filter((cell) =>
    cell.status !== 'disabled' && (cell.items ?? []).some((item) => item.item_type === 'box' && (item.side_id === side.id || (!item.side_id && side.position === 0))),
  ).length, 0)
  const freePalletPlaces = Math.max(totalPalletPlaces - disabledPalletPlaces - occupiedPalletPlaces, 0)

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelectZone = useCallback(async (id: string) => {
    setSelectedZoneId(id); setCells([]); setSelectedCellCoord(null)
    await loadCells(id)
  }, [loadCells])

  const handleSelectWarehouse = useCallback(async (id: string) => {
    setExpandedWarehouseIds((prev) => new Set([...prev, id]))
    let zones = zonesByWarehouse[id]
    if (!zones) {
      if (!supabase) return
      const { data } = await (supabase as any)
        .from('wms_zones').select('*, sides:wms_zone_sides(*)').eq('warehouse_id', id).order('created_at')
      zones = (data ?? []).map((zone: WmsZone) => ({
        ...zone,
        upright_mode: zone.upright_mode ?? 'interval',
        upright_every: zone.upright_every ?? 3,
        upright_after_cols: zone.upright_after_cols ?? intervalUprights(zone.cols, 3),
        sides: normalizedZoneSides(zone),
      }))
      setZonesByWarehouse((prev) => ({ ...prev, [id]: zones! }))
    }
    if (zones.length > 0) await handleSelectZone(zones[0].id)
  }, [handleSelectZone, zonesByWarehouse])

  useEffect(() => {
    if (loading || warehouses.length === 0 || autoOpenedAccountRef.current === accountId) return
    autoOpenedAccountRef.current = accountId
    void handleSelectWarehouse(warehouses[0].id)
  }, [accountId, handleSelectWarehouse, loading, warehouses])

  const resetScan = useCallback(() => {
    setScanLocation(null)
    setScanBox(null)
    setScanError('')
    setScanSuccess('Фокус сканирования сброшен')
  }, [])

  const refreshScanLocation = useCallback(async (code: string) => {
    if (!supabase) return null
    const { data, error } = await (supabase as any).rpc('get_wms_scan_target', { p_code: code })
    if (error) throw error
    const result = data as WmsScanLocation
    setScanLocation(result)
    return result
  }, [])

  const placeScannedBox = useCallback(async (box: WmsScanBox, location: WmsScanLocation, confirm?: 'move' | 'swap') => {
    if (!supabase || !location.slotNumber) return
    setScanBusy(true); setScanError(''); setScanSuccess('')
    try {
      const { data, error } = await (supabase as any).rpc('place_wms_box_by_scan', {
        p_box_barcode: box.barcode,
        p_location_code: location.code,
        p_confirm_move: confirm === 'move',
        p_confirm_swap: confirm === 'swap',
      })
      if (error) throw error
      if (data?.requiresConfirmation) {
        setScanError(data.message)
        return
      }
      setScanBox(null)
      setScanSuccess(data?.message ?? `Короб №${box.boxNumber} размещён в ${location.pallet}-K${location.slotNumber}`)
      await refreshScanLocation(wmsPalletCode(
        Number(location.code.match(/^C(\d+)/)?.[1]), location.warehouseShortId,
        location.rackShortId, location.sideNumber, location.pallet,
      ))
      await loadCells(location.rackId)
    } catch (placeError: any) {
      setScanError(placeError?.message || 'Не удалось разместить короб')
    } finally {
      setScanBusy(false)
    }
  }, [loadCells, refreshScanLocation])

  const processScan = useCallback(async (rawCode: string) => {
    if (!supabase || scanBusy) return
    const code = rawCode.trim().toUpperCase()
    if (!code) return
    setScanOpen(true); setScanBusy(true); setScanError(''); setScanSuccess('')
    try {
      const { data, error } = await (supabase as any).rpc('get_wms_scan_target', { p_code: code })
      if (error) throw error
      if (data.kind === 'reset') { resetScan(); return }
      if (data.kind === 'box') {
        const box = data as WmsScanBox
        setScanBox(box)
        if (scanLocation?.slotNumber) await placeScannedBox(box, scanLocation)
        else setScanSuccess(`Короб №${box.boxNumber} ожидает выбора адреса`)
        return
      }
      const location = data as WmsScanLocation
      setScanLocation(location)
      setSelectedZoneId(location.rackId)
      setExpandedWarehouseIds((previous) => new Set([...previous, location.warehouseId]))
      await loadZones(location.warehouseId)
      await loadCells(location.rackId)
      if (location.full && !location.slotNumber) setScanError('Паллетоместо заполнено. Дальнейшее заполнение заблокировано')
      if (scanBox && location.slotNumber) await placeScannedBox(scanBox, location)
      else setScanSuccess(location.slotNumber ? `Выбрано коробоместо ${location.pallet}-K${location.slotNumber}` : `Выбрано паллетоместо ${location.pallet}. Теперь выберите K.`)
    } catch (scanFailure: any) {
      setScanError(scanFailure?.message || 'QR / ШК не распознан')
    } finally {
      setScanBusy(false)
    }
  }, [loadCells, loadZones, placeScannedBox, resetScan, scanBox, scanBusy, scanLocation])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === 'Enter') {
        const code = scanBufferRef.current
        scanBufferRef.current = ''
        if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
        if (code.length >= 4) void processScan(code)
        return
      }
      if (event.key.length !== 1) return
      scanBufferRef.current += event.key
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
      scanTimerRef.current = window.setTimeout(() => { scanBufferRef.current = '' }, 180)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
    }
  }, [processScan])

  const handleSelectScanSlot = useCallback((slotNumber: number) => {
    if (!scanLocation) return
    const palletCode = scanLocation.code.replace(/_K\d+$/i, '')
    void processScan(`${palletCode}_K${slotNumber}`)
  }, [processScan, scanLocation])

  const handleConfirmScanPlacement = useCallback((action: 'move' | 'swap') => {
    if (!scanBox || !scanLocation?.slotNumber) return
    void placeScannedBox(scanBox, scanLocation, action)
  }, [placeScannedBox, scanBox, scanLocation])

  const handleCloseScan = useCallback(() => {
    resetScan()
    setScanOpen(false)
  }, [resetScan])

  const openOperations = useCallback((mode: 'search' | 'unaddressed' | 'history' | 'inventory') => {
    setOperationsModal(mode)
    if (mode === 'unaddressed') void loadUnaddressedBoxes()
    if (mode === 'history') void loadMovements()
  }, [loadMovements, loadUnaddressedBoxes])

  const closeOperations = useCallback(() => {
    if (operationsModal === 'search') {
      searchRequestRef.current += 1
      setSearchQuery('')
      setSearchResults([])
      setSearchHasRun(false)
      setSearchError('')
      setOperationsLoading(false)
    }
    setOperationsModal(null)
  }, [operationsModal])

  const startInventory = useCallback(async () => {
    if (!supabase || !selectedWarehouse) return
    setOperationsLoading(true)
    const { data, error } = await (supabase as any).rpc('start_wms_inventory', { p_warehouse_id: selectedWarehouse.id })
    if (error) window.alert(error.message || 'Не удалось начать инвентаризацию')
    else {
      setInventorySessionId(data as string)
      setInventoryResults([])
      setInventorySummary(null)
    }
    setOperationsLoading(false)
  }, [selectedWarehouse])

  const scanInventoryBox = useCallback(async () => {
    if (!supabase || !inventorySessionId || !inventoryBoxCode.trim()) return
    setOperationsLoading(true)
    const { data, error } = await (supabase as any).rpc('scan_wms_inventory_box', {
      p_session_id: inventorySessionId,
      p_box_barcode: inventoryBoxCode.trim(),
      p_location_code: inventoryLocationCode.trim() || null,
    })
    if (error) {
      signalScan(false)
      window.alert(error.message || 'Не удалось проверить короб')
    } else {
      const result = data as InventoryScanResult
      signalScan(result.result === 'found')
      setInventoryResults((previous) => [result, ...previous.filter((item) => item.boxNumber !== result.boxNumber)])
    }
    setInventoryBoxCode('')
    setOperationsLoading(false)
  }, [inventoryBoxCode, inventoryLocationCode, inventorySessionId])

  const finishInventory = useCallback(async () => {
    if (!supabase || !inventorySessionId) return
    setOperationsLoading(true)
    const { data, error } = await (supabase as any).rpc('finish_wms_inventory', { p_session_id: inventorySessionId })
    if (error) window.alert(error.message || 'Не удалось завершить инвентаризацию')
    else {
      setInventorySummary(data as Record<string, number>)
      setInventorySessionId(null)
    }
    setOperationsLoading(false)
  }, [inventorySessionId])

  const handleSaveWarehouse = async (name: string, description: string, fbsEnabled: boolean, wbWarehouseId: string) => {
    if (!supabase) return
    const editId = warehouseModal.editing?.id
    if (editId) {
      await (supabase as any).from('wms_warehouses')
        .update({ name, description, fbs_enabled: fbsEnabled, wb_warehouse_id: wbWarehouseId, updated_at: new Date().toISOString() })
        .eq('id', editId)
    } else {
      await (supabase as any).from('wms_warehouses').insert({ account_id: accountId, name, description, fbs_enabled: fbsEnabled, wb_warehouse_id: wbWarehouseId })
    }
    setWarehouseModal({ open: false, editing: null })
    await loadWarehouses()
  }

  const handleDeleteWarehouse = async (id: string) => {
    if (!supabase) return
    if (warehouses.length <= 1) {
      window.alert('Нельзя удалить единственный склад компании')
      return
    }
    if (!window.confirm('Удалить склад и все его стеллажи?')) return
    const { error } = await (supabase as any).from('wms_warehouses').delete().eq('id', id)
    if (error) {
      window.alert(error.message.includes('единственный склад')
        ? 'Нельзя удалить единственный склад компании'
        : `Не удалось удалить склад: ${error.message}`)
      return
    }
    setExpandedWarehouseIds((prev) => { const next = new Set(prev); next.delete(id); return next })
    setZonesByWarehouse((prev) => { const next = { ...prev }; delete next[id]; return next })
    if (selectedZoneId && (zonesByWarehouse[id] ?? []).some((z) => z.id === selectedZoneId)) {
      setSelectedZoneId(null); setCells([])
    }
    await loadWarehouses()
  }

  const handleSaveZone = async (settings: ZoneSettings) => {
    if (!supabase) return
    const whId = zoneModal.warehouseId
    const editId = zoneModal.editing?.id
    const { error } = await (supabase as any).rpc('save_wms_zone_layout', {
      p_zone_id: editId ?? null,
      p_warehouse_id: whId,
      p_account_id: accountId,
      p_name: settings.name,
      p_cols: settings.cols,
      p_rows: settings.rows,
      p_upright_mode: settings.uprightMode,
      p_upright_every: settings.uprightEvery,
      p_upright_after_cols: settings.uprightAfterCols,
      p_sides: settings.sides.map((side) => ({
        id: side.id ?? null,
        code: side.code,
        name: side.name,
        slot_count: side.slot_count,
        slot_columns: side.slot_columns,
        slot_rows: side.slot_rows,
        position: side.position,
      })),
    })
    if (error) {
      const message = error.message || ''
      if (message.includes('wms_cell_items_side_id_fkey') || message.includes('foreign key constraint')) {
        throw new Error('Эту сторону нельзя удалить: на ней находятся короба')
      }
      throw new Error(message)
    }
    setZoneModal({ open: false, editing: null, warehouseId: '' })
    // Перезагружаем зоны всех раскрытых складов
    const toReload = new Set([...expandedWarehouseIds])
    if (whId) toReload.add(whId)
    for (const id of toReload) { await loadZones(id) }
  }

  const handleDeleteZone = async (id: string) => {
    if (!supabase || !window.confirm('Удалить стеллаж со всеми адресами?')) return
    await (supabase as any).from('wms_zones').delete().eq('id', id)
    if (selectedZoneId === id) { setSelectedZoneId(null); setCells([]) }
    const parentWarehouseId = warehouses.find((wh) =>
      (zonesByWarehouse[wh.id] ?? []).some((z) => z.id === id)
    )?.id
    if (parentWarehouseId) await loadZones(parentWarehouseId)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Загрузка...
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel: warehouse tree ──────────────────────────────────── */}
      <div className="flex w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white select-none">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="text-sm font-semibold text-slate-700">Склады</span>
          {canManage && (
            <button type="button" title="Создать склад"
              onClick={() => setWarehouseModal({ open: true, editing: null })}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-violet-600">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
        </div>

        {warehouses.length === 0 ? (
          <div className="p-5 text-center text-xs text-slate-400">
            Нет складов.<br />Нажмите «+» чтобы создать.
          </div>
        ) : (
          <div className="flex flex-col py-2">
            {warehouses.map((wh) => (
              <div key={wh.id}>
                {/* Warehouse row */}
                <div
                  className={`group flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-slate-50 ${expandedWarehouseIds.has(wh.id) ? 'bg-slate-50' : ''}`}
                  onClick={() => void handleSelectWarehouse(wh.id)}
                >
                  <svg viewBox="0 0 24 24"
                    className={`h-3 w-3 flex-shrink-0 text-slate-400 transition-transform ${expandedWarehouseIds.has(wh.id) ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                  <span className="flex-1 truncate text-sm font-medium text-slate-700">{wh.name}</span>
                  {canManage && <button type="button"
                    onClick={(e) => { e.stopPropagation(); setWarehouseModal({ open: true, editing: wh }) }}
                    className="hidden h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-600 group-hover:flex">
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>}
                  {canManage && <button type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDeleteWarehouse(wh.id) }}
                    disabled={warehouses.length <= 1}
                    title={warehouses.length <= 1 ? 'Нельзя удалить единственный склад' : 'Удалить склад'}
                    className={`hidden h-5 w-5 items-center justify-center rounded group-hover:flex ${
                      warehouses.length <= 1
                        ? 'cursor-not-allowed text-slate-300'
                        : 'cursor-pointer text-slate-400 hover:text-red-500'
                    }`}>
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>}
                </div>

                {/* Zone list */}
                {expandedWarehouseIds.has(wh.id) && (
                  <div className="ml-5 border-l border-slate-100">
                    {canManage && <button type="button"
                      onClick={() => setZoneModal({ open: true, editing: null, warehouseId: wh.id })}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-violet-600">
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Добавить стеллаж
                    </button>}
                    {(zonesByWarehouse[wh.id] ?? []).map((zone) => (
                      <div key={zone.id}
                        className={`group flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50 ${selectedZoneId === zone.id ? 'bg-violet-50' : ''}`}
                        onClick={() => void handleSelectZone(zone.id)}
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <path d="M3 9h18M3 15h18M9 3v18" />
                        </svg>
                        <span className={`flex-1 truncate text-sm ${selectedZoneId === zone.id ? 'font-semibold text-violet-700' : 'text-slate-600'}`}>
                          {zone.name}
                        </span>
                        <span className="text-[10px] text-slate-400">{zone.cols}×{zone.rows}</span>
                        {canManage && <button type="button"
                          onClick={(e) => { e.stopPropagation(); setZoneModal({ open: true, editing: zone, warehouseId: wh.id }) }}
                          className="hidden h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-600 group-hover:flex">
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>}
                        {canManage && <button type="button"
                          onClick={(e) => { e.stopPropagation(); void handleDeleteZone(zone.id) }}
                          className="hidden h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-red-500 group-hover:flex">
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Main content: zone grid ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedZone ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Выберите стеллаж из списка слева
          </div>
        ) : (
          <div className="flex h-full flex-col gap-4 overflow-auto p-5">
            {/* Zone header */}
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-800">{selectedZone.name}</h2>
              <span className="text-xs text-slate-400">
                {selectedZone.cols} паллетомест × {selectedZone.rows} ярусов · {selectedZoneSides.length} сторон
              </span>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
                <button type="button" onClick={() => openOperations('search')}
                  className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium hover:border-violet-200 hover:text-violet-700">
                  Поиск
                </button>
                <button type="button" onClick={() => openOperations('unaddressed')}
                  className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium hover:border-violet-200 hover:text-violet-700">
                  Без адреса {unaddressedBoxes.length}
                </button>
                {canInventory && <button type="button" onClick={() => openOperations('inventory')}
                  className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium hover:border-violet-200 hover:text-violet-700">
                  Инвентаризация
                </button>}
                {canViewHistory && <button type="button" onClick={() => openOperations('history')}
                  className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium hover:border-violet-200 hover:text-violet-700">
                  История
                </button>}
                {canManage && <button type="button" onClick={() => setScanOpen(true)}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 font-semibold text-violet-700 hover:bg-violet-100">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4M7 12h10" /></svg>
                  Сканирование
                </button>}
                <span className="flex items-center gap-1.5" title={`${freePalletPlaces} паллетомест`}>
                  <span className="h-3 w-3 rounded-sm border border-emerald-300 bg-emerald-200" />
                  Свободно {freePalletPlaces}
                </span>
                <span className="flex items-center gap-1.5" title={`${occupiedPalletPlaces} паллетомест`}>
                  <span className="h-3 w-3 rounded-sm border border-red-300 bg-red-200" />
                  Занято {occupiedPalletPlaces}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border border-slate-300 bg-slate-200" />
                  Заглушено {disabledPalletPlaces}
                </span>
              </div>
            </div>

            {/* One full rack view for every accessible side */}
            <div className="flex flex-col gap-5">
              {selectedZoneSides.map((side) => {
                const sideKey = side.id ?? side.code
                return (
                  <section key={sideKey}>
                    {selectedZoneSides.length > 1 && (
                      <div className="mb-1 text-xs font-semibold text-slate-700">{side.name}</div>
                    )}
                    <div className="overflow-auto">
                      <table className="border-separate border-spacing-1">
                        <thead>
                          <tr>
                            {/* Row-number column header (empty) */}
                            <th className="h-7 w-8" />
                            {Array.from({ length: selectedZone.cols }, (_, ci) => (
                              <th key={ci} className={`h-7 min-w-[52px] text-center text-xs font-bold text-slate-500 ${ci > 0 && selectedZone.upright_after_cols.includes(ci) ? 'border-l-[6px] border-slate-700 pl-1' : ''}`}>
                                {colIndexToLetter(ci)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {grid.map((rowCells, rowIdx) => (
                            <tr key={rowIdx}>
                              {/* Row number */}
                              <td className="h-10 w-8 text-center text-xs font-bold text-slate-400">
                                {rowIdx + 1}
                              </td>
                              {rowCells.map((vcell, cellIndex) => {
                                const isSelected =
                                  selectedCellCoord?.col === vcell.col &&
                                  selectedCellCoord?.row === vcell.row &&
                                  selectedCellCoord?.sideKey === sideKey
                                const cellItems = vcell.dbCell?.items ?? []
                                const hasAddressedBoxes = cellItems.some((item) => item.item_type === 'box' && item.side_id)
                                const sideItems = hasAddressedBoxes
                                  ? cellItems.filter((item) => item.side_id === side.id || (!item.side_id && side.position === 0))
                                  : cellItems
                                const visualStatus = vcell.status === 'disabled'
                                  ? 'disabled'
                                  : hasAddressedBoxes
                                    ? (sideItems.length > 0 ? 'occupied' : 'free')
                                    : vcell.status
                                const totalQty = sideItems.reduce((sum, item) => sum + item.qty, 0)
                                return (
                                  <td key={`${vcell.col}-${vcell.row}`} className={cellIndex > 0 && selectedZone.upright_after_cols.includes(cellIndex) ? 'border-l-[6px] border-slate-700 pl-1' : ''}>
                                    <button
                                      type="button"
                                      title={`${side.name} · ${vcell.col}${vcell.row}`}
                                      onClick={() => setSelectedCellCoord({ col: vcell.col, row: vcell.row, sideKey })}
                                      className={`flex h-10 min-w-[52px] flex-col items-center justify-center rounded-lg border text-[10px] font-semibold leading-tight transition ${
                                        isSelected ? 'ring-2 ring-violet-400 ring-offset-1' : ''
                                      } ${
                                        visualStatus === 'occupied'
                                          ? 'border-red-200 bg-red-100 text-red-700 hover:bg-red-200'
                                          : visualStatus === 'disabled'
                                          ? 'border-slate-300 bg-slate-200 text-slate-400 cursor-not-allowed'
                                          : 'border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                      }`}
                                    >
                                      <span className="text-[11px] font-bold">{vcell.col}{vcell.row}</span>
                                      {visualStatus !== 'free' && totalQty > 0 && <span>{totalQty} ед.</span>}
                                    </button>
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {warehouseModal.open && (
        <WarehouseModal
          editing={warehouseModal.editing}
          onClose={() => setWarehouseModal({ open: false, editing: null })}
          onSave={handleSaveWarehouse}
        />
      )}
      {zoneModal.open && (
        <ZoneModal
          editing={zoneModal.editing}
          onClose={() => setZoneModal({ open: false, editing: null, warehouseId: '' })}
          onSave={handleSaveZone}
        />
      )}
      {selectedCellCoord && currentCell && selectedZone && selectedWarehouse && (
        <CellModal
          key={`${selectedCellCoord.sideKey}-${selectedCellCoord.col}-${selectedCellCoord.row}`}
          cell={currentCell}
          zone={selectedZone}
          warehouse={selectedWarehouse}
          accountId={accountId}
          accountShortId={accountShortId}
          zoneId={selectedZoneId!}
          initialSideKey={selectedCellCoord.sideKey}
          canManage={canManage}
          onClose={() => setSelectedCellCoord(null)}
          onRefresh={() => {
            if (selectedZoneId) void loadCells(selectedZoneId)
            void loadUnaddressedBoxes(true)
          }}
        />
      )}
      {scanOpen && (
        <ScanWorkspace
          location={scanLocation}
          pendingBox={scanBox}
          error={scanError}
          success={scanSuccess}
          busy={scanBusy}
          onScan={(code) => void processScan(code)}
          onSelectSlot={handleSelectScanSlot}
          onConfirm={handleConfirmScanPlacement}
          onReset={resetScan}
          onClose={handleCloseScan}
        />
      )}
      {operationsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="flex h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-800">
                  {operationsModal === 'search' ? 'Поиск по складу' : operationsModal === 'unaddressed' ? 'Короба без адреса' : operationsModal === 'history' ? 'История склада' : 'Инвентаризация'}
                </h2>
                <p className="text-xs text-slate-400">{selectedWarehouse?.name ?? 'Склад'}</p>
              </div>
              <button type="button" onClick={closeOperations} className="cursor-pointer text-xl text-slate-400 hover:text-slate-700">×</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {operationsModal === 'search' && (
                <>
                  <div className="mb-3 flex gap-2">
                    <div className="relative flex-1">
                      <input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') void runWmsSearch(event.currentTarget.value) }}
                        autoFocus
                        placeholder="Магазин, товар, баркод, QR короба, партия, поставка или адрес"
                        className="w-full rounded-xl border border-slate-200 px-4 py-2.5 pr-10 text-sm outline-none focus:border-violet-400"
                      />
                      {operationsLoading && <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />}
                    </div>
                    <button
                      type="button"
                      onClick={() => void runWmsSearch()}
                      disabled={!searchQuery.trim() || operationsLoading}
                      className="cursor-pointer rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-40"
                    >Найти</button>
                  </div>

                  {searchError && (
                    <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                      Поиск не выполнен: {searchError}
                    </div>
                  )}

                  {searchHasRun && searchResults.length > 0 && (
                    <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                      <span>Найдено: <b className="text-slate-700">{searchResults[0]?.total_matches ?? searchResults.length}</b></span>
                      {(searchResults[0]?.total_matches ?? 0) > searchResults.length && <span>Показаны первые {searchResults.length}</span>}
                    </div>
                  )}

                  <div className="space-y-3">
                    {groupedSearchResults.map((group) => (
                      <section key={group.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <b className="text-sm text-slate-800">{group.storeName}</b>
                              {group.storeCode && <span className="rounded-md bg-white px-2 py-0.5 font-mono text-[10px] text-slate-500">{group.storeCode}</span>}
                            </div>
                            <span className="mt-0.5 block text-[11px] text-slate-400">Совпадений в выдаче: {group.results.length}</span>
                          </div>
                          <div className="flex gap-2 text-[11px]">
                            <span className="rounded-lg bg-white px-2.5 py-1 text-slate-600">Коробов: <b>{group.totalBoxes}</b></span>
                            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-700">С адресом: <b>{group.addressedBoxes}</b></span>
                            <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-amber-700">Без адреса: <b>{group.unaddressedBoxes}</b></span>
                          </div>
                        </div>

                        <div className="divide-y divide-slate-100">
                          {group.supplies.map((supply) => (
                            <div key={supply.key} className="p-3">
                              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-slate-500">
                                <b className="text-slate-700">P{supply.batchNumber ?? '?'} · {supply.batchName}</b>
                                <span>Поставка S{supply.supplyNumber}</span>
                                {supply.destinationWarehouse && <span>Склад назначения: {supply.destinationWarehouse}</span>}
                              </div>
                              <div className="space-y-2">
                                {supply.results.map((result) => (
                                  <button
                                    key={result.box_id}
                                    type="button"
                                    onClick={() => {
                                      if (!result.is_addressed || !result.warehouse_id || !result.rack_id || !result.side_id || !result.col || result.row == null) return
                                      setExpandedWarehouseIds((previous) => new Set([...previous, result.warehouse_id as string]))
                                      setSelectedZoneId(result.rack_id)
                                      void loadZones(result.warehouse_id)
                                      void loadCells(result.rack_id)
                                      setSelectedCellCoord({ col: result.col, row: result.row, sideKey: result.side_id })
                                      closeOperations()
                                    }}
                                    className={`flex w-full items-center justify-between gap-4 rounded-xl border p-3 text-left transition ${result.is_addressed ? 'cursor-pointer border-slate-200 hover:border-violet-300 hover:bg-violet-50' : 'cursor-default border-amber-200 bg-amber-50/40'}`}
                                  >
                                    <span className="min-w-0 flex-1">
                                      <span className="flex flex-wrap items-center gap-2">
                                        <b className="text-sm text-slate-800">Короб №{result.box_number}</b>
                                        <span className="font-mono text-[11px] text-slate-400">{result.box_barcode}</span>
                                        <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">{result.match_reason}</span>
                                      </span>
                                      {result.product_names.length > 0 && (
                                        <span className="mt-1 block truncate text-xs text-slate-600" title={result.product_names.join(', ')}>
                                          {result.product_names.slice(0, 2).join(' · ')}{result.product_names.length > 2 ? ` · ещё ${result.product_names.length - 2}` : ''}
                                        </span>
                                      )}
                                      <span className="mt-1 block text-[11px] text-slate-400">
                                        {result.units} ед.{result.product_barcodes.length > 0 ? ` · ${result.product_barcodes.slice(0, 2).join(', ')}` : ''}
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-right">
                                      {result.is_addressed ? (
                                        <>
                                          <b className="block text-xs text-violet-700">{result.address_text}</b>
                                          <span className="mt-1 block font-mono text-[10px] text-slate-400">{result.address_code}</span>
                                        </>
                                      ) : (
                                        <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">Без адреса</span>
                                      )}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                    {!operationsLoading && !searchHasRun && !searchError && <div className="py-12 text-center text-sm text-slate-400">Начните вводить запрос — поиск запустится автоматически</div>}
                    {!operationsLoading && searchHasRun && searchResults.length === 0 && !searchError && <div className="py-12 text-center text-sm text-slate-400">Ничего не найдено. Проверьте код или название.</div>}
                  </div>
                </>
              )}
              {operationsModal === 'unaddressed' && (
                <div className="space-y-2">
                  <div className="mb-3 flex items-center justify-between text-xs text-slate-500"><span>Всего без адреса: {unaddressedBoxes.length}</span><button type="button" onClick={() => void loadUnaddressedBoxes()} className="cursor-pointer text-violet-600">Обновить</button></div>
                  {unaddressedBoxes.map((box) => <div key={box.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3"><span><b>Короб №{box.box_number}</b><span className="ml-2 font-mono text-xs text-slate-400">{box.barcode}</span></span><span className="text-right text-xs text-slate-500">P{box.batch_number ?? '?'} · S{box.supply_number}<br />{box.units} ед.</span></div>)}
                  {!operationsLoading && unaddressedBoxes.length === 0 && <div className="py-12 text-center text-sm text-emerald-600">Все доступные короба размещены</div>}
                </div>
              )}
              {operationsModal === 'history' && (
                <div className="space-y-2">
                  {movements.map((movement) => {
                    const labels = { placed: 'Размещён', moved: 'Перемещён', unassigned: 'Адрес снят', released: 'Освобождён после отгрузки', swapped: 'Короба обменяны' }
                    return <div key={movement.id} className="grid grid-cols-[150px_1fr_170px] gap-3 rounded-xl border border-slate-200 p-3 text-xs"><b className="text-slate-800">{labels[movement.action]}</b><span className="text-slate-600">Короб №{movement.fulfillment_box?.box_number ?? '—'} · {movement.from_address_text ?? 'без адреса'} → {movement.to_address_text ?? 'без адреса'}</span><span className="text-right text-slate-400">{new Date(movement.created_at).toLocaleString('ru-RU')}</span></div>
                  })}
                  {!operationsLoading && movements.length === 0 && <div className="py-12 text-center text-sm text-slate-400">История пока пуста</div>}
                </div>
              )}
              {operationsModal === 'inventory' && (
                <div className="space-y-4">
                  {!inventorySessionId && !inventorySummary && <div className="rounded-2xl border border-slate-200 p-6 text-center"><p className="mb-4 text-sm text-slate-600">Система зафиксирует ожидаемые короба, а сотрудник последовательно отсканирует фактически найденные.</p><button type="button" onClick={() => void startInventory()} disabled={!selectedWarehouse || operationsLoading} className="cursor-pointer rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Начать инвентаризацию</button></div>}
                  {inventorySessionId && <><div className="grid grid-cols-2 gap-2"><input value={inventoryLocationCode} onChange={(event) => setInventoryLocationCode(event.target.value)} placeholder="QR адреса (необязательно)" className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-violet-400" /><input value={inventoryBoxCode} onChange={(event) => setInventoryBoxCode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void scanInventoryBox() }} autoFocus placeholder="Сканируйте QR / ШК короба" className="rounded-xl border border-violet-300 px-4 py-2.5 text-sm outline-none focus:border-violet-500" /></div><div className="flex justify-between"><span className="text-xs text-slate-500">Проверено: {inventoryResults.length}</span><button type="button" onClick={() => void finishInventory()} className="cursor-pointer rounded-xl border border-violet-300 px-4 py-2 text-xs font-semibold text-violet-700">Завершить и сверить</button></div>{inventoryResults.map((item) => <div key={item.boxNumber} className={`rounded-xl border p-3 text-xs ${item.result === 'found' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>Короб №{item.boxNumber}: {item.result === 'found' ? 'найден' : item.result === 'wrong_address' ? `неверный адрес, ожидается ${item.expectedAddress}` : 'не ожидался на этом складе'}</div>)}</>}
                  {inventorySummary && <div className="grid grid-cols-4 gap-3">{[['Ожидалось','expected'],['Проверено','scanned'],['Не найдено','missing'],['Не на месте','wrongAddress']].map(([label,key]) => <div key={key} className="rounded-2xl border border-slate-200 p-4 text-center"><b className="block text-2xl text-slate-800">{inventorySummary[key] ?? 0}</b><span className="text-xs text-slate-500">{label}</span></div>)}</div>}
                </div>
              )}
              {operationsLoading && <div className="py-4 text-center text-xs text-slate-400">Загрузка...</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
