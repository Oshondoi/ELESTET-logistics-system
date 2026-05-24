import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import type {
  FulfillmentBatch,
  FulfillmentBatchWithItems,
  FulfillmentItem,
  FulfillmentOtkLog,
  FulfillmentOtkLogHistory,
  FulfillmentMarkingLog,
  FulfillmentMarkingLogHistory,
  FulfillmentPackagingLog,
  FulfillmentSupplyWithBoxes,
  FulfillmentSettings,
  FulfillmentStage,
  FulfillmentWorkTariff,
  BatchConsumable,
  Consumable,
  ConsumableCatalogItem,
  Store,
  TripLine,
  TripWithLines,
  TripLineFormValues,
  Warehouse,
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
  fetchSupplies,
  createSupply,
  deleteSupply,
  updateSupply,
  createBox,
  closeBox,
  reopenBox,
  deleteBox,
  addBoxItem,
  deleteBoxItem,
  fetchStageCompletedAt,
  fetchBatchConsumables,
  upsertBatchConsumable,
  deleteBatchConsumable,
  fetchPackagingLogs,
  addPackagingLog,
  updatePackagingLog,
  deletePackagingLog,
  uploadPackagingPhoto,
} from '../services/fulfillmentService'
import type { CatalogProduct, OtkPerformer, ProductInfo } from '../services/fulfillmentService'
import { OutsourceStagesModal } from '../components/fulfillment/OutsourceStagesModal'
import {
  findProductByBarcode,
} from '../services/fulfillmentService'
import { createTrip, addTripLine, setTripLineFulfillmentBatch, updateTripLineTripId } from '../services/tripService'
import { fetchWorkTariffs, fetchConsumables, fetchConsumableCatalog } from '../services/directoriesService'
import { Card } from '../components/ui/Card'
import { InvoicePhotoCell } from '../components/ui/InvoicePhotoCell'
import { createStoreInSupabase } from '../services/storeService'

// ── Вспомогательные константы ─────────────────────────────────
const STAGE_LABELS: Record<FulfillmentStage, string> = {
  reception: 'Приёмка',
  otk: 'ОТК',
  packaging: 'Упаковка',
  marking: 'Маркировка',
  packing: 'Короба',
  logistics: 'Логистика',
  done: 'Готово',
}

const STAGE_ORDER: FulfillmentStage[] = ['reception', 'otk', 'packaging', 'marking', 'packing', 'logistics', 'done']

const STAGE_LABELS_TO: Partial<Record<FulfillmentStage, string>> = {
  reception: 'Приёмке',
  otk: 'ОТК',
  packaging: 'Упаковке',
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
  accountShortId: number | null
  stores: Store[]
  trips: TripWithLines[]
  warehouses: Warehouse[]
  onEditTripLine: (tripId: string, lineId: string, values: TripLineFormValues, newTripId?: string) => Promise<void>
  onAddTripLine?: (tripId: string, values: TripLineFormValues) => Promise<TripLine>
  onTripCreated?: (trip: TripWithLines) => void
  onStoreCreated?: (store: Store) => void
  canManage?: boolean
  canOtkAssign?: boolean
  canStageJump?: boolean
  canPackingAutoAdd?: boolean
  canSupplyDeleteLocked?: boolean
  userId?: string
  userEmail?: string
  userName?: string
  initialBatchShortId?: number | null
  onBatchUrlConsumed?: () => void
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
    if (s === 'packaging') return batch.stage_packaging
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
  accountShortId: number | null
  stores: Store[]
  trips: TripWithLines[]
  warehouses: Warehouse[]
  canManage: boolean
  canOtkAssign: boolean
  canStageJump: boolean
  canPackingAutoAdd: boolean
  canSupplyDeleteLocked: boolean
  userId: string
  userEmail: string
  userName: string
  onClose: () => void
  onBatchUpdated: (b: FulfillmentBatch) => void
  onItemsChanged: (items: FulfillmentItem[]) => void
  onEditTripLine: (tripId: string, lineId: string, values: TripLineFormValues, newTripId?: string) => Promise<void>
  onAddTripLine?: (tripId: string, values: TripLineFormValues) => Promise<TripLine>
  onTripCreated?: (trip: TripWithLines) => void
  zIndex?: number
}

