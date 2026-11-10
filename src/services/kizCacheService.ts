import { kizHasCryptoTail, kizIdentity } from '../lib/kizCode'
import { supabase } from '../lib/supabase'

export type CachedCode = {
  id: string
  code?: string
  barcode?: string
  gtin?: string
  status?: string
  issueDate?: string
  createdDate?: string
  emissionDate?: string
}

export type CachedOperation = {
  id: string
  operationId: string
  operationType?: string
  type?: string
  status?: string
  kmsCount?: number
  codesCount?: number
  gtin?: string
  createdAt?: string
  createdDate?: string
  product: Record<string, unknown> | null
}

export type PrintCode = {
  code: string
  gtin: string
  serial: string
}

export type LabelGoods = {
  name: string
  article: string
  color: string
  size: string
}

const PAGE = 20

function db() {
  if (!supabase) throw new Error('База не настроена. Обновите страницу.')
  return supabase as any
}

function teksherGateway(message: string): boolean {
  return /502|503|504|bad gateway|nginx\/|edge function returned a non-2xx/i.test(message)
}

async function teksherInvokeOnce(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const client = db()
  const { data: { session } } = await client.auth.getSession()
  if (!session) throw new Error('Сессия истекла. Войдите снова.')
  const { data, error } = await client.functions.invoke('teksher-auth', {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) {
    let message = error.message || 'Не удалось обратиться к Teksher'
    const context = (error as { context?: Response }).context
    if (context) {
      try {
        const payload = await context.clone().json() as { error?: string }
        if (payload?.error) message = payload.error
      } catch { /* the function returned a non-JSON body */ }
    }
    throw new Error(message)
  }
  const payload = (data ?? {}) as Record<string, unknown>
  if (typeof payload.error === 'string' && payload.error) throw new Error(payload.error)
  return payload
}

async function teksherInvoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let last: Error | null = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await teksherInvokeOnce(body)
    } catch (reason) {
      last = reason instanceof Error ? reason : new Error('Не удалось обратиться к Teksher')
      if (!teksherGateway(last.message) || attempt === 2) throw last
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)))
    }
  }
  throw last ?? new Error('Не удалось обратиться к Teksher')
}

export const TEKSHER_PAGE_SIZES = [10, 20, 50, 100] as const
export type TeksherPageSize = (typeof TEKSHER_PAGE_SIZES)[number]

export function teksherPageSize(value: number): TeksherPageSize {
  return TEKSHER_PAGE_SIZES.includes(value as TeksherPageSize) ? value as TeksherPageSize : 20
}

async function syncList(
  storeId: string,
  action: 'sync_codes' | 'sync_operations',
  size: TeksherPageSize,
  onPage?: (page: number, total: number | null) => void,
): Promise<void> {
  let startedAt = ''
  for (let page = 0; page < 2000; page++) {
    const payload = await teksherInvoke({
      store_id: storeId,
      action,
      page,
      size,
      started_at: startedAt || undefined,
    })
    startedAt = String(payload.started_at ?? startedAt)
    const total = typeof payload.total === 'number' ? payload.total : null
    onPage?.(page + 1, total)
    if (payload.last === true) return
  }
  throw new Error('Teksher отдал слишком длинный список. Нажмите «Обновить» ещё раз.')
}

export function syncCachedCodes(storeId: string, size: TeksherPageSize, onPage?: (page: number, total: number | null) => void): Promise<void> {
  return syncList(storeId, 'sync_codes', size, onPage)
}

export function syncCachedOperations(storeId: string, size: TeksherPageSize, onPage?: (page: number, total: number | null) => void): Promise<void> {
  return syncList(storeId, 'sync_operations', size, onPage)
}

export async function fetchCachedCodes(
  storeId: string,
  page: number,
  status: string,
): Promise<{ items: CachedCode[]; total: number }> {
  const client = db()
  let query = client.from('teksher_codes')
    .select('teksher_id, code, barcode, gtin, status, issue_date, created_date, emission_date', { count: 'exact' })
    .eq('store_id', storeId)
    .order('created_date', { ascending: false, nullsFirst: false })
  if (status) query = query.eq('status', status)
  const from = page * PAGE
  const { data, error, count } = await query.range(from, from + PAGE - 1)
  if (error) throw new Error('Не удалось прочитать коды из базы.')
  const items = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.teksher_id ?? ''),
    code: (row.code as string | null) ?? undefined,
    barcode: (row.barcode as string | null) ?? undefined,
    gtin: (row.gtin as string | null) ?? undefined,
    status: (row.status as string | null) ?? undefined,
    issueDate: (row.issue_date as string | null) ?? undefined,
    createdDate: (row.created_date as string | null) ?? undefined,
    emissionDate: (row.emission_date as string | null) ?? undefined,
  }))
  return { items, total: count ?? items.length }
}

