import { supabase } from '../lib/supabase'
import type {
  FulfillmentBatch,
  FulfillmentBatchWithItems,
  FulfillmentItem,
  FulfillmentSettings,
  FulfillmentStage,
  Product,
} from '../types'

// ── Settings ──────────────────────────────────────────────────

export const fetchFulfillmentSettings = async (accountId: string): Promise<FulfillmentSettings | null> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('fulfillment_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return data as FulfillmentSettings | null
}

export const upsertFulfillmentSettings = async (
  accountId: string,
  settings: Partial<Pick<FulfillmentSettings, 'stage_otk' | 'stage_marking' | 'stage_packing' | 'stage_logistics'>>,
): Promise<FulfillmentSettings> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('fulfillment_settings')
    .upsert({ account_id: accountId, ...settings, updated_at: new Date().toISOString() }, { onConflict: 'account_id' })
    .select()
    .single()
  if (error) throw error
  return data as FulfillmentSettings
}

// ── Batches ───────────────────────────────────────────────────

export const fetchBatches = async (accountId: string): Promise<FulfillmentBatch[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('fulfillment_batches')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FulfillmentBatch[]
}

export const fetchBatchWithItems = async (batchId: string): Promise<FulfillmentBatchWithItems> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const [{ data: batch, error: batchErr }, { data: items, error: itemsErr }] = await Promise.all([
    supabase.from('fulfillment_batches').select('*').eq('id', batchId).single(),
    supabase.from('fulfillment_items').select('*').eq('batch_id', batchId).order('sort_order').order('created_at'),
  ])
  if (batchErr) throw batchErr
  if (itemsErr) throw itemsErr
  return { ...(batch as FulfillmentBatch), items: (items ?? []) as FulfillmentItem[] }
}

export const createBatch = async (
  accountId: string,
  values: {
    name: string
    store_id?: string | null
    stage_otk: boolean
    stage_marking: boolean
    stage_packing: boolean
    stage_logistics: boolean
    comment?: string
  },
): Promise<FulfillmentBatch> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('fulfillment_batches')
    .insert({ account_id: accountId, ...values })
    .select()
    .single()
  if (error) throw error
  return data as FulfillmentBatch
}

export const updateBatch = async (
  batchId: string,
  updates: Partial<
    Pick<
      FulfillmentBatch,
      | 'name'
      | 'status'
      | 'current_stage'
      | 'trip_line_id'
      | 'comment'
      | 'stage_otk'
      | 'stage_marking'
      | 'stage_packing'
      | 'stage_logistics'
    >
  >,
): Promise<FulfillmentBatch> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('fulfillment_batches')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', batchId)
    .select()
    .single()
  if (error) throw error
  return data as FulfillmentBatch
}

export const deleteBatch = async (batchId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.from('fulfillment_batches').delete().eq('id', batchId)
  if (error) throw error
}

// ── Items ─────────────────────────────────────────────────────

export const addItem = async (
  item: Omit<FulfillmentItem, 'id' | 'created_at'>,
): Promise<FulfillmentItem> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('fulfillment_items').insert(item).select().single()
  if (error) throw error
  return data as FulfillmentItem
}

export const updateItem = async (
  itemId: string,
  updates: Partial<
    Pick<
      FulfillmentItem,
      | 'qty_received'
      | 'qty_otk'
      | 'qty_marked'
      | 'qty_packed'
      | 'boxes'
      | 'product_name'
      | 'size'
      | 'article'
      | 'notes'
    >
  >,
): Promise<FulfillmentItem> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('fulfillment_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single()
  if (error) throw error
  return data as FulfillmentItem
}

export const deleteItem = async (itemId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.from('fulfillment_items').delete().eq('id', itemId)
  if (error) throw error
}

// ── Stage transition ──────────────────────────────────────────

/** Переходит к следующему этапу, пропуская отключённые */
export const advanceStage = async (batch: FulfillmentBatch): Promise<FulfillmentBatch> => {
  const order: FulfillmentStage[] = ['reception', 'otk', 'marking', 'packing', 'logistics', 'done']
  const current = order.indexOf(batch.current_stage)
  const skip: Record<string, boolean> = {
    otk: !batch.stage_otk,
    marking: !batch.stage_marking,
    packing: !batch.stage_packing,
    logistics: !batch.stage_logistics,
  }
  let next = current + 1
  while (next < order.length - 1 && skip[order[next]]) next++

  const nextStage = order[next] ?? 'done'
  const newStatus = nextStage === 'done' ? 'done' : 'active'

  // Log stage completion
  if (supabase) {
    await supabase.from('fulfillment_stage_logs').insert({ batch_id: batch.id, stage: batch.current_stage })
  }

  return updateBatch(batch.id, { current_stage: nextStage, status: newStatus as FulfillmentBatch['status'] })
}

// ── Product barcode lookup ────────────────────────────────────

export const lookupProductByBarcode = async (
  accountId: string,
  storeId: string | null,
  barcode: string,
): Promise<{ name: string | null; article: string | null; size: string | null } | null> => {
  if (!supabase || !storeId) return null
  const { data, error } = await supabase
    .from('products')
    .select('nm_id, name, vendor_code, sizes')
    .eq('account_id', accountId)
    .eq('store_id', storeId)
    .contains('barcodes', [barcode])
    .limit(1)
  if (error || !data || data.length === 0) return null

  const product = data[0] as Product
  let size: string | null = null
  if (product.sizes) {
    const sizes = product.sizes as Array<{ techSize?: string; skus?: string[] }>
    for (const s of sizes) {
      if (s.skus?.includes(barcode)) {
        size = s.techSize ?? null
        break
      }
    }
  }
  return { name: product.name ?? product.vendor_code ?? null, article: String(product.nm_id), size }
}

// ── Catalog product search ────────────────────────────────────

export interface CatalogProduct {
  id: string
  nm_id: number
  name: string | null
  vendor_code: string | null
  barcodes: string[]
  sizes: Array<{ techSize?: string; skus?: string[] }>
}

export const searchProducts = async (
  accountId: string,
  storeId: string | null,
  query: string,
): Promise<CatalogProduct[]> => {
  if (!supabase || !storeId || query.trim().length < 2) return []
  const { data } = await supabase
    .from('products')
    .select('id, nm_id, name, vendor_code, barcodes, sizes')
    .eq('account_id', accountId)
    .eq('store_id', storeId)
    .or(`name.ilike.%${query}%,vendor_code.ilike.%${query}%`)
    .limit(30)
  return (data ?? []) as CatalogProduct[]
}
