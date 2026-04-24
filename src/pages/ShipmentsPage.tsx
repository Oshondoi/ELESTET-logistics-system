import { useEffect, useMemo, useState } from 'react'
import { TripTable } from '../components/trips/TripTable'
import { ColumnSettingsModal } from '../components/trips/ColumnSettingsModal'
import { TripLineFormModal } from '../components/trips/TripLineFormModal'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import type { Store, TripFormValues, TripLineFormValues, TripStatus, ShipmentStatus, PaymentStatus, TripWithLines } from '../types'
import {
  ColumnConfig,
  DEFAULT_COLUMN_CONFIG,
  fetchColumnConfig,
  upsertColumnConfig,
} from '../services/columnConfigService'

const pluralize = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10
  const mod100 = count % 100

  if (mod10 === 1 && mod100 !== 11) {
    return one
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few
  }

  return many
}

interface ShipmentsPageProps {
  trips: TripWithLines[]
  stores: Store[]
  carrierNames?: string[]
  warehouseNames?: string[]
  onOpenCreate: () => void
  onDeleteTrip: (tripId: string) => Promise<void>
  onDeleteTripLine: (tripId: string, lineId: string) => Promise<void>
  onChangeTripStatus: (tripId: string, status: TripStatus) => Promise<void>
  onChangeTripLineStatus: (tripId: string, lineId: string, status: ShipmentStatus) => Promise<void>
  onChangeTripLinePaymentStatus: (tripId: string, lineId: string, paymentStatus: PaymentStatus) => Promise<void>
  onEditTrip: (tripId: string, values: TripFormValues) => Promise<void>
  onEditTripLine: (tripId: string, lineId: string, values: TripLineFormValues) => Promise<void>
  onAddTripLine: (tripId: string, values: TripLineFormValues) => Promise<unknown>
  onAddInvoicePhoto: (tripId: string, lineId: string, file: File) => Promise<void>
  onReplaceInvoicePhoto: (tripId: string, lineId: string, index: number, file: File) => Promise<void>
  onRemoveInvoicePhoto: (tripId: string, lineId: string, index: number) => Promise<void>
  onUpdateTripCustomFields?: (tripId: string, fields: Record<string, unknown>) => Promise<void>
  onUpdateLineCustomFields?: (tripId: string, lineId: string, fields: Record<string, unknown>) => Promise<void>
  canManage?: boolean
  accountId?: string
}