export async function fetchCachedOperations(
  storeId: string,
  page: number,
): Promise<{ items: CachedOperation[]; total: number }> {
  const client = db()
  const from = page * PAGE
  const { data, error, count } = await client.from('teksher_operations')
    .select('operation_id, operation_type, type, status, kms_count, codes_count, gtin, created_at_teksher, created_date, product', { count: 'exact' })
    .eq('store_id', storeId)
    .order('created_at_teksher', { ascending: false, nullsFirst: false })
    .range(from, from + PAGE - 1)
  if (error) throw new Error('Не удалось прочитать операции из базы.')
  const items = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.operation_id ?? ''),
    operationId: String(row.operation_id ?? ''),
    operationType: (row.operation_type as string | null) ?? undefined,
    type: (row.type as string | null) ?? undefined,
    status: (row.status as string | null) ?? undefined,
    kmsCount: row.kms_count == null ? undefined : Number(row.kms_count),
    codesCount: row.codes_count == null ? undefined : Number(row.codes_count),
    gtin: (row.gtin as string | null) ?? undefined,
    createdAt: (row.created_at_teksher as string | null) ?? undefined,
    createdDate: (row.created_date as string | null) ?? undefined,
    product: (row.product as Record<string, unknown> | null) ?? null,
  }))
  return { items, total: count ?? items.length }
}

function printKey(gtin: string, serial: string): string {
  return `${gtin}:${serial}`
}

export type PrintCodeCoverage = {
  saved: number
  operationIds: string[]
}

function printLinkKey(storeId: string): string {
  return `elestet-kiz-print-links:${storeId}`
}

function readPrintLinks(storeId: string): Record<string, string[]> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(printLinkKey(storeId)) ?? '{}') as Record<string, string[]>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writePrintLinks(storeId: string, links: Record<string, string[]>): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(printLinkKey(storeId), JSON.stringify(links))
}

function linkedOperationIds(storeId: string): string[] {
  return Object.entries(readPrintLinks(storeId))
    .filter(([, serials]) => serials.length > 0)
    .map(([operationId]) => operationId)
}

function rememberPrintLink(storeId: string, operationId: string, serials: string[]): void {
  if (serials.length === 0) return
  const links = readPrintLinks(storeId)
  links[operationId] = [...new Set([...(links[operationId] ?? []), ...serials])]
  writePrintLinks(storeId, links)
}

export async function loadPrintCodeCoverage(storeId: string): Promise<PrintCodeCoverage> {
  const client = db()
  let saved = 0
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await client.from('kiz_print_codes')
      .select('gtin')
      .eq('store_id', storeId)
      .range(from, from + 999)
    if (error) throw new Error('Не удалось прочитать сохранённые коды печати.')
    const rows = (data ?? []) as unknown[]
    saved += rows.length
    if (rows.length < 1000) break
  }
  return { saved, operationIds: linkedOperationIds(storeId) }
}

async function savedPrintIdentities(storeId: string): Promise<Map<string, string>> {
  const client = db()
  const found = new Map<string, string>()
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await client.from('kiz_print_codes')
      .select('gtin, serial')
      .eq('store_id', storeId)
      .range(from, from + 999)
    if (error) throw new Error('Не удалось прочитать сохранённые коды печати.')
    const rows = (data ?? []) as Array<{ gtin?: string | null; serial?: string | null }>
    for (const row of rows) {
      if (row.gtin && row.serial) found.set(row.serial, row.gtin)
    }
    if (rows.length < 1000) break
  }
  return found
}

export async function linkPrintCodesOnPage(storeId: string, operationIds: string[]): Promise<{ operationIds: string[]; gateway: boolean }> {
  const saved = await savedPrintIdentities(storeId)
  const links = readPrintLinks(storeId)
  let gateway = false
  if (saved.size > 0 && saved.size <= 50) {
    for (const operationId of operationIds) {
      if (Object.prototype.hasOwnProperty.call(links, operationId)) continue
      let listed: PrintCode[]
      try {
        listed = await fetchOperationCodes(storeId, operationId)
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : ''
        if (teksherGateway(message)) {
          gateway = true
          break
        }
        continue
      }
      const hits: string[] = []
      for (const item of listed) {
        const identity = kizIdentity(item.code) ?? (item.gtin && item.serial ? { gtin: item.gtin, serial: item.serial } : null)
        if (!identity || saved.get(identity.serial) !== identity.gtin) continue
        hits.push(identity.serial)
      }
      links[operationId] = [...new Set(hits)]
    }
    writePrintLinks(storeId, links)
  }
  return { operationIds: linkedOperationIds(storeId), gateway }
}

export async function savePrintCodes(accountId: string, storeId: string, codes: string[]): Promise<number> {
  const rows = codes.flatMap((value) => {
    const identity = kizIdentity(value)
    if (!identity || !kizHasCryptoTail(value)) return []
    return [{
      account_id: accountId,
      store_id: storeId,
      gtin: identity.gtin,
      serial: identity.serial,
      code: value,
      updated_at: new Date().toISOString(),
    }]
  })
  const client = db()
  for (let index = 0; index < rows.length; index += 200) {
    const chunk = rows.slice(index, index + 200)
    const { error } = await client.from('kiz_print_codes').upsert(chunk, { onConflict: 'store_id,gtin,serial' })
    if (error) throw new Error('Не удалось сохранить полные коды. Таблица печати ещё не создана в базе.')
  }
  return rows.length
}

