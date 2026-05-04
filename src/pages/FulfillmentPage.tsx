import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  FulfillmentBatch,
  FulfillmentBatchWithItems,
  FulfillmentItem,
  FulfillmentOtkLog,
  FulfillmentOtkLogHistory,
  FulfillmentMarkingLog,
  FulfillmentMarkingLogHistory,
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
  restoreBatch,
  fetchArchivedBatches,
  addItem,
  updateItem,
  deleteItem,
  advanceStage,
  lookupProductByBarcode,
  searchProducts,
  fetchOtkLogs,
  fetchDeletedOtkLogs,
  addOtkLog,
  updateOtkLog,
  deleteOtkLog,
  uploadOtkPhoto,
  fetchOtkPerformers,
  addOtkLogHistory,
  fetchOtkLogHistory,
  patchOtkLogHistoryUserName,
  fetchMarkingLogs,
  fetchDeletedMarkingLogs,
  addMarkingLog,
  updateMarkingLog,
  deleteMarkingLog,
  uploadMarkingPhoto,
  addMarkingLogHistory,
  fetchMarkingLogHistory,
  patchMarkingLogHistoryUserName,
} from '../services/fulfillmentService'
import type { CatalogProduct, OtkPerformer } from '../services/fulfillmentService'
import { Card } from '../components/ui/Card'
import { InvoicePhotoCell } from '../components/ui/InvoicePhotoCell'
import { createStoreInSupabase } from '../services/storeService'

// ── Вспомогательные константы ─────────────────────────────────
const STAGE_LABELS: Record<FulfillmentStage, string> = {
  reception: 'Приёмка',
  otk: 'ОТК',
  marking: 'Маркировка',
  packing: 'Короба',
  logistics: 'Логистика',
  done: 'Готово',
}

const STAGE_ORDER: FulfillmentStage[] = ['reception', 'otk', 'marking', 'packing', 'logistics', 'done']

const STAGE_LABELS_TO: Partial<Record<FulfillmentStage, string>> = {
  reception: 'Приёмке',
  otk: 'ОТК',
  marking: 'Маркировке',
  packing: 'Коробам',
  logistics: 'Логистике',
}
type AddMode = 'barcode' | 'bulk' | 'subject' | 'catalog' | 'boxes'

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
  canOtkAssign?: boolean
  canStageJump?: boolean
  userId?: string
  userEmail?: string
  userName?: string
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
            <td colSpan={2} className="px-4 py-2.5 text-slate-500">Итого</td>
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

// ── OTK тарифы ────────────────────────────────────────────────
const OTK_TARIFFS = [
  { id: 'standard', label: 'ОТК Стандарт' },
  { id: 'double', label: 'ОТК Двойка' },
  { id: 'hidden_defect', label: 'Скрытый дефект' },
  { id: 'other', label: 'Другое' },
] as const

// ── Тарифы Маркировки ─────────────────────────────────────────
const MARKING_TARIFFS = [
  { id: 'standard', label: 'Маркировка Стандарт' },
  { id: 'express', label: 'Маркировка Срочная' },
  { id: 'repack', label: 'Перемаркировка' },
  { id: 'other', label: 'Другое' },
] as const

// ══════════════════════════════════════════════════════════════
// BatchDetailModal
// ══════════════════════════════════════════════════════════════
interface DetailModalProps {
  batch: FulfillmentBatchWithItems
  accountId: string
  stores: Store[]
  trips: TripWithLines[]
  canManage: boolean
  canOtkAssign: boolean
  canStageJump: boolean
  userId: string
  userEmail: string
  userName: string
  onClose: () => void
  onBatchUpdated: (b: FulfillmentBatch) => void
  onItemsChanged: (items: FulfillmentItem[]) => void
  onEditTripLine: (tripId: string, lineId: string, values: TripLineFormValues) => Promise<void>
  zIndex?: number
}

