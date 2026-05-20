import { supabase } from '../lib/supabase'
import type { Product, StoreSyncLog, SyncResult } from '../types'

interface ProductCostPatch {
  id: string
  cost_price: number | null
}

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

/** Обновить себестоимость для списка товаров */
export const updateProductsCost = async (patches: ProductCostPatch[]): Promise<void> => {
  if (!supabase) throw new Error('Supabase client is not configured')
  if (patches.length === 0) return

  // Supabase generated types may lag behind latest SQL patches (cost_price).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  for (const patch of patches) {
    const { error } = await db
      .from('products')
      .update({ cost_price: patch.cost_price })
      .eq('id', patch.id)

    if (error) throw error
  }
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

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('non-2xx') || msg.includes('Failed to send') || msg.includes('NetworkError')) {
      throw new Error('Сервис временно недоступен. Попробуйте ещё раз через несколько секунд.')
    }
    throw error
  }
  if (!data) throw new Error('Пустой ответ от функции синхронизации')
  // Функция всегда возвращает 200; ошибка кладётся в data.error
  if (data.error) throw new Error(data.error)
  return data as SyncResult
}
