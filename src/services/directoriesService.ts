import { supabase } from '../lib/supabase'
import type { AccountCurrency, Carrier, CarrierTariff, FulfillmentWorkTariff, WbUnloadTariff, Warehouse } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any

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

export interface CarrierUpdateData {
  name: string
  phone?: string | null
  contact_person?: string | null
  notes?: string | null
  owner_user_id?: string | null
}

export const updateCarrierFull = async (accountId: string, carrierId: string, data: CarrierUpdateData): Promise<Carrier> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: row, error } = await supabase
    .from('carriers')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({
      name: data.name,
      phone: data.phone ?? null,
      contact_person: data.contact_person ?? null,
      notes: data.notes ?? null,
      owner_user_id: data.owner_user_id ?? null,
    } as any)
    .eq('id', carrierId)
    .eq('account_id', accountId)
    .select()
    .single()
  if (error) throw error
  return row as Carrier
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

// ── Тарифы работ фулфилмента ──────────────────────────────────

export const fetchWorkTariffs = async (accountId: string): Promise<FulfillmentWorkTariff[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await db()
    .from('fulfillment_work_tariffs')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as FulfillmentWorkTariff[]
}

export const addWorkTariff = async (
  accountId: string,
  stage: string,
  name: string,
  pricePerUnit: number,
  currency = 'RUB',
  priceWorker = 0,
  priceSenior = 0,
): Promise<FulfillmentWorkTariff> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await db()
    .from('fulfillment_work_tariffs')
    .insert({ account_id: accountId, stage, name, price_per_unit: pricePerUnit, currency, price_worker: priceWorker, price_senior: priceSenior })
    .select()
    .single()
  if (error) throw error
  return data as FulfillmentWorkTariff
}

export const updateWorkTariff = async (
  id: string,
  patch: { name?: string; price_per_unit?: number; price_worker?: number; price_senior?: number; stage?: string; currency?: string },
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await db()
    .from('fulfillment_work_tariffs')
    .update(patch)
    .eq('id', id)
  if (error) throw error
}

export const deleteWorkTariff = async (id: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await db()
    .from('fulfillment_work_tariffs')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── Валюты аккаунта ───────────────────────────────────────────

export const fetchAccountCurrencies = async (accountId: string): Promise<AccountCurrency[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await db()
    .from('account_currencies')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as AccountCurrency[]
}

export const addAccountCurrency = async (accountId: string, code: string): Promise<AccountCurrency> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await db()
    .from('account_currencies')
    .insert({ account_id: accountId, code })
    .select()
    .single()
  if (error) throw error
  return data as AccountCurrency
}

export const deleteAccountCurrency = async (id: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await db()
    .from('account_currencies')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export const fetchStageCurrencies = async (accountId: string): Promise<Record<string, string>> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await db()
    .from('account_stage_currencies')
    .select('stage, currency')
    .eq('account_id', accountId)
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r: { stage: string; currency: string }) => [r.stage, r.currency]))
}

export const upsertStageCurrency = async (accountId: string, stage: string, currency: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await db()
    .from('account_stage_currencies')
    .upsert({ account_id: accountId, stage, currency }, { onConflict: 'account_id,stage' })
  if (error) throw error
}

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
