import { useCallback, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  listShipments,
  fetchShipmentsFromSupabase,
  createShipmentInSupabase,
} from '../services/shipmentService'
import {
  listStores,
  fetchStoresFromSupabase,
  createStoreInSupabase,
  updateStoreInSupabase,
  deleteStoreInSupabase,
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
} from '../services/tripService'
import {
  fetchCarriers,
  createCarrier as createCarrierInSupabase,
  deleteCarrier as deleteCarrierInSupabase,
  updateCarrier as updateCarrierInSupabase,
  fetchWarehouses,
  createWarehouse as createWarehouseInSupabase,
  deleteWarehouse as deleteWarehouseInSupabase,
  updateWarehouse as updateWarehouseInSupabase,
} from '../services/directoriesService'
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
  Carrier,
  Warehouse,
  StickerTemplate,
  StickerFormValues,
  StickerBundle,
  StickerBundleItem,
} from '../types'

export const useAppData = (accountId: string | null) => {
  const [stores, setStores] = useState<Store[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [trips, setTrips] = useState<TripWithLines[]>([])
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

      const [supabaseTrips, supabaseCarriers, supabaseWarehouses] = await Promise.all([
        fetchTrips(accountId, supabaseStores),
        fetchCarriers(accountId),
        fetchWarehouses(accountId),
      ])
      setTrips(supabaseTrips)
      setCarriers(supabaseCarriers)
      setWarehouses(supabaseWarehouses)

      const supabaseStickers = await fetchStickers(accountId)
      setStickers(supabaseStickers)

      const supabaseBundles = await fetchBundles(accountId)
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

  const addStore = async (values: StoreFormValues) => {
    if (!isSupabaseConfigured || !accountId) {
      throw new Error('Supabase не настроен')
    }

    const store = await createStoreInSupabase(values, accountId)
    setStores((current) => [store, ...current])
    return store
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

    await deleteTripLineInSupabase(accountId, lineId)
    setTrips((current) => current.map((trip) => (
      trip.id === tripId
        ? { ...trip, lines: trip.lines.filter((line) => line.id !== lineId) }
        : trip
    )))
  }

  const changeTripStatus = async (tripId: string, status: TripStatus) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const updatedTrip = await updateTripStatusInSupabase(accountId, tripId, status)
    setTrips((current) =>
      current.map((trip) =>
        trip.id === tripId
          ? { ...trip, status: updatedTrip.status, trip_number: updatedTrip.trip_number }
          : trip,
      ),
    )
  }

  const changeTripLineStatus = async (tripId: string, lineId: string, status: ShipmentStatus) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    await updateTripLineStatusInSupabase(accountId, lineId, status)
    setTrips((current) =>
      current.map((trip) =>
        trip.id === tripId
          ? { ...trip, lines: trip.lines.map((line) => line.id === lineId ? { ...line, status } : line) }
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

  const editTripLine = async (tripId: string, lineId: string, values: TripLineFormValues) => {
    if (!isSupabaseConfigured || !accountId) throw new Error('Supabase не настроен')
    const updatedLine = await updateTripLineInSupabase(accountId, lineId, values) as TripLine
    const store = accountStores.find((s) => s.id === updatedLine.store_id)
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

  return {
    stores: accountStores,
    shipments: shipmentViews,
    trips,
    carriers,
    warehouses,
    stickers,
    bundles,
    statusHistory,
    isUsingSupabase,
    isLoading,
    error,
    addStore,
    updateStore,
    removeStore,
    addShipment,
    addTrip,
    addTripLine,
    removeTrip,
    removeTripLine,
    changeTripStatus,
    changeTripLineStatus,
    changeTripLinePaymentStatus,
    editTrip,
    editTripLine,
    addCarrier,
    removeCarrier,
    renameCarrier,
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
    reload: hydrateFromSupabase,
  }
}
