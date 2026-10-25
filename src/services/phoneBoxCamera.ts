import { supabase } from '../lib/supabase'
import { confirmStepCorrection, incrementBoxItem } from './fulfillmentService'

export interface PhoneBoxItem {
  id: string
  barcode: string
  qty: number
  product_name: string | null
  vendor_code: string | null
  nm_id: string | null
  in_catalog: boolean
}

export interface PhoneBox {
  found: true
  box_id: string
  box_number: number
  barcode: string | null
  wb_barcode: string | null
  wb_external_barcode: string | null
  supply_id: string
  supply_number: number | null
  batch_id: string
  batch_short_id: number | null
  batch_name: string
  pipeline_stage_id: string | null
  store_id: string | null
  supplier: string | null
  store_name: string | null
  can_write: boolean
  packing_completed: boolean
  block_reason: 'cancelled' | 'not_started' | 'no_access' | null
  items: PhoneBoxItem[]
}

export type PhoneBoxLookup = PhoneBox | { found: false }

export interface StoreBarcodeMatch {
  found: boolean
  vendor_code: string | null
  nm_id: string | null
  name: string | null
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return value == null ? null : String(value)
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function requiredText(value: unknown, label: string): string {
  const text = textOrNull(value)
  if (!text) throw new Error(`Сервер вернул короб без поля «${label}»`)
  return text
}

export function phoneBoxErrorText(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Не получилось выполнить действие'
  if (/lookup_phone_fulfillment_box|phone_store_barcode_lookup|remove_fulfillment_box_item_qty|schema cache|could not find the function/i.test(message)) {
    return 'Камера коробов ещё не подключена на сервере. Напишите администратору.'
  }
  return message || 'Не получилось выполнить действие'
}

export async function lookupPhoneBox(code: string): Promise<PhoneBoxLookup> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('lookup_phone_fulfillment_box', { p_code: code.trim() })
  if (error) throw error
  if (!data || typeof data !== 'object') return { found: false }
  const row = data as Record<string, unknown>
  if (row.found !== true) return { found: false }
  const items = Array.isArray(row.items) ? row.items : []
  const block = row.block_reason
  return {
    found: true,
    box_id: requiredText(row.box_id, 'короб'),
    box_number: Number(row.box_number ?? 0),
    barcode: textOrNull(row.barcode),
    wb_barcode: textOrNull(row.wb_barcode),
    wb_external_barcode: textOrNull(row.wb_external_barcode),
    supply_id: requiredText(row.supply_id, 'поставка'),
    supply_number: row.supply_number == null ? null : Number(row.supply_number),
    batch_id: requiredText(row.batch_id, 'партия'),
    batch_short_id: row.batch_short_id == null ? null : Number(row.batch_short_id),
    batch_name: textOrNull(row.batch_name) ?? 'Партия',
    pipeline_stage_id: textOrNull(row.pipeline_stage_id),
    store_id: textOrNull(row.store_id),
    supplier: textOrNull(row.supplier),
    store_name: textOrNull(row.store_name),
    can_write: row.can_write === true,
    packing_completed: row.packing_completed === true,
    block_reason: block === 'cancelled' || block === 'not_started' || block === 'no_access' ? block : null,
    items: items.map((item) => {
      const line = item as Record<string, unknown>
      return {
        id: textOrNull(line.id) ?? '',
        barcode: textOrNull(line.barcode) ?? '',
        qty: Number(line.qty ?? 0),
        product_name: textOrNull(line.product_name),
        vendor_code: textOrNull(line.vendor_code),
        nm_id: textOrNull(line.nm_id),
        in_catalog: line.in_catalog === true,
      }
    }),
  }
}

export async function lookupStoreBarcode(storeId: string, barcode: string): Promise<StoreBarcodeMatch> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('phone_store_barcode_lookup', { p_store_id: storeId, p_barcode: barcode.trim() })
  if (error) throw error
  const row = (data ?? {}) as Record<string, unknown>
  return {
    found: row.found === true,
    vendor_code: textOrNull(row.vendor_code),
    nm_id: textOrNull(row.nm_id),
    name: textOrNull(row.name),
  }
}

export async function addPhoneBoxItem(boxId: string, barcode: string, qty: number, productName: string | null): Promise<void> {
  await incrementBoxItem({
    box_id: boxId,
    barcode: barcode.trim(),
    item_id: null,
    product_name: productName,
    qty,
  })
}

export async function removePhoneBoxItem(boxId: string, barcode: string, qty: number, removeAll: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }).rpc('remove_fulfillment_box_item_qty', {
    p_box_id: boxId,
    p_barcode: barcode.trim(),
    p_qty: qty,
    p_remove_all: removeAll,
  })
  if (error) throw error
}

export async function confirmPhoneBoxCorrection(batchId: string, pipelineStageId: string | null): Promise<void> {
  await confirmStepCorrection(batchId, pipelineStageId, 'packing')
}
