import { supabase } from '../lib/supabase'

export type WorkshopPool = {
  batch_id: string
  account_id: string
  issued_count: number
  active: boolean
  completed_at: string | null
}

export type WorkshopItem = {
  barcode: string
  qty: number
  product_name: string | null
}

export type WorkshopBox = {
  id: string
  box_number: number
  supply_id: string | null
  supply_box_number: number | null
  supply_number: number | null
  warehouse_name: string | null
  items: WorkshopItem[]
}

export type WorkshopState = {
  pool: WorkshopPool | null
  boxes: WorkshopBox[]
}

function db() {
  if (!supabase) throw new Error('База не настроена. Обновите страницу.')
  return supabase as any
}

export function workshopError(error: { message?: string } | null): string {
  const message = error?.message ?? ''
  if (/schema cache|does not exist|fulfillment_workshop|start_workshop_boxes|scan_workshop_box|confirm_workshop_supply/i.test(message)) {
    return 'Сбор в цехе ещё не готов в базе. Обновите страницу чуть позже.'
  }
  const clean = message.replace(/^.*ERROR:\s*/i, '').split('\n')[0].trim()
  if (/[А-Яа-яЁё]/.test(clean)) return clean
  return 'Не получилось. Повторите.'
}

function mapBox(row: any): WorkshopBox {
  const supply = row.fulfillment_supplies ?? null
  const items = (row.fulfillment_workshop_box_items ?? []) as WorkshopItem[]
  return {
    id: row.id,
    box_number: row.box_number,
    supply_id: row.supply_id ?? null,
    supply_box_number: row.supply_box_number ?? null,
    supply_number: supply?.supply_number ?? null,
    warehouse_name: supply?.warehouse_name ?? null,
    items: items
      .filter((item) => item.qty > 0)
      .sort((a, b) => a.barcode.localeCompare(b.barcode)),
  }
}

export async function fetchWorkshop(batchId: string): Promise<WorkshopState> {
  const client = db()
  const [poolResult, boxResult] = await Promise.all([
    client
      .from('fulfillment_workshop_pools')
      .select('batch_id, account_id, issued_count, active, completed_at')
      .eq('batch_id', batchId)
      .maybeSingle(),
    client
      .from('fulfillment_workshop_boxes')
      .select('id, box_number, supply_id, supply_box_number, fulfillment_supplies(supply_number, warehouse_name), fulfillment_workshop_box_items(barcode, qty, product_name)')
      .eq('batch_id', batchId)
      .order('box_number'),
  ])
  if (poolResult.error) throw new Error(workshopError(poolResult.error))
  if (boxResult.error) throw new Error(workshopError(boxResult.error))
  return {
    pool: (poolResult.data as WorkshopPool | null) ?? null,
    boxes: ((boxResult.data ?? []) as any[]).map(mapBox),
  }
}

async function poolCall(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await db().rpc(name, args)
  if (error) throw new Error(workshopError(error))
}

export type WorkshopCollection = {
  batchId: string
  name: string
  shortId: number | null
  storeId: string | null
  createdAt: string
  issuedCount: number
  active: boolean
  filledCount: number
  takenCount: number
}

export async function fetchWorkshopCollections(accountId: string): Promise<WorkshopCollection[]> {
  const client = db()
  const { data, error } = await client
    .from('fulfillment_workshop_pools')
    .select('batch_id, short_id, issued_count, active, fulfillment_batches!inner(name, store_id, created_at, deleted_at)')
    .eq('account_id', accountId)
  if (error) throw new Error(workshopError(error))
  const rows = (data ?? []) as Array<{
    batch_id: string
    short_id: number | null
    issued_count: number
    active: boolean
    fulfillment_batches: { name: string; store_id: string | null; created_at: string; deleted_at: string | null }
  }>
  const ids = rows.map((row) => row.batch_id)
  let boxes: Array<{ batch_id: string; supply_id: string | null }> = []
  if (ids.length > 0) {
    const boxResult = await client
      .from('fulfillment_workshop_boxes')
      .select('batch_id, supply_id')
      .in('batch_id', ids)
    if (boxResult.error) throw new Error(workshopError(boxResult.error))
    boxes = boxResult.data ?? []
  }
  return rows
    .filter((row) => !row.fulfillment_batches.deleted_at)
    .map((row) => {
      const own = boxes.filter((box) => box.batch_id === row.batch_id)
      const batch = row.fulfillment_batches
      return {
        batchId: row.batch_id,
        name: batch.name,
        shortId: row.short_id,
        storeId: batch.store_id,
        createdAt: batch.created_at,
        issuedCount: row.issued_count,
        active: row.active,
        filledCount: own.length,
        takenCount: own.filter((box) => box.supply_id).length,
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function deleteWorkshopCollection(batchId: string): Promise<void> {
  const { error } = await db()
    .from('fulfillment_batches')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', batchId)
    .eq('workshop_only', true)
  if (error) throw new Error(workshopError(error))
}

export async function startWorkshop(batchId: string): Promise<number | null> {
  const { data, error } = await db().rpc('start_workshop_boxes', { p_batch_id: batchId })
  if (error) throw new Error(workshopError(error))
  const row = Array.isArray(data) ? data[0] : data
  return row?.short_id ?? null
}

export async function addWorkshopShells(batchId: string): Promise<void> {
  await poolCall('add_workshop_boxes', { p_batch_id: batchId, p_add: 50 })
}

export async function completeWorkshop(batchId: string): Promise<void> {
  await poolCall('complete_workshop_boxes', { p_batch_id: batchId })
}

export async function reopenWorkshop(batchId: string): Promise<void> {
  await poolCall('reopen_workshop_boxes', { p_batch_id: batchId })
}

export async function scanWorkshopBox(
  batchId: string,
  boxNumber: number,
  barcode: string,
  productName: string,
): Promise<void> {
  await poolCall('scan_workshop_box', {
    p_batch_id: batchId,
    p_box_number: boxNumber,
    p_barcode: barcode,
    p_product_name: productName,
  })
}

export async function confirmWorkshopSupply(
  batchId: string,
  boxNumbers: number[],
  warehouseId: string,
  warehouseName: string,
  pipelineStageId: string | null,
): Promise<void> {
  const { error } = await db().rpc('confirm_workshop_supply', {
    p_batch_id: batchId,
    p_box_numbers: boxNumbers,
    p_warehouse_id: warehouseId,
    p_warehouse_name: warehouseName,
    p_pipeline_stage_id: pipelineStageId,
  })
  if (error) throw new Error(workshopError(error))
}
