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
  fetchWarehouses,
  createWarehouse as createWarehouseInSupabase,
  deleteWarehouse as deleteWarehouseInSupabase,
} from '../services/directoriesService'
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
} from '../types'

export const useAppData = (accountId: string | null) => {
  const [stores, setStores] = useState<Store[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [trips, setTrips] = useState<TripWithLines[]>([])
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
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
    statusHistory,
    isUsingSupabase,
    isLoading,
    error,
    addStore,
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
    addWarehouse,
    removeWarehouse,
    addInvoicePhoto,
    replaceInvoicePhoto,
    removeInvoicePhoto,
    reload: hydrateFromSupabase,
  }
}
