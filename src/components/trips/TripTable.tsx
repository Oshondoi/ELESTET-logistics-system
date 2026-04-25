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
import { TripLineFormModal } from './TripLineFormModal'
import { TripFormModal } from './TripFormModal'

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

interface TripTableProps {
  trips: TripWithLines[]
  stores: Store[]
  carrierNames?: string[]
  warehouseNames?: string[]
  expandAll?: boolean
  onDeleteTrip: (tripId: string) => Promise<void>
  onDeleteTripLine: (tripId: string, lineId: string) => Promise<void>
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
  canManage?: boolean
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

export const TripTable = ({
  trips,
  stores,
  carrierNames,
  warehouseNames,
  expandAll = false,
  onDeleteTrip,
  onDeleteTripLine,
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
  canManage = true,
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
                {!tripHidden.has('comment') && <th className="px-3 py-2.5">Комментарий</th>}
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
                      <td className="max-w-[220px] px-3 py-3.5 text-slate-500">
                        {trip.comment || '—'}
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
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                            onClick={event => handleDeleteTripClick(trip, event)}
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
                                {!lineHidden.has('reception_date') && <th className="px-3 py-2 font-semibold">Дата приёма</th>}
                                {!lineHidden.has('status') && <th className="px-3 py-2 font-semibold">Статус</th>}
                                {!lineHidden.has('arrival_date') && <th className="px-3 py-2 font-semibold">Прибыл</th>}
                                {!lineHidden.has('shipped_date') && <th className="px-3 py-2 font-semibold">Отгружено</th>}
                                {!lineHidden.has('marketplace_delivery_date') && <th className="px-3 py-2 font-semibold">Дата МП</th>}
                                {!lineHidden.has('payment') && <th className="px-3 py-2 font-semibold">Оплата</th>}
                                {!lineHidden.has('comment') && <th className="px-3 py-2 font-semibold">Комментарий</th>}
                                {lineConfig.customCols.map((col) => (
                                  <th key={col.key} className="px-3 py-2 font-semibold">{col.name}</th>
                                ))}
                                <th className="w-20 px-3 py-2" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {trip.lines.length > 0 ? trip.lines.map((line) => (
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
                                        <span className="text-[11px] text-slate-400">Поставка {line.shipment_number}</span>
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
                                  {!lineHidden.has('reception_date') && (
                                    <td className="px-3 py-2.5 text-slate-500">{line.reception_date ? formatDate(line.reception_date) : '—'}</td>
                                  )}
                                  {!lineHidden.has('status') && (
                                    <td className={canManage ? 'px-3 py-2.5' : 'pointer-events-none px-3 py-2.5'}>
                                      <StatusDropdown<ShipmentStatus>
                                        value={line.status}
                                        options={shipmentStatuses}
                                        toneMap={lineTone}
                                        onChange={(status) => onChangeTripLineStatus(trip.id, line.id, status)}
                                      />
                                    </td>
                                  )}
                                  {!lineHidden.has('arrival_date') && (
                                    <td className="px-3 py-2.5 text-slate-500">{line.arrival_date ? formatDate(line.arrival_date) : '—'}</td>
                                  )}
                                  {!lineHidden.has('shipped_date') && (
                                    <td className="px-3 py-2.5 text-slate-500">{line.shipped_date ? formatDate(line.shipped_date) : '—'}</td>
                                  )}
                                  {!lineHidden.has('marketplace_delivery_date') && (
                                    <td className="px-3 py-2.5 text-slate-500">{line.planned_marketplace_delivery_date ? formatDate(line.planned_marketplace_delivery_date) : '—'}</td>
                                  )}
                                  {!lineHidden.has('payment') && (
                                    <td className="px-3 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <div className={canManage ? '' : 'pointer-events-none'}>
                                          <StatusDropdown<PaymentStatus>
                                            value={line.payment_status}
                                            options={paymentStatuses}
                                            toneMap={paymentTone}
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
                                    <td className="max-w-[220px] px-3 py-2.5 text-slate-400">
                                      {line.comment || '—'}
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
                                        <button
                                          type="button"
                                          aria-label={`Удалить поставку ${line.shipment_number}`}
                                          title={`Удалить поставку ${line.shipment_number}`}
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
