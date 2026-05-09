import { supabase } from '../lib/supabase'
import type {
  FulfillmentBatch,
  FulfillmentBatchWithItems,
  FulfillmentItem,
  FulfillmentOtkLog,
  FulfillmentSettings,
  FulfillmentStage,
  FulfillmentSupply,
  FulfillmentSupplyWithBoxes,
  FulfillmentBox,
  FulfillmentBoxItem,
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
      | 'trip_id'
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

// ── Stage log helpers ─────────────────────────────────────────

/** Возвращает ISO-дату завершения этапа (completed_at из fulfillment_stage_logs) или null */
export const fetchStageCompletedAt = async (
  batchId: string,
  stage: string,
): Promise<string | null> => {
  if (!supabase) return null
  const { data } = await (supabase as any)
    .from('fulfillment_stage_logs')
    .select('completed_at')
    .eq('batch_id', batchId)
    .eq('stage', stage)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { completed_at: string } | null)?.completed_at ?? null
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

export interface ProductInfo {
  nm_id: number | null
  name: string | null
  vendor_code: string | null
  category: string | null
  color: string | null
  brand: string | null
  size: string | null
  photo_url: string | null
}

export const findProductByBarcode = async (
  accountId: string,
  storeId: string | null,
  barcode: string,
): Promise<ProductInfo | null> => {
  if (!supabase || !storeId) return null
  const { data } = await (supabase as any)
    .from('products')
    .select('nm_id, name, vendor_code, category, color, brand, sizes, photos')
    .eq('account_id', accountId)
    .eq('store_id', storeId)
    .contains('barcodes', [barcode])
    .limit(1)
    .maybeSingle()
  if (!data) return null
  let size: string | null = null
  if (Array.isArray(data.sizes)) {
    for (const s of data.sizes as Array<{ techSize?: string; skus?: string[] }>) {
      if (s.skus?.includes(barcode)) { size = s.techSize ?? null; break }
    }
  }
  const photos = data.photos as Array<{ c246x328?: string; big?: string }> | null
  const photo_url = photos?.[0]?.c246x328 ?? photos?.[0]?.big ?? null
  return {
    nm_id: data.nm_id ?? null,
    name: data.name ?? null,
    vendor_code: data.vendor_code ?? null,
    category: data.category ?? null,
    color: data.color ?? null,
    brand: data.brand ?? null,
    size,
    photo_url,
  }
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
  barcode?: string | null
  item_id?: string | null
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

// ── Packing: Supplies ─────────────────────────────────────────

export const fetchSupplies = async (batchId: string): Promise<FulfillmentSupplyWithBoxes[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: supplies, error: sErr } = await (supabase as any)
    .from('fulfillment_supplies')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true })
  if (sErr) throw sErr

  const supplyIds: string[] = (supplies ?? []).map((s: FulfillmentSupply) => s.id)
  if (supplyIds.length === 0) return []

  const { data: boxes, error: bErr } = await (supabase as any)
    .from('fulfillment_boxes')
    .select('*')
    .in('supply_id', supplyIds)
    .order('box_number', { ascending: true })
  if (bErr) throw bErr

  const boxIds: string[] = (boxes ?? []).map((b: FulfillmentBox) => b.id)
  let items: FulfillmentBoxItem[] = []
  if (boxIds.length > 0) {
    const { data: itemData, error: iErr } = await (supabase as any)
      .from('fulfillment_box_items')
      .select('*')
      .in('box_id', boxIds)
      .order('created_at', { ascending: true })
    if (iErr) throw iErr
    items = itemData ?? []
  }

  return (supplies ?? []).map((supply: FulfillmentSupply) => {
    const supplyBoxes: FulfillmentBox[] = (boxes ?? []).filter(
      (b: FulfillmentBox) => b.supply_id === supply.id
    )
    const boxesWithItems = supplyBoxes.map((box: FulfillmentBox) => ({
      ...box,
      items: items.filter((i: FulfillmentBoxItem) => i.box_id === box.id),
    }))
    return { ...supply, boxes: boxesWithItems }
  })
}

