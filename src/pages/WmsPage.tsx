import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WmsWarehouse {
  id: string
  account_id: string
  name: string
  description: string
  fbs_enabled: boolean
  wb_warehouse_id: string
  created_at: string
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
  contents: WmsBoxContent[]
}

interface WmsCell {
  id: string
  zone_id: string
  account_id: string
  col: string
  row: number
  status: 'free' | 'occupied' | 'reserved' | 'disabled'
  items: WmsCellItem[]
}

interface VirtualCell {
  col: string
  row: number
  status: 'free' | 'occupied' | 'reserved' | 'disabled'
  dbCell?: WmsCell
}

type BoxRow = { tempId: string; barcode: string; product_name: string; qty_per_box: string }

type ZoneSettings = {
  name: string
  cols: number
  rows: number
  uprightMode: 'interval' | 'custom'
  uprightEvery: number
  uprightAfterCols: number[]
  sides: WmsZoneSide[]
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

function defaultZoneSides(): WmsZoneSide[] {
  return [
    { code: 'S1', name: 'Лицевая сторона', slot_count: 8, slot_columns: 2, slot_rows: 4, position: 0 },
    { code: 'S2', name: 'Задняя сторона', slot_count: 8, slot_columns: 2, slot_rows: 4, position: 1 },
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
  const [rows, setRows] = useState(String(editing?.rows ?? 8))
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
    while (usedCodes.has(`S${index}`)) index += 1
    setSides((previous) => [...previous, {
      code: `S${index}`,
       name: previous.length === 0 ? 'Лицевая сторона' : 'Задняя сторона',
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

function CellModal({ cell, zone, accountId, zoneId, onClose, onRefresh }: {
  cell: VirtualCell
  zone: WmsZone
  accountId: string
  zoneId: string
  onClose: () => void
  onRefresh: () => void
}) {
  const [internalItems, setInternalItems] = useState<WmsCellItem[]>(cell.dbCell?.items ?? [])
  const [internalCellId, setInternalCellId] = useState<string | null>(cell.dbCell?.id ?? null)
  const [internalStatus, setInternalStatus] = useState<'free' | 'occupied' | 'reserved' | 'disabled'>(cell.status)
  const [addMode, setAddMode] = useState<null | 'item' | 'box'>(null)
  const [expandedBoxIds, setExpandedBoxIds] = useState<Set<string>>(new Set())

  // Item form
  const [newBarcode, setNewBarcode] = useState('')
  const [newName, setNewName] = useState('')
  const [newQty, setNewQty] = useState('1')

  // Box form
  const [boxName, setBoxName] = useState('')
  const [boxBarcode, setBoxBarcode] = useState('')
  const zoneSides = normalizedZoneSides(zone)
  const [boxSideId, setBoxSideId] = useState(zoneSides[0]?.id ?? '')
  const [boxSlotNumber, setBoxSlotNumber] = useState('1')
  const [boxRows, setBoxRows] = useState<BoxRow[]>([{ tempId: '1', barcode: '', product_name: '', qty_per_box: '1' }])
  const [assigningBoxId, setAssigningBoxId] = useState<string | null>(null)
  const [assignmentSideId, setAssignmentSideId] = useState(zoneSides[0]?.id ?? '')
  const [assignmentSlotNumber, setAssignmentSlotNumber] = useState('1')
  const [movingBoxId, setMovingBoxId] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)

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

  const handleSetStatus = async (newStatus: 'free' | 'occupied' | 'reserved' | 'disabled') => {
    if (!supabase || newStatus === internalStatus) return
    if (newStatus === 'free') {
      if (internalItems.length > 0) {
        alert('Сначала переместите или удалите содержимое паллетоместа')
        return
      }
      if (internalCellId) {
        await (supabase as any).from('wms_cells').delete().eq('id', internalCellId)
        setInternalCellId(null); setInternalItems([])
      }
    } else if (!internalCellId) {
      const id = await ensureCell()
      if (id && newStatus !== 'occupied') {
        await (supabase as any).from('wms_cells').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
      }
    } else {
      await (supabase as any).from('wms_cells').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', internalCellId)
    }
    setInternalStatus(newStatus)
    onRefresh()
  }

  const handleAddItem = async () => {
    if (!supabase || !newBarcode.trim()) return
    setSaving(true)
    const cellId = await ensureCell()
    if (!cellId) { setSaving(false); return }
    const { data } = await (supabase as any)
      .from('wms_cell_items')
      .insert({ cell_id: cellId, account_id: accountId, item_type: 'item', barcode: newBarcode.trim(), product_name: newName.trim(), qty: parseInt(newQty) || 1, reserved_qty: 0, box_name: '' })
      .select().single()
    if (data) setInternalItems((prev) => [...prev, { ...(data as WmsCellItem), contents: [] }])
    setNewBarcode(''); setNewName(''); setNewQty('1')
    setAddMode(null); setSaving(false); onRefresh()
  }

  const handleAddBox = async () => {
    const slotNumber = parseInt(boxSlotNumber) || 0
    if (!supabase || !boxBarcode.trim() || !boxSideId || slotNumber < 1) return
    setSaving(true)
    const cellId = await ensureCell()
    if (!cellId) { setSaving(false); return }
    const { data: boxData, error: boxError } = await (supabase as any)
      .from('wms_cell_items')
      .insert({
        cell_id: cellId, account_id: accountId, item_type: 'box',
        box_name: boxName.trim() || `Короб ${boxBarcode.trim()}`,
        qty: 1, barcode: boxBarcode.trim(), product_name: '', reserved_qty: 0,
        side_id: boxSideId, slot_number: slotNumber,
      })
      .select().single()
    if (boxError || !boxData) {
      alert(boxError?.message || 'Не удалось сохранить короб')
      setSaving(false)
      return
    }
    const validRows = boxRows.filter((r) => r.barcode.trim() || r.product_name.trim())
    let contents: WmsBoxContent[] = []
    if (validRows.length > 0) {
      const { data: cd } = await (supabase as any)
        .from('wms_box_contents')
        .insert(validRows.map((r) => ({ box_item_id: (boxData as WmsCellItem).id, account_id: accountId, barcode: r.barcode.trim(), product_name: r.product_name.trim(), qty_per_box: parseInt(r.qty_per_box) || 1 })))
        .select()
      contents = cd ?? []
    }
    setInternalItems((prev) => [...prev, { ...(boxData as WmsCellItem), contents }])
    setBoxName(''); setBoxBarcode(''); setBoxRows([{ tempId: '1', barcode: '', product_name: '', qty_per_box: '1' }])
    setAddMode(null); setSaving(false); onRefresh()
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

  const handleDeleteItem = async (itemId: string) => {
    if (!supabase) return
    await (supabase as any).from('wms_cell_items').delete().eq('id', itemId)
    setInternalItems((prev) => prev.filter((x) => x.id !== itemId))
    onRefresh()
  }

  const handleDeleteBoxContent = async (boxId: string, contentId: string) => {
    if (!supabase) return
    await (supabase as any).from('wms_box_contents').delete().eq('id', contentId)
    setInternalItems((prev) => prev.map((x) => x.id === boxId ? { ...x, contents: x.contents.filter((c) => c.id !== contentId) } : x))
    onRefresh()
  }

  const statusConfig = {
    free:     { label: 'Свободна',   active: 'border-emerald-400 bg-emerald-50 text-emerald-700' },
    occupied: { label: 'Занята',     active: 'border-red-400 bg-red-50 text-red-700' },
    reserved: { label: 'Резерв',     active: 'border-amber-400 bg-amber-50 text-amber-700' },
    disabled: { label: 'Заглушена', active: 'border-slate-400 bg-slate-100 text-slate-500' },
  } as const

  const singleItems = internalItems.filter((x) => x.item_type !== 'box')
  const boxes       = internalItems.filter((x) => x.item_type === 'box')
  const occupiedBoxSlots = new Map(
    boxes
      .filter((box) => box.side_id && box.slot_number)
      .map((box) => [`${box.side_id}-${box.slot_number}`, box]),
  )
  const selectedBoxSide = zoneSides.find((side) => side.id === boxSideId)
  const selectedAssignmentSide = zoneSides.find((side) => side.id === assignmentSideId)

  const firstFreeSlot = (sideId: string): number | null => {
    const side = zoneSides.find((item) => item.id === sideId)
    if (!side) return null
    for (let slot = 1; slot <= side.slot_count; slot += 1) {
      if (!occupiedBoxSlots.has(`${sideId}-${slot}`)) return slot
    }
    return null
  }

  const startAddBoxAt = (sideId: string, slotNumber: number) => {
    setBoxSideId(sideId)
    setBoxSlotNumber(String(slotNumber))
    setAddMode('box')
  }

  const handleBoxSlotClick = (sideId: string, slotNumber: number, box?: WmsCellItem) => {
    if (saving) return
    if (!movingBoxId) {
      if (box) {
        setMovingBoxId(box.id)
        setExpandedBoxIds((previous) => new Set([...previous, box.id]))
      } else {
        startAddBoxAt(sideId, slotNumber)
      }
      return
    }
    if (box?.id === movingBoxId) {
      setMovingBoxId(null)
      return
    }
    void handleMoveOrSwapBox(movingBoxId, sideId, slotNumber)
  }

  const XIcon = () => (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              Паллетоместо <span className="font-black">{cell.col}{cell.row}</span>
            </h2>
            <p className="text-xs text-slate-400">{zone.name}</p>
          </div>
          <button type="button" onClick={() => { onClose(); onRefresh() }} className="text-slate-400 hover:text-slate-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-6" style={{ maxHeight: '75vh' }}>
          {/* Status */}
          <div>
            <div className="mb-2 text-xs font-medium text-slate-600">Статус</div>
            <div className="flex gap-2">
              {(['free', 'occupied', 'reserved', 'disabled'] as const).map((s) => (
                <button key={s} type="button" onClick={() => void handleSetStatus(s)}
                  className={`flex-1 rounded-xl border py-2 text-xs font-medium transition ${internalStatus === s ? statusConfig[s].active : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                  {statusConfig[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* Physical box places by side */}
          {internalStatus !== 'disabled' && zoneSides.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">Места коробов</span>
                <span className={`text-[10px] ${movingBoxId ? 'font-medium text-violet-600' : 'text-slate-400'}`}>
                  {movingBoxId ? 'Выберите место: свободное — перенос, занятое — обмен' : 'Свободное — добавить короб, занятое — выбрать для переноса'}
                </span>
              </div>
              {movingBoxId && (
                <div className="mb-2 flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-700">
                  <span>Короб выбран. Его ШК, QR и содержимое при перемещении сохранятся.</span>
                  <button type="button" onClick={() => setMovingBoxId(null)} className="cursor-pointer font-semibold hover:text-violet-900">Отмена</button>
                </div>
              )}
              <div className="flex flex-col gap-2.5">
                {zoneSides.map((side) => {
                  const filled = boxes.filter((box) => box.side_id === side.id && box.slot_number).length
                  return (
                    <div key={side.id ?? side.code} className="rounded-xl border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">{side.name}</span>
                        <span className="text-[10px] text-slate-400">{filled} из {side.slot_count}</span>
                      </div>
                      <div className="mx-auto grid w-full max-w-xs gap-1.5 rounded-xl border-4 border-amber-200/70 bg-amber-50/40 p-2"
                        style={{ gridTemplateColumns: `repeat(${side.slot_columns}, minmax(0, 1fr))` }}>
                        {Array.from({ length: side.slot_count }, (_, index) => index + 1).map((slotNumber) => {
                          const box = side.id ? occupiedBoxSlots.get(`${side.id}-${slotNumber}`) : undefined
                          const isMoving = box?.id === movingBoxId
                          return (
                            <button key={slotNumber} type="button"
                              title={box ? `${side.name} · ${cell.col}${cell.row}-K${slotNumber} · ${box.box_name}` : `${side.name} · ${cell.col}${cell.row}-K${slotNumber}`}
                              onClick={() => side.id && handleBoxSlotClick(side.id, slotNumber, box)}
                              className={`flex h-11 cursor-pointer flex-col items-center justify-center rounded-md border text-[10px] font-semibold transition ${isMoving ? 'border-violet-500 bg-violet-100 text-violet-700 ring-2 ring-violet-200' : box ? 'border-amber-400 bg-amber-100 text-amber-800 hover:bg-amber-200' : movingBoxId ? 'border-violet-200 bg-white text-violet-500 hover:border-violet-400 hover:bg-violet-50' : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
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
                Содержимое ({internalItems.length})
              </span>
              {addMode === null && (
                <div className="flex gap-3">
                  <button type="button" onClick={() => setAddMode('item')} className="text-xs text-violet-600 hover:underline">+ Товар</button>
                  <button type="button" onClick={() => setAddMode('box')} className="text-xs text-amber-600 hover:underline">+ Короб</button>
                </div>
              )}
            </div>

            {internalItems.length === 0 && addMode === null && (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">Паллетоместо пусто</div>
            )}

            {/* Individual items */}
            {singleItems.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-xl border border-slate-100">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-500">Баркод</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-500">Наименование</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-500">Кол-во</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {singleItems.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-slate-600">{item.barcode || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{item.product_name || '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">{item.qty}</td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => void handleDeleteItem(item.id)} className="text-slate-300 hover:text-red-400">
                            <XIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Boxes */}
            {boxes.map((box) => {
              const isExpanded = expandedBoxIds.has(box.id)
              const totalUnits = box.contents.reduce((s, c) => s + c.qty_per_box * box.qty, 0)
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
                    <span className="flex-1 text-xs font-semibold text-slate-800">{box.box_name}</span>
                    {box.barcode && <span className="font-mono text-[10px] text-slate-400">{box.barcode}</span>}
                    <button type="button" title="Изменить место короба"
                      onClick={() => {
                        setAssigningBoxId(isAssigning ? null : box.id)
                        setAssignmentSideId(box.side_id ?? zoneSides[0]?.id ?? '')
                        setAssignmentSlotNumber(String(box.slot_number ?? firstFreeSlot(zoneSides[0]?.id ?? '') ?? 1))
                      }}
                      className={`cursor-pointer rounded-md px-1.5 py-1 text-[10px] ${box.side_id ? 'text-violet-600 hover:bg-violet-50' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                      {address}
                    </button>
                    {box.qty > 1 && <span className="text-xs text-slate-500">×{box.qty} кор.</span>}
                    {totalUnits > 0 && <span className="text-[10px] text-slate-400">({totalUnits} ед.)</span>}
                    <button type="button"
                      onClick={() => setExpandedBoxIds((prev) => { const n = new Set(prev); isExpanded ? n.delete(box.id) : n.add(box.id); return n })}
                      className="text-slate-400 hover:text-slate-600">
                      <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                    <button type="button" onClick={() => void handleDeleteItem(box.id)} className="text-slate-300 hover:text-red-400">
                      <XIcon />
                    </button>
                  </div>
                  {isAssigning && (
                    <div className="flex items-end gap-2 border-t border-amber-100 bg-white/70 px-3 py-2">
                      <label className="flex flex-1 flex-col gap-1 text-[10px] text-slate-400">
                        Сторона
                        <select value={assignmentSideId}
                          onChange={(event) => {
                            const sideId = event.target.value
                            setAssignmentSideId(sideId)
                            setAssignmentSlotNumber(String(firstFreeSlot(sideId) ?? 1))
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-violet-400">
                          {zoneSides.map((side) => <option key={side.id ?? side.code} value={side.id}>{side.name}</option>)}
                        </select>
                      </label>
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
                      {box.barcode && (
                        <div className="mb-2 flex items-center gap-2 rounded-lg bg-white/80 p-2">
                          <QRCodeSVG value={box.barcode} size={48} bgColor="transparent" />
                          <div>
                            <div className="text-[10px] text-slate-400">QR короба</div>
                            <div className="font-mono text-xs font-semibold text-slate-700">{box.barcode}</div>
                            <div className="mt-0.5 text-[10px] text-slate-400">{address}</div>
                          </div>
                        </div>
                      )}
                      {box.contents.length === 0 ? (
                        <p className="text-xs text-slate-400">Содержимое не указано</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-400">
                              <th className="pb-1 text-left font-normal">Баркод</th>
                              <th className="pb-1 text-left font-normal">Наименование</th>
                              <th className="pb-1 text-right font-normal">На короб</th>
                              <th className="pb-1 text-right font-normal">Итого</th>
                              <th className="w-5"/>
                            </tr>
                          </thead>
                          <tbody>
                            {box.contents.map((c) => (
                              <tr key={c.id} className="border-t border-amber-100">
                                <td className="py-1 pr-2 font-mono text-slate-600">{c.barcode || '—'}</td>
                                <td className="py-1 pr-2 text-slate-700">{c.product_name || '—'}</td>
                                <td className="py-1 pr-2 text-right text-slate-600">{c.qty_per_box} шт</td>
                                <td className="py-1 pr-1 text-right font-semibold text-slate-800">= {c.qty_per_box * box.qty}</td>
                                <td className="py-1">
                                  <button type="button" onClick={() => void handleDeleteBoxContent(box.id, c.id)} className="text-slate-300 hover:text-red-400">
                                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                    </svg>
                                  </button>
                                </td>
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

            {/* Add item form */}
            {addMode === 'item' && (
              <div className="mt-1 flex flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
                <div className="text-[11px] font-medium text-slate-600">Новый товар</div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} placeholder="Баркод" autoFocus
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-violet-400"/>
                  <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Наименование"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-violet-400"/>
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" value={newQty} onChange={(e) => setNewQty(e.target.value)} min={1} placeholder="Кол-во"
                    className="w-24 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-violet-400"/>
                  <button type="button" onClick={() => void handleAddItem()} disabled={!newBarcode.trim() || saving}
                    className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-50">
                    {saving ? '...' : 'Добавить'}
                  </button>
                  <button type="button" onClick={() => setAddMode(null)} className="text-xs text-slate-400 hover:text-slate-600">Отмена</button>
                </div>
              </div>
            )}

            {/* Add box form */}
            {addMode === 'box' && (
              <div className="mt-1 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/30 p-3">
                <div className="text-[11px] font-medium text-slate-600">Новый короб</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500">ШК / QR короба *</span>
                    <input type="text" value={boxBarcode} onChange={(e) => setBoxBarcode(e.target.value)} placeholder="Сканируйте код" autoFocus
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-amber-400"/>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500">Название</span>
                    <input type="text" value={boxName} onChange={(e) => setBoxName(e.target.value)} placeholder="Необязательно"
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-amber-400"/>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-[10px] text-slate-500">
                    Сторона *
                    <select value={boxSideId}
                      onChange={(event) => {
                        const sideId = event.target.value
                        setBoxSideId(sideId)
                        setBoxSlotNumber(String(firstFreeSlot(sideId) ?? 1))
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-amber-400">
                      {zoneSides.map((side) => <option key={side.id ?? side.code} value={side.id}>{side.name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] text-slate-500">
                    Место короба *
                    <select value={boxSlotNumber} onChange={(event) => setBoxSlotNumber(event.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-amber-400">
                      {Array.from({ length: selectedBoxSide?.slot_count ?? 0 }, (_, index) => index + 1).map((slotNumber) => {
                        const occupied = occupiedBoxSlots.has(`${boxSideId}-${slotNumber}`)
                        return <option key={slotNumber} value={slotNumber} disabled={occupied}>K{slotNumber}{occupied ? ' — занято' : ''}</option>
                      })}
                    </select>
                  </label>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Содержимое 1 короба</span>
                    <button type="button"
                      onClick={() => setBoxRows((prev) => [...prev, { tempId: String(Date.now()), barcode: '', product_name: '', qty_per_box: '1' }])}
                      className="text-[10px] text-violet-600 hover:underline">+ строку</button>
                  </div>
                  {boxRows.map((row, idx) => (
                    <div key={row.tempId} className="flex items-center gap-1">
                      <input type="text" value={row.barcode}
                        onChange={(e) => setBoxRows((prev) => prev.map((r, i) => i === idx ? { ...r, barcode: e.target.value } : r))}
                        placeholder="Баркод"
                        className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-amber-400"/>
                      <input type="text" value={row.product_name}
                        onChange={(e) => setBoxRows((prev) => prev.map((r, i) => i === idx ? { ...r, product_name: e.target.value } : r))}
                        placeholder="Наименование"
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-amber-400"/>
                      <input type="number" value={row.qty_per_box}
                        onChange={(e) => setBoxRows((prev) => prev.map((r, i) => i === idx ? { ...r, qty_per_box: e.target.value } : r))}
                        min={1} placeholder="шт/кор"
                        className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-amber-400"/>
                      {boxRows.length > 1 && (
                        <button type="button" onClick={() => setBoxRows((prev) => prev.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-400">
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void handleAddBox()} disabled={!boxBarcode.trim() || !boxSideId || saving || occupiedBoxSlots.has(`${boxSideId}-${boxSlotNumber}`)}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
                    {saving ? '...' : 'Сохранить короб'}
                  </button>
                  <button type="button" onClick={() => setAddMode(null)} className="text-xs text-slate-400 hover:text-slate-600">Отмена</button>
                </div>
              </div>
            )}
          </div>}
        </div>
      </div>
    </div>
  )
}

// ─── WmsPage ──────────────────────────────────────────────────────────────────

export function WmsPage({ accountId }: { accountId: string }) {
  const [warehouses, setWarehouses] = useState<WmsWarehouse[]>([])
  const [zonesByWarehouse, setZonesByWarehouse] = useState<Record<string, WmsZone[]>>({})
  const [cells, setCells] = useState<WmsCell[]>([])
  const [expandedWarehouseIds, setExpandedWarehouseIds] = useState<Set<string>>(new Set())
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [warehouseModal, setWarehouseModal] = useState<{ open: boolean; editing: WmsWarehouse | null }>({ open: false, editing: null })
  const [zoneModal, setZoneModal] = useState<{ open: boolean; editing: WmsZone | null; warehouseId: string }>({ open: false, editing: null, warehouseId: '' })
  const [selectedCellCoord, setSelectedCellCoord] = useState<{ col: string; row: number } | null>(null)

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
    const { data } = await (supabase as any)
      .from('wms_cells').select('*, items:wms_cell_items(*, contents:wms_box_contents(*))').eq('zone_id', zoneId)
    setCells((data ?? []).map((c: any) => ({ ...c, items: (c.items ?? []).map((i: any) => ({ ...i, contents: i.contents ?? [] })) })))
  }, [])

  useEffect(() => { void loadWarehouses() }, [loadWarehouses])

  // ── Derived state ─────────────────────────────────────────────────────────

  const selectedZone = Object.values(zonesByWarehouse).flat().find((z) => z.id === selectedZoneId) ?? null
  const grid = selectedZone ? generateGrid(selectedZone, cells) : []
  const currentCell = selectedCellCoord
    ? (grid.flat().find((c) => c.col === selectedCellCoord.col && c.row === selectedCellCoord.row) ?? null)
    : null

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelectWarehouse = async (id: string) => {
    const isExpanded = expandedWarehouseIds.has(id)
    if (isExpanded) {
      setExpandedWarehouseIds((prev) => { const next = new Set(prev); next.delete(id); return next })
    } else {
      setExpandedWarehouseIds((prev) => new Set([...prev, id]))
      if (!zonesByWarehouse[id]) await loadZones(id)
    }
  }

  const handleSelectZone = async (id: string) => {
    setSelectedZoneId(id); setCells([]); setSelectedCellCoord(null)
    await loadCells(id)
  }

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
    if (!supabase || !window.confirm('Удалить склад и все его стеллажи?')) return
    await (supabase as any).from('wms_warehouses').delete().eq('id', id)
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
          <button type="button" title="Создать склад"
            onClick={() => setWarehouseModal({ open: true, editing: null })}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-violet-600">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
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
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setWarehouseModal({ open: true, editing: wh }) }}
                    className="hidden h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-600 group-hover:flex">
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); void handleDeleteWarehouse(wh.id) }}
                    className="hidden h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-red-500 group-hover:flex">
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>

                {/* Zone list */}
                {expandedWarehouseIds.has(wh.id) && (
                  <div className="ml-5 border-l border-slate-100">
                    <button type="button"
                      onClick={() => setZoneModal({ open: true, editing: null, warehouseId: wh.id })}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-violet-600">
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Добавить стеллаж
                    </button>
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
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); setZoneModal({ open: true, editing: zone, warehouseId: wh.id }) }}
                          className="hidden h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-600 group-hover:flex">
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); void handleDeleteZone(zone.id) }}
                          className="hidden h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-red-500 group-hover:flex">
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
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
                {selectedZone.cols} паллетомест × {selectedZone.rows} ярусов · {normalizedZoneSides(selectedZone).length} сторон
              </span>
              <div className="ml-auto flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border border-emerald-300 bg-emerald-200" />
                  Свободна
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border border-red-300 bg-red-200" />
                  Занята
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border border-amber-300 bg-amber-200" />
                  Резерв
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border border-slate-300 bg-slate-200" />
                  Заглушена
                </span>
              </div>
            </div>

            {/* Excel-style grid */}
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
                          selectedCellCoord?.row === vcell.row
                        const totalQty = vcell.dbCell?.items.reduce((s, i) => s + i.qty, 0) ?? 0
                        return (
                          <td key={`${vcell.col}-${vcell.row}`} className={cellIndex > 0 && selectedZone.upright_after_cols.includes(cellIndex) ? 'border-l-[6px] border-slate-700 pl-1' : ''}>
                            <button
                              type="button"
                              title={`${vcell.col}${vcell.row}`}
                              onClick={() => setSelectedCellCoord({ col: vcell.col, row: vcell.row })}
                              className={`flex h-10 min-w-[52px] flex-col items-center justify-center rounded-lg border text-[10px] font-semibold leading-tight transition ${
                                isSelected ? 'ring-2 ring-violet-400 ring-offset-1' : ''
                              } ${
                                vcell.status === 'occupied'
                                  ? 'border-red-200 bg-red-100 text-red-700 hover:bg-red-200'
                                  : vcell.status === 'reserved'
                                  ? 'border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-200'
                                  : vcell.status === 'disabled'
                                  ? 'border-slate-300 bg-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                              }`}
                            >
                              <span className="text-[11px] font-bold">{vcell.col}{vcell.row}</span>
                              {vcell.status !== 'free' && totalQty > 0 && <span>{totalQty} ед.</span>}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
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
      {selectedCellCoord && currentCell && selectedZone && (
        <CellModal
          key={`${selectedCellCoord.col}-${selectedCellCoord.row}`}
          cell={currentCell}
          zone={selectedZone}
          accountId={accountId}
          zoneId={selectedZoneId!}
          onClose={() => setSelectedCellCoord(null)}
          onRefresh={() => { if (selectedZoneId) void loadCells(selectedZoneId) }}
        />
      )}
    </div>
  )
}
