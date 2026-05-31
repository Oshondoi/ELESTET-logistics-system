import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  listShipments,
  fetchShipmentsFromSupabase,
  createShipmentInSupabase,
} from '../services/shipmentService'
import {
  listStores,
  fetchStoresFromSupabase,
  fetchArchivedStoresFromSupabase,
  createStoreInSupabase,
  updateStoreInSupabase,
  deleteStoreInSupabase,
  restoreStoreInSupabase,
} from '../services/storeService'
import {
  fetchTrips,
  createTrip,
  addTripLine as addTripLineInSupabase,
  deleteTrip as deleteTripInSupabase,
  deleteTripLine as deleteTripLineInSupabase,
  updateTripStatus as updateTripStatusInSupabase,
  updateTripLineStatus as updateTripLineStatusInSupabase,
  updateTripLinePaymentStatus as updateTripLinePaymentStatusInSupabase,
  updateTrip as updateTripInSupabase,
  updateTripLine as updateTripLineInSupabase,
  uploadInvoicePhoto as uploadInvoicePhotoInSupabase,
  updateTripLineInvoicePhotos as updateTripLineInvoicePhotosInSupabase,
  uploadStickerFile as uploadStickerFileInSupabase,
  updateTripLineStickerFiles as updateTripLineStickerFilesInSupabase,
  uploadCombinedStickerFile as uploadCombinedStickerFileInSupabase,
  updateTripLineCombinedStickerFiles as updateTripLineCombinedStickerFilesInSupabase,
  getWbSupplyStickers as getWbSupplyStickersInSupabase,
  getWbSupplyCargoType as getWbSupplyCargoTypeInSupabase,
  uploadWbPassFile as uploadWbPassFileInSupabase,
  updateTripLineWbPassUrl as updateTripLineWbPassUrlInSupabase,
  updateTripLineWbPassUrls as updateTripLineWbPassUrlsInSupabase,
  updateTripLineWbSupplyId as updateTripLineWbSupplyIdInSupabase,
  bulkArriveTripLines as bulkArriveTripLinesInSupabase,
  archiveTripLine as archiveTripLineInSupabase,
  restoreTripLine as restoreTripLineInSupabase,
  fetchArchivedTripLines as fetchArchivedTripLinesInSupabase,
  saveMarketplaceDate as saveMarketplaceDateInSupabase,
  getWbSupplyMarketplaceDate as getWbSupplyMarketplaceDateInSupabase,
  getWbSupplyPackageCodes as getWbSupplyPackageCodesInSupabase,
  updateTripLineTripId as updateTripLineTripIdInSupabase,
} from '../services/tripService'
import { fetchSupplyByTripLineId } from '../services/fulfillmentService'
import { downloadGoodsTemplate, downloadBoxesTemplate } from '../lib/wbExcelExport'
import {
  updateTripCustomFieldsInSupabase,
  updateLineCustomFieldsInSupabase,
} from '../services/columnConfigService'
import {
  fetchCarriers,
  createCarrier as createCarrierInSupabase,
  deleteCarrier as deleteCarrierInSupabase,
  updateCarrier as updateCarrierInSupabase,
  updateCarrierFull as updateCarrierFullInSupabase,
  fetchWarehouses,
  createWarehouse as createWarehouseInSupabase,
  deleteWarehouse as deleteWarehouseInSupabase,
  updateWarehouse as updateWarehouseInSupabase,
} from '../services/directoriesService'
import type { CarrierUpdateData } from '../services/directoriesService'
import {
  fetchStickers,
  createSticker as createStickerInSupabase,
  updateSticker as updateStickerInSupabase,
  deleteSticker as deleteStickerInSupabase,
  fetchBundles,
  createBundle as createBundleInSupabase,
  updateBundle as updateBundleInSupabase,
  deleteBundle as deleteBundleInSupabase,
} from '../services/stickerService'
import { openBarcodePrintPage } from '../lib/barcodeUtils'
import { buildWbBarcodesPdf } from '../lib/wbBarcodesPdf'
import type {
  Shipment,
  ShipmentFormValues,
  ShipmentStatus,
  TripLineFormValues,
  ShipmentStatusHistory,
  ShipmentWithStore,
  Store,
  StoreFormValues,
  PaymentStatus,
  TripFormValues,
  TripStatus,
  TripWithLines,
  Trip,
  TripLine,
  TripLineWithStore,
  Carrier,
  Warehouse,
  StickerTemplate,
  StickerFormValues,
  StickerBundle,
  StickerBundleItem,
} from '../types'

