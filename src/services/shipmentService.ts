import { mockShipmentStatusHistory } from '../data/mockData'
import { supabase } from '../lib/supabase'
import type {
  Shipment,
  ShipmentFormValues,
  ShipmentStatusHistory,
  ShipmentWithStore,
  Store,
} from '../types'

const today = () => new Date().toISOString().slice(0, 10)

const createTrackingCode = (trackingNumber: number) => `TRK-${trackingNumber}`

const buildShipmentView = (shipment: Shipment, stores: Store[]): ShipmentWithStore => ({
  ...shipment,
  store: stores.find((store) => store.id === shipment.store_id),
})

export const createShipmentDraft = (storeId: string, shipments: Shipment[]) => {
  const nextTrackingNumber =
    shipments
      .filter((shipment) => shipment.store_id === storeId)
      .reduce((max, shipment) => Math.max(max, shipment.tracking_number), 0) + 1

  return {
    tracking_number: nextTrackingNumber,
    tracking_code: createTrackingCode(nextTrackingNumber),
  }
}

export const listShipmentStatusHistory = () => [...mockShipmentStatusHistory]

export const listShipments = (
  shipments: Shipment[],
  stores: Store[],
  accountId = '11111111-1111-1111-1111-111111111111',
) =>
  shipments
    .filter((shipment) => shipment.account_id === accountId)
    .sort((left, right) => {
      if (left.store_id === right.store_id) {
        return right.tracking_number - left.tracking_number
      }

      return left.store_id.localeCompare(right.store_id)
    })
    .map((shipment) => buildShipmentView(shipment, stores))

export const createShipment = (
  values: ShipmentFormValues,
  shipments: Shipment[],
  stores: Store[],
  accountId = '11111111-1111-1111-1111-111111111111',
) => {
  const { tracking_number, tracking_code } = createShipmentDraft(values.store_id, shipments)
  const createdAt = new Date().toISOString()
  const arrivalDate = values.arrival_date || (values.status === 'Прибыл' ? today() : null)

  const shipment: Shipment = {
    id: crypto.randomUUID(),
    account_id: accountId,
    store_id: values.store_id,
    tracking_number,
    tracking_code,
    carrier: values.carrier,
    destination_warehouse: values.destination_warehouse,
    box_qty: values.box_qty,
    units_qty: values.units_qty,
    units_total: values.units_total,
    arrived_box_qty: values.arrived_box_qty,
    planned_marketplace_delivery_date: values.planned_marketplace_delivery_date || null,
    arrival_date: arrivalDate,
    status: values.status,
    payment_status: values.payment_status,
    comment: values.comment,
    created_at: createdAt,
    updated_at: createdAt,
  }

  const historyEntry: ShipmentStatusHistory = {
    id: crypto.randomUUID(),
    shipment_id: shipment.id,
    old_status: null,
    new_status: shipment.status,
    changed_at: createdAt,
    changed_by: 'user-1',
  }

  return {
    shipment,
    historyEntry,
    shipmentView: buildShipmentView(shipment, stores),
  }
}

export const fetchShipmentsFromSupabase = async (accountId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase
    .from('shipments')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as Shipment[]
}

export const createShipmentInSupabase = async (values: ShipmentFormValues, accountId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase.rpc('create_shipment', {
    p_account_id: accountId,
    p_store_id: values.store_id,
    p_carrier: values.carrier.trim(),
    p_destination_warehouse: values.destination_warehouse.trim(),
    p_box_qty: values.box_qty,
    p_units_qty: values.units_qty,
    p_units_total: values.units_total,
    p_arrived_box_qty: values.arrived_box_qty,
    p_planned_marketplace_delivery_date: values.planned_marketplace_delivery_date || null,
    p_arrival_date: values.arrival_date || null,
    p_status: values.status,
    p_payment_status: values.payment_status,
    p_comment: values.comment.trim(),
  })

  if (error) throw error
  return data as Shipment
}
