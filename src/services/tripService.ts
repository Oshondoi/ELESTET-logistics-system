import { supabase } from '../lib/supabase'
import type {
  Trip,
  TripFormValues,
  TripLine,
  TripLineFormValues,
  TripLineWithStore,
  TripWithLines,
  Store,
  TripStatus,
  ShipmentStatus,
  PaymentStatus,
} from '../types'

const buildTripLineWithStore = (line: TripLine, stores: Store[]): TripLineWithStore => ({
  ...line,
  store: stores.find((s) => s.id === line.store_id),
})

export const fetchTrips = async (accountId: string, stores: Store[]): Promise<TripWithLines[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: trips, error: tripsError } = await supabase
    .from('trips')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

  if (tripsError) throw tripsError
  if (!trips || trips.length === 0) return []

  const tripIds = trips.map((t) => t.id)

  const { data: lines, error: linesError } = await supabase
    .from('trip_lines')
    .select('*')
    .in('trip_id', tripIds)
    .order('shipment_number', { ascending: true })

  if (linesError) throw linesError

  return trips.map((trip) => ({
    ...(trip as Trip),
    lines: (lines ?? [])
      .filter((line) => line.trip_id === trip.id)
      .map((line) => buildTripLineWithStore(line as TripLine, stores)),
  }))
}

export const createTrip = async (
  accountId: string,
  values: TripFormValues,
): Promise<Trip> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('create_trip', {
    p_account_id: accountId,
    p_carrier: values.carrier,
    p_comment: values.comment,
  })

  if (error) throw error
  return data as Trip
}

export const addTripLine = async (
  accountId: string,
  tripId: string,
  values: TripLineFormValues,
): Promise<TripLine> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('add_trip_line', {
    p_trip_id: tripId,
    p_account_id: accountId,
    p_store_id: values.store_id,
    p_destination_warehouse: values.destination_warehouse,
    p_box_qty: values.box_qty,
    p_units_qty: values.units_qty,
    p_units_total: values.units_total,
    p_arrived_box_qty: values.arrived_box_qty,
    p_planned_marketplace_delivery_date: values.planned_marketplace_delivery_date || null,
    p_arrival_date: values.arrival_date || null,
    p_status: values.status,
    p_comment: values.comment,
  })

  if (error) throw error
  return data as TripLine
}

export const deleteTripLine = async (accountId: string, lineId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('trip_lines')
    .delete()
    .eq('id', lineId)
    .eq('account_id', accountId)

  if (error) throw error
}

export const deleteTrip = async (accountId: string, tripId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error: linesError } = await supabase
    .from('trip_lines')
    .delete()
    .eq('trip_id', tripId)
    .eq('account_id', accountId)

  if (linesError) throw linesError

  const { error: tripError } = await supabase
    .from('trips')
    .delete()
    .eq('id', tripId)
    .eq('account_id', accountId)

  if (tripError) throw tripError
}

export const updateTripStatus = async (
  accountId: string,
  tripId: string,
  status: TripStatus,
): Promise<Trip> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('update_trip_status', {
    p_account_id: accountId,
    p_trip_id: tripId,
    p_status: status,
  })

  if (error) throw error
  return data as Trip
}

export const updateTripLineStatus = async (
  accountId: string,
  lineId: string,
  status: ShipmentStatus,
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('trip_lines')
    .update({ status })
    .eq('id', lineId)
    .eq('account_id', accountId)

  if (error) throw error
}

export const updateTripLinePaymentStatus = async (
  accountId: string,
  lineId: string,
  payment_status: PaymentStatus,
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('trip_lines')
    .update({ payment_status })
    .eq('id', lineId)
    .eq('account_id', accountId)

  if (error) throw error
}

export const uploadInvoicePhoto = async (
  accountId: string,
  lineId: string,
  file: File,
): Promise<string> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${accountId}/${lineId}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('trip-invoices')
    .upload(path, file, { upsert: false })

  if (uploadError) throw uploadError

  const { data } = supabase.storage.from('trip-invoices').getPublicUrl(path)
  return data.publicUrl
}

export const updateTrip = async (
  accountId: string,
  tripId: string,
  values: TripFormValues,
): Promise<Trip> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('trips')
    .update({
      carrier: values.carrier,
      comment: values.comment,
      ...(values.departure_date !== undefined ? { departure_date: values.departure_date || null } : {}),
    })
    .eq('id', tripId)
    .eq('account_id', accountId)
    .select()
    .single()

  if (error) throw error
  return data as Trip
}

export const updateTripLine = async (
  accountId: string,
  lineId: string,
  values: TripLineFormValues,
): Promise<TripLine> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('trip_lines')
    .update({
      store_id: values.store_id,
      destination_warehouse: values.destination_warehouse,
      box_qty: values.box_qty,
      units_qty: values.units_qty,
      units_total: values.units_total,
      arrived_box_qty: values.arrived_box_qty,
      planned_marketplace_delivery_date: values.planned_marketplace_delivery_date || null,
      arrival_date: values.arrival_date || null,
      status: values.status,
      payment_status: values.payment_status,
      comment: values.comment,
    })
    .eq('id', lineId)
    .eq('account_id', accountId)
    .select()
    .single()

  if (error) throw error
  return data as TripLine
}

export const updateTripLineInvoicePhotos = async (
  accountId: string,
  lineId: string,
  invoice_photo_urls: string[],
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('trip_lines')
    .update({ invoice_photo_urls })
    .eq('id', lineId)
    .eq('account_id', accountId)

  if (error) throw error
}
