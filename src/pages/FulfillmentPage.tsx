import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  FulfillmentBatch,
  FulfillmentBatchWithItems,
  FulfillmentItem,
  FulfillmentSettings,
  FulfillmentStage,
  Store,
  TripWithLines,
  TripLineFormValues,
} from '../types'
import {
  fetchBatches,
  fetchBatchWithItems,
  fetchFulfillmentSettings,
  upsertFulfillmentSettings,
  createBatch,
  updateBatch,
  deleteBatch,
  addItem,
  updateItem,
  deleteItem,
  advanceStage,
  lookupProductByBarcode,
  searchProducts,
} from '../services/fulfillmentService'
import type { CatalogProduct } from '../services/fulfillmentService'
import { Card } from '../components/ui/Card'
import { createStoreInSupabase } from '../services/storeService'

// ── Вспомогательные константы ─────────────────────────────────
const STAGE_LABELS: Record<FulfillmentStage, string> = {
  reception: 'Приёмка',
  otk: 'ОТК',
  marking: 'Маркировка',
  packing: 'Коробá',
  logistics: 'Логистика',
  done: 'Готово',
}

const STAGE_ORDER: FulfillmentStage[] = ['reception', 'otk', 'marking', 'packing', 'logistics', 'done']
type AddMode = 'barcode' | 'bulk' | 'subject' | 'catalog'