const BatchDetailModal = ({
  batch: initialBatch,
  accountId,
  accountShortId,
  stores,
  trips,
  warehouses,
  canManage,
  canOtkAssign,
  canStageJump,
  canPackingAutoAdd,
  canSupplyDeleteLocked,
  userId,
  userEmail,
  userName,
  onClose,
  onBatchUpdated,
  onItemsChanged,
  onEditTripLine,
  onAddTripLine,
  onTripCreated,
  zIndex = 50,
}: DetailModalProps) => {
  const [batch, setBatch] = useState<FulfillmentBatchWithItems>(initialBatch)
  const [shareOpen, setShareOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [tgClicked, setTgClicked] = useState(false)
  const [waClicked, setWaClicked] = useState(false)
  const shareRef = useRef<HTMLDivElement>(null)
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
  const [newColor, setNewColor] = useState('')
  const [isLooking, setIsLooking] = useState(false)
  const [isAddingSaving, setIsAddingSaving] = useState(false)
  const [receptionCameraOpen, setReceptionCameraOpen] = useState(false)
  const [receptionCameraError, setReceptionCameraError] = useState<string | null>(null)
  const [receptionCameraRescanKey, setReceptionCameraRescanKey] = useState(0)
  const [singleScanMode, setSingleScanMode] = useState(false)
  const receptionVideoRef = useRef<HTMLVideoElement>(null)
  const receptionStreamRef = useRef<MediaStream | null>(null)
  const receptionDetectRef = useRef(false)
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const otkFileInputRef = useRef<HTMLInputElement>(null)
  const markingFileInputRef = useRef<HTMLInputElement>(null)
  const markingBarcodeRef = useRef<HTMLInputElement>(null)
  const markingVideoRef = useRef<HTMLVideoElement>(null)
  const markingStreamRef = useRef<MediaStream | null>(null)
  const markingDetectRef = useRef(false)
  const markingItemsRef = useRef(items)
  const packingVideoRef = useRef<HTMLVideoElement>(null)
  const packingStreamRef = useRef<MediaStream | null>(null)
  const packingDetectRef = useRef(false)

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
  const [otkTariff, setOtkTariff] = useState<string>('')
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
  const [otkAddModalOpen, setOtkAddModalOpen] = useState(false)
  const [markingAddModalOpen, setMarkingAddModalOpen] = useState(false)
  const [otkDeletedLogs, setOtkDeletedLogs] = useState<FulfillmentOtkLog[]>([])
  const [otkEditingId, setOtkEditingId] = useState<string | null>(null)
  const [otkDeleteConfirmId, setOtkDeleteConfirmId] = useState<string | null>(null)
  const [otkHistoryLog, setOtkHistoryLog] = useState<FulfillmentOtkLog | null>(null)

  // Маркировка — журнал логов (аналог ОТК)
  const [markingLogs, setMarkingLogs] = useState<FulfillmentMarkingLog[]>([])
  const [isLoadingMarking, setIsLoadingMarking] = useState(false)
  const [markingTariff, setMarkingTariff] = useState<string>('')
  const [markingBarcode, setMarkingBarcode] = useState('')
  const [markingCameraOpen, setMarkingCameraOpen] = useState(false)
  const [markingCameraError, setMarkingCameraError] = useState<string | null>(null)
  const [markingScannedBarcode, setMarkingScannedBarcode] = useState<string | null>(null)
  const [markingRescanKey, setMarkingRescanKey] = useState(0)
  const [markingEditScanTarget, setMarkingEditScanTarget] = useState<{ type: 'log'; id: string } | { type: 'buffer'; tempId: string } | null>(null)
  const [markingItemId, setMarkingItemId] = useState<string | null>(null)
  const [markingItemName, setMarkingItemName] = useState<string | null>(null)
  const [markingQty, setMarkingQty] = useState('')
  const [markingDefect, setMarkingDefect] = useState('')
  const [markingLabelsQty, setMarkingLabelsQty] = useState('')
  const [markingLabelsAll, setMarkingLabelsAll] = useState(false)
  const [markingConsumableId, setMarkingConsumableId] = useState<string>('')
  const [markingNotes, setMarkingNotes] = useState('')
  const [markingPerformerId, setMarkingPerformerId] = useState(userId)
  const [markingPerformerName, setMarkingPerformerName] = useState(userName || userEmail)
  const [markingPerformers, setMarkingPerformers] = useState<OtkPerformer[]>([])
  const [isAddingMarking, setIsAddingMarking] = useState(false)
  const [markingPhotoFiles, setMarkingPhotoFiles] = useState<File[]>([])
  type MarkingBufferEntry = {
    tempId: string
    performer_user_id: string | null
    performer_name: string
    tariff: string
    qty: number
    qty_defect: number
    notes: string
    photo_files: File[]
    barcode: string | null
    item_id: string | null
    item_name: string | null
    consumable_id: string | null
    labels_qty: number | null
    labels_all: boolean
  }
  const [markingBuffer, setMarkingBuffer] = useState<MarkingBufferEntry[]>([])
  const [markingEdits, setMarkingEdits] = useState<Record<string, {
    tariff: string
    qty: number
    qty_defect: number
    notes: string
    barcode: string
    consumable_id: string | null
    labels_qty: number | null
    labels_all: boolean
  }>>({})
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

  // Тарифы работ из БД
  const [workTariffs, setWorkTariffs] = useState<FulfillmentWorkTariff[]>([])
  const otkTariffsList = workTariffs.filter((t) => t.stage === 'otk')
  const markingTariffsList = workTariffs.filter((t) => t.stage === 'marking')
  const packagingTariffsList = workTariffs.filter((t) => t.stage === 'packaging')

  // Логистика


  // Упаковка (packaging stage)
  const [batchConsumables, setBatchConsumables] = useState<BatchConsumable[]>([])
  const [accountConsumables, setAccountConsumables] = useState<Consumable[]>([])
  const [isLoadingConsumables, setIsLoadingConsumables] = useState(false)
  const [boxesQtyMode, setBoxesQtyMode] = useState<'all' | 'custom'>('custom')
  const [boxesQtyInput, setBoxesQtyInput] = useState(String(batch.boxes_qty ?? 0))
  const [isSavingBoxesQty, setIsSavingBoxesQty] = useState(false)
  const [boxCatalogItems, setBoxCatalogItems] = useState<ConsumableCatalogItem[]>([])
  const [boxCatalogConsumableId, setBoxCatalogConsumableId] = useState<string>(batch.box_catalog_consumable_id ?? '')
  const [consumableSaving, setConsumableSaving] = useState<Record<string, boolean>>({})

  // Упаковка — журнал работ
  const [packagingLogs, setPackagingLogs] = useState<FulfillmentPackagingLog[]>([])
  const [isLoadingPackagingLogs, setIsLoadingPackagingLogs] = useState(false)
  const [packagingWorkTariff, setPackagingWorkTariff] = useState<string>('')
  const [packagingWorkQty, setPackagingWorkQty] = useState('')
  const [packagingWorkDefect, setPackagingWorkDefect] = useState('')
  const [packagingWorkNotes, setPackagingWorkNotes] = useState('')
  const [packagingWorkZipBags, setPackagingWorkZipBags] = useState('')
  const [packagingWorkZipBagsAll, setPackagingWorkZipBagsAll] = useState(false)
  const [packagingWorkPerformerId, setPackagingWorkPerformerId] = useState(userId)
  const [packagingWorkPerformerName, setPackagingWorkPerformerName] = useState(userName || userEmail)
  const [packagingPerformers, setPackagingPerformers] = useState<OtkPerformer[]>([])
  const [isAddingPackagingLog, setIsAddingPackagingLog] = useState(false)
  const [packagingWorkPhotoFiles, setPackagingWorkPhotoFiles] = useState<File[]>([])
  const [packagingWorkConsumableId, setPackagingWorkConsumableId] = useState<string>('')
  const [packagingWorkCatalogConsumableId, setPackagingWorkCatalogConsumableId] = useState<string>('')
  const [zipCatalogItems, setZipCatalogItems] = useState<ConsumableCatalogItem[]>([])
  type PackagingBufferEntry = { tempId: string; performer_user_id: string | null; performer_name: string; tariff: string; qty: number; qty_defect: number; notes: string; photo_files: File[]; consumable_id: string | null; catalog_consumable_id: string | null; zip_bags_qty: number | null }
  const [packagingBuffer, setPackagingBuffer] = useState<PackagingBufferEntry[]>([])
  const [packagingEdits, setPackagingEdits] = useState<Record<string, {
    tariff: string
    qty: number
    qty_defect: number
    notes: string
    zip_bags_qty: number | null
    zip_bags_all: boolean
    catalog_consumable_id: string | null
  }>>({})
  const [packagingDeletedIds, setPackagingDeletedIds] = useState<string[]>([])
  const [packagingAddModalOpen, setPackagingAddModalOpen] = useState(false)
  const [packagingEditingId, setPackagingEditingId] = useState<string | null>(null)
  const [packagingDeleteConfirmId, setPackagingDeleteConfirmId] = useState<string | null>(null)
  const packagingFileInputRef = useRef<HTMLInputElement>(null)

  // Формирование коробов
  const [supplies, setSupplies] = useState<FulfillmentSupplyWithBoxes[]>([])
  const [isLoadingSupplies, setIsLoadingSupplies] = useState(false)
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('')
  const [isWarehouseDropdownOpen, setIsWarehouseDropdownOpen] = useState(false)
  // Логистика: слоты рейсов
  interface TripSlot { slotId: string; tripId: string; tripLabel: string }
  const [tripSlots, setTripSlots] = useState<TripSlot[]>([{ slotId: 'slot-0', tripId: batch.trip_id ?? '', tripLabel: (() => {
    if (!batch.trip_id) return ''
    const found = trips.find((t) => t.id === batch.trip_id)
    if (!found) return 'Рейс (сохранён)'
    return `${found.trip_number ?? `Рейс #${found.draft_number}`}${found.carrier ? ` · ${found.carrier}` : ''}${found.departure_date ? ` · ${new Date(found.departure_date).toLocaleDateString('ru-RU')}` : ''}`
  })() }])
  const [supplySlotMap, setSupplySlotMap] = useState<Record<string, string>>({})  // supplyId → slotId
  const [isTripPickerOpen, setIsTripPickerOpen] = useState(false)
  const [tripPickerSlotId, setTripPickerSlotId] = useState<string>('slot-0')
  const [showAllTrips, setShowAllTrips] = useState(false)
  const [tripSearch, setTripSearch] = useState('')
  const [isCreatingDraftTrip, setIsCreatingDraftTrip] = useState(false)
  const [editingSlotId, setEditingSlotId] = useState<string | null>(!batch.trip_id ? 'slot-0' : null)
  const [localDraftTrips, setLocalDraftTrips] = useState<TripWithLines[]>([])
  const [warehouseSearch, setWarehouseSearch] = useState('')
  const [isCreatingSupply, setIsCreatingSupply] = useState(false)
  const [supplyCreateError, setSupplyCreateError] = useState<string | null>(null)
  const [packingBoxBuffer, setPackingBoxBuffer] = useState<Record<string, { barcode: string; qty: number; name: string | null; itemId: string | null }[]>>({})
  const [packingBoxBarcode, setPackingBoxBarcode] = useState<Record<string, string>>({})
  const [packingBoxQty, setPackingBoxQty] = useState<Record<string, string>>({})
  const [packingOpenBoxId, setPackingOpenBoxId] = useState<string | null>(null)
  const [activeSupplyId, setActiveSupplyId] = useState<string | null>(null)
  const [isSavingBox, setIsSavingBox] = useState<string | null>(null)
  const packingBarcodeRef = useRef<HTMLInputElement>(null)
  const packingQtyRef = useRef<HTMLInputElement>(null)
  const [packingAutoAdd, setPackingAutoAdd] = useState(false)
  const [packingProductCache, setPackingProductCache] = useState<Record<string, ProductInfo | null>>({})
  const [packingPhotoPreview, setPackingPhotoPreview] = useState<{ url: string; x: number; y: number } | null>(null)
  const [packingCameraOpen, setPackingCameraOpen] = useState(false)
  const [packingCameraError, setPackingCameraError] = useState<string | null>(null)
  const [packingCameraScanned, setPackingCameraScanned] = useState<string | null>(null)
  const [packingCameraRescanKey, setPackingCameraRescanKey] = useState(0)
  const [packingCameraTargetBoxId, setPackingCameraTargetBoxId] = useState<string | null>(null)
  const [addBoxModal, setAddBoxModal] = useState<{ supplyId: string; nextNum: number } | null>(null)
  const [addBoxNum, setAddBoxNum] = useState('')
  const [deleteBoxConfirm, setDeleteBoxConfirm] = useState<{ supplyId: string; boxId: string } | null>(null)
  const [deleteSupplyConfirm, setDeleteSupplyConfirm] = useState<string | null>(null) // supplyId

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

  // Загрузить тарифы работ из БД
  useEffect(() => {
    fetchWorkTariffs(accountId)
      .then((list) => {
        setWorkTariffs(list)
        const firstOtk = list.find((t) => t.stage === 'otk')
        if (firstOtk) setOtkTariff(firstOtk.id)
        const firstMarking = list.find((t) => t.stage === 'marking')
        if (firstMarking) setMarkingTariff(firstMarking.id)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // Текущий просматриваемый этап (может отличаться от batch.current_stage при навигации)
  const [viewStage, setViewStage] = useState<FulfillmentStage>(initialBatch.current_stage)

  // Дата завершения этапа Приёмка
  const [receptionCompletedDate, setReceptionCompletedDate] = useState<string | null>(null)
  useEffect(() => {
    void fetchStageCompletedAt(initialBatch.id, 'reception').then((d) => setReceptionCompletedDate(d))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBatch.id])

  // Синхронизировать viewStage при реальном переходе этапа
  useEffect(() => { setViewStage(batch.current_stage) }, [batch.current_stage])

  // Закрывать share-попап по клику снаружи
  useEffect(() => {
    if (!shareOpen) return
    const handler = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [shareOpen])

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
      .then(([active, deleted]) => {
        setOtkLogs(active)
        setOtkDeletedLogs(deleted)
        // Всегда пересчитывать discrepancy по актуальным данным из БД
        const tReceived = items.reduce((s, it) => s + (it.qty_received ?? 0), 0)
        const tOtk = active.reduce((s, l) => s + l.qty + l.qty_defect, 0)
        // Если логов нет — discrepancy = 0 (или null). Если есть — считаем разницу.
        const discrepancy = active.length > 0 ? tOtk - tReceived : 0
        if (discrepancy !== (batch.otk_discrepancy ?? 0)) {
          updateBatch(batch.id, { otk_discrepancy: discrepancy })
            .then((updated) => {
              setBatch((prev) => ({ ...prev, ...updated }))
              onBatchUpdated(updated)
            })
            .catch(() => {/* тихо — не критично */})
        }
      })
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
    setIsLoadingConsumables(true)
    fetchConsumables(batch.account_id)
      .then((ac) => setAccountConsumables(ac as Consumable[]))
      .catch(() => setAccountConsumables([]))
      .finally(() => setIsLoadingConsumables(false))
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

  // Актуальные позиции для камерного лукапа (без stale closure)
  useEffect(() => { markingItemsRef.current = items }, [items])

  // Перестроить tripSlots и supplySlotMap из реальных данных поставок (supply.trip_id)
  const rebuildSlotsFromSupplies = useCallback((loaded: FulfillmentSupplyWithBoxes[]) => {
    const uniqueTripIds = [...new Set(
      loaded.map((s) => s.trip_id).filter((id): id is string => Boolean(id))
    )]
    if (uniqueTripIds.length > 0) {
      const newSlots: TripSlot[] = uniqueTripIds.map((tid, i) => {
        const found = trips.find((t) => t.id === tid)
        const label = found
          ? `${found.trip_number ?? `Рейс #${found.draft_number}`}${found.carrier ? ` · ${found.carrier}` : ''}${found.departure_date ? ` · ${new Date(found.departure_date).toLocaleDateString('ru-RU')}` : ''}`
          : 'Рейс (сохранён)'
        return { slotId: `slot-${i}`, tripId: tid, tripLabel: label }
      })
      setTripSlots(newSlots)
      const newMap: Record<string, string> = {}
      loaded.forEach((s) => {
        const slot = s.trip_id ? newSlots.find((sl) => sl.tripId === s.trip_id) : null
        newMap[s.id] = slot ? slot.slotId : (newSlots[0]?.slotId ?? 'slot-0')
      })
      setSupplySlotMap(newMap)
    } else {
      // Поставки ещё не привязаны к рейсам — оставляем текущие слоты
      setSupplySlotMap((prev) => {
        const next = { ...prev }
        loaded.forEach((s) => { if (!next[s.id]) next[s.id] = 'slot-0' })
        return next
      })
    }
  }, [trips])

  // Загрузить поставки при открытии этапа packing или logistics
  useEffect(() => {
    if (viewStage !== 'packing' && viewStage !== 'logistics') return
    setIsLoadingSupplies(true)
    fetchSupplies(batch.id)
      .then((loaded) => {
        setSupplies(loaded)
        if (viewStage === 'logistics') {
          // Перестраиваем слоты из реальных данных — чтобы завершённые партии отображались корректно
          rebuildSlotsFromSupplies(loaded)
        } else {
          setSupplySlotMap((prev) => {
            const next = { ...prev }
            loaded.forEach((s) => { if (!next[s.id]) next[s.id] = 'slot-0' })
            return next
          })
        }
      })
      .catch(() => setSupplies([]))
      .finally(() => setIsLoadingSupplies(false))
  }, [batch.id, viewStage])

  // Загрузить расходники-короба при открытии этапа packing
  useEffect(() => {
    if (viewStage !== 'packing') return
    fetchConsumableCatalog(batch.account_id)
      .then((items) => setBoxCatalogItems((items as ConsumableCatalogItem[]).filter((i) => i.kind === 'Короб' && !!i.size).sort((a, b) => { const ap = a.size.split('x').map(Number); const bp = b.size.split('x').map(Number); for (let i = 0; i < Math.max(ap.length, bp.length); i++) { const d = (bp[i] || 0) - (ap[i] || 0); if (d !== 0) return d } return 0 })))
      .catch(() => setBoxCatalogItems([]))
  }, [batch.account_id, viewStage])

  // Загрузить расходники при открытии этапа packaging
  useEffect(() => {
    if (viewStage !== 'packaging') return
    setIsLoadingConsumables(true)
    Promise.all([fetchBatchConsumables(batch.id), fetchConsumables(batch.account_id), fetchConsumableCatalog(batch.account_id)])
      .then(([bc, ac, catalog]) => {
        setBatchConsumables(bc)
        setAccountConsumables(ac as Consumable[])
        setZipCatalogItems((catalog as ConsumableCatalogItem[]).filter((i) => i.kind === 'ZIP-пакет' && !!i.size).sort((a, b) => { const ap = a.size.split('x').map(Number); const bp = b.size.split('x').map(Number); for (let i = 0; i < Math.max(ap.length, bp.length); i++) { const d = (bp[i] || 0) - (ap[i] || 0); if (d !== 0) return d } return 0 }))
      })
      .catch(() => {})
      .finally(() => setIsLoadingConsumables(false))
    // Загрузить логи работ упаковки
    setIsLoadingPackagingLogs(true)
    fetchPackagingLogs(batch.id)
      .then(setPackagingLogs)
      .catch(() => setPackagingLogs([]))
      .finally(() => setIsLoadingPackagingLogs(false))
    if (canOtkAssign) {
      fetchOtkPerformers(accountId)
        .then((list) => {
          setPackagingPerformers(list)
          const me = list.find((p) => p.user_id === userId)
          setPackagingWorkPerformerId(userId)
          setPackagingWorkPerformerName(me?.full_name || userName || userEmail)
        })
        .catch(() => setPackagingPerformers([]))
    }
  }, [batch.id, batch.account_id, viewStage])

  // Камера — BarcodeDetector (Chrome Android) + ZXing fallback (все остальные)
  useEffect(() => {
    if (!markingCameraOpen) {
      markingDetectRef.current = false
      markingStreamRef.current?.getTracks().forEach((t) => t.stop())
      markingStreamRef.current = null
      return
    }
    setMarkingCameraError(null)
    setMarkingScannedBarcode(null)
    markingDetectRef.current = true

    let zxingControls: { stop: () => void } | null = null
    let cancelled = false

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        markingStreamRef.current = stream
        if (!markingVideoRef.current) return

        if ('BarcodeDetector' in window) {
          // Нативный API (Chrome Android)
          markingVideoRef.current.srcObject = stream
          await markingVideoRef.current.play()
          const detector = new (window as unknown as { BarcodeDetector: new (opts: object) => { detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e', 'itf'],
          })
          const scan = async () => {
            if (!markingDetectRef.current || !markingVideoRef.current) return
            try {
              const results = await detector.detect(markingVideoRef.current)
              if (results.length > 0) {
                markingDetectRef.current = false
                setMarkingScannedBarcode(results[0].rawValue)
                return
              }
            } catch { /* кадр не готов */ }
            if (markingDetectRef.current) requestAnimationFrame(scan)
          }
          requestAnimationFrame(scan)
        } else {
          // ZXing — работает во всех браузерах (Chrome Desktop, Firefox, Safari)
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          if (cancelled) return
          const reader = new BrowserMultiFormatReader()
          const controls = await reader.decodeFromStream(
            stream,
            markingVideoRef.current,
            (result) => {
              if (result && markingDetectRef.current) {
                markingDetectRef.current = false
                setMarkingScannedBarcode((result as unknown as { getText(): string }).getText())
              }
            }
          )
          if (cancelled) { controls.stop(); return }
          zxingControls = controls
        }
      } catch {
        if (!cancelled) {
          setMarkingCameraError('Нет доступа к камере. Используйте USB/BT-сканер или ручной ввод.')
        }
      }
    }

    void start()
    return () => {
      cancelled = true
      markingDetectRef.current = false
      zxingControls?.stop()
      markingStreamRef.current?.getTracks().forEach((t) => t.stop())
      markingStreamRef.current = null
    }
  }, [markingCameraOpen, markingRescanKey])

  // Камера для этапа Коробов
  useEffect(() => {
    if (!packingCameraOpen) {
      packingDetectRef.current = false
      packingStreamRef.current?.getTracks().forEach((t) => t.stop())
      packingStreamRef.current = null
      return
    }
    setPackingCameraError(null)
    setPackingCameraScanned(null)
    packingDetectRef.current = true
    let zxingControls: { stop: () => void } | null = null
    let cancelled = false
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        packingStreamRef.current = stream
        if (!packingVideoRef.current) return
        if ('BarcodeDetector' in window) {
          packingVideoRef.current.srcObject = stream
          await packingVideoRef.current.play()
          const detector = new (window as unknown as { BarcodeDetector: new (opts: object) => { detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e', 'itf'],
          })
          const scan = async () => {
            if (!packingDetectRef.current || !packingVideoRef.current) return
            try {
              const results = await detector.detect(packingVideoRef.current)
              if (results.length > 0) { packingDetectRef.current = false; setPackingCameraScanned(results[0].rawValue); return }
            } catch { /* кадр не готов */ }
            if (packingDetectRef.current) requestAnimationFrame(scan)
          }
          requestAnimationFrame(scan)
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          if (cancelled) return
          const reader = new BrowserMultiFormatReader()
          const controls = await reader.decodeFromStream(stream, packingVideoRef.current, (result) => {
            if (result && packingDetectRef.current) { packingDetectRef.current = false; setPackingCameraScanned((result as unknown as { getText(): string }).getText()) }
          })
          if (cancelled) { controls.stop(); return }
          zxingControls = controls
        }
      } catch {
        if (!cancelled) setPackingCameraError('Нет доступа к камере. Используйте USB/BT-сканер или ручной ввод.')
      }
    }
    void start()
    return () => {
      cancelled = true
      packingDetectRef.current = false
      zxingControls?.stop()
      packingStreamRef.current?.getTracks().forEach((t) => t.stop())
      packingStreamRef.current = null
    }
  }, [packingCameraOpen, packingCameraRescanKey])

  const handleBarcodeChange = useCallback(async (barcode: string) => {
    setNewBarcode(barcode)
    if (!barcode.trim()) {
      setNewName('')
      setNewSize('')
      return
    }
    if (barcode.length < 8 || !store?.api_key) return
    setIsLooking(true)
    try {
      const found = await lookupProductByBarcode(accountId, batch.store_id, barcode)
      if (found) {
        setNewName(found.name ?? '')
        setNewSize(found.size ?? '')
        setNewColor(found.color ?? '')
      }
    } finally {
      setIsLooking(false)
    }
  }, [accountId, batch.store_id, store?.api_key])

  const handleReceptionCameraScan = async (barcode: string) => {
    setNewBarcode(barcode)
    setNewName('')
    setNewSize('')
    let resolvedName = ''
    let resolvedSize = ''
    let resolvedColor = ''
    if (barcode.length >= 8 && store?.api_key) {
      setIsLooking(true)
      try {
        const found = await lookupProductByBarcode(accountId, batch.store_id, barcode)
        if (found) {
          resolvedName = found.name ?? ''
          resolvedSize = found.size ?? ''
          resolvedColor = found.color ?? ''
          setNewName(resolvedName)
          setNewSize(resolvedSize)
          setNewColor(resolvedColor)
        }
      } finally {
        setIsLooking(false)
      }
    }
    if (singleScanMode) {
      setNewQty('1')
      setIsAddingSaving(true)
      setError(null)
      try {
        const item = await addItem({
          batch_id: batch.id,
          barcode: barcode.trim(),
          product_name: resolvedName || null,
          size: resolvedSize || null,
          color: resolvedColor || null,
          article: null,
          qty_received: 1,
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
        void recalcOtkDiscrepancy(next, otkLogs)
        setNewBarcode(''); setNewQty(''); setNewName(''); setNewSize(''); setNewColor('')
        // Переканывать следующий скан
        receptionDetectRef.current = true
        setReceptionCameraRescanKey((k) => k + 1)
      } catch (err) {
        setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
      } finally {
        setIsAddingSaving(false)
      }
    }
  }

  // Камера для этапа Приёмки (По баркоду)
  useEffect(() => {
    if (!receptionCameraOpen) {
      receptionDetectRef.current = false
      receptionStreamRef.current?.getTracks().forEach((t) => t.stop())
      receptionStreamRef.current = null
      return
    }
    setReceptionCameraError(null)
    receptionDetectRef.current = true
    let zxingControls: { stop: () => void } | null = null
    let cancelled = false

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        receptionStreamRef.current = stream
        // Попытка включить continuous autofocus (поддерживается не всеми браузерами/устройствами)
        const track = stream.getVideoTracks()[0]
        if (track) {
          try {
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
          } catch { /* браузер не поддерживает — ок */ }
        }
        if (!receptionVideoRef.current) return

        // Ручной canvas-скан с TRY_HARDER — надёжнее decodeFromStream для вебкамеры ноутбука
        receptionVideoRef.current.srcObject = stream
        await receptionVideoRef.current.play()
        if (cancelled) return
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const zxingLib = await import('@zxing/library')
        if (cancelled) return
        const hints = new Map<unknown, unknown>([[zxingLib.DecodeHintType.TRY_HARDER, true]])
        const reader = new BrowserMultiFormatReader(hints as any)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')!
        let scanTimer: ReturnType<typeof setTimeout> | null = null
        const scan = () => {
          if (!receptionDetectRef.current || !receptionVideoRef.current) return
          const video = receptionVideoRef.current
          if (video.readyState >= 2 && video.videoWidth > 0) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            ctx.drawImage(video, 0, 0)
            try {
              const result = (reader as unknown as { decodeFromCanvas(c: HTMLCanvasElement): { getText(): string } }).decodeFromCanvas(canvas)
              receptionDetectRef.current = false
              void handleReceptionCameraScan(result.getText())
              return
            } catch { /* кадр без штрихкода */ }
          }
          if (receptionDetectRef.current) scanTimer = setTimeout(scan, 200)
        }
        scan()
        zxingControls = { stop: () => { if (scanTimer !== null) clearTimeout(scanTimer) } }
      } catch {
        if (!cancelled) setReceptionCameraError('Нет доступа к камере. Используйте USB/BT-сканер или ручной ввод.')
      }
    }

    void start()
    return () => {
      cancelled = true
      receptionDetectRef.current = false
      zxingControls?.stop()
      receptionStreamRef.current?.getTracks().forEach((t) => t.stop())
      receptionStreamRef.current = null
    }
  }, [receptionCameraOpen, receptionCameraRescanKey])

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
        color: newColor.trim() || null,
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
      void recalcOtkDiscrepancy(next, otkLogs)
      setNewBarcode(''); setNewQty(''); setNewName(''); setNewSize(''); setNewColor('')
      barcodeInputRef.current?.focus()
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
      void recalcOtkDiscrepancy(next, otkLogs)
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
        color: null,
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
      void recalcOtkDiscrepancy(next, otkLogs)
      setBulkQty(''); setBulkNote('')
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
        color: null,
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
      void recalcOtkDiscrepancy(next, otkLogs)
      setSubjectName(''); setSubjectQty('')
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
        product_name: 'Готовые короба',
        size: null,
        color: null,
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
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
    } finally {
      setIsAddingSaving(false)
    }
  }

  // Приёмка: qty_received редактируется локально, сохраняется по кнопке
  const handleUpdateReceivedDraft = (id: string, qty: number) => {
    setReceptionDraft((p) => ({ ...p, [id]: qty }))
    setIsDirty(true)
  }

  // Пересчитать и сохранить otk_discrepancy по актуальным данным
  const recalcOtkDiscrepancy = async (currentItems: FulfillmentItem[], currentOtkLogs: typeof otkLogs) => {
    const tReceived = currentItems.reduce((s, it) => s + (it.qty_received ?? 0), 0)
    const tOtk = currentOtkLogs.reduce((s, l) => s + l.qty + l.qty_defect, 0)
    // Если логов нет — сбросить в 0, иначе считаем разницу
    const discrepancy = currentOtkLogs.length > 0 ? tOtk - tReceived : 0
    if (discrepancy !== (batch.otk_discrepancy ?? 0)) {
      const updated = await updateBatch(batch.id, { otk_discrepancy: discrepancy })
      setBatch((prev) => ({ ...prev, ...updated }))
      onBatchUpdated(updated)
    }
  }

  // Сохранить изменения приёмки в БД (без перехода)
  const handleSaveReceptionDraft = async () => {
    setIsSavingDraft(true)
    setError(null)
    try {
      const toUpdate = items.filter((it) => receptionDraft[it.id] !== undefined && receptionDraft[it.id] !== it.qty_received)
      const updated = await Promise.all(toUpdate.map((it) => updateItem(it.id, { qty_received: receptionDraft[it.id] })))
      const nextItems = items.map((it) => {
        const upd = updated.find((u) => u.id === it.id)
        return upd ? upd : it
      })
      setItems(nextItems)
      onItemsChanged(nextItems)
      // Пересчитать расхождение ОТК с учётом новых qty_received
      await recalcOtkDiscrepancy(nextItems, otkLogs)
      setIsDirty(false)
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
    } finally {
      setIsSavingDraft(false)
    }
  }

  // ── Обогащение баркода данными о товаре ─────────────────────
  const lookupAndCacheBarcode = useCallback(async (bc: string) => {
    if (packingProductCache[bc] !== undefined) return
    // Сначала быстро ставим null чтобы не дублировать запросы
    setPackingProductCache((prev) => ({ ...prev, [bc]: null }))
    const info = await findProductByBarcode(accountId, batch.store_id, bc)
    setPackingProductCache((prev) => ({ ...prev, [bc]: info }))
  }, [packingProductCache, accountId, batch.store_id])

  // Preload info для всех баркодов в активной поставке
  useEffect(() => {
    if (!activeSupplyId) return
    const supply = supplies.find((s) => s.id === activeSupplyId)
    if (!supply) return
    const barcodes = [...new Set(supply.boxes.flatMap((b) => b.items.map((i) => i.barcode)))]
    for (const bc of barcodes) {
      if (packingProductCache[bc] !== undefined) continue
      void lookupAndCacheBarcode(bc)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSupplyId])

  // Сохранить локальные поставки/короба/позиции в БД
  const persistLocalSupplies = async () => {
    const localSupplies = supplies.filter((s) => s._local)
    for (const supply of localSupplies) {
      const created = await createSupply({
        batch_id: supply.batch_id,
        account_id: supply.account_id,
        warehouse_id: supply.warehouse_id || null,
        warehouse_name: supply.warehouse_name,
        trip_id: supply.trip_id || null,
        trip_line_id: supply.trip_line_id || null,
        created_by: supply.created_by,
      })
      for (const box of supply.boxes) {
        const createdBox = await createBox({ supply_id: created.id, account_id: box.account_id, box_number: box.box_number })
        for (const item of box.items) {
          await addBoxItem({ box_id: createdBox.id, account_id: item.account_id, barcode: item.barcode, item_id: item.item_id, product_name: item.product_name, qty: item.qty })
        }
        if (box.status === 'closed') await closeBox(createdBox.id)
      }
    }
    // Также сохранить изменения статуса у уже существующих коробов (reopen/close)
    const savedSupplies = supplies.filter((s) => !s._local)
    for (const supply of savedSupplies) {
      for (const box of supply.boxes) {
        if (box._local) {
          const createdBox = await createBox({ supply_id: supply.id, account_id: box.account_id, box_number: box.box_number })
          for (const item of box.items) {
            await addBoxItem({ box_id: createdBox.id, account_id: item.account_id, barcode: item.barcode, item_id: item.item_id, product_name: item.product_name, qty: item.qty })
          }
          if (box.status === 'closed') await closeBox(createdBox.id)
        } else {
          for (const item of box.items.filter((i) => i._local)) {
            await addBoxItem({ box_id: box.id, account_id: item.account_id, barcode: item.barcode, item_id: item.item_id, product_name: item.product_name, qty: item.qty })
          }
        }
      }
    }
    if (localSupplies.length > 0) {
      const refreshed = await fetchSupplies(batch.id)
      setSupplies(refreshed)
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
      if (viewStage === 'packing') {
        await persistLocalSupplies()

        // После завершения партии — автоматически привязать новые поставки к рейсу
        const _autoTripId = tripSlots[0]?.tripId ?? ''
        if (batch.status === 'done' && _autoTripId && batch.store_id) {
          const freshSupplies = await fetchSupplies(batch.id)
          const receptionCompletedAt = await fetchStageCompletedAt(batch.id, 'reception')
          const receptionDateStr = receptionCompletedAt
            ? new Date(receptionCompletedAt).toISOString().slice(0, 10)
            : ''
          for (const supply of freshSupplies.filter((s) => !s.trip_line_id)) {
            const boxQty = supply.boxes.length
            const unitsQty = supply.boxes.reduce(
              (sum, box) => sum + box.items.reduce((s, item) => s + item.qty, 0),
              0,
            )
            const tripLineValues: TripLineFormValues = {
              store_id: batch.store_id!,
              destination_warehouse: supply.warehouse_name,
              box_qty: boxQty,
              units_qty: unitsQty,
              units_total: unitsQty,
              arrived_box_qty: 0,
              weight: 0,
              planned_marketplace_delivery_date: '',
              arrival_date: '',
              reception_date: receptionDateStr,
              shipped_date: '',
              status: 'Ожидает отправки',
              payment_status: 'Не оплачено',
              comment: '',
            }
            const tripLine = onAddTripLine
              ? await onAddTripLine(_autoTripId, tripLineValues)
              : await addTripLine(batch.account_id, _autoTripId, tripLineValues)
            await updateSupply(supply.id, { trip_id: _autoTripId, trip_line_id: tripLine.id })
            // Пометить поставку как созданную из фулфилмента — блокирует ручное редактирование
            try { await setTripLineFulfillmentBatch(tripLine.id, batch.id) } catch {}
          }
          const refreshedSupplies = await fetchSupplies(batch.id)
          setSupplies(refreshedSupplies)
        }
      }
      const refreshed = await fetchBatchWithItems(batch.id)
      setItems(refreshed.items)
      onItemsChanged(refreshed.items)
      setIsDirty(false)
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
    } finally {
      setIsSavingDraft(false)
    }
  }

  const handleSaveBoxesQty = async () => {
    if (!canManage) return
    const allBoxesQty = supplies.reduce((s, sup) => s + sup.boxes.length, 0)
    const qty = boxesQtyMode === 'all'
      ? allBoxesQty
      : Math.max(0, parseInt(boxesQtyInput, 10) || 0)
    setIsSavingBoxesQty(true)
    setError(null)
    try {
      const updated = await updateBatch(batch.id, { boxes_qty: qty, box_catalog_consumable_id: boxCatalogConsumableId || null })
      setBatch((prev) => ({ ...prev, ...updated }))
      onBatchUpdated(updated)
      setBoxesQtyInput(String(qty))
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
    } finally {
      setIsSavingBoxesQty(false)
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
        color: null,
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
      void recalcOtkDiscrepancy(next, otkLogs)
      setCatalogQties((prev) => { const n = { ...prev }; delete n[key]; return n })
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
    } finally {
      setIsAddingSaving(false)
    }
  }

  // Изменить этапы партии (только будущие этапы)
  const handleToggleBatchStage = async (
    stage: 'stage_otk' | 'stage_packaging' | 'stage_marking' | 'stage_packing' | 'stage_logistics',
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
      if (batch.current_stage === 'packing') await persistLocalSupplies()

      // При завершении логистики — создаём trip_lines из поставок фулфилмента
      const hasAnyTripSlot = tripSlots.some((s) => s.tripId)
      if (batch.current_stage === 'logistics' && hasAnyTripSlot && batch.store_id) {
        // Убедиться что локальные поставки сохранены
        const hasLocal = supplies.some((s) => s._local)
        if (hasLocal) await persistLocalSupplies()
        // Дата завершения этапа Приёмка (reception_date в trip_line = "Приём")
        const receptionCompletedAt = await fetchStageCompletedAt(batch.id, 'reception')
        const receptionDateStr = receptionCompletedAt
          ? new Date(receptionCompletedAt).toISOString().slice(0, 10)
          : ''
        // Загрузить актуальные поставки из БД
        const freshSupplies = await fetchSupplies(batch.id)
        // Создать trip_line для каждой поставки без trip_line_id
        for (const supply of freshSupplies.filter((s) => !s.trip_line_id)) {
          // В per-supply режиме используем рейс конкретной поставки
          const tripIdForSupply = tripSlots.find((s) => s.slotId === (supplySlotMap[supply.id] ?? tripSlots[0]?.slotId))?.tripId ?? ''
          if (!tripIdForSupply) continue
          const boxQty = supply.boxes.length
          const unitsQty = supply.boxes.reduce(
            (sum, box) => sum + box.items.reduce((s, item) => s + item.qty, 0),
            0,
          )
          const tripLineValues: TripLineFormValues = {
            store_id: batch.store_id!,
            destination_warehouse: supply.warehouse_name,
            box_qty: boxQty,
            units_qty: unitsQty,
            units_total: unitsQty,
            arrived_box_qty: 0,
            weight: 0,
            planned_marketplace_delivery_date: '',
            arrival_date: '',
            reception_date: receptionDateStr,
            shipped_date: '',
            status: 'Ожидает отправки',
            payment_status: 'Не оплачено',
            comment: '',
          }
          // Используем onAddTripLine из useAppData чтобы обновить React-стейт Логистики
          const tripLine = onAddTripLine
            ? await onAddTripLine(tripIdForSupply, tripLineValues)
            : await addTripLine(batch.account_id, tripIdForSupply, tripLineValues)
          await updateSupply(supply.id, { trip_id: tripIdForSupply, trip_line_id: tripLine.id })
          // Пометить поставку как созданную из фулфилмента — блокирует ручное редактирование
          try { await setTripLineFulfillmentBatch(tripLine.id, batch.id) } catch {}
        }
        // Сохранить trip_id в батч (требует применённого patch_fulfillment_trip_id.sql)
        try {
          await updateBatch(batch.id, { trip_id: tripSlots[0]?.tripId ?? '' })
        } catch {
          // Колонка может ещё не существовать — некритично
        }
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
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
    setOtkAddModalOpen(false)
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
        await addOtkLogHistory({ log_id: log.id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'deleted', old_values: { performer_name: log.performer_name, tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [] }, new_values: {} })
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
        await addOtkLogHistory({ log_id: log.id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'created', old_values: null, new_values: { performer_name: log.performer_name, tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls } })
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
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
      await addOtkLogHistory({ log_id: log.id, user_id: log.user_id, user_email: log.user_email, user_name: log.user_name ?? otkPerformers.find((p) => p.user_id === log.user_id)?.full_name ?? (log.user_id === userId ? userName : null) ?? null, action: 'created', old_values: null, new_values: { performer_name: log.performer_name, tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [] } })
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
    const labelsQty = markingLabelsAll
      ? (qty > 0 ? qty : null)
      : (Number(markingLabelsQty) > 0 ? Number(markingLabelsQty) : null)
    if (!markingBarcode.trim()) return
    if (qty <= 0 && qtyDefect <= 0) return
    const hasBarcodeItems = items.some((it) => it.barcode && it.barcode.trim() !== '')
    if (hasBarcodeItems && !markingItemId) return
    setMarkingBuffer((prev) => [...prev, {
      tempId: crypto.randomUUID(),
      performer_user_id: markingPerformerId || null,
      performer_name: markingPerformerName || userEmail || '',
      tariff: markingTariff,
      qty: Math.max(qty, 1), // qty > 0 constraint
      qty_defect: qtyDefect,
      notes: markingNotes.trim(),
      photo_files: markingPhotoFiles,
      barcode: markingBarcode.trim() || null,
      item_id: markingItemId,
      item_name: markingItemName,
      consumable_id: markingConsumableId || null,
      labels_qty: labelsQty,
      labels_all: markingLabelsAll,
    }])
    setIsDirty(true)
    setMarkingBarcode('')
    setMarkingItemId(null)
    setMarkingItemName(null)
    setMarkingQty('')
    setMarkingDefect('')
    setMarkingLabelsQty('')
    setMarkingLabelsAll(false)
    setMarkingConsumableId('')
    setMarkingNotes('')
    setMarkingPhotoFiles([])
    setMarkingAddModalOpen(false)
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
        await addMarkingLogHistory({ log_id: log.id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'deleted', old_values: { performer_name: log.performer_name, tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [], consumable_id: log.consumable_id ?? null, labels_qty: log.labels_qty ?? null }, new_values: {} })
      }))
      await Promise.all(Object.entries(markingEdits).map(async ([id, v]) => {
        const originalLog = markingLogs.find((l) => l.id === id)
        const { labels_all: _labelsAll, ...dbPatch } = v
        await updateMarkingLog(id, dbPatch)
        if (originalLog) {
          const oldVals: Record<string, unknown> = {}
          const newVals: Record<string, unknown> = {}
          for (const k of Object.keys(dbPatch) as Array<keyof typeof dbPatch>) {
            if (originalLog[k as keyof typeof originalLog] !== dbPatch[k]) {
              oldVals[k] = originalLog[k as keyof typeof originalLog]
              newVals[k] = dbPatch[k]
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
          barcode: e.barcode ?? undefined,
          item_id: e.item_id ?? undefined,
          consumable_id: e.consumable_id ?? undefined,
          labels_qty: e.labels_qty,
        })
        await addMarkingLogHistory({ log_id: log.id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'created', old_values: null, new_values: { performer_name: log.performer_name, tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: photoUrls, consumable_id: log.consumable_id ?? null, labels_qty: log.labels_qty ?? null } })
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
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
    } finally {
      setIsSavingDraft(false)
    }
  }

  // ── Упаковка — добавление в буфер ─────────────────────────
  const handleAddPackagingLog = () => {
    const qty = Number(packagingWorkQty) || 0
    const qtyDefect = Number(packagingWorkDefect) || 0
    if (qty <= 0 && qtyDefect <= 0) return
    const tariff = packagingWorkTariff || (packagingTariffsList[0]?.id ?? 'standard')
    setPackagingBuffer((prev) => [...prev, {
      tempId: `tmp_${Date.now()}_${Math.random()}`,
      performer_user_id: packagingWorkPerformerId || null,
      performer_name: packagingWorkPerformerName,
      tariff,
      qty,
      qty_defect: qtyDefect,
      notes: packagingWorkNotes,
      photo_files: packagingWorkPhotoFiles,
      consumable_id: packagingWorkConsumableId || null,
      catalog_consumable_id: packagingWorkCatalogConsumableId || null,
      zip_bags_qty: packagingWorkZipBagsAll
        ? (qty > 0 ? qty : null)
        : (Number(packagingWorkZipBags) > 0 ? Number(packagingWorkZipBags) : null),
    }])
    setPackagingWorkQty('')
    setPackagingWorkDefect('')
    setPackagingWorkNotes('')
    setPackagingWorkZipBags('')
    setPackagingWorkZipBagsAll(false)
    setPackagingWorkPhotoFiles([])
    setPackagingWorkConsumableId('')
    setPackagingWorkCatalogConsumableId('')
    setPackagingAddModalOpen(false)
    setIsDirty(true)
  }

  const handleDeletePackagingLog = (id: string) => {
    setPackagingDeletedIds((prev) => [...prev, id])
    setPackagingEdits((prev) => { const n = { ...prev }; delete n[id]; return n })
    setIsDirty(true)
  }

  // ── Упаковка — сохранить всё ──────────────────────────────
  const handleSavePackagingAll = async () => {
    setIsSavingDraft(true)
    setError(null)
    try {
      await Promise.all(packagingDeletedIds.map((id) => deletePackagingLog(id)))
      await Promise.all(Object.entries(packagingEdits).map(([id, v]) => {
        const { zip_bags_all: _zipBagsAll, ...dbPatch } = v
        return updatePackagingLog(id, dbPatch)
      }))
      const newLogs = await Promise.all(packagingBuffer.map(async (e) => {
        const photoUrls = e.photo_files.length > 0
          ? await Promise.all(e.photo_files.map((f) => uploadPackagingPhoto(userId || 'anon', batch.id, f)))
          : []
        return addPackagingLog({
          batch_id: batch.id,
          account_id: batch.account_id,
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
          consumable_id: e.consumable_id,
          catalog_consumable_id: e.catalog_consumable_id,
          zip_bags_qty: e.zip_bags_qty,
        })
      }))
      setPackagingLogs((prev) => {
        const filtered = prev.filter((l) => !packagingDeletedIds.includes(l.id))
        const updated = filtered.map((l) => packagingEdits[l.id] ? { ...l, ...packagingEdits[l.id] } : l)
        return [...updated, ...newLogs]
      })
      setPackagingBuffer([])
      setPackagingEdits({})
      setPackagingDeletedIds([])
      setPackagingEditingId(null)
      setIsDirty(false)
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
    } finally {
      setIsSavingDraft(false)
    }
  }

  const handlePackagingAndAdvance = async () => {
    setIsSavingStage(true)
    setError(null)
    try {
      if (packagingBuffer.length > 0 || Object.keys(packagingEdits).length > 0 || packagingDeletedIds.length > 0) {
        await Promise.all(packagingDeletedIds.map((id) => deletePackagingLog(id)))
        await Promise.all(Object.entries(packagingEdits).map(([id, v]) => {
          const { zip_bags_all: _zipBagsAll, ...dbPatch } = v
          return updatePackagingLog(id, dbPatch)
        }))
        await Promise.all(packagingBuffer.map(async (e) => {
          const photoUrls = e.photo_files.length > 0
            ? await Promise.all(e.photo_files.map((f) => uploadPackagingPhoto(userId || 'anon', batch.id, f)))
            : []
          return addPackagingLog({
            batch_id: batch.id,
            account_id: batch.account_id,
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
            consumable_id: e.consumable_id,
            zip_bags_qty: e.zip_bags_qty,
          })
        }))
        setPackagingBuffer([])
        setPackagingEdits({})
        setPackagingDeletedIds([])
      }
      const updated = await advanceStage(batch)
      const newBatch = { ...batch, ...updated }
      setBatch(newBatch)
      onBatchUpdated(updated)
      setIsDirty(false)
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
    } finally {
      setIsSavingStage(false)
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
          if (log) await addMarkingLogHistory({ log_id: id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'deleted', old_values: { performer_name: log.performer_name, tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [], consumable_id: log.consumable_id ?? null, labels_qty: log.labels_qty ?? null }, new_values: {} })
        }))
        await Promise.all(Object.entries(markingEdits).map(async ([id, v]) => {
          const originalLog = markingLogs.find((l) => l.id === id)
          const { labels_all: _labelsAll, ...dbPatch } = v
          await updateMarkingLog(id, dbPatch)
          if (originalLog) {
            const oldVals: Record<string, unknown> = {}
            const newVals: Record<string, unknown> = {}
            for (const k of Object.keys(dbPatch) as Array<keyof typeof dbPatch>) {
              if (originalLog[k as keyof typeof originalLog] !== dbPatch[k]) {
                oldVals[k] = originalLog[k as keyof typeof originalLog]
                newVals[k] = dbPatch[k]
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
            barcode: e.barcode ?? undefined,
            item_id: e.item_id ?? undefined,
            consumable_id: e.consumable_id ?? undefined,
            labels_qty: e.labels_qty,
          })
          await addMarkingLogHistory({ log_id: log.id, user_id: userId || '', user_email: userEmail || '', user_name: userName || null, action: 'created', old_values: null, new_values: { performer_name: log.performer_name, tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: photoUrls, consumable_id: log.consumable_id ?? null, labels_qty: log.labels_qty ?? null } })
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
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
    } finally {
      setIsSavingStage(false)
    }
  }

  const tBoxes = sumField(items, 'boxes')
  const tPacked = sumField(items, 'qty_packed')
  const tReceived = sumField(items, 'qty_received')

  const nextStageName = enabledStages[currentIdx + 1]

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40" style={{ zIndex }} onClick={() => isDirty ? setPendingClose(true) : onClose()}>
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 border-b border-slate-100 px-6 py-4">
          <div className="flex-1 flex items-baseline gap-2 min-w-0">
            <p className="text-lg font-semibold text-slate-800 truncate">{batch.name}</p>
            {store && <p className="shrink-0 text-sm text-slate-400">{store.name}</p>}
          </div>
          {/* Share */}
          {accountShortId != null && batch.short_id != null && (() => {
            const batchUrl = `${window.location.origin}/fulfillment/C-${accountShortId}/P-${batch.short_id}`
            const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(batchUrl)}`
            const waUrl = `https://wa.me/?text=${encodeURIComponent(batchUrl)}`
            return (
              <div className="relative" ref={shareRef}>
                <button type="button"
                  onClick={() => setShareOpen((v) => !v)}
                  title="Поделиться"
                  className={`flex h-8 w-8 items-center justify-center rounded-2xl border transition-colors ${shareOpen ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" strokeLinecap="round"/>
                  </svg>
                </button>
                {shareOpen && (
                  <div className="absolute right-0 top-10 z-50 flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl" style={{ minWidth: 180 }}>
                    {/* Telegram */}
                    <a href={tgUrl} target="_blank" rel="noreferrer"
                      onClick={() => { setTgClicked(true); setTimeout(() => setTgClicked(false), 600); setShareOpen(false) }}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 ${tgClicked ? 'bg-[#e8f4fd]' : ''}`}>
                      <span className={`flex h-7 w-7 items-center justify-center rounded-xl transition-colors ${tgClicked ? 'bg-[#29b6f6] text-white' : 'bg-[#e8f4fd] text-[#29b6f6]'}`}>
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                        </svg>
                      </span>
                      Telegram
                    </a>
                    {/* WhatsApp */}
                    <a href={waUrl} target="_blank" rel="noreferrer"
                      onClick={() => { setWaClicked(true); setTimeout(() => setWaClicked(false), 600); setShareOpen(false) }}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 ${waClicked ? 'bg-[#e8f5e9]' : ''}`}>
                      <span className={`flex h-7 w-7 items-center justify-center rounded-xl transition-colors ${waClicked ? 'bg-[#25d366] text-white' : 'bg-[#e8f5e9] text-[#25d366]'}`}>
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                        </svg>
                      </span>
                      WhatsApp
                    </a>
                    {/* Divider */}
                    <div className="mx-2 my-0.5 h-px bg-slate-100" />
                    {/* Copy link */}
                    <button type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(batchUrl).then(() => {
                          setLinkCopied(true)
                          setTimeout(() => setLinkCopied(false), 2000)
                        })
                      }}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100`}>
                      <span className={`flex h-7 w-7 items-center justify-center rounded-xl transition-colors ${linkCopied ? 'bg-emerald-50 text-emerald-500' : 'bg-slate-100 text-slate-500'}`}>
                        {linkCopied
                          ? <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M13.828 10.172a4 4 0 0 0-5.656 0l-4 4a4 4 0 1 0 5.656 5.656l1.102-1.101m-.758-4.899a4 4 0 0 0 5.656 0l4-4a4 4 0 0 0-5.656-5.656l-1.1 1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        }
                      </span>
                      Копировать ссылку
                    </button>
                  </div>
                )}
              </div>
            )
          })()}
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
          <button type="button" onClick={() => isDirty ? setPendingClose(true) : onClose()} className="flex h-10 w-10 items-center justify-center rounded-2xl text-slate-400 hover:bg-red-50 hover:text-red-500">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stage progress */}
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start" style={{ minHeight: 96 }}>
            {(['reception', 'otk', 'packaging', 'marking', 'packing', 'logistics'] as FulfillmentStage[]).map((s, idx, arr) => {
              const stageIdx = STAGE_ORDER.indexOf(s)
              const currentStageIdx = STAGE_ORDER.indexOf(batch.current_stage)
              const isDone = currentStageIdx > stageIdx
              const isCurrent = batch.current_stage === s
              const isPast = stageIdx <= currentStageIdx
              const isLast = idx === arr.length - 1
              // этап включён?
              const keyMap: Record<string, keyof typeof batch> = { otk: 'stage_otk', packaging: 'stage_packaging', marking: 'stage_marking', packing: 'stage_packing', logistics: 'stage_logistics' }
              const stageKey = keyMap[s]
              const isEnabled = s === 'reception' || !stageKey || batch[stageKey] as boolean
              const canToggle = canManage && batch.status === 'active' && !isPast && !!stageKey && !isSavingBatchStages

              const handleClick = () => {
                if (isPast && canStageJump && isEnabled) {
                  setViewStage(s)
                } else if (canToggle) {
                  void handleToggleBatchStage(stageKey as 'stage_otk' | 'stage_packaging' | 'stage_marking' | 'stage_packing' | 'stage_logistics', !isEnabled)
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
                          ${!isEnabled ? 'border-2 border-dashed border-slate-200 bg-white text-slate-300' :
                            isDone ? 'bg-emerald-500 text-white' :
                            isCurrent ? 'bg-blue-600 text-white' :
                            canToggle ? 'bg-slate-100 text-slate-400 hover:bg-slate-200' :
                            'bg-slate-100 text-slate-400'}`}>
                        {!isEnabled ? (
                          <svg viewBox="0 0 24 24" className={`transition-all duration-300 ease-in-out ${isSelected ? 'h-7 w-7' : 'h-5 w-5'}`} fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        ) : isDone ? (
                          <svg viewBox="0 0 24 24" className={`transition-all duration-300 ease-in-out ${isSelected ? 'h-7 w-7' : 'h-5 w-5'}`} fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : (
                          <span className={`transition-all duration-300 ease-in-out leading-none ${isSelected ? 'text-2xl' : 'text-sm'}`}>{idx + 1}</span>
                        )}
                      </button>
                      </div>
                    </div>
                    {!isLast && (() => {
                      const km: Record<string, keyof typeof batch> = { otk: 'stage_otk', packaging: 'stage_packaging', marking: 'stage_marking', packing: 'stage_packing', logistics: 'stage_logistics' }
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

            // OTK: по логам, разбивка годные/браки
            const activeOtkLogs = otkLogs.filter((l) => !otkDeletedIds.includes(l.id))
            const sOtkGood = activeOtkLogs.reduce((s, l) => s + (otkEdits[l.id]?.qty ?? l.qty), 0)
              + (viewStage === 'otk' ? otkBuffer.reduce((s, e) => s + e.qty, 0) : 0)
            const sOtkDefect = activeOtkLogs.reduce((s, l) => s + (otkEdits[l.id]?.qty_defect ?? l.qty_defect), 0)
              + (viewStage === 'otk' ? otkBuffer.reduce((s, e) => s + e.qty_defect, 0) : 0)
            const sOtk = sOtkGood + sOtkDefect

            // Маркировка: по логам, разбивка годные/браки
            const activeMarkingLogs = markingLogs.filter((l) => !markingDeletedIds.includes(l.id))
            const sMarkGood = activeMarkingLogs.reduce((s, l) => s + (markingEdits[l.id]?.qty ?? l.qty), 0)
              + (viewStage === 'marking' ? markingBuffer.reduce((s, e) => s + e.qty, 0) : 0)
            const sMarkDefect = activeMarkingLogs.reduce((s, l) => s + (markingEdits[l.id]?.qty_defect ?? l.qty_defect), 0)
              + (viewStage === 'marking' ? markingBuffer.reduce((s, e) => s + e.qty_defect, 0) : 0)
            const sMarking = sMarkGood + sMarkDefect

            // Упаковка: по логам
            const activePackagingLogs = packagingLogs.filter((l) => !packagingDeletedIds.includes(l.id))
            const sPackagingGood = activePackagingLogs.reduce((s, l) => s + (packagingEdits[l.id]?.qty ?? l.qty), 0)
              + (viewStage === 'packaging' ? packagingBuffer.reduce((s, e) => s + e.qty, 0) : 0)
            const sPackagingDefect = activePackagingLogs.reduce((s, l) => s + (packagingEdits[l.id]?.qty_defect ?? l.qty_defect), 0)
              + (viewStage === 'packaging' ? packagingBuffer.reduce((s, e) => s + e.qty_defect, 0) : 0)
            const sPackaging = sPackagingGood + sPackagingDefect

            // Короба: единицы, коробов, баркодов (через stageDraft при текущем этапе)
            const sPackUnits = viewStage === 'packing'
              ? items.reduce((s, it) => s + (stageDraft[it.id]?.qty ?? it.qty_packed ?? it.qty_marked ?? it.qty_otk ?? it.qty_received), 0)
              : items.reduce((s, it) => s + (it.qty_packed ?? it.qty_marked ?? it.qty_otk ?? it.qty_received), 0)
            const sPackBoxes = viewStage === 'packing'
              ? items.reduce((s, it) => s + (stageDraft[it.id]?.boxes ?? it.boxes ?? 0), 0)
              : items.reduce((s, it) => s + (it.boxes ?? 0), 0)
            const sPackBarcodes = viewStage === 'packing'
              ? new Set([
                  ...supplies.flatMap(s => s.boxes.flatMap(b => [
                    ...b.items.map(i => i.barcode),
                    ...(packingBoxBuffer[b.id] ?? []).map(i => i.barcode),
                  ]))
                ]).size
              : new Set(
                  supplies.flatMap(s => s.boxes.flatMap(b => b.items.map(i => i.barcode)))
                ).size

            // Предыдущий этап через items (корректно даже если этап отключён)
            const sPrevForMarking = items.reduce((s, it) => s + (it.qty_otk ?? it.qty_received), 0)
            const sPrevForPacking = items.reduce((s, it) => s + (it.qty_marked ?? it.qty_otk ?? it.qty_received), 0)

            const diffCard = (label: string, val: number) => (
              <div className={`flex-1 rounded-2xl px-3 py-3 text-center ${val === 0 ? 'bg-emerald-50' : val > 0 ? 'bg-amber-50' : 'bg-red-50'}`}>
                <p className={`text-xl font-bold ${val === 0 ? 'text-emerald-700' : val > 0 ? 'text-amber-700' : 'text-red-600'}`}>{val > 0 ? `+${val}` : val}</p>
                <p className={`text-xs ${val === 0 ? 'text-emerald-500' : val > 0 ? 'text-amber-500' : 'text-red-400'}`}>{label}</p>
              </div>
            )
            const simpleCard = (label: string, val: number, bg: string, tv: string, tl: string) => (
              <div className={`flex-1 rounded-2xl px-3 py-3 text-center ${bg}`}>
                <p className={`text-xl font-bold ${tv}`}>{val}</p>
                <p className={`text-xs ${tl}`}>{label}</p>
              </div>
            )
            const splitCard = (title: string, cols: [string, number][], bg: string, tv: string, tl: string) => (
              <div className={`flex-1 rounded-2xl px-3 py-2 ${bg}`}>
                <p className={`text-center text-[10px] font-semibold mb-1.5 ${tl}`}>{title}</p>
                <div className="flex justify-around">
                  {cols.map(([lbl, val]) => (
                    <div key={lbl} className="text-center">
                      <p className={`text-base font-bold ${tv}`}>{val}</p>
                      <p className={`text-[10px] ${tl}`}>{lbl}</p>
                    </div>
                  ))}
                </div>
              </div>
            )

            return (
              <div className="mb-4 flex gap-2">
                {simpleCard('Принято', sReceived, 'bg-emerald-50', 'text-emerald-700', 'text-emerald-500')}

                {viewStage === 'otk' && (<>
                  {splitCard('ОТК', [['Годные', sOtkGood], ['Браки', sOtkDefect], ['Итого', sOtk]], 'bg-blue-50', 'text-blue-700', 'text-blue-400')}
                  {diffCard('Расхождение', sOtk - sReceived)}
                </>)}

                {viewStage === 'packaging' && (<>
                  {simpleCard('ОТК итого', sOtk, 'bg-blue-50', 'text-blue-700', 'text-blue-400')}
                  {splitCard('Упаковка', [['Упаковано', sPackagingGood], ['Браки', sPackagingDefect], ['Итого', sPackaging]], 'bg-teal-50', 'text-teal-700', 'text-teal-400')}
                  {diffCard('Расхождение', sPackaging - sOtk)}
                </>)}

                {viewStage === 'marking' && (<>
                  {batch.stage_packaging
                    ? simpleCard('Упаковка итого', sPackaging, 'bg-teal-50', 'text-teal-700', 'text-teal-400')
                    : simpleCard('ОТК итого', sOtk, 'bg-blue-50', 'text-blue-700', 'text-blue-400')
                  }
                  {splitCard('Маркировка', [['Годные', sMarkGood], ['Браки', sMarkDefect], ['Итого', sMarking]], 'bg-violet-50', 'text-violet-700', 'text-violet-400')}
                  {diffCard('Расхождение', sMarking - (batch.stage_packaging ? sPackaging : sOtk))}
                </>)}

                {viewStage === 'packing' && (<>
                  {simpleCard('Маркировка', sPrevForPacking, 'bg-violet-50', 'text-violet-700', 'text-violet-400')}
                  {splitCard('Короба', [['Коробов', sPackBoxes], ['Баркодов', sPackBarcodes], ['Единиц', sPackUnits]], 'bg-purple-50', 'text-purple-700', 'text-purple-400')}
                  {diffCard('Расхождение', sPackUnits - sPrevForPacking)}
                </>)}

                {viewStage === 'logistics' && (<>
                  {simpleCard('Упаковано', sPackUnits, 'bg-purple-50', 'text-purple-700', 'text-purple-400')}
                  {diffCard('Расхождение', sPackUnits - sPrevForPacking)}
                </>)}
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
                    <div className="flex gap-1">
                      <input ref={barcodeInputRef} type="text" value={newBarcode}
                        onChange={(e) => void handleBarcodeChange(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleAddItem() }}
                        placeholder="Сканируй или введи"
                        className="w-36 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      />
                      <button
                        type="button"
                        title="Открыть камеру для сканирования"
                        onClick={() => setReceptionCameraOpen((o) => !o)}
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition ${receptionCameraOpen ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-slate-200 bg-white text-slate-400 hover:text-blue-500 hover:border-blue-300'}`}
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                          <circle cx="12" cy="13" r="4"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Наименование{isLooking ? ' ⟳' : ''}
                      {store?.api_key && <span className="ml-1 normal-case font-normal text-blue-400">авто</span>}
                    </span>
                    <input type="text" value={newName} readOnly
                      placeholder="Авто"
                      className="w-48 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 outline-none cursor-default select-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Размер</span>
                    <input type="text" value={newSize} readOnly
                      placeholder="—"
                      className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 outline-none cursor-default select-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Кол-во *</span>
                    <input type="text" inputMode="numeric" value={newQty}
                      onChange={(e) => setNewQty(e.target.value)}
                      placeholder="0"
                      disabled={singleScanMode}
                      className="w-20 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    />
                  </div>
                  <button type="button" onClick={() => void handleAddItem()}
                    disabled={isAddingSaving || !newBarcode.trim() || Number(newQty) < 1 || singleScanMode}
                    className="flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                    Добавить
                  </button>
                  {/* Ползунок одиночной приёмки */}
                  <button
                    type="button"
                    onClick={() => setSingleScanMode((v) => !v)}
                    className={`flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-medium transition ${singleScanMode ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                    title="Одиночная приёмка — каждый скан автоматически добавляет 1 единицу"
                  >
                    <span className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${singleScanMode ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${singleScanMode ? 'translate-x-3' : 'translate-x-0'}`} />
                    </span>
                    Одиночная
                  </button>
                </div>
              )}

              {/* Камера приёмки */}
              {canManage && addMode === 'barcode' && receptionCameraOpen && createPortal(
                <div
                  className="fixed inset-0 z-50 flex flex-col bg-black"
                  onClick={() => setReceptionCameraOpen(false)}
                >
                  <div className="flex items-center justify-between px-4 pt-safe-top pt-4 pb-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-sm font-medium text-white">Сканирование баркода</span>
                    <button type="button" onClick={() => setReceptionCameraOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <div className="relative flex flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    <video ref={receptionVideoRef} className="h-full w-full object-cover" playsInline muted />
                    {/* прицел */}
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="h-40 w-[85%] max-w-xl rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
                    </div>
                    {receptionCameraError && (
                      <div className="absolute bottom-8 left-4 right-4 rounded-xl bg-red-900/80 px-4 py-3 text-sm text-white">{receptionCameraError}</div>
                    )}
                  </div>
                  <div className="px-4 pb-8 pt-3" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => setReceptionCameraRescanKey((k) => k + 1)}
                      className="w-full rounded-2xl bg-white/10 py-3 text-sm font-medium text-white hover:bg-white/20">
                      Сканировать снова
                    </button>
                  </div>
                </div>,
                document.body
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
                        <th className="px-4 py-2.5 text-left">Баркод</th>
                        <th className="px-4 py-2.5 text-left">Наименование</th>
                        <th className="px-4 py-2.5 text-left">Цвет</th>
                        <th className="px-4 py-2.5 text-left">Размер</th>
                        <th className="px-3 py-2.5 text-center">Принято</th>
                        {items.some((i) => i.boxes) && <th className="px-3 py-2.5 text-center">Коробов</th>}
                        {canManage && <th className="px-3 py-2.5" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((it) => (
                        <tr key={it.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{it.barcode || <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-700">{it.product_name ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-500">{it.color ?? <span className="text-slate-300">—</span>}</td>
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
                        <td colSpan={5} className="px-4 py-2.5 text-sm text-slate-500">
                          <span>Итого</span>
                          {receptionCompletedDate && (
                            <span className="ml-3 text-xs font-normal text-slate-400">
                              Завершена {new Date(receptionCompletedDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </span>
                          )}
                        </td>
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
                {/* Модалка добавления работы */}
                {otkAddModalOpen && createPortal(
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setOtkAddModalOpen(false) }}>
                    <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
                      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                        <h3 className="text-base font-semibold text-slate-800">Добавить выполненную работу</h3>
                        <button type="button" onClick={() => setOtkAddModalOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                      <div className="space-y-3 p-5">
                        {/* Исполнитель */}
                        {canOtkAssign && otkPerformers.length > 0 ? (
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-500">Исполнитель</label>
                            <select value={otkPerformerId} onChange={(e) => { const p = otkPerformers.find((x) => x.user_id === e.target.value); setOtkPerformerId(e.target.value); setOtkPerformerName(p?.full_name || e.target.value) }}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                              {otkPerformers.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-500">Исполнитель</label>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">{otkPerformerName || userEmail}</div>
                          </div>
                        )}
                        {/* Тариф */}
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Тариф</label>
                          <select value={otkTariff} onChange={(e) => setOtkTariff(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            {otkTariffsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        {/* Годный / Брак */}
                        <div className="flex gap-3">
                          <div className="flex-1">
                            <label className="mb-1 block text-xs font-medium text-slate-500">Годный</label>
                            <input type="number" min="0" placeholder="0" value={otkQty} onChange={(e) => setOtkQty(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void handleAddOtkLog() }}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          </div>
                          <div className="flex-1">
                            <label className="mb-1 block text-xs font-medium text-red-400">Брак</label>
                            <input type="number" min="0" placeholder="0" value={otkDefect} onChange={(e) => setOtkDefect(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void handleAddOtkLog() }}
                              className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm text-red-700 placeholder-red-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-red-400" />
                          </div>
                        </div>
                        {/* Примечание */}
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Примечание</label>
                          <input type="text" placeholder="Необязательно" value={otkNotes} onChange={(e) => setOtkNotes(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        {/* Фото */}
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Фото</label>
                          <input ref={otkFileInputRef} type="file" accept="image/*" multiple className="hidden"
                            onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) setOtkPhotoFiles((prev) => [...prev, ...files]); e.target.value = '' }} />
                          <button type="button" onClick={() => otkFileInputRef.current?.click()}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${otkPhotoFiles.length > 0 ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4 shrink-0">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                            </svg>
                            {otkPhotoFiles.length > 0 ? `${otkPhotoFiles.length} фото прикреплено` : 'Прикрепить фото'}
                          </button>
                          {otkPhotoFiles.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {otkPhotoFiles.map((f, i) => (
                                <div key={i} className="group relative">
                                  <img src={URL.createObjectURL(f)} alt={f.name} className="h-14 w-14 rounded-lg object-cover border border-slate-200" />
                                  <button type="button" onClick={() => setOtkPhotoFiles((prev) => prev.filter((_, j) => j !== i))}
                                    className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs group-hover:flex">×</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
                        <button type="button" onClick={() => setOtkAddModalOpen(false)}
                          className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                          Отмена
                        </button>
                        <button type="button" onClick={() => void handleAddOtkLog()}
                          disabled={isAddingOtk || ((!otkQty || Number(otkQty) <= 0) && (!otkDefect || Number(otkDefect) <= 0))}
                          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                          {isAddingOtk ? 'Сохранение…' : '+ Добавить'}
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

                {/* Журнал работ */}
                {isLoadingOtk ? (
                  <div className="py-6 text-center text-sm text-slate-400">Загрузка…</div>
                ) : otkLogs.length === 0 && otkBuffer.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 py-10">
                    <p className="text-sm text-slate-400">Записей нет — добавьте первую работу</p>
                    <button type="button" onClick={() => setOtkAddModalOpen(true)}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                      + Добавить работу
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Итого + кнопка добавить */}
                    {(() => {
                      const activeLogs = otkLogs.filter((l) => !otkDeletedIds.includes(l.id))
                      const performers = new Set([
                        ...activeLogs.map((l) => l.performer_user_id ?? l.user_id),
                        ...otkBuffer.map((e) => e.performer_user_id),
                      ]).size
                      const tariffs = new Set([
                        ...activeLogs.map((l) => otkEdits[l.id]?.tariff ?? l.tariff),
                        ...otkBuffer.map((e) => e.tariff),
                      ]).size
                      const totalGood = activeLogs.reduce((s, l) => s + (otkEdits[l.id]?.qty ?? l.qty), 0) + otkBuffer.reduce((s, e) => s + e.qty, 0)
                      const totalDefect = activeLogs.reduce((s, l) => s + (otkEdits[l.id]?.qty_defect ?? l.qty_defect), 0) + otkBuffer.reduce((s, e) => s + e.qty_defect, 0)
                      const totalNotes = [...activeLogs, ...otkBuffer].filter((e) => ('notes' in e ? e.notes : (otkEdits[(e as FulfillmentOtkLog).id]?.notes ?? (e as FulfillmentOtkLog).notes ?? '')) !== '').length
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
                        <div className="flex items-center gap-x-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                          <span className="font-semibold text-slate-600">Итого</span>
                          <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-1">
                            {stats.map(({ label, value, color }) => (
                              <span key={label} className="text-xs text-slate-500">
                                {label}: <span className={`font-semibold ${color ?? 'text-slate-800'}`}>{value}</span>
                              </span>
                            ))}
                          </div>
                          <button type="button" onClick={() => setOtkAddModalOpen(true)}
                            className="shrink-0 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors">
                            + Добавить работу
                          </button>
                        </div>
                      )
                    })()}

                    {/* Сетка карточек */}
                    <div className="grid grid-cols-6 gap-2">
                      {/* Сохранённые записи */}
                      {otkLogs.filter((l) => !otkDeletedIds.includes(l.id)).map((log) => {
                        const isEditing = otkEditingId === log.id
                        const edit = otkEdits[log.id] ?? { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '' }
                        const logTime = new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                        const logDate = new Date(log.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        const isOwn = log.user_id === userId
                        const hasEdit = !!otkEdits[log.id] && (
                          otkEdits[log.id].tariff !== log.tariff ||
                          otkEdits[log.id].qty !== log.qty ||
                          otkEdits[log.id].qty_defect !== log.qty_defect ||
                          otkEdits[log.id].notes !== (log.notes ?? '')
                        )
                        const displayTariff = otkTariffsList.find((t) => t.id === edit.tariff)?.name ?? OTK_TARIFFS.find((t) => t.id === edit.tariff)?.label ?? edit.tariff
                        return (
                          <div key={log.id} className="relative">
                          {/* Плейсхолдер — всегда занимает место в сетке */}
                          <div className={`flex flex-col gap-1.5 rounded-2xl border px-3 py-2.5 ${isEditing ? 'invisible' : hasEdit ? 'border-amber-200 bg-amber-50/40' : isOwn ? 'border-blue-100 bg-blue-50/20' : 'border-slate-200 bg-white'}`}>
                            {/* Вид по умолчанию */}
                            <div className="flex items-start justify-between gap-1">
                              <button type="button" onClick={() => { setOtkHistoryLog(log); setOtkHistoryTabId(log.id) }}
                                className="group flex flex-col items-start leading-tight" title="История">
                                <span className="text-[11px] font-semibold text-slate-700 tabular-nums">{logTime}</span>
                                <span className="text-[10px] text-slate-400 tabular-nums">{logDate}</span>
                              </button>
                              {(isOwn || canManage) && (
                                <div className="flex items-center gap-0.5">
                                  <button type="button" onClick={() => {
                                      // Чистим незакоммиченные edits предыдущей карточки если ничего не менялось
                                      if (otkEditingId && otkEditingId !== log.id) {
                                        const prev = otkEdits[otkEditingId]
                                        const prevLog = otkLogs.find((l) => l.id === otkEditingId)
                                        if (prev && prevLog &&
                                          prev.tariff === prevLog.tariff &&
                                          prev.qty === prevLog.qty &&
                                          prev.qty_defect === prevLog.qty_defect &&
                                          prev.notes === (prevLog.notes ?? '')
                                        ) {
                                          setOtkEdits((p) => { const n = { ...p }; delete n[otkEditingId]; return n })
                                        }
                                      }
                                      setOtkEdits((p) => ({ ...p, [log.id]: { tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '' } }))
                                      setOtkEditingId(log.id)
                                    }}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-blue-50 hover:text-blue-500" title="Редактировать">
                                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                  </button>
                                  <button type="button" onClick={() => handleDeleteOtkLog(log.id)}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500" title="Удалить">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              )}
                            </div>
                            <span className="truncate text-xs font-semibold text-slate-700 leading-tight" title={log.user_email}>{log.performer_name}</span>
                            <span className="w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[10px] leading-tight text-slate-600">{displayTariff}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400">Год: <span className="font-bold text-slate-800">{edit.qty}</span></span>
                              <span className="text-[10px] text-slate-400">Бр: {edit.qty_defect > 0 ? <span className="font-bold text-red-600">{edit.qty_defect}</span> : <span className="text-slate-300">—</span>}</span>
                            </div>
                            {edit.notes && <span className="truncate text-[10px] italic text-slate-400" title={edit.notes}>{edit.notes}</span>}
                            <InvoicePhotoCell
                              photoUrls={log.photo_urls ?? []}
                              onAdd={(isOwn || canManage) ? (file) => handleAddOtkPhoto(log.id, file) : undefined}
                              onReplace={(isOwn || canManage) ? (idx, file) => handleReplaceOtkPhoto(log.id, idx, file) : undefined}
                              onRemove={(isOwn || canManage) ? (idx) => handleRemoveOtkPhoto(log.id, idx) : undefined}
                            />
                          </div>
                          {/* Редактируемая карточка — абсолютный слой, не двигает сетку */}
                          {isEditing && (
                            <div className="absolute left-0 top-0 z-30 w-72 rounded-2xl border border-blue-200 bg-white px-3 py-2.5 shadow-xl">
                              <div className="flex items-start justify-between gap-1">
                                <button type="button" onClick={() => { setOtkHistoryLog(log); setOtkHistoryTabId(log.id) }}
                                  className="group flex flex-col items-start leading-tight" title="История">
                                  <span className="text-[11px] font-semibold text-blue-600 tabular-nums">{logTime}</span>
                                  <span className="text-[10px] text-slate-400 tabular-nums">{logDate}</span>
                                </button>
                                <div className="flex items-center gap-0.5">
                                  <button type="button" onClick={() => { setIsDirty(true); setOtkEditingId(null) }}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Применить">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                  </button>
                                  <button type="button" onClick={() => { setOtkEdits((p) => { const n = { ...p }; delete n[log.id]; return n }); setOtkEditingId(null) }}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" title="Отмена">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              </div>
                              <span className="mt-1 block truncate text-xs font-semibold text-slate-700 leading-tight">{log.performer_name}</span>
                              <select value={edit.tariff} onChange={(e) => setOtkEdits((p) => ({ ...p, [log.id]: { ...edit, tariff: e.target.value } }))}
                                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                {otkTariffsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                              <div className="mt-1.5 flex items-center gap-3">
                                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                                  Годный
                                  <input type="number" min={0} value={edit.qty}
                                    onChange={(e) => setOtkEdits((p) => ({ ...p, [log.id]: { ...edit, qty: Number(e.target.value) } }))}
                                    className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400" />
                                </label>
                                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                                  Брак
                                  <input type="number" min={0} value={edit.qty_defect}
                                    onChange={(e) => setOtkEdits((p) => ({ ...p, [log.id]: { ...edit, qty_defect: Number(e.target.value) } }))}
                                    className="w-20 rounded-lg border border-red-200 px-2 py-1.5 text-center text-sm font-medium text-red-600 focus:outline-none focus:ring-2 focus:ring-red-300" />
                                </label>
                              </div>
                              <input type="text" value={edit.notes}
                                onChange={(e) => setOtkEdits((p) => ({ ...p, [log.id]: { ...edit, notes: e.target.value } }))}
                                placeholder="Примечание"
                                className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              <div className="mt-1.5">
                                <InvoicePhotoCell
                                  photoUrls={log.photo_urls ?? []}
                                  onAdd={(isOwn || canManage) ? (file) => handleAddOtkPhoto(log.id, file) : undefined}
                                  onReplace={(isOwn || canManage) ? (idx, file) => handleReplaceOtkPhoto(log.id, idx, file) : undefined}
                                  onRemove={(isOwn || canManage) ? (idx) => handleRemoveOtkPhoto(log.id, idx) : undefined}
                                />
                              </div>
                            </div>
                          )}
                          </div>
                        )
                      })}

                      {/* Буферные (несохранённые) записи */}
                      {otkBuffer.map((entry) => {
                        const isEditing = otkEditingId === entry.tempId
                        const tariffLabel = otkTariffsList.find((t) => t.id === entry.tariff)?.name ?? OTK_TARIFFS.find((t) => t.id === entry.tariff)?.label ?? entry.tariff
                        return (
                          <div key={entry.tempId} className="relative">
                            {/* Плейсхолдер */}
                            <div className={`flex flex-col gap-1.5 rounded-2xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 ${isEditing ? 'invisible' : ''}`}>
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[10px] font-semibold italic text-amber-500">Новая</span>
                                <div className="flex items-center gap-0.5">
                                  <button type="button" onClick={() => setOtkEditingId(entry.tempId)}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-blue-50 hover:text-blue-500" title="Редактировать">
                                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                  </button>
                                  <button type="button" onClick={() => handleDeleteOtkLog(entry.tempId)}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500" title="Удалить">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              </div>
                              <span className="truncate text-xs font-semibold text-slate-700 leading-tight">{entry.performer_name}</span>
                              <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[10px] leading-tight text-amber-700">{tariffLabel}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400">Год: <span className="font-bold text-slate-800">{entry.qty}</span></span>
                                <span className="text-[10px] text-slate-400">Бр: {entry.qty_defect > 0 ? <span className="font-bold text-red-600">{entry.qty_defect}</span> : <span className="text-slate-300">—</span>}</span>
                              </div>
                              {entry.notes && <span className="truncate text-[10px] italic text-slate-400">{entry.notes}</span>}
                              {entry.photo_files.length > 0 && <InvoicePhotoCell photoUrls={entry.photo_files.map((f) => URL.createObjectURL(f))} />}
                            </div>
                            {/* Редактируемая — абсолютный слой */}
                            {isEditing && (
                              <div className="absolute left-0 top-0 z-30 w-72 rounded-2xl border border-amber-300 bg-white px-3 py-2.5 shadow-xl">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-[10px] font-semibold italic text-amber-500">Новая</span>
                                  <button type="button" onClick={() => setOtkEditingId(null)}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Готово">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                  </button>
                                </div>
                                <span className="mt-1 block truncate text-xs font-semibold text-slate-700 leading-tight">{entry.performer_name}</span>
                                <select value={entry.tariff} onChange={(e) => setOtkBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, tariff: e.target.value } : x))}
                                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                  {otkTariffsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                                <div className="mt-1.5 flex items-center gap-3">
                                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                                    Годный
                                    <input type="number" min={0} value={entry.qty}
                                      onChange={(e) => setOtkBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, qty: Number(e.target.value) } : x))}
                                      className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400" />
                                  </label>
                                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                                    Брак
                                    <input type="number" min={0} value={entry.qty_defect}
                                      onChange={(e) => setOtkBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, qty_defect: Number(e.target.value) } : x))}
                                      className="w-20 rounded-lg border border-red-200 px-2 py-1.5 text-center text-sm font-medium text-red-600 focus:outline-none focus:ring-2 focus:ring-red-300" />
                                  </label>
                                </div>
                                <input type="text" value={entry.notes}
                                  onChange={(e) => setOtkBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, notes: e.target.value } : x))}
                                  placeholder="Примечание"
                                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                                {entry.photo_files.length > 0 && (
                                  <div className="mt-1.5"><InvoicePhotoCell photoUrls={entry.photo_files.map((f) => URL.createObjectURL(f))} /></div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
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
                {/* Модалка добавления работы */}
                {markingAddModalOpen && createPortal(
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setMarkingAddModalOpen(false) }}>
                    <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
                      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                        <h3 className="text-base font-semibold text-slate-800">Добавить выполненную работу</h3>
                        <button type="button" onClick={() => setMarkingAddModalOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                      <div className="space-y-3 p-5">
                        {/* ШК — обязательное */}
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Штрихкод <span className="text-red-400">*</span></label>
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="1.75">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
                              </svg>
                              <input
                                ref={markingBarcodeRef}
                                type="text"
                                placeholder="Сканировать ШК…"
                                value={markingBarcode}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setMarkingBarcode(v)
                                  const found = items.find((it) => it.barcode === v.trim())
                                  if (found) { setMarkingItemId(found.id); setMarkingItemName(found.product_name ?? found.barcode) }
                                  else { setMarkingItemId(null); setMarkingItemName(null) }
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter' && markingBarcode.trim()) { e.preventDefault(); (e.target as HTMLElement).closest('.marking-modal-form')?.querySelector<HTMLInputElement>('.marking-qty-input')?.focus() } }}
                                className={`w-full rounded-xl border bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${markingBarcode.trim() ? 'border-slate-200' : 'border-red-300 focus:ring-red-400'}`}
                              />
                            </div>
                            <button type="button" title="Сканировать камерой" onClick={() => { setMarkingCameraOpen((p) => !p); setMarkingCameraError(null) }}
                              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${markingCameraOpen ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-blue-500'}`}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                              </svg>
                            </button>
                          </div>
                          {markingBarcode.trim() && (
                            (() => {
                              const hasBarcodeItems = items.some((it) => it.barcode && it.barcode.trim() !== '')
                              if (markingItemName) {
                                return (
                                  <span className="mt-1.5 flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-700">
                                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" /></svg>
                                    {markingItemName}
                                  </span>
                                )
                              }
                              if (hasBarcodeItems) {
                                return (
                                  <span className="mt-1.5 flex items-center gap-1 rounded-lg bg-red-50 border border-red-200 px-2 py-1 text-xs font-medium text-red-700">
                                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clipRule="evenodd" /></svg>
                                    Такой баркод не найден в данной партии
                                  </span>
                                )
                              }
                              return (
                                <span className="mt-1.5 flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1 text-xs font-medium text-amber-700">
                                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" /></svg>
                                  Не найден в партии
                                </span>
                              )
                            })()
                          )}
                        </div>
                        {/* Исполнитель */}
                        {canOtkAssign && markingPerformers.length > 0 ? (
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-500">Исполнитель</label>
                            <select value={markingPerformerId} onChange={(e) => { const p = markingPerformers.find((x) => x.user_id === e.target.value); setMarkingPerformerId(e.target.value); setMarkingPerformerName(p?.full_name || e.target.value) }}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                              {markingPerformers.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-500">Исполнитель</label>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">{markingPerformerName || userEmail}</div>
                          </div>
                        )}
                        {/* Тариф */}
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Тариф</label>
                          <select value={markingTariff} onChange={(e) => setMarkingTariff(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            {markingTariffsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        {/* Расходник */}
                        {accountConsumables.length > 0 && (
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-500">Расходник</label>
                            <select value={markingConsumableId} onChange={(e) => setMarkingConsumableId(e.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                              <option value="">— не выбрано —</option>
                              {accountConsumables.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                        )}
                        {/* Годный / Брак */}
                        <div className="marking-modal-form flex gap-3">
                          <div className="flex-1">
                            <label className="mb-1 block text-xs font-medium text-slate-500">Годный</label>
                            <input type="number" min="0" placeholder="0" value={markingQty} onChange={(e) => setMarkingQty(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleAddMarkingLog() }}
                              className="marking-qty-input w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          </div>
                          <div className="flex-1">
                            <label className="mb-1 block text-xs font-medium text-red-400">Брак</label>
                            <input type="number" min="0" placeholder="0" value={markingDefect} onChange={(e) => setMarkingDefect(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleAddMarkingLog() }}
                              className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm text-red-700 placeholder-red-300 focus:outline-none focus:ring-2 focus:ring-red-400" />
                          </div>
                        </div>
                        {/* Этикетки */}
                        <div className="flex items-end gap-3">
                          <div className="flex-1">
                            <label className="mb-1 block text-xs font-medium text-slate-500">Этикетки (шт.)</label>
                            <input type="number" min="0" placeholder="0"
                              value={markingLabelsAll ? (Number(markingQty) > 0 ? markingQty : '0') : markingLabelsQty}
                              onChange={(e) => { if (!markingLabelsAll) setMarkingLabelsQty(e.target.value) }}
                              disabled={markingLabelsAll}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400" />
                          </div>
                          <label className="mb-2 flex shrink-0 cursor-pointer items-center gap-1.5">
                            <input type="checkbox" checked={markingLabelsAll}
                              onChange={(e) => setMarkingLabelsAll(e.target.checked)}
                              className="h-5 w-5 cursor-pointer accent-blue-600" />
                            <span className="whitespace-nowrap text-sm text-slate-600">Все товары</span>
                          </label>
                        </div>
                        {/* Примечание */}
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Примечание</label>
                          <input type="text" placeholder="Необязательно" value={markingNotes} onChange={(e) => setMarkingNotes(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        {/* Фото */}
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Фото</label>
                          <input ref={markingFileInputRef} type="file" accept="image/*" multiple className="hidden"
                            onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) setMarkingPhotoFiles((prev) => [...prev, ...files]); e.target.value = '' }} />
                          <button type="button" onClick={() => markingFileInputRef.current?.click()}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${markingPhotoFiles.length > 0 ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4 shrink-0">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                            </svg>
                            {markingPhotoFiles.length > 0 ? `${markingPhotoFiles.length} фото прикреплено` : 'Прикрепить фото'}
                          </button>
                          {markingPhotoFiles.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {markingPhotoFiles.map((f, i) => (
                                <div key={i} className="group relative">
                                  <img src={URL.createObjectURL(f)} alt={f.name} className="h-14 w-14 rounded-lg object-cover border border-slate-200" />
                                  <button type="button" onClick={() => setMarkingPhotoFiles((prev) => prev.filter((_, j) => j !== i))}
                                    className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs group-hover:flex">×</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
                        <button type="button" onClick={() => setMarkingAddModalOpen(false)}
                          className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                          Отмена
                        </button>
                        <button type="button" onClick={handleAddMarkingLog}
                          disabled={isAddingMarking || !markingBarcode.trim() || ((!markingQty || Number(markingQty) <= 0) && (!markingDefect || Number(markingDefect) <= 0)) || (items.some((it) => it.barcode && it.barcode.trim() !== '') && markingBarcode.trim() !== '' && !markingItemId)}
                          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                          {isAddingMarking ? 'Сохранение…' : '+ Добавить'}
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

                {/* Журнал работ */}
                {isLoadingMarking ? (
                  <div className="py-6 text-center text-sm text-slate-400">Загрузка…</div>
                ) : markingLogs.length === 0 && markingBuffer.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 py-10">
                    <p className="text-sm text-slate-400">Записей нет — добавьте первую работу</p>
                    <button type="button" onClick={() => setMarkingAddModalOpen(true)}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                      + Добавить работу
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Итого + кнопка добавить */}
                    {(() => {
                      const activeLogs = markingLogs.filter((l) => !markingDeletedIds.includes(l.id))
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
                      const totalNotes = [...activeLogs, ...markingBuffer].filter((e) => {
                        const n = 'notes' in e ? (markingEdits[(e as FulfillmentMarkingLog).id]?.notes ?? (e as FulfillmentMarkingLog).notes ?? '') : (e as MarkingBufferEntry).notes
                        return n !== ''
                      }).length
                      const totalPhotos = activeLogs.filter((l) => l.photo_urls && l.photo_urls.length > 0).length + markingBuffer.filter((e) => e.photo_files.length > 0).length
                      const totalLabels = activeLogs.reduce((s, l) => s + (markingEdits[l.id]?.labels_qty ?? l.labels_qty ?? 0), 0) + markingBuffer.reduce((s, e) => s + (e.labels_qty ?? 0), 0)
                      const stats: { label: string; value: number | string; color?: string }[] = [
                        { label: 'Исполнителей', value: performers },
                        { label: 'Тарифов', value: tariffs },
                        { label: 'Годных', value: totalGood },
                        { label: 'Браков', value: totalDefect, color: totalDefect > 0 ? 'text-red-600' : undefined },
                        { label: 'Этикеток', value: totalLabels },
                        { label: 'Итого Маркировка', value: totalGood + totalDefect },
                        { label: 'Примечаний', value: totalNotes },
                        { label: 'Фото', value: totalPhotos },
                      ]
                      return (
                        <div className="flex items-center gap-x-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                          <span className="font-semibold text-slate-600">Итого</span>
                          <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-1">
                            {stats.map(({ label, value, color }) => (
                              <span key={label} className="text-xs text-slate-500">
                                {label}: <span className={`font-semibold ${color ?? 'text-slate-800'}`}>{value}</span>
                              </span>
                            ))}
                          </div>
                          <button type="button" onClick={() => setMarkingAddModalOpen(true)}
                            className="shrink-0 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors">
                            + Добавить работу
                          </button>
                        </div>
                      )
                    })()}

                    {/* Сетка карточек */}
                    <div className="grid grid-cols-6 gap-2">
                      {/* Сохранённые записи */}
                      {markingLogs.filter((l) => !markingDeletedIds.includes(l.id)).map((log) => {
                        const isEditing = markingEditingId === log.id
                        const edit = markingEdits[log.id] ?? {
                          tariff: log.tariff,
                          qty: log.qty,
                          qty_defect: log.qty_defect,
                          notes: log.notes ?? '',
                          barcode: log.barcode ?? '',
                          consumable_id: log.consumable_id ?? null,
                          labels_qty: log.labels_qty ?? null,
                          labels_all: (log.labels_qty ?? 0) > 0 && (log.labels_qty ?? 0) === log.qty,
                        }
                        const logTime = new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                        const logDate = new Date(log.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        const isOwn = log.user_id === userId
                        const hasEdit = !!markingEdits[log.id] && (
                          markingEdits[log.id].tariff !== log.tariff ||
                          markingEdits[log.id].qty !== log.qty ||
                          markingEdits[log.id].qty_defect !== log.qty_defect ||
                          markingEdits[log.id].notes !== (log.notes ?? '') ||
                          markingEdits[log.id].barcode !== (log.barcode ?? '') ||
                          markingEdits[log.id].consumable_id !== (log.consumable_id ?? null) ||
                          markingEdits[log.id].labels_qty !== (log.labels_qty ?? null)
                        )
                        const displayTariff = markingTariffsList.find((t) => t.id === edit.tariff)?.name ?? MARKING_TARIFFS.find((t) => t.id === edit.tariff)?.label ?? edit.tariff
                        const displayConsumable = accountConsumables.find((c) => c.id === edit.consumable_id)?.name
                        return (
                          <div key={log.id} className="relative">
                            {/* Плейсхолдер — всегда занимает место в сетке */}
                            <div className={`flex flex-col gap-1.5 rounded-2xl border px-3 py-2.5 ${isEditing ? 'invisible' : hasEdit ? 'border-amber-200 bg-amber-50/40' : isOwn ? 'border-blue-100 bg-blue-50/20' : 'border-slate-200 bg-white'}`}>
                              <div className="flex items-start justify-between gap-1">
                                <div className="flex flex-col items-start leading-tight">
                                  <span className="text-[11px] font-semibold text-slate-700 tabular-nums">{logTime}</span>
                                  <span className="text-[10px] text-slate-400 tabular-nums">{logDate}</span>
                                </div>
                                {(isOwn || canManage) && (
                                  <div className="flex items-center gap-0.5">
                                    <button type="button" onClick={() => {
                                        if (markingEditingId && markingEditingId !== log.id) {
                                          const prev = markingEdits[markingEditingId]
                                          const prevLog = markingLogs.find((l) => l.id === markingEditingId)
                                          if (prev && prevLog &&
                                            prev.tariff === prevLog.tariff &&
                                            prev.qty === prevLog.qty &&
                                            prev.qty_defect === prevLog.qty_defect &&
                                            prev.notes === (prevLog.notes ?? '') &&
                                            prev.barcode === (prevLog.barcode ?? '') &&
                                            prev.consumable_id === (prevLog.consumable_id ?? null) &&
                                            prev.labels_qty === (prevLog.labels_qty ?? null)
                                          ) {
                                            setMarkingEdits((p) => { const n = { ...p }; delete n[markingEditingId]; return n })
                                          }
                                        }
                                        setMarkingEdits((p) => ({ ...p, [log.id]: {
                                          tariff: log.tariff,
                                          qty: log.qty,
                                          qty_defect: log.qty_defect,
                                          notes: log.notes ?? '',
                                          barcode: log.barcode ?? '',
                                          consumable_id: log.consumable_id ?? null,
                                          labels_qty: log.labels_qty ?? null,
                                          labels_all: (log.labels_qty ?? 0) > 0 && (log.labels_qty ?? 0) === log.qty,
                                        } }))
                                        setMarkingEditingId(log.id)
                                      }}
                                      className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-blue-50 hover:text-blue-500" title="Редактировать">
                                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </button>
                                    <button type="button" onClick={() => handleDeleteMarkingLog(log.id)}
                                      className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500" title="Удалить">
                                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                    </button>
                                  </div>
                                )}
                              </div>
                              <span className="truncate text-xs font-semibold text-slate-700 leading-tight" title={log.user_email}>{log.performer_name}</span>
                              {log.barcode && (
                                <span className="truncate font-mono text-[10px] text-slate-400" title={log.barcode}>{log.barcode}</span>
                              )}
                              <span className="w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[10px] leading-tight text-slate-600">{displayTariff}</span>
                              {displayConsumable && <span className="w-fit rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] leading-tight text-emerald-700">{displayConsumable}</span>}
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400">Год: <span className="font-bold text-slate-800">{edit.qty}</span></span>
                                <span className="text-[10px] text-slate-400">Бр: {edit.qty_defect > 0 ? <span className="font-bold text-red-600">{edit.qty_defect}</span> : <span className="text-slate-300">—</span>}</span>
                                <span className="text-[10px] text-slate-400">Эт: {edit.labels_qty && edit.labels_qty > 0 ? <span className="font-bold text-emerald-700">{edit.labels_qty}</span> : <span className="text-slate-300">—</span>}</span>
                              </div>
                              {edit.notes && <span className="truncate text-[10px] italic text-slate-400" title={edit.notes}>{edit.notes}</span>}
                              <InvoicePhotoCell
                                photoUrls={log.photo_urls ?? []}
                                onAdd={(isOwn || canManage) ? (file) => handleAddMarkingPhoto(log.id, file) : undefined}
                                onReplace={(isOwn || canManage) ? (idx, file) => handleReplaceMarkingPhoto(log.id, idx, file) : undefined}
                                onRemove={(isOwn || canManage) ? (idx) => handleRemoveMarkingPhoto(log.id, idx) : undefined}
                              />
                            </div>
                            {/* Редактируемая карточка — абсолютный слой, не двигает сетку */}
                            {isEditing && (
                              <div className="absolute left-0 top-0 z-30 w-72 rounded-2xl border border-blue-200 bg-white px-3 py-2.5 shadow-xl">
                                <div className="flex items-start justify-between gap-1">
                                  <div className="flex flex-col items-start leading-tight">
                                    <span className="text-[11px] font-semibold text-blue-600 tabular-nums">{logTime}</span>
                                    <span className="text-[10px] text-slate-400 tabular-nums">{logDate}</span>
                                  </div>
                                  <div className="flex items-center gap-0.5">
                                    <button type="button" onClick={() => { setIsDirty(true); setMarkingEditingId(null) }}
                                      className="flex h-6 w-6 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Применить">
                                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                    </button>
                                    <button type="button" onClick={() => { setMarkingEdits((p) => { const n = { ...p }; delete n[log.id]; return n }); setMarkingEditingId(null) }}
                                      className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" title="Отмена">
                                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                    </button>
                                  </div>
                                </div>
                                <span className="mt-1 block truncate text-xs font-semibold text-slate-700 leading-tight">{log.performer_name}</span>
                                <div className="relative mt-1 flex items-center">
                                  <input type="text" autoFocus value={edit.barcode}
                                    onChange={(e) => setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, barcode: e.target.value } }))}
                                    placeholder="Штрих-код (13 цифр)"
                                    className={`w-full rounded-lg border px-2 py-1 pr-7 font-mono text-[11px] text-slate-500 focus:outline-none focus:ring-1 ${edit.barcode.length === 0 ? 'border-slate-200 focus:ring-blue-400' : /^\d{13}$/.test(edit.barcode) ? 'border-emerald-400 focus:ring-emerald-200' : 'border-red-300 focus:ring-red-200'}`} />
                                  <button type="button" title="Сканировать" className="absolute right-1.5 text-slate-400 hover:text-blue-500"
                                    onClick={() => { setMarkingEditScanTarget({ type: 'log', id: log.id }); setMarkingCameraError(null); setMarkingCameraOpen(true) }}>
                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><line x1="7" y1="9" x2="7" y2="15"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="13" y1="9" x2="13" y2="15"/><line x1="16" y1="9" x2="16" y2="15"/></svg>
                                  </button>
                                </div>
                                {edit.barcode.length > 0 && !/^\d{13}$/.test(edit.barcode) && (
                                  <p className="mt-0.5 text-[10px] text-red-500 pl-0.5">{edit.barcode.replace(/\D/g, '').length}/13 · только цифры</p>
                                )}
                                <select value={edit.tariff} onChange={(e) => setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, tariff: e.target.value } }))}
                                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                  {markingTariffsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                                {accountConsumables.length > 0 && (
                                  <select value={edit.consumable_id ?? ''} onChange={(e) => setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, consumable_id: e.target.value || null } }))}
                                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                    <option value="">Расходник: не выбрано</option>
                                    {accountConsumables.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                )}
                                <div className="mt-1.5 flex items-center gap-3">
                                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                                    Годный
                                    <input type="number" min={0} value={edit.qty}
                                      onChange={(e) => {
                                        const nextQty = Number(e.target.value)
                                        setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, qty: nextQty, labels_qty: edit.labels_all ? (nextQty > 0 ? nextQty : null) : edit.labels_qty } }))
                                      }}
                                      className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400" />
                                  </label>
                                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                                    Брак
                                    <input type="number" min={0} value={edit.qty_defect}
                                      onChange={(e) => setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, qty_defect: Number(e.target.value) } }))}
                                      className="w-20 rounded-lg border border-red-200 px-2 py-1.5 text-center text-sm font-medium text-red-600 focus:outline-none focus:ring-2 focus:ring-red-300" />
                                  </label>
                                </div>
                                <div className="mt-1.5 flex items-end gap-2">
                                  <div className="flex-1">
                                    <label className="mb-0.5 block text-[10px] text-slate-500">Этикетки (шт.)</label>
                                    <input type="number" min={0}
                                      value={edit.labels_all ? (edit.qty > 0 ? edit.qty : 0) : (edit.labels_qty ?? '')}
                                      onChange={(e) => {
                                        if (edit.labels_all) return
                                        const raw = Number(e.target.value)
                                        setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, labels_qty: raw > 0 ? raw : null } }))
                                      }}
                                      disabled={edit.labels_all}
                                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-50 disabled:text-slate-400" />
                                  </div>
                                  <label className="mb-1 flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-slate-500">
                                    <input type="checkbox" checked={edit.labels_all}
                                      onChange={(e) => setMarkingEdits((p) => ({
                                        ...p,
                                        [log.id]: {
                                          ...edit,
                                          labels_all: e.target.checked,
                                          labels_qty: e.target.checked ? (edit.qty > 0 ? edit.qty : null) : edit.labels_qty,
                                        },
                                      }))}
                                      className="h-3.5 w-3.5 cursor-pointer accent-blue-600" />
                                    Все товары
                                  </label>
                                </div>
                                <input type="text" value={edit.notes}
                                  onChange={(e) => setMarkingEdits((p) => ({ ...p, [log.id]: { ...edit, notes: e.target.value } }))}
                                  placeholder="Примечание"
                                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                <div className="mt-1.5">
                                  <InvoicePhotoCell
                                    photoUrls={log.photo_urls ?? []}
                                    onAdd={(isOwn || canManage) ? (file) => handleAddMarkingPhoto(log.id, file) : undefined}
                                    onReplace={(isOwn || canManage) ? (idx, file) => handleReplaceMarkingPhoto(log.id, idx, file) : undefined}
                                    onRemove={(isOwn || canManage) ? (idx) => handleRemoveMarkingPhoto(log.id, idx) : undefined}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* Буферные (несохранённые) записи */}
                      {markingBuffer.map((entry) => {
                        const isEditing = markingEditingId === entry.tempId
                        const tariffLabel = markingTariffsList.find((t) => t.id === entry.tariff)?.name ?? MARKING_TARIFFS.find((t) => t.id === entry.tariff)?.label ?? entry.tariff
                        const entryConsumable = accountConsumables.find((c) => c.id === entry.consumable_id)?.name
                        return (
                          <div key={entry.tempId} className="relative">
                            {/* Плейсхолдер */}
                            <div className={`flex flex-col gap-1.5 rounded-2xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 ${isEditing ? 'invisible' : ''}`}>
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[10px] font-semibold italic text-amber-500">Новая</span>
                                <div className="flex items-center gap-0.5">
                                  <button type="button" onClick={() => setMarkingEditingId(entry.tempId)}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-blue-50 hover:text-blue-500" title="Редактировать">
                                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                  </button>
                                  <button type="button" onClick={() => handleDeleteMarkingLog(entry.tempId)}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500" title="Удалить">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              </div>
                              <span className="truncate text-xs font-semibold text-slate-700 leading-tight">{entry.performer_name}</span>
                              {entry.barcode && <span className="truncate font-mono text-[10px] text-slate-400">{entry.barcode}</span>}
                              <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[10px] leading-tight text-amber-700">{tariffLabel}</span>
                              {entryConsumable && <span className="w-fit rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] leading-tight text-emerald-700">{entryConsumable}</span>}
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-400">Год: <span className="font-bold text-slate-800">{entry.qty}</span></span>
                                <span className="text-[10px] text-slate-400">Бр: {entry.qty_defect > 0 ? <span className="font-bold text-red-600">{entry.qty_defect}</span> : <span className="text-slate-300">—</span>}</span>
                                <span className="text-[10px] text-slate-400">Эт: {entry.labels_qty && entry.labels_qty > 0 ? <span className="font-bold text-emerald-700">{entry.labels_qty}</span> : <span className="text-slate-300">—</span>}</span>
                              </div>
                              {entry.notes && <span className="truncate text-[10px] italic text-slate-400">{entry.notes}</span>}
                              {entry.photo_files.length > 0 && <InvoicePhotoCell photoUrls={entry.photo_files.map((f) => URL.createObjectURL(f))} />}
                            </div>
                            {/* Редактируемая — абсолютный слой */}
                            {isEditing && (
                              <div className="absolute left-0 top-0 z-30 w-72 rounded-2xl border border-amber-300 bg-white px-3 py-2.5 shadow-xl">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-[10px] font-semibold italic text-amber-500">Новая</span>
                                  <button type="button" onClick={() => setMarkingEditingId(null)}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Готово">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                  </button>
                                </div>
                                <span className="mt-1 block truncate text-xs font-semibold text-slate-700 leading-tight">{entry.performer_name}</span>
                                <div className="relative mt-1 flex items-center">
                                  <input type="text" autoFocus value={entry.barcode ?? ''}
                                    onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, barcode: e.target.value } : x))}
                                    placeholder="Штрих-код (13 цифр)"
                                    className={`w-full rounded-lg border px-2 py-1 pr-7 font-mono text-[11px] text-slate-500 focus:outline-none focus:ring-1 ${(entry.barcode ?? '').length === 0 ? 'border-slate-200 focus:ring-blue-400' : /^\d{13}$/.test(entry.barcode ?? '') ? 'border-emerald-400 focus:ring-emerald-200' : 'border-red-300 focus:ring-red-200'}`} />
                                  <button type="button" title="Сканировать" className="absolute right-1.5 text-slate-400 hover:text-blue-500"
                                    onClick={() => { setMarkingEditScanTarget({ type: 'buffer', tempId: entry.tempId }); setMarkingCameraError(null); setMarkingCameraOpen(true) }}>
                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><line x1="7" y1="9" x2="7" y2="15"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="13" y1="9" x2="13" y2="15"/><line x1="16" y1="9" x2="16" y2="15"/></svg>
                                  </button>
                                </div>
                                {(entry.barcode ?? '').length > 0 && !/^\d{13}$/.test(entry.barcode ?? '') && (
                                  <p className="mt-0.5 text-[10px] text-red-500 pl-0.5">{(entry.barcode ?? '').replace(/\D/g, '').length}/13 · только цифры</p>
                                )}
                                <select value={entry.tariff} onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, tariff: e.target.value } : x))}
                                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                  {markingTariffsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                                {accountConsumables.length > 0 && (
                                  <select value={entry.consumable_id ?? ''} onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, consumable_id: e.target.value || null } : x))}
                                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                                    <option value="">Расходник: не выбрано</option>
                                    {accountConsumables.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                )}
                                <div className="mt-1.5 flex items-center gap-3">
                                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                                    Годный
                                    <input type="number" min={0} value={entry.qty}
                                      onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? {
                                        ...x,
                                        qty: Number(e.target.value),
                                        labels_qty: x.labels_all ? (Number(e.target.value) > 0 ? Number(e.target.value) : null) : x.labels_qty,
                                      } : x))}
                                      className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400" />
                                  </label>
                                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                                    Брак
                                    <input type="number" min={0} value={entry.qty_defect}
                                      onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, qty_defect: Number(e.target.value) } : x))}
                                      className="w-20 rounded-lg border border-red-200 px-2 py-1.5 text-center text-sm font-medium text-red-600 focus:outline-none focus:ring-2 focus:ring-red-300" />
                                  </label>
                                </div>
                                <div className="mt-1.5 flex items-end gap-2">
                                  <div className="flex-1">
                                    <label className="mb-0.5 block text-[10px] text-slate-500">Этикетки (шт.)</label>
                                    <input type="number" min={0}
                                      value={entry.labels_all ? (entry.qty > 0 ? entry.qty : 0) : (entry.labels_qty ?? '')}
                                      onChange={(e) => setMarkingBuffer((p) => p.map((x) => {
                                        if (x.tempId !== entry.tempId || x.labels_all) return x
                                        const raw = Number(e.target.value)
                                        return { ...x, labels_qty: raw > 0 ? raw : null }
                                      }))}
                                      disabled={entry.labels_all}
                                      className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-50 disabled:text-slate-400" />
                                  </div>
                                  <label className="mb-1 flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-slate-500">
                                    <input type="checkbox" checked={entry.labels_all}
                                      onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? {
                                        ...x,
                                        labels_all: e.target.checked,
                                        labels_qty: e.target.checked ? (x.qty > 0 ? x.qty : null) : x.labels_qty,
                                      } : x))}
                                      className="h-3.5 w-3.5 cursor-pointer accent-blue-600" />
                                    Все товары
                                  </label>
                                </div>
                                <input type="text" value={entry.notes}
                                  onChange={(e) => setMarkingBuffer((p) => p.map((x) => x.tempId === entry.tempId ? { ...x, notes: e.target.value } : x))}
                                  placeholder="Примечание"
                                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none" />
                                {entry.photo_files.length > 0 && (
                                  <div className="mt-1.5"><InvoicePhotoCell photoUrls={entry.photo_files.map((f) => URL.createObjectURL(f))} /></div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
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

          {/* МОДАЛКА ВЫБОРА РЕЙСА */}
          {isTripPickerOpen && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={() => setIsTripPickerOpen(false)}>
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
              <div className="relative w-full max-w-xl rounded-3xl bg-white shadow-2xl overflow-hidden flex flex-col" style={{ height: '520px' }} onClick={(e) => e.stopPropagation()}>
                {/* Шапка */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <p className="font-semibold text-slate-800">Выбор рейса</p>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-slate-500 hover:text-slate-700">
                      <div
                        onClick={() => setShowAllTrips((v) => !v)}
                        className={`relative flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors ${showAllTrips ? 'bg-blue-500' : 'bg-slate-200'}`}
                      >
                        <span className={`absolute h-3 w-3 rounded-full bg-white shadow transition-transform ${showAllTrips ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                      </div>
                      Все рейсы
                    </label>
                    <button onClick={() => { setIsTripPickerOpen(false); setTripSearch('') }} className="h-7 w-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">✕</button>
                  </div>
                </div>

                {/* Поиск */}
                <div className="px-4 pt-3 pb-1">
                  <div className="relative">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none"><path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" /></svg>
                    <input
                      autoFocus
                      type="text"
                      placeholder="Поиск по номеру, перевозчику, дате…"
                      value={tripSearch}
                      onChange={(e) => setTripSearch(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Список рейсов */}
                <div className="flex-1 overflow-y-auto min-h-0">
                  {(() => {
                    const baseList = [
                      ...(showAllTrips ? trips : trips.filter((t) => t.status === 'Формируется')),
                      ...localDraftTrips.filter((ld) => !trips.some((t) => t.id === ld.id)),
                    ]
                    const q = tripSearch.trim().toLowerCase()
                    const filtered = q
                      ? baseList.filter((t) => {
                          const num = (t.trip_number ?? `Черновик-${t.draft_number}`).toLowerCase()
                          const draftLabel = t.draft_number ? `рейс #${t.draft_number}` : ''
                          const carrier = (t.carrier ?? '').toLowerCase()
                          const date = t.departure_date ? new Date(t.departure_date).toLocaleDateString('ru-RU') : ''
                          return num.includes(q) || draftLabel.includes(q) || carrier.includes(q) || date.includes(q)
                        })
                      : baseList
                    if (filtered.length === 0) {
                      return <p className="py-8 text-center text-sm text-slate-400">{q ? 'Ничего не найдено' : 'Рейсов нет'}</p>
                    }
                    return (
                      <div className="py-2">
                        {(() => {
                          const otherUsedTripIds = new Set(
                            tripSlots
                              .filter((s) => s.slotId !== tripPickerSlotId && s.tripId)
                              .map((s) => s.tripId)
                          )
                          return filtered.filter((t) => !otherUsedTripIds.has(t.id)).map((t) => {
                            const label = `${t.trip_number ?? `Рейс #${t.draft_number}`}${t.carrier ? ` · ${t.carrier}` : ''}${t.departure_date ? ` · ${new Date(t.departure_date).toLocaleDateString('ru-RU')}` : ''}`
                            const isSelected = tripSlots.find((s) => s.slotId === tripPickerSlotId)?.tripId === t.id
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  setTripSlots((prev) => prev.map((slot) => slot.slotId === tripPickerSlotId ? { ...slot, tripId: t.id, tripLabel: label } : slot))
                                  setIsTripPickerOpen(false)
                                  setTripSearch('')
                                  setIsDirty(true)
                                }}
                                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-blue-50 ${isSelected ? 'bg-blue-50' : ''}`}
                              >
                                <div className={`h-4 w-4 flex-shrink-0 rounded-full border-2 ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300'}`} />
                                <div>
                                  <p className={`text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>{t.trip_number ?? `Рейс #${t.draft_number}`}</p>
                                  {(t.carrier || t.departure_date) && (
                                    <p className="text-xs text-slate-400">{[t.carrier, t.departure_date ? new Date(t.departure_date).toLocaleDateString('ru-RU') : null].filter(Boolean).join(' · ')}</p>
                                  )}
                                </div>
                              </button>
                            )
                          })
                        })()}
                      </div>
                    )
                  })()}
                </div>
                <div className="border-t border-slate-100 px-5 py-4">
                  <button
                    type="button"
                    disabled={isCreatingDraftTrip}
                    onClick={async () => {
                      setIsCreatingDraftTrip(true)
                      try {
                        const newTrip = await createTrip(accountId, { carrier: '', comment: '' })
                        const label = `Рейс #${newTrip.draft_number} (черновик)`
                        const newTripWithLines: TripWithLines = { ...newTrip, lines: [] }
                        setLocalDraftTrips((prev) => [...prev, newTripWithLines])
                        onTripCreated?.(newTripWithLines)
                        setTripSlots((prev) => prev.map((slot) => slot.slotId === tripPickerSlotId ? { ...slot, tripId: newTrip.id, tripLabel: label } : slot))
                        setIsTripPickerOpen(false)
                        setIsDirty(true)
                      } catch (e: unknown) {
                        // silent — ошибка покажется при создании поставки
                      } finally {
                        setIsCreatingDraftTrip(false)
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-2.5 text-sm font-medium text-slate-500 hover:border-blue-300 hover:text-blue-600 transition-colors disabled:opacity-40"
                  >
                    {isCreatingDraftTrip ? (
                      <span>Создание…</span>
                    ) : (
                      <>
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" /></svg>
                        Создать новый рейс (черновик)
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* УПАКОВКА */}
          {viewStage === 'packaging' && (
            <div className="space-y-4">
              {packagingAddModalOpen && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setPackagingAddModalOpen(false) }}>
                  <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                      <h3 className="text-base font-semibold text-slate-800">Добавить выполненную работу</h3>
                      <button type="button" onClick={() => setPackagingAddModalOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                    <div className="space-y-3 p-5">
                      {/* Исполнитель */}
                      {canOtkAssign && packagingPerformers.length > 0 ? (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Исполнитель</label>
                          <select value={packagingWorkPerformerId} onChange={(e) => { const p = packagingPerformers.find((x) => x.user_id === e.target.value); setPackagingWorkPerformerId(e.target.value); setPackagingWorkPerformerName(p?.full_name || e.target.value) }}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            {packagingPerformers.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Исполнитель</label>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">{packagingWorkPerformerName || userEmail}</div>
                        </div>
                      )}
                      {/* Тариф */}
                      {packagingTariffsList.length > 0 && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Тариф</label>
                          <select value={packagingWorkTariff || packagingTariffsList[0]?.id} onChange={(e) => setPackagingWorkTariff(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            {packagingTariffsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                      )}
                      {/* Расходники */}
                      {accountConsumables.length > 0 && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">Расходник</label>
                          <select value={packagingWorkConsumableId} onChange={(e) => setPackagingWorkConsumableId(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">— не выбрано —</option>
                            {accountConsumables.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      )}
                      {/* Годный / Брак */}
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="mb-1 block text-xs font-medium text-slate-500">Количество</label>
                          <input type="number" min="0" placeholder="0" value={packagingWorkQty} onChange={(e) => setPackagingWorkQty(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddPackagingLog() }}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="flex-1">
                          <label className="mb-1 block text-xs font-medium text-red-400">Брак</label>
                          <input type="number" min="0" placeholder="0" value={packagingWorkDefect} onChange={(e) => setPackagingWorkDefect(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddPackagingLog() }}
                            className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm text-red-700 placeholder-red-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-red-400" />
                        </div>
                      </div>
                      {/* Зип-пакеты */}
                      <div className="flex items-end gap-3">
                        <div className="flex-1">
                          <label className="mb-1 block text-xs font-medium text-slate-500">Зип-пакеты (шт.)</label>
                          <input type="number" min="0" placeholder="0"
                            value={packagingWorkZipBagsAll ? (Number(packagingWorkQty) > 0 ? packagingWorkQty : '0') : packagingWorkZipBags}
                            onChange={(e) => { if (!packagingWorkZipBagsAll) setPackagingWorkZipBags(e.target.value) }}
                            disabled={packagingWorkZipBagsAll}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400" />
                        </div>
                        <label className="mb-2 flex shrink-0 cursor-pointer items-center gap-1.5">
                          <input type="checkbox" checked={packagingWorkZipBagsAll}
                            onChange={(e) => setPackagingWorkZipBagsAll(e.target.checked)}
                            className="h-5 w-5 cursor-pointer accent-blue-600" />
                          <span className="whitespace-nowrap text-sm text-slate-600">Все товары</span>
                        </label>
                      </div>
                      {/* ZIP-пакет из каталога расходников */}
                      {zipCatalogItems.length > 0 && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-500">ZIP-пакет</label>
                          <select value={packagingWorkCatalogConsumableId} onChange={(e) => setPackagingWorkCatalogConsumableId(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">— не выбрано —</option>
                            {zipCatalogItems.map((c) => (
                              <option key={c.id} value={c.id}>{c.size}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {/* Примечание */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">Примечание</label>
                        <input type="text" placeholder="Необязательно" value={packagingWorkNotes} onChange={(e) => setPackagingWorkNotes(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      {/* Фото */}
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-500">Фото</label>
                        <input ref={packagingFileInputRef} type="file" accept="image/*" multiple className="hidden"
                          onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) setPackagingWorkPhotoFiles((prev) => [...prev, ...files]); e.target.value = '' }} />
                        <button type="button" onClick={() => packagingFileInputRef.current?.click()}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${packagingWorkPhotoFiles.length > 0 ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4 shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                          </svg>
                          {packagingWorkPhotoFiles.length > 0 ? `${packagingWorkPhotoFiles.length} фото прикреплено` : 'Прикрепить фото'}
                        </button>
                        {packagingWorkPhotoFiles.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {packagingWorkPhotoFiles.map((f, i) => (
                              <div key={i} className="group relative">
                                <img src={URL.createObjectURL(f)} alt={f.name} className="h-14 w-14 rounded-lg object-cover border border-slate-200" />
                                <button type="button" onClick={() => setPackagingWorkPhotoFiles((prev) => prev.filter((_, j) => j !== i))}
                                  className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs group-hover:flex">×</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
                      <button type="button" onClick={() => setPackagingAddModalOpen(false)}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                        Отмена
                      </button>
                      <button type="button" onClick={handleAddPackagingLog}
                        disabled={isAddingPackagingLog || ((!packagingWorkQty || Number(packagingWorkQty) <= 0) && (!packagingWorkDefect || Number(packagingWorkDefect) <= 0))}
                        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                        {isAddingPackagingLog ? 'Сохранение…' : '+ Добавить'}
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}

              {/* Журнал работ Упаковки */}
              {isLoadingPackagingLogs ? (
                <div className="py-6 text-center text-sm text-slate-400">Загрузка…</div>
              ) : packagingLogs.length === 0 && packagingBuffer.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 py-10">
                  <p className="text-sm text-slate-400">Записей работы нет — добавьте первую</p>
                  {canManage && (
                    <button type="button" onClick={() => setPackagingAddModalOpen(true)}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                      + Добавить работу
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Итого */}
                  {(() => {
                    const activeLogs = packagingLogs.filter((l) => !packagingDeletedIds.includes(l.id))
                    const performers = new Set([
                      ...activeLogs.map((l) => l.performer_user_id ?? l.user_id),
                      ...packagingBuffer.map((e) => e.performer_user_id ?? ''),
                    ]).size
                    const tariffs = new Set([
                      ...activeLogs.map((l) => packagingEdits[l.id]?.tariff ?? l.tariff),
                      ...packagingBuffer.map((e) => e.tariff),
                    ]).size
                    const totalGood = activeLogs.reduce((s, l) => s + (packagingEdits[l.id]?.qty ?? l.qty), 0) + packagingBuffer.reduce((s, e) => s + e.qty, 0)
                    const totalDefect = activeLogs.reduce((s, l) => s + (packagingEdits[l.id]?.qty_defect ?? l.qty_defect), 0) + packagingBuffer.reduce((s, e) => s + e.qty_defect, 0)
                    const stats = [
                      { label: 'Исполнителей', value: performers },
                      { label: 'Тарифов', value: tariffs },
                      { label: 'Упаковано', value: totalGood },
                      ...(totalDefect > 0 ? [{ label: 'Браков', value: totalDefect, color: 'text-red-600' }] : []),
                    ]
                    return (
                      <div className="flex items-center gap-x-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                        <span className="font-semibold text-slate-600">Итого</span>
                        <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-1">
                          {stats.map(({ label, value, color }) => (
                            <span key={label} className="text-xs text-slate-500">
                              {label}: <span className={`font-semibold ${color ?? 'text-slate-800'}`}>{value}</span>
                            </span>
                          ))}
                        </div>
                        {canManage && (
                          <button type="button" onClick={() => setPackagingAddModalOpen(true)}
                            className="shrink-0 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors">
                            + Добавить работу
                          </button>
                        )}
                      </div>
                    )
                  })()}

                  {/* Карточки */}
                  <div className="grid grid-cols-6 gap-2">
                    {packagingLogs.filter((l) => !packagingDeletedIds.includes(l.id)).map((log) => {
                      const isEditing = packagingEditingId === log.id
                      const edit = packagingEdits[log.id] ?? {
                        tariff: log.tariff,
                        qty: log.qty,
                        qty_defect: log.qty_defect,
                        notes: log.notes ?? '',
                        zip_bags_qty: log.zip_bags_qty ?? null,
                        zip_bags_all: (log.zip_bags_qty ?? 0) > 0 && (log.zip_bags_qty ?? 0) === log.qty,
                      }
                      const logTime = new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                      const logDate = new Date(log.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
                      const isOwn = log.user_id === userId
                      const hasEdit = !!packagingEdits[log.id] && (
                        packagingEdits[log.id].tariff !== log.tariff ||
                        packagingEdits[log.id].qty !== log.qty ||
                        packagingEdits[log.id].qty_defect !== log.qty_defect ||
                        packagingEdits[log.id].notes !== (log.notes ?? '') ||
                        (packagingEdits[log.id].zip_bags_qty ?? 0) !== (log.zip_bags_qty ?? 0) ||
                        (packagingEdits[log.id].catalog_consumable_id ?? null) !== (log.catalog_consumable_id ?? null)
                      )
                      const displayTariff = packagingTariffsList.find((t) => t.id === edit.tariff)?.name ?? edit.tariff
                      return (
                        <div key={log.id} className="relative">
                          {/* Плейсхолдер */}
                          <div className={`flex flex-col gap-1.5 rounded-2xl border px-3 py-2.5 ${isEditing ? 'invisible' : hasEdit ? 'border-amber-200 bg-amber-50/40' : isOwn ? 'border-blue-100 bg-blue-50/20' : 'border-slate-200 bg-white'}`}>
                            <div className="flex items-start justify-between gap-1">
                              <div className="flex flex-col items-start leading-tight">
                                <span className="text-[11px] font-semibold text-slate-700 tabular-nums">{logTime}</span>
                                <span className="text-[10px] text-slate-400 tabular-nums">{logDate}</span>
                              </div>
                              {(isOwn || canManage) && (
                                <div className="flex items-center gap-0.5">
                                  <button type="button" onClick={() => {
                                    if (packagingEditingId && packagingEditingId !== log.id) {
                                      const prev = packagingEdits[packagingEditingId]
                                      const prevLog = packagingLogs.find((l) => l.id === packagingEditingId)
                                      if (prev && prevLog && prev.tariff === prevLog.tariff && prev.qty === prevLog.qty && prev.qty_defect === prevLog.qty_defect && prev.notes === (prevLog.notes ?? '') && (prev.zip_bags_qty ?? 0) === (prevLog.zip_bags_qty ?? 0)) {
                                        setPackagingEdits((p) => { const n = { ...p }; delete n[packagingEditingId]; return n })
                                      }
                                    }
                                    setPackagingEdits((p) => ({
                                      ...p,
                                      [log.id]: {
                                        tariff: log.tariff,
                                        qty: log.qty,
                                        qty_defect: log.qty_defect,
                                        notes: log.notes ?? '',
                                        zip_bags_qty: log.zip_bags_qty ?? null,
                                        zip_bags_all: (log.zip_bags_qty ?? 0) > 0 && (log.zip_bags_qty ?? 0) === log.qty,
                                        catalog_consumable_id: log.catalog_consumable_id ?? null,
                                      },
                                    }))
                                    setPackagingEditingId(log.id)
                                  }}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-blue-50 hover:text-blue-500" title="Редактировать">
                                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                  </button>
                                  <button type="button"
                                    onClick={() => {
                                      if (packagingDeleteConfirmId === log.id) { handleDeletePackagingLog(log.id); setPackagingDeleteConfirmId(null) }
                                      else setPackagingDeleteConfirmId(log.id)
                                    }}
                                    className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors ${packagingDeleteConfirmId === log.id ? 'bg-red-500 text-white' : 'text-slate-300 hover:bg-red-50 hover:text-red-500'}`}
                                    title={packagingDeleteConfirmId === log.id ? 'Подтвердить удаление' : 'Удалить'}>
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              )}
                            </div>
                            <span className="truncate text-xs font-semibold text-slate-700 leading-tight">{log.performer_name}</span>
                            <span className="w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[10px] leading-tight text-slate-600">{displayTariff}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400">Упак: <span className="font-bold text-slate-800">{edit.qty}</span></span>
                              {edit.qty_defect > 0 && <span className="text-[10px] text-slate-400">Бр: <span className="font-bold text-red-600">{edit.qty_defect}</span></span>}
                            </div>
                            {(edit.zip_bags_qty ?? 0) > 0 && (
                              <span className="w-fit rounded-full bg-teal-50 px-2 py-0.5 text-[10px] leading-tight text-teal-700">Зип: {edit.zip_bags_qty} шт.</span>
                            )}
                            {log.consumable_id && (() => { const c = accountConsumables.find((x) => x.id === log.consumable_id); return c ? <span className="w-fit rounded-full bg-teal-50 px-2 py-0.5 text-[10px] leading-tight text-teal-700">{c.name}</span> : null })()}
                            {edit.notes && <span className="truncate text-[10px] italic text-slate-400">{edit.notes}</span>}
                          </div>
                          {/* Редактируемая карточка */}
                          {isEditing && (
                            <div className="absolute left-0 top-0 z-30 w-64 rounded-2xl border border-blue-200 bg-white px-3 py-2.5 shadow-xl">
                              <div className="flex items-start justify-between gap-1">
                                <div className="flex flex-col items-start leading-tight">
                                  <span className="text-[11px] font-semibold text-blue-600 tabular-nums">{logTime}</span>
                                  <span className="text-[10px] text-slate-400 tabular-nums">{logDate}</span>
                                </div>
                                <div className="flex items-center gap-0.5">
                                  <button type="button" onClick={() => { setIsDirty(true); setPackagingEditingId(null) }}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50" title="Применить">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                                  </button>
                                  <button type="button" onClick={() => { setPackagingEdits((p) => { const n = { ...p }; delete n[log.id]; return n }); setPackagingEditingId(null) }}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" title="Отмена">
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              </div>
                              <span className="mt-1 block truncate text-xs font-semibold text-slate-700 leading-tight">{log.performer_name}</span>
                              {packagingTariffsList.length > 0 && (
                                <select value={edit.tariff} onChange={(e) => setPackagingEdits((p) => ({ ...p, [log.id]: { ...edit, tariff: e.target.value } }))}
                                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400">
                                  {packagingTariffsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                              )}
                              <div className="mt-1.5 flex gap-1.5">
                                <div className="flex-1">
                                  <div className="mb-0.5 text-[9px] font-medium text-slate-400">Упак</div>
                                  <input type="number" min="0" autoFocus value={edit.qty}
                                    onChange={(e) => {
                                      const qty = Number(e.target.value) || 0
                                      setPackagingEdits((p) => ({
                                        ...p,
                                        [log.id]: {
                                          ...edit,
                                          qty,
                                          zip_bags_qty: edit.zip_bags_all ? qty : edit.zip_bags_qty,
                                        },
                                      }))
                                    }}
                                    className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-1 focus:ring-blue-400" />
                                </div>
                                <div className="flex-1">
                                  <div className="mb-0.5 text-[9px] font-medium text-red-400">Брак</div>
                                  <input type="number" min="0" value={edit.qty_defect}
                                    onChange={(e) => setPackagingEdits((p) => ({ ...p, [log.id]: { ...edit, qty_defect: Number(e.target.value) || 0 } }))}
                                    className="w-full rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 placeholder-red-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-1 focus:ring-red-400" />
                                </div>
                              </div>
                              <input type="text" placeholder="Примечание" value={edit.notes}
                                onChange={(e) => setPackagingEdits((p) => ({ ...p, [log.id]: { ...edit, notes: e.target.value } }))}
                                className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              <div className="mt-1.5 flex items-end gap-1.5">
                                <div className="flex-1">
                                  <div className="mb-0.5 text-[9px] font-medium text-slate-400">Зип-пакеты (шт.)</div>
                                  <input
                                    type="number"
                                    min="0"
                                    value={edit.zip_bags_all ? String(edit.qty) : String(edit.zip_bags_qty ?? '')}
                                    onChange={(e) => {
                                      if (edit.zip_bags_all) return
                                      const next = e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0)
                                      setPackagingEdits((p) => ({ ...p, [log.id]: { ...edit, zip_bags_qty: next } }))
                                    }}
                                    disabled={edit.zip_bags_all}
                                    className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
                                  />
                                </div>
                                <label className="mb-0.5 flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={edit.zip_bags_all}
                                    onChange={(e) => {
                                      const all = e.target.checked
                                      setPackagingEdits((p) => ({
                                        ...p,
                                        [log.id]: {
                                          ...edit,
                                          zip_bags_all: all,
                                          zip_bags_qty: all ? Math.max(0, Number(edit.qty) || 0) : (edit.zip_bags_qty ?? null),
                                        },
                                      }))
                                    }}
                                    className="h-3.5 w-3.5 cursor-pointer accent-blue-600"
                                  />
                                  Все товары
                                </label>
                              </div>
                              {zipCatalogItems.length > 0 && (
                                <div className="mt-1.5">
                                  <div className="mb-0.5 text-[9px] font-medium text-slate-400">ZIP-пакет</div>
                                  <select
                                    value={edit.catalog_consumable_id ?? ''}
                                    onChange={(e) => setPackagingEdits((p) => ({ ...p, [log.id]: { ...edit, catalog_consumable_id: e.target.value || null } }))}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400">
                                    <option value="">— не выбрано —</option>
                                    {zipCatalogItems.map((c) => (
                                      <option key={c.id} value={c.id}>{c.size}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {packagingBuffer.map((e) => {
                      const displayTariff = packagingTariffsList.find((t) => t.id === e.tariff)?.name ?? e.tariff
                      return (
                        <div key={e.tempId} className="flex flex-col gap-1.5 rounded-2xl border border-amber-200 bg-amber-50/40 px-3 py-2.5">
                          <div className="flex items-start justify-between gap-1">
                            <span className="text-[11px] font-semibold text-amber-600">Не сохранено</span>
                            <button type="button" onClick={() => setPackagingBuffer((prev) => prev.filter((x) => x.tempId !== e.tempId))}
                              className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500">
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                          </div>
                          <span className="truncate text-xs font-semibold text-slate-700 leading-tight">{e.performer_name}</span>
                          <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[10px] leading-tight text-amber-700">{displayTariff}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400">Упак: <span className="font-bold text-slate-800">{e.qty}</span></span>
                            {e.qty_defect > 0 && <span className="text-[10px] text-slate-400">Бр: <span className="font-bold text-red-600">{e.qty_defect}</span></span>}
                          </div>
                          {(e.zip_bags_qty ?? 0) > 0 && (
                            <span className="w-fit rounded-full bg-teal-50 px-2 py-0.5 text-[10px] leading-tight text-teal-700">Зип: {e.zip_bags_qty} шт.</span>
                          )}
                          {e.consumable_id && (() => { const c = accountConsumables.find((x) => x.id === e.consumable_id); return c ? <span className="w-fit rounded-full bg-teal-50 px-2 py-0.5 text-[10px] leading-tight text-teal-700">{c.name}</span> : null })()}
                          {e.notes && <span className="truncate text-[10px] italic text-slate-400">{e.notes}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ФОРМИРОВАНИЕ КОРОБОВ */}
          {viewStage === 'packing' && (
            <div className="space-y-4">

              {/* Коробки */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-medium text-slate-700 mb-3">Коробки</div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        const totalBoxes = supplies.reduce((s, sup) => s + sup.boxes.length, 0)
                        setBoxesQtyMode('all')
                        setBoxesQtyInput(String(totalBoxes))
                      }}
                      className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${boxesQtyMode === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {(() => { const t = supplies.reduce((s, sup) => s + sup.boxes.length, 0); return `Все коробки${t > 0 ? ` (${t})` : ''}` })()}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBoxesQtyMode('custom')}
                      className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${boxesQtyMode === 'custom' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Указать вручную
                    </button>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={boxesQtyInput}
                    onChange={(e) => setBoxesQtyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && boxesQtyMode === 'custom') {
                        void handleSaveBoxesQty()
                      }
                    }}
                    disabled={boxesQtyMode === 'all' || !canManage}
                    placeholder="0"
                    className="w-24 rounded-xl border border-slate-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                  />
                  {boxCatalogItems.length > 0 && (
                    <select
                      value={boxCatalogConsumableId}
                      onChange={(e) => setBoxCatalogConsumableId(e.target.value)}
                      disabled={!canManage}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">— Тип короба —</option>
                      {boxCatalogItems.map((c) => (
                        <option key={c.id} value={c.id}>{c.size}</option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    disabled={isSavingBoxesQty || !canManage}
                    onClick={() => { void handleSaveBoxesQty() }}
                    className="shrink-0 rounded-xl bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {isSavingBoxesQty ? '...' : 'Сохранить'}
                  </button>
                  {batch.boxes_qty != null && (
                    <span className="text-sm text-slate-400">
                      Сохранено: <span className="font-medium text-slate-700">{batch.boxes_qty}</span> шт.
                    </span>
                  )}
                </div>
              </div>

              <>
                  {/* Тулбар: склад + кнопка добавить */}
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
                    {canManage && (
                      <div className="relative flex-1 min-w-0">
                        {isWarehouseDropdownOpen ? (
                          <div className="flex items-center gap-2 rounded-xl border border-blue-400 ring-2 ring-blue-100 px-2.5 py-1.5 bg-white">
                            <svg className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
                            </svg>
                            <input
                              autoFocus
                              type="text"
                              placeholder="Поиск склада…"
                              value={warehouseSearch}
                              onChange={(e) => setWarehouseSearch(e.target.value)}
                              onBlur={(e) => { if (!e.currentTarget.closest('[data-warehouse-dropdown]')?.contains(e.relatedTarget as Node)) { setIsWarehouseDropdownOpen(false); setWarehouseSearch('') } }}
                              className="flex-1 text-sm outline-none bg-transparent text-slate-800 placeholder-slate-400 min-w-0"
                            />
                            <button type="button" onMouseDown={(e) => { e.preventDefault(); setIsWarehouseDropdownOpen(false); setWarehouseSearch('') }} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setIsWarehouseDropdownOpen(true); setWarehouseSearch('') }}
                            className="w-full flex items-center justify-between rounded-xl border border-slate-200 hover:border-slate-300 px-2.5 py-1.5 text-sm outline-none transition-colors bg-white"
                          >
                            <span className={selectedWarehouseId ? 'text-slate-700 truncate' : 'text-slate-400'}>
                              {selectedWarehouseId ? (warehouses.find((w) => w.id === selectedWarehouseId)?.name ?? '—') : '— склад назначения —'}
                            </span>
                            <svg className="ml-2 h-3.5 w-3.5 flex-shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                        {isWarehouseDropdownOpen && (
                          <div data-warehouse-dropdown className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-[220px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
                            <div className="max-h-52 overflow-y-auto py-1">
                              {warehouses.filter((w) => w.name.toLowerCase().includes(warehouseSearch.toLowerCase())).length === 0 ? (
                                <p className="px-4 py-3 text-sm text-slate-400">Ничего не найдено</p>
                              ) : (
                                warehouses
                                  .filter((w) => w.name.toLowerCase().includes(warehouseSearch.toLowerCase()))
                                  .map((w) => (
                                    <button
                                      key={w.id}
                                      type="button"
                                      onMouseDown={(e) => { e.preventDefault(); setSelectedWarehouseId(w.id); setIsWarehouseDropdownOpen(false); setWarehouseSearch('') }}
                                      className={`w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-blue-50 hover:text-blue-700 ${selectedWarehouseId === w.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700'}`}
                                    >
                                      {w.name}
                                    </button>
                                  ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Кнопка добавить */}
                    {canManage && (
                      <button
                        disabled={!selectedWarehouseId}
                        onClick={() => {
                          if (!selectedWarehouseId) return
                          const wh = warehouses.find((w) => w.id === selectedWarehouseId)
                          if (!wh) return
                          const now = new Date().toISOString()
                          setSupplies((prev) => [...prev, {
                            id: crypto.randomUUID(),
                            _local: true,
                            batch_id: batch.id,
                            account_id: accountId,
                            warehouse_id: wh.id,
                            warehouse_name: wh.name,
                            trip_id: null,
                            trip_line_id: null,
                            weight: null,
                            created_by: userId || null,
                            created_at: now,
                            boxes: [],
                          }])
                          setSelectedWarehouseId('')
                          setIsDirty(true)
                        }}
                        className="flex-shrink-0 rounded-xl bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
                      >
                        + Поставка
                      </button>
                    )}
                  </div>

                  {/* Список поставок — grid 6 колонок */}
                  {isLoadingSupplies ? (
                    <p className="text-center text-sm text-slate-400 py-4">Загрузка поставок…</p>
                  ) : supplies.length === 0 ? (
                    <div className="rounded-2xl border-2 border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
                      Поставок ещё нет. Создайте первую поставку выше.
                    </div>
                  ) : (
                    <div className="grid grid-cols-6 gap-2">
                      {supplies.map((supply) => {
                        const totalBoxes = supply.boxes.length
                        const totalItems = supply.boxes.reduce((s, b) => s + b.items.reduce((ss, i) => ss + i.qty, 0), 0)
                        const closedBoxes = supply.boxes.filter((b) => b.status === 'closed').length
                        const isActiveStage = batch.current_stage === 'packing'
                        const canDeleteCard = canManage && (isActiveStage || canSupplyDeleteLocked)
                        const linkedLine = supply.trip_line_id
                          ? trips.flatMap((t) => t.lines).find((l) => l.id === supply.trip_line_id)
                          : null
                        return (
                          <div key={supply.id} className="relative">
                            <button
                              type="button"
                              onClick={() => setActiveSupplyId(supply.id)}
                              className="relative flex w-full flex-col items-start gap-1 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
                            >
                              {supply._local && (
                                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-400" title="не сохранено" />
                              )}
                              <p className="truncate text-xs font-bold text-blue-600 leading-tight w-full pr-6">{supply.warehouse_name ?? <span className="text-slate-400 font-normal italic">склад не указан</span>}</p>
                              <p className="text-xs text-slate-400">{totalBoxes} кор. · {totalItems} ед.</p>
                              {totalBoxes > 0 && (
                                <p className="text-xs text-slate-400">{closedBoxes}/{totalBoxes} закрыто</p>
                              )}
                              {linkedLine && (
                                <p className="text-xs font-medium text-emerald-600">П-{linkedLine.shipment_number}</p>
                              )}
                            </button>
                            {canDeleteCard && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setDeleteSupplyConfirm(supply.id) }}
                                className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 hover:bg-red-50 hover:text-red-400 transition-colors"
                                title="Удалить поставку"
                              >
                                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" /></svg>
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Модалка работы с поставкой */}
                  {activeSupplyId && (() => {
                    const supply = supplies.find((s) => s.id === activeSupplyId)
                    if (!supply) return null
                    const totalBoxes = supply.boxes.length
                    const nextBoxNum = totalBoxes + 1
                    return (
                      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={() => setActiveSupplyId(null)}>
                        <div className="relative flex h-[90vh] w-[80%] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                          {/* Шапка модалки поставки */}
                          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                            <div className="flex items-center gap-3">
                              <p className="font-semibold text-slate-800">{supply.warehouse_name}</p>
                              {supply._local && (
                                <span className="text-xs font-medium text-amber-600 bg-amber-50 rounded-full px-2 py-0.5">не сохранено</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {(() => {
                                const isActiveStage = batch.current_stage === 'packing'
                                const canDelete = canManage && (isActiveStage || canSupplyDeleteLocked)
                                return canDelete ? (
                                  <button
                                    onClick={() => setDeleteSupplyConfirm(supply.id)}
                                    className="text-sm text-red-400 hover:text-red-600"
                                  >
                                    Удалить
                                  </button>
                                ) : null
                              })()}
                              <button onClick={() => setActiveSupplyId(null)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                              </button>
                            </div>
                          </div>

                          {/* Табы коробов */}
                          {supply.boxes.length > 0 && (
                            <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-5 py-2 scrollbar-none">
                              {supply.boxes.map((box) => {
                                const isActive = packingOpenBoxId === box.id
                                const boxTotal = box.items.reduce((s, i) => s + i.qty, 0)
                                return (
                                  <button
                                    key={box.id}
                                    type="button"
                                    onClick={() => setPackingOpenBoxId(box.id)}
                                    className={`flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                  >
                                    Короб #{box.box_number}
                                    {box.items.length > 0 && <span className={`ml-1 ${isActive ? 'text-blue-200' : 'text-slate-400'}`}>· {boxTotal} ед.</span>}
                                    {box.status === 'closed' && <span className={`ml-1 ${isActive ? 'text-blue-200' : 'text-green-500'}`}>✓</span>}
                                  </button>
                                )
                              })}
                            </div>
                          )}

                          {/* Содержимое активного короба */}
                          <div className="flex-1 overflow-y-auto">
                            {supply.boxes.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-full gap-2 text-sm text-slate-400">
                                <p>Коробов ещё нет</p>
                              </div>
                            ) : (() => {
                              const box = supply.boxes.find((b) => b.id === packingOpenBoxId) ?? supply.boxes[0]
                              if (!box) return null
                              const isOpen = box.status === 'open'
                              const boxTotal = box.items.reduce((s, i) => s + i.qty, 0)
                              return (
                                <div className="flex flex-col h-full">
                                  {/* Строка управления коробом */}
                                  <div className="flex items-center gap-3 px-5 border-b border-slate-100 bg-slate-50 min-h-[44px]">
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isOpen ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                      {isOpen ? 'открыт' : 'закрыт'}
                                    </span>
                                    <span className="text-xs text-slate-400">{box.items.length} позиций · {boxTotal} ед.</span>
                                    <div className="flex-1" />
                                    {/* Авто-добавление (если есть право) */}
                                    {canPackingAutoAdd && canManage && isOpen && (
                                      <button
                                        type="button"
                                        onClick={() => setPackingAutoAdd((v) => !v)}
                                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                                          packingAutoAdd
                                            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                        }`}
                                        title="Авто-добавление: скан сразу добавляет позицию"
                                      >
                                        <span className={`h-2 w-2 rounded-full transition-colors ${packingAutoAdd ? 'bg-blue-500' : 'bg-slate-300'}`} />
                                        Авто
                                      </button>
                                    )}
                                    {canManage && isOpen && (
                                      <button
                                        onClick={() => {
                                          setSupplies((prev) => prev.map((s) => s.id === supply.id ? { ...s, boxes: s.boxes.map((b) => b.id === box.id ? { ...b, status: 'closed' } : b) } : s))
                                          setIsDirty(true)
                                        }}
                                        className="text-xs font-medium text-green-600 hover:text-green-800"
                                      >
                                        Закрыть ✓
                                      </button>
                                    )}
                                    {canManage && !isOpen && (
                                      <button
                                        onClick={() => {
                                          if (!box._local) void reopenBox(box.id)
                                          setSupplies((prev) => prev.map((s) => s.id === supply.id ? { ...s, boxes: s.boxes.map((b) => b.id === box.id ? { ...b, status: 'open' } : b) } : s))
                                        }}
                                        className="text-xs text-slate-500 hover:text-slate-700 font-medium"
                                      >
                                        Открыть повторно
                                      </button>
                                    )}
                                    {canManage && (
                                      <button
                                        onClick={() => setDeleteBoxConfirm({ supplyId: supply.id, boxId: box.id })}
                                        className="text-xs text-red-400 hover:text-red-600"
                                      >
                                        Удалить
                                      </button>
                                    )}
                                  </div>

                                  {/* Список позиций */}
                                  <div className="flex-1 overflow-y-scroll px-5 py-3 space-y-1" style={{ scrollbarGutter: 'stable' }}>
                                    {box.items.length === 0 ? (
                                      <p className="text-sm text-slate-400 py-4 text-center">Позиций нет</p>
                                    ) : (
                                      box.items.map((item) => {
                                        const batchItem = items.find((it) => it.barcode === item.barcode)
                                        const info = packingProductCache[item.barcode]
                                        const displayName = info?.name ?? batchItem?.product_name ?? item.product_name
                                        const displaySize = info?.size ?? batchItem?.size
                                        const displayArticle = info?.vendor_code ?? batchItem?.article
                                        return (
                                          <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                                            <div className="flex items-start justify-between gap-3">
                                              {/* Фото товара */}
                                              <div className="flex-shrink-0 self-center">
                                                {info?.photo_url ? (
                                                  <img
                                                    src={info.photo_url}
                                                    alt=""
                                                    className="h-9 w-9 cursor-zoom-in rounded-lg object-cover"
                                                    onMouseEnter={(e) => {
                                                      const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect()
                                                      const popW = 288; const popH = 384; const gap = 12
                                                      const x = rect.right + gap + popW > window.innerWidth ? rect.left - gap - popW : rect.right + gap
                                                      const y = Math.min(rect.top, window.innerHeight - popH - gap)
                                                      setPackingPhotoPreview({ url: info.photo_url!, x, y })
                                                    }}
                                                    onMouseLeave={() => setPackingPhotoPreview(null)}
                                                  />
                                                ) : (
                                                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                                                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                      <rect x="3" y="3" width="18" height="18" rx="3" />
                                                      <circle cx="8.5" cy="8.5" r="1.5" />
                                                      <path d="m21 15-5-5L5 21" />
                                                    </svg>
                                                  </div>
                                                )}
                                              </div>
                                              <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  <span className="font-medium text-slate-800 truncate max-w-[280px]">{displayName ?? '—'}</span>
                                                  {displaySize && <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 flex-shrink-0">{displaySize}</span>}
                                                  {info?.color && <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 flex-shrink-0">{info.color}</span>}
                                                  {info?.category && <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 flex-shrink-0">{info.category}</span>}
                                                </div>
                                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                  <span className="font-mono text-xs text-slate-400">{item.barcode}</span>
                                                  {displayArticle && <span className="text-xs text-slate-500">{displayArticle}</span>}
                                                  {info?.nm_id && <span className="text-xs text-slate-400">WB&nbsp;{info.nm_id}</span>}
                                                  {info?.brand && <span className="text-xs text-slate-400">{info.brand}</span>}
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
                                                <span className="text-slate-700 font-medium text-xs">{item.qty}&nbsp;ед.</span>
                                                {canManage && isOpen && (
                                                  <button
                                                    onClick={async () => {
                                                      if (!item._local) await deleteBoxItem(item.id)
                                                      setSupplies((prev) => prev.map((s) => s.id === supply.id ? { ...s, boxes: s.boxes.map((b) => b.id === box.id ? { ...b, items: b.items.filter((i) => i.id !== item.id) } : b) } : s))
                                                    }}
                                                    className="text-red-400 hover:text-red-600"
                                                  >✕</button>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        )
                                      })
                                    )}
                                  </div>

                                  {/* Форма добавления позиции (только открытый короб) */}
                                  {canManage && isOpen && (
                                    <div className="border-t border-slate-100 px-5 py-4 space-y-3">
                                      <div className="flex items-center gap-2">
                                        <div className="relative flex-1">
                                        <input
                                          ref={packingBarcodeRef}
                                          autoFocus
                                          type="text"
                                          placeholder="Баркод"
                                          value={packingBoxBarcode[box.id] ?? ''}
                                          onChange={(e) => setPackingBoxBarcode((p) => ({ ...p, [box.id]: e.target.value }))}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              const bc = (packingBoxBarcode[box.id] ?? '').trim()
                                              if (!bc || !/^\d{13}$/.test(bc)) return
                                              if (packingAutoAdd) {
                                                // Авто-режим: сразу добавляем с текущим qty
                                                const qty = parseInt(packingBoxQty[box.id] ?? '1') || 1
                                                const matched = items.find((it) => it.barcode === bc)
                                                const now = new Date().toISOString()
                                                setSupplies((prev) => prev.map((s) => s.id === supply.id ? { ...s, boxes: s.boxes.map((bx) => bx.id === box.id ? {
                                                  ...bx, items: (() => {
                                                    const ex = bx.items.find((i) => i.barcode === bc)
                                                    if (ex) return bx.items.map((i) => i.barcode === bc ? { ...i, qty: i.qty + qty } : i)
                                                    return [...bx.items, { id: crypto.randomUUID(), _local: true, box_id: box.id, account_id: accountId, barcode: bc, item_id: matched?.id ?? null, product_name: matched?.product_name ?? null, qty, created_at: now }]
                                                  })()
                                                } : bx) } : s))
                                                setPackingBoxBarcode((p) => ({ ...p, [box.id]: '' }))
                                                setPackingBoxQty((p) => ({ ...p, [box.id]: '1' }))
                                                setIsDirty(true)
                                                void lookupAndCacheBarcode(bc)
                                                setTimeout(() => packingBarcodeRef.current?.focus(), 0)
                                              } else {
                                                // Ручной режим: переводим фокус на кол-во
                                                setTimeout(() => { packingQtyRef.current?.focus(); packingQtyRef.current?.select() }, 0)
                                              }
                                            }
                                          }}
                                          className={`w-full rounded-xl border pl-3 pr-9 py-2 text-sm outline-none ${(packingBoxBarcode[box.id] ?? '').length === 0 ? 'border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100' : /^\d{13}$/.test(packingBoxBarcode[box.id] ?? '') ? 'border-emerald-400 focus:ring-2 focus:ring-emerald-100' : 'border-red-300 focus:ring-2 focus:ring-red-100'}`}
                                        />
                                        <button type="button" title="Сканировать камерой"
                                          onClick={() => { setPackingCameraTargetBoxId(box.id); setPackingCameraError(null); setPackingCameraOpen(true) }}
                                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-500 transition-colors">
                                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2 7V5a2 2 0 0 1 2-2h2M2 17v2a2 2 0 0 0 2 2h2M22 7V5a2 2 0 0 0-2-2h-2M22 17v2a2 2 0 0 1-2 2h-2" />
                                            <rect x="6" y="8" width="12" height="8" rx="1.5" strokeLinecap="round" />
                                            <line x1="9" y1="11" x2="9" y2="13" strokeLinecap="round" />
                                            <line x1="11.5" y1="10" x2="11.5" y2="14" strokeLinecap="round" />
                                            <line x1="14" y1="11" x2="14" y2="13" strokeLinecap="round" />
                                          </svg>
                                        </button>
                                        </div>
                                        {(packingBoxBarcode[box.id] ?? '').length > 0 && !/^\d{13}$/.test(packingBoxBarcode[box.id] ?? '') && (
                                          <p className="col-span-full -mt-1 text-xs text-red-500 pl-1">{(packingBoxBarcode[box.id] ?? '').replace(/\D/g, '').length}/13 · только цифры EAN-13</p>
                                        )}
                                        <input
                                          ref={packingQtyRef}
                                          type="number"
                                          min={1}
                                          placeholder="Кол-во"
                                          value={packingBoxQty[box.id] ?? '1'}
                                          onChange={(e) => setPackingBoxQty((p) => ({ ...p, [box.id]: e.target.value }))}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              const bc = (packingBoxBarcode[box.id] ?? '').trim()
                                              const qty = parseInt(packingBoxQty[box.id] ?? '1') || 1
                                              if (!bc || !/^\d{13}$/.test(bc)) return
                                              const matched = items.find((it) => it.barcode === bc)
                                              const now = new Date().toISOString()
                                              setSupplies((prev) => prev.map((s) => s.id === supply.id ? { ...s, boxes: s.boxes.map((bx) => bx.id === box.id ? {
                                                ...bx, items: (() => {
                                                  const ex = bx.items.find((i) => i.barcode === bc)
                                                  if (ex) return bx.items.map((i) => i.barcode === bc ? { ...i, qty: i.qty + qty } : i)
                                                  return [...bx.items, { id: crypto.randomUUID(), _local: true, box_id: box.id, account_id: accountId, barcode: bc, item_id: matched?.id ?? null, product_name: matched?.product_name ?? null, qty, created_at: now }]
                                                })()
                                              } : bx) } : s))
                                              setPackingBoxBarcode((p) => ({ ...p, [box.id]: '' }))
                                              setPackingBoxQty((p) => ({ ...p, [box.id]: '1' }))
                                              setIsDirty(true)
                                              void lookupAndCacheBarcode(bc)
                                              setTimeout(() => packingBarcodeRef.current?.focus(), 0)
                                            }
                                          }}
                                          className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                        <button
                                          disabled={!/^\d{13}$/.test((packingBoxBarcode[box.id] ?? '').trim())}
                                          onClick={() => {
                                            const bc = (packingBoxBarcode[box.id] ?? '').trim()
                                            const qty = parseInt(packingBoxQty[box.id] ?? '1') || 1
                                            if (!bc) return
                                            const matched = items.find((it) => it.barcode === bc)
                                            const now = new Date().toISOString()
                                            setSupplies((prev) => prev.map((s) => s.id === supply.id ? { ...s, boxes: s.boxes.map((bx) => bx.id === box.id ? {
                                              ...bx, items: (() => {
                                                const ex = bx.items.find((i) => i.barcode === bc)
                                                if (ex) return bx.items.map((i) => i.barcode === bc ? { ...i, qty: i.qty + qty } : i)
                                                return [...bx.items, { id: crypto.randomUUID(), _local: true, box_id: box.id, account_id: accountId, barcode: bc, item_id: matched?.id ?? null, product_name: matched?.product_name ?? null, qty, created_at: now }]
                                              })()
                                            } : bx) } : s))
                                            setPackingBoxBarcode((p) => ({ ...p, [box.id]: '' }))
                                            setPackingBoxQty((p) => ({ ...p, [box.id]: '1' }))
                                            setIsDirty(true)
                                            void lookupAndCacheBarcode(bc)
                                            setTimeout(() => packingBarcodeRef.current?.focus(), 0)
                                          }}
                                          className="flex-shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
                                        >
                                          + Добавить
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })()}
                          </div>

                          {/* Подвал: добавить короб */}
                          {canManage && (
                            <div className="border-t border-slate-100 px-5 py-3">
                              <button
                                onClick={() => { setAddBoxNum(String(nextBoxNum)); setAddBoxModal({ supplyId: supply.id, nextNum: nextBoxNum }) }}
                                className="w-full rounded-xl border border-dashed border-blue-300 py-2.5 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                              >
                                + Добавить короб #{nextBoxNum}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Модалка: добавить коробa */}
                  {addBoxModal && (() => {
                    const addSup = supplies.find((s) => s.id === addBoxModal.supplyId)
                    if (!addSup) return null
                    return createPortal(
                      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" onClick={() => setAddBoxModal(null)}>
                        <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
                          <p className="text-base font-semibold text-slate-800">Новый короб</p>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-slate-500">Номер короба</label>
                            <input
                              type="number"
                              autoFocus
                              value={addBoxNum}
                              onChange={(e) => setAddBoxNum(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.form?.requestSubmit?.() }}
                              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setAddBoxModal(null)}
                              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const now = new Date().toISOString()
                                const newBoxes = [{
                                  id: crypto.randomUUID(),
                                  _local: true,
                                  supply_id: addBoxModal.supplyId,
                                  account_id: accountId,
                                  box_number: parseInt(addBoxNum) || addBoxModal.nextNum,
                                  status: 'open' as const,
                                  created_at: now,
                                  items: [],
                                }]
                                setSupplies((prev) => prev.map((s) => s.id === addBoxModal.supplyId ? { ...s, boxes: [...s.boxes, ...newBoxes] } : s))
                                setPackingOpenBoxId(newBoxes[0].id)
                                setIsDirty(true)
                                setAddBoxModal(null)
                                setAddBoxNum('')
                              }}
                              className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                            >
                              Добавить
                            </button>
                          </div>
                        </div>
                      </div>
                    , document.body)
                  })()}

                  {/* Модалка: подтверждение удаления короба */}
                  {deleteBoxConfirm && (() => {
                    const dSup = supplies.find((s) => s.id === deleteBoxConfirm.supplyId)
                    const dBox = dSup?.boxes.find((b) => b.id === deleteBoxConfirm.boxId)
                    if (!dBox) return null
                    return createPortal(
                      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" onClick={() => setDeleteBoxConfirm(null)}>
                        <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-red-100">
                              <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" /></svg>
                            </div>
                            <div>
                              <p className="font-semibold text-slate-800">Удалить короб #{dBox.box_number}?</p>
                              <p className="text-xs text-slate-400 mt-0.5">Это действие нельзя отменить</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setDeleteBoxConfirm(null)}
                              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!dBox._local) await deleteBox(dBox.id)
                                const remaining = dSup!.boxes.filter((b) => b.id !== dBox.id)
                                setSupplies((prev) => prev.map((s) => s.id === deleteBoxConfirm.supplyId ? { ...s, boxes: remaining } : s))
                                setPackingOpenBoxId(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
                                setDeleteBoxConfirm(null)
                              }}
                              className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white hover:bg-red-600 transition-colors"
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                      </div>
                    , document.body)
                  })()}

                  {/* Модалка: подтверждение удаления поставки */}
                  {deleteSupplyConfirm && (() => {
                    const dSup = supplies.find((s) => s.id === deleteSupplyConfirm)
                    if (!dSup) return null
                    const boxCount = dSup.boxes.length
                    return createPortal(
                      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" onClick={() => setDeleteSupplyConfirm(null)}>
                        <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-red-100">
                              <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" /></svg>
                            </div>
                            <div>
                              <p className="font-semibold text-slate-800">Удалить поставку «{dSup.warehouse_name}»?</p>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {boxCount > 0 ? `${boxCount} кор. и все позиции будут удалены. ` : ''}Это действие нельзя отменить.
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setDeleteSupplyConfirm(null)}
                              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!dSup._local) await deleteSupply(dSup.id)
                                setSupplies((prev) => prev.filter((s) => s.id !== dSup.id))
                                setDeleteSupplyConfirm(null)
                                setActiveSupplyId(null)
                              }}
                              className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white hover:bg-red-600 transition-colors"
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                      </div>
                    , document.body)
                  })()}

                  {/* Превью фото товара при наведении */}
                  {packingPhotoPreview && createPortal(
                    <div
                      className="pointer-events-none fixed z-[200] overflow-hidden rounded-2xl shadow-2xl ring-1 ring-slate-200"
                      style={{ left: packingPhotoPreview.x, top: packingPhotoPreview.y }}
                    >
                      <img src={packingPhotoPreview.url} alt="" className="h-96 w-72 object-cover" />
                    </div>
                  , document.body)}
              </>
            </div>
          )}

          {/* ПЕРЕДАЧА НА ЛОГИСТИКУ */}
          {viewStage === 'logistics' && (
            <div className="space-y-4">
              {/* Переключатель режима — только если поставок > 1 */}
              {/* ── Грид карточек рейсов ── */}
              <div className="flex flex-wrap gap-3 items-start">
                {tripSlots.map((slot) => {
                  const isEditing = editingSlotId === slot.slotId
                  return (
                  <div key={slot.slotId} className={`w-56 flex-shrink-0 rounded-2xl border bg-white shadow-sm overflow-hidden flex flex-col transition-all ${isEditing ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'}`}>
                    {/* Шапка карточки рейса */}
                    <div className={`px-3 pt-3 pb-3 ${isEditing ? 'bg-blue-50 border-b border-blue-100' : 'border-b border-slate-100'}`}>
                      {/* Строка: иконка грузовика + название рейса + крестик удаления */}
                      <div className="flex items-start gap-1.5 mb-1.5">
                        <svg className="h-4 w-4 flex-shrink-0 text-slate-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                        </svg>
                        <span className={`flex-1 text-sm font-bold leading-tight ${slot.tripId ? 'text-slate-900' : 'text-slate-400 italic'}`}>
                          {slot.tripId ? slot.tripLabel : 'Рейс не выбран'}
                        </span>
                        {tripSlots.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const removed = slot.slotId
                              setTripSlots((prev) => prev.filter((s) => s.slotId !== removed))
                              setSupplySlotMap((prev) => {
                                const next = { ...prev }
                                Object.keys(next).forEach((sid) => { if (next[sid] === removed) next[sid] = 'slot-0' })
                                return next
                              })
                              if (editingSlotId === removed) setEditingSlotId(null)
                              setIsDirty(true)
                            }}
                            className="h-5 w-5 flex-shrink-0 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-50 hover:text-red-400 transition-colors"
                          >
                            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
                          </button>
                        )}
                      </div>
                      {/* Строка: Сменить рейс + Галочка/Карандаш */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => { setTripPickerSlotId(slot.slotId); setIsTripPickerOpen(true) }}
                          className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-medium text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-colors"
                        >
                          {slot.tripId ? 'Сменить рейс' : 'Выбрать рейс'}
                        </button>
                        {/* Галочка (подтвердить) / Карандаш (редактировать) */}
                        {(() => {
                          const slotHasSupply = supplies.some((s) => (supplySlotMap[s.id] ?? tripSlots[0]?.slotId ?? 'slot-0') === slot.slotId)
                          const canConfirm = slotHasSupply
                          return (
                            <button
                              type="button"
                              disabled={isEditing && !canConfirm}
                              title={isEditing ? (canConfirm ? 'Подтвердить' : 'Добавьте хотя бы 1 поставку') : 'Редактировать поставки'}
                              onClick={() => { if (!isEditing || canConfirm) setEditingSlotId(isEditing ? null : slot.slotId) }}
                              className={`h-7 w-7 flex-shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
                                isEditing
                                  ? canConfirm
                                    ? 'border-emerald-400 bg-emerald-500 text-white hover:bg-emerald-600 cursor-pointer'
                                    : 'border-slate-200 bg-slate-100 text-slate-300 cursor-not-allowed'
                                  : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                              }`}
                            >
                              {isEditing ? (
                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                              )}
                            </button>
                          )
                        })()}
                      </div>
                    </div>
                    {/* Поставки внутри карточки */}
                    <div className="px-3 pb-3 pt-2 flex flex-col gap-2 flex-1">
                      {isLoadingSupplies ? (
                        <div className="text-xs text-slate-400 py-2">Загрузка…</div>
                      ) : supplies.length === 0 ? (
                        <div className="text-xs text-slate-400 italic py-2">Поставок нет</div>
                      ) : supplies.map((supply) => {
                        const assignedSlotId = supplySlotMap[supply.id] ?? tripSlots[0]?.slotId ?? 'slot-0'
                        const isHere = assignedSlotId !== 'none' && assignedSlotId === slot.slotId
                        const otherSlot = !isHere && assignedSlotId !== 'none' ? tripSlots.find((s) => s.slotId === assignedSlotId) : null
                        const units = supply.boxes.reduce((s, b) => s + b.items.reduce((ss, i) => ss + i.qty, 0), 0)
                        return (
                          <div
                            key={supply.id}
                            onClick={() => {
                              if (!isEditing) return
                              setSupplySlotMap((prev) => ({ ...prev, [supply.id]: isHere ? 'none' : slot.slotId }))
                              setIsDirty(true)
                            }}
                            className={`w-full rounded-xl border text-left px-2.5 py-2 transition-colors ${
                              isHere
                                ? 'border-blue-200 bg-blue-50'
                                : 'border-slate-200 bg-white opacity-50'
                            } ${
                              isEditing ? 'cursor-pointer hover:opacity-100 hover:border-blue-300' : 'cursor-default'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <div className={`h-3.5 w-3.5 flex-shrink-0 rounded border-2 flex items-center justify-center ${isHere ? 'border-blue-500 bg-blue-500' : 'border-slate-300 bg-white'}`}>
                                {isHere && <svg viewBox="0 0 12 12" className="h-2 w-2 text-white" fill="none" stroke="currentColor" strokeWidth="3"><path d="M2 6l3 3 5-5"/></svg>}
                              </div>
                              <span className={`text-xs font-semibold truncate leading-tight ${isHere ? 'text-slate-800' : 'text-slate-500'}`}>{supply.warehouse_name ?? '—'}</span>
                            </div>
                            <div className="text-[11px] text-slate-400 pl-5">{supply.boxes.length} кор. · {units} ед.</div>
                            {otherSlot && (
                              <div className="text-[10px] text-amber-500 pl-5 mt-0.5 truncate">{otherSlot.tripLabel || 'Другой рейс'}</div>
                            )}
                          </div>
                        )
                      })}

                    </div>
                  </div>
                )})}

                {/* Кнопка + Рейс (только если поставок > 1) */}
                {supplies.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const newSlotId = `slot-${Date.now()}`
                      setTripSlots((prev) => [...prev, { slotId: newSlotId, tripId: '', tripLabel: '' }])
                      setEditingSlotId(newSlotId)
                      setIsDirty(true)
                    }}
                    className="w-56 flex-shrink-0 h-32 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 text-sm font-medium text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                    + Рейс
                  </button>
                )}
              </div>
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
                    else if (viewStage === 'packaging') await handleSavePackagingAll()
                    else if (viewStage === 'packing') await handleSaveStageDraft()
                    else if (viewStage === 'logistics') {
                      setIsSavingDraft(true)
                      try {
                        // Сохранить trip_id батча (первый слот) — всегда
                        const firstTripId = tripSlots[0]?.tripId ?? ''
                        if (firstTripId) {
                          const updated = await updateBatch(batch.id, { trip_id: firstTripId })
                          setBatch((prev) => ({ ...prev, trip_id: firstTripId }))
                          onBatchUpdated({ ...updated, trip_id: firstTripId })
                        }
                        // Если этап уже завершён — синхронизировать поставки со страницей Логистики
                        if (batch.current_stage !== 'logistics' && batch.store_id) {
                          const freshSupplies = await fetchSupplies(batch.id)
                          const receptionDateStr = receptionCompletedDate
                            ? new Date(receptionCompletedDate).toISOString().slice(0, 10)
                            : ''
                          for (const supply of freshSupplies) {
                            const assignedRaw = supplySlotMap[supply.id]
                            if (assignedRaw === 'none') continue
                            const slotId = assignedRaw ?? tripSlots[0]?.slotId ?? 'slot-0'
                            const tripId = tripSlots.find((s) => s.slotId === slotId)?.tripId ?? ''
                            if (!tripId) continue
                            if (supply.trip_line_id) {
                              if (supply.trip_id !== tripId) {
                                await updateTripLineTripId(batch.account_id, supply.trip_line_id, tripId)
                                await updateSupply(supply.id, { trip_id: tripId })
                              }
                            } else {
                              const boxQty = supply.boxes.length
                              const unitsQty = supply.boxes.reduce((sum, box) => sum + box.items.reduce((s2, item) => s2 + item.qty, 0), 0)
                              const tripLineValues: TripLineFormValues = {
                                store_id: batch.store_id,
                                destination_warehouse: supply.warehouse_name,
                                box_qty: boxQty,
                                units_qty: unitsQty,
                                units_total: unitsQty,
                                arrived_box_qty: 0,
                                weight: 0,
                                planned_marketplace_delivery_date: '',
                                arrival_date: '',
                                reception_date: receptionDateStr,
                                shipped_date: '',
                                status: 'Ожидает отправки',
                                payment_status: 'Не оплачено',
                                comment: '',
                              }
                              const tripLine = onAddTripLine
                                ? await onAddTripLine(tripId, tripLineValues)
                                : await addTripLine(batch.account_id, tripId, tripLineValues)
                              await updateSupply(supply.id, { trip_id: tripId, trip_line_id: tripLine.id })
                              try { await setTripLineFulfillmentBatch(tripLine.id, batch.id) } catch {}
                            }
                          }
                          // Перезагрузить и перестроить визуальное состояние из БД
                          const refreshed = await fetchSupplies(batch.id)
                          setSupplies(refreshed)
                          rebuildSlotsFromSupplies(refreshed)
                        }
                        setIsDirty(false)
                      } catch (err) {
                        setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка при сохранении')
                      } finally {
                        setIsSavingDraft(false)
                      }
                    }
                  })()}
                  disabled={isSavingDraft || !isDirty}
                  className="flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40 transition-opacity">
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
              {(batch.current_stage === 'packaging' || batch.current_stage === 'marking' || batch.current_stage === 'packing' || batch.current_stage === 'logistics') && (
                <button type="button" onClick={() => setPendingAdvance(true)}
                  disabled={isSavingStage}
                  className="flex w-64 items-center justify-between gap-2 whitespace-nowrap rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {`Завершить ${STAGE_LABELS[batch.current_stage]}`}
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
                {`Этап «${STAGE_LABELS[batch.current_stage]}» будет завершён. Вернуться назад без участия администратора нельзя.`}
              </p>
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
              <button type="button"
                onClick={() => {
                  setPendingAdvance(false)
                  if (batch.current_stage === 'reception') void handleCompleteReception()
                  else if (batch.current_stage === 'otk') void handleAdvanceOtk()
                  else if (batch.current_stage === 'packaging') void handlePackagingAndAdvance()
                  else if (batch.current_stage === 'marking') void handleMarkingAndAdvance()
                  else if (batch.current_stage === 'packing' || batch.current_stage === 'logistics') void handleSaveStageAndAdvance()
                }}
                disabled={isSavingStage}
                className="flex-1 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {isSavingStage ? 'Сохранение…' : 'Да, завершить'}
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

        const FIELD_LABELS: Record<string, string> = { performer_name: 'Исполнитель', tariff: 'Тариф', qty: 'Годный', qty_defect: 'Брак', notes: 'Примечание', photo_urls: 'Фото' }
        const calcTotal = (vals: Record<string, unknown>) => (Number(vals.qty) || 0) + (Number(vals.qty_defect) || 0)
        const fmtVal = (key: string, val: unknown): string => {
          if (key === 'tariff') return otkTariffsList.find((t) => t.id === val)?.name ?? OTK_TARIFFS.find((t) => t.id === val)?.label ?? String(val)
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
              await addOtkLogHistory({ log_id: log.id, user_id: log.user_id, user_email: log.user_email, user_name: log.user_name ?? otkPerformers.find((p) => p.user_id === log.user_id)?.full_name ?? (log.user_id === userId ? userName : null) ?? null, action: 'created', old_values: null, new_values: { performer_name: log.performer_name, tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [] } })
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
        const stageLabels: Record<FulfillmentStage, string> = { reception: 'Приёмка', otk: 'ОТК', packaging: 'Упаковка', marking: 'Маркировка', packing: 'Короба', logistics: 'Логистика', done: 'Завершено' }
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
                {(['reception', 'otk', 'packaging', 'marking', 'packing', 'logistics'] as FulfillmentStage[]).map((key) => {
                  const isActive = otkHistoryStageTab === key
                  const isEnabled = key === 'reception' || key === 'otk' || key === 'packaging' || batch[({ otk: 'stage_otk', packaging: 'stage_packaging', marking: 'stage_marking', packing: 'stage_packing', logistics: 'stage_logistics' } as Record<string, keyof typeof batch>)[key] as keyof typeof batch] as boolean
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
                const pristineLogs = otkLogs.filter((l) => new Date(l.updated_at ?? l.created_at).getTime() - new Date(l.created_at).getTime() <= 1000)
                const modifiedLogs = otkLogs.filter((l) => new Date(l.updated_at ?? l.created_at).getTime() - new Date(l.created_at).getTime() > 1000)
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
                const FIELD_LABELS: Record<string, string> = { performer_name: 'Исполнитель', tariff: 'Тариф', qty: 'Годный', qty_defect: 'Брак', notes: 'Примечание', photo_urls: 'Фото' }
                const calcTotal = (vals: Record<string, unknown>) => (Number(vals.qty) || 0) + (Number(vals.qty_defect) || 0)
                const fmtVal = (key: string, val: unknown): string => {
                  if (key === 'tariff') return markingTariffsList.find((t) => t.id === val)?.name ?? MARKING_TARIFFS.find((t) => t.id === val)?.label ?? String(val)
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
                        await addMarkingLogHistory({ log_id: log.id, user_id: log.user_id, user_email: log.user_email, user_name: log.user_name ?? markingPerformers.find((p) => p.user_id === log.user_id)?.full_name ?? (log.user_id === userId ? userName : null) ?? null, action: 'created', old_values: null, new_values: { performer_name: log.performer_name, tariff: log.tariff, qty: log.qty, qty_defect: log.qty_defect, notes: log.notes ?? '', photo_urls: log.photo_urls ?? [] } })
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

                const pristineLogs = activeMarkingLogs.filter((l) => new Date(l.updated_at ?? l.created_at).getTime() - new Date(l.created_at).getTime() <= 1000)
                const modifiedLogs = activeMarkingLogs.filter((l) => new Date(l.updated_at ?? l.created_at).getTime() - new Date(l.created_at).getTime() > 1000)
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

      {/* ── Модалка камерного скана ШК ───────────────────────── */}
      {markingCameraOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex flex-col bg-black" onClick={(e) => e.stopPropagation()}>
          {/* Шапка */}
          <div className="flex items-center justify-between bg-black/80 px-5 py-3.5 safe-top">
            <span className="text-base font-semibold text-white">Сканирование штрихкода</span>
            <button
              type="button"
              onClick={() => { setMarkingCameraOpen(false); setMarkingEditScanTarget(null) }}
              className="rounded-xl px-3 py-1.5 text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            >
              Отмена
            </button>
          </div>

          {/* Видео или ошибка */}
          {markingCameraError ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-5 py-4">
                <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-5 w-5 shrink-0 text-amber-500">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-amber-800">{markingCameraError}</p>
              </div>
            </div>
          ) : (
            <div className="relative flex-1 overflow-hidden">
              <video ref={markingVideoRef} muted playsInline className="h-full w-full object-cover" />
              {/* прицел */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-32 w-64 rounded-xl border-2 border-blue-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
              </div>
              {!markingScannedBarcode && (
                <p className="absolute bottom-4 left-0 right-0 text-center text-xs text-white/50">
                  Наведите камеру на штрихкод
                </p>
              )}
            </div>
          )}

          {/* Нижняя панель */}
          <div className="bg-white px-4 py-4 space-y-3 safe-bottom">
            {markingScannedBarcode ? (() => {
              const foundItem = markingItemsRef.current.find((it) => it.barcode === markingScannedBarcode)
              return (
                <>
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-emerald-700 mb-0.5">Обнаружен штрихкод</p>
                      <p className="font-mono text-base font-semibold text-slate-800 break-all">{markingScannedBarcode}</p>
                      {foundItem && (
                        <p className="mt-0.5 text-xs text-slate-500 truncate">{foundItem.product_name ?? foundItem.barcode}</p>
                      )}
                      {!foundItem && (
                        <p className="mt-0.5 text-xs text-amber-600">Не найден в партии</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setMarkingScannedBarcode(null); setMarkingRescanKey((k) => k + 1) }}
                      className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      Сканировать снова
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const raw = markingScannedBarcode
                        if (markingEditScanTarget) {
                          if (markingEditScanTarget.type === 'log') {
                            const id = markingEditScanTarget.id
                            setMarkingEdits((p) => {
                              if (p[id]) return { ...p, [id]: { ...p[id], barcode: raw ?? '' } }
                              const source = markingLogs.find((l) => l.id === id)
                              return {
                                ...p,
                                [id]: {
                                  tariff: source?.tariff ?? markingTariff,
                                  qty: source?.qty ?? 0,
                                  qty_defect: source?.qty_defect ?? 0,
                                  notes: source?.notes ?? '',
                                  barcode: raw ?? '',
                                  consumable_id: source?.consumable_id ?? null,
                                  labels_qty: source?.labels_qty ?? null,
                                  labels_all: (source?.labels_qty ?? 0) > 0 && (source?.labels_qty ?? 0) === (source?.qty ?? 0),
                                },
                              }
                            })
                          } else {
                            const tid = markingEditScanTarget.tempId
                            setMarkingBuffer((p) => p.map((x) => x.tempId === tid ? { ...x, barcode: raw } : x))
                          }
                          setMarkingEditScanTarget(null)
                          setMarkingCameraOpen(false)
                        } else {
                          setMarkingBarcode(raw)
                          const found = markingItemsRef.current.find((it) => it.barcode === raw)
                          if (found) {
                            setMarkingItemId(found.id)
                            setMarkingItemName(found.product_name ?? found.barcode)
                          } else {
                            setMarkingItemId(null)
                            setMarkingItemName(null)
                          }
                          setMarkingCameraOpen(false)
                          setTimeout(() => {
                            document.querySelector<HTMLInputElement>('.marking-qty-input')?.focus()
                          }, 80)
                        }
                      }}
                      className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                    >
                      Сохранить
                    </button>
                  </div>
                </>
              )
            })() : (
              <div className="flex items-center justify-center py-2">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Ожидание сканирования...
                </div>
              </div>
            )}
          </div>
        </div>
      , document.body)}

      {/* Камера для этапа Коробов */}
      {packingCameraOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex flex-col bg-black" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between bg-black/80 px-5 py-3.5 safe-top">
            <span className="text-base font-semibold text-white">Сканирование штрихкода</span>
            <button type="button" onClick={() => { setPackingCameraOpen(false); setPackingCameraTargetBoxId(null) }}
              className="rounded-xl px-3 py-1.5 text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors">
              Отмена
            </button>
          </div>
          {packingCameraError ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-5 py-4">
                <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-5 w-5 shrink-0 text-amber-500"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" /></svg>
                <p className="text-sm text-amber-800">{packingCameraError}</p>
              </div>
            </div>
          ) : (
            <div className="relative flex-1 overflow-hidden">
              <video ref={packingVideoRef} muted playsInline className="h-full w-full object-cover" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-32 w-64 rounded-xl border-2 border-blue-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
              </div>
              {!packingCameraScanned && (
                <p className="absolute bottom-4 left-0 right-0 text-center text-xs text-white/50">Наведите камеру на штрихкод</p>
              )}
            </div>
          )}
          <div className="bg-white px-4 py-4 space-y-3 safe-bottom">
            {packingCameraScanned ? (() => {
              const boxId = packingCameraTargetBoxId
              const bc = packingCameraScanned
              const matched = items.find((it) => it.barcode === bc)
              return (
                <>
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" /></svg>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-emerald-700 mb-0.5">Обнаружен штрихкод</p>
                      <p className="font-mono text-base font-semibold text-slate-800 break-all">{bc}</p>
                      {matched ? <p className="mt-0.5 text-xs text-slate-500 truncate">{matched.product_name ?? matched.barcode}</p>
                        : <p className="mt-0.5 text-xs text-amber-600">Не найден в партии</p>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setPackingCameraScanned(null); setPackingCameraRescanKey((k) => k + 1) }}
                      className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                      Сканировать снова
                    </button>
                    <button type="button"
                      onClick={() => {
                        if (!boxId) return
                        setPackingBoxBarcode((p) => ({ ...p, [boxId]: bc }))
                        void lookupAndCacheBarcode(bc)
                        setPackingCameraOpen(false)
                        setPackingCameraTargetBoxId(null)
                        setTimeout(() => { packingQtyRef.current?.focus(); packingQtyRef.current?.select() }, 80)
                      }}
                      className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                      Использовать
                    </button>
                  </div>
                </>
              )
            })() : (
              <div className="flex items-center justify-center py-2">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Ожидание сканирования...
                </div>
              </div>
            )}
          </div>
        </div>
      , document.body)}
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
    stage_packaging: boolean
    stage_marking: boolean
    stage_packing: boolean
    stage_logistics: boolean
  }) => Promise<void>
}

const EditBatchModal = ({ batch, stores, onClose, onSave }: EditBatchModalProps) => {
  const [name, setName] = useState(batch.name)
  const [storeId, setStoreId] = useState(batch.store_id ?? '')
  const [stageOtk, setStageOtk] = useState(batch.stage_otk)
  const [stagePackaging, setStagePackaging] = useState(batch.stage_packaging)
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
      await onSave({ name: name.trim(), store_id: storeId || null, stage_otk: stageOtk, stage_packaging: stagePackaging, stage_marking: stageMarking, stage_packing: stagePacking, stage_logistics: stageLogistics })
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
              <StageToggle label="Упаковка" value={stagePackaging} onChange={setStagePackaging} />
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
    stage_packaging: boolean
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
      setCreateStoreError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
  const [stagePackaging, setStagePackaging] = useState(settings?.stage_packaging ?? false)
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
      await onSubmit({ name: name.trim(), store_id: effectiveStoreId || null, stage_otk: stageOtk, stage_packaging: stagePackaging, stage_marking: stageMarking, stage_packing: stagePacking, stage_logistics: stageLogistics }, closeOnlyRef.current)
    } catch (err) {
      setError((err instanceof Error ? err.message : (err as any)?.message) ?? 'Ошибка')
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
              <StageToggle label="Упаковка" value={stagePackaging} onChange={setStagePackaging} />
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
  const [stagePackaging, setStagePackaging] = useState(settings?.stage_packaging ?? true)
  const [stageMarking, setStageMarking] = useState(settings?.stage_marking ?? true)
  const [stagePacking, setStagePacking] = useState(settings?.stage_packing ?? true)
  const [stageLogistics, setStageLogistics] = useState(settings?.stage_logistics ?? true)
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    try { await onSave({ stage_otk: stageOtk, stage_packaging: stagePackaging, stage_marking: stageMarking, stage_packing: stagePacking, stage_logistics: stageLogistics }) }
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
          <Toggle label="Упаковка" value={stagePackaging} onChange={setStagePackaging} />
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
export const FulfillmentPage = ({ accountId, accountShortId, stores, trips, warehouses, onEditTripLine, onAddTripLine, onTripCreated, onStoreCreated, canManage = true, canOtkAssign = false, canStageJump = false, canPackingAutoAdd = false, canSupplyDeleteLocked = false, userId = '', userEmail = '', userName = '', initialBatchShortId, onBatchUrlConsumed }: FulfillmentPageProps) => {
  const navigate = useNavigate()
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
  const [outsourceModalBatch, setOutsourceModalBatch] = useState<FulfillmentBatch | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [archivedBatches, setArchivedBatches] = useState<FulfillmentBatch[]>([])
  const [isArchiveLoading, setIsArchiveLoading] = useState(false)
  const [isRestoring, setIsRestoring] = useState<string | null>(null)
  const [detailFromArchive, setDetailFromArchive] = useState(false)
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set())
  const [shareMenuPos, setShareMenuPos] = useState<{ left: number; anchorTop: number; anchorBottom: number; openUp: boolean; batchId: string; batchUrl: string } | null>(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [linkCopiedId, setLinkCopiedId] = useState<string | null>(null)
  const [batchSearch, setBatchSearch] = useState('')

  useEffect(() => {
    if (!shareMenuPos) return
    const close = () => setShareMenuPos(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [shareMenuPos])

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

  // Авто-открытие партии из URL (например /fulfillment/C-3/P-7)
  useEffect(() => {
    if (!initialBatchShortId || isLoading) return
    const target = batches.find((b) => b.short_id === initialBatchShortId)
    if (target) {
      onBatchUrlConsumed?.()
      void handleOpenDetail(target.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBatchShortId, isLoading])

  const handleOpenDetail = async (batchId: string) => {
    setIsOpeningDetail(batchId)
    try {
      const data = await fetchBatchWithItems(batchId)
      setDetailData(data)
      if (accountShortId != null && data.short_id != null) {
        navigate(`/fulfillment/C-${accountShortId}/P-${data.short_id}`, { replace: true })
      }
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

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true)
    try {
      const ids = [...selectedBatchIds]
      for (const id of ids) {
        const batch = batches.find((b) => b.id === id)
        await deleteBatch(id)
        if (batch) setArchivedBatches((prev) => [{ ...batch, deleted_at: new Date().toISOString() }, ...prev])
        setBatches((prev) => prev.filter((b) => b.id !== id))
      }
      setSelectedBatchIds(new Set())
      setBulkDeleteConfirm(false)
    } finally { setIsBulkDeleting(false) }
  }

  const handleRestore = async (batch: FulfillmentBatch) => {
    setIsRestoring(batch.id)
    try {
      const restored = await restoreBatch(batch.id)
      setArchivedBatches((prev) => prev.filter((b) => b.id !== batch.id))
      setBatches((prev) => [restored, ...prev])
    } finally { setIsRestoring(null) }
  }

  // Загрузить архив при переключении на вкладку
  const handleSelectArchiveTab = async () => {
    setFilterStatus('archived')
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

  const isArchiveTab = filterStatus === 'archived'
  const filtered = isArchiveTab
    ? archivedBatches
    : batches.filter((b) => filterStatus === 'all' || b.status === filterStatus)

  const filteredBatches = useMemo(() => {
    const q = batchSearch.trim().toLowerCase()
    if (!q) return filtered
    return filtered.filter((b) => {
      const store = stores.find((st) => st.id === b.store_id)
      const dateStr = new Date(b.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
      const haystack = [
        b.short_id != null ? `p-${b.short_id}` : '',
        b.name,
        store?.name ?? '',
        store?.supplier ?? '',
        store?.supplier_full ?? '',
        store?.store_code ?? '',
        dateStr,
        STATUS_LABELS[b.status] ?? '',
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [filtered, batchSearch, stores])

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
          batch={detailData} accountId={accountId} accountShortId={accountShortId} stores={stores} trips={trips} warehouses={warehouses}
          canManage={canManage} canOtkAssign={canOtkAssign} canStageJump={canStageJump} canPackingAutoAdd={canPackingAutoAdd} canSupplyDeleteLocked={canSupplyDeleteLocked} userId={userId} userEmail={userEmail} userName={userName}
          onClose={() => { setDetailData(null); setDetailFromArchive(false); navigate('/fulfillment', { replace: true }) }}
          onBatchUpdated={handleBatchUpdated} onItemsChanged={handleItemsChanged}
          onEditTripLine={onEditTripLine}
          onAddTripLine={onAddTripLine}
          onTripCreated={onTripCreated}
          zIndex={detailFromArchive ? 60 : 50}
        />
      )}
      {shareMenuPos && createPortal(
        <div
          style={{
            position: 'fixed',
            left: shareMenuPos.left,
            ...(shareMenuPos.openUp
              ? { bottom: window.innerHeight - shareMenuPos.anchorTop + 4 }
              : { top: shareMenuPos.anchorBottom + 4 }),
            zIndex: 9999,
          }}
          className="w-52 rounded-xl border border-slate-100 bg-white py-1 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <a href={`https://t.me/share/url?url=${encodeURIComponent(shareMenuPos.batchUrl)}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => setShareMenuPos(null)}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-500 shrink-0" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.932z"/>
            </svg>
            Telegram
          </a>
          <a href={`https://wa.me/?text=${encodeURIComponent(shareMenuPos.batchUrl)}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => setShareMenuPos(null)}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-green-500 shrink-0" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            WhatsApp
          </a>
          <div className="my-1 border-t border-slate-100" />
          <button type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(shareMenuPos.batchUrl); setLinkCopiedId(shareMenuPos.batchId); setTimeout(() => setLinkCopiedId(null), 2000) }}>
            {linkCopiedId === shareMenuPos.batchId ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            )}
            {linkCopiedId === shareMenuPos.batchId ? 'Скопировано!' : 'Копировать ссылку'}
          </button>
        </div>,
        document.body
      )}

      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setBulkDeleteConfirm(false)}>
          <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5">
              <p className="font-semibold text-slate-800">Переместить в архив?</p>
              <p className="mt-1 text-sm text-slate-500">{selectedBatchIds.size} {selectedBatchIds.size === 1 ? 'партия будет перемещена' : 'партий будет перемещено'} в архив. Все данные и история сохранятся. Вы сможете восстановить их из архива.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setBulkDeleteConfirm(false)} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50">Отмена</button>
              <button type="button" onClick={() => void handleBulkDelete()} disabled={isBulkDeleting}
                className="rounded-2xl bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                {isBulkDeleting ? 'Архивирование…' : 'В архив'}
              </button>
            </div>
          </div>
        </div>
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
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative flex min-w-[280px] items-center">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                value={batchSearch}
                onChange={(e) => setBatchSearch(e.target.value)}
                placeholder="Поиск по партиям…"
                className="h-9 w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-8 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
              {batchSearch && (
                <button type="button" onClick={() => setBatchSearch('')} className="absolute right-2.5 flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>
            {batchSearch && (
              <span className="whitespace-nowrap text-xs text-slate-400">
                {filteredBatches.length === 0 ? 'Не найдено' : `${filteredBatches.length} из ${filtered.length}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-0.5">
            {(['all', 'active', 'done', 'cancelled'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setFilterStatus(s)}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${filterStatus === s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {s === 'all' ? 'Все' : STATUS_LABELS[s]}
              </button>
            ))}
            <button type="button" onClick={() => void handleSelectArchiveTab()}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${isArchiveTab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Архив
            </button>
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
        ) : filteredBatches.length === 0 ? (
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
                <th className="w-8 px-3 py-3">
                  <input type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                    checked={filteredBatches.length > 0 && filteredBatches.every((b) => selectedBatchIds.has(b.id))}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedBatchIds(new Set(filteredBatches.map((b) => b.id)))
                      else setSelectedBatchIds(new Set())
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Партия</th>
                <th className="px-4 py-3 text-left">Магазин</th>
                <th className="px-4 py-3 text-left">Этап</th>
                <th className="px-4 py-3 text-left">Аутсорс</th>
                <th className="px-4 py-3 text-left">Статус</th>
                <th className="px-4 py-3 text-left">Создана</th>
                <th className="px-4 py-3 text-right">
                  <button
                    type="button"
                    title="Переместить выбранные в архив"
                    disabled={selectedBatchIds.size === 0}
                    onClick={() => setBulkDeleteConfirm(true)}
                    className={`inline-flex items-center justify-center rounded-lg p-1 transition ${selectedBatchIds.size > 0 ? 'text-red-500 hover:bg-red-50' : 'cursor-default text-slate-300'}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBatches.map((b) => {
                const s = stores.find((st) => st.id === b.store_id)
                const disc = b.otk_discrepancy
                const isSelected = selectedBatchIds.has(b.id)
                const isArchived = isArchiveTab
                return (
                  <tr key={b.id} onClick={() => {
                      if (shareMenuPos) { setShareMenuPos(null); return }
                      if (!isArchived && isOpeningDetail !== b.id) void handleOpenDetail(b.id)
                    }}
                    className={`transition-colors ${isArchived ? '' : 'cursor-pointer hover:bg-slate-50/80'} ${isSelected ? 'bg-blue-50/60' : ''}`}>
                    <td className="w-8 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0"
                        checked={isSelected}
                        onChange={(e) => {
                          setSelectedBatchIds((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(b.id)
                            else next.delete(b.id)
                            return next
                          })
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <div className="flex flex-col leading-tight">
                          {accountShortId != null && (
                            <span className="text-[10px] text-violet-400 font-semibold">C-{accountShortId}</span>
                          )}
                          <span>{b.short_id != null ? `P-${b.short_id}` : '—'}</span>
                        </div>
                        {accountShortId != null && b.short_id != null && (() => {
                          const batchUrl = `${window.location.origin}/fulfillment/C-${accountShortId}/P-${b.short_id}`
                          return (
                            <div>
                              <button type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (shareMenuPos?.batchId === b.id) { setShareMenuPos(null); return }
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                  const openUp = rect.bottom + 130 > window.innerHeight - 20
                                  setShareMenuPos({ left: rect.left, anchorTop: rect.top, anchorBottom: rect.bottom, openUp, batchId: b.id, batchUrl })
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded text-blue-400 hover:text-blue-600 hover:bg-blue-50">
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                  <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                                </svg>
                              </button>
                            </div>
                          )
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{b.name}</p>
                    </td>
                    <td className="px-4 py-3">
                      {s ? (
                        <div>
                          <p className="font-semibold text-slate-800">{s.supplier || s.name}</p>
                          {s.supplier && <p className="text-xs text-slate-400 leading-tight">{s.name}</p>}
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const miniLabels: Record<string, string> = { reception: 'Приём', otk: 'ОТК', packaging: 'Упак.', marking: 'Марк.', packing: 'Короба', logistics: 'Лог.' }
                        const stageQty: Record<string, number | undefined> = {
                          reception: b.qty_received_sum,
                          otk: b.qty_otk_sum,
                          packaging: b.qty_packaging_sum,
                          marking: b.qty_marked_sum,
                          packing: b.qty_packed_sum,
                          logistics: b.qty_packed_sum,
                        }
                        const stages = getEnabledStages(b).filter((s) => s !== 'done')
                        const currentIdx = b.status === 'done' || b.current_stage === 'done' ? stages.length : stages.indexOf(b.current_stage)
                        return (
                          <div className="flex items-start">
                            {stages.map((st, i) => {
                              const isPast = i < currentIdx
                              const isCurrent = i === currentIdx
                              const qty = stageQty[st]
                              const prevQty = i > 0 ? stageQty[stages[i - 1]] : undefined
                              const showQty = (isPast || isCurrent) && qty !== undefined && qty > 0
                              let qtyColor = 'text-slate-400'
                              if (showQty && prevQty !== undefined) {
                                if (qty === prevQty) qtyColor = 'text-emerald-600'
                                else if (qty > prevQty) qtyColor = 'text-blue-500'
                                else qtyColor = 'text-red-500'
                              } else if (showQty && i === 0) {
                                qtyColor = 'text-emerald-600'
                              }
                              return (
                                <div key={st} className="flex items-start">
                                  <div className="flex w-10 flex-col items-center">
                                    <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 ${isPast ? 'bg-emerald-500' : isCurrent ? 'bg-blue-500' : 'bg-slate-200'}`}>
                                      {isPast && (
                                        <svg className="w-2 h-2 text-white" viewBox="0 0 10 10" fill="none">
                                          <path d="M2 5l2.5 2.5 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                      )}
                                      {isCurrent && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                                    </div>
                                    <span className={`mt-0.5 text-[9px] leading-tight whitespace-nowrap ${isPast ? 'text-emerald-600' : isCurrent ? 'text-blue-600 font-semibold' : 'text-slate-400'}`}>
                                      {miniLabels[st] ?? st}
                                    </span>
                                    <span className={`text-[9px] font-semibold leading-tight h-3 ${showQty ? qtyColor : 'invisible'}`}>
                                      {showQty ? qty : '0'}
                                    </span>
                                  </div>
                                  {i < stages.length - 1 && (
                                    <div className={`mt-[7px] h-0.5 w-4 flex-shrink-0 -mx-1 ${i < currentIdx ? 'bg-emerald-300' : 'bg-slate-300'}`} />
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {!isArchived && (
                        <button
                          type="button"
                          title="Аутсорс-этапы"
                          onClick={() => setOutsourceModalBatch(b)}
                          className="rounded-xl p-1.5 text-violet-400 hover:bg-violet-50 hover:text-violet-600"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                          </svg>
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isArchived ? (
                        <span className="text-xs text-slate-400">
                          {b.deleted_at ? new Date(b.deleted_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}
                        </span>
                      ) : (
                        <div className="flex flex-col items-start">
                          {b.status === 'active' && (
                            <svg viewBox="0 0 24 24" className="h-4 w-4 text-orange-500" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                            </svg>
                          )}
                          {b.status === 'done' && (
                            <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                            </svg>
                          )}
                          {b.status === 'cancelled' && (
                            <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                            </svg>
                          )}
                          <span className={`mt-0.5 text-[10px] leading-tight font-medium ${
                            b.status === 'active' ? 'text-orange-600' : b.status === 'done' ? 'text-emerald-600' : 'text-slate-400'
                          }`}>{STATUS_LABELS[b.status]}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(b.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {isArchived ? (
                        <button type="button" disabled={isRestoring === b.id}
                          onClick={() => void handleRestore(b)}
                          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                          {isRestoring === b.id ? 'Восстановление…' : 'Восстановить'}
                        </button>
                      ) : canManage ? (
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => setEditTarget(b)}
                            className="rounded-xl p-1.5 text-slate-300 hover:bg-blue-50 hover:text-blue-400">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          <button type="button" onClick={() => setDeleteTarget(b)}
                            className="rounded-xl p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-400">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                            </svg>
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {outsourceModalBatch && (
        <OutsourceStagesModal
          open={!!outsourceModalBatch}
          batch={outsourceModalBatch}
          accountId={accountId}
          accountShortId={accountShortId}
          isOwner={canManage}
          onClose={() => setOutsourceModalBatch(null)}
        />
      )}

    </div>
  )
}