async function loadPrintCodes(storeId: string, serials: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const unique = [...new Set(serials)]
  const client = db()
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100)
    const { data, error } = await client.from('kiz_print_codes')
      .select('gtin, serial, code')
      .eq('store_id', storeId)
      .in('serial', chunk)
    if (error) throw new Error('Не удалось прочитать сохранённые коды печати.')
    for (const row of data ?? []) {
      found.set(printKey(row.gtin, row.serial), row.code)
    }
  }
  return found
}

function readyLinkedCodes(stored: Map<string, string>, serials: string[]): PrintCode[] {
  const ready: PrintCode[] = []
  for (const serial of serials) {
    const match = [...stored.entries()].find(([key, code]) => key.endsWith(`:${serial}`) && kizHasCryptoTail(code))
    if (!match) continue
    const [gtin] = match[0].split(':')
    ready.push({ code: match[1], gtin, serial })
  }
  return ready
}

export async function resolvePrintCodes(storeId: string, operationId: string, expectedCount = 0): Promise<PrintCode[]> {
  const linkedSerials = readPrintLinks(storeId)[operationId] ?? []
  if (expectedCount > 0 && linkedSerials.length >= expectedCount) {
    const stored = await loadPrintCodes(storeId, linkedSerials)
    const ready = readyLinkedCodes(stored, linkedSerials)
    if (ready.length >= expectedCount) return ready
  }
  const listed = await fetchOperationCodes(storeId, operationId)
  if (listed.length === 0) return []
  const identities = listed.map((item) => kizIdentity(item.code) ?? (item.gtin && item.serial ? { gtin: item.gtin, serial: item.serial } : null))
  const stored = await loadPrintCodes(storeId, identities.flatMap((item) => item ? [item.serial] : []))
  let missing = 0
  const ready = listed.map((item, index) => {
    const identity = identities[index]
    const full = identity ? stored.get(printKey(identity.gtin, identity.serial)) : undefined
    if (!identity || !full || !kizHasCryptoTail(full)) {
      missing += 1
      return item
    }
    return { code: full, gtin: identity.gtin, serial: identity.serial }
  })
  if (missing > 0) {
    throw new Error(`Нельзя печатать: полного кода нет у ${missing} из ${listed.length}. Загрузите файл печати Текшера, в котором есть хвост 91/92.`)
  }
  rememberPrintLink(storeId, operationId, ready.map((item) => item.serial))
  return ready
}

export async function fetchOperationCodes(storeId: string, operationId: string): Promise<PrintCode[]> {
  const payload = await teksherInvoke({ store_id: storeId, action: 'operation_codes', operationId })
  const items = Array.isArray(payload.items) ? payload.items : []
  return items
    .map((item) => {
      const row = item as Record<string, unknown>
      return {
        code: String(row.code ?? ''),
        gtin: String(row.gtin ?? ''),
        serial: String(row.serial ?? ''),
      }
    })
    .filter((item) => item.code)
}

export async function fetchLabelGoods(storeId: string, gtin: string): Promise<LabelGoods> {
  const empty = { name: '', article: '', color: '', size: '' }
  if (!gtin) return empty
  const client = db()
  const { data: links, error: linkError } = await client.from('fulfillment_product_gtin_links')
    .select('wb_barcode')
    .eq('store_id', storeId)
    .eq('gtin', gtin)
    .eq('active', true)
    .limit(1)
  if (linkError) return empty
  const barcode = (links?.[0] as { wb_barcode?: string } | undefined)?.wb_barcode
  if (!barcode) return empty
  const { data, error } = await client.from('products')
    .select('vendor_code, name, color, sizes, barcodes')
    .eq('store_id', storeId)
  if (error) return empty
  const products = (data ?? []) as Array<{
    vendor_code?: string | null
    name?: string | null
    color?: string | null
    barcodes?: string[] | null
    sizes?: Array<{ techSize?: string; wbSize?: string; skus?: string[] }> | null
  }>
  const product = products.find((item) => {
    if (item.barcodes?.includes(barcode)) return true
    return (item.sizes ?? []).some((size) => size.skus?.includes(barcode))
  })
  if (!product) return empty
  const size = (product.sizes ?? []).find((item) => item.skus?.includes(barcode))
  const tech = size?.techSize?.trim() ?? ''
  const wb = size?.wbSize?.trim() ?? ''
  const sizeText = tech && wb && tech !== wb ? `${tech} (${wb})` : tech || wb
  return {
    name: product.name?.trim() ?? '',
    article: product.vendor_code?.trim() ?? '',
    color: product.color?.trim() ?? '',
    size: sizeText,
  }
}