const STATUS_LABELS: Record<string, string> = {
  active: 'В работе',
  done: 'Завершена',
  cancelled: 'Отменена',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-blue-50 text-blue-700',
  done: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

// ── Props ─────────────────────────────────────────────────────
interface FulfillmentPageProps {
  accountId: string
  stores: Store[]
  trips: TripWithLines[]
  onEditTripLine: (tripId: string, lineId: string, values: TripLineFormValues) => Promise<void>
  onStoreCreated?: (store: Store) => void
  canManage?: boolean
}

// ── Helpers ───────────────────────────────────────────────────
const todayName = () => {
  const d = new Date()
  return `Партия ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
}

const getEnabledStages = (batch: FulfillmentBatch): FulfillmentStage[] => {
  return STAGE_ORDER.filter((s) => {
    if (s === 'reception' || s === 'done') return true
    if (s === 'otk') return batch.stage_otk
    if (s === 'marking') return batch.stage_marking
    if (s === 'packing') return batch.stage_packing
    if (s === 'logistics') return batch.stage_logistics
    return false
  })
}

const sumField = (items: FulfillmentItem[], field: keyof FulfillmentItem) =>
  items.reduce((sum, i) => sum + ((i[field] as number | null) ?? 0), 0)

// ══════════════════════════════════════════════════════════════
// StageQtyTable — универсальная таблица для ОТК/Маркировки
// ══════════════════════════════════════════════════════════════
interface StageQtyTableProps {
  items: FulfillmentItem[]
  label: string
  sourceField: keyof FulfillmentItem
  sourceLabel: string
  draft: Record<string, { qty: number; boxes?: number }>
  onDraftChange: (id: string, qty: number) => void
  canManage: boolean
}

const StageQtyTable = ({ items, label, sourceField, sourceLabel, draft, onDraftChange, canManage }: StageQtyTableProps) => (
  <div className="space-y-3">
    <p className="text-sm font-medium text-slate-600">Укажите количество после этапа «{label}».</p>
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5 text-left">Наименование</th>
            <th className="px-4 py-2.5 text-left">Баркод</th>
            <th className="px-3 py-2.5 text-center">{sourceLabel}</th>
            <th className="px-3 py-2.5 text-center">{label}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((it) => {
            const sourceQty = (it[sourceField] as number | null) ?? 0
            return (
              <tr key={it.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-700">{it.product_name ?? <span className="text-slate-300">—</span>}</p>
                  {it.size && <p className="text-xs text-slate-400">{it.size}</p>}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{it.barcode}</td>
                <td className="px-3 py-2.5 text-center text-slate-500">{sourceQty}</td>
                <td className="px-3 py-2.5 text-center">
                  {canManage ? (
                    <input
                      type="number"
                      min={0}
                      value={draft[it.id]?.qty ?? sourceQty}
                      onChange={(e) => onDraftChange(it.id, Number(e.target.value))}
                      className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-300"
                    />
                  ) : (
                    <span className="font-medium text-slate-800">{draft[it.id]?.qty ?? sourceQty}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-semibold">
          <tr>
            <td colSpan={3} className="px-4 py-2.5 text-slate-500">Итого</td>
            <td className="px-3 py-2.5 text-center text-slate-800">
              {Object.values(draft).reduce((s, v) => s + v.qty, 0)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
)

// ── SummaryCard ───────────────────────────────────────────────
const SummaryCard = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-center">
    <p className="text-2xl font-bold text-slate-800">{value}</p>
    <p className="text-xs text-slate-400">{label}</p>
  </div>
)

// ══════════════════════════════════════════════════════════════
// BatchDetailModal
// ══════════════════════════════════════════════════════════════
interface DetailModalProps {
  batch: FulfillmentBatchWithItems
  accountId: string
  stores: Store[]
  trips: TripWithLines[]
  canManage: boolean
  onClose: () => void
  onBatchUpdated: (b: FulfillmentBatch) => void
  onItemsChanged: (items: FulfillmentItem[]) => void
  onEditTripLine: (tripId: string, lineId: string, values: TripLineFormValues) => Promise<void>
}

const BatchDetailModal = ({
  batch: initialBatch,
  accountId,
  stores,
  trips,
  canManage,
  onClose,
  onBatchUpdated,
  onItemsChanged,
  onEditTripLine,
}: DetailModalProps) => {
  const [batch, setBatch] = useState<FulfillmentBatchWithItems>(initialBatch)
  const [items, setItems] = useState<FulfillmentItem[]>(initialBatch.items)
  const [isSavingStage, setIsSavingStage] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Приёмка: режим добавления
  const [addMode, setAddMode] = useState<AddMode>('barcode')

  // Режим «По баркоду»
  const [newBarcode, setNewBarcode] = useState('')
  const [newQty, setNewQty] = useState(1)
  const [newName, setNewName] = useState('')
  const [newSize, setNewSize] = useState('')
  const [isLooking, setIsLooking] = useState(false)
  const [isAddingSaving, setIsAddingSaving] = useState(false)
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  // Режим «Навалом»
  const [bulkQty, setBulkQty] = useState(1)
  const [bulkNote, setBulkNote] = useState('')

  // Режим «По предмету»
  const [subjectName, setSubjectName] = useState('')
  const [subjectQty, setSubjectQty] = useState(1)

  // Режим «Из каталога»
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogResults, setCatalogResults] = useState<CatalogProduct[]>([])
  const [catalogQties, setCatalogQties] = useState<Record<string, number>>({})
  const [isSearching, setIsSearching] = useState(false)

  // Редактирование этапов партии
  const [editStagesOpen, setEditStagesOpen] = useState(false)
  const [isSavingBatchStages, setIsSavingBatchStages] = useState(false)

  // Черновики для ОТК/Маркировки/Коробов
  const [stageDraft, setStageDraft] = useState<Record<string, { qty: number; boxes?: number }>>({})

  // Логистика
  const [selectedTripId, setSelectedTripId] = useState('')
  const [selectedLineId, setSelectedLineId] = useState('')
  const [isLinkingLogistics, setIsLinkingLogistics] = useState(false)

  const store = stores.find((s) => s.id === batch.store_id)
  const enabledStages = getEnabledStages(batch)
  const currentIdx = enabledStages.indexOf(batch.current_stage)

  // Инициализировать черновики при смене этапа
  useEffect(() => {
    const draft: Record<string, { qty: number; boxes?: number }> = {}
    items.forEach((it) => {
      if (batch.current_stage === 'otk') {
        draft[it.id] = { qty: it.qty_otk ?? it.qty_received }
      } else if (batch.current_stage === 'marking') {
        draft[it.id] = { qty: it.qty_marked ?? it.qty_otk ?? it.qty_received }
      } else if (batch.current_stage === 'packing') {
        draft[it.id] = { qty: it.qty_packed ?? it.qty_marked ?? it.qty_otk ?? it.qty_received, boxes: it.boxes ?? 0 }
      }
    })
    setStageDraft(draft)
  }, [batch.current_stage, items])

  // Автолукап по баркоду
  const handleBarcodeChange = useCallback(async (barcode: string) => {
    setNewBarcode(barcode)
    if (barcode.length < 8 || !store?.api_key) return
    setIsLooking(true)
    try {
      const found = await lookupProductByBarcode(accountId, batch.store_id, barcode)
      if (found) {
        setNewName(found.name ?? '')
        setNewSize(found.size ?? '')
      }
    } finally {
      setIsLooking(false)
    }
  }, [accountId, batch.store_id, store?.api_key])

  // Добавить позицию
  const handleAddItem = async () => {
    if (!newBarcode.trim() || newQty < 1) return
    setIsAddingSaving(true)
    setError(null)
    try {
      const item = await addItem({
        batch_id: batch.id,
        barcode: newBarcode.trim(),
        product_name: newName.trim() || null,
        size: newSize.trim() || null,
        article: null,
        qty_received: newQty,
        qty_otk: null,
        qty_marked: null,
        qty_packed: null,
        boxes: null,
        notes: null,
        sort_order: items.length,
      })
      const next = [...items, item]
      setItems(next)
      onItemsChanged(next)
      setNewBarcode(''); setNewQty(1); setNewName(''); setNewSize('')
      barcodeInputRef.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsAddingSaving(false)
    }
  }

  const handleDeleteItem = async (id: string) => {
    try {
      await deleteItem(id)
      const next = items.filter((i) => i.id !== id)
      setItems(next)
      onItemsChanged(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    }
  }

  const handleUpdateReceived = async (id: string, qty: number) => {
    try {
      const updated = await updateItem(id, { qty_received: qty })
      const next = items.map((i) => (i.id === id ? updated : i))
      setItems(next)
      onItemsChanged(next)
    } catch { /* silent */ }
  }

  // Режим «Навалом»
  const handleBulkAdd = async () => {
    if (bulkQty < 1) return
    setIsAddingSaving(true)
    setError(null)
    try {
      const item = await addItem({
        batch_id: batch.id,
        barcode: `bulk_${Date.now()}`,
        product_name: bulkNote.trim() || 'Общая партия',
        size: null,
        article: null,
        qty_received: bulkQty,
        qty_otk: null,
        qty_marked: null,
        qty_packed: null,
        boxes: null,
        notes: null,
        sort_order: items.length,
      })
      const next = [...items, item]
      setItems(next)
      onItemsChanged(next)
      setBulkQty(1); setBulkNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsAddingSaving(false)
    }
  }

  // Режим «По предмету»
  const handleSubjectAdd = async () => {
    if (!subjectName.trim() || subjectQty < 1) return
    setIsAddingSaving(true)
    setError(null)
    try {
      const item = await addItem({
        batch_id: batch.id,
        barcode: `subj_${Date.now()}`,
        product_name: subjectName.trim(),
        size: null,
        article: null,
        qty_received: subjectQty,
        qty_otk: null,
        qty_marked: null,
        qty_packed: null,
        boxes: null,
        notes: null,
        sort_order: items.length,
      })
      const next = [...items, item]
      setItems(next)
      onItemsChanged(next)
      setSubjectName(''); setSubjectQty(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsAddingSaving(false)
    }
  }

  // Режим «Из каталога» — поиск
  const handleCatalogSearch = async (q: string) => {
    setCatalogSearch(q)
    if (q.trim().length < 2) { setCatalogResults([]); return }
    setIsSearching(true)
    try {
      const results = await searchProducts(accountId, batch.store_id, q)
      setCatalogResults(results)
    } finally {
      setIsSearching(false)
    }
  }

  // Режим «Из каталога» — добавить позицию
  const handleCatalogAdd = async (product: CatalogProduct, sizeIdx?: number) => {
    const key = sizeIdx !== undefined ? `${product.id}_${sizeIdx}` : product.id
    const qty = catalogQties[key] ?? 0
    if (qty < 1) return
    const sz = sizeIdx !== undefined ? product.sizes[sizeIdx] : undefined
    const barcode = sz?.skus?.[0] ?? product.barcodes[0] ?? `cat_${Date.now()}`
    const size = sz?.techSize ?? null
    setIsAddingSaving(true)
    setError(null)
    try {
      const item = await addItem({
        batch_id: batch.id,
        barcode,
        product_name: product.name ?? product.vendor_code ?? 'Товар',
        size,
        article: product.vendor_code ?? null,
        qty_received: qty,
        qty_otk: null,
        qty_marked: null,
        qty_packed: null,
        boxes: null,
        notes: null,
        sort_order: items.length,
      })
      const next = [...items, item]
      setItems(next)
      onItemsChanged(next)
      setCatalogQties((prev) => { const n = { ...prev }; delete n[key]; return n })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsAddingSaving(false)
    }
  }

  // Изменить этапы партии (только будущие этапы)
  const handleToggleBatchStage = async (
    stage: 'stage_otk' | 'stage_marking' | 'stage_packing' | 'stage_logistics',
    value: boolean,
  ) => {
    setIsSavingBatchStages(true)
    try {
      const updated = await updateBatch(batch.id, { [stage]: value })
      const newBatch = { ...batch, ...updated }
      setBatch(newBatch)
      onBatchUpdated(updated)
    } finally {
      setIsSavingBatchStages(false)
    }
  }

  // Сохранить черновик и перейти к следующему этапу
  const handleSaveStageAndAdvance = async () => {
    setIsSavingStage(true)
    setError(null)
    try {
      for (const [id, val] of Object.entries(stageDraft)) {
        if (batch.current_stage === 'otk') await updateItem(id, { qty_otk: val.qty })
        else if (batch.current_stage === 'marking') await updateItem(id, { qty_marked: val.qty })
        else if (batch.current_stage === 'packing') await updateItem(id, { qty_packed: val.qty, boxes: val.boxes ?? 0 })
      }
      const refreshed = await fetchBatchWithItems(batch.id)
      setItems(refreshed.items)
      onItemsChanged(refreshed.items)
      const updated = await advanceStage(batch)
      const newBatch = { ...batch, ...updated }
      setBatch(newBatch)
      onBatchUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSavingStage(false)
    }
  }

  const handleCompleteReception = async () => {
    if (items.length === 0) { setError('Добавьте хотя бы одну позицию'); return }
    setIsSavingStage(true)
    setError(null)
    try {
      const updated = await advanceStage(batch)
      const newBatch = { ...batch, ...updated }
      setBatch(newBatch)
      onBatchUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSavingStage(false)
    }
  }

  const handleLinkLogistics = async () => {
    if (!selectedTripId || !selectedLineId) return
    const trip = trips.find((t) => t.id === selectedTripId)
    const line = trip?.lines.find((l) => l.id === selectedLineId)
    if (!trip || !line) return
    setIsLinkingLogistics(true)
    setError(null)
    try {
      const tBoxes = sumField(items, 'boxes')
      const tPacked = sumField(items, 'qty_packed')
      const tReceived = sumField(items, 'qty_received')
      await onEditTripLine(selectedTripId, selectedLineId, {
        ...line,
        box_qty: tBoxes || line.box_qty,
        units_qty: tPacked || tReceived || line.units_qty,
        units_total: line.units_total,
        arrived_box_qty: line.arrived_box_qty,
        weight: line.weight ?? 0,
        planned_marketplace_delivery_date: line.planned_marketplace_delivery_date ?? '',
        arrival_date: line.arrival_date ?? '',
        reception_date: line.reception_date ?? '',
        shipped_date: line.shipped_date ?? '',
        status: line.status,
        payment_status: line.payment_status,
        comment: line.comment,
        store_id: line.store_id,
        destination_warehouse: line.destination_warehouse,
      })
      await updateBatch(batch.id, { trip_line_id: selectedLineId })
      const updated = await advanceStage({ ...batch, trip_line_id: selectedLineId })
      const newBatch = { ...batch, ...updated, trip_line_id: selectedLineId }
      setBatch(newBatch)
      onBatchUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при привязке')
    } finally {
      setIsLinkingLogistics(false)
    }
  }

  const tBoxes = sumField(items, 'boxes')
  const tPacked = sumField(items, 'qty_packed')
  const tReceived = sumField(items, 'qty_received')

  const nextStageName = enabledStages[currentIdx + 1]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 border-b border-slate-100 px-6 py-4">
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-widest text-slate-400">Партия</p>
            <p className="text-lg font-semibold text-slate-800">{batch.name}</p>
            {store && <p className="text-sm text-slate-400">{store.name}</p>}
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[batch.status]}`}>
            {STATUS_LABELS[batch.status]}
          </span>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-2xl text-slate-400 hover:bg-slate-100">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stage progress */}
        <div className={`px-6 py-4 ${editStagesOpen ? '' : 'border-b border-slate-100'}`}>
          <div className="flex items-center">
            {enabledStages.filter((s) => s !== 'done').map((s, idx, arr) => {
              const stageIdx = enabledStages.indexOf(s)
              const isDone = currentIdx > stageIdx
              const isCurrent = batch.current_stage === s
              const isLast = idx === arr.length - 1
              return (
                <div key={s} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold
                      ${isDone ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-blue-600 text-white ring-4 ring-blue-100' : 'bg-slate-100 text-slate-400'}`}>
                      {isDone ? (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : idx + 1}
                    </div>
                    <span className={`mt-1 text-[10px] font-medium ${isCurrent ? 'text-blue-600' : isDone ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {STAGE_LABELS[s]}
                    </span>
                  </div>
                  {!isLast && <div className={`mb-4 mx-1 h-0.5 flex-1 ${isDone ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
                </div>
              )
            })}
          </div>
          {canManage && batch.status === 'active' && (
            <div className="mt-1.5 flex justify-end">
              <button type="button" onClick={() => setEditStagesOpen((v) => !v)}
                className={`flex items-center gap-1 text-[11px] transition-colors ${editStagesOpen ? 'text-blue-500' : 'text-slate-400 hover:text-blue-500'}`}>
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                Настроить этапы
                <svg viewBox="0 0 24 24" className={`h-3 w-3 transition-transform ${editStagesOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Редактирование этапов */}
        {editStagesOpen && canManage && batch.status === 'active' && (
          <div className="border-b border-slate-100 bg-slate-50/60 px-6 py-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Этапы этой партии</p>
              {(['otk', 'marking', 'packing', 'logistics'] as const).map((stageName) => {
                const keyMap = { otk: 'stage_otk', marking: 'stage_marking', packing: 'stage_packing', logistics: 'stage_logistics' } as const
                const key = keyMap[stageName]
                const value = batch[key]
                const isPast = STAGE_ORDER.indexOf(stageName) <= STAGE_ORDER.indexOf(batch.current_stage)
                return (
                  <label key={stageName} className={`flex items-center gap-2 ${isPast ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
                    <button type="button"
                      disabled={isPast || isSavingBatchStages}
                      onClick={() => !isPast && void handleToggleBatchStage(key, !value)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-blue-500' : 'bg-slate-200'}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-sm text-slate-600">{STAGE_LABELS[stageName]}</span>
                    {isPast && <span className="text-[10px] text-slate-300">(пройден)</span>}
                  </label>
                )
              })}
              {isSavingBatchStages && <span className="text-xs text-slate-400">Сохранение…</span>}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <div className="mb-4 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>}

          {/* ПРИЁМКА */}
          {batch.current_stage === 'reception' && (
            <div className="space-y-4">

              {/* Переключатель режимов */}
              {canManage && (
                <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-0.5 w-fit">
                  {([
                    ['barcode', 'По баркоду'],
                    ['bulk', 'Навалом'],
                    ['subject', 'По предмету'],
                    ['catalog', 'Из каталога'],
                  ] as [AddMode, string][]).map(([mode, label]) => (
                    <button key={mode} type="button" onClick={() => setAddMode(mode)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${addMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Режим: По баркоду */}
              {canManage && addMode === 'barcode' && (
                <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-slate-50 p-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Баркод *</span>
                    <input ref={barcodeInputRef} type="text" value={newBarcode}
                      onChange={(e) => void handleBarcodeChange(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleAddItem() }}
                      placeholder="Сканируй или введи"
                      className="w-44 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Наименование{isLooking ? ' ⟳' : ''}
                      {store?.api_key && <span className="ml-1 normal-case font-normal text-blue-400">авто</span>}
                    </span>
                    <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                      placeholder="Авто или введи"
                      className="w-48 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Размер</span>
                    <input type="text" value={newSize} onChange={(e) => setNewSize(e.target.value)}
                      placeholder="L / XL / 42"
                      className="w-24 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Кол-во *</span>
                    <input type="number" min={1} value={newQty} onChange={(e) => setNewQty(Number(e.target.value))}
                      className="w-20 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <button type="button" onClick={() => void handleAddItem()}
                    disabled={isAddingSaving || !newBarcode.trim()}
                    className="flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                    Добавить
                  </button>
                </div>
              )}

              {/* Режим: Навалом */}
              {canManage && addMode === 'bulk' && (
                <div className="rounded-2xl bg-slate-50 p-3 space-y-2">
                  <p className="text-xs text-slate-400">Общее количество без разбивки по позициям. Подходит, если детали неважны на этом этапе.</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Кол-во единиц *</span>
                      <input type="number" min={1} value={bulkQty} onChange={(e) => setBulkQty(Number(e.target.value))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleBulkAdd() }}
                        className="w-28 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Примечание</span>
                      <input type="text" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleBulkAdd() }}
                        placeholder="Необязательно"
                        className="w-56 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                    <button type="button" onClick={() => void handleBulkAdd()}
                      disabled={isAddingSaving || bulkQty < 1}
                      className="flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                      Добавить
                    </button>
                  </div>
                </div>
              )}

              {/* Режим: По предмету */}
              {canManage && addMode === 'subject' && (
                <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-slate-50 p-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Предмет / Категория *</span>
                    <input type="text" value={subjectName} onChange={(e) => setSubjectName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSubjectAdd() }}
                      placeholder="Шорты / Джинсы карго / Футболка"
                      className="w-64 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Кол-во *</span>
                    <input type="number" min={1} value={subjectQty} onChange={(e) => setSubjectQty(Number(e.target.value))}
                      className="w-24 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <button type="button" onClick={() => void handleSubjectAdd()}
                    disabled={isAddingSaving || !subjectName.trim()}
                    className="flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                    Добавить
                  </button>
                </div>
              )}

              {/* Режим: Из каталога */}
              {canManage && addMode === 'catalog' && (
                <div className="space-y-3">
                  {!store?.api_key ? (
                    <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                      У магазина нет API-ключа — каталог недоступен. Сначала выберите магазин с ключом при создании партии.
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <input type="text" value={catalogSearch}
                          onChange={(e) => void handleCatalogSearch(e.target.value)}
                          placeholder="Поиск по названию или артикулу WB..."
                          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                        />
                        {isSearching && <span className="text-xs text-slate-400">⟳</span>}
                      </div>
                      {catalogResults.length > 0 && (
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                          {catalogResults.map((product) => (
                            <div key={product.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                              <div className="mb-2">
                                <p className="text-sm font-medium text-slate-800 line-clamp-1">{product.name ?? product.vendor_code ?? 'Товар'}</p>
                                {product.vendor_code && <p className="text-xs text-slate-400">{product.vendor_code}</p>}
                              </div>
                              <div className="space-y-1">
                                {product.sizes && product.sizes.length > 0
                                  ? product.sizes.map((sz, sIdx) => {
                                      const key = `${product.id}_${sIdx}`
                                      return (
                                        <div key={key} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5">
                                          <span className="w-10 text-xs font-semibold text-slate-600">{sz.techSize ?? '—'}</span>
                                          <span className="flex-1 font-mono text-[11px] text-slate-400 truncate">{sz.skus?.[0] ?? '—'}</span>
                                          <input type="number" min={0} value={catalogQties[key] ?? 0}
                                            onChange={(e) => setCatalogQties((p) => ({ ...p, [key]: Number(e.target.value) }))}
                                            className="w-14 rounded-lg border border-slate-200 px-2 py-0.5 text-center text-xs outline-none focus:border-blue-300"
                                          />
                                          <button type="button" onClick={() => void handleCatalogAdd(product, sIdx)}
                                            disabled={isAddingSaving || (catalogQties[key] ?? 0) < 1}
                                            className="rounded-lg bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed">
                                            + Добавить
                                          </button>
                                        </div>
                                      )
                                    })
                                  : (
                                    <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5">
                                      <span className="flex-1 font-mono text-[11px] text-slate-400 truncate">{product.barcodes[0] ?? '—'}</span>
                                      <input type="number" min={0} value={catalogQties[product.id] ?? 0}
                                        onChange={(e) => setCatalogQties((p) => ({ ...p, [product.id]: Number(e.target.value) }))}
                                        className="w-14 rounded-lg border border-slate-200 px-2 py-0.5 text-center text-xs outline-none focus:border-blue-300"
                                      />
                                      <button type="button" onClick={() => void handleCatalogAdd(product)}
                                        disabled={isAddingSaving || (catalogQties[product.id] ?? 0) < 1}
                                        className="rounded-lg bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed">
                                        + Добавить
                                      </button>
                                    </div>
                                  )
                                }
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {catalogSearch.length >= 2 && !isSearching && catalogResults.length === 0 && (
                        <div className="rounded-2xl border-2 border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
                          Товары не найдены
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Таблица добавленных позиций */}
              {items.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 text-left">Баркод</th>
                        <th className="px-4 py-2.5 text-left">Наименование</th>
                        <th className="px-4 py-2.5 text-left">Размер</th>
                        <th className="px-3 py-2.5 text-center">Принято</th>
                        {canManage && <th className="px-3 py-2.5" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((it) => (
                        <tr key={it.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{it.barcode}</td>
                          <td className="px-4 py-2.5 text-slate-700">{it.product_name ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-500">{it.size ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-3 py-2.5 text-center">
                            {canManage ? (
                              <input type="number" min={0} value={it.qty_received}
                                onChange={(e) => void handleUpdateReceived(it.id, Number(e.target.value))}
                                className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-300"
                              />
                            ) : <span className="font-medium">{it.qty_received}</span>}
                          </td>
                          {canManage && (
                            <td className="px-3 py-2.5 text-center">
                              <button type="button" onClick={() => void handleDeleteItem(it.id)} className="text-slate-300 hover:text-red-400">
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 6 6 18M6 6l12 12" />
                                </svg>
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                      <tr>
                        <td colSpan={3} className="px-4 py-2.5 text-sm text-slate-500">Итого</td>
                        <td className="px-3 py-2.5 text-center text-slate-800">{tReceived}</td>
                        {canManage && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
                  Нет позиций — добавьте товар выше
                </div>
              )}
            </div>
          )}

          {/* ОТК */}
          {batch.current_stage === 'otk' && (
            <StageQtyTable items={items} label="ОТК" sourceField="qty_received" sourceLabel="Принято"
              draft={stageDraft} onDraftChange={(id, qty) => setStageDraft((p) => ({ ...p, [id]: { ...p[id], qty } }))}
              canManage={canManage} />
          )}

          {/* МАРКИРОВКА */}
          {batch.current_stage === 'marking' && (
            <StageQtyTable items={items} label="Маркировка" sourceField="qty_otk" sourceLabel="После ОТК"
              draft={stageDraft} onDraftChange={(id, qty) => setStageDraft((p) => ({ ...p, [id]: { ...p[id], qty } }))}
              canManage={canManage} />
          )}

          {/* ФОРМИРОВАНИЕ КОРОБОВ */}
          {batch.current_stage === 'packing' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Укажите количество единиц и коробов для каждой позиции.</p>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Наименование</th>
                      <th className="px-4 py-2.5 text-left">Баркод</th>
                      <th className="px-3 py-2.5 text-center">До этапа</th>
                      <th className="px-3 py-2.5 text-center">В коробах</th>
                      <th className="px-3 py-2.5 text-center">Коробов</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((it) => {
                      const prev = it.qty_marked ?? it.qty_otk ?? it.qty_received
                      return (
                        <tr key={it.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-slate-700">{it.product_name ?? <span className="text-slate-300">—</span>}</p>
                            {it.size && <p className="text-xs text-slate-400">{it.size}</p>}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{it.barcode}</td>
                          <td className="px-3 py-2.5 text-center text-slate-500">{prev}</td>
                          <td className="px-3 py-2.5 text-center">
                            {canManage ? (
                              <input type="number" min={0} value={stageDraft[it.id]?.qty ?? prev}
                                onChange={(e) => setStageDraft((p) => ({ ...p, [it.id]: { ...p[it.id], qty: Number(e.target.value) } }))}
                                className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-300"
                              />
                            ) : <span>{stageDraft[it.id]?.qty ?? prev}</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {canManage ? (
                              <input type="number" min={0} value={stageDraft[it.id]?.boxes ?? 0}
                                onChange={(e) => setStageDraft((p) => ({ ...p, [it.id]: { ...p[it.id], boxes: Number(e.target.value) } }))}
                                className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-300"
                              />
                            ) : <span>{stageDraft[it.id]?.boxes ?? 0}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                    <tr>
                      <td colSpan={3} className="px-4 py-2.5 text-sm text-slate-500">Итого</td>
                      <td className="px-3 py-2.5 text-center text-slate-800">{Object.values(stageDraft).reduce((s, v) => s + v.qty, 0)}</td>
                      <td className="px-3 py-2.5 text-center text-slate-800">{Object.values(stageDraft).reduce((s, v) => s + (v.boxes ?? 0), 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ПЕРЕДАЧА НА ЛОГИСТИКУ */}
          {batch.current_stage === 'logistics' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <SummaryCard label="Позиций" value={items.length} />
                <SummaryCard label="Коробов" value={tBoxes} />
                <SummaryCard label="Единиц" value={tPacked || tReceived} />
              </div>
              <p className="text-sm text-slate-500">Привяжите партию к строке поставки в рейсе — объём обновится автоматически.</p>

              {trips.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-500">Рейс</label>
                    <select value={selectedTripId} onChange={(e) => { setSelectedTripId(e.target.value); setSelectedLineId('') }}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100">
                      <option value="">— выберите рейс —</option>
                      {trips.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.trip_number}{t.carrier ? ` • ${t.carrier}` : ''}{t.departure_date ? ` (${new Date(t.departure_date).toLocaleDateString('ru-RU')})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedTripId && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-slate-500">Поставка</label>
                      <select value={selectedLineId} onChange={(e) => setSelectedLineId(e.target.value)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100">
                        <option value="">— выберите поставку —</option>
                        {trips.find((t) => t.id === selectedTripId)?.lines.map((l) => {
                          const ls = stores.find((s) => s.id === l.store_id)
                          return (
                            <option key={l.id} value={l.id}>
                              {ls?.name ?? '?'} — Поставка #{l.shipment_number} ({l.box_qty} коробов, {l.units_qty} ед.)
                            </option>
                          )
                        })}
                      </select>
                    </div>
                  )}
                  {selectedLineId && (
                    <div className="rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
                      Будет обновлено: <strong>{tBoxes}</strong> коробов, <strong>{tPacked || tReceived}</strong> единиц
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
                  Нет рейсов. Сначала создайте рейс в разделе Логистика.
                </div>
              )}

              {batch.trip_line_id && (
                <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Партия уже привязана к поставке
                </div>
              )}
            </div>
          )}

          {/* ГОТОВО */}
          {batch.current_stage === 'done' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <SummaryCard label="Позиций" value={items.length} />
                <SummaryCard label="Коробов" value={tBoxes} />
                <SummaryCard label="Единиц" value={tPacked || tReceived} />
              </div>
              <div className="rounded-2xl bg-emerald-50 px-5 py-6 text-center">
                <svg viewBox="0 0 24 24" className="mx-auto mb-2 h-8 w-8 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <p className="font-semibold text-emerald-700">Партия завершена</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {canManage && batch.current_stage !== 'done' && (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
            <span className="text-sm text-slate-400">
              Этап {Math.max(1, currentIdx + 1)} из {enabledStages.filter((s) => s !== 'done').length}
            </span>
            <div className="flex items-center gap-3">
              {batch.current_stage === 'reception' && (
                <button type="button" onClick={() => void handleCompleteReception()}
                  disabled={isSavingStage || items.length === 0}
                  className="flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {isSavingStage ? 'Сохранение…' : nextStageName === 'done' ? 'Завершить партию' : `Перейти к ${STAGE_LABELS[nextStageName ?? 'done']}`}
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              {(batch.current_stage === 'otk' || batch.current_stage === 'marking' || batch.current_stage === 'packing') && (
                <button type="button" onClick={() => void handleSaveStageAndAdvance()}
                  disabled={isSavingStage}
                  className="flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {isSavingStage ? 'Сохранение…' : `Завершить ${STAGE_LABELS[batch.current_stage]}`}
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              {batch.current_stage === 'logistics' && (
                <button type="button" onClick={() => void handleLinkLogistics()}
                  disabled={isLinkingLogistics || (!selectedLineId && !batch.trip_line_id)}
                  className="flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {isLinkingLogistics ? 'Сохранение…' : 'Передать в логистику'}
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// EditBatchModal
// ══════════════════════════════════════════════════════════════
interface EditBatchModalProps {
  batch: FulfillmentBatch
  stores: Store[]
  onClose: () => void
  onSave: (values: {
    name: string
    store_id: string | null
    stage_otk: boolean
    stage_marking: boolean
    stage_packing: boolean
    stage_logistics: boolean
  }) => Promise<void>
}

const EditBatchModal = ({ batch, stores, onClose, onSave }: EditBatchModalProps) => {
  const [name, setName] = useState(batch.name)
  const [storeId, setStoreId] = useState(batch.store_id ?? '')
  const [stageOtk, setStageOtk] = useState(batch.stage_otk)
  const [stageMarking, setStageMarking] = useState(batch.stage_marking)
  const [stagePacking, setStagePacking] = useState(batch.stage_packing)
  const [stageLogistics, setStageLogistics] = useState(batch.stage_logistics)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // store picker modal
  const [pickStoreOpen, setPickStoreOpen] = useState(false)
  const [storeSearch, setStoreSearch] = useState('')
  const [pickedTmp, setPickedTmp] = useState(batch.store_id ?? '')

  const filteredStores = stores.filter((s) => {
    if (!storeSearch) return true
    const q = storeSearch.toLowerCase()
    return s.name.toLowerCase().includes(q) || (s.store_code ?? '').toLowerCase().includes(q)
  })

  const storeLabel = () => {
    if (!storeId) return null
    const s = stores.find((x) => x.id === storeId)
    if (!s) return null
    return s.store_code ? `${s.name}  ·  ${s.store_code}` : s.name
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Введите название'); return }
    setIsSaving(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), store_id: storeId || null, stage_otk: stageOtk, stage_marking: stageMarking, stage_packing: stagePacking, stage_logistics: stageLogistics })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
      setIsSaving(false)
    }
  }

  const StageToggle = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
    <label className="flex cursor-pointer items-center gap-3">
      <button type="button" onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${value ? 'bg-blue-500' : 'bg-slate-200'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
      </button>
      <span className={`text-sm ${value ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-50">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </div>
          <p className="text-base font-semibold text-slate-800">Редактировать партию</p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6 p-8">
          {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Название</label>
            <input autoFocus type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Магазин (опционально)</label>
            <button type="button" onClick={() => { setPickedTmp(storeId); setStoreSearch(''); setPickStoreOpen(true) }}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none hover:border-blue-300 focus:border-blue-300 focus:ring-2 focus:ring-blue-100">
              <span className={storeId ? 'text-slate-800' : 'text-slate-400'}>{storeLabel() ?? 'Выбор магазина'}</span>
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
            </button>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Этапы этой партии</p>
            <div className="rounded-2xl bg-slate-50 p-4 space-y-3">
              <div className="flex items-center gap-3 opacity-40">
                <div className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-blue-500">
                  <span className="inline-block h-5 w-5 translate-x-[22px] rounded-full bg-white shadow" />
                </div>
                <span className="text-sm text-slate-700">Приёмка (всегда включена)</span>
              </div>
              <StageToggle label="ОТК" value={stageOtk} onChange={setStageOtk} />
              <StageToggle label="Маркировка" value={stageMarking} onChange={setStageMarking} />
              <StageToggle label="Формирование коробов" value={stagePacking} onChange={setStagePacking} />
              <StageToggle label="Передача на логистику" value={stageLogistics} onChange={setStageLogistics} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">Отмена</button>
            <button type="submit" disabled={isSaving} className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {isSaving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>

      {/* Pick store modal */}
      {pickStoreOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); setPickStoreOpen(false) }}>
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
              <p className="text-base font-semibold text-slate-800">Выбор магазина</p>
            </div>
            <div className="border-b border-slate-100 px-4 py-3">
              <input autoFocus type="text" value={storeSearch} onChange={(e) => setStoreSearch(e.target.value)}
                placeholder="Поиск по названию или коду…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="max-h-96 overflow-y-auto py-1">
              {!storeSearch && (
                <button type="button" onClick={() => setPickedTmp('')}
                  className={`w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${pickedTmp === '' ? 'bg-slate-50 font-medium text-slate-700' : 'text-slate-400'}`}>
                  — без магазина —
                </button>
              )}
              {filteredStores.map((s) => (
                <button key={s.id} type="button" onClick={() => setPickedTmp(s.id)}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${pickedTmp === s.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700'}`}>
                  <span>{s.name}</span>
                  {s.store_code && <span className="ml-3 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{s.store_code}</span>}
                </button>
              ))}
              {storeSearch && filteredStores.length === 0 && <p className="px-4 py-3 text-sm text-slate-400">Ничего не найдено</p>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-4">
              <button type="button" onClick={() => setPickStoreOpen(false)} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">Отмена</button>
              <button type="button" onClick={() => { setStoreId(pickedTmp); setPickStoreOpen(false) }} className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700">Выбрать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// CreateBatchModal
// ══════════════════════════════════════════════════════════════
interface CreateBatchModalProps {
  stores: Store[]
  accountId: string
  settings: FulfillmentSettings | null
  onClose: () => void
  onStoreCreated: (store: Store) => void
  onSubmit: (values: {
    name: string
    store_id: string | null
    stage_otk: boolean
    stage_marking: boolean
    stage_packing: boolean
    stage_logistics: boolean
  }, closeOnly?: boolean) => Promise<void>
}

const CreateBatchModal = ({ stores, accountId, settings, onClose, onSubmit, onStoreCreated }: CreateBatchModalProps) => {
  const [name, setName] = useState(todayName)
  const [storeId, setStoreId] = useState('')
  const [pendingStore, setPendingStore] = useState<Store | null>(null)

  // sub-modal: pick store
  const [pickStoreOpen, setPickStoreOpen] = useState(false)
  const [storeSearch, setStoreSearch] = useState('')
  const [pickedTmp, setPickedTmp] = useState('')   // selection inside the pick-modal before confirm

  // sub-modal: create store
  const [createStoreOpen, setCreateStoreOpen] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')
  const [newStoreCode, setNewStoreCode] = useState('')
  const [isCreatingStore, setIsCreatingStore] = useState(false)
  const [createStoreError, setCreateStoreError] = useState<string | null>(null)

  // all stores including one just created (before prop updates)
  const allStores = pendingStore && !stores.find((s) => s.id === pendingStore.id)
    ? [pendingStore, ...stores]
    : stores

  const openPickStore = () => {
    setPickedTmp(storeId)
    setStoreSearch('')
    setPickStoreOpen(true)
  }

  const handleCreateStore = async () => {
    if (!newStoreName.trim()) { setCreateStoreError('Введите название магазина'); return }
    setIsCreatingStore(true)
    setCreateStoreError(null)
    try {
      const created = await createStoreInSupabase(
        { name: newStoreName.trim(), marketplace: 'Wildberries', store_code: newStoreCode.trim() || undefined, api_key: '', supplier: '', supplier_full: '', address: '', inn: '' },
        accountId,
      )
      onStoreCreated(created)
      setPendingStore(created)
      setStoreId(created.id)
      setCreateStoreOpen(false)
      setPickStoreOpen(false)
      setNewStoreName('')
      setNewStoreCode('')
    } catch (err) {
      setCreateStoreError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsCreatingStore(false)
    }
  }

  const storeLabel = () => {
    if (!storeId) return null
    const s = allStores.find((x) => x.id === storeId)
    if (!s) return null
    return s.store_code ? `${s.name}  ·  ${s.store_code}` : s.name
  }

  const [stageOtk, setStageOtk] = useState(settings?.stage_otk ?? false)
  const [stageMarking, setStageMarking] = useState(settings?.stage_marking ?? false)
  const [stagePacking, setStagePacking] = useState(settings?.stage_packing ?? false)
  const [stageLogistics, setStageLogistics] = useState(settings?.stage_logistics ?? false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeOnlyRef = useRef(false)
  const [confirmNoStore, setConfirmNoStore] = useState(false)

  const doSubmit = async () => {
    setIsSaving(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), store_id: storeId || null, stage_otk: stageOtk, stage_marking: stageMarking, stage_packing: stagePacking, stage_logistics: stageLogistics }, closeOnlyRef.current)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
      setIsSaving(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Введите название'); return }
    if (!storeId) { setConfirmNoStore(true); return }
    await doSubmit()
  }

  const StageToggle = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
    <label className="flex cursor-pointer items-center gap-3">
      <button type="button" onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${value ? 'bg-blue-500' : 'bg-slate-200'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
      </button>
      <span className={`text-sm ${value ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
    </label>
  )

  const filteredStores = allStores.filter((s) => {
    if (!storeSearch) return true
    const q = storeSearch.toLowerCase()
    return s.name.toLowerCase().includes(q) || (s.store_code ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-50">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <p className="text-base font-semibold text-slate-800">Новая партия</p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6 p-8">
          {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Название</label>
            <input autoFocus type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Магазин (опционально)</label>
            <button type="button" onClick={openPickStore}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none hover:border-blue-300 focus:border-blue-300 focus:ring-2 focus:ring-blue-100">
              <span className={storeId ? 'text-slate-800' : 'text-slate-400'}>
                {storeLabel() ?? 'Выбор магазина'}
              </span>
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
            </button>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Этапы этой партии</p>
            <div className="rounded-2xl bg-slate-50 p-4 space-y-3">
              <div className="flex items-center gap-3 opacity-40">
                <div className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-blue-500">
                  <span className="inline-block h-5 w-5 translate-x-[22px] rounded-full bg-white shadow" />
                </div>
                <span className="text-sm text-slate-700">Приёмка (всегда включена)</span>
              </div>
              <StageToggle label="ОТК" value={stageOtk} onChange={setStageOtk} />
              <StageToggle label="Маркировка" value={stageMarking} onChange={setStageMarking} />
              <StageToggle label="Формирование коробов" value={stagePacking} onChange={setStagePacking} />
              <StageToggle label="Передача на логистику" value={stageLogistics} onChange={setStageLogistics} />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <button type="submit" disabled={isSaving}
              onClick={() => { closeOnlyRef.current = true }}
              className="rounded-2xl bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {isSaving && closeOnlyRef.current ? 'Создание…' : 'Создать и закрыть'}
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
                Отмена
              </button>
              <button type="submit" disabled={isSaving}
                onClick={() => { closeOnlyRef.current = false }}
                className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {isSaving && !closeOnlyRef.current ? 'Создание…' : 'Далее'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* ── Confirm: no store ── */}
      {confirmNoStore && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); setConfirmNoStore(false) }}>
          <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <p className="font-semibold text-slate-800">Продолжить без магазина?</p>
              <p className="mt-1 text-sm text-slate-500">Магазин не выбран. Партия будет создана без привязки к магазину.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setConfirmNoStore(false)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
                Выбрать магазин
              </button>
              <button type="button" onClick={() => { setConfirmNoStore(false); void doSubmit() }}
                className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Продолжить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-modal: pick store ── */}
      {pickStoreOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); setPickStoreOpen(false) }}>
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
              <p className="text-base font-semibold text-slate-800">Выбор магазина</p>
            </div>
            <div className="border-b border-slate-100 px-4 py-3">
              <input autoFocus type="text" value={storeSearch} onChange={(e) => setStoreSearch(e.target.value)}
                placeholder="Поиск по названию или коду…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="max-h-96 overflow-y-auto py-1">
              {/* + Создать магазин */}
              {!storeSearch && (
                <button type="button"
                  onClick={() => { setCreateStoreOpen(true) }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-blue-600 hover:bg-blue-50">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                  Создать магазин
                </button>
              )}
              {filteredStores.map((s) => (
                <button key={s.id} type="button"
                  onClick={() => setPickedTmp(s.id)}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${pickedTmp === s.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700'}`}>
                  <span>{s.name}</span>
                  {s.store_code && <span className="ml-3 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{s.store_code}</span>}
                </button>
              ))}
              {storeSearch && filteredStores.length === 0 && (
                <p className="px-4 py-3 text-sm text-slate-400">Ничего не найдено</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-4">
              <button type="button" onClick={() => setPickStoreOpen(false)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
                Отмена
              </button>
              <button type="button"
                onClick={() => { setStoreId(pickedTmp); setPickStoreOpen(false) }}
                className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Выбрать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-modal: create store ── */}
      {createStoreOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); setCreateStoreOpen(false) }}>
          <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-50">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
              </div>
              <p className="text-base font-semibold text-slate-800">Новый магазин</p>
            </div>
            <div className="space-y-4 p-6">
              {createStoreError && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{createStoreError}</div>}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">Название магазина <span className="text-red-400">*</span></label>
                <input autoFocus type="text" value={newStoreName} onChange={(e) => setNewStoreName(e.target.value)}
                  placeholder="напр. AERON, Dream Technology..."
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateStore() } }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">
                  Код магазина <span className="font-normal text-slate-400">(необязательно)</span>
                </label>
                <input type="text" value={newStoreCode} onChange={(e) => setNewStoreCode(e.target.value)}
                  placeholder="ARN / DT / ..."
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateStore() } }}
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => setCreateStoreOpen(false)}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
                  Отмена
                </button>
                <button type="button" onClick={() => void handleCreateStore()} disabled={isCreatingStore}
                  className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {isCreatingStore ? 'Создание…' : 'Создать'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// SettingsModal
// ══════════════════════════════════════════════════════════════
interface SettingsModalProps {
  settings: FulfillmentSettings | null
  onClose: () => void
  onSave: (s: Partial<FulfillmentSettings>) => Promise<void>
}

const SettingsModal = ({ settings, onClose, onSave }: SettingsModalProps) => {
  const [stageOtk, setStageOtk] = useState(settings?.stage_otk ?? true)
  const [stageMarking, setStageMarking] = useState(settings?.stage_marking ?? true)
  const [stagePacking, setStagePacking] = useState(settings?.stage_packing ?? true)
  const [stageLogistics, setStageLogistics] = useState(settings?.stage_logistics ?? true)
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    try { await onSave({ stage_otk: stageOtk, stage_marking: stageMarking, stage_packing: stagePacking, stage_logistics: stageLogistics }) }
    finally { setIsSaving(false) }
  }

  const Toggle = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex cursor-pointer items-center justify-between py-2.5">
      <span className="text-sm text-slate-700">{label}</span>
      <button type="button" onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-blue-500' : 'bg-slate-200'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-6 py-5">
          <p className="text-base font-semibold text-slate-800">Настройки фулфилмента</p>
          <p className="mt-0.5 text-xs text-slate-400">Этапы по умолчанию для новых партий</p>
        </div>
        <div className="divide-y divide-slate-100 px-6">
          <div className="flex items-center justify-between py-2.5 opacity-40">
            <span className="text-sm text-slate-700">Приёмка</span>
            <span className="text-xs text-slate-400">всегда</span>
          </div>
          <Toggle label="ОТК" value={stageOtk} onChange={setStageOtk} />
          <Toggle label="Маркировка" value={stageMarking} onChange={setStageMarking} />
          <Toggle label="Формирование коробов" value={stagePacking} onChange={setStagePacking} />
          <Toggle label="Передача на логистику" value={stageLogistics} onChange={setStageLogistics} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
            Отмена
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={isSaving}
            className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {isSaving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// FulfillmentPage
// ══════════════════════════════════════════════════════════════
export const FulfillmentPage = ({ accountId, stores, trips, onEditTripLine, onStoreCreated, canManage = true }: FulfillmentPageProps) => {
  const [batches, setBatches] = useState<FulfillmentBatch[]>([])
  const [settings, setSettings] = useState<FulfillmentSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [detailData, setDetailData] = useState<FulfillmentBatchWithItems | null>(null)
  const [isOpeningDetail, setIsOpeningDetail] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FulfillmentBatch | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [editTarget, setEditTarget] = useState<FulfillmentBatch | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const load = useCallback(async () => {
    if (!accountId) return
    setIsLoading(true)
    setLoadError(null)
    try {
      const [bs, s] = await Promise.all([fetchBatches(accountId), fetchFulfillmentSettings(accountId)])
      setBatches(bs)
      setSettings(s)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setIsLoading(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const handleOpenDetail = async (batchId: string) => {
    setIsOpeningDetail(batchId)
    try {
      const data = await fetchBatchWithItems(batchId)
      setDetailData(data)
    } catch { /* silent */ }
    finally { setIsOpeningDetail(null) }
  }

  const handleCreate = async (values: Parameters<typeof createBatch>[1], closeOnly?: boolean) => {
    const batch = await createBatch(accountId, values)
    setBatches((prev) => [batch, ...prev])
    setCreateOpen(false)
    if (!closeOnly) void handleOpenDetail(batch.id)
  }

  const handleBatchUpdated = (updated: FulfillmentBatch) => {
    setBatches((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)))
    setDetailData((prev) => prev ? { ...prev, ...updated } : prev)
  }

  const handleItemsChanged = (items: FulfillmentItem[]) => {
    setDetailData((prev) => prev ? { ...prev, items } : prev)
  }

  const handleDelete = async (batch: FulfillmentBatch) => {
    setIsDeleting(true)
    try {
      await deleteBatch(batch.id)
      setBatches((prev) => prev.filter((b) => b.id !== batch.id))
      setDeleteTarget(null)
      if (detailData?.id === batch.id) setDetailData(null)
    } finally { setIsDeleting(false) }
  }

  const handleSaveSettings = async (s: Partial<FulfillmentSettings>) => {
    const updated = await upsertFulfillmentSettings(accountId, s)
    setSettings(updated)
    setSettingsOpen(false)
  }

  const filtered = batches.filter((b) => filterStatus === 'all' || b.status === filterStatus)

  const stageLabel = (b: FulfillmentBatch) => {
    if (b.status === 'done') return 'Завершена'
    if (b.status === 'cancelled') return 'Отменена'
    return STAGE_LABELS[b.current_stage]
  }

  return (
    <div className="space-y-4">
      {/* Модалки */}
      {createOpen && <CreateBatchModal stores={stores} accountId={accountId} settings={settings} onClose={() => setCreateOpen(false)} onSubmit={handleCreate} onStoreCreated={(s) => onStoreCreated?.(s)} />}
      {editTarget && <EditBatchModal batch={editTarget} stores={stores} onClose={() => setEditTarget(null)} onSave={async (values) => { const updated = await updateBatch(editTarget.id, values); handleBatchUpdated(updated); setEditTarget(null) }} />}
      {settingsOpen && <SettingsModal settings={settings} onClose={() => setSettingsOpen(false)} onSave={handleSaveSettings} />}
      {detailData && (
        <BatchDetailModal
          batch={detailData} accountId={accountId} stores={stores} trips={trips}
          canManage={canManage} onClose={() => setDetailData(null)}
          onBatchUpdated={handleBatchUpdated} onItemsChanged={handleItemsChanged}
          onEditTripLine={onEditTripLine}
        />
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <p className="font-semibold text-slate-800">Удалить партию?</p>
              <p className="mt-1 text-sm text-slate-500">«{deleteTarget.name}» — все позиции будут удалены. Это действие необратимо.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">Отмена</button>
              <button type="button" onClick={() => void handleDelete(deleteTarget)} disabled={isDeleting}
                className="rounded-2xl bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50">
                {isDeleting ? 'Удаление…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <Card className="rounded-3xl p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="flex-1 text-base font-semibold text-slate-800">Партии</p>
          <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-0.5">
            {(['all', 'active', 'done', 'cancelled'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setFilterStatus(s)}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${filterStatus === s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {s === 'all' ? 'Все' : STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          {canManage && (
            <button type="button" onClick={() => setSettingsOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-2xl text-slate-400 hover:bg-slate-100">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
          {canManage && (
            <button type="button" onClick={() => setCreateOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-2xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Создать партию
            </button>
          )}
        </div>
      </Card>

      {loadError && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{loadError}</div>}

      <Card className="overflow-hidden rounded-3xl p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-400">Загрузка…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-slate-700">Нет партий</p>
              <p className="text-sm text-slate-400">{canManage ? 'Нажмите «Создать партию» чтобы начать' : 'Партий пока нет'}</p>
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Партия</th>
                <th className="px-4 py-3 text-left">Магазин</th>
                <th className="px-4 py-3 text-center">Этап</th>
                <th className="px-4 py-3 text-center">Статус</th>
                <th className="px-4 py-3 text-left">Создана</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((b) => {
                const s = stores.find((st) => st.id === b.store_id)
                const isOpening = isOpeningDetail === b.id
                return (
                  <tr key={b.id} onClick={() => !isOpening && void handleOpenDetail(b.id)}
                    className="cursor-pointer hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{b.name}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{s?.name ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-center">
                      {isOpening ? (
                        <span className="text-xs text-slate-300">…</span>
                      ) : (
                        <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                          {stageLabel(b)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[b.status]}`}>
                        {STATUS_LABELS[b.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(b.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {canManage && (
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={(e) => { e.stopPropagation(); setEditTarget(b) }}
                            className="rounded-xl p-1.5 text-slate-300 hover:bg-blue-50 hover:text-blue-400">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setDeleteTarget(b) }}
                            className="rounded-xl p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-400">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
