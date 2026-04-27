import { supabase } from '../lib/supabase'
import type { Carrier, CarrierTariff, WbUnloadTariff, Warehouse } from '../types'

export const fetchCarriers = async (accountId: string): Promise<Carrier[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('carriers')
    .select('*')
    .eq('account_id', accountId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Carrier[]
}

export const createCarrier = async (accountId: string, name: string): Promise<Carrier> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('carriers')
    .insert({ account_id: accountId, name })
    .select()
    .single()
  if (error) throw error
  return data as Carrier
}

export const deleteCarrier = async (accountId: string, carrierId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('carriers')
    .delete()
    .eq('id', carrierId)
    .eq('account_id', accountId)
  if (error) throw error
}

export const updateCarrier = async (accountId: string, carrierId: string, name: string): Promise<Carrier> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('carriers')
    .update({ name })
    .eq('id', carrierId)
    .eq('account_id', accountId)
    .select()
    .single()
  if (error) throw error
  return data as Carrier
}

export const fetchWarehouses = async (accountId: string): Promise<Warehouse[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('warehouses')
    .select('*')
    .or(`account_id.eq.${accountId},account_id.is.null`)
    .order('is_system', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Warehouse[]
}

export const createWarehouse = async (accountId: string, name: string): Promise<Warehouse> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('warehouses')
    .insert({ account_id: accountId, name })
    .select()
    .single()
  if (error) throw error
  return data as Warehouse
}

export const deleteWarehouse = async (accountId: string, warehouseId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('warehouses')
    .delete()
    .eq('id', warehouseId)
    .eq('account_id', accountId)
  if (error) throw error
}

export const updateWarehouse = async (accountId: string, warehouseId: string, name: string): Promise<Warehouse> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('warehouses')
    .update({ name })
    .eq('id', warehouseId)
    .eq('account_id', accountId)
    .select()
    .single()
  if (error) throw error
  return data as Warehouse
}

// ── Тарифы перевозчика ────────────────────────────────────────────

export const fetchCarrierTariffs = async (accountId: string, carrierId: string): Promise<CarrierTariff[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('carrier_tariffs')
    .select('*')
    .eq('account_id', accountId)
    .eq('carrier_id', carrierId)
  if (error) throw error
  return (data ?? []) as CarrierTariff[]
}

export const upsertCarrierTariff = async (
  accountId: string,
  carrierId: string,
  warehouseId: string,
  pricePerBox: number | null,
  pricePerKg: number | null,
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  if (pricePerBox === null && pricePerKg === null) {
    await supabase
      .from('carrier_tariffs')
      .delete()
      .eq('carrier_id', carrierId)
      .eq('warehouse_id', warehouseId)
    return
  }
  const { error } = await supabase.from('carrier_tariffs').upsert(
    { account_id: accountId, carrier_id: carrierId, warehouse_id: warehouseId, price_per_box: pricePerBox, price_per_kg: pricePerKg },
    { onConflict: 'carrier_id,warehouse_id' },
  )
  if (error) throw error
}

// ── Тарифы отгрузки на склады ВБ ─────────────────────────────────

export const fetchWbUnloadTariffs = async (accountId: string): Promise<WbUnloadTariff[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('wb_unload_tariffs')
    .select('*')
    .eq('account_id', accountId)
  if (error) throw error
  return (data ?? []) as WbUnloadTariff[]
}

export const upsertWbUnloadTariff = async (
  accountId: string,
  warehouseId: string,
  pricePerBox: number | null,
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  if (pricePerBox === null) {
    await supabase
      .from('wb_unload_tariffs')
      .delete()
      .eq('account_id', accountId)
      .eq('warehouse_id', warehouseId)
    return
  }
  const { error } = await supabase.from('wb_unload_tariffs').upsert(
    { account_id: accountId, warehouse_id: warehouseId, price_per_box: pricePerBox },
    { onConflict: 'account_id,warehouse_id' },
  )
  if (error) throw error
}
