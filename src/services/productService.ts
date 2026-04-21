import { supabase } from '../lib/supabase'
import type { Product, StoreSyncLog, SyncResult } from '../types'

/** Получить все товары магазина из локальной БД */
export const fetchProducts = async (storeId: string): Promise<Product[]> => {
  if (!supabase) throw new Error('Supabase client is not configured')

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('store_id', storeId)
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []) as Product[]
}

/** Получить последний лог синхронизации для магазина */
export const fetchLastSync = async (storeId: string): Promise<StoreSyncLog | null> => {
  if (!supabase) throw new Error('Supabase client is not configured')

  const { data, error } = await supabase
    .from('store_sync_log')
    .select('*')
    .eq('store_id', storeId)
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as StoreSyncLog | null
}

/** Запустить синхронизацию товаров через Edge Function */
export const triggerSync = async (storeId: string): Promise<SyncResult> => {
  if (!supabase) throw new Error('Supabase client is not configured')

  const { data, error } = await supabase.functions.invoke<SyncResult & { error?: string }>(
    'sync-store-products',
    { body: { store_id: storeId } },
  )

  if (error) throw error
  if (!data) throw new Error('Пустой ответ от функции синхронизации')
  // Функция всегда возвращает 200; ошибка кладётся в data.error
  if (data.error) throw new Error(data.error)
  return data as SyncResult
}
