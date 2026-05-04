import { supabase } from '../lib/supabase'
import type {
  FulfillmentBatch,
  FulfillmentBatchWithItems,
  FulfillmentItem,
  FulfillmentOtkLog,
  FulfillmentSettings,
  FulfillmentStage,
  Product,
} from '../types'

// ── Settings ──────────────────────────────────────────────────

export const fetchFulfillmentSettings = async (accountId: string): Promise<FulfillmentSettings | null> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
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
  const { data, error } = await (supabase as any)
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
  const { data, error } = await (supabase as any)
    .from('fulfillment_batches')
    .select('*')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FulfillmentBatch[]
}

export const fetchArchivedBatches = async (accountId: string): Promise<FulfillmentBatch[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_batches')
    .select('*')
    .eq('account_id', accountId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FulfillmentBatch[]
}

export const fetchBatchWithItems = async (batchId: string): Promise<FulfillmentBatchWithItems> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const [{ data: batch, error: batchErr }, { data: items, error: itemsErr }] = await Promise.all([
    (supabase as any).from('fulfillment_batches').select('*').eq('id', batchId).single(),
    (supabase as any).from('fulfillment_items').select('*').eq('batch_id', batchId).order('sort_order').order('created_at'),
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
  const { data, error } = await (supabase as any)
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
      | 'otk_discrepancy'
    >
  >,
): Promise<FulfillmentBatch> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_batches')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', batchId)
    .select()
    .single()
  if (error) throw error
  return data as FulfillmentBatch
}

// Мягкое удаление — переносит партию в архив. Данные сохраняются.
export const deleteBatch = async (batchId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as any)
    .from('fulfillment_batches')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', batchId)
  if (error) throw error
}

// Восстановление партии из архива
export const restoreBatch = async (batchId: string): Promise<FulfillmentBatch> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_batches')
    .update({ deleted_at: null })
    .eq('id', batchId)
    .select()
    .single()
  if (error) throw error
  return data as FulfillmentBatch
}

// Безвозвратное удаление (только если нужно освободить место)
export const hardDeleteBatch = async (batchId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as any).from('fulfillment_batches').delete().eq('id', batchId)
  if (error) throw error
}

// ── Items ─────────────────────────────────────────────────────

export const addItem = async (
  item: Omit<FulfillmentItem, 'id' | 'created_at'>,
): Promise<FulfillmentItem> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any).from('fulfillment_items').insert(item).select().single()
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
  const { data, error } = await (supabase as any)
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
  const { error } = await (supabase as any).from('fulfillment_items').delete().eq('id', itemId)
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
    await (supabase as any).from('fulfillment_stage_logs').insert({ batch_id: batch.id, stage: batch.current_stage })
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

// ── OTK Logs ──────────────────────────────────────────────────

export interface OtkPerformer {
  user_id: string
  full_name: string
  email: string
}

export const fetchOtkPerformers = async (accountId: string): Promise<OtkPerformer[]> => {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await (supabase as any)
    .rpc('get_account_members_with_names', { p_account_id: accountId })
  if (error) throw error

  return ((data ?? []) as Array<{ user_id: string; full_name: string }>).map((row) => ({
    user_id: row.user_id,
    full_name: row.full_name || '—',
    email: '',
  }))
}

