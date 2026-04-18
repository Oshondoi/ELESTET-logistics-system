import { supabase } from '../lib/supabase'
import type { Carrier, Warehouse } from '../types'

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

export const fetchWarehouses = async (accountId: string): Promise<Warehouse[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('warehouses')
    .select('*')
    .eq('account_id', accountId)
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
