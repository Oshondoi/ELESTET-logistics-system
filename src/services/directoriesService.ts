import { supabase } from '../lib/supabase'
import type { AccountCurrency, Carrier, CarrierTariff, Consumable, ConsumableCatalogItem, FulfillmentWorkTariff, WbUnloadTariff, Warehouse } from '../types'

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
  pricePerKg = 0,
): Promise<FulfillmentWorkTariff> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await db()
    .from('fulfillment_work_tariffs')
    .insert({ account_id: accountId, stage, name, price_per_unit: pricePerUnit, currency, price_worker: priceWorker, price_senior: priceSenior, price_per_kg: pricePerKg })
    .select()
    .single()
  if (error) throw error
  return data as FulfillmentWorkTariff
}

export const updateWorkTariff = async (
  id: string,
  patch: { name?: string; price_per_unit?: number; price_per_kg?: number; price_worker?: number; price_senior?: number; stage?: string; currency?: string },
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

export const setPrimaryCurrency = async (accountId: string, id: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  await db().from('account_currencies').update({ is_primary: false }).eq('account_id', accountId)
  const { error } = await db().from('account_currencies').update({ is_primary: true }).eq('id', id)
  if (error) throw error
}

export const updateCurrencyRate = async (id: string, rate: number): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await db().from('account_currencies').update({ exchange_rate: rate }).eq('id', id)
  if (error) throw error
}

// ── Порядок складов (per account, синхронизируется через БД) ─────

export interface WarehouseOrderSettings {
  sort_mode: 'alpha' | 'custom'
  order_ids: string[]
}

export const fetchWarehouseSettings = async (accountId: string): Promise<WarehouseOrderSettings> => {
  if (!supabase) return { sort_mode: 'alpha', order_ids: [] }
  const { data } = await db()
    .from('account_warehouse_settings')
    .select('sort_mode, order_ids')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data) return { sort_mode: 'alpha', order_ids: [] }
  return { sort_mode: data.sort_mode ?? 'alpha', order_ids: data.order_ids ?? [] }
}

export const saveWarehouseSettings = async (
  accountId: string,
  settings: WarehouseOrderSettings,
): Promise<void> => {
  if (!supabase) return
  const { error } = await db()
    .from('account_warehouse_settings')
    .upsert({ account_id: accountId, sort_mode: settings.sort_mode, order_ids: settings.order_ids }, { onConflict: 'account_id' })
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

// ── Расходники ────────────────────────────────────────────────

export const fetchConsumables = async (accountId: string): Promise<Consumable[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await db()
    .from('consumables')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Consumable[]
}

export const addConsumable = async (
  accountId: string,
  name: string,
  price: number,
  cost: number,
  currency = 'RUB',
  kind: string | null = null,
  size: string | null = null,
): Promise<Consumable> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await db()
    .from('consumables')
    .insert({ account_id: accountId, name, price, cost, currency, kind, size })
    .select()
    .single()
  if (error) throw error
  return data as Consumable
}

export const updateConsumable = async (
  id: string,
  patch: { name?: string; price?: number; cost?: number; currency?: string; kind?: string | null; size?: string | null },
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await db()
    .from('consumables')
    .update(patch)
    .eq('id', id)
  if (error) throw error
}

export const deleteConsumable = async (id: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await db()
    .from('consumables')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export const fetchConsumableCatalog = async (accountId: string): Promise<ConsumableCatalogItem[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await db()
    .from('consumable_catalog')
    .select('*')
    .eq('account_id', accountId)
    .order('kind', { ascending: true })
    .order('size', { ascending: true })
  if (error) throw error
  return (data ?? []) as ConsumableCatalogItem[]
}

export const addConsumableCatalogItem = async (
  accountId: string,
  kind: string,
  size: string,
  price = 0,
  cost = 0,
  currency = 'RUB',
): Promise<ConsumableCatalogItem> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await db()
    .from('consumable_catalog')
    .insert({ account_id: accountId, kind, size, price, cost, currency })
    .select()
    .single()
  if (error) throw error
  return data as ConsumableCatalogItem
}

export const updateConsumableCatalogItem = async (
  id: string,
  patch: { size?: string; price?: number; cost?: number; currency?: string },
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await db()
    .from('consumable_catalog')
    .update(patch)
    .eq('id', id)
  if (error) throw error
}

export const deleteConsumableCatalogItem = async (id: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await db()
    .from('consumable_catalog')
    .delete()
    .eq('id', id)
  if (error) throw error
}