export const fetchOtkLogs = async (batchId: string): Promise<FulfillmentOtkLog[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_otk_logs')
    .select('*')
    .eq('batch_id', batchId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as FulfillmentOtkLog[]
}

export const fetchDeletedOtkLogs = async (batchId: string): Promise<FulfillmentOtkLog[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_otk_logs')
    .select('*')
    .eq('batch_id', batchId)
    .not('deleted_at', 'is', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as FulfillmentOtkLog[]
}

export const uploadOtkPhoto = async (
  accountId: string,
  batchId: string,
  file: File,
): Promise<string> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${accountId}/${batchId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('otk-photos').upload(path, file, { upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from('otk-photos').getPublicUrl(path)
  return data.publicUrl
}

export const addOtkLog = async (entry: {
  batch_id: string
  user_id: string
  user_email: string
  user_name?: string | null
  performer_user_id?: string | null
  performer_name: string
  tariff: string
  qty: number
  qty_defect?: number
  notes?: string
  photo_urls?: string[]
}): Promise<FulfillmentOtkLog> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_otk_logs')
    .insert({ ...entry, photo_urls: entry.photo_urls ?? [] })
    .select()
    .single()
  if (error) throw error
  return data as FulfillmentOtkLog
}

export const updateOtkLog = async (
  id: string,
  patch: { tariff?: string; qty?: number; qty_defect?: number; notes?: string; photo_urls?: string[] }
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as any)
    .from('fulfillment_otk_logs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export const deleteOtkLog = async (id: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as any)
    .from('fulfillment_otk_logs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export const addOtkLogHistory = async (entry: {
  log_id: string
  user_id: string
  user_email: string
  user_name?: string | null
  action: 'created' | 'updated' | 'deleted'
  old_values?: Record<string, unknown> | null
  new_values: Record<string, unknown>
}): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  await (supabase as any).from('fulfillment_otk_log_history').insert(entry)
}

export const patchOtkLogHistoryUserName = async (id: string, user_name: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  await (supabase as any).from('fulfillment_otk_log_history').update({ user_name }).eq('id', id)
}

export const fetchOtkLogHistory = async (logId: string) => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_otk_log_history')
    .select('*')
    .eq('log_id', logId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as import('../types').FulfillmentOtkLogHistory[]
}

// ══════════════════════════════════════════════════════════════
// Marking Logs — аналог OTK для этапа Маркировки
// ══════════════════════════════════════════════════════════════

export const fetchMarkingLogs = async (batchId: string): Promise<import('../types').FulfillmentMarkingLog[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_marking_logs')
    .select('*')
    .eq('batch_id', batchId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as import('../types').FulfillmentMarkingLog[]
}

export const fetchDeletedMarkingLogs = async (batchId: string): Promise<import('../types').FulfillmentMarkingLog[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_marking_logs')
    .select('*')
    .eq('batch_id', batchId)
    .not('deleted_at', 'is', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as import('../types').FulfillmentMarkingLog[]
}

export const addMarkingLog = async (entry: {
  batch_id: string
  user_id: string
  user_email: string
  user_name?: string | null
  performer_user_id?: string | null
  performer_name: string
  tariff: string
  qty: number
  qty_defect?: number
  notes?: string
  photo_urls?: string[]
}): Promise<import('../types').FulfillmentMarkingLog> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_marking_logs')
    .insert({ ...entry, photo_urls: entry.photo_urls ?? [] })
    .select()
    .single()
  if (error) throw error
  return data as import('../types').FulfillmentMarkingLog
}

export const updateMarkingLog = async (
  id: string,
  patch: { tariff?: string; qty?: number; qty_defect?: number; notes?: string; photo_urls?: string[] }
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as any)
    .from('fulfillment_marking_logs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export const deleteMarkingLog = async (id: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as any)
    .from('fulfillment_marking_logs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export const uploadMarkingPhoto = async (
  accountId: string,
  batchId: string,
  file: File,
): Promise<string> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `marking/${accountId}/${batchId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('otk-photos').upload(path, file, { upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from('otk-photos').getPublicUrl(path)
  return data.publicUrl
}

export const addMarkingLogHistory = async (entry: {
  log_id: string
  user_id: string
  user_email: string
  user_name?: string | null
  action: 'created' | 'updated' | 'deleted'
  old_values?: Record<string, unknown> | null
  new_values: Record<string, unknown>
}): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  await (supabase as any).from('fulfillment_marking_log_history').insert(entry)
}

export const patchMarkingLogHistoryUserName = async (id: string, user_name: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  await (supabase as any).from('fulfillment_marking_log_history').update({ user_name }).eq('id', id)
}

export const fetchMarkingLogHistory = async (logId: string) => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as any)
    .from('fulfillment_marking_log_history')
    .select('*')
    .eq('log_id', logId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as import('../types').FulfillmentMarkingLogHistory[]
}