const BatchDetailModal = ({
  batch: initialBatch,
  accountId,
  stores,
  trips,
  canManage,
  canOtkAssign,
  canStageJump,
  userId,
  userEmail,
  userName,
  onClose,
  onBatchUpdated,
  onItemsChanged,
  onEditTripLine,
  zIndex = 50,
}: DetailModalProps) => {
  const [batch, setBatch] = useState<FulfillmentBatchWithItems>(initialBatch)
  const [items, setItems] = useState<FulfillmentItem[]>(initialBatch.items)
  const [isSavingStage, setIsSavingStage] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Приёмка: режим добавления
  const [addMode, setAddMode] = useState<AddMode>('bulk')

  // Режим «По баркоду»
  const [newBarcode, setNewBarcode] = useState('')
  const [newQty, setNewQty] = useState('')
  const [newName, setNewName] = useState('')
  const [newSize, setNewSize] = useState('')
  const [isLooking, setIsLooking] = useState(false)
  const [isAddingSaving, setIsAddingSaving] = useState(false)
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const otkFileInputRef = useRef<HTMLInputElement>(null)
  const markingFileInputRef = useRef<HTMLInputElement>(null)

  // Режим «Навалом»
  const [bulkQty, setBulkQty] = useState('')
  const [bulkNote, setBulkNote] = useState('')

  // Режим «По предмету»
  const [subjectName, setSubjectName] = useState('')
  const [subjectQty, setSubjectQty] = useState('')

  // Режим «Готовые короба»
  const [boxesName, setBoxesName] = useState('')
  const [boxesQty, setBoxesQty] = useState('')
  const [boxesCount, setBoxesCount] = useState('')

  // Режим «Из каталога»
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogResults, setCatalogResults] = useState<CatalogProduct[]>([])
  const [catalogQties, setCatalogQties] = useState<Record<string, number>>({})
  const [isSearching, setIsSearching] = useState(false)

  // Редактирование этапов партии
  const [isSavingBatchStages, setIsSavingBatchStages] = useState(false)

  // Черновики для Маркировки/Коробов (ОТК теперь через журнал логов)
  const [stageDraft, setStageDraft] = useState<Record<string, { qty: number; boxes?: number }>>({})

  // ОТК — журнал логов
  const [otkLogs, setOtkLogs] = useState<FulfillmentOtkLog[]>([])
  const [isLoadingOtk, setIsLoadingOtk] = useState(false)
  const [otkTariff, setOtkTariff] = useState(OTK_TARIFFS[0].id)
  const [otkQty, setOtkQty] = useState('')
  const [otkDefect, setOtkDefect] = useState('')
  const [otkNotes, setOtkNotes] = useState('')
  const [otkPerformerId, setOtkPerformerId] = useState(userId)
  const [otkPerformerName, setOtkPerformerName] = useState(userName || userEmail)
  const [otkPerformers, setOtkPerformers] = useState<OtkPerformer[]>([])
  const [isAddingOtk, setIsAddingOtk] = useState(false)
  const [isDeletingOtk, setIsDeletingOtk] = useState<string | null>(null)
  const [otkPhotoFiles, setOtkPhotoFiles] = useState<File[]>([])

  // ОТК — буфер несохранённых изменений
  type OtkBufferEntry = { tempId: string; performer_user_id: string | null; performer_name: string; tariff: string; qty: number; qty_defect: number; notes: string; photo_files: File[] }
  const [otkBuffer, setOtkBuffer] = useState<OtkBufferEntry[]>([])
  const [otkEdits, setOtkEdits] = useState<Record<string, { tariff: string; qty: number; qty_defect: number; notes: string }>>({})
  const [otkDeletedIds, setOtkDeletedIds] = useState<string[]>([])
  const [otkDeletedLogs, setOtkDeletedLogs] = useState<FulfillmentOtkLog[]>([])
  const [otkEditingId, setOtkEditingId] = useState<string | null>(null)
  const [otkDeleteConfirmId, setOtkDeleteConfirmId] = useState<string | null>(null)
  const [otkHistoryLog, setOtkHistoryLog] = useState<FulfillmentOtkLog | null>(null)

  // Маркировка — журнал логов (аналог ОТК)
  const [markingLogs, setMarkingLogs] = useState<FulfillmentMarkingLog[]>([])
  const [isLoadingMarking, setIsLoadingMarking] = useState(false)
  const [markingTariff, setMarkingTariff] = useState(MARKING_TARIFFS[0].id)
  const [markingQty, setMarkingQty] = useState('')
  const [markingDefect, setMarkingDefect] = useState('')
  const [markingNotes, setMarkingNotes] = useState('')
  const [markingPerformerId, setMarkingPerformerId] = useState(userId)
  const [markingPerformerName, setMarkingPerformerName] = useState(userName || userEmail)
  const [markingPerformers, setMarkingPerformers] = useState<OtkPerformer[]>([])
  const [isAddingMarking, setIsAddingMarking] = useState(false)
  const [markingPhotoFiles, setMarkingPhotoFiles] = useState<File[]>([])
  type MarkingBufferEntry = { tempId: string; performer_user_id: string | null; performer_name: string; tariff: string; qty: number; qty_defect: number; notes: string; photo_files: File[] }
  const [markingBuffer, setMarkingBuffer] = useState<MarkingBufferEntry[]>([])
  const [markingEdits, setMarkingEdits] = useState<Record<string, { tariff: string; qty: number; qty_defect: number; notes: string }>>({})
  const [markingDeletedIds, setMarkingDeletedIds] = useState<string[]>([])
  const [markingDeletedLogs, setMarkingDeletedLogs] = useState<FulfillmentMarkingLog[]>([])
  const [markingEditingId, setMarkingEditingId] = useState<string | null>(null)
  const [markingDeleteConfirmId, setMarkingDeleteConfirmId] = useState<string | null>(null)
  const [markingHistoryTabId, setMarkingHistoryTabId] = useState<string | null>(null)
  const [markingLogHistories, setMarkingLogHistories] = useState<Record<string, FulfillmentMarkingLogHistory[]>>({})
  const markingHistoryLoadingIds = useRef<Set<string>>(new Set())
  const [otkHistoryTabId, setOtkHistoryTabId] = useState<string | null>(null)
  const [otkHistoryStageTab, setOtkHistoryStageTab] = useState<FulfillmentStage>('otk')
  const [otkLogHistories, setOtkLogHistories] = useState<Record<string, FulfillmentOtkLogHistory[]>>({})
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyItemId, setHistoryItemId] = useState<string | null>(null)

  // Логистика
  const [selectedTripId, setSelectedTripId] = useState('')
  const [selectedLineId, setSelectedLineId] = useState('')
  const [isLinkingLogistics, setIsLinkingLogistics] = useState(false)

  // Буфер изменений приёмки
  const [receptionDraft, setReceptionDraft] = useState<Record<string, number>>(
    Object.fromEntries(initialBatch.items.map((it) => [it.id, it.qty_received]))
  )
  // Трекер несохранённых изменений
  const [isDirty, setIsDirty] = useState(false)
  const [pendingClose, setPendingClose] = useState(false)
  const [pendingAdvance, setPendingAdvance] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)

  const store = stores.find((s) => s.id === batch.store_id)
  const enabledStages = getEnabledStages(batch)
  const currentIdx = enabledStages.indexOf(batch.current_stage)

  // Текущий просматриваемый этап (может отличаться от batch.current_stage при навигации)
  const [viewStage, setViewStage] = useState<FulfillmentStage>(initialBatch.current_stage)

  // Синхронизировать viewStage при реальном переходе этапа
  useEffect(() => { setViewStage(batch.current_stage) }, [batch.current_stage])

  // Инициализировать черновики и сбрасывать isDirty при смене РЕАЛЬНОГО этапа
  useEffect(() => {
    const draft: Record<string, { qty: number; boxes?: number }> = {}
    items.forEach((it) => {
      if (batch.current_stage === 'marking') {
        draft[it.id] = { qty: it.qty_marked ?? it.qty_otk ?? it.qty_received }
      } else if (batch.current_stage === 'packing') {
        draft[it.id] = { qty: it.qty_packed ?? it.qty_marked ?? it.qty_otk ?? it.qty_received, boxes: it.boxes ?? 0 }
      }
    })
    setStageDraft(draft)
    // Инициализировать reception draft
    const recDraft: Record<string, number> = {}
    items.forEach((it) => { recDraft[it.id] = it.qty_received })
    setReceptionDraft(recDraft)
    setIsDirty(false)
  }, [batch.current_stage])

  // При навигации к другому этапу — сбрасывать все несохранённые изменения
  useEffect(() => {
    if (viewStage === batch.current_stage) return
    // Сбросить OTK-буфер
    setOtkBuffer([])
    setOtkEdits({})
    setOtkDeletedIds([])
    setOtkEditingId(null)
    // Сбросить Marking-буфер
    setMarkingBuffer([])
    setMarkingEdits({})
    setMarkingDeletedIds([])
    setMarkingEditingId(null)
    // Сбросить черновик приёмки
    const recDraft: Record<string, number> = {}
    items.forEach((it) => { recDraft[it.id] = it.qty_received })
    setReceptionDraft(recDraft)
    // Инициализировать stageDraft под целевой этап или вернуть к сохранённым значениям текущего
    const draft: Record<string, { qty: number; boxes?: number }> = {}
    items.forEach((it) => {
      if (viewStage === 'packing') draft[it.id] = { qty: it.qty_packed ?? it.qty_marked ?? it.qty_otk ?? it.qty_received, boxes: it.boxes ?? 0 }
      else if (batch.current_stage === 'packing') draft[it.id] = { qty: it.qty_packed ?? it.qty_marked ?? it.qty_otk ?? it.qty_received, boxes: it.boxes ?? 0 }
    })
    if (Object.keys(draft).length > 0) setStageDraft(draft)
    setIsDirty(false)
  }, [viewStage])

  // Загрузить OTK-логи при переходе на этап ОТК (реальный или через навигацию)
  useEffect(() => {
    if (viewStage !== 'otk' && viewStage !== 'marking' && viewStage !== 'packing' && viewStage !== 'logistics') return
    setIsLoadingOtk(true)
    setOtkPerformerId(userId)
    setOtkPerformerName(userName || userEmail)
    Promise.all([fetchOtkLogs(batch.id), fetchDeletedOtkLogs(batch.id)])
      .then(([active, deleted]) => { setOtkLogs(active); setOtkDeletedLogs(deleted) })
      .catch(() => { setOtkLogs([]); setOtkDeletedLogs([]) })
      .finally(() => setIsLoadingOtk(false))
    if (canOtkAssign) {
      fetchOtkPerformers(accountId)
        .then(setOtkPerformers)
        .catch(() => setOtkPerformers([]))
    }
  }, [batch.id, viewStage])

  // Загрузить Marking-логи при переходе на этап Маркировки
  useEffect(() => {
    if (viewStage !== 'marking') return
    setIsLoadingMarking(true)
    setMarkingPerformerId(userId)
    setMarkingPerformerName(userName || userEmail)
    Promise.all([fetchMarkingLogs(batch.id), fetchDeletedMarkingLogs(batch.id)])
      .then(([active, deleted]) => { setMarkingLogs(active); setMarkingDeletedLogs(deleted) })
      .catch(() => { setMarkingLogs([]); setMarkingDeletedLogs([]) })
      .finally(() => setIsLoadingMarking(false))
    if (canOtkAssign) {
      fetchOtkPerformers(accountId)
        .then(setMarkingPerformers)
        .catch(() => setMarkingPerformers([]))
    }
  }, [batch.id, viewStage])

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
    if (!newBarcode.trim() || Number(newQty) < 1) return
    setIsAddingSaving(true)
    setError(null)
    try {
      const item = await addItem({
        batch_id: batch.id,
        barcode: newBarcode.trim(),
        product_name: newName.trim() || null,
        size: newSize.trim() || null,
        article: null,
        qty_received: Number(newQty),
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
      setNewBarcode(''); setNewQty(''); setNewName(''); setNewSize('')
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
      setReceptionDraft((p) => { const n = { ...p }; delete n[id]; return n })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    }
  }

  // Режим «Навалом»
  const handleBulkAdd = async () => {
    if (Number(bulkQty) < 1) return
    setIsAddingSaving(true)
    setError(null)
    try {
      const item = await addItem({
        batch_id: batch.id,
        barcode: '',
        product_name: bulkNote.trim() || 'Общая партия',
        size: null,
        article: null,
        qty_received: Number(bulkQty),
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
      setBulkQty(''); setBulkNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsAddingSaving(false)
    }
  }

  // Режим «По предмету»
  const handleSubjectAdd = async () => {
    if (!subjectName.trim() || Number(subjectQty) < 1) return
    setIsAddingSaving(true)
    setError(null)
    try {
      const item = await addItem({
        batch_id: batch.id,
        barcode: '',
        product_name: subjectName.trim(),
        size: null,
        article: null,
        qty_received: Number(subjectQty),
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
      setSubjectName(''); setSubjectQty('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsAddingSaving(false)
    }
  }

  // Режим «Готовые короба»
  const handleBoxesAdd = async () => {
    if (Number(boxesQty) < 1 || Number(boxesCount) < 1) return
    setIsAddingSaving(true)
    setError(null)
    try {
      const qty = Number(boxesQty)
      const item = await addItem({
        batch_id: batch.id,
        barcode: '',
        product_name: boxesName.trim() || 'Готовые короба',
        size: null,
        article: null,
        qty_received: qty,
        qty_otk: null,
        qty_marked: null,
        qty_packed: qty,
        boxes: Number(boxesCount),
        notes: null,
        sort_order: items.length,
      })
      const next = [...items, item]
      setItems(next)
      onItemsChanged(next)
      setBoxesName(''); setBoxesQty(''); setBoxesCount('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsAddingSaving(false)
    }
  }

  // Приёмка: qty_received редактируется локально, сохраняется по кнопке
  const handleUpdateReceivedDraft = (id: string, qty: number) => {
    setReceptionDraft((p) => ({ ...p, [id]: qty }))
    setIsDirty(true)
  }

  // Сохранить изменения приёмки в БД (без перехода)
  const handleSaveReceptionDraft = async () => {
    setIsSavingDraft(true)
    setError(null)
    try {
      const toUpdate = items.filter((it) => receptionDraft[it.id] !== undefined && receptionDraft[it.id] !== it.qty_received)
      const updated = await Promise.all(toUpdate.map((it) => updateItem(it.id, { qty_received: receptionDraft[it.id] })))
      setItems((prev) => prev.map((it) => {
        const upd = updated.find((u) => u.id === it.id)
        return upd ? upd : it
      }))
      onItemsChanged(items.map((it) => {
        const upd = updated.find((u) => u.id === it.id)
        return upd ? upd : it
      }))
      setIsDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSavingDraft(false)
    }
  }

  // Сохранить черновик Marking/Packing без перехода
  const handleSaveStageDraft = async () => {
    setIsSavingDraft(true)
    setError(null)
    try {
      for (const [id, val] of Object.entries(stageDraft)) {
        if (viewStage === 'marking') await updateItem(id, { qty_marked: val.qty })
        else if (viewStage === 'packing') await updateItem(id, { qty_packed: val.qty, boxes: val.boxes ?? 0 })
      }
      const refreshed = await fetchBatchWithItems(batch.id)
      setItems(refreshed.items)
      onItemsChanged(refreshed.items)
      setIsDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSavingDraft(false)
    }
  }

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
    const barcode = sz?.skus?.[0] ?? product.barcodes[0] ?? ''
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
        if (batch.current_stage === 'packing') await updateItem(id, { qty_packed: val.qty, boxes: val.boxes ?? 0 })
      }
      const refreshed = await fetchBatchWithItems(batch.id)
      setItems(refreshed.items)
      onItemsChanged(refreshed.items)
      const updated = await advanceStage(batch)
      const newBatch = { ...batch, ...updated }
      setBatch(newBatch)
      onBatchUpdated(updated)
      setIsDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSavingStage(false)
    }
  }

  // ОТК — добавить запись
  const handleAddOtkLog = async () => {
    const qty = Number(otkQty) || 0
    const qtyDefect = Number(otkDefect) || 0
    if (qty <= 0 && qtyDefect <= 0) return
    // Добавляем в буфер (не сохраняем сразу в БД)
    setOtkBuffer((prev) => [...prev, {
      tempId: crypto.randomUUID(),
      performer_user_id: otkPerformerId || null,
      performer_name: otkPerformerName || userEmail || '',
      tariff: otkTariff,
      qty,
      qty_defect: qtyDefect,
      notes: otkNotes.trim(),
      photo_files: otkPhotoFiles,
    }])
    setIsDirty(true)
    setOtkQty('')
    setOtkDefect('')
    setOtkNotes('')
    setOtkPhotoFiles([])
  }

  // ОТК — пометить запись для удаления (не удаляет сразу)
  const handleDeleteOtkLog = (id: string) => {
    setOtkDeleteConfirmId(id)
  }

  const handleConfirmDeleteOtkLog = () => {
    const id = otkDeleteConfirmId
    if (!id) return
    setOtkDeleteConfirmId(null)
    if (otkBuffer.some((e) => e.tempId === id)) {
      setOtkBuffer((prev) => prev.filter((e) => e.tempId !== id))
    } else {
      setOtkDeletedIds((prev) => [...prev, id])
    }
    setIsDirty(true)
  }

  // ОТК — сохранить все буферные изменения в БД
  const handleSaveOtkAll = async () => {
    setIsSavingDraft(true)
    setError(null)
    try {
      // Soft-delete помеченных записей + логировать 'deleted'
      const deletedLogsNow = otkLogs.filter((l) => otkDeletedIds.includes(l.id))
      await Promise.all(deletedLogsNow.map(async (log) => {
        await ensureOtkCreatedHistory(log)
        await addOtkLogHistory({ log_id: log.id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'deleted', old_values: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [] }, new_values: {} })
        await deleteOtkLog(log.id)
      }))
      // Сохранить правки + залогировать изменения
      await Promise.all(Object.entries(otkEdits).map(async ([id, v]) => {
        const orig = otkLogs.find((l) => l.id === id)
        await updateOtkLog(id, v)
        if (orig) {
          const oldVals: Record<string, unknown> = {}
          const newVals: Record<string, unknown> = {}
          if (orig.tariff !== v.tariff) { oldVals.tariff = orig.tariff; newVals.tariff = v.tariff }
          if (orig.qty !== v.qty) { oldVals.qty = orig.qty; newVals.qty = v.qty }
          if (orig.qty_defect !== v.qty_defect) { oldVals.qty_defect = orig.qty_defect; newVals.qty_defect = v.qty_defect }
          if ((orig.notes ?? '') !== v.notes) { oldVals.notes = orig.notes ?? ''; newVals.notes = v.notes }
          if (Object.keys(newVals).length > 0) {
            await addOtkLogHistory({ log_id: id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'updated', old_values: oldVals, new_values: newVals })
          }
        }
      }))
      const newLogs = await Promise.all(otkBuffer.map(async (e) => {
        const photoUrls = e.photo_files.length > 0
          ? await Promise.all(e.photo_files.map((f) => uploadOtkPhoto(userId || 'anon', batch.id, f)))
          : []
        const log = await addOtkLog({
          batch_id: batch.id,
          user_id: userId || '',
          user_email: userEmail || '',
          user_name: userName || null,
          performer_user_id: e.performer_user_id,
          performer_name: e.performer_name,
          tariff: e.tariff,
          qty: e.qty,
          qty_defect: e.qty_defect,
          notes: e.notes || undefined,
          photo_urls: photoUrls,
        })
        await addOtkLogHistory({ log_id: log.id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'created', old_values: null, new_values: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls } })
        return log
      }))
      setOtkLogs((prev) => {
        const filtered = prev.filter((l) => !otkDeletedIds.includes(l.id))
        const updated = filtered.map((l) => otkEdits[l.id] ? { ...l, ...otkEdits[l.id] } : l)
        return [...updated, ...newLogs]
      })
      setOtkDeletedLogs((prev) => [...prev, ...deletedLogsNow])
      // Сохранить расхождение на партии
      const tReceived = items.reduce((s, it) => s + (it.qty_received ?? 0), 0)
      const savedLogs = otkLogs.filter((l) => !otkDeletedIds.includes(l.id)).map((l) => otkEdits[l.id] ? { ...l, ...otkEdits[l.id] } : l)
      const tOtkSaved = [...savedLogs, ...newLogs].reduce((s, l) => s + l.qty + l.qty_defect, 0)
      const discrepancy = tOtkSaved - tReceived
      if (discrepancy !== (batch.otk_discrepancy ?? 0)) {
        const updated = await updateBatch(batch.id, { otk_discrepancy: discrepancy })
        setBatch((prev) => ({ ...prev, ...updated }))
        onBatchUpdated(updated)
      }
      setOtkBuffer([])
      setOtkEdits({})
      setOtkDeletedIds([])
      setOtkEditingId(null)
      setOtkLogHistories({})
      setIsDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSavingDraft(false)
    }
  }

  // ОТК — гарантировать наличие записи 'created' в истории до добавления 'updated'
  const ensureOtkCreatedHistory = async (log: (typeof otkLogs)[0]) => {
    let history = otkLogHistories[log.id]
    if (history === undefined) {
      history = await fetchOtkLogHistory(log.id)
      setOtkLogHistories((prev) => ({ ...prev, [log.id]: history! }))
    }
    if (history.length === 0) {
      await addOtkLogHistory({ log_id: log.id, user_id: log.user_id, user_email: log.user_email, user_name: log.user_name ?? otkPerformers.find((p) => p.user_id === log.user_id)?.full_name ?? (log.user_id === userId ? userName : null) ?? null, action: 'created', old_values: null, new_values: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [] } })
    }
  }

  // ОТК — добавить фото к сохранённой записи
  const handleAddOtkPhoto = async (logId: string, file: File) => {
    const log = otkLogs.find((l) => l.id === logId)
    if (!log) return
    await ensureOtkCreatedHistory(log)
    const url = await uploadOtkPhoto(userId || 'anon', batch.id, file)
    const newUrls = [...(log.photo_urls ?? []), url]
    await updateOtkLog(logId, { photo_urls: newUrls })
    await addOtkLogHistory({ log_id: logId, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'updated', old_values: { photo_urls: log.photo_urls ?? [] }, new_values: { photo_urls: newUrls } })
    setOtkLogs((prev) => prev.map((l) => l.id === logId ? { ...l, photo_urls: newUrls } : l))
    setOtkLogHistories((prev) => { const { [logId]: _, ...rest } = prev; return rest })
    setIsDirty(true)
  }

  const handleReplaceOtkPhoto = async (logId: string, index: number, file: File) => {
    const log = otkLogs.find((l) => l.id === logId)
    if (!log) return
    await ensureOtkCreatedHistory(log)
    const url = await uploadOtkPhoto(userId || 'anon', batch.id, file)
    const newUrls = [...(log.photo_urls ?? [])]
    newUrls[index] = url
    await updateOtkLog(logId, { photo_urls: newUrls })
    await addOtkLogHistory({ log_id: logId, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'updated', old_values: { photo_urls: log.photo_urls ?? [] }, new_values: { photo_urls: newUrls } })
    setOtkLogs((prev) => prev.map((l) => l.id === logId ? { ...l, photo_urls: newUrls } : l))
    setOtkLogHistories((prev) => { const { [logId]: _, ...rest } = prev; return rest })
    setIsDirty(true)
  }

  const handleRemoveOtkPhoto = async (logId: string, index: number) => {
    const log = otkLogs.find((l) => l.id === logId)
    if (!log) return
    await ensureOtkCreatedHistory(log)
    const newUrls = (log.photo_urls ?? []).filter((_, i) => i !== index)
    await updateOtkLog(logId, { photo_urls: newUrls })
    await addOtkLogHistory({ log_id: logId, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'updated', old_values: { photo_urls: log.photo_urls ?? [] }, new_values: { photo_urls: newUrls } })
    setOtkLogs((prev) => prev.map((l) => l.id === logId ? { ...l, photo_urls: newUrls } : l))
    setOtkLogHistories((prev) => { const { [logId]: _, ...rest } = prev; return rest })
    setIsDirty(true)
  }

  // ═══════════════ Маркировка — handlers ═══════════════════════

  const handleAddMarkingLog = () => {
    const qty = Number(markingQty) || 0
    const qtyDefect = Number(markingDefect) || 0
    if (qty <= 0 && qtyDefect <= 0) return
    setMarkingBuffer((prev) => [...prev, {
      tempId: crypto.randomUUID(),
      performer_user_id: markingPerformerId || null,
      performer_name: markingPerformerName || userEmail || '',
      tariff: markingTariff,
      qty: Math.max(qty, 1), // qty > 0 constraint
      qty_defect: qtyDefect,
      notes: markingNotes.trim(),
      photo_files: markingPhotoFiles,
    }])
    setIsDirty(true)
    setMarkingQty('')
    setMarkingDefect('')
    setMarkingNotes('')
    setMarkingPhotoFiles([])
  }

  const handleDeleteMarkingLog = (id: string) => { setMarkingDeleteConfirmId(id) }

  const handleConfirmDeleteMarkingLog = () => {
    const id = markingDeleteConfirmId
    if (!id) return
    setMarkingDeleteConfirmId(null)
    if (markingBuffer.some((e) => e.tempId === id)) {
      setMarkingBuffer((prev) => prev.filter((e) => e.tempId !== id))
    } else {
      setMarkingDeletedIds((prev) => [...prev, id])
    }
    setIsDirty(true)
  }

  const handleAddMarkingPhoto = async (logId: string, file: File) => {
    const log = markingLogs.find((l) => l.id === logId)
    if (!log) return
    const url = await uploadMarkingPhoto(userId || 'anon', batch.id, file)
    const newUrls = [...(log.photo_urls ?? []), url]
    await updateMarkingLog(logId, { photo_urls: newUrls })
    setMarkingLogs((prev) => prev.map((l) => l.id === logId ? { ...l, photo_urls: newUrls } : l))
    setIsDirty(true)
  }

  const handleReplaceMarkingPhoto = async (logId: string, index: number, file: File) => {
    const log = markingLogs.find((l) => l.id === logId)
    if (!log) return
    const url = await uploadMarkingPhoto(userId || 'anon', batch.id, file)
    const newUrls = [...(log.photo_urls ?? [])]
    newUrls[index] = url
    await updateMarkingLog(logId, { photo_urls: newUrls })
    setMarkingLogs((prev) => prev.map((l) => l.id === logId ? { ...l, photo_urls: newUrls } : l))
    setIsDirty(true)
  }

  const handleRemoveMarkingPhoto = async (logId: string, index: number) => {
    const log = markingLogs.find((l) => l.id === logId)
    if (!log) return
    const newUrls = (log.photo_urls ?? []).filter((_, i) => i !== index)
    await updateMarkingLog(logId, { photo_urls: newUrls })
    setMarkingLogs((prev) => prev.map((l) => l.id === logId ? { ...l, photo_urls: newUrls } : l))
    setIsDirty(true)
  }

  const handleSaveMarkingAll = async () => {
    setIsSavingDraft(true)
    setError(null)
    try {
      const deletedLogsNow = markingLogs.filter((l) => markingDeletedIds.includes(l.id))
      await Promise.all(deletedLogsNow.map(async (log) => {
        await deleteMarkingLog(log.id)
        await addMarkingLogHistory({ log_id: log.id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'deleted', old_values: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [] }, new_values: {} })
      }))
      await Promise.all(Object.entries(markingEdits).map(async ([id, v]) => {
        const originalLog = markingLogs.find((l) => l.id === id)
        await updateMarkingLog(id, v)
        if (originalLog) {
          const oldVals: Record<string, unknown> = {}
          const newVals: Record<string, unknown> = {}
          for (const k of Object.keys(v) as Array<keyof typeof v>) {
            if (originalLog[k as keyof typeof originalLog] !== v[k]) {
              oldVals[k] = originalLog[k as keyof typeof originalLog]
              newVals[k] = v[k]
            }
          }
          if (Object.keys(newVals).length > 0) {
            await addMarkingLogHistory({ log_id: id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'updated', old_values: oldVals, new_values: newVals })
          }
        }
      }))
      const newLogs = await Promise.all(markingBuffer.map(async (e) => {
        const photoUrls = e.photo_files.length > 0
          ? await Promise.all(e.photo_files.map((f) => uploadMarkingPhoto(userId || 'anon', batch.id, f)))
          : []
        const log = await addMarkingLog({
          batch_id: batch.id,
          user_id: userId || '',
          user_email: userEmail || '',
          user_name: userName || null,
          performer_user_id: e.performer_user_id,
          performer_name: e.performer_name,
          tariff: e.tariff,
          qty: e.qty,
          qty_defect: e.qty_defect,
          notes: e.notes || undefined,
          photo_urls: photoUrls,
        })
        await addMarkingLogHistory({ log_id: log.id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'created', old_values: null, new_values: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: photoUrls } })
        return log
      }))
      setMarkingLogs((prev) => {
        const filtered = prev.filter((l) => !markingDeletedIds.includes(l.id))
        const updated = filtered.map((l) => markingEdits[l.id] ? { ...l, ...markingEdits[l.id] } : l)
        return [...updated, ...newLogs]
      })
      setMarkingDeletedLogs((prev) => [...prev, ...deletedLogsNow.map((l) => ({ ...l, deleted_at: new Date().toISOString() }))])
      // Инвалидируем кеш истории для изменённых/удалённых логов
      const affectedIds = [...Object.keys(markingEdits), ...markingDeletedIds]
      if (affectedIds.length > 0) {
        setMarkingLogHistories((prev) => {
          const next = { ...prev }
          for (const id of affectedIds) delete next[id]
          return next
        })
        for (const id of affectedIds) markingHistoryLoadingIds.current.delete(id)
      }
      setMarkingBuffer([])
      setMarkingEdits({})
      setMarkingDeletedIds([])
      setMarkingEditingId(null)
      setIsDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSavingDraft(false)
    }
  }

  const handleMarkingAndAdvance = async () => {
    setIsSavingStage(true)
    setError(null)
    try {
      if (markingBuffer.length > 0 || Object.keys(markingEdits).length > 0 || markingDeletedIds.length > 0) {
        await Promise.all(markingDeletedIds.map(async (id) => {
          const log = markingLogs.find((l) => l.id === id)
          await deleteMarkingLog(id)
          if (log) await addMarkingLogHistory({ log_id: id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'deleted', old_values: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [] }, new_values: {} })
        }))
        await Promise.all(Object.entries(markingEdits).map(async ([id, v]) => {
          const originalLog = markingLogs.find((l) => l.id === id)
          await updateMarkingLog(id, v)
          if (originalLog) {
            const oldVals: Record<string, unknown> = {}
            const newVals: Record<string, unknown> = {}
            for (const k of Object.keys(v) as Array<keyof typeof v>) {
              if (originalLog[k as keyof typeof originalLog] !== v[k]) {
                oldVals[k] = originalLog[k as keyof typeof originalLog]
                newVals[k] = v[k]
              }
            }
            if (Object.keys(newVals).length > 0) {
              await addMarkingLogHistory({ log_id: id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'updated', old_values: oldVals, new_values: newVals })
            }
          }
        }))
        await Promise.all(markingBuffer.map(async (e) => {
          const photoUrls = e.photo_files.length > 0
            ? await Promise.all(e.photo_files.map((f) => uploadMarkingPhoto(userId || 'anon', batch.id, f)))
            : []
          const log = await addMarkingLog({
            batch_id: batch.id,
            user_id: userId || '',
            user_email: userEmail || '',
            user_name: userName || null,
            performer_user_id: e.performer_user_id,
            performer_name: e.performer_name,
            tariff: e.tariff,
            qty: e.qty,
            qty_defect: e.qty_defect,
            notes: e.notes || undefined,
            photo_urls: photoUrls,
          })
          await addMarkingLogHistory({ log_id: log.id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'created', old_values: null, new_values: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: photoUrls } })
        }))
        setMarkingBuffer([])
        setMarkingEdits({})
        setMarkingDeletedIds([])
      }
      const updated = await advanceStage(batch)
      const newBatch = { ...batch, ...updated }
      setBatch(newBatch)
      onBatchUpdated(updated)
      setIsDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSavingStage(false)
    }
  }

  // ОТК — продвинуть этап (сначала сохраняет буфер, затем переходит)
  const handleAdvanceOtk = async () => {
    setIsSavingStage(true)
    setError(null)
    try {
      // Сохранить буфер перед переходом
      if (otkBuffer.length > 0 || Object.keys(otkEdits).length > 0 || otkDeletedIds.length > 0) {
        await Promise.all(otkDeletedIds.map((id) => deleteOtkLog(id)))
        await Promise.all(Object.entries(otkEdits).map(([id, v]) => updateOtkLog(id, v)))
        await Promise.all(otkBuffer.map(async (e) => {
          const photoUrls = e.photo_files.length > 0
            ? await Promise.all(e.photo_files.map((f) => uploadOtkPhoto(userId || 'anon', batch.id, f)))
            : []
          return addOtkLog({
            batch_id: batch.id,
            user_id: userId || '',
            user_email: userEmail || '',
            user_name: userName || null,
            performer_user_id: e.performer_user_id,
            performer_name: e.performer_name,
            tariff: e.tariff,
            qty: e.qty,
            qty_defect: e.qty_defect,
            notes: e.notes || undefined,
            photo_urls: photoUrls,
          })
        }))
        setOtkBuffer([])
        setOtkEdits({})
        setOtkDeletedIds([])
      }
      const updated = await advanceStage(batch)
      const newBatch = { ...batch, ...updated }
      setBatch(newBatch)
      onBatchUpdated(updated)
      setIsDirty(false)
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
      // Сохранить несохранённые qty_received перед переходом
      const toUpdate = items.filter((it) => receptionDraft[it.id] !== undefined && receptionDraft[it.id] !== it.qty_received)
      await Promise.all(toUpdate.map((it) => updateItem(it.id, { qty_received: receptionDraft[it.id] })))
      const updated = await advanceStage(batch)
      const newBatch = { ...batch, ...updated }
      setBatch(newBatch)
      onBatchUpdated(updated)
      setIsDirty(false)
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
      setIsDirty(false)
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
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4" style={{ zIndex }} onClick={() => isDirty ? setPendingClose(true) : onClose()}>
      <div
        className="flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 border-b border-slate-100 px-6 py-4">
          <div className="flex-1 flex items-baseline gap-2 min-w-0">
            <p className="text-lg font-semibold text-slate-800 truncate">{batch.name}</p>
            {store && <p className="shrink-0 text-sm text-slate-400">{store.name}</p>}
          </div>
          <button type="button" onClick={() => {
            setOtkHistoryStageTab(viewStage)
            if (viewStage === 'otk' && otkLogs.length > 0 && !otkHistoryTabId) setOtkHistoryTabId(otkLogs[0].id)
            if (viewStage === 'marking') {
              if (markingLogs.length === 0 && markingDeletedLogs.length === 0) {
                Promise.all([fetchMarkingLogs(batch.id), fetchDeletedMarkingLogs(batch.id)])
                  .then(([active, deleted]) => {
                    setMarkingLogs(active)
                    setMarkingDeletedLogs(deleted)
                    const all = [...active, ...deleted].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                    if (all.length > 0 && !markingHistoryTabId) setMarkingHistoryTabId(all[0].id)
                  })
                  .catch(() => {})
              } else {
                // Всегда перезагружаем удалённые логи чтобы показать актуальный список
                void fetchDeletedMarkingLogs(batch.id).then(setMarkingDeletedLogs).catch(() => {})
                const all = [...markingLogs, ...markingDeletedLogs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                if (all.length > 0 && !markingHistoryTabId) setMarkingHistoryTabId(all[0].id)
              }
            }
            setHistoryOpen(true)
          }}
            className="flex h-8 items-center gap-1.5 rounded-2xl border border-slate-200 px-2.5 text-xs font-medium text-slate-500 hover:bg-slate-50">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            История
          </button>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[batch.status]}`}>
            {STATUS_LABELS[batch.status]}
          </span>
          <button type="button" onClick={() => isDirty ? setPendingClose(true) : onClose()} className="flex h-8 w-8 items-center justify-center rounded-2xl text-slate-400 hover:bg-slate-100">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stage progress */}
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start" style={{ minHeight: 96 }}>
            {(['reception', 'otk', 'marking', 'packing', 'logistics'] as FulfillmentStage[]).map((s, idx, arr) => {
              const stageIdx = STAGE_ORDER.indexOf(s)
              const currentStageIdx = STAGE_ORDER.indexOf(batch.current_stage)
              const isDone = currentStageIdx > stageIdx
              const isCurrent = batch.current_stage === s
              const isPast = stageIdx <= currentStageIdx
              const isLast = idx === arr.length - 1
              // этап включён?
              const keyMap: Record<string, keyof typeof batch> = { otk: 'stage_otk', marking: 'stage_marking', packing: 'stage_packing', logistics: 'stage_logistics' }
              const stageKey = keyMap[s]
              const isEnabled = s === 'reception' || !stageKey || batch[stageKey] as boolean
              const canToggle = canManage && batch.status === 'active' && !isPast && !!stageKey && !isSavingBatchStages

              const handleClick = () => {
                if (isPast && canStageJump && isEnabled) {
                  setViewStage(s)
                } else if (canToggle) {
                  void handleToggleBatchStage(stageKey as 'stage_otk' | 'stage_marking' | 'stage_packing' | 'stage_logistics', !isEnabled)
                }
              }

              const isClickable = (isPast && canStageJump && isEnabled) || canToggle
              const dotColor = isDone ? 'bg-emerald-500' : 'bg-blue-600'
              const isSelected = viewStage === s

              return (
                <div key={s} className={`flex flex-col ${isLast ? '' : 'flex-1'}`}>
                  <div className="flex w-full items-center" style={{ height: 64 }}>
                    <div className="flex w-16 shrink-0 items-center justify-center">
                      <div className="relative flex items-center justify-center">
                        {/* Фоновый шар выбранного этапа */}
                        <div className={`absolute w-20 h-20 rounded-full pointer-events-none transition-all duration-500 ease-out left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                          ${isDone ? 'bg-emerald-200' : isCurrent ? 'bg-blue-200' : 'bg-slate-200'}
                          ${isSelected ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} />
                      <button
                        type="button"
                        onClick={handleClick}
                        disabled={!isClickable}
                        title={
                          isPast && canStageJump && isEnabled
                            ? `Перейти: ${STAGE_LABELS[s]}`
                            : canToggle
                              ? (isEnabled ? 'Отключить этап' : 'Включить этап')
                              : undefined
                        }
                        className={`relative z-10 flex shrink-0 items-center justify-center rounded-full font-bold transition-all duration-300 ease-in-out
                          ${isSelected ? 'h-16 w-16' : 'h-12 w-12'}
                          ${isClickable ? 'cursor-pointer' : 'cursor-default'}
                          ${isDone ? 'bg-emerald-500 text-white' :
                            isCurrent ? 'bg-blue-600 text-white' :
                            !isEnabled ? 'border-2 border-dashed border-slate-200 bg-white text-slate-300' :
                            canToggle ? 'bg-slate-100 text-slate-400 hover:bg-slate-200' :
                            'bg-slate-100 text-slate-400'}`}>
                        {isDone ? (
                          <svg viewBox="0 0 24 24" className={`transition-all duration-300 ease-in-out ${isSelected ? 'h-7 w-7' : 'h-5 w-5'}`} fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : !isEnabled ? (
                          <svg viewBox="0 0 24 24" className={`transition-all duration-300 ease-in-out ${isSelected ? 'h-7 w-7' : 'h-5 w-5'}`} fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        ) : (
                          <span className={`transition-all duration-300 ease-in-out leading-none ${isSelected ? 'text-2xl' : 'text-sm'}`}>{idx + 1}</span>
                        )}
                      </button>
                      </div>
                    </div>
                    {!isLast && (() => {
                      const km: Record<string, keyof typeof batch> = { otk: 'stage_otk', marking: 'stage_marking', packing: 'stage_packing', logistics: 'stage_logistics' }
                      const getEnabled = (st: FulfillmentStage) => st === 'reception' || !km[st] || (batch[km[st]] as boolean)
                      const getColor = (st: FulfillmentStage) => {
                        const si = STAGE_ORDER.indexOf(st)
                        if (currentStageIdx > si) return 'bg-emerald-400'
                        if (batch.current_stage === st) return 'bg-blue-500'
                        return 'bg-slate-200'
                      }
                      // Ближайший включённый слева (включая idx)
                      let li = -1
                      for (let i = idx; i >= 0; i--) { if (getEnabled(arr[i])) { li = i; break } }
                      // Ближайший включённый справа (включая idx+1)
                      let ri = -1
                      for (let i = idx + 1; i < arr.length; i++) { if (getEnabled(arr[i])) { ri = i; break } }

                      const lColor = li >= 0 ? getColor(arr[li]) : 'bg-slate-200'
                      const rColor = ri >= 0 ? getColor(arr[ri]) : 'bg-slate-200'

                      let lineLeft: string, lineRight: string
                      if (li < 0 || ri < 0) {
                        lineLeft = lineRight = li >= 0 ? lColor : rColor
                      } else {
                        const spanCount = ri - li  // кол-во сегментов в пролёте
                        const segPos = idx - li    // позиция этого сегмента внутри пролёта (0-based)
                        if (spanCount === 1) {
                          // единственный сегмент: ровно 50/50
                          lineLeft = lColor; lineRight = rColor
                        } else if (spanCount % 2 === 0) {
                          // чётное кол-во: первая половина — lColor, вторая — rColor
                          lineLeft = lineRight = segPos < spanCount / 2 ? lColor : rColor
                        } else {
                          // нечётное: средний сегмент делится пополам, остальные — сплошные
                          const mid = Math.floor(spanCount / 2)
                          if (segPos < mid) { lineLeft = lineRight = lColor }
                          else if (segPos > mid) { lineLeft = lineRight = rColor }
                          else { lineLeft = lColor; lineRight = rColor }
                        }
                      }
                      return (
                        <div className="flex h-0.5 flex-1">
                          <div className={`flex-1 ${lineLeft}`} />
                          <div className={`flex-1 ${lineRight}`} />
                        </div>
                      )
                    })()}
                  </div>
                  <div className="flex w-16 flex-col items-center">
                    <span className={`mt-2 text-center text-xs font-medium leading-tight
                      ${isDone ? 'text-emerald-600' : isCurrent ? 'text-blue-600' : !isEnabled ? 'text-slate-300 line-through' : 'text-slate-400'}`}>
                      {STAGE_LABELS[s]}
                    </span>
                    {/* Dot — всегда в DOM, анимированно выезжает из-за родителя */}
                    {canStageJump && isEnabled && (isDone || isCurrent) && (
                      <div
                        className={`mt-1.5 h-3.5 w-3.5 rounded-full transition-all duration-500 ease-out pointer-events-none
                          ${dotColor}
                          ${isSelected
                            ? 'translate-y-0 scale-100 opacity-100'
                            : '-translate-y-12 scale-0 opacity-0'}`}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-scroll px-6 py-4 [scrollbar-color:theme(colors.slate.300)_transparent] [scrollbar-width:thin]">
          {error && <div className="mb-4 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>}

          {/* Сводная статистика — для всех этапов кроме приёмки */}
          {viewStage !== 'reception' && viewStage !== 'done' && (() => {
            const sReceived = items.reduce((s, it) => s + (it.qty_received ?? 0), 0)
            const sOtk = otkLogs.filter((l) => !otkDeletedIds.includes(l.id))
              .reduce((s, l) => s + (otkEdits[l.id]?.qty ?? l.qty) + (otkEdits[l.id]?.qty_defect ?? l.qty_defect), 0) +
              (viewStage === 'otk' ? otkBuffer.reduce((s, e) => s + e.qty + e.qty_defect, 0) : 0)
            const sMarking = viewStage === 'marking' || viewStage === 'packing' || viewStage === 'logistics'
              ? (viewStage === 'marking'
                  ? markingLogs.filter((l) => !markingDeletedIds.includes(l.id)).reduce((s, l) => s + (markingEdits[l.id]?.qty ?? l.qty) + (markingEdits[l.id]?.qty_defect ?? l.qty_defect), 0) + markingBuffer.reduce((s, e) => s + e.qty + e.qty_defect, 0)
                  : items.reduce((s, it) => s + (it.qty_marked ?? it.qty_otk ?? it.qty_received), 0))
              : null
            const sPacking = viewStage === 'packing' || viewStage === 'logistics'
              ? (viewStage === 'packing'
                  ? items.reduce((s, it) => s + (stageDraft[it.id]?.qty ?? it.qty_packed ?? it.qty_marked ?? it.qty_otk ?? it.qty_received), 0)
                  : items.reduce((s, it) => s + (it.qty_packed ?? it.qty_marked ?? it.qty_otk ?? it.qty_received), 0))
              : null
            const cards: Array<{ label: string; value: number; isDiff: boolean }> = [
              { label: 'Принято', value: sReceived, isDiff: false },
              { label: 'ОТК итого', value: sOtk, isDiff: false },
            ]
            if (viewStage === 'otk') cards.push({ label: 'Расхождение', value: sOtk - sReceived, isDiff: true })
            if (sMarking !== null) {
              cards.push({ label: 'Маркировка', value: sMarking, isDiff: false })
              cards.push({ label: 'Расхождение', value: sMarking - sOtk, isDiff: true })
            }
            if (sPacking !== null) {
              cards.push({ label: 'Короба', value: sPacking, isDiff: false })
              cards.push({ label: 'Расхождение', value: sPacking - (sMarking ?? sOtk), isDiff: true })
            }
            const PRIMARY_COLORS = [
              ['text-emerald-700', 'bg-emerald-50', 'text-emerald-500'],
              ['text-blue-700', 'bg-blue-50', 'text-blue-400'],
              ['text-violet-700', 'bg-violet-50', 'text-violet-500'],
              ['text-purple-700', 'bg-purple-50', 'text-purple-500'],
            ]
            let pIdx = 0
            return (
              <div className="mb-4 flex gap-2">
                {cards.map((card, i) => {
                  if (card.isDiff) {
                    const d = card.value
                    return (
                      <div key={i} className={`flex-1 rounded-2xl px-3 py-3 text-center ${d === 0 ? 'bg-emerald-50' : d > 0 ? 'bg-amber-50' : 'bg-red-50'}`}>
                        <p className={`text-xl font-bold ${d === 0 ? 'text-emerald-700' : d > 0 ? 'text-amber-700' : 'text-red-600'}`}>{d > 0 ? `+${d}` : d}</p>
                        <p className={`text-xs ${d === 0 ? 'text-emerald-500' : d > 0 ? 'text-amber-500' : 'text-red-400'}`}>{card.label}</p>
                      </div>
                    )
                  }
                  const clrs = PRIMARY_COLORS[pIdx++ % PRIMARY_COLORS.length]
                  return (
                    <div key={i} className={`flex-1 rounded-2xl px-3 py-3 text-center ${clrs[1]}`}>
                      <p className={`text-xl font-bold ${clrs[0]}`}>{card.value}</p>
                      <p className={`text-xs ${clrs[2]}`}>{card.label}</p>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* ПРИЁМКА */}
          {viewStage === 'reception' && (
            <div className="space-y-4">

              {/* Переключатель режимов */}
              {canManage && (
                <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-0.5 w-fit">
                  {([
                    ['bulk', 'Навалом'],
                    ['subject', 'По предмету'],
                    ['catalog', 'Из каталога'],
                    ['barcode', 'По баркоду'],
                    ['boxes', 'Готовые короба'],
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
                    <input type="text" inputMode="numeric" value={newQty} onChange={(e) => setNewQty(e.target.value)}
                      placeholder="0"
                      className="w-20 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <button type="button" onClick={() => void handleAddItem()}
                    disabled={isAddingSaving || !newBarcode.trim() || Number(newQty) < 1}
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
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Кол-во единиц *</span>
                      <input type="text" inputMode="numeric" value={bulkQty} onChange={(e) => setBulkQty(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleBulkAdd() }}
                        placeholder="0"
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
                      disabled={isAddingSaving || Number(bulkQty) < 1}
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
                    <input type="text" inputMode="numeric" value={subjectQty} onChange={(e) => setSubjectQty(e.target.value)}
                      placeholder="0"
                      className="w-24 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <button type="button" onClick={() => void handleSubjectAdd()}
                    disabled={isAddingSaving || !subjectName.trim() || Number(subjectQty) < 1}
                    className="flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                    Добавить
                  </button>
                </div>
              )}

              {/* Режим: Готовые короба */}
              {canManage && addMode === 'boxes' && (
                <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-orange-50 p-3 border border-orange-100">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-400">Наименование</span>
                    <input type="text" value={boxesName} onChange={(e) => setBoxesName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleBoxesAdd() }}
                      placeholder="Готовые короба"
                      className="w-48 rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-400">Единиц *</span>
                    <input type="text" inputMode="numeric" value={boxesQty} onChange={(e) => setBoxesQty(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleBoxesAdd() }}
                      placeholder="0"
                      className="w-24 rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-400">Коробов *</span>
                    <input type="text" inputMode="numeric" value={boxesCount} onChange={(e) => setBoxesCount(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleBoxesAdd() }}
                      placeholder="0"
                      className="w-24 rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                    />
                  </div>
                  <button type="button" onClick={() => void handleBoxesAdd()}
                    disabled={isAddingSaving || Number(boxesQty) < 1 || Number(boxesCount) < 1}
                    className="flex h-9 items-center gap-1.5 rounded-xl bg-orange-500 px-4 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                    Добавить
                  </button>
                  <p className="w-full text-xs text-orange-400">Позиция будет сразу помечена как упакованная — этапы маркировки/упаковки можно пропустить.</p>
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
                        <th className="px-4 py-2.5 text-left">Наименование</th>
                        <th className="px-4 py-2.5 text-left">Размер</th>
                        <th className="px-3 py-2.5 text-center">Принято</th>
                        {items.some((i) => i.boxes) && <th className="px-3 py-2.5 text-center">Коробов</th>}
                        {canManage && <th className="px-3 py-2.5" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((it) => (
                        <tr key={it.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-2.5 text-slate-700">{it.product_name ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-500">{it.size ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-3 py-2.5 text-center">
                            {canManage ? (
                              <input type="number" min={0} value={receptionDraft[it.id] ?? it.qty_received}
                                onChange={(e) => handleUpdateReceivedDraft(it.id, Number(e.target.value))}
                                className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-300"
                              />
                            ) : <span className="font-medium">{it.qty_received}</span>}
                          </td>
                          {items.some((i) => i.boxes) && (
                            <td className="px-3 py-2.5 text-center text-sm">
                              {it.boxes
                                ? <span className="font-medium text-orange-600">{it.boxes}</span>
                                : <span className="text-slate-300">—</span>}
                            </td>
                          )}
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
                        {items.some((i) => i.boxes) && <td className="px-3 py-2.5 text-center text-slate-800">{items.reduce((s, i) => s + (i.boxes ?? 0), 0) || '—'}</td>}
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
          {viewStage === 'otk' && (() => {
            const tReceived = items.reduce((s, it) => s + (it.qty_received ?? 0), 0)
            const tOtk = otkLogs.filter((l) => !otkDeletedIds.includes(l.id)).reduce((s, l) => s + (otkEdits[l.id]?.qty ?? l.qty) + (otkEdits[l.id]?.qty_defect ?? l.qty_defect), 0) + otkBuffer.reduce((s, e) => s + e.qty + e.qty_defect, 0)
            const diff = tOtk - tReceived
            const canAdvance = canManage || tOtk >= tReceived
            return (
              <div className="space-y-4">
                {/* Форма добавления работы */}
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="mb-3 text-sm font-medium text-slate-700">Добавить выполненную работу</p>
                  <div className="flex flex-wrap gap-2">
                    {/* Исполнитель */}
                    {canOtkAssign && otkPerformers.length > 0 ? (
                      <select
                        value={otkPerformerId}
                        onChange={(e) => {
                          const p = otkPerformers.find((x) => x.user_id === e.target.value)
                          setOtkPerformerId(e.target.value)
                          setOtkPerformerName(p?.full_name || e.target.value)
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {otkPerformers.map((p) => (
                          <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        {otkPerformerName || userEmail}
                      </div>
                    )}
                    {/* Тариф */}
                    <select
                      value={otkTariff}
                      onChange={(e) => setOtkTariff(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {OTK_TARIFFS.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                    {/* Кол-во принятых */}
                    <input
                      type="number"
                      min="1"
                      placeholder="Кол-во"
                      value={otkQty}
                      onChange={(e) => setOtkQty(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleAddOtkLog() }}
                      className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {/* Кол-во брака */}
                    <input
                      type="number"
                      min="0"
                      placeholder="Брак"
                      value={otkDefect}
                      onChange={(e) => setOtkDefect(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleAddOtkLog() }}
                      className="w-20 rounded-xl border border-red-200 px-3 py-2 text-sm text-red-700 placeholder-red-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-red-400"
                    />
                    {/* Примечание */}
                    <input
                      type="text"
                      placeholder="Примечание"
                      value={otkNotes}
                      onChange={(e) => setOtkNotes(e.target.value)}
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {/* Фото */}
                    <input
                      ref={otkFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? [])
                        if (files.length) setOtkPhotoFiles((prev) => [...prev, ...files])
                        e.target.value = ''
                      }}
                    />
                    <button
                      type="button"
                      title="Прикрепить фото"
                      onClick={() => otkFileInputRef.current?.click()}
                      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-slate-400 hover:bg-slate-50 hover:text-blue-500 ${otkPhotoFiles.length > 0 ? 'border-blue-400 text-blue-500' : 'border-slate-200'}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                      </svg>
                      {otkPhotoFiles.length > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
                          {otkPhotoFiles.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAddOtkLog()}
                      disabled={isAddingOtk || ((!otkQty || Number(otkQty) <= 0) && (!otkDefect || Number(otkDefect) <= 0))}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isAddingOtk ? 'Сохранение…' : '+ Добавить'}
                    </button>
                  </div>
                  {/* Превью прикреплённых фото */}
                  {otkPhotoFiles.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {otkPhotoFiles.map((f, i) => (
                        <div key={i} className="group relative">
                          <img
                            src={URL.createObjectURL(f)}
                            alt={f.name}
                            className="h-16 w-16 rounded-lg object-cover border border-slate-200"
                          />
                          <button
                            type="button"
                            onClick={() => setOtkPhotoFiles((prev) => prev.filter((_, j) => j !== i))}
                            className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs group-hover:flex"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Журнал работ */}
                {isLoadingOtk ? (
                  <div className="py-6 text-center text-sm text-slate-400">Загрузка…</div>
                ) : otkLogs.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
                    Записей нет — добавьте первую работу
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-slate-500">
                        {/* Итого — первая строка над шапкой */}
                        <tr className="bg-slate-100 border-b border-slate-200">
                          <th colSpan={8} className="px-4 py-2.5 font-normal">
                            {(() => {
                              const activeLogs = otkLogs.filter((l) => !otkDeletedIds.includes(l.id))
                              const allEntries = [...activeLogs, ...otkBuffer]
                              const performers = new Set([
                                ...activeLogs.map((l) => l.performer_user_id ?? l.user_id),
                                ...otkBuffer.map((e) => e.performer_user_id ?? e.user_id),
                              ]).size
                              const tariffs = new Set([
                                ...activeLogs.map((l) => otkEdits[l.id]?.tariff ?? l.tariff),
                                ...otkBuffer.map((e) => e.tariff),
                              ]).size
                              const totalGood = activeLogs.reduce((s, l) => s + (otkEdits[l.id]?.qty ?? l.qty), 0) + otkBuffer.reduce((s, e) => s + e.qty, 0)
                              const totalDefect = activeLogs.reduce((s, l) => s + (otkEdits[l.id]?.qty_defect ?? l.qty_defect), 0) + otkBuffer.reduce((s, e) => s + e.qty_defect, 0)
                              const totalNotes = allEntries.filter((e) => ('notes' in e ? e.notes : (otkEdits[(e as FulfillmentOtkLog).id]?.notes ?? (e as FulfillmentOtkLog).notes ?? '')) !== '').length
                              const totalPhotos = activeLogs.filter((l) => l.photo_urls && l.photo_urls.length > 0).length + otkBuffer.filter((e) => e.photo_files.length > 0).length
                              const stats: { label: string; value: number | string; color?: string }[] = [
                                { label: 'Исполнителей', value: performers },
                                { label: 'Тарифов', value: tariffs },
                                { label: 'Годных', value: totalGood },
                                { label: 'Браков', value: totalDefect, color: totalDefect > 0 ? 'text-red-600' : undefined },
                                { label: 'Итого ОТК', value: totalGood + totalDefect },
                                { label: 'Примечаний', value: totalNotes },
                                { label: 'Фото', value: totalPhotos },
                              ]
                              return (
                                <div className="flex w-full items-center justify-between">
                                  <span className="font-semibold text-slate-600">Итого</span>
                                  {stats.map(({ label, value, color }) => (
                                    <span key={label} className="text-slate-500">
                                      {label}: <span className={`font-semibold ${color ?? 'text-slate-800'}`}>{value}</span>
                                    </span>
                                  ))}
                                </div>
                              )
                            })()}
                          </th>
                        </tr>
                        <tr className="bg-slate-50">
                          <th className="px-4 py-2.5 text-left font-medium">Время</th>
                          <th className="px-4 py-2.5 text-left font-medium">Исполнитель</th>
                          <th className="px-4 py-2.5 text-left font-medium">Тариф</th>
                          <th className="px-3 py-2.5 text-center font-medium">Годный</th>
                          <th className="px-3 py-2.5 text-center font-medium">Брак</th>
                          <th className="px-3 py-2.5 text-left font-medium">Примечание</th>
                          <th className="px-3 py-2.5 text-left font-medium">Фото</th>
                          <th className="w-10 px-3 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {otkLogs.filter((l) => !otkDeletedIds.includes(l.id)).map((log) => {
                          const isEditing = otkEditingId === log.id
                          const edit = otkEdits[log.id] ?? { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '' }
                          const logTime = new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
                          const logDate = new Date(log.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
                          const isOwn = log.user_id === userId
                          if (isEditing) {
                            return (
                              <tr key={log.id} className="bg-amber-50/60">
                                <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                                  <div className="flex flex-col items-start">
                                    <span className="text-xs text-slate-400">{logTime}</span>
                                    <span className="text-xs text-slate-400">{logDate}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-slate-500 text-xs max-w-[140px] truncate">{log.performer_name}</td>
                                <td className="px-4 py-2">
                                  <select value={edit.tariff} onChange={(e) => setOtkEdits((p) => ({ ...p, [log.id]: { ...edit, tariff: e.target.value } }))}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                    {OTK_TARIFFS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                                  </select>
                                </td>
                                <td className="px-3 py-2">
                                  <input type="number" min={0} value={edit.qty}
                                    onChange={(e) => setOtkEdits((p) => ({ ...p, [log.id]: { ...edit, qty: Number(e.target.value) } }))}
                                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                </td>
                                <td className="px-3 py-2">
                                  <input type="number" min={0} value={edit.qty_defect}
                                    onChange={(e) => setOtkEdits((p) => ({ ...p, [log.id]: { ...edit, qty_defect: Number(e.target.value) } }))}
                                    className="w-16 rounded-lg border border-red-200 px-2 py-1 text-center text-xs text-red-700 focus:outline-none focus:ring-1 focus:ring-red-300" />
                                </td>
                                <td className="px-3 py-2">
                                  <input type="text" value={edit.notes}
                                    onChange={(e) => setOtkEdits((p) => ({ ...p, [log.id]: { ...edit, notes: e.target.value } }))}
                                    className="w-full min-w-0 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                </td>
                                <td className="px-3 py-2" />
                                <td className="px-3 py-2">
                                  <div className="flex gap-1">
                                    <button type="button" onClick={() => { setIsDirty(true); setOtkEditingId(null) }}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Применить">
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                    </button>
                                    <button type="button" onClick={() => { setOtkEdits((p) => { const n = { ...p }; delete n[log.id]; return n }); setOtkEditingId(null) }}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" title="Отмена">
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          }
                          const displayTariff = OTK_TARIFFS.find((t) => t.id === edit.tariff)?.label ?? edit.tariff
                          const hasEdit = !!otkEdits[log.id]
                          return (
                            <tr key={log.id} className={hasEdit ? 'bg-amber-50/30' : isOwn ? 'bg-blue-50/40' : ''}>
                              <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => { setOtkHistoryLog(log); setOtkHistoryTabId(log.id) }}
                                  className="group flex flex-col items-start text-left"
                                  title="Посмотреть историю"
                                >
                                  <span className="text-xs text-slate-700 group-hover:text-blue-600 transition-colors">{logTime}</span>
                                  <span className="text-xs text-slate-500 group-hover:text-blue-600 transition-colors">{logDate}</span>
                                </button>
                              </td>
                              <td className="px-4 py-2.5 text-slate-700 max-w-[140px] truncate" title={log.user_email}>{log.performer_name}</td>
                              <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{displayTariff}</td>
                              <td className="px-3 py-2.5 text-center font-semibold text-slate-800">{edit.qty}</td>
                              <td className="px-3 py-2.5 text-center">
                                {edit.qty_defect > 0
                                  ? <span className="font-semibold text-red-600">{edit.qty_defect}</span>
                                  : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-2.5 text-slate-500 text-xs">{edit.notes}</td>
                              <td className="px-3 py-2.5">
                                <InvoicePhotoCell
                                  photoUrls={log.photo_urls ?? []}
                                  onAdd={(isOwn || canManage) ? (file) => handleAddOtkPhoto(log.id, file) : undefined}
                                  onReplace={(isOwn || canManage) ? (idx, file) => handleReplaceOtkPhoto(log.id, idx, file) : undefined}
                                  onRemove={(isOwn || canManage) ? (idx) => handleRemoveOtkPhoto(log.id, idx) : undefined}
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                {(isOwn || canManage) && (
                                  <div className="flex gap-1">
                                    <button type="button"
                                      onClick={() => { setOtkEdits((p) => ({ ...p, [log.id]: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '' } })); setOtkEditingId(log.id) }}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-500" title="Редактировать">
                                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </button>
                                    <button type="button" onClick={() => handleDeleteOtkLog(log.id)}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="Удалить">
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                        {/* Буферные строки — ещё не сохранены */}
                        {otkBuffer.map((entry) => {
                          const isEditing = otkEditingId === entry.tempId
                          const tariffLabel = OTK_TARIFFS.find((t) => t.id === entry.tariff)?.label ?? entry.tariff
                          if (isEditing) {
                            return (
                              <tr key={entry.tempId} className="bg-amber-50">
                                <td className="px-4 py-2 text-xs text-amber-600 italic whitespace-nowrap">Новая</td>
                                <td className="px-4 py-2 text-xs text-slate-500">{entry.performer_name}</td>
                                <td className="px-4 py-2">
                                  <select value={entry.tariff} onChange={(e) => setOtkBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, tariff: e.target.value } : x))}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                    {OTK_TARIFFS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                                  </select>
                                </td>
                                <td className="px-3 py-2">
                                  <input type="number" min={0} value={entry.qty}
                                    onChange={(e) => setOtkBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, qty: Number(e.target.value) } : x))}
                                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-xs focus:outline-none" />
                                </td>
                                <td className="px-3 py-2">
                                  <input type="number" min={0} value={entry.qty_defect}
                                    onChange={(e) => setOtkBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, qty_defect: Number(e.target.value) } : x))}
                                    className="w-16 rounded-lg border border-red-200 px-2 py-1 text-center text-xs text-red-700 focus:outline-none" />
                                </td>
                                <td className="px-3 py-2">
                                  <input type="text" value={entry.notes}
                                    onChange={(e) => setOtkBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, notes: e.target.value } : x))}
                                    className="w-full min-w-0 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                                </td>
                                <td className="px-3 py-2" />
                                <td className="px-3 py-2">
                                  <button type="button" onClick={() => setOtkEditingId(null)}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Готово">
                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                  </button>
                                </td>
                              </tr>
                            )
                          }
                          return (
                            <tr key={entry.tempId} className="bg-amber-50/70">
                              <td className="px-4 py-2.5 text-xs text-amber-600 italic whitespace-nowrap">Новая</td>
                              <td className="px-4 py-2.5 text-xs text-slate-600">{entry.performer_name}</td>
                              <td className="px-4 py-2.5 text-xs text-slate-700">{tariffLabel}</td>
                              <td className="px-3 py-2.5 text-center font-semibold text-slate-800">{entry.qty}</td>
                              <td className="px-3 py-2.5 text-center">
                                {entry.qty_defect > 0 ? <span className="font-semibold text-red-600">{entry.qty_defect}</span> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-2.5 text-xs text-slate-500">{entry.notes}</td>
                              <td className="px-3 py-2.5">
                                {entry.photo_files.length > 0 ? (
                                  <InvoicePhotoCell
                                    photoUrls={entry.photo_files.map((f) => URL.createObjectURL(f))}
                                  />
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex gap-1">
                                  <button type="button" onClick={() => setOtkEditingId(entry.tempId)}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-500" title="Редактировать">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                  </button>
                                  <button type="button" onClick={() => handleDeleteOtkLog(entry.tempId)}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="Удалить">
                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Блокировка для сотрудников */}
                {!canAdvance && tOtk > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    Расхождение с приёмкой ({tReceived - tOtk} ед.). Продвинуть этап может только Владелец или Руководящая должность.
                  </div>
                )}

                {!canAdvance && tOtk === 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    Добавьте хотя бы одну запись работы для завершения ОТК.
                  </div>
                )}
              </div>
            )
          })()}

          {/* МАРКИРОВКА */}
          {viewStage === 'marking' && (() => {
            const tReceived = items.reduce((s, it) => s + (it.qty_received ?? 0), 0)
            const tMarking = markingLogs.filter((l) => !markingDeletedIds.includes(l.id)).reduce((s, l) => s + (markingEdits[l.id]?.qty ?? l.qty) + (markingEdits[l.id]?.qty_defect ?? l.qty_defect), 0) + markingBuffer.reduce((s, e) => s + e.qty + e.qty_defect, 0)
            const canAdvance = canManage || tMarking >= tReceived
            return (
              <div className="space-y-4">
                {/* Форма добавления работы */}
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="mb-3 text-sm font-medium text-slate-700">Добавить выполненную работу</p>
                  <div className="flex flex-wrap gap-2">
                    {canOtkAssign && markingPerformers.length > 0 ? (
                      <select
                        value={markingPerformerId}
                        onChange={(e) => {
                          const p = markingPerformers.find((x) => x.user_id === e.target.value)
                          setMarkingPerformerId(e.target.value)
                          setMarkingPerformerName(p?.full_name || e.target.value)
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {markingPerformers.map((p) => (
                          <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        {markingPerformerName || userEmail}
                      </div>
                    )}
                    <select
                      value={markingTariff}
                      onChange={(e) => setMarkingTariff(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {MARKING_TARIFFS.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                    <input
                      type="number" min="1" placeholder="Кол-во" value={markingQty}
                      onChange={(e) => setMarkingQty(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddMarkingLog() }}
                      className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="number" min="0" placeholder="Брак" value={markingDefect}
                      onChange={(e) => setMarkingDefect(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddMarkingLog() }}
                      className="w-20 rounded-xl border border-red-200 px-3 py-2 text-sm text-red-700 placeholder-red-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-red-400"
                    />
                    <input
                      type="text" placeholder="Примечание" value={markingNotes}
                      onChange={(e) => setMarkingNotes(e.target.value)}
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input ref={markingFileInputRef} type="file" accept="image/*" multiple className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? [])
                        if (files.length) setMarkingPhotoFiles((prev) => [...prev, ...files])
                        e.target.value = ''
                      }}
                    />
                    <button type="button" title="Прикрепить фото" onClick={() => markingFileInputRef.current?.click()}
                      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-slate-400 hover:bg-slate-50 hover:text-blue-500 ${markingPhotoFiles.length > 0 ? 'border-blue-400 text-blue-500' : 'border-slate-200'}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                      </svg>
                      {markingPhotoFiles.length > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">{markingPhotoFiles.length}</span>
                      )}
                    </button>
                    <button type="button" onClick={handleAddMarkingLog}
                      disabled={isAddingMarking || ((!markingQty || Number(markingQty) <= 0) && (!markingDefect || Number(markingDefect) <= 0))}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                      {isAddingMarking ? 'Сохранение…' : '+ Добавить'}
                    </button>
                  </div>
                  {markingPhotoFiles.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {markingPhotoFiles.map((f, i) => (
                        <div key={i} className="group relative">
                          <img src={URL.createObjectURL(f)} alt={f.name} className="h-16 w-16 rounded-lg object-cover border border-slate-200" />
                          <button type="button" onClick={() => setMarkingPhotoFiles((prev) => prev.filter((_, j) => j !== i))}
                            className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs group-hover:flex">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Журнал работ */}
                {isLoadingMarking ? (
                  <div className="py-6 text-center text-sm text-slate-400">Загрузка…</div>
                ) : markingLogs.length === 0 && markingBuffer.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
                    Записей нет — добавьте первую работу
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-slate-500">
                        <tr className="bg-slate-100 border-b border-slate-200">
                          <th colSpan={8} className="px-4 py-2.5 font-normal">
                            {(() => {
                              const activeLogs = markingLogs.filter((l) => !markingDeletedIds.includes(l.id))
                              const allEntries = [...activeLogs, ...markingBuffer]
                              const performers = new Set([
                                ...activeLogs.map((l) => l.performer_user_id ?? l.user_id),
                                ...markingBuffer.map((e) => e.performer_user_id ?? ''),
                              ]).size
                              const tariffs = new Set([
                                ...activeLogs.map((l) => markingEdits[l.id]?.tariff ?? l.tariff),
                                ...markingBuffer.map((e) => e.tariff),
                              ]).size
                              const totalGood = activeLogs.reduce((s, l) => s + (markingEdits[l.id]?.qty ?? l.qty), 0) + markingBuffer.reduce((s, e) => s + e.qty, 0)
                              const totalDefect = activeLogs.reduce((s, l) => s + (markingEdits[l.id]?.qty_defect ?? l.qty_defect), 0) + markingBuffer.reduce((s, e) => s + e.qty_defect, 0)
                              const totalNotes = allEntries.filter((e) => {
                                const n = 'notes' in e ? (markingEdits[(e as FulfillmentMarkingLog).id]?.notes ?? (e as FulfillmentMarkingLog).notes ?? '') : (e as MarkingBufferEntry).notes
                                return n !== ''
                              }).length
                              const totalPhotos = activeLogs.filter((l) => l.photo_urls && l.photo_urls.length > 0).length + markingBuffer.filter((e) => e.photo_files.length > 0).length
                              const stats = [
                                { label: 'Исполнителей', value: performers },
                                { label: 'Тарифов', value: tariffs },
                                { label: 'Годных', value: totalGood },
                                { label: 'Браков', value: totalDefect, color: totalDefect > 0 ? 'text-red-600' : undefined },
                                { label: 'Итого Маркировка', value: totalGood + totalDefect },
                                { label: 'Примечаний', value: totalNotes },
                                { label: 'Фото', value: totalPhotos },
                              ]
                              return (
                                <div className="flex w-full items-center justify-between">
                                  <span className="font-semibold text-slate-600">Итого</span>
                                  {stats.map(({ label, value, color }) => (
                                    <span key={label} className="text-slate-500">{label}: <span className={`font-semibold ${color ?? 'text-slate-800'}`}>{value}</span></span>
                                  ))}
                                </div>
                              )
                            })()}
                          </th>
                        </tr>
                        <tr className="bg-slate-50">
                          <th className="px-4 py-2.5 text-left font-medium">Время</th>
                          <th className="px-4 py-2.5 text-left font-medium">Исполнитель</th>
                          <th className="px-4 py-2.5 text-left font-medium">Тариф</th>
                          <th className="px-3 py-2.5 text-center font-medium">Годный</th>
                          <th className="px-3 py-2.5 text-center font-medium">Брак</th>
                          <th className="px-3 py-2.5 text-left font-medium">Примечание</th>
                          <th className="px-3 py-2.5 text-left font-medium">Фото</th>
                          <th className="w-10 px-3 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {markingLogs.filter((l) => !markingDeletedIds.includes(l.id)).map((log) => {
                          const isEditing = markingEditingId === log.id
                          const edit = markingEdits[log.id] ?? { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '' }
                          const logTime = new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
                          const logDate = new Date(log.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
                          const isOwn = log.user_id === userId
                          if (isEditing) {
                            return (
                              <tr key={log.id} className="bg-amber-50/60">
                                <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                                  <div className="flex flex-col items-start">
                                    <span className="text-xs text-slate-400">{logTime}</span>
                                    <span className="text-xs text-slate-400">{logDate}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-slate-500 text-xs max-w-[140px] truncate">{log.performer_name}</td>
                                <td className="px-4 py-2">
                                  <select value={edit.tariff} onChange={(e) => setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, tariff: e.target.value } }))}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                    {MARKING_TARIFFS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                                  </select>
                                </td>
                                <td className="px-3 py-2">
                                  <input type="number" min={0} value={edit.qty}
                                    onChange={(e) => setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, qty: Number(e.target.value) } }))}
                                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                </td>
                                <td className="px-3 py-2">
                                  <input type="number" min={0} value={edit.qty_defect}
                                    onChange={(e) => setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, qty_defect: Number(e.target.value) } }))}
                                    className="w-16 rounded-lg border border-red-200 px-2 py-1 text-center text-xs text-red-700 focus:outline-none focus:ring-1 focus:ring-red-300" />
                                </td>
                                <td className="px-3 py-2">
                                  <input type="text" value={edit.notes}
                                    onChange={(e) => setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, notes: e.target.value } }))}
                                    className="w-full min-w-0 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                </td>
                                <td className="px-3 py-2" />
                                <td className="px-3 py-2">
                                  <div className="flex gap-1">
                                    <button type="button" onClick={() => { setIsDirty(true); setMarkingEditingId(null) }}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Применить">
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                    </button>
                                    <button type="button" onClick={() => { setMarkingEdits((p) => { const n = { ...p }; delete n[log.id]; return n }); setMarkingEditingId(null) }}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" title="Отмена">
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          }
                          const displayTariff = MARKING_TARIFFS.find((t) => t.id === edit.tariff)?.label ?? edit.tariff
                          const hasEdit = !!markingEdits[log.id]
                          return (
                            <tr key={log.id} className={hasEdit ? 'bg-amber-50/30' : isOwn ? 'bg-blue-50/40' : ''}>
                              <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">
                                <div className="flex flex-col items-start">
                                  <span className="text-xs font-semibold text-slate-600">{logTime}</span>
                                  <span className="text-xs font-semibold text-slate-600">{logDate}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-slate-700 max-w-[140px] truncate" title={log.user_email}>{log.performer_name}</td>
                              <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{displayTariff}</td>
                              <td className="px-3 py-2.5 text-center font-semibold text-slate-800">{edit.qty}</td>
                              <td className="px-3 py-2.5 text-center">
                                {edit.qty_defect > 0 ? <span className="font-semibold text-red-600">{edit.qty_defect}</span> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-2.5 text-slate-500 text-xs">{edit.notes}</td>
                              <td className="px-3 py-2.5">
                                <InvoicePhotoCell
                                  photoUrls={log.photo_urls ?? []}
                                  onAdd={(isOwn || canManage) ? (file) => void handleAddMarkingPhoto(log.id, file) : undefined}
                                  onReplace={(isOwn || canManage) ? (idx, file) => void handleReplaceMarkingPhoto(log.id, idx, file) : undefined}
                                  onRemove={(isOwn || canManage) ? (idx) => void handleRemoveMarkingPhoto(log.id, idx) : undefined}
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                {(isOwn || canManage) && (
                                  <div className="flex gap-1">
                                    <button type="button"
                                      onClick={() => { setMarkingEdits((p) => ({ ...p, [log.id]: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '' } })); setMarkingEditingId(log.id) }}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-500" title="Редактировать">
                                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </button>
                                    <button type="button" onClick={() => handleDeleteMarkingLog(log.id)}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="Удалить">
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                        {markingBuffer.map((entry) => {
                          const isEditing = markingEditingId === entry.tempId
                          const tariffLabel = MARKING_TARIFFS.find((t) => t.id === entry.tariff)?.label ?? entry.tariff
                          if (isEditing) {
                            return (
                              <tr key={entry.tempId} className="bg-amber-50">
                                <td className="px-4 py-2 text-xs text-amber-600 italic whitespace-nowrap">Новая</td>
                                <td className="px-4 py-2 text-xs text-slate-500">{entry.performer_name}</td>
                                <td className="px-4 py-2">
                                  <select value={entry.tariff} onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, tariff: e.target.value } : x))}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                    {MARKING_TARIFFS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                                  </select>
                                </td>
                                <td className="px-3 py-2">
                                  <input type="number" min={0} value={entry.qty}
                                    onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, qty: Number(e.target.value) } : x))}
                                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-xs focus:outline-none" />
                                </td>
                                <td className="px-3 py-2">
                                  <input type="number" min={0} value={entry.qty_defect}
                                    onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, qty_defect: Number(e.target.value) } : x))}
                                    className="w-16 rounded-lg border border-red-200 px-2 py-1 text-center text-xs text-red-700 focus:outline-none" />
                                </td>
                                <td className="px-3 py-2">
                                  <input type="text" value={entry.notes}
                                    onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, notes: e.target.value } : x))}
                                    className="w-full min-w-0 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                                </td>
                                <td className="px-3 py-2" />
                                <td className="px-3 py-2">
                                  <button type="button" onClick={() => setMarkingEditingId(null)}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Готово">
                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                  </button>
                                </td>
                              </tr>
                            )
                          }
                          return (
                            <tr key={entry.tempId} className="bg-amber-50/70">
                              <td className="px-4 py-2.5 text-xs text-amber-600 italic whitespace-nowrap">Новая</td>
                              <td className="px-4 py-2.5 text-xs text-slate-600">{entry.performer_name}</td>
                              <td className="px-4 py-2.5 text-xs text-slate-700">{tariffLabel}</td>
                              <td className="px-3 py-2.5 text-center font-semibold text-slate-800">{entry.qty}</td>
                              <td className="px-3 py-2.5 text-center">
                                {entry.qty_defect > 0 ? <span className="font-semibold text-red-600">{entry.qty_defect}</span> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-2.5 text-xs text-slate-500">{entry.notes}</td>
                              <td className="px-3 py-2.5">
                                {entry.photo_files.length > 0 ? (
                                  <InvoicePhotoCell photoUrls={entry.photo_files.map((f) => URL.createObjectURL(f))} />
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex gap-1">
                                  <button type="button" onClick={() => setMarkingEditingId(entry.tempId)}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-500" title="Редактировать">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                  </button>
                                  <button type="button" onClick={() => handleDeleteMarkingLog(entry.tempId)}
                                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="Удалить">
                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {!canAdvance && tMarking === 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    Добавьте хотя бы одну запись работы для завершения Маркировки.
                  </div>
                )}
              </div>
            )
          })()}

          {/* ФОРМИРОВАНИЕ КОРОБОВ */}
          {viewStage === 'packing' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Укажите количество единиц и коробов для каждой позиции.</p>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Наименование</th>
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
                          <td className="px-3 py-2.5 text-center text-slate-500">{prev}</td>
                          <td className="px-3 py-2.5 text-center">
                            {canManage ? (
                              <input type="number" min={0} value={stageDraft[it.id]?.qty ?? prev}
                                onChange={(e) => { setStageDraft((p) => ({ ...p, [it.id]: { ...p[it.id], qty: Number(e.target.value) } })); setIsDirty(true) }}
                                className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-300"
                              />
                            ) : <span>{stageDraft[it.id]?.qty ?? prev}</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {canManage ? (
                              <input type="number" min={0} value={stageDraft[it.id]?.boxes ?? 0}
                                onChange={(e) => { setStageDraft((p) => ({ ...p, [it.id]: { ...p[it.id], boxes: Number(e.target.value) } })); setIsDirty(true) }}
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
          {viewStage === 'logistics' && (
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
                    <select value={selectedTripId} onChange={(e) => { setSelectedTripId(e.target.value); setSelectedLineId(''); setIsDirty(true) }}
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
                      <select value={selectedLineId} onChange={(e) => { setSelectedLineId(e.target.value); setIsDirty(true) }}
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
          {viewStage === 'done' && (
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
        {(canManage || (batch.current_stage !== 'done' && batch.current_stage === 'otk')) && (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
            <span className="text-sm text-slate-400">
              Этап {Math.max(1, currentIdx + 1)} из {enabledStages.filter((s) => s !== 'done').length}
            </span>
            <div className="flex items-center gap-3">
              {/* Кнопка Сохранить — всегда видна, заглушена когда нет изменений */}
              {canManage && (
                <button type="button"
                  onClick={() => void (async () => {
                    if (viewStage === 'reception') await handleSaveReceptionDraft()
                    else if (viewStage === 'otk') await handleSaveOtkAll()
                    else if (viewStage === 'marking') await handleSaveMarkingAll()
                    else if (viewStage === 'packing') await handleSaveStageDraft()
                  })()}
                  disabled={isSavingDraft || !isDirty}
                  className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-opacity">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  {isSavingDraft ? 'Сохранение…' : 'Сохранить'}
                </button>
              )}

              {batch.current_stage !== 'done' && viewStage === batch.current_stage && (<>
              {batch.current_stage === 'reception' && (
                <button type="button" onClick={() => setPendingAdvance(true)}
                  disabled={isSavingStage || items.length === 0}
                  className="flex w-64 items-center justify-between gap-2 whitespace-nowrap rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {nextStageName === 'done' ? 'Завершить партию' : `Перейти к ${STAGE_LABELS_TO[nextStageName ?? 'done'] ?? STAGE_LABELS[nextStageName ?? 'done']}`}
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              {batch.current_stage === 'otk' && (() => {
                const tReceived = items.reduce((s, it) => s + (it.qty_received ?? 0), 0)
                const tOtk = otkLogs.filter((l) => !otkDeletedIds.includes(l.id)).reduce((s, l) => s + (otkEdits[l.id]?.qty ?? l.qty) + (otkEdits[l.id]?.qty_defect ?? l.qty_defect), 0) + otkBuffer.reduce((s, e) => s + e.qty + e.qty_defect, 0)
                const canAdvance = canManage || tOtk >= tReceived
                return (
                  <button type="button" onClick={() => setPendingAdvance(true)}
                    disabled={isSavingStage || !canAdvance}
                    className="flex w-64 items-center justify-between gap-2 whitespace-nowrap rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                    Завершить ОТК
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                )
              })()}
              {(batch.current_stage === 'marking' || batch.current_stage === 'packing') && (
                <button type="button" onClick={() => setPendingAdvance(true)}
                  disabled={isSavingStage}
                  className="flex w-64 items-center justify-between gap-2 whitespace-nowrap rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {`Завершить ${STAGE_LABELS[batch.current_stage]}`}
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              {batch.current_stage === 'logistics' && (
                <button type="button" onClick={() => setPendingAdvance(true)}
                  disabled={isLinkingLogistics || (!selectedLineId && !batch.trip_line_id)}
                  className="flex w-64 items-center justify-between gap-2 whitespace-nowrap rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  Передать в логистику
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              )}
              </>)}
            </div>
          </div>
        )}
      </div>

      {/* Диалог: подтверждение завершения этапа */}
      {pendingAdvance && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <p className="font-semibold text-slate-800">Завершить этап?</p>
              <p className="mt-1 text-sm text-slate-500">
                {batch.current_stage === 'logistics'
                  ? 'Партия будет передана в логистику. Убедитесь, что рейс и поставка выбраны.'
                  : `Этап «${STAGE_LABELS[batch.current_stage]}» будет завершён. Вернуться назад без участия администратора нельзя.`}
              </p>
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
              <button type="button"
                onClick={() => {
                  setPendingAdvance(false)
                  if (batch.current_stage === 'reception') void handleCompleteReception()
                  else if (batch.current_stage === 'otk') void handleAdvanceOtk()
                  else if (batch.current_stage === 'marking') void handleMarkingAndAdvance()
                  else if (batch.current_stage === 'packing') void handleSaveStageAndAdvance()
                  else if (batch.current_stage === 'logistics') void handleLinkLogistics()
                }}
                disabled={isSavingStage || isLinkingLogistics}
                className="flex-1 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {isSavingStage || isLinkingLogistics ? 'Сохранение…' : 'Да, завершить'}
              </button>
              <button type="button"
                onClick={() => setPendingAdvance(false)}
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка истории */}
      {(historyOpen || !!otkHistoryLog) && (() => {
        const allOtkLogs = [...otkLogs, ...otkDeletedLogs]
        const activeId = otkHistoryTabId ?? otkHistoryLog?.id ?? otkLogs[0]?.id ?? ''
        const activeLog = allOtkLogs.find((l) => l.id === activeId) ?? otkHistoryLog ?? otkLogs[0] ?? null
        const isDeletedLog = !!activeLog?.deleted_at
        const histories = activeId ? otkLogHistories[activeId] : undefined
        const closeHistory = () => { setOtkHistoryLog(null); setHistoryOpen(false) }
        const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })

        const FIELD_LABELS: Record<string, string> = { tariff: 'Тариф', qty: 'Годный', qty_defect: 'Брак', notes: 'Примечание', photo_urls: 'Фото' }
        const calcTotal = (vals: Record<string, unknown>) => (Number(vals.qty) || 0) + (Number(vals.qty_defect) || 0)
        const fmtVal = (key: string, val: unknown): string => {
          if (key === 'tariff') return OTK_TARIFFS.find((t) => t.id === val)?.label ?? String(val)
          if (key === 'photo_urls') return Array.isArray(val) ? `${(val as unknown[]).length} фото` : '—'
          if (val === null || val === undefined || val === '') return '—'
          return String(val)
        }

        const loadHistory = async (logId: string) => {
          if (otkLogHistories[logId]) return
          let h = await fetchOtkLogHistory(logId)
          if (h.length === 0) {
            const log = allOtkLogs.find((l) => l.id === logId)
            if (log) {
              await addOtkLogHistory({ log_id: log.id, user_id: log.user_id, user_email: log.user_email, user_name: log.user_name ?? otkPerformers.find((p) => p.user_id === log.user_id)?.full_name ?? (log.user_id === userId ? userName : null) ?? null, action: 'created', old_values: null, new_values: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [] } })
              h = await fetchOtkLogHistory(logId)
            }
          }
          const enriched = h.map((entry) => {
            if (entry.user_name) return entry
            const name = otkPerformers.find((p) => p.user_id === entry.user_id)?.full_name ?? (entry.user_id === userId ? userName : null) ?? null
            if (name) void patchOtkLogHistoryUserName(entry.id, name)
            return { ...entry, user_name: name }
          })
          setOtkLogHistories((prev) => ({ ...prev, [logId]: enriched }))
        }

        if (otkHistoryStageTab === 'otk' && activeId && !histories) { void loadHistory(activeId) }

        const createdEntry = histories?.find((h) => h.action === 'created')
        const initialValues = createdEntry?.new_values ?? null

        // Данные для не-ОТК этапов
        const stageLabels: Record<FulfillmentStage, string> = { reception: 'Приёмка', otk: 'ОТК', marking: 'Маркировка', packing: 'Короба', logistics: 'Логистика' }
        const stageQtyKey: Partial<Record<FulfillmentStage, keyof FulfillmentItem>> = { reception: 'qty_received', marking: 'qty_marked', packing: 'qty_packed' }
        const stageQtyLabel: Partial<Record<FulfillmentStage, string>> = { reception: 'Принято', marking: 'Промаркировано', packing: 'Упаковано' }

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-[5vh_5vw]" onClick={(e) => { e.stopPropagation(); closeHistory() }}>
            <div className="flex h-full w-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {/* Шапка */}
              <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-slate-100">
                <p className="font-semibold text-slate-800">История изменений</p>
                <button type="button" onClick={closeHistory} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
              {/* Табы этапов */}
              <div className="flex shrink-0 gap-1 border-b border-slate-100 px-4 py-2">
                {(['reception', 'otk', 'marking', 'packing', 'logistics'] as FulfillmentStage[]).map((key) => {
                  const isActive = otkHistoryStageTab === key
                  const isEnabled = key === 'reception' || key === 'otk' || batch[({ otk: 'stage_otk', marking: 'stage_marking', packing: 'stage_packing', logistics: 'stage_logistics' } as Record<string, keyof typeof batch>)[key] as keyof typeof batch] as boolean
                  if (!isEnabled) return (
                    <div key={key} className="flex shrink-0 items-center rounded-xl px-3 py-1.5 text-xs text-slate-300 cursor-not-allowed select-none">{stageLabels[key]}</div>
                  )
                  return (
                    <button key={key} type="button" onClick={() => {
                      setOtkHistoryStageTab(key)
                      if (key === 'otk' && otkLogs.length > 0 && !otkHistoryTabId) setOtkHistoryTabId(otkLogs[0].id)
                      if (key === 'marking') {
                        if (markingLogs.length === 0 && markingDeletedLogs.length === 0) {
                          Promise.all([fetchMarkingLogs(batch.id), fetchDeletedMarkingLogs(batch.id)])
                            .then(([active, deleted]) => {
                              setMarkingLogs(active)
                              setMarkingDeletedLogs(deleted)
                              const merged = [...active, ...deleted].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                              if (merged.length > 0) setMarkingHistoryTabId(merged[0].id)
                            })
                            .catch(() => {})
                        } else {
                          // Всегда перезагружаем удалённые для актуального списка
                          void fetchDeletedMarkingLogs(batch.id).then((deleted) => {
                            setMarkingDeletedLogs(deleted)
                            const all = [...markingLogs, ...deleted].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                            if (all.length > 0) setMarkingHistoryTabId(all[0].id)
                          }).catch(() => {})
                        }
                      }
                    }}
                      className={`flex shrink-0 items-center rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${isActive ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      {stageLabels[key]}
                    </button>
                  )
                })}
              </div>

              {/* ── ОТК: мини-табы + журнал ── */}
              {otkHistoryStageTab === 'otk' && (() => {
                const pristineLogs = otkLogs.filter((l) => new Date(l.updated_at).getTime() - new Date(l.created_at).getTime() <= 1000)
                const modifiedLogs = otkLogs.filter((l) => new Date(l.updated_at).getTime() - new Date(l.created_at).getTime() > 1000)
                const renderTab = (log: (typeof allOtkLogs)[0], scheme: 'blue' | 'orange' | 'red', suffix?: string) => {
                  const t = new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                  const idx = allOtkLogs.indexOf(log) + 1
                  const isTabActive = log.id === activeId
                  const cls = {
                    blue: { bg: isTabActive ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200', sub: isTabActive ? 'text-blue-100' : 'text-blue-400' },
                    orange: { bg: isTabActive ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-700 hover:bg-orange-200', sub: isTabActive ? 'text-orange-100' : 'text-orange-400' },
                    red: { bg: isTabActive ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700 hover:bg-red-200', sub: isTabActive ? 'text-red-100' : 'text-red-400' },
                  }[scheme]
                  return (
                    <button key={log.id} type="button"
                      onClick={() => { setOtkHistoryTabId(log.id); if (!otkLogHistories[log.id]) void loadHistory(log.id) }}
                      className={`flex shrink-0 flex-col items-start rounded-xl px-3 py-1.5 text-left transition-colors ${cls.bg}`}>
                      <span className="text-xs font-medium">{log.performer_name}</span>
                      <span className={`text-[10px] ${cls.sub}`}>#{idx} · {t}{suffix ? ` · ${suffix}` : ''}</span>
                    </button>
                  )
                }
                return (<>
                  <div className="flex shrink-0 gap-1 overflow-x-scroll border-b border-slate-100 px-4 pb-2 pt-2 [scrollbar-width:thin]">
                    {pristineLogs.map((log) => renderTab(log, 'blue'))}
                    {modifiedLogs.map((log) => renderTab(log, 'orange'))}
                    {otkDeletedLogs.map((log) => renderTab(log, 'red', 'удалена'))}
                  </div>
                  {activeLog ? (
                    <div className="flex flex-1 gap-6 overflow-hidden p-6">
                      {/* Левая колонка */}
                      <div className="w-64 shrink-0 space-y-3 overflow-y-auto [scrollbar-width:thin]">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{isDeletedLog ? 'Данные на момент удаления' : 'Текущие данные'}</p>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                          <p className="text-xs text-slate-500">Исполнитель: <span className="font-medium text-slate-800">{activeLog.performer_name}</span></p>
                          <p className="text-xs text-slate-500">Добавил: <span className="font-medium text-slate-700">{activeLog.user_email}</span></p>
                          <p className="text-xs text-slate-500">Создано: <span className="font-medium text-slate-700">{fmt(activeLog.created_at)}</span></p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                          {(['tariff', 'qty', 'qty_defect', 'notes'] as const).map((k) => (
                            <p key={k} className="text-xs text-slate-500">{FIELD_LABELS[k]}: <span className="font-medium text-slate-800">{fmtVal(k, activeLog[k])}</span></p>
                          ))}
                          <p className="text-xs text-slate-500">Фото: <span className="font-medium text-slate-800">{activeLog.photo_urls?.length ?? 0} фото</span></p>
                        </div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Первоначальные данные</p>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                          {!histories ? (
                            <p className="text-xs text-slate-400">Загрузка...</p>
                          ) : initialValues ? (
                            <>
                              {(['tariff', 'qty', 'qty_defect', 'notes'] as const).map((k) => (
                                <p key={k} className="text-xs text-slate-500">{FIELD_LABELS[k]}: <span className="font-medium text-slate-800">{fmtVal(k, initialValues[k])}</span></p>
                              ))}
                              <p className="text-xs text-slate-500">Фото: <span className="font-medium text-slate-800">{Array.isArray(initialValues.photo_urls) ? (initialValues.photo_urls as unknown[]).length : 0} фото</span></p>
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">Нет данных</p>
                          )}
                        </div>
                      </div>
                      {/* Правая колонка — журнал */}
                      <div className="flex min-h-0 flex-1 flex-col">
                        <p className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">Журнал действий</p>
                        {!histories ? (
                          <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">Загрузка...</div>
                        ) : histories.length === 0 ? (
                          <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">История пуста</div>
                        ) : (
                          <div className="flex-1 overflow-y-scroll space-y-2 pr-1 [scrollbar-width:thin]">
                            {[...histories].reverse().map((h) => {
                              const changedKeys = Object.keys(h.new_values)
                              const bgColor = h.action === 'created' ? 'bg-emerald-50' : h.action === 'deleted' ? 'bg-red-50' : 'bg-amber-50'
                              const textColor = h.action === 'created' ? 'text-emerald-700' : h.action === 'deleted' ? 'text-red-700' : 'text-amber-700'
                              const label = h.action === 'created' ? 'Создал' : h.action === 'deleted' ? 'Удалил' : 'Изменил'
                              return (
                                <div key={h.id} className={`rounded-2xl px-4 py-3 ${bgColor}`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <span className={`text-xs font-semibold ${textColor}`}>{label}</span>
                                      {(() => {
                                        const name = h.user_name ?? otkPerformers.find((p) => p.user_id === h.user_id)?.full_name ?? (h.user_id === userId ? userName : null)
                                        return name ? <span className="ml-1.5 text-xs font-medium text-slate-700">{name}</span> : null
                                      })()}
                                      <span className="ml-1.5 text-xs text-slate-400">{h.user_email}</span>
                                    </div>
                                    <span className="shrink-0 text-xs font-semibold text-slate-600">{fmt(h.created_at)}</span>
                                  </div>
                                  {h.action === 'updated' && changedKeys.length > 0 && (
                                    <div className="mt-2 space-y-0.5">
                                      {changedKeys.map((k) => (
                                        <p key={k} className="text-xs text-slate-600">
                                          <span className="font-medium">{FIELD_LABELS[k] ?? k}:</span>{' '}
                                          <span className="text-slate-400 line-through">{fmtVal(k, h.old_values?.[k])}</span>
                                          {' → '}
                                          <span className="text-slate-800">{fmtVal(k, h.new_values[k])}</span>
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                  {(h.action === 'created' || h.action === 'deleted') && h.old_values && Object.keys(h.old_values).length > 0 && (
                                    <div className="mt-2 space-y-0.5">
                                      {Object.keys(h.old_values).map((k) => (
                                        <p key={k} className="text-xs text-slate-600">
                                          <span className="font-medium">{FIELD_LABELS[k] ?? k}:</span>{' '}
                                          <span className="text-slate-800">{fmtVal(k, h.old_values![k])}</span>
                                        </p>
                                      ))}
                                      {'qty' in h.old_values || 'qty_defect' in h.old_values ? (
                                        <p className="text-xs text-slate-600"><span className="font-medium">Общее кол-во:</span>{' '}<span className="text-slate-800">{calcTotal(h.old_values)}</span></p>
                                      ) : null}
                                    </div>
                                  )}
                                  {h.action === 'created' && changedKeys.length > 0 && !(h.old_values && Object.keys(h.old_values).length > 0) && (
                                    <div className="mt-2 space-y-0.5">
                                      {changedKeys.map((k) => (
                                        <p key={k} className="text-xs text-slate-600">
                                          <span className="font-medium">{FIELD_LABELS[k] ?? k}:</span>{' '}
                                          <span className="text-slate-800">{fmtVal(k, h.new_values[k])}</span>
                                        </p>
                                      ))}
                                      {'qty' in h.new_values || 'qty_defect' in h.new_values ? (
                                        <p className="text-xs text-slate-600"><span className="font-medium">Общее кол-во:</span>{' '}<span className="text-slate-800">{calcTotal(h.new_values)}</span></p>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">Нет записей ОТК</div>
                  )}
                </>)
              })()}

              {/* ── Маркировка: журнал работ (точная копия ОТК) ── */}
              {otkHistoryStageTab === 'marking' && (() => {
                // --- локальные переменные (shadowing внешнего скоупа, как у ОТК) ---
                // Логи с ожидающим (ещё не сохранённым) удалением показываем как красные табы
                const pendingDeletedLogs = markingLogs
                  .filter((l) => markingDeletedIds.includes(l.id))
                  .map((l) => ({ ...l, deleted_at: l.deleted_at ?? new Date().toISOString() }))
                const allDeletedLogs = [...markingDeletedLogs, ...pendingDeletedLogs]
                const activeMarkingLogs = markingLogs.filter((l) => !markingDeletedIds.includes(l.id))
                const allOtkLogs = [...activeMarkingLogs, ...allDeletedLogs]
                const activeId = markingHistoryTabId ?? activeMarkingLogs[0]?.id ?? ''
                const activeLog = allOtkLogs.find((l) => l.id === activeId) ?? activeMarkingLogs[0] ?? null
                const isDeletedLog = !!activeLog?.deleted_at
                const histories = activeId ? markingLogHistories[activeId] : undefined
                const FIELD_LABELS: Record<string, string> = { tariff: 'Тариф', qty: 'Годный', qty_defect: 'Брак', notes: 'Примечание', photo_urls: 'Фото' }
                const calcTotal = (vals: Record<string, unknown>) => (Number(vals.qty) || 0) + (Number(vals.qty_defect) || 0)
                const fmtVal = (key: string, val: unknown): string => {
                  if (key === 'tariff') return MARKING_TARIFFS.find((t) => t.id === val)?.label ?? String(val)
                  if (key === 'photo_urls') return Array.isArray(val) ? `${(val as unknown[]).length} фото` : '—'
                  if (val === null || val === undefined || val === '') return '—'
                  return String(val)
                }
                const loadHistory = async (logId: string) => {
                  if (markingLogHistories[logId] || markingHistoryLoadingIds.current.has(logId)) return
                  markingHistoryLoadingIds.current.add(logId)
                  try {
                    let h = await fetchMarkingLogHistory(logId)
                    if (h.length === 0) {
                      const log = allOtkLogs.find((l) => l.id === logId)
                      // Синтезируем created только для НЕ удалённых логов
                      if (log && !log.deleted_at) {
                        await addMarkingLogHistory({ log_id: log.id, user_id: log.user_id, user_email: log.user_email, user_name: log.user_name ?? markingPerformers.find((p) => p.user_id === log.user_id)?.full_name ?? (log.user_id === userId ? userName : null) ?? null, action: 'created', old_values: null, new_values: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [] } })
                        h = await fetchMarkingLogHistory(logId)
                      }
                    }
                    const enriched = h.map((entry) => {
                      if (entry.user_name) return entry
                      const name = markingPerformers.find((p) => p.user_id === entry.user_id)?.full_name ?? (entry.user_id === userId ? userName : null) ?? null
                      if (name) void patchMarkingLogHistoryUserName(entry.id, name)
                      return { ...entry, user_name: name }
                    })
                    setMarkingLogHistories((prev) => ({ ...prev, [logId]: enriched }))
                  } finally {
                    markingHistoryLoadingIds.current.delete(logId)
                  }
                }
                const createdEntry = histories?.find((h) => h.action === 'created')
                const initialValues = createdEntry?.new_values ?? null

                if (activeId && !histories) { void loadHistory(activeId) }

                const pristineLogs = activeMarkingLogs.filter((l) => new Date(l.updated_at).getTime() - new Date(l.created_at).getTime() <= 1000)
                const modifiedLogs = activeMarkingLogs.filter((l) => new Date(l.updated_at).getTime() - new Date(l.created_at).getTime() > 1000)
                const renderTab = (log: (typeof allOtkLogs)[0], scheme: 'blue' | 'orange' | 'red', suffix?: string) => {
                  const t = new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                  const idx = allOtkLogs.indexOf(log) + 1
                  const isTabActive = log.id === activeId
                  const cls = {
                    blue: { bg: isTabActive ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200', sub: isTabActive ? 'text-blue-100' : 'text-blue-400' },
                    orange: { bg: isTabActive ? 'bg-orange-500 text-white' : 'bg-orange-100 text-orange-700 hover:bg-orange-200', sub: isTabActive ? 'text-orange-100' : 'text-orange-400' },
                    red: { bg: isTabActive ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700 hover:bg-red-200', sub: isTabActive ? 'text-red-100' : 'text-red-400' },
                  }[scheme]
                  return (
                    <button key={log.id} type="button"
                      onClick={() => { setMarkingHistoryTabId(log.id); if (!markingLogHistories[log.id]) void loadHistory(log.id) }}
                      className={`flex shrink-0 flex-col items-start rounded-xl px-3 py-1.5 text-left transition-colors ${cls.bg}`}>
                      <span className="text-xs font-medium">{log.performer_name}</span>
                      <span className={`text-[10px] ${cls.sub}`}>#{idx} · {t}{suffix ? ` · ${suffix}` : ''}</span>
                    </button>
                  )
                }
                return (<>
                  <div className="flex shrink-0 gap-1 overflow-x-scroll border-b border-slate-100 px-4 pb-2 pt-2 [scrollbar-width:thin]">
                    {pristineLogs.map((log) => renderTab(log, 'blue'))}
                    {modifiedLogs.map((log) => renderTab(log, 'orange'))}
                    {allDeletedLogs.map((log) => renderTab(log, 'red', 'удалена'))}
                  </div>
                  {activeLog ? (
                    <div className="flex flex-1 gap-6 overflow-hidden p-6">
                      {/* Левая колонка */}
                      <div className="w-64 shrink-0 space-y-3 overflow-y-auto [scrollbar-width:thin]">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{isDeletedLog ? 'Данные на момент удаления' : 'Текущие данные'}</p>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                          <p className="text-xs text-slate-500">Исполнитель: <span className="font-medium text-slate-800">{activeLog.performer_name}</span></p>
                          <p className="text-xs text-slate-500">Добавил: <span className="font-medium text-slate-700">{activeLog.user_email}</span></p>
                          <p className="text-xs text-slate-500">Создано: <span className="font-medium text-slate-700">{fmt(activeLog.created_at)}</span></p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                          {(['tariff', 'qty', 'qty_defect', 'notes'] as const).map((k) => (
                            <p key={k} className="text-xs text-slate-500">{FIELD_LABELS[k]}: <span className="font-medium text-slate-800">{fmtVal(k, activeLog[k])}</span></p>
                          ))}
                          <p className="text-xs text-slate-500">Фото: <span className="font-medium text-slate-800">{activeLog.photo_urls?.length ?? 0} фото</span></p>
                        </div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Первоначальные данные</p>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                          {!histories ? (
                            <p className="text-xs text-slate-400">Загрузка...</p>
                          ) : initialValues ? (
                            <>
                              {(['tariff', 'qty', 'qty_defect', 'notes'] as const).map((k) => (
                                <p key={k} className="text-xs text-slate-500">{FIELD_LABELS[k]}: <span className="font-medium text-slate-800">{fmtVal(k, initialValues[k])}</span></p>
                              ))}
                              <p className="text-xs text-slate-500">Фото: <span className="font-medium text-slate-800">{Array.isArray(initialValues.photo_urls) ? (initialValues.photo_urls as unknown[]).length : 0} фото</span></p>
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">Нет данных</p>
                          )}
                        </div>
                      </div>
                      {/* Правая колонка — журнал */}
                      <div className="flex min-h-0 flex-1 flex-col">
                        <p className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">Журнал действий</p>
                        {!histories ? (
                          <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">Загрузка...</div>
                        ) : histories.length === 0 ? (
                          <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">История пуста</div>
                        ) : (
                          <div className="flex-1 overflow-y-scroll space-y-2 pr-1 [scrollbar-width:thin]">
                            {[...histories].reverse().map((h) => {
                              const changedKeys = Object.keys(h.new_values)
                              const bgColor = h.action === 'created' ? 'bg-emerald-50' : h.action === 'deleted' ? 'bg-red-50' : 'bg-amber-50'
                              const textColor = h.action === 'created' ? 'text-emerald-700' : h.action === 'deleted' ? 'text-red-700' : 'text-amber-700'
                              const label = h.action === 'created' ? 'Создал' : h.action === 'deleted' ? 'Удалил' : 'Изменил'
                              return (
                                <div key={h.id} className={`rounded-2xl px-4 py-3 ${bgColor}`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <span className={`text-xs font-semibold ${textColor}`}>{label}</span>
                                      {(() => {
                                        const name = h.user_name ?? markingPerformers.find((p) => p.user_id === h.user_id)?.full_name ?? (h.user_id === userId ? userName : null)
                                        return name ? <span className="ml-1.5 text-xs font-medium text-slate-700">{name}</span> : null
                                      })()}
                                      <span className="ml-1.5 text-xs text-slate-400">{h.user_email}</span>
                                    </div>
                                    <span className="shrink-0 text-xs font-semibold text-slate-600">{fmt(h.created_at)}</span>
                                  </div>
                                  {h.action === 'updated' && changedKeys.length > 0 && (
                                    <div className="mt-2 space-y-0.5">
                                      {changedKeys.map((k) => (
                                        <p key={k} className="text-xs text-slate-600">
                                          <span className="font-medium">{FIELD_LABELS[k] ?? k}:</span>{' '}
                                          <span className="text-slate-400 line-through">{fmtVal(k, h.old_values?.[k])}</span>
                                          {' → '}
                                          <span className="text-slate-800">{fmtVal(k, h.new_values[k])}</span>
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                  {(h.action === 'created' || h.action === 'deleted') && h.old_values && Object.keys(h.old_values).length > 0 && (
                                    <div className="mt-2 space-y-0.5">
                                      {Object.keys(h.old_values).map((k) => (
                                        <p key={k} className="text-xs text-slate-600">
                                          <span className="font-medium">{FIELD_LABELS[k] ?? k}:</span>{' '}
                                          <span className="text-slate-800">{fmtVal(k, h.old_values![k])}</span>
                                        </p>
                                      ))}
                                      {'qty' in h.old_values || 'qty_defect' in h.old_values ? (
                                        <p className="text-xs text-slate-600"><span className="font-medium">Общее кол-во:</span>{' '}<span className="text-slate-800">{calcTotal(h.old_values)}</span></p>
                                      ) : null}
                                    </div>
                                  )}
                                  {h.action === 'created' && changedKeys.length > 0 && !(h.old_values && Object.keys(h.old_values).length > 0) && (
                                    <div className="mt-2 space-y-0.5">
                                      {changedKeys.map((k) => (
                                        <p key={k} className="text-xs text-slate-600">
                                          <span className="font-medium">{FIELD_LABELS[k] ?? k}:</span>{' '}
                                          <span className="text-slate-800">{fmtVal(k, h.new_values[k])}</span>
                                        </p>
                                      ))}
                                      {'qty' in h.new_values || 'qty_defect' in h.new_values ? (
                                        <p className="text-xs text-slate-600"><span className="font-medium">Общее кол-во:</span>{' '}<span className="text-slate-800">{calcTotal(h.new_values)}</span></p>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">Нет записей маркировки</div>
                  )}
                </>)
              })()}

              {/* ── Не-ОТК этапы: позиции ── */}
              {otkHistoryStageTab !== 'otk' && otkHistoryStageTab !== 'marking' && (() => {
                const qKey = stageQtyKey[otkHistoryStageTab]
                const qLabel = stageQtyLabel[otkHistoryStageTab]
                const totalQty = qKey ? items.reduce((s, it) => s + (Number(it[qKey] ?? 0)), 0) : 0
                const activeItemId = historyItemId ?? items[0]?.id ?? null
                const activeItem = items.find((it) => it.id === activeItemId) ?? items[0] ?? null

                const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })

                // Мини-табы позиций
                const itemTabs = (
                  <div className="flex shrink-0 gap-1 overflow-x-scroll border-b border-slate-100 px-4 pb-2 pt-2 [scrollbar-width:thin]">
                    {items.map((it, i) => {
                      const isTabActive = it.id === activeItemId
                      const qty = qKey ? Number(it[qKey] ?? 0) : it.qty_received
                      return (
                        <button key={it.id} type="button"
                          onClick={() => setHistoryItemId(it.id)}
                          className={`flex shrink-0 flex-col items-start rounded-xl px-3 py-1.5 text-left transition-colors ${isTabActive ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>
                          <span className="text-xs font-medium">{it.product_name || 'Позиция'}</span>
                          <span className={`text-[10px] ${isTabActive ? 'text-blue-100' : 'text-blue-400'}`}>#{i + 1} · {qty} шт</span>
                        </button>
                      )
                    })}
                  </div>
                )

                if (otkHistoryStageTab === 'logistics') {
                  const linkedTrip = trips.find((t) => t.lines.some((l) => l.id === batch.trip_line_id))
                  const linkedLine = linkedTrip?.lines.find((l) => l.id === batch.trip_line_id)
                  return (<>
                    {itemTabs}
                    <div className="flex flex-1 gap-6 overflow-hidden p-6">
                      {/* Левая — данные рейса */}
                      <div className="w-64 shrink-0 space-y-3 overflow-y-auto [scrollbar-width:thin]">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Привязка к рейсу</p>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                          {linkedTrip ? (<>
                            <p className="text-xs text-slate-500">Рейс: <span className="font-medium text-slate-800">{linkedTrip.trip_number ?? `#${linkedTrip.draft_number}`}</span></p>
                            <p className="text-xs text-slate-500">Перевозчик: <span className="font-medium text-slate-800">{linkedTrip.carrier || '—'}</span></p>
                            {linkedTrip.departure_date && <p className="text-xs text-slate-500">Дата отправки: <span className="font-medium text-slate-800">{new Date(linkedTrip.departure_date).toLocaleDateString('ru-RU')}</span></p>}
                          </>) : <p className="text-xs text-slate-400">Не привязана к рейсу</p>}
                        </div>
                        {linkedLine && (<>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Строка поставки</p>
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                            <p className="text-xs text-slate-500">Склад: <span className="font-medium text-slate-800">{linkedLine.destination_warehouse || '—'}</span></p>
                            <p className="text-xs text-slate-500">Коробов: <span className="font-medium text-slate-800">{linkedLine.box_qty}</span></p>
                            <p className="text-xs text-slate-500">Единиц: <span className="font-medium text-slate-800">{linkedLine.units_qty}</span></p>
                            <p className="text-xs text-slate-500">Статус: <span className="font-medium text-slate-800">{linkedLine.status}</span></p>
                          </div>
                        </>)}
                        {activeItem && (<>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Позиция</p>
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                            <p className="text-xs text-slate-500">Товар: <span className="font-medium text-slate-800">{activeItem.product_name || '—'}</span></p>
                            {activeItem.barcode !== 'bulk' && activeItem.barcode && <p className="text-xs text-slate-500">Баркод: <span className="font-medium text-slate-800">{activeItem.barcode}</span></p>}
                            {activeItem.size && <p className="text-xs text-slate-500">Размер: <span className="font-medium text-slate-800">{activeItem.size}</span></p>}
                            <p className="text-xs text-slate-500">Упаковано: <span className="font-medium text-slate-800">{activeItem.qty_packed ?? '—'} шт</span></p>
                            {activeItem.boxes != null && <p className="text-xs text-slate-500">Коробов: <span className="font-medium text-slate-800">{activeItem.boxes}</span></p>}
                          </div>
                        </>)}
                      </div>
                      {/* Правая — снимок данных */}
                      <div className="flex min-h-0 flex-1 flex-col">
                        <p className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">Журнал действий</p>
                        <div className="flex-1 overflow-y-scroll space-y-2 pr-1 [scrollbar-width:thin]">
                          <div className="rounded-2xl bg-emerald-50 px-4 py-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs font-semibold text-emerald-700">Создана</span>
                              <span className="shrink-0 text-xs font-semibold text-slate-600">{fmt(batch.created_at)}</span>
                            </div>
                            <div className="mt-2 space-y-0.5">
                              <p className="text-xs text-slate-600">Позиций: <span className="font-medium text-slate-800">{items.length}</span></p>
                              {linkedTrip ? <p className="text-xs text-slate-600">Рейс: <span className="font-medium text-slate-800">{linkedTrip.trip_number ?? `#${linkedTrip.draft_number}`}</span></p> : <p className="text-xs text-slate-600">Рейс: <span className="font-medium text-slate-400">не привязан</span></p>}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>)
                }

                // Приёмка / Маркировка / Короба
                return (<>
                  {itemTabs}
                  {activeItem ? (
                    <div className="flex flex-1 gap-6 overflow-hidden p-6">
                      {/* Левая — текущие данные позиции */}
                      <div className="w-64 shrink-0 space-y-3 overflow-y-auto [scrollbar-width:thin]">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Текущие данные</p>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                          <p className="text-xs text-slate-500">Товар: <span className="font-medium text-slate-800">{activeItem.product_name || '—'}</span></p>
                          {activeItem.barcode !== 'bulk' && activeItem.barcode && <p className="text-xs text-slate-500">Баркод: <span className="font-medium text-slate-800">{activeItem.barcode}</span></p>}
                          {activeItem.size && <p className="text-xs text-slate-500">Размер: <span className="font-medium text-slate-800">{activeItem.size}</span></p>}
                          {activeItem.article && <p className="text-xs text-slate-500">Артикул: <span className="font-medium text-slate-800">{activeItem.article}</span></p>}
                        </div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Кол-во по этапам</p>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                          <p className="text-xs text-slate-500">Принято: <span className="font-medium text-slate-800">{activeItem.qty_received}</span></p>
                          <p className="text-xs text-slate-500">ОТК: <span className="font-medium text-slate-800">{activeItem.qty_otk ?? '—'}</span></p>
                          <p className="text-xs text-slate-500">Маркировка: <span className="font-medium text-slate-800">{activeItem.qty_marked ?? '—'}</span></p>
                          <p className="text-xs text-slate-500">Упаковка: <span className="font-medium text-slate-800">{activeItem.qty_packed ?? '—'}</span></p>
                          {activeItem.boxes != null && <p className="text-xs text-slate-500">Коробов: <span className="font-medium text-slate-800">{activeItem.boxes}</span></p>}
                        </div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Сводка</p>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5">
                          <p className="text-xs text-slate-500">Позиций в партии: <span className="font-medium text-slate-800">{items.length}</span></p>
                          {qLabel && <p className="text-xs text-slate-500">{qLabel} всего: <span className="font-medium text-slate-800">{totalQty}</span></p>}
                        </div>
                      </div>
                      {/* Правая — снимок */}
                      <div className="flex min-h-0 flex-1 flex-col">
                        <p className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">Журнал действий</p>
                        <div className="flex-1 overflow-y-scroll space-y-2 pr-1 [scrollbar-width:thin]">
                          <div className="rounded-2xl bg-emerald-50 px-4 py-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs font-semibold text-emerald-700">Создана</span>
                              <span className="shrink-0 text-xs font-semibold text-slate-600">{fmt(batch.created_at)}</span>
                            </div>
                            <div className="mt-2 space-y-0.5">
                              <p className="text-xs text-slate-600">Товар: <span className="font-medium text-slate-800">{activeItem.product_name || '—'}</span></p>
                              <p className="text-xs text-slate-600">Принято: <span className="font-medium text-slate-800">{activeItem.qty_received} шт</span></p>
                              {activeItem.notes && <p className="text-xs text-slate-600">Примечание: <span className="font-medium text-slate-800">{activeItem.notes}</span></p>}
                            </div>
                          </div>
                          {(activeItem.qty_marked != null || activeItem.qty_packed != null) && (
                            <div className="rounded-2xl bg-amber-50 px-4 py-3">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-xs font-semibold text-amber-700">Текущее состояние</span>
                                <span className="shrink-0 text-xs font-semibold text-slate-600">{fmt(batch.updated_at)}</span>
                              </div>
                              <div className="mt-2 space-y-0.5">
                                {activeItem.qty_marked != null && <p className="text-xs text-slate-600">Промаркировано: <span className="font-medium text-slate-800">{activeItem.qty_marked} шт</span></p>}
                                {activeItem.qty_packed != null && <p className="text-xs text-slate-600">Упаковано: <span className="font-medium text-slate-800">{activeItem.qty_packed} шт</span></p>}
                                {activeItem.boxes != null && <p className="text-xs text-slate-600">Коробов: <span className="font-medium text-slate-800">{activeItem.boxes}</span></p>}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">Нет позиций</div>
                  )}
                </>)
              })()}
            </div>
          </div>
        )
      })()}

      {/* Диалог: закрыть без сохранения */}
      {pendingClose && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={(e) => { e.stopPropagation(); setPendingClose(false) }}>
          <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <p className="font-semibold text-slate-800">Есть несохранённые изменения</p>
              <p className="mt-1 text-sm text-slate-500">Закрыть без сохранения или сохранить перед выходом?</p>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button"
                onClick={async () => {
                  if (batch.current_stage === 'reception') await handleSaveReceptionDraft()
                  else if (batch.current_stage === 'otk') await handleSaveOtkAll()
                  else if (batch.current_stage === 'marking') await handleSaveMarkingAll()
                  else if (batch.current_stage === 'packing') await handleSaveStageDraft()
                  setPendingClose(false)
                  onClose()
                }}
                disabled={isSavingDraft}
                className="w-full rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {isSavingDraft ? 'Сохранение…' : 'Сохранить и закрыть'}
              </button>
              <button type="button"
                onClick={() => { setIsDirty(false); setPendingClose(false); onClose() }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
                Закрыть без сохранения
              </button>
              <button type="button"
                onClick={() => setPendingClose(false)}
                className="w-full rounded-2xl px-4 py-2 text-sm text-slate-400 hover:text-slate-600">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm: delete OTK log ── */}
      {otkDeleteConfirmId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); setOtkDeleteConfirmId(null) }}>
          <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <p className="font-semibold text-slate-800">Удалить запись?</p>
              <p className="mt-1 text-sm text-slate-500">Это действие нельзя отменить. Запись будет удалена при сохранении.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setOtkDeleteConfirmId(null)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
                Отмена
              </button>
              <button type="button" onClick={handleConfirmDeleteOtkLog}
                className="rounded-2xl bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700">
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm: delete Marking log ── */}
      {markingDeleteConfirmId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); setMarkingDeleteConfirmId(null) }}>
          <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <p className="font-semibold text-slate-800">Удалить запись?</p>
              <p className="mt-1 text-sm text-slate-500">Это действие нельзя отменить. Запись будет удалена при сохранении.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setMarkingDeleteConfirmId(null)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
                Отмена
              </button>
              <button type="button" onClick={handleConfirmDeleteMarkingLog}
                className="rounded-2xl bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700">
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
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
                <button key={s.id} type="button"
                  onClick={() => setPickedTmp(s.id)}
                  onDoubleClick={() => { setStoreId(s.id); setPickStoreOpen(false) }}
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
  const submitAfterPickRef = useRef(false)
  const [confirmNoStore, setConfirmNoStore] = useState(false)

  const doSubmit = async (storeIdOverride?: string) => {
    setIsSaving(true)
    setError(null)
    const effectiveStoreId = storeIdOverride !== undefined ? storeIdOverride : storeId
    try {
      await onSubmit({ name: name.trim(), store_id: effectiveStoreId || null, stage_otk: stageOtk, stage_marking: stageMarking, stage_packing: stagePacking, stage_logistics: stageLogistics }, closeOnlyRef.current)
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
              <button type="button" onClick={() => { setConfirmNoStore(false); submitAfterPickRef.current = true; openPickStore() }}
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
                  onDoubleClick={() => { setStoreId(s.id); setPickStoreOpen(false); if (submitAfterPickRef.current) { submitAfterPickRef.current = false; void doSubmit(s.id) } }}
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
              <button type="button" onClick={() => { submitAfterPickRef.current = false; setPickStoreOpen(false) }}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">
                Отмена
              </button>
              <button type="button"
                onClick={() => { setStoreId(pickedTmp); setPickStoreOpen(false); if (submitAfterPickRef.current) { submitAfterPickRef.current = false; void doSubmit(pickedTmp) } }}
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
    <div className="flex cursor-pointer items-center justify-between py-2.5" onClick={() => onChange(!value)}>
      <span className="text-sm text-slate-700">{label}</span>
      <button type="button"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${value ? 'bg-blue-500' : 'bg-slate-200'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
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
export const FulfillmentPage = ({ accountId, stores, trips, onEditTripLine, onStoreCreated, canManage = true, canOtkAssign = false, canStageJump = false, userId = '', userEmail = '', userName = '' }: FulfillmentPageProps) => {
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
  const [archivedBatches, setArchivedBatches] = useState<FulfillmentBatch[]>([])
  const [isArchiveOpen, setIsArchiveOpen] = useState(false)
  const [isArchiveLoading, setIsArchiveLoading] = useState(false)
  const [isRestoring, setIsRestoring] = useState<string | null>(null)
  const [detailFromArchive, setDetailFromArchive] = useState(false)

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
      setArchivedBatches((prev) => [{ ...batch, deleted_at: new Date().toISOString() }, ...prev])
      setDeleteTarget(null)
      if (detailData?.id === batch.id) setDetailData(null)
    } finally { setIsDeleting(false) }
  }

  const handleRestore = async (batch: FulfillmentBatch) => {
    setIsRestoring(batch.id)
    try {
      const restored = await restoreBatch(batch.id)
      setArchivedBatches((prev) => prev.filter((b) => b.id !== batch.id))
      setBatches((prev) => [restored, ...prev])
    } finally { setIsRestoring(null) }
  }

  const handleOpenArchive = async () => {
    setIsArchiveOpen(true)
    if (archivedBatches.length === 0) {
      setIsArchiveLoading(true)
      try {
        const data = await fetchArchivedBatches(accountId)
        setArchivedBatches(data)
      } catch { /* silent */ }
      finally { setIsArchiveLoading(false) }
    }
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
          canManage={canManage} canOtkAssign={canOtkAssign} canStageJump={canStageJump} userId={userId} userEmail={userEmail} userName={userName}
          onClose={() => { setDetailData(null); setDetailFromArchive(false) }}
          onBatchUpdated={handleBatchUpdated} onItemsChanged={handleItemsChanged}
          onEditTripLine={onEditTripLine}
          zIndex={detailFromArchive ? 60 : 50}
        />
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <p className="font-semibold text-slate-800">Переместить в архив?</p>
              <p className="mt-1 text-sm text-slate-500">«{deleteTarget.name}» будет перемещена в архив. Все данные, записи ОТК и история сохранятся. Вы сможете восстановить партию из архива.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">Отмена</button>
              <button type="button" onClick={() => void handleDelete(deleteTarget)} disabled={isDeleting}
                className="rounded-2xl bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                {isDeleting ? 'Архивирование…' : 'В архив'}
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
            <button type="button" onClick={() => void handleOpenArchive()}
              className="flex h-9 items-center gap-1.5 rounded-2xl border border-slate-200 px-3 text-sm font-medium text-slate-500 hover:bg-slate-50">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
              </svg>
              Архив
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
                <th className="px-4 py-3 text-center">ОТК</th>
                <th className="px-4 py-3 text-center">Статус</th>
                <th className="px-4 py-3 text-left">Создана</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((b) => {
                const s = stores.find((st) => st.id === b.store_id)
                const disc = b.otk_discrepancy
                return (
                  <tr key={b.id} onClick={() => isOpeningDetail !== b.id && void handleOpenDetail(b.id)}
                    className="cursor-pointer hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{b.name}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{s?.name ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                        {stageLabel(b)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {disc !== null && disc !== undefined && disc !== 0 ? (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${disc > 0 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'}`}>
                          {disc > 0 ? `+${disc}` : disc}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
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

      {/* Модалка архива */}
      {isArchiveOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setIsArchiveOpen(false)}>
          <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" style={{ maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
              <p className="font-semibold text-slate-800">Архив партий</p>
              <button type="button" onClick={() => setIsArchiveOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isArchiveLoading ? (
                <div className="flex items-center justify-center py-16 text-sm text-slate-400">Загрузка…</div>
              ) : archivedBatches.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <p className="font-medium text-slate-600">Архив пуст</p>
                  <p className="text-sm text-slate-400">Архивированные партии появятся здесь</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Партия</th>
                      <th className="px-4 py-3 text-left">Магазин</th>
                      <th className="px-4 py-3 text-center">Этап</th>
                      <th className="px-4 py-3 text-left">Архивирована</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {archivedBatches.map((b) => {
                      const s = stores.find((st) => st.id === b.store_id)
                      return (
                        <tr key={b.id} className="cursor-pointer hover:bg-slate-50/80"
                          onClick={() => { setDetailFromArchive(true); void handleOpenDetail(b.id) }}>
                          <td className="cursor-pointer px-4 py-3">
                            <p className="font-medium text-slate-800">{b.name}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-500">{s?.name ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                              {stageLabel(b)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs">
                            {b.deleted_at ? new Date(b.deleted_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button type="button" disabled={isRestoring === b.id}
                              onClick={(e) => { e.stopPropagation(); void handleRestore(b) }}
                              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                              {isRestoring === b.id ? 'Восстановление…' : 'Восстановить'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