export const useAppData = (accountId: string | null) => {
  const [stores, setStores] = useState<Store[]>([])
  const [archivedStores, setArchivedStores] = useState<Store[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [trips, setTrips] = useState<TripWithLines[]>([])
  const [archivedTripLines, setArchivedTripLines] = useState<TripLineWithStore[]>([])
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [stickers, setStickers] = useState<StickerTemplate[]>([])
  const [bundles, setBundles] = useState<StickerBundle[]>([])
  const [statusHistory] = useState<ShipmentStatusHistory[]>([])
  const [isUsingSupabase, setIsUsingSupabase] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accountStores = useMemo(() => (accountId ? listStores(stores, accountId) : []), [stores, accountId])
  const shipmentViews = useMemo(
    () => (accountId ? listShipments(shipments, accountStores, accountId) : []),
    [shipments, accountStores, accountId],
  )

  const hydrateFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured || !accountId) {
      setStores([])
      setShipments([])
      setIsUsingSupabase(false)
      setError(!isSupabaseConfigured ? 'Supabase не настроен. Заполни `.env` и перезапусти приложение.' : null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const [supabaseStores, supabaseShipments] = await Promise.all([
        fetchStoresFromSupabase(accountId),
        fetchShipmentsFromSupabase(accountId),
      ])

      setStores(supabaseStores)
      setShipments(supabaseShipments)

      // Архив загружаем отдельно — ошибка (RPC не применена) не блокирует основные данные
      fetchArchivedStoresFromSupabase(accountId)
        .then((archived) => setArchivedStores(archived))
        .catch(() => { /* RPC ещё не применена — игнорируем */ })

      const [supabaseTrips, supabaseCarriers, supabaseWarehouses, supabaseStickers, supabaseBundles] = await Promise.all([
        fetchTrips(accountId, supabaseStores),
        fetchCarriers(accountId),
        fetchWarehouses(accountId),
        fetchStickers(accountId),
        fetchBundles(accountId),
      ])
      setTrips(supabaseTrips)
      setCarriers(supabaseCarriers)
      setWarehouses(supabaseWarehouses)

      // Загружаем архивные поставки
      fetchArchivedTripLinesInSupabase(accountId, supabaseStores)
        .then(setArchivedTripLines)
        .catch(() => { /* RPC ещё не применена */ })

      // Фоновая загрузка типа отгрузки: фетчим все уникальные supply ID при каждой загрузке,
      // чтобы данные всегда были актуальны (если пользователь поменял тип на ВБ)
      const allLinesWithSupply = supabaseTrips.flatMap((t) =>
        t.lines.filter((l) => l.wb_supply_id),
      )
      const uniqueSupplyIds = [...new Set(allLinesWithSupply.map((l) => l.wb_supply_id as string))]
      if (uniqueSupplyIds.length > 0 && accountId) {
        // Берём по одной строке на каждый уникальный supply ID для фетча
        const representativeLines = uniqueSupplyIds.map(
          (sid) => allLinesWithSupply.find((l) => l.wb_supply_id === sid)!,
        )
        Promise.all(
          representativeLines.map(async (l) => {
            const cargoType = await getWbSupplyCargoTypeInSupabase(accountId, l.id)
            if (cargoType !== null) {
              // Обновляем все строки с тем же wb_supply_id
              setTrips((prev) => prev.map((t) => ({
                ...t,
                lines: t.lines.map((ln) =>
                  ln.wb_supply_id === l.wb_supply_id ? { ...ln, wb_cargo_type: cargoType } : ln,
                ),
              })))
            }
          }),
        ).catch(() => {})
      }

      // stickers и bundles уже загружены в Promise.all выше
      setStickers(supabaseStickers)
      setBundles(supabaseBundles)

      setIsUsingSupabase(true)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Unknown Supabase error'
      setIsUsingSupabase(false)
      setError(`Supabase error: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void hydrateFromSupabase()
  }, [hydrateFromSupabase])

  // Держим актуальный stores в ref чтобы не пересоздавать подписку при смене stores
  const storesRef = useRef(stores)
  useEffect(() => { storesRef.current = stores }, [stores])

  // Realtime: перезагружать trips при любом изменении trip_lines (например из модалки фулфилмент)
  useEffect(() => {
    if (!isSupabaseConfigured || !accountId || !supabase) return
    const channel = supabase!
      .channel(`trip_lines_changes_${accountId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_lines', filter: `account_id=eq.${accountId}` },
        () => { fetchTrips(accountId, storesRef.current).then(setTrips).catch(() => {}) }
      )
      .subscribe()
    return () => { supabase!.removeChannel(channel) }
  }, [accountId])

  // Fallback: перезагружать trips при переключении на вкладку (если realtime не настроен)
  useEffect(() => {
    if (!isSupabaseConfigured || !accountId) return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchTrips(accountId, storesRef.current).then(setTrips).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [accountId])

  const addStore = async (values: StoreFormValues) => {
    if (!isSupabaseConfigured || !accountId) {
      throw new Error('Supabase не настроен')
    }

    const store = await createStoreInSupabase(values, accountId)
    setStores((current) => [store, ...current])
    return store
  }

  const appendStore = (store: Store) => {
    setStores((current) => [store, ...current])
  }

  const updateStore = async (storeId: string, values: StoreFormValues) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase не настроен')
    }

    const updated = await updateStoreInSupabase(storeId, values)
    setStores((current) => current.map((s) => (s.id === storeId ? updated : s)))
    return updated
  }

  const removeStore = async (storeId: string) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase не настроен')
    }

    await deleteStoreInSupabase(storeId)
    setStores((current) => current.filter((s) => s.id !== storeId))
    // Обновить archived список
    if (accountId) {
      const archived = await fetchArchivedStoresFromSupabase(accountId)
      setArchivedStores(archived)
    }
  }

  const restoreStore = async (storeId: string) => {
    if (!isSupabaseConfigured || !accountId) {
      throw new Error('Supabase не настроен')
    }

    await restoreStoreInSupabase(storeId)
    const [active, archived] = await Promise.all([
      fetchStoresFromSupabase(accountId),
      fetchArchivedStoresFromSupabase(accountId),
    ])
    setStores(active)
    setArchivedStores(archived)
  }

  const addShipment = async (values: ShipmentFormValues): Promise<ShipmentWithStore> => {
    if (!isSupabaseConfigured || !accountId) {
      throw new Error('Supabase не настроен')
    }

    const shipment = await createShipmentInSupabase(values, accountId)
    const shipmentView = {
      ...shipment,
      store: accountStores.find((store) => store.id === shipment.store_id),
    }
    setShipments((current) => [shipment, ...current])
    return shipmentView
  }

  const addTrip = async (values: TripFormValues) => {
    if (!isSupabaseConfigured || !accountId) {
      throw new Error('Supabase не настроен')
    }
    const trip = await createTrip(accountId, values)
    const tripWithLines = { ...trip, lines: [] }
    setTrips((current) => [tripWithLines, ...current])
    return trip
  }

  const appendTrip = (trip: TripWithLines) => {
    setTrips((current) => [trip, ...current])
  }

  const addTripLine = async (tripId: string, values: TripLineFormValues) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const line = await addTripLineInSupabase(accountId, tripId, values)
    const store = accountStores.find((s) => s.id === line.store_id)
    const lineWithStore = { ...line, store }
    setTrips((current) =>
      current.map((trip) =>
        trip.id === tripId ? { ...trip, lines: [...trip.lines, lineWithStore] } : trip,
      ),
    )
    return lineWithStore
  }

  const removeTrip = async (tripId: string) => {
    if (!isSupabaseConfigured || !accountId) {
      throw new Error('Supabase не настроен')
    }

    await deleteTripInSupabase(accountId, tripId)
    setTrips((current) => current.filter((trip) => trip.id !== tripId))
  }

  const removeTripLine = async (tripId: string, lineId: string) => {
    if (!isSupabaseConfigured || !accountId) {
      throw new Error('Supabase не настроен')
    }

    await archiveTripLineInSupabase(accountId, lineId)

    // Убираем из активных trips
    setTrips((current) => current.map((trip) => (
      trip.id === tripId
        ? { ...trip, lines: trip.lines.filter((line) => line.id !== lineId) }
        : trip
    )))

    // Обновляем архив (если RPC ещё не применена — игнорируем ошибку)
    fetchArchivedTripLinesInSupabase(accountId, stores)
      .then(setArchivedTripLines)
      .catch(() => {})
  }

  const refreshTrips = useCallback(async () => {
    if (!isSupabaseConfigured || !accountId) return
    const updated = await fetchTrips(accountId, storesRef.current)
    setTrips(updated)
  }, [accountId])

  const restoreArchivedTripLine = async (lineId: string) => {
    if (!isSupabaseConfigured || !accountId) {
      throw new Error('Supabase не настроен')
    }

    await restoreTripLineInSupabase(accountId, lineId)

    // Убираем из архива
    setArchivedTripLines((current) => current.filter((l) => l.id !== lineId))

    // Перегружаем trips чтобы поставка появилась в своём рейсе
    const updated = await fetchTrips(accountId, stores)
    setTrips(updated)
  }

  const changeTripStatus = async (tripId: string, status: TripStatus) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const updatedTrip = await updateTripStatusInSupabase(accountId, tripId, status)
    if (status === 'Прибыл') {
      const today = new Date().toISOString().slice(0, 10)
      await bulkArriveTripLinesInSupabase(accountId, tripId, today)
      setTrips((current) =>
        current.map((trip) =>
          trip.id === tripId
            ? {
                ...trip,
                status: updatedTrip.status,
                trip_number: updatedTrip.trip_number,
                lines: trip.lines.map((line) =>
                  line.status === 'Формируется' || line.status === 'Ожидает отправки' || line.status === 'В пути'
                    ? { ...line, status: 'Прибыл', arrival_date: line.arrival_date ?? today }
                    : line,
                ),
              }
            : trip,
        ),
      )
    } else {
      setTrips((current) =>
        current.map((trip) =>
          trip.id === tripId
            ? { ...trip, status: updatedTrip.status, trip_number: updatedTrip.trip_number }
            : trip,
        ),
      )
    }
  }

  const changeTripLineStatus = async (tripId: string, lineId: string, status: ShipmentStatus) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const currentLine = trips.flatMap((t) => t.lines).find((l) => l.id === lineId)
    const { waiting_at, transit_at, arrival_date, shipped_date } = await updateTripLineStatusInSupabase(
      accountId, lineId, status,
      currentLine?.waiting_at ?? null,
      currentLine?.transit_at ?? null,
      currentLine?.arrival_date ?? null,
      currentLine?.shipped_date ?? null,
    )
    setTrips((current) =>
      current.map((trip) =>
        trip.id === tripId
          ? { ...trip, lines: trip.lines.map((line) => line.id === lineId ? { ...line, status, waiting_at, transit_at, arrival_date, shipped_date } : line) }
          : trip,
      ),
    )
  }

  const changeTripLinePaymentStatus = async (tripId: string, lineId: string, payment_status: PaymentStatus) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    await updateTripLinePaymentStatusInSupabase(accountId, lineId, payment_status)
    setTrips((current) =>
      current.map((trip) =>
        trip.id === tripId
          ? { ...trip, lines: trip.lines.map((line) => line.id === lineId ? { ...line, payment_status } : line) }
          : trip,
      ),
    )
  }

  const editTrip = async (tripId: string, values: TripFormValues) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const updatedTrip = await updateTripInSupabase(accountId, tripId, values) as Trip
    setTrips((current) =>
      current.map((trip) =>
        trip.id === tripId
          ? { ...trip, carrier: updatedTrip.carrier, comment: updatedTrip.comment, departure_date: updatedTrip.departure_date }
          : trip,
      ),
    )
  }

  const editTripLine = async (tripId: string, lineId: string, values: TripLineFormValues, newTripId?: string) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const updatedLine = await updateTripLineInSupabase(accountId, lineId, values) as TripLine
    const store = accountStores.find((s) => s.id === updatedLine.store_id)
    if (newTripId && newTripId !== tripId) {
      // Переносим поставку в другой рейс
      await updateTripLineTripIdInSupabase(accountId, lineId, newTripId)
      setTrips((current) =>
        current.map((trip) => {
          if (trip.id === tripId) return { ...trip, lines: trip.lines.filter((l) => l.id !== lineId) }
          if (trip.id === newTripId) return { ...trip, lines: [...trip.lines, { ...updatedLine, store }] }
          return trip
        }),
      )
    } else {
      setTrips((current) =>
        current.map((trip) =>
          trip.id === tripId
            ? {
                ...trip,
                lines: trip.lines.map((line) =>
                  line.id === lineId ? { ...updatedLine, store } : line,
                ),
              }
            : trip,
        ),
      )
    }
  }

  const bulkMoveLinesToTrip = async (lineIds: string[], newTripId: string) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    // Собираем строки для переноса
    const movedSet = new Set(lineIds)
    const linesToMove: Array<{ lineId: string; oldTripId: string }> = []
    for (const trip of trips) {
      for (const line of trip.lines) {
        if (movedSet.has(line.id) && trip.id !== newTripId) {
          linesToMove.push({ lineId: line.id, oldTripId: trip.id })
        }
      }
    }
    if (linesToMove.length === 0) return
    // БД: меняем trip_id для каждой строки
    await Promise.all(linesToMove.map(({ lineId }) =>
      updateTripLineTripIdInSupabase(accountId, lineId, newTripId),
    ))
    // State: переносим строки между рейсами
    const movedLineIds = new Set(linesToMove.map((m) => m.lineId))
    setTrips((current) => {
      const movedLines = current.flatMap((t) => t.lines).filter((l) => movedLineIds.has(l.id))
      return current.map((trip) => {
        if (trip.id === newTripId) {
          const existingIds = new Set(trip.lines.map((l) => l.id))
          return { ...trip, lines: [...trip.lines, ...movedLines.filter((l) => !existingIds.has(l.id))] }
        }
        if (trip.lines.some((l) => movedLineIds.has(l.id))) {
          return { ...trip, lines: trip.lines.filter((l) => !movedLineIds.has(l.id)) }
        }
        return trip
      })
    })
  }

  const updateTripCustomFields = async (tripId: string, fields: Record<string, unknown>) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    await updateTripCustomFieldsInSupabase(tripId, fields)
    setTrips((current) =>
      current.map((trip) => (trip.id === tripId ? { ...trip, custom_fields: fields } : trip)),
    )
  }

  const updateLineCustomFields = async (tripId: string, lineId: string, fields: Record<string, unknown>) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    await updateLineCustomFieldsInSupabase(lineId, fields)
    setTrips((current) =>
      current.map((trip) =>
        trip.id === tripId
          ? {
              ...trip,
              lines: trip.lines.map((line) =>
                line.id === lineId ? { ...line, custom_fields: fields } : line,
              ),
            }
          : trip,
      ),
    )
  }

  const addCarrier = async (name: string): Promise<Carrier> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const carrier = await createCarrierInSupabase(accountId, name)
    setCarriers((current) => [...current, carrier].sort((a, b) => a.name.localeCompare(b.name)))
    return carrier
  }

  const removeCarrier = async (carrierId: string): Promise<void> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    await deleteCarrierInSupabase(accountId, carrierId)
    setCarriers((current) => current.filter((c) => c.id !== carrierId))
  }

  const renameCarrier = async (carrierId: string, name: string): Promise<void> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const updated = await updateCarrierInSupabase(accountId, carrierId, name)
    setCarriers((current) => current.map((c) => c.id === carrierId ? updated : c).sort((a, b) => a.name.localeCompare(b.name)))
  }

  const updateCarrier = async (carrierId: string, data: CarrierUpdateData): Promise<void> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const updated = await updateCarrierFullInSupabase(accountId, carrierId, data)
    setCarriers((current) => current.map((c) => c.id === carrierId ? updated : c).sort((a, b) => a.name.localeCompare(b.name)))
  }

  const addWarehouse = async (name: string): Promise<Warehouse> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const warehouse = await createWarehouseInSupabase(accountId, name)
    setWarehouses((current) => [...current, warehouse].sort((a, b) => a.name.localeCompare(b.name)))
    return warehouse
  }

  const removeWarehouse = async (warehouseId: string): Promise<void> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    await deleteWarehouseInSupabase(accountId, warehouseId)
    setWarehouses((current) => current.filter((w) => w.id !== warehouseId))
  }

  const renameWarehouse = async (warehouseId: string, name: string): Promise<void> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const updated = await updateWarehouseInSupabase(accountId, warehouseId, name)
    setWarehouses((current) => current.map((w) => w.id === warehouseId ? updated : w).sort((a, b) => a.name.localeCompare(b.name)))
  }

  const addSticker = async (values: StickerFormValues): Promise<StickerTemplate> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const sticker = await createStickerInSupabase(accountId, values)
    setStickers((current) => [sticker, ...current])
    return sticker
  }

  const editSticker = async (stickerId: string, values: StickerFormValues): Promise<void> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const updated = await updateStickerInSupabase(accountId, stickerId, values)
    setStickers((current) => current.map((s) => s.id === stickerId ? updated : s))
  }

  const removeSticker = async (stickerId: string): Promise<void> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    await deleteStickerInSupabase(accountId, stickerId)
    setStickers((current) => current.filter((s) => s.id !== stickerId))
  }

  const addBundle = async (name: string, items: StickerBundleItem[]): Promise<StickerBundle> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const bundle = await createBundleInSupabase(accountId, name, items)
    setBundles((current) => [bundle, ...current])
    return bundle
  }

  const editBundle = async (bundleId: string, name: string, items: StickerBundleItem[]): Promise<StickerBundle> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const updated = await updateBundleInSupabase(accountId, bundleId, name, items)
    setBundles((current) => current.map((b) => b.id === bundleId ? updated : b))
    return updated
  }

  const removeBundle = async (bundleId: string): Promise<void> => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    await deleteBundleInSupabase(accountId, bundleId)
    setBundles((current) => current.filter((b) => b.id !== bundleId))
  }

  const getLineUrls = (tripId: string, lineId: string): string[] => {
    const trip = trips.find((t) => t.id === tripId)
    return trip?.lines.find((l) => l.id === lineId)?.invoice_photo_urls ?? []
  }

  const applyUrls = (tripId: string, lineId: string, urls: string[]) => {
    setTrips((current) =>
      current.map((t) =>
        t.id === tripId
          ? { ...t, lines: t.lines.map((l) => l.id === lineId ? { ...l, invoice_photo_urls: urls } : l) }
          : t,
      ),
    )
  }

  const addInvoicePhoto = async (tripId: string, lineId: string, file: File) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const url = await uploadInvoicePhotoInSupabase(accountId, lineId, file)
    const newUrls = [...getLineUrls(tripId, lineId), url]
    await updateTripLineInvoicePhotosInSupabase(accountId, lineId, newUrls)
    applyUrls(tripId, lineId, newUrls)
  }

  const replaceInvoicePhoto = async (tripId: string, lineId: string, index: number, file: File) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const url = await uploadInvoicePhotoInSupabase(accountId, lineId, file)
    const newUrls = [...getLineUrls(tripId, lineId)]
    newUrls[index] = url
    await updateTripLineInvoicePhotosInSupabase(accountId, lineId, newUrls)
    applyUrls(tripId, lineId, newUrls)
  }

  const removeInvoicePhoto = async (tripId: string, lineId: string, index: number) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const newUrls = getLineUrls(tripId, lineId).filter((_, i) => i !== index)
    await updateTripLineInvoicePhotosInSupabase(accountId, lineId, newUrls)
    applyUrls(tripId, lineId, newUrls)
  }

  const getStickerUrls = (tripId: string, lineId: string): string[] => {
    const trip = trips.find((t) => t.id === tripId)
    return trip?.lines.find((l) => l.id === lineId)?.sticker_file_urls ?? []
  }

  const applyStickerUrls = (tripId: string, lineId: string, urls: string[]) => {
    setTrips((current) =>
      current.map((t) =>
        t.id === tripId
          ? { ...t, lines: t.lines.map((l) => l.id === lineId ? { ...l, sticker_file_urls: urls } : l) }
          : t,
      ),
    )
  }

  const addStickerFile = async (tripId: string, lineId: string, file: File) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const url = await uploadStickerFileInSupabase(accountId, lineId, file)
    const newUrls = [...getStickerUrls(tripId, lineId), url]
    await updateTripLineStickerFilesInSupabase(accountId, lineId, newUrls)
    applyStickerUrls(tripId, lineId, newUrls)
  }

  const removeStickerFile = async (tripId: string, lineId: string, index: number) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const newUrls = getStickerUrls(tripId, lineId).filter((_, i) => i !== index)
    await updateTripLineStickerFilesInSupabase(accountId, lineId, newUrls)
    applyStickerUrls(tripId, lineId, newUrls)
  }

  const getCombinedStickerUrls = (tripId: string, lineId: string): string[] => {
    const trip = trips.find((t) => t.id === tripId)
    return trip?.lines.find((l) => l.id === lineId)?.combined_sticker_urls ?? []
  }

  const applyCombinedStickerUrls = (tripId: string, lineId: string, urls: string[]) => {
    setTrips((current) =>
      current.map((t) =>
        t.id === tripId
          ? { ...t, lines: t.lines.map((l) => l.id === lineId ? { ...l, combined_sticker_urls: urls } : l) }
          : t,
      ),
    )
  }

  const addCombinedStickerFile = async (tripId: string, lineId: string, file: File) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const url = await uploadCombinedStickerFileInSupabase(accountId, lineId, file)
    const newUrls = [...getCombinedStickerUrls(tripId, lineId), url]
    await updateTripLineCombinedStickerFilesInSupabase(accountId, lineId, newUrls)
    applyCombinedStickerUrls(tripId, lineId, newUrls)
  }

  const removeCombinedStickerFile = async (tripId: string, lineId: string, index: number) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const newUrls = getCombinedStickerUrls(tripId, lineId).filter((_, i) => i !== index)
    await updateTripLineCombinedStickerFilesInSupabase(accountId, lineId, newUrls)
    applyCombinedStickerUrls(tripId, lineId, newUrls)
  }

  const getPassUrls = (tripId: string, lineId: string): string[] => {
    const trip = trips.find((t) => t.id === tripId)
    return trip?.lines.find((l) => l.id === lineId)?.wb_pass_urls ?? []
  }

  const applyPassUrls = (tripId: string, lineId: string, urls: string[]) => {
    setTrips((current) =>
      current.map((t) =>
        t.id === tripId
          ? { ...t, lines: t.lines.map((l) => l.id === lineId ? { ...l, wb_pass_urls: urls } : l) }
          : t,
      ),
    )
  }

  const uploadWbPass = async (tripId: string, lineId: string, file: File) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const url = await uploadWbPassFileInSupabase(accountId, lineId, file)
    const newUrls = [...getPassUrls(tripId, lineId), url]
    await updateTripLineWbPassUrlsInSupabase(accountId, lineId, newUrls)
    applyPassUrls(tripId, lineId, newUrls)
  }

  const removeWbPass = async (tripId: string, lineId: string, index: number) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const newUrls = getPassUrls(tripId, lineId).filter((_, i) => i !== index)
    await updateTripLineWbPassUrlsInSupabase(accountId, lineId, newUrls)
    applyPassUrls(tripId, lineId, newUrls)
  }

  const refreshCargoType = async (tripId: string, lineId: string, wbSupplyId: string) => {
    if (!isSupabaseConfigured || !accountId) return
    const cargoType = await getWbSupplyCargoTypeInSupabase(accountId, lineId)
    if (cargoType !== null) {
      setTrips((current) =>
        current.map((t) =>
          t.id === tripId
            ? {
                ...t,
                lines: t.lines.map((l) =>
                  l.id === lineId ? { ...l, wb_cargo_type: cargoType } : l,
                ),
              }
            : t,
        ),
      )
    }
  }

  const saveWbSupplyId = async (tripId: string, lineId: string, wbSupplyId: string) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    await updateTripLineWbSupplyIdInSupabase(accountId, lineId, wbSupplyId || null)
    setTrips((current) =>
      current.map((t) =>
        t.id === tripId
          ? {
              ...t,
              lines: t.lines.map((l) =>
                l.id === lineId
                  ? { ...l, wb_supply_id: wbSupplyId || null, ...(wbSupplyId ? {} : { wb_cargo_type: null }) }
                  : l,
              ),
            }
          : t,
      ),
    )
  }

  const fetchWbBarcodes = async (tripId: string, lineId: string, wbSupplyId: string) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const result = await getWbSupplyStickersInSupabase(accountId, lineId, wbSupplyId)
    // Обновляем wb_supply_id, wb_cargo_type и wb_package_codes в локальном state
    const packageCodes: string[] = (result as { package_codes?: string[] }).package_codes ?? []
    setTrips((current) =>
      current.map((t) =>
        t.id === tripId
          ? {
              ...t,
              lines: t.lines.map((l) =>
                l.id === lineId ? {
                  ...l,
                  wb_supply_id: result.wb_supply_id,
                  ...(result.cargo_type !== null ? { wb_cargo_type: result.cargo_type } : {}),
                  ...(packageCodes.length > 0 ? { wb_package_codes: packageCodes } : {}),
                } : l,
              ),
            }
          : t,
      ),
    )
    if (!result.sticker_urls || result.sticker_urls.length === 0) {
      throw new Error('WB не вернул стикеры для этой поставки. Возможно, упаковка ещё не сформирована.')
    }
    // Добавляем полученные URL к существующим стикерам
    const existing = getStickerUrls(tripId, lineId)
    const newUrls = [...existing, ...result.sticker_urls]
    await updateTripLineStickerFilesInSupabase(accountId, lineId, newUrls)
    applyStickerUrls(tripId, lineId, newUrls)
  }

  const saveMarketplaceDate = async (tripId: string, lineId: string, date: string | null) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    await saveMarketplaceDateInSupabase(accountId, lineId, date)
    setTrips((current) =>
      current.map((t) =>
        t.id === tripId
          ? { ...t, lines: t.lines.map((l) => l.id === lineId ? { ...l, planned_marketplace_delivery_date: date } : l) }
          : t,
      ),
    )
  }

  const refreshMarketplaceDate = async (tripId: string, lineId: string) => {
    if (!isSupabaseConfigured || !accountId) return
    const { mpDate, factDate } = await getWbSupplyMarketplaceDateInSupabase(accountId, lineId)
    if (mpDate !== null || factDate !== null) {
      setTrips((current) =>
        current.map((t) =>
          t.id === tripId
            ? {
                ...t,
                lines: t.lines.map((l) =>
                  l.id === lineId
                    ? {
                        ...l,
                        ...(mpDate !== null ? { planned_marketplace_delivery_date: mpDate } : {}),
                        ...(factDate !== null ? { wb_acceptance_date: factDate } : {}),
                      }
                    : l,
                ),
              }
            : t,
        ),
      )
    }
  }

  const downloadWbExcel = async (
    tripId: string,
    lineId: string,
    type: 'goods' | 'boxes' | 'all',
  ) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const supply = await fetchSupplyByTripLineId(lineId)
    if (!supply) throw new Error('Данные фулфилмент-поставки не найдены. Убедитесь, что поставка создана через модуль Фулфилмент.')

    if (type === 'goods' || type === 'all') {
      downloadGoodsTemplate(supply)
    }

    if (type === 'boxes' || type === 'all') {
      // Берём уже сохранённые ШК коробов (из синка синей кнопкой)
      const line = trips.find((t) => t.id === tripId)?.lines.find((l) => l.id === lineId)
      const codes = line?.wb_package_codes ?? []
      if (codes.length === 0) throw new Error('ШК коробов не синхронизированы. Нажмите синюю кнопку QR-стикеров рядом со стикерами поставки.')
      downloadBoxesTemplate(supply, codes)
    }
  }

  return {
    stores: accountStores,
    archivedStores,
    shipments: shipmentViews,
    trips,
    archivedTripLines,
    carriers,
    warehouses,
    stickers,
    bundles,
    statusHistory,
    isUsingSupabase,
    isLoading,
    error,
    addStore,
    appendStore,
    updateStore,
    removeStore,
    restoreStore,
    addShipment,
    addTrip,
    appendTrip,
    addTripLine,
    removeTrip,
    removeTripLine,
    restoreArchivedTripLine,
    changeTripStatus,
    changeTripLineStatus,
    changeTripLinePaymentStatus,
    editTrip,
    editTripLine,
    bulkMoveLinesToTrip,
    updateTripCustomFields,
    updateLineCustomFields,
    refreshTrips,
    addCarrier,
    removeCarrier,
    renameCarrier,
    updateCarrier,
    addWarehouse,
    removeWarehouse,
    renameWarehouse,
    addSticker,
    editSticker,
    removeSticker,
    addBundle,
    editBundle,
    removeBundle,
    addInvoicePhoto,
    replaceInvoicePhoto,
    removeInvoicePhoto,
    addStickerFile,
    removeStickerFile,
    addCombinedStickerFile,
    removeCombinedStickerFile,
    uploadWbPass,
    removeWbPass,
    saveWbSupplyId,
    fetchWbBarcodes,
    refreshCargoType,
    saveMarketplaceDate,
    refreshMarketplaceDate,
    downloadWbExcel,
    reload: hydrateFromSupabase,
  }
}