export const ShipmentsPage = ({
  trips,
  stores,
  carrierNames,
  warehouseNames,
  onOpenCreate,
  onDeleteTrip,
  onDeleteTripLine,
  onChangeTripStatus,
  onChangeTripLineStatus,
  onChangeTripLinePaymentStatus,
  onEditTrip,
  onEditTripLine,
  onAddTripLine,
  onAddInvoicePhoto,
  onReplaceInvoicePhoto,
  onRemoveInvoicePhoto,
  onUpdateTripCustomFields,
  onUpdateLineCustomFields,
  canManage = true,
  accountId,
}: ShipmentsPageProps) => {
  const [expandAllTrips, setExpandAllTrips] = useState(() => localStorage.getItem('elestet-expand-all') === 'true')
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [anyTripExpanded, setAnyTripExpanded] = useState(false)
  const [focusMode, setFocusMode] = useState(() => localStorage.getItem('elestet-focus-mode') === 'true')
  const [hoverAddMode, setHoverAddMode] = useState(() => localStorage.getItem('elestet-hover-add-mode') !== 'false')
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false)
  const [addLineOpen, setAddLineOpen] = useState(false)
  const [tripConfig, setTripConfig] = useState<ColumnConfig>(DEFAULT_COLUMN_CONFIG)
  const [lineConfig, setLineConfig] = useState<ColumnConfig>(DEFAULT_COLUMN_CONFIG)
  const [selectedTripIds, setSelectedTripIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!accountId) return
    void fetchColumnConfig(accountId, 'trip').then(setTripConfig).catch(() => {})
    void fetchColumnConfig(accountId, 'trip_line').then(setLineConfig).catch(() => {})
  }, [accountId])
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  const lineToTripId = useMemo(() => {
    const next = new Map<string, string>()

    trips.forEach((trip) => {
      trip.lines.forEach((line) => {
        next.set(line.id, trip.id)
      })
    })

    return next
  }, [trips])

  useEffect(() => {
    const validTripIds = new Set(trips.map((trip) => trip.id))
    const validLineIds = new Set(trips.flatMap((trip) => trip.lines.map((line) => line.id)))

    setSelectedTripIds((current) => new Set([...current].filter((id) => validTripIds.has(id))))
    setSelectedLineIds((current) => new Set([...current].filter((id) => validLineIds.has(id))))
  }, [trips])

  const effectiveSelectedLineIds = useMemo(
    () => [...selectedLineIds].filter((lineId) => {
      const tripId = lineToTripId.get(lineId)
      return tripId ? !selectedTripIds.has(tripId) : false
    }),
    [lineToTripId, selectedLineIds, selectedTripIds],
  )

  const selectedTripCount = selectedTripIds.size
  const selectedLineCount = effectiveSelectedLineIds.length
  const hasBulkSelection = selectedTripCount > 0 || selectedLineCount > 0

  const bulkDeleteDescription = useMemo(() => {
    const parts: string[] = []

    if (selectedTripCount > 0) {
      parts.push(`${selectedTripCount} ${pluralize(selectedTripCount, 'рейс', 'рейса', 'рейсов')}`)
    }

    if (selectedLineCount > 0) {
      parts.push(`${selectedLineCount} ${pluralize(selectedLineCount, 'поставка', 'поставки', 'поставок')}`)
    }

    if (parts.length === 0) {
      return ''
    }

    return `Будут удалены ${parts.join(' и ')}. Это действие нельзя отменить.`
  }, [selectedLineCount, selectedTripCount])

  const toggleTripSelection = (tripId: string, checked: boolean) => {
    if (checked) {
      setSelectedLineIds(new Set())
    }

    setSelectedTripIds((current) => {
      const next = new Set(current)

      if (checked) {
        next.add(tripId)
      } else {
        next.delete(tripId)
      }

      return next
    })
  }

  const toggleLineSelection = (lineId: string, checked: boolean) => {
    if (checked) {
      setSelectedTripIds(new Set())
    }

    setSelectedLineIds((current) => {
      const next = new Set(current)

      if (checked) {
        next.add(lineId)
      } else {
        next.delete(lineId)
      }

      return next
    })
  }

  const toggleAllTripsSelection = (checked: boolean) => {
    if (checked) {
      setSelectedLineIds(new Set())
    }

    setSelectedTripIds(checked ? new Set(trips.map((trip) => trip.id)) : new Set())
  }

  const toggleTripLinesSelection = (tripId: string, checked: boolean) => {
    const lineIds = trips.find((trip) => trip.id === tripId)?.lines.map((line) => line.id) ?? []

    if (checked) {
      setSelectedTripIds(new Set())
    }

    setSelectedLineIds((current) => {
      const next = new Set(current)

      lineIds.forEach((lineId) => {
        if (checked) {
          next.add(lineId)
        } else {
          next.delete(lineId)
        }
      })

      return next
    })
  }

  const handleCloseBulkDelete = () => {
    if (isBulkDeleting) {
      return
    }

    setBulkDeleteError(null)
    setBulkDeleteOpen(false)
  }

  const handleConfirmBulkDelete = async () => {
    if (!hasBulkSelection) {
      return
    }

    setIsBulkDeleting(true)
    setBulkDeleteError(null)

    try {
      for (const lineId of effectiveSelectedLineIds) {
        const tripId = lineToTripId.get(lineId)

        if (tripId) {
          await onDeleteTripLine(tripId, lineId)
        }
      }

      for (const tripId of selectedTripIds) {
        await onDeleteTrip(tripId)
      }

      setSelectedTripIds(new Set())
      setSelectedLineIds(new Set())
      setBulkDeleteOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setBulkDeleteError(`Не удалось удалить выбранные элементы: ${message}`)
    } finally {
      setIsBulkDeleting(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <Card className="rounded-3xl p-2.5">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="grid gap-2.5 md:grid-cols-[minmax(220px,1fr)_auto_auto_minmax(170px,220px)] xl:flex">
              <div className="flex h-10 min-w-[220px] items-center rounded-2xl bg-slate-100 px-4 text-sm text-slate-400">
                Поиск по рейсу, перевозчику
              </div>
              <Button
                type="button"
                variant="secondary"
                className={[
                  '!h-10 !w-10 !min-w-10 !rounded-2xl !px-0',
                  anyTripExpanded
                    ? '!bg-[#E3EAF6] !text-slate-700 hover:!bg-[#E3EAF6]'
                    : '!text-slate-500',
                ].join(' ')}
                onClick={() => {
                  if (anyTripExpanded) {
                    // Есть открытые — закрываем все
                    setExpandAllTrips(false)
                    setCollapseSignal((n) => n + 1) // форсируем даже если expandAll уже false
                    localStorage.setItem('elestet-expand-all', 'false')
                  } else {
                    setExpandAllTrips(true)
                    localStorage.setItem('elestet-expand-all', 'true')
                  }
                }}
                aria-pressed={anyTripExpanded}
                aria-label={anyTripExpanded ? 'Свернуть все поставки' : 'Развернуть все поставки'}
                title={anyTripExpanded ? 'Свернуть все поставки' : 'Развернуть все поставки'}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-[15px] w-[15px] shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {anyTripExpanded ? (
                    <>
                      <path d="m7.5 11 4.5-4.5 4.5 4.5" />
                      <path d="m7.5 17 4.5-4.5 4.5 4.5" />
                    </>
                  ) : (
                    <>
                      <path d="m7.5 7 4.5 4.5 4.5-4.5" />
                      <path d="m7.5 13 4.5 4.5 4.5-4.5" />
                    </>
                  )}
                </svg>
              </Button>
              {/* Кнопка режима фокуса */}
              <Button
                type="button"
                variant="secondary"
                className={[
                  '!h-10 !w-10 !min-w-10 !rounded-2xl !px-0',
                  focusMode
                    ? '!bg-[#E3EAF6] !text-blue-600 hover:!bg-[#E3EAF6]'
                    : '!text-slate-400',
                ].join(' ')}
                onClick={() => setFocusMode((prev) => { const next = !prev; localStorage.setItem('elestet-focus-mode', String(next)); return next })}
                aria-pressed={focusMode}
                aria-label="Режим фокуса"
                title="Режим фокуса"
              >
                {/* Иконка фокуса: рамки в углах */}
                <svg
                  viewBox="0 0 24 24"
                  className="h-[15px] w-[15px] shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 8V5a1 1 0 0 1 1-1h3" />
                  <path d="M4 16v3a1 1 0 0 0 1 1h3" />
                  <path d="M20 8V5a1 1 0 0 0-1-1h-3" />
                  <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
              </Button>
              {/* Кнопка управления hover-добавлением поставки */}
              <Button
                type="button"
                variant="secondary"
                className={[
                  '!h-10 !w-10 !min-w-10 !rounded-2xl !px-0',
                  hoverAddMode
                    ? '!bg-[#E3EAF6] !text-blue-600 hover:!bg-[#E3EAF6]'
                    : '!text-slate-400',
                ].join(' ')}
                onClick={() => setHoverAddMode((prev) => { const next = !prev; localStorage.setItem('elestet-hover-add-mode', String(next)); return next })}
                aria-pressed={hoverAddMode}
                aria-label="Показывать «+ Добавить поставку» при наведении"
                title="Добавить поставку при наведении"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-[15px] w-[15px] shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 4l6.5 16 2.5-7 7-2.5L4 4z" />
                  <path d="M14 14l4 4" />
                  <path d="M19 17v4M17 19h4" />
                </svg>
              </Button>
              {/* Кнопка настройки колонок */}
              <Button
                type="button"
                variant="secondary"
                className="!h-10 !w-10 !min-w-10 !rounded-2xl !px-0 !text-slate-400"
                onClick={() => setColumnSettingsOpen(true)}
                aria-label="Настройка колонок"
                title="Настройка колонок"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-[15px] w-[15px] shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </Button>
              <div className="flex h-10 min-w-[170px] items-center justify-between rounded-2xl bg-slate-100 px-4 text-sm text-slate-600">
                <span>Все статусы</span>
                <span>▾</span>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              {canManage && (
                <Button variant="secondary" className="rounded-2xl px-4 py-2.5" onClick={() => setAddLineOpen(true)}>
                  + Создать поставку
                </Button>
              )}
              {canManage && (
                <Button className="rounded-2xl px-5 py-2.5 shadow-sm" onClick={onOpenCreate}>
                  + Создать рейс
                </Button>
              )}
            </div>
          </div>
        </Card>

        <TripTable
          trips={trips}
          stores={stores}
          carrierNames={carrierNames}
          warehouseNames={warehouseNames}
          expandAll={expandAllTrips}
          focusMode={focusMode}
          hoverAddMode={hoverAddMode}
          collapseAllSignal={collapseSignal}
          onExpandedCountChange={(count) => { setAnyTripExpanded(count > 0); if (count === 0) setExpandAllTrips(false) }}
          onDeleteTrip={onDeleteTrip}
          onDeleteTripLine={onDeleteTripLine}
          onChangeTripStatus={onChangeTripStatus}
          onChangeTripLineStatus={onChangeTripLineStatus}
          onChangeTripLinePaymentStatus={onChangeTripLinePaymentStatus}
          onEditTrip={onEditTrip}
          onEditTripLine={onEditTripLine}
          selectedTripIds={selectedTripIds}
          selectedLineIds={selectedLineIds}
          onToggleTripSelection={toggleTripSelection}
          onToggleLineSelection={toggleLineSelection}
          onToggleAllTripsSelection={toggleAllTripsSelection}
          onToggleTripLinesSelection={toggleTripLinesSelection}
          hasBulkSelection={hasBulkSelection}
          onBulkDelete={() => { setBulkDeleteError(null); setBulkDeleteOpen(true) }}
          onAddTripLine={onAddTripLine}
          onAddInvoicePhoto={onAddInvoicePhoto}
          onReplaceInvoicePhoto={onReplaceInvoicePhoto}
          onRemoveInvoicePhoto={onRemoveInvoicePhoto}
          canManage={canManage}
          tripConfig={tripConfig}
          lineConfig={lineConfig}
          onUpdateTripCustomFields={onUpdateTripCustomFields}
          onUpdateLineCustomFields={onUpdateLineCustomFields}
        />
      </div>

      <DeleteConfirmModal
        open={bulkDeleteOpen}
        title="Удалить выбранные элементы?"
        description={bulkDeleteDescription}
        isSubmitting={isBulkDeleting}
        error={bulkDeleteError}
        onClose={handleCloseBulkDelete}
        onConfirm={() => void handleConfirmBulkDelete()}
      />

      <ColumnSettingsModal
        open={columnSettingsOpen}
        onClose={() => setColumnSettingsOpen(false)}
        tripConfig={tripConfig}
        lineConfig={lineConfig}
        onSave={async (newTripConfig, newLineConfig) => {
          if (accountId) {
            await upsertColumnConfig(accountId, 'trip', newTripConfig)
            await upsertColumnConfig(accountId, 'trip_line', newLineConfig)
          }
          setTripConfig(newTripConfig)
          setLineConfig(newLineConfig)
        }}
      />

      <TripLineFormModal
        open={addLineOpen}
        stores={stores}
        warehouseNames={warehouseNames}
        trips={trips}
        onClose={() => setAddLineOpen(false)}
        onSubmit={async () => {}}
        onSubmitWithTrip={async (tripId, values) => {
          await onAddTripLine(tripId, values)
        }}
      />
    </>
  )
}
