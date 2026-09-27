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

  const { data, error } = await (supabase as any).rpc('get_account_stores_safe', { p_account_id: accountId })

  if (error) throw error
  return (data ?? []).filter((row: any)=>!row.deleted_at).map((row: any)=>({
    ...row,
    api_key: row.has_api_key ? '__configured__' : null,
    teksher_login: row.has_teksher_credentials ? '__configured__' : null,
  })) as Store[]
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
    supplier: values.supplier?.trim() || null,
    supplier_full: values.supplier_full?.trim() || null,
    address: values.address?.trim() || null,
    ...(values.country !== undefined ? { country: values.country.trim() || null } : {}),
    inn: values.inn?.trim() || null,
    phone: values.phone?.trim() || null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('stores').insert(payload).select('id,account_id,store_code,name,marketplace,created_at,supplier,supplier_full,address,country,inn,phone,deleted_at,short_id,customer_account_id').single()

  if (error) throw error
  if (values.api_key?.trim()) {
    const { error: secretError } = await (supabase as any).rpc('save_store_wb_api_key', { p_store_id: data.id, p_api_key: values.api_key.trim() })
    if (secretError) throw secretError
  }
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
    supplier: values.supplier?.trim() || null,
    ...(values.supplier_full !== undefined ? { supplier_full: values.supplier_full.trim() || null } : {}),
    address: values.address?.trim() || null,
    ...(values.country !== undefined ? { country: values.country.trim() || null } : {}),
    inn: values.inn?.trim() || null,
    phone: values.phone?.trim() || null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('stores')
    .update(payload as any)
    .eq('id', storeId)
    .select('id,account_id,store_code,name,marketplace,created_at,supplier,supplier_full,address,country,inn,phone,deleted_at,short_id,customer_account_id')
    .single()

  if (error) throw error
  if (values.api_key !== undefined) {
    const { error: secretError } = await (supabase as any).rpc('save_store_wb_api_key', { p_store_id: storeId, p_api_key: values.api_key.trim() })
    if (secretError) throw secretError
  }
  return data as Store
}

export const deleteStoreInSupabase = async (storeId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase.rpc('archive_store', { p_store_id: storeId })

  if (error) throw error
  const result = data as unknown as { ok?: boolean; reason?: string } | null
  if (result?.ok === false) throw new Error(result.reason || 'Удаление заблокировано активными связанными данными')
}

export const fetchArchivedStoresFromSupabase = async (accountId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase.rpc('get_archived_stores', { p_account_id: accountId })

  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as unknown as Store[]
}

export const restoreStoreInSupabase = async (storeId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { error } = await supabase.rpc('restore_store', { p_store_id: storeId })

  if (error) throw error
}
