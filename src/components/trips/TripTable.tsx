import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn, formatDate, pluralRu } from '../../lib/utils'
import type { ColumnConfig, CustomColDef } from '../../services/columnConfigService'
import { DEFAULT_COLUMN_CONFIG } from '../../services/columnConfigService'
import type { PaymentStatus, ShipmentStatus, Store, TripFormValues, TripLineFormValues, TripLineWithStore, TripStatus, TripWithLines } from '../../types'
import { tripStatuses, shipmentStatuses, paymentStatuses } from '../../lib/constants'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { DeleteConfirmModal } from '../ui/DeleteConfirmModal'
import { StatusDropdown } from '../ui/StatusDropdown'
import { InvoicePhotoCell } from '../ui/InvoicePhotoCell'
import { TripLineStickerCell } from '../ui/TripLineStickerCell'
import { TripLineFormModal } from './TripLineFormModal'
import { TripFormModal } from './TripFormModal'

const TOOLTIP_MAX_W = 480
const TOOLTIP_OFFSET = 14

const WB_CARGO_LABELS: Record<number, { label: string; className: string }> = {
  1: { label: 'Короба', className: 'bg-blue-50 text-blue-600' },
  2: { label: 'Паллеты', className: 'bg-violet-50 text-violet-600' },
}

const CommentCell = ({ text, className }: { text: string | null | undefined; className?: string }) => {
  const [visible, setVisible] = useState(false)
  const iconRef = useRef<HTMLDivElement>(null)
  if (!text) return <span className={cn('text-slate-300', className)}>—</span>

  const getStyle = (): React.CSSProperties => {
    if (!iconRef.current) return { left: 0, top: 0, maxWidth: TOOLTIP_MAX_W }
    const rect = iconRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const estimatedH = Math.ceil(text.length / 60) * 18 + 20
    // Предпочтительно: ниже иконки, выровнено по левому краю
    let left = rect.left
    let top = rect.bottom + 6
    // Уходит за правый край — сдвигаем влево
    if (left + TOOLTIP_MAX_W > vw - 8) left = Math.max(8, vw - TOOLTIP_MAX_W - 8)
    // Уходит за нижний край — показываем выше иконки
    if (top + estimatedH > vh - 8) top = Math.max(8, rect.top - estimatedH - 6)
    return { left, top, maxWidth: TOOLTIP_MAX_W }
  }

  return (
    <div
      ref={iconRef}
      className={cn('inline-flex cursor-default text-slate-400 hover:text-slate-600', className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      {visible && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] rounded-xl bg-slate-900/95 px-3 py-2 text-xs leading-relaxed text-white shadow-xl"
          style={getStyle()}
        >
          {text}
        </div>,
        document.body,
      )}
    </div>
  )
}