export const createSupply = async (data: {
  batch_id: string
  account_id: string
  warehouse_id: string | null
  warehouse_name: string
  trip_id: string | null
  trip_line_id: string | null
  created_by: string | null
}): Promise<FulfillmentSupply> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: row, error } = await (supabase as any)
    .from('fulfillment_supplies')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return row as FulfillmentSupply
}

export const deleteSupply = async (supplyId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as any)
    .from('fulfillment_supplies')
    .delete()
    .eq('id', supplyId)
  if (error) throw error
}

export const updateSupply = async (
  supplyId: string,
  updates: Partial<Pick<FulfillmentSupply, 'trip_id' | 'trip_line_id'>>,
): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as any)
    .from('fulfillment_supplies')
    .update(updates)
    .eq('id', supplyId)
  if (error) throw error
}

/** Получить поставку Фулфилмент (с коробами и содержимым) по ID строки рейса */
export const fetchSupplyByTripLineId = async (tripLineId: string): Promise<FulfillmentSupplyWithBoxes | null> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: supplies, error: sErr } = await (supabase as any)
    .from('fulfillment_supplies')
    .select('*')
    .eq('trip_line_id', tripLineId)
    .limit(1)
  if (sErr) throw sErr
  if (!supplies || supplies.length === 0) return null

  const supply = supplies[0] as FulfillmentSupply

  const { data: boxes, error: bErr } = await (supabase as any)
    .from('fulfillment_boxes')
    .select('*')
    .eq('supply_id', supply.id)
    .order('box_number', { ascending: true })
  if (bErr) throw bErr

  const boxIds: string[] = (boxes ?? []).map((b: FulfillmentBox) => b.id)
  let items: FulfillmentBoxItem[] = []
  if (boxIds.length > 0) {
    const { data: itemData, error: iErr } = await (supabase as any)
      .from('fulfillment_box_items')
      .select('*')
      .in('box_id', boxIds)
      .order('created_at', { ascending: true })
    if (iErr) throw iErr
    items = itemData ?? []
  }

  const boxesWithItems = (boxes ?? []).map((box: FulfillmentBox) => ({
    ...box,
    items: items.filter((i: FulfillmentBoxItem) => i.box_id === box.id),
  }))

  return { ...supply, boxes: boxesWithItems }
}

// ── Packing: Boxes ────────────────────────────────────────────

export const createBox = async (data: {
  supply_id: string
  account_id: string
  box_number: number
}): Promise<FulfillmentBox> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: row, error } = await (supabase as any)
    .from('fulfillment_boxes')
    .insert({ ...data, status: 'open' })
    .select()
    .single()
  if (error) throw error
  return row as FulfillmentBox
}

export const closeBox = async (boxId: string): Promise<FulfillmentBox> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: row, error } = await (supabase as any)
    .from('fulfillment_boxes')
    .update({ status: 'closed' })
    .eq('id', boxId)
    .select()
    .single()
  if (error) throw error
  return row as FulfillmentBox
}

export const reopenBox = async (boxId: string): Promise<FulfillmentBox> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: row, error } = await (supabase as any)
    .from('fulfillment_boxes')
    .update({ status: 'open' })
    .eq('id', boxId)
    .select()
    .single()
  if (error) throw error
  return row as FulfillmentBox
}

export const deleteBox = async (boxId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as any)
    .from('fulfillment_boxes')
    .delete()
    .eq('id', boxId)
  if (error) throw error
}

// ── Packing: Box Items ────────────────────────────────────────

export const addBoxItem = async (data: {
  box_id: string
  account_id: string
  barcode: string
  item_id: string | null
  product_name: string | null
  qty: number
}): Promise<FulfillmentBoxItem> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: row, error } = await (supabase as any)
    .from('fulfillment_box_items')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return row as FulfillmentBoxItem
}

export const deleteBoxItem = async (itemId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as any)
    .from('fulfillment_box_items')
    .delete()
    .eq('id', itemId)
  if (error) throw error
}
