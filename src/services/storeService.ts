import { randomStoreCode } from '../lib/utils'
import { supabase } from '../lib/supabase'
import type { Store, StoreFormValues } from '../types'

const generateUniqueCode = (stores: Store[]) => {
  let code = randomStoreCode()

  while (stores.some((store) => store.store_code === code)) {
    code = randomStoreCode()
  }

  return code
}

export const listStores = (stores: Store[], accountId = '11111111-1111-1111-1111-111111111111') =>
  stores.filter((store) => store.account_id === accountId)

export const createStore = (
  values: StoreFormValues,
  stores: Store[],
  accountId = '11111111-1111-1111-1111-111111111111',
) => ({
  id: crypto.randomUUID(),
  account_id: accountId,
  store_code: values.store_code?.trim() || generateUniqueCode(stores),
  name: values.name,
  marketplace: values.marketplace,
  created_at: new Date().toISOString(),
})

export const fetchStoresFromSupabase = async (accountId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as Store[]
}

export const createStoreInSupabase = async (values: StoreFormValues, accountId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const payload = {
    account_id: accountId,
    name: values.name.trim(),
    marketplace: values.marketplace,
    store_code: values.store_code?.trim() || undefined,
    ...(values.api_key?.trim() ? { api_key: values.api_key.trim() } : {}),
    supplier: values.supplier?.trim() || null,
    address: values.address?.trim() || null,
    inn: values.inn?.trim() || null,
  }

  const { data, error } = await supabase.from('stores').insert(payload).select().single()

  if (error) throw error
  return data as Store
}

export const updateStoreInSupabase = async (storeId: string, values: StoreFormValues) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const payload = {
    name: values.name.trim(),
    marketplace: values.marketplace,
    store_code: values.store_code?.trim() || undefined,
    ...(values.api_key !== undefined ? { api_key: values.api_key.trim() || null } : {}),
    supplier: values.supplier?.trim() || null,
    address: values.address?.trim() || null,
    inn: values.inn?.trim() || null,
  }

  const { data, error } = await supabase
    .from('stores')
    .update(payload)
    .eq('id', storeId)
    .select()
    .single()

  if (error) throw error
  return data as Store
}

export const deleteStoreInSupabase = async (storeId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { error } = await supabase.from('stores').delete().eq('id', storeId)

  if (error) throw error
}