const WbSupplyIdButton = ({
  wbSupplyId,
  onSave,
  onClear,
}: {
  wbSupplyId?: string | null
  onSave: (id: string) => Promise<void>
  onClear: () => Promise<void>
}) => {
  const [showInput, setShowInput] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [popPos, setPopPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showInput) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target)) return
      if ((target as Element)?.closest?.('[data-wb-popup]')) return
      setShowInput(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showInput])

  const open = () => {
    if (showInput) { setShowInput(false); return }
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const left = Math.min(rect.left, window.innerWidth - 248)
    setPopPos({ top: rect.bottom + 4, left: Math.max(8, left) })
    setInputValue(wbSupplyId ?? '')
    setShowInput(true)
  }

  const handleSave = async () => {
    const id = inputValue.trim()
    if (!id) return
    setIsSaving(true)
    try {
      await onSave(id)
      setShowInput(false)
    } catch {}
    finally { setIsSaving(false) }
  }

  const handleClear = async () => {
    setIsClearing(true)
    try {
      await onClear()
      setShowInput(false)
    } catch {}
    finally { setIsClearing(false) }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={wbSupplyId ? `ID поставки WB: ${wbSupplyId}` : 'Указать ID поставки WB'}
        onClick={open}
        className={`inline-flex h-5 items-center gap-0.5 rounded px-1 text-[10px] font-semibold transition ${
          wbSupplyId
            ? 'bg-purple-50 text-purple-500 hover:bg-purple-100'
            : 'bg-slate-100 text-slate-400 hover:bg-purple-50 hover:text-purple-400'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7.5" cy="15.5" r="5.5" />
          <path d="M21 2l-9.6 9.6" />
          <path d="M15.5 7.5 17 6l2 2-1.5 1.5" />
        </svg>
        WB
      </button>
      {showInput && createPortal(
        <div
          data-wb-popup
          style={{ position: 'fixed', top: popPos.top, left: popPos.left, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex w-60 flex-col gap-2 rounded-xl border border-slate-100 bg-white p-3 shadow-xl"
        >
          <div className="text-xs font-medium text-slate-600">ID поставки WB</div>
          <input
            autoFocus
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); if (e.key === 'Escape') setShowInput(false) }}
            placeholder="Например: 26598368"
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-purple-400"
          />
          <button
            type="button"
            disabled={!inputValue.trim() || isSaving}
            onClick={() => void handleSave()}
            className="w-full rounded-lg bg-purple-500 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-purple-600 disabled:opacity-40"
          >
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <div className="flex gap-1.5">
            {wbSupplyId && (
              <button
                type="button"
                disabled={isClearing}
                onClick={() => void handleClear()}
                className="flex-1 rounded-lg border border-rose-200 px-2 py-1.5 text-xs text-rose-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
              >
                {isClearing ? '...' : 'Удалить'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowInput(false)}
              className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-500 transition hover:bg-slate-50"
            >
              Отмена
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

type DeleteTarget =
  | {
      type: 'trip'
      tripId: string
      title: string
      description: string
    }
  | {
      type: 'line'
      tripId: string
      lineId: string
      title: string
      description: string
    }

const MpDateButton = ({
  date,
  hasWbSupplyId,
  onSave,
  onRefresh,
}: {
  date?: string | null
  hasWbSupplyId?: boolean
  onSave: (date: string | null) => Promise<void>
  onRefresh?: () => Promise<void>
}) => {
  const [showInput, setShowInput] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [popPos, setPopPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showInput) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target)) return
      if ((target as Element)?.closest?.('[data-mpdate-popup]')) return
      setShowInput(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showInput])

  const open = () => {
    if (showInput) { setShowInput(false); return }
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const left = Math.min(rect.left, window.innerWidth - 220)
    setPopPos({ top: rect.bottom + 4, left: Math.max(8, left) })
    setInputValue(date ?? '')
    setShowInput(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(inputValue || null)
      setShowInput(false)
    } catch {}
    finally { setIsSaving(false) }
  }

  const handleRefresh = async () => {
    if (!onRefresh) return
    setIsRefreshing(true)
    try { await onRefresh() } catch {}
    finally { setIsRefreshing(false) }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={date ? `Запланирован: ${date}` : 'Указать плановую дату поставки'}
        onClick={open}
        className="text-slate-500 hover:text-slate-700"
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      {hasWbSupplyId && onRefresh && (
        <button
          type="button"
          title="Получить даты из WB"
          disabled={isRefreshing}
          onClick={() => void handleRefresh()}
          className="text-slate-300 hover:text-slate-500 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className={cn('h-3 w-3', isRefreshing && 'animate-spin')} fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {showInput && createPortal(
        <div
          data-mpdate-popup
          style={{ position: 'fixed', top: popPos.top, left: popPos.left, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex w-52 flex-col gap-2 rounded-xl border border-slate-100 bg-white p-3 shadow-xl"
        >
          <div className="text-xs font-medium text-slate-600">Плановая дата поставки</div>
          <input
            autoFocus
            type="date"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); if (e.key === 'Escape') setShowInput(false) }}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-blue-400"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSave()}
              className="flex-1 rounded-lg bg-blue-500 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:opacity-40"
            >
              {isSaving ? '...' : 'Сохранить'}
            </button>
            {date && (
              <button
                type="button"
                onClick={() => { setInputValue(''); void handleSave() }}
                className="rounded-lg border border-rose-200 px-2 py-1.5 text-xs text-rose-500 transition hover:bg-rose-50"
              >
                ✕
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

interface TripTableProps {
  trips: TripWithLines[]
  stores: Store[]
  carrierNames?: string[]
  warehouseNames?: string[]
  expandAll?: boolean
  onDeleteTrip: (tripId: string) => Promise<void>
  onDeleteTripLine: (tripId: string, lineId: string) => Promise<void>
  archivedTripLines?: TripLineWithStore[]
  onRestoreArchivedTripLine?: (lineId: string) => Promise<void>
  onChangeTripStatus: (tripId: string, status: TripStatus) => Promise<void>
  onChangeTripLineStatus: (tripId: string, lineId: string, status: ShipmentStatus) => Promise<void>
  onChangeTripLinePaymentStatus: (tripId: string, lineId: string, paymentStatus: PaymentStatus) => Promise<void>
  onEditTrip: (tripId: string, values: TripFormValues) => Promise<void>
  onEditTripLine: (tripId: string, lineId: string, values: TripLineFormValues) => Promise<void>
  selectedTripIds: Set<string>
  selectedLineIds: Set<string>
  onToggleTripSelection: (tripId: string, checked: boolean) => void
  onToggleLineSelection: (lineId: string, checked: boolean) => void
  onToggleAllTripsSelection: (checked: boolean) => void
  onToggleTripLinesSelection: (tripId: string, checked: boolean) => void
  hasBulkSelection?: boolean
  onBulkDelete?: () => void
  onAddTripLine: (tripId: string, values: TripLineFormValues) => Promise<unknown>
  onAddInvoicePhoto: (tripId: string, lineId: string, file: File) => Promise<void>
  onReplaceInvoicePhoto: (tripId: string, lineId: string, index: number, file: File) => Promise<void>
  onRemoveInvoicePhoto: (tripId: string, lineId: string, index: number) => Promise<void>
  onAddStickerFile: (tripId: string, lineId: string, file: File) => Promise<void>
  onRemoveStickerFile: (tripId: string, lineId: string, index: number) => Promise<void>
  onAddCombinedStickerFile: (tripId: string, lineId: string, file: File) => Promise<void>
  onRemoveCombinedStickerFile: (tripId: string, lineId: string, index: number) => Promise<void>
  onFetchWbBarcodes: (tripId: string, lineId: string, wbSupplyId: string) => Promise<void>
  onSaveWbSupplyId: (tripId: string, lineId: string, wbSupplyId: string) => Promise<void>
  onRefreshCargoType?: (tripId: string, lineId: string, wbSupplyId: string) => Promise<void>
  isOwnerOrAdmin?: boolean
  onSaveMarketplaceDate?: (tripId: string, lineId: string, date: string | null) => Promise<void>
  onRefreshMarketplaceDate?: (tripId: string, lineId: string) => Promise<void>
  onUploadWbPass: (tripId: string, lineId: string, file: File) => Promise<void>
  onRemoveWbPass: (tripId: string, lineId: string, index: number) => Promise<void>
  canManage?: boolean
  canDeleteAny?: boolean
  canDeleteTrip?: boolean
  focusMode?: boolean
  hoverAddMode?: boolean
  onExpandedCountChange?: (count: number) => void
  collapseAllSignal?: number
  tripConfig?: ColumnConfig
  lineConfig?: ColumnConfig
  onUpdateTripCustomFields?: (tripId: string, fields: Record<string, unknown>) => Promise<void>
  onUpdateLineCustomFields?: (tripId: string, lineId: string, fields: Record<string, unknown>) => Promise<void>
}

const tripStatusTone = {
  'Формируется': 'neutral',
  'Отправлен': 'info',
  'Прибыл': 'success',
  'Завершён': 'neutral',
} as const

const lineTone = {
  'Формируется': 'neutral',
  'Ожидает отправки': 'warning',
  'В пути': 'info',
  'Прибыл': 'success',
  'Отгружен': 'neutral',
} as const

const paymentTone = {
  'Не оплачено': 'warning',
  'Частично оплачено': 'info',
  'Оплачено': 'success',
} as const

const paymentIconMap = {
  'Не оплачено': (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" />
    </svg>
  ),
  'Частично оплачено': (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  'Оплачено': (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

const ArchivedLinesSection = ({
  lines,
  onRestore,
  colCount,
  isOwnerOrAdmin = false,
}: {
  lines: TripLineWithStore[]
  onRestore?: (lineId: string) => Promise<void>
  colCount: number
  isOwnerOrAdmin?: boolean
}) => {
  const [expanded, setExpanded] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  return (
    <div className="mx-2 mb-1 rounded-lg border border-orange-100 bg-orange-50/60">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-orange-600 hover:text-orange-700"
        onClick={() => setExpanded((v) => !v)}
      >
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="m9 18 6-6-6-6" />
        </svg>
        Архив ({lines.length})
      </button>
      <div
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition: 'grid-template-rows 220ms ease',
        }}
      >
        <div className="overflow-hidden">
          <div className="overflow-x-auto border-t border-orange-100 pb-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-orange-400">
                <th className="px-3 py-1.5 text-left font-medium">Магазин</th>
                <th className="px-3 py-1.5 text-left font-medium">Поставка</th>
                <th className="px-3 py-1.5 text-left font-medium">Склад</th>
                <th className="px-3 py-1.5 text-left font-medium">Объём</th>
                <th className="px-3 py-1.5 text-left font-medium">Статус</th>
                <th className="px-3 py-1.5 text-left font-medium">Удаление</th>
                <th className="px-3 py-1.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const daysLeft = line.deleted_at
                  ? Math.max(0, 15 - Math.floor((Date.now() - new Date(line.deleted_at).getTime()) / 86400000))
                  : null
                const boxQty = line.box_qty ?? 0
                const unitsQty = line.units_qty ?? 0
                return (
                  <tr key={line.id} className="border-t border-orange-100/60">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-700">{line.store?.name ?? '—'}</div>
                      {line.store?.store_code && (
                        <div className="text-[10px] text-slate-400">{line.store.store_code}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      Поставка {line.shipment_number ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {line.destination_warehouse ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <div>{boxQty} {pluralRu(boxQty, 'короб', 'короба', 'коробов')}</div>
                      <div className="text-[10px] text-slate-400">{unitsQty} единиц</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{line.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      {daysLeft !== null && (
                        <div className="flex flex-col gap-0.5">
                          {isOwnerOrAdmin && line.deleted_at && (
                            <span className="text-[10px] text-slate-400">
                              {new Date(line.deleted_at).toLocaleDateString('ru-RU')}{' '}
                              {new Date(line.deleted_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          <span className={daysLeft <= 3 ? 'font-medium text-rose-500' : 'text-orange-500'}>
                            через {daysLeft} дн.
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {onRestore && (
                        <button
                          type="button"
                          disabled={restoringId === line.id}
                          className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                          onClick={async () => {
                            setRestoringId(line.id)
                            try { await onRestore(line.id) } finally { setRestoringId(null) }
                          }}
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                          </svg>
                          Восстановить
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    </div>
  )
}

export const TripTable = ({
  trips,
  stores,
  carrierNames,
  warehouseNames,
  expandAll = false,
  onDeleteTrip,
  onDeleteTripLine,
  archivedTripLines = [],
  onRestoreArchivedTripLine,
  onChangeTripStatus,
  onChangeTripLineStatus,
  onChangeTripLinePaymentStatus,
  onEditTrip,
  onEditTripLine,
  selectedTripIds,
  selectedLineIds,
  onToggleTripSelection,
  onToggleLineSelection,
  onToggleAllTripsSelection,
  onToggleTripLinesSelection,
  hasBulkSelection = false,
  onBulkDelete,
  onAddTripLine,
  onAddInvoicePhoto,
  onReplaceInvoicePhoto,
  onRemoveInvoicePhoto,
  onAddStickerFile,
  onRemoveStickerFile,
  onAddCombinedStickerFile,
  onRemoveCombinedStickerFile,
  onFetchWbBarcodes,
  onSaveWbSupplyId,
  onRefreshCargoType,
  onSaveMarketplaceDate,
  onRefreshMarketplaceDate,
  onUploadWbPass,
  onRemoveWbPass,
  canManage = true,
  canDeleteAny = false,
  canDeleteTrip = false,
  isOwnerOrAdmin = false,
  focusMode = false,
  hoverAddMode = true,
  onExpandedCountChange,
  collapseAllSignal = 0,
  tripConfig = DEFAULT_COLUMN_CONFIG,
  lineConfig = DEFAULT_COLUMN_CONFIG,
  onUpdateTripCustomFields,
  onUpdateLineCustomFields,
}: TripTableProps) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [refreshingCargoIds, setRefreshingCargoIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    onExpandedCountChange?.(expandedIds.size)
  }, [expandedIds, onExpandedCountChange])

  // Принудительное схлопывание — срабатывает даже когда expandAll уже false
  const prevCollapseSignalRef = useRef(collapseAllSignal)
  useEffect(() => {
    if (collapseAllSignal !== prevCollapseSignalRef.current) {
      prevCollapseSignalRef.current = collapseAllSignal
      setExpandedIds(new Set())
    }
  }, [collapseAllSignal])
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [addLineForTripId, setAddLineForTripId] = useState<string | null>(null)
  const [editingTrip, setEditingTrip] = useState<TripWithLines | null>(null)
  const [editingTripLine, setEditingTripLine] = useState<{ tripId: string; line: TripLineWithStore } | null>(null)
  const [hoveredTripId, setHoveredTripId] = useState<string | null>(null)
  const [editingCustomCell, setEditingCustomCell] = useState<{ entityId: string; colKey: string } | null>(null)
  const previousExpandAllRef = useRef(expandAll)

  const tripHidden = new Set(tripConfig.hiddenBuiltin)
  const lineHidden = new Set(lineConfig.hiddenBuiltin)
  const outerColCount =
    4 +
    (tripHidden.has('carrier') ? 0 : 1) +
    (tripHidden.has('departure_date') ? 0 : 1) +
    (tripHidden.has('lines_count') ? 0 : 1) +
    (tripHidden.has('status') ? 0 : 1) +
    (tripHidden.has('payment') ? 0 : 1) +
    (tripHidden.has('comment') ? 0 : 1) +
    tripConfig.customCols.length
  const innerColCount =
    3 +
    (lineHidden.has('shipment') ? 0 : 1) +
    (lineHidden.has('volume') ? 0 : 1) +
    (lineHidden.has('reception_date') ? 0 : 1) +
    (lineHidden.has('status') ? 0 : 1) +
    (lineHidden.has('arrival_date') ? 0 : 1) +
    (lineHidden.has('shipped_date') ? 0 : 1) +
    (lineHidden.has('marketplace_delivery_date') ? 0 : 1) +
    (lineHidden.has('payment') ? 0 : 1) +
    (lineHidden.has('comment') ? 0 : 1) +
    lineConfig.customCols.length

  const renderCustomCell = (
    entityId: string,
    customFields: Record<string, unknown>,
    col: CustomColDef,
    onSave: (fields: Record<string, unknown>) => void,
    canEdit: boolean,
  ) => {
    if (col.type === 'boolean') {
      return (
        <input
          type="checkbox"
          checked={Boolean(customFields[col.key])}
          disabled={!canEdit}
          onChange={(e) => {
            if (canEdit) onSave({ ...customFields, [col.key]: e.target.checked })
          }}
          className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-0 focus:ring-offset-0 disabled:cursor-default"
        />
      )
    }

    const isEditing = editingCustomCell?.entityId === entityId && editingCustomCell?.colKey === col.key

    if (isEditing && canEdit) {
      return (
        <input
          type={col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text'}
          autoFocus
          defaultValue={String(customFields[col.key] ?? '')}
          className="w-full min-w-[80px] rounded border border-blue-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
          onBlur={(e) => {
            const raw = e.target.value
            const val = col.type === 'number' ? (raw === '' ? null : Number(raw)) : raw || null
            onSave({ ...customFields, [col.key]: val })
            setEditingCustomCell(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditingCustomCell(null)
          }}
        />
      )
    }

    const val = customFields[col.key]
    const display = val != null && val !== '' ? String(val) : '—'
    return (
      <span
        className={cn('cursor-default', canEdit && 'cursor-text hover:text-blue-500')}
        onClick={
          canEdit
            ? (e) => {
                e.stopPropagation()
                setEditingCustomCell({ entityId, colKey: col.key })
              }
            : undefined
        }
      >
        {display}
      </span>
    )
  }

  useEffect(() => {
    setExpandedIds((current) => {
      const validIds = new Set(trips.map((trip) => trip.id))

      if (expandAll) {
        return validIds
      }

      if (previousExpandAllRef.current && !expandAll) {
        return new Set()
      }

      return new Set([...current].filter((id) => validIds.has(id)))
    })

    previousExpandAllRef.current = expandAll
  }, [expandAll, trips])

  const allTripsSelected = trips.length > 0 && trips.every((trip) => selectedTripIds.has(trip.id))

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleDeleteTripClick = (trip: TripWithLines, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()

    setDeleteError(null)
    setDeleteTarget({
      type: 'trip',
      tripId: trip.id,
      title: 'Удалить рейс?',
      description: (() => {
        const label = trip.trip_number ? `Рейс ${trip.trip_number}` : `Черновик-${trip.draft_number}`
        return trip.lines.length > 0
          ? `${label} и все вложенные поставки будут удалены. Это действие нельзя отменить.`
          : `${label} будет удалён. Это действие нельзя отменить.`
      })(),
    })
  }

  const handleDeleteTripLineClick = (
    tripId: string,
    lineId: string,
    shipmentNumber: number,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation()

    setDeleteError(null)
    setDeleteTarget({
      type: 'line',
      tripId,
      lineId,
      title: 'Удалить поставку?',
      description: `Поставка ${shipmentNumber} будет удалена. Это действие нельзя отменить.`,
    })
  }

  const handleCloseDeleteModal = () => {
    if (isDeleting) {
      return
    }

    setDeleteError(null)
    setDeleteTarget(null)
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) {
      return
    }

    setIsDeleting(true)
    setDeleteError(null)

    try {
      if (deleteTarget.type === 'trip') {
        await onDeleteTrip(deleteTarget.tripId)
      } else {
        await onDeleteTripLine(deleteTarget.tripId, deleteTarget.lineId)
      }

      setDeleteTarget(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setDeleteError(
        deleteTarget.type === 'trip'
          ? `Не удалось удалить рейс: ${message}`
          : `Не удалось удалить поставку: ${message}`,
      )
    } finally {
      setIsDeleting(false)
    }
  }

  if (trips.length === 0) {
    return (
      <>
        <Card className="overflow-hidden rounded-3xl">
          <div className="flex items-center justify-center py-16 text-sm text-slate-400">
            Рейсов пока нет. Создайте первый рейс.
          </div>
        </Card>

        <DeleteConfirmModal
          open={Boolean(deleteTarget)}
          title={deleteTarget?.title ?? ''}
          description={deleteTarget?.description ?? ''}
          isSubmitting={isDeleting}
          error={deleteError}
          onClose={handleCloseDeleteModal}
          onConfirm={() => void handleConfirmDelete()}
        />
      </>
    )
  }

  return (
    <>
      {/* Оверлей — размывает всё снаружи таблицы (топбар, сайдбар, карточки) при хавере рейса */}
      {focusMode && hoveredTripId !== null && createPortal(
        <div className="pointer-events-none fixed inset-0 z-10 bg-slate-900/60 transition-all duration-200" />,
        document.body,
      )}
      {/* При активном хавере таблица поднимается над оверлеем (z-20 > z-10) — сама таблица остаётся чёткой */}
      <div className={cn('transition-all duration-200', focusMode && hoveredTripId !== null ? 'relative z-20' : '')}>
      <Card className="overflow-hidden rounded-3xl">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-[13px]">
            <thead className="bg-slate-50/80 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
              <tr>
                <th className="w-[34px] px-2 py-2.5">
                  {canManage ? (
                    <div className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={allTripsSelected}
                        onChange={(event) => onToggleAllTripsSelection(event.target.checked)}
                        aria-label="Выбрать все рейсы"
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 focus:ring-offset-0"
                      />
                    </div>
                  ) : null}
                </th>
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5">Рейс</th>
                {!tripHidden.has('carrier') && <th className="px-3 py-2.5">Перевозчик</th>}
                {!tripHidden.has('departure_date') && <th className="px-3 py-2.5">Дата отправки</th>}
                {!tripHidden.has('lines_count') && <th className="px-3 py-2.5">Поставок</th>}
                {!tripHidden.has('status') && <th className="min-w-[160px] px-3 py-2.5">Статус</th>}
                {!tripHidden.has('payment') && <th className="min-w-[192px] px-3 py-2.5">Оплата</th>}
                {!tripHidden.has('comment') && <th className="w-10 px-3 py-2.5" title="Комментарий">Коммент.</th>}
                {tripConfig.customCols.map((col) => (
                  <th key={col.key} className="px-3 py-2.5">{col.name}</th>
                ))}
                <th className="px-3 py-2.5">
                  {canManage ? (
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        disabled={!hasBulkSelection}
                        aria-label="Редактировать выбранные"
                        title="Редактировать выбранные"
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-blue-50 hover:text-blue-500 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={!hasBulkSelection}
                        onClick={onBulkDelete}
                        aria-label="Удалить выбранные"
                        title="Удалить выбранные"
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:pointer-events-none disabled:opacity-30"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                          <path d="M9 4h6" />
                          <path d="M5 7h14" />
                          <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                          <path d="M10 11v4" />
                          <path d="M14 11v4" />
                        </svg>
                      </button>
                    </div>
                  ) : null}
                </th>
              </tr>
            </thead>
            {trips.map((trip) => {
                const isExpanded = expandedIds.has(trip.id)
                const areAllTripLinesSelected =
                  trip.lines.length > 0 && trip.lines.every((line) => selectedLineIds.has(line.id))

                // Derive payment status from lines (if any)
                const derivedPaymentStatus: PaymentStatus | null = trip.lines.length > 0
                  ? trip.lines.every(l => l.payment_status === 'Оплачено')
                    ? 'Оплачено'
                    : trip.lines.every(l => l.payment_status === 'Не оплачено')
                      ? 'Не оплачено'
                      : 'Частично оплачено'
                  : null
                return (
                  <tbody
                    key={trip.id}
                    className={cn(
                      'group/row divide-y divide-slate-100 transition-all duration-200',
                      focusMode && hoveredTripId !== null && hoveredTripId !== trip.id
                        ? 'opacity-10'
                        : '',
                    )}
                    onMouseEnter={() => focusMode && isExpanded && setHoveredTripId(trip.id)}
                    onMouseLeave={() => setHoveredTripId(null)}
                  >
                  {/* ── Строка рейса ── */}
                  <tr
                    className="cursor-pointer align-middle text-slate-700 transition-colors duration-150 hover:bg-slate-100"
                    onClick={() => { toggle(trip.id); if (focusMode && !isExpanded) setHoveredTripId(trip.id); else setHoveredTripId(null) }}
                  >
                    <td className="w-[34px] px-2 py-3.5" onClick={(event) => event.stopPropagation()}>
                      {canManage ? (
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={selectedTripIds.has(trip.id)}
                            onChange={(event) => onToggleTripSelection(trip.id, event.target.checked)}
                            aria-label={trip.trip_number ? `Выбрать рейс ${trip.trip_number}` : `Выбрать черновик-${trip.draft_number}`}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 focus:ring-offset-0"
                          />
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3.5 text-slate-400">
                      <svg
                        viewBox="0 0 24 24"
                        className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </td>
                    <td className="px-3 py-3.5">{trip.trip_number
                        ? <span className="font-bold text-slate-900">Рейс {trip.trip_number}</span>
                        : <span className="font-medium text-slate-400">Черновик-{trip.draft_number}</span>
                      }
                    </td>
                    {!tripHidden.has('carrier') && <td className="px-3 py-3.5">{trip.carrier}</td>}
                    {!tripHidden.has('departure_date') && (
                      <td className="px-3 py-3.5 text-slate-600">
                        {formatDate(trip.departure_date)}
                      </td>
                    )}
                    {!tripHidden.has('lines_count') && (
                      <td className="px-3 py-3.5 text-slate-500">
                        {trip.lines.length}
                      </td>
                    )}
                    {!tripHidden.has('status') && (
                      <td className="px-3 py-3.5">
                        <div className={canManage ? 'inline-block' : 'pointer-events-none inline-block'} onClick={(event) => event.stopPropagation()}>
                          <StatusDropdown<TripStatus>
                            value={trip.status}
                            options={tripStatuses}
                            toneMap={tripStatusTone}
                            onChange={(status) => onChangeTripStatus(trip.id, status)}
                          />
                        </div>
                        {(() => {
                          const dateMap: Partial<Record<TripStatus, string | null>> = {
                            'Формируется': trip.created_at,
                            'Отправлен': trip.departure_date,
                            'Прибыл': trip.arrived_at,
                            'Завершён': trip.finished_at,
                          }
                          const prefix = trip.status === 'Формируется' ? 'с ' : ''
                          const date = dateMap[trip.status]
                          return date ? (
                            <div className="mt-0.5 pl-2.5 text-[10px] text-slate-400">{prefix}{formatDate(date)}</div>
                          ) : null
                        })()}
                      </td>
                    )}
                    {!tripHidden.has('payment') && (
                      <td className="px-3 py-3.5">
                        {derivedPaymentStatus !== null
                          ? <Badge tone={paymentTone[derivedPaymentStatus]}>{derivedPaymentStatus}</Badge>
                          : <Badge tone={paymentTone[trip.payment_status]}>{trip.payment_status}</Badge>
                        }
                      </td>
                    )}
                    {!tripHidden.has('comment') && (
                      <td className="px-3 py-3.5">
                        <CommentCell text={trip.comment} />
                      </td>
                    )}
                    {tripConfig.customCols.map((col) => (
                      <td key={col.key} className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                        {renderCustomCell(
                          trip.id,
                          trip.custom_fields,
                          col,
                          (fields) => void onUpdateTripCustomFields?.(trip.id, fields),
                          canManage,
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-3.5" onClick={(event) => event.stopPropagation()}>
                      {canManage ? (
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            aria-label={trip.trip_number ? `Редактировать рейс ${trip.trip_number}` : `Редактировать черновик-${trip.draft_number}`}
                            title={trip.trip_number ? `Редактировать рейс ${trip.trip_number}` : `Редактировать черновик-${trip.draft_number}`}
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-blue-50 hover:text-blue-500"
                            onClick={(event) => { event.stopPropagation(); setEditingTrip(trip) }}
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            aria-label={trip.trip_number ? `Удалить рейс ${trip.trip_number}` : `Удалить черновик-${trip.draft_number}`}
                            title={trip.trip_number ? `Удалить рейс ${trip.trip_number}` : `Удалить черновик-${trip.draft_number}`}
                            className={`flex h-8 w-8 items-center justify-center rounded-xl transition ${
                              canDeleteTrip
                                ? 'text-slate-300 hover:bg-rose-50 hover:text-rose-500'
                                : 'cursor-not-allowed text-slate-200'
                            }`}
                            disabled={!canDeleteTrip}
                            onClick={event => canDeleteTrip && handleDeleteTripClick(trip, event)}
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                              <path d="M9 4h6" />
                              <path d="M5 7h14" />
                              <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                              <path d="M10 11v4" />
                              <path d="M14 11v4" />
                            </svg>
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>

                  {/* ── Строка кнопки ── peek при hover, фиксирована при открытии ── */}
                  {canManage ? (
                  <tr>
                    <td className="p-0" colSpan={outerColCount}>
                      <div
                        className={cn(
                          'overflow-hidden transition-all duration-200',
                          isExpanded ? 'h-[26px]' : hoverAddMode ? 'h-0 group-hover/row:h-[26px]' : 'h-0',
                        )}
                      >
                        <div className="flex items-center border-t border-slate-100 bg-slate-50/60">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setAddLineForTripId(trip.id) }}
                            className="flex h-full w-full items-center justify-center gap-1.5 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-600"
                          >
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                            Добавить поставку
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                  ) : null}

                  {/* ── Строки поставок внутри рейса ── */}
                  <tr>
                    <td className="p-0" colSpan={outerColCount}>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateRows: isExpanded ? '1fr' : '0fr',
                          transition: 'grid-template-rows 220ms ease',
                        }}
                      >
                        <div className="overflow-hidden">
                        <div className="border-t border-slate-100 bg-slate-50/70">
                          <table className="min-w-full text-[13px]">
                            <thead className="text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                              <tr>
                                <th className="w-[34px] px-2 py-2">
                                  {canManage ? (
                                    <div className="flex items-center justify-center">
                                      <input
                                        type="checkbox"
                                        checked={areAllTripLinesSelected}
                                        onChange={(event) => onToggleTripLinesSelection(trip.id, event.target.checked)}
                                        aria-label={trip.trip_number ? `Выбрать все поставки рейса ${trip.trip_number}` : `Выбрать все поставки черновика-${trip.draft_number}`}
                                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 focus:ring-offset-0"
                                      />
                                    </div>
                                  ) : null}
                                </th>
                                <th className="px-3 py-2 font-semibold">Магазин</th>
                                {!lineHidden.has('shipment') && <th className="px-3 py-2 font-semibold">Поставка</th>}
                                {!lineHidden.has('volume') && <th className="px-3 py-2 font-semibold">Объём</th>}
                                {!lineHidden.has('status') && <th className="px-3 py-2 font-semibold">Статус</th>}
                                {(['reception_date', 'transit_at', 'arrival_date', 'shipped_date', 'marketplace_delivery_date', 'wb_acceptance_date'] as const).some(k => !lineHidden.has(k)) && <th className="px-3 py-2 font-semibold">Даты</th>}
                                <th className="px-3 py-2 font-semibold">Стикеры</th>
                                {!lineHidden.has('payment') && <th className="px-3 py-2 font-semibold">Оплата</th>}
                                {!lineHidden.has('comment') && <th className="w-10 px-3 py-2 font-semibold" title="Комментарий">Коммент.</th>}
                                {lineConfig.customCols.map((col) => (
                                  <th key={col.key} className="px-3 py-2 font-semibold">{col.name}</th>
                                ))}
                                <th className="w-20 px-3 py-2" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {trip.lines.length > 0 ? [...trip.lines].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((line) => (
                                <tr
                                  key={line.id}
                                  className="align-middle text-slate-600"
                                >
                                  <td className="w-[34px] px-2 py-2.5">
                                    {canManage ? (
                                      <div className="flex items-center justify-center">
                                        <input
                                          type="checkbox"
                                          checked={selectedLineIds.has(line.id)}
                                          onChange={(event) => onToggleLineSelection(line.id, event.target.checked)}
                                          aria-label={`Выбрать поставку ${line.shipment_number}`}
                                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 focus:ring-offset-0"
                                        />
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex flex-col leading-tight">
                                      <span className="font-medium text-slate-800">
                                        {line.store?.name ?? '—'}
                                      </span>
                                      {line.store?.store_code && (
                                        <span className="text-[11px] text-slate-400">{line.store.store_code}</span>
                                      )}
                                    </div>
                                  </td>
                                  {!lineHidden.has('shipment') && (
                                    <td className="px-3 py-2.5">
                                      <div className="flex flex-col leading-tight">
                                        <span className="font-medium text-slate-800">{line.destination_warehouse}</span>
                                        <div className="mt-0.5 flex items-center gap-1">
                                          <span className="text-[11px] text-slate-400">Поставка {line.shipment_number}</span>
                                          {canManage && (
                                            <WbSupplyIdButton
                                              wbSupplyId={line.wb_supply_id}
                                              onSave={async (id) => {
                                                await onSaveWbSupplyId(trip.id, line.id, id)
                                                if (onRefreshCargoType) {
                                                  setRefreshingCargoIds((s) => new Set(s).add(line.id))
                                                  try {
                                                    await onRefreshCargoType(trip.id, line.id, id)
                                                  } finally {
                                                    setRefreshingCargoIds((s) => { const n = new Set(s); n.delete(line.id); return n })
                                                  }
                                                }
                                              }}
                                              onClear={() => onSaveWbSupplyId(trip.id, line.id, '')}
                                            />
                                          )}
                                          {line.wb_supply_id && line.wb_cargo_type != null && WB_CARGO_LABELS[line.wb_cargo_type]
                                            ? line.wb_cargo_type === 1 ? (
                                              // Короба
                                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                <title>Короба</title>
                                                <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                                                <path d="m3.3 7 8.7 5 8.7-5" />
                                                <path d="M12 22V12" />
                                              </svg>
                                            ) : (
                                              // Паллеты
                                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-blue-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                <title>Паллеты</title>
                                                <rect x="2" y="14" width="20" height="2" rx="1" />
                                                <rect x="4" y="17" width="4" height="3" rx="0.5" />
                                                <rect x="10" y="17" width="4" height="3" rx="0.5" />
                                                <rect x="16" y="17" width="4" height="3" rx="0.5" />
                                                <rect x="3" y="8" width="18" height="5" rx="1" />
                                                <rect x="3" y="4" width="18" height="3" rx="1" />
                                              </svg>
                                            )
                                            : <svg viewBox="0 0 24 24" className="invisible h-3.5 w-3.5 shrink-0" />}
                                          {onRefreshCargoType && (
                                            <button
                                              type="button"
                                              title="Обновить тип отгрузки"
                                              disabled={!line.wb_supply_id || refreshingCargoIds.has(line.id)}
                                              className={cn('text-slate-300 hover:text-slate-500 disabled:opacity-40', !line.wb_supply_id && 'invisible')}
                                              onClick={async () => {
                                                if (!line.wb_supply_id) return
                                                setRefreshingCargoIds((s) => new Set(s).add(line.id))
                                                try {
                                                  await onRefreshCargoType(trip.id, line.id, line.wb_supply_id!)
                                                } finally {
                                                  setRefreshingCargoIds((s) => { const n = new Set(s); n.delete(line.id); return n })
                                                }
                                              }}
                                            >
                                              <svg
                                                viewBox="0 0 24 24"
                                                className={cn('h-3 w-3', refreshingCargoIds.has(line.id) && 'animate-spin')}
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                              >
                                                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" />
                                              </svg>
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                  )}
                                  {!lineHidden.has('volume') && (
                                    <td className="px-3 py-2.5">
                                      <div className="flex flex-col leading-tight">
                                        <span className="font-medium text-slate-800">
                                          {line.box_qty} {pluralRu(line.box_qty, 'короб', 'короба', 'коробов')}
                                        </span>
                                        <span className="text-[11px] text-slate-400">
                                          {line.units_qty} {pluralRu(line.units_qty, 'единица', 'единицы', 'единиц')}
                                          {line.weight ? ` · ${line.weight} кг` : ''}
                                        </span>
                                      </div>
                                    </td>
                                  )}
                                  {!lineHidden.has('status') && (
                                    <td className={canManage ? 'px-3 py-2.5' : 'pointer-events-none px-3 py-2.5'}>
                                      <StatusDropdown<ShipmentStatus>
                                        value={line.status}
                                        options={shipmentStatuses}
                                        toneMap={lineTone}
                                        onChange={(status) => onChangeTripLineStatus(trip.id, line.id, status)}
                                      />
                                      {(() => {
                                        const dateMap: Partial<Record<ShipmentStatus, string | null>> = {
                                          'Формируется': line.created_at,
                                          'Ожидает отправки': line.waiting_at,
                                          'В пути': line.transit_at,
                                          'Прибыл': line.arrival_date,
                                          'Отгружен': line.shipped_date,
                                        }
                                        const date = dateMap[line.status]
                                        const prefix = (line.status === 'Формируется' || line.status === 'Ожидает отправки') ? 'с ' : ''
                                        return date ? (
                                          <div className="mt-0.5 pl-2.5 text-[10px] text-slate-400">{prefix}{formatDate(date)}</div>
                                        ) : null
                                      })()}
                                    </td>
                                  )}
                                  {(() => {
                                    // Фиксированный порядок дат — НИКОГДА не менять
                                    const DATE_ITEMS: { key: string; label: string; content: React.ReactNode }[] = [
                                      {
                                        key: 'reception_date',
                                        label: 'Приём',
                                        content: <span className="text-slate-500">{line.reception_date ? formatDate(line.reception_date) : '—'}</span>,
                                      },
                                      {
                                        key: 'transit_at',
                                        label: 'Отправлен',
                                        content: <span className="text-slate-500">{line.transit_at ? formatDate(line.transit_at) : '—'}</span>,
                                      },
                                      {
                                        key: 'arrival_date',
                                        label: 'Прибыл',
                                        content: <span className="text-slate-500">{line.arrival_date ? formatDate(line.arrival_date) : '—'}</span>,
                                      },
                                      {
                                        key: 'shipped_date',
                                        label: 'Отгружен',
                                        content: <span className="text-slate-500">{line.shipped_date ? formatDate(line.shipped_date) : '—'}</span>,
                                      },
                                      {
                                        key: 'marketplace_delivery_date',
                                        label: 'Запланирован',
                                        content: (
                                          <>
                                            <span className="text-slate-500">{line.planned_marketplace_delivery_date ? formatDate(line.planned_marketplace_delivery_date) : '—'}</span>
                                            {canManage && onSaveMarketplaceDate && (
                                              <div className="ml-0.5 flex items-center gap-0.5">
                                                <MpDateButton
                                                  date={line.planned_marketplace_delivery_date}
                                                  hasWbSupplyId={!!line.wb_supply_id}
                                                  onSave={(date) => onSaveMarketplaceDate(trip.id, line.id, date)}
                                                  onRefresh={onRefreshMarketplaceDate ? () => onRefreshMarketplaceDate(trip.id, line.id) : undefined}
                                                />
                                              </div>
                                            )}
                                          </>
                                        ),
                                      },
                                      {
                                        key: 'wb_acceptance_date',
                                        label: 'Приём ВБ',
                                        content: <span className="text-slate-500">{line.wb_acceptance_date ? formatDate(line.wb_acceptance_date) : '—'}</span>,
                                      },
                                    ];
                                    const visibleDates = DATE_ITEMS.filter(e => !lineHidden.has(e.key));
                                    if (visibleDates.length === 0) return null;
                                    const cols: typeof DATE_ITEMS[] = [];
                                    for (let i = 0; i < visibleDates.length; i += 3) cols.push(visibleDates.slice(i, i + 3));
                                    return (
                                      <td className="px-3 py-2.5">
                                        <div className="flex gap-4">
                                          {cols.map((col, ci) => (
                                            <div key={ci} className="flex w-[148px] shrink-0 flex-col gap-0.5">
                                              {col.map(entry => (
                                                <div key={entry.key} className="flex items-center gap-1.5">
                                                  <span className="w-[68px] shrink-0 text-[10px] text-slate-400">{entry.label}</span>
                                                  {entry.content}
                                                </div>
                                              ))}
                                            </div>
                                          ))}
                                        </div>
                                      </td>
                                    );
                                  })()}

                                  <td className="px-3 py-2.5">
                                    <TripLineStickerCell
                                      fileUrls={line.sticker_file_urls ?? []}
                                      wbSupplyId={line.wb_supply_id}
                                      passUrls={line.wb_pass_urls ?? []}
                                      combinedUrls={line.combined_sticker_urls ?? []}
                                      onAdd={canManage ? (file) => onAddStickerFile(trip.id, line.id, file) : undefined}
                                      onRemove={canManage ? (idx) => onRemoveStickerFile(trip.id, line.id, idx) : undefined}
                                      onAddCombined={canManage ? (file) => onAddCombinedStickerFile(trip.id, line.id, file) : undefined}
                                      onRemoveCombined={canManage ? (idx) => onRemoveCombinedStickerFile(trip.id, line.id, idx) : undefined}
                                      onFetchWbBarcodes={(wbId) => onFetchWbBarcodes(trip.id, line.id, wbId)}
                                      onUploadPass={canManage ? (file) => onUploadWbPass(trip.id, line.id, file) : undefined}
                                      onRemovePass={canManage ? (idx) => onRemoveWbPass(trip.id, line.id, idx) : undefined}
                                    />
                                  </td>
                                  {!lineHidden.has('payment') && (
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <div className={canManage ? '' : 'pointer-events-none'}>
                                          <StatusDropdown<PaymentStatus>
                                            value={line.payment_status}
                                            options={paymentStatuses}
                                            toneMap={paymentTone}
                                            iconMap={paymentIconMap}
                                            onChange={(ps) => onChangeTripLinePaymentStatus(trip.id, line.id, ps)}
                                          />
                                        </div>
                                        <InvoicePhotoCell
                                          photoUrls={line.invoice_photo_urls}
                                          onAdd={canManage ? (file) => onAddInvoicePhoto(trip.id, line.id, file) : undefined}
                                          onReplace={canManage ? (idx, file) => onReplaceInvoicePhoto(trip.id, line.id, idx, file) : undefined}
                                          onRemove={canManage ? (idx) => onRemoveInvoicePhoto(trip.id, line.id, idx) : undefined}
                                        />
                                      </div>
                                    </td>
                                  )}
                                  {!lineHidden.has('comment') && (
                                    <td className="px-3 py-2.5">
                                      <CommentCell text={line.comment} />
                                    </td>
                                  )}
                                  {lineConfig.customCols.map((col) => (
                                    <td key={col.key} className="px-3 py-2.5">
                                      {renderCustomCell(
                                        line.id,
                                        line.custom_fields,
                                        col,
                                        (fields) => void onUpdateLineCustomFields?.(trip.id, line.id, fields),
                                        canManage,
                                      )}
                                    </td>
                                  ))}
                                  <td className="px-3 py-2.5">
                                    {canManage ? (
                                      <div className="flex items-center justify-end gap-0.5">
                                        <button
                                          type="button"
                                          aria-label={`Редактировать поставку ${line.shipment_number}`}
                                          title={`Редактировать поставку ${line.shipment_number}`}
                                          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-blue-50 hover:text-blue-500"
                                          onClick={(event) => { event.stopPropagation(); setEditingTripLine({ tripId: trip.id, line }) }}
                                        >
                                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                                          </svg>
                                        </button>
                                        {(canDeleteAny || line.status === 'Формируется') && (
                                          <button
                                            type="button"
                                            aria-label={`Удалить поставку ${line.shipment_number}`}
                                            title={canDeleteAny || line.status === 'Формируется' ? `Удалить поставку ${line.shipment_number}` : 'Удаление доступно только для поставок в статусе «Формируется»'}
                                            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                                            onClick={event => handleDeleteTripLineClick(
                                              trip.id,
                                              line.id,
                                              line.shipment_number,
                                              event,
                                            )}
                                          >
                                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                                              <path d="M9 4h6" />
                                              <path d="M5 7h14" />
                                              <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                                              <path d="M10 11v4" />
                                              <path d="M14 11v4" />
                                            </svg>
                                          </button>
                                        )}
                                      </div>
                                    ) : null}
                                  </td>
                                </tr>
                              )) : (
                                <tr className="text-slate-400">
                                  <td className="py-3 text-center" colSpan={innerColCount}>
                                    Поставок нет.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                  {/* ── Архивные поставки рейса ── */}
                  {(() => {
                    const tripArchived = archivedTripLines.filter((l) => l.trip_id === trip.id)
                    if (tripArchived.length === 0) return null
                    return (
                      <tr>
                        <td colSpan={outerColCount} className="px-0 pb-2 pt-0">
                          <ArchivedLinesSection
                            lines={tripArchived}
                            onRestore={onRestoreArchivedTripLine}
                            colCount={outerColCount}
                            isOwnerOrAdmin={isOwnerOrAdmin}
                          />
                        </td>
                      </tr>
                    )
                  })()}
                  </tbody>
                )
              })}
          </table>
        </div>
      </Card>

      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title={deleteTarget?.title ?? ''}
        description={deleteTarget?.description ?? ''}
        isSubmitting={isDeleting}
        error={deleteError}
        onClose={handleCloseDeleteModal}
        onConfirm={() => void handleConfirmDelete()}
      />

      <TripLineFormModal
        open={addLineForTripId !== null}
        stores={stores}
        warehouseNames={warehouseNames}
        onClose={() => setAddLineForTripId(null)}
        onSubmit={async (values) => {
          if (!addLineForTripId) return
          await onAddTripLine(addLineForTripId, values)
          setAddLineForTripId(null)
        }}
      />

      <TripFormModal
        open={editingTrip !== null}
        carrierNames={carrierNames}
        onClose={() => setEditingTrip(null)}
        initialValues={editingTrip ? {
          carrier: editingTrip.carrier,
          comment: editingTrip.comment,
          departure_date: editingTrip.departure_date ?? '',
        } : undefined}
        onSubmit={async (values) => {
          if (!editingTrip) return
          await onEditTrip(editingTrip.id, values)
          setEditingTrip(null)
        }}
      />

      <TripLineFormModal
        open={editingTripLine !== null}
        stores={stores}
        warehouseNames={warehouseNames}
        onClose={() => setEditingTripLine(null)}
        initialValues={editingTripLine ? {
          store_id: editingTripLine.line.store_id,
          destination_warehouse: editingTripLine.line.destination_warehouse,
          box_qty: editingTripLine.line.box_qty,
          units_qty: editingTripLine.line.units_qty,
          units_total: editingTripLine.line.units_total,
          arrived_box_qty: editingTripLine.line.arrived_box_qty,
          weight: editingTripLine.line.weight ?? 0,
          planned_marketplace_delivery_date: editingTripLine.line.planned_marketplace_delivery_date ?? '',
          arrival_date: editingTripLine.line.arrival_date ?? '',
          reception_date: editingTripLine.line.reception_date ?? '',
          shipped_date: editingTripLine.line.shipped_date ?? '',
          status: editingTripLine.line.status,
          payment_status: editingTripLine.line.payment_status,
          comment: editingTripLine.line.comment,
        } : undefined}
        onSubmit={async (values) => {
          if (!editingTripLine) return
          await onEditTripLine(editingTripLine.tripId, editingTripLine.line.id, values)
          setEditingTripLine(null)
        }}
      />
      </div>
    </>
  )
}
