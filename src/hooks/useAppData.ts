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
import type {
  Shipment,
  ShipmentFormValues,
  ShipmentStatusHistory,
  ShipmentWithStore,
  Store,
  StoreFormValues,
} from '../types'

export const useAppData = (accountId: string | null) => {
  const [stores, setStores] = useState<Store[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
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

  return {
    stores: accountStores,
    shipments: shipmentViews,
    statusHistory,
    isUsingSupabase,
    isLoading,
    error,
    addStore,
    addShipment,
    reload: hydrateFromSupabase,
  }
}
