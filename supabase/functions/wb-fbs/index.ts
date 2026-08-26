/**
 * wb-fbs — прокси для WB Marketplace FBS API
 * Управление FBS-заказами и остатками
 * Без внешних импортов — только Deno fetch()
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const WB_BASE = 'https://marketplace-api.wildberries.ru'
const WB_READ_ATTEMPTS = 3
const WB_REQUEST_TIMEOUT_MS = 20_000
const WB_PAGE_LIMIT = 1000

type WbOrderStatus = {
  supplierStatus: string
  wbStatus: string
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// ── Supabase helpers (pure fetch, no SDK) ───────────────────────────────────

async function sbAuthGetUser(token: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: token, apikey: SUPABASE_ANON_KEY },
  })
  if (!r.ok) return null
  const d = await r.json()
  return d?.id ?? null
}

// REST query helper — returns rows[]
async function sbGet(table: string, params: string, serviceRole = false): Promise<Record<string, unknown>[]> {
  const key = serviceRole ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  })
  if (!r.ok) throw new Error(`DB ${r.status}: ${await r.text()}`)
  return r.json()
}

async function sbWrite(
  table: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  params = '',
  prefer = 'return=representation',
): Promise<Record<string, unknown>[]> {
  const suffix = params ? `?${params}` : ''
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${suffix}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`DB ${r.status}: ${await r.text()}`)
  const text = await r.text()
  return text ? parseWbJson(text) : []
}

async function sbRpc<T>(functionName: string, body: unknown): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`DB ${r.status}: ${await r.text()}`)
  return r.json()
}

type WbStickerCatalogRow = {
  orderId: string | number
  barcode?: string | number
  partA?: string | number
  partB?: string | number
  file?: string
}

async function fetchWbStickers(apiKey: string, orderIds: string[], includeFile: boolean) {
  const response = await wbReadJson(apiKey, '/api/v3/orders/stickers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: wbOrderIdsBody(orderIds),
  }, { type: 'png', width: '58', height: '40' })
  const stickers = ((response as { stickers?: WbStickerCatalogRow[] })?.stickers ?? [])
  return includeFile ? stickers : stickers.map(({ file: _file, ...sticker }) => sticker)
}

async function cacheWbStickerCatalog(
  accountId: string,
  storeId: string,
  stickers: WbStickerCatalogRow[],
  supportsSgtin = false,
) {
  const rows = stickers.flatMap((sticker) => {
    const orderId = String(sticker.orderId ?? '')
    const partA = String(sticker.partA ?? '')
    const partB = String(sticker.partB ?? '')
    const qrValue = String(sticker.barcode ?? '') || `${partA}${partB}`
    return orderId && qrValue ? [{
      account_id: accountId,
      store_id: storeId,
      order_id: orderId,
      qr_value: qrValue,
      part_a: partA || null,
      part_b: partB || null,
      supports_sgtin: supportsSgtin,
      fetched_at: new Date().toISOString(),
    }] : []
  })
  if (rows.length > 0) {
    await sbWrite(
      'fbs_wb_qr_catalog',
      'POST',
      rows,
      'on_conflict=store_id,order_id',
      `${supportsSgtin ? 'resolution=merge-duplicates' : 'resolution=ignore-duplicates'},return=minimal`,
    )
  }
}

function metadataOrders(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[]
  const object = value as Record<string, unknown> | null
  for (const key of ['orders', 'meta', 'data']) {
    if (Array.isArray(object?.[key])) return object[key] as Record<string, unknown>[]
  }
  return []
}

function metadataOrderId(value: Record<string, unknown>): string {
  return String(value.orderId ?? value.order_id ?? value.id ?? '')
}

function currentSgtins(value: Record<string, unknown> | undefined): string[] {
  if (!value) return []
  const nested = value.meta && typeof value.meta === 'object' ? value.meta as Record<string, unknown> : value
  const raw = nested.sgtin ?? nested.sgtins
  if (Array.isArray(raw)) return raw.map(String)
  if (raw && typeof raw === 'object') {
    const inner = (raw as Record<string, unknown>).value
    if (Array.isArray(inner)) return inner.map(String)
    if (typeof inner === 'string' && inner) return [inner]
  }
  return typeof raw === 'string' && raw ? [raw] : []
}

function metadataSupportsSgtin(value: Record<string, unknown> | undefined): boolean {
  if (!value) return false
  const meta = value.meta && typeof value.meta === 'object' ? value.meta as Record<string, unknown> : {}
  if (Object.prototype.hasOwnProperty.call(meta, 'sgtin') || Object.prototype.hasOwnProperty.call(value, 'sgtin')) return true
  const details = Array.isArray(value.metaDetails) ? value.metaDetails as Record<string, unknown>[] : []
  return details.some((detail) => String(detail.key ?? '') === 'sgtin')
}

// ── WB helpers ───────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')))
    return typeof decoded?.role === 'string' ? decoded.role : null
  } catch {
    return null
  }
}

function retryDelayMs(attempt: number, response?: Response) {
  const retryAfter = response?.headers.get('Retry-After')
  if (retryAfter && Number.isFinite(Number(retryAfter))) return Math.max(0, Number(retryAfter) * 1000)
  return (attempt === 1 ? 1000 : 3000) + Math.floor(Math.random() * 300)
}

function shouldRetryStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function parseWbJson(text: string): any {
  // JSON.parse округляет int64 больше Number.MAX_SAFE_INTEGER. До разбора
  // превращаем такие числа в строки, сохраняя каждый разряд WB ID/курсора.
  const safeText = text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"')
  return JSON.parse(safeText)
}

function wbId(value: unknown): string {
  const id = String(value ?? '').trim()
  if (!/^\d+$/.test(id)) throw new Error(`WB вернул некорректный int64 ID: ${id || 'пусто'}`)
  return id
}

function wbOrderIdsBody(orderIds: string[]): string {
  const ids = orderIds.map(wbId)
  return `{"orders":[${ids.join(',')}]}`
}

async function wbReadJson(
  apiKey: string,
  path: string,
  init: RequestInit = {},
  params?: Record<string, string>,
) {
  const url = new URL(`${WB_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  let lastError: unknown = null

  for (let attempt = 1; attempt <= WB_READ_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WB_REQUEST_TIMEOUT_MS)
    let response: Response | undefined
    try {
      response = await fetch(url.toString(), {
        ...init,
        headers: { Authorization: apiKey, ...(init.headers ?? {}) },
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) throw new Error('no_permission')
      if (response.ok) return parseWbJson(await response.text())

      const responseText = await response.text()
      lastError = new Error(`WB ${response.status}: ${responseText}`)
      if (!shouldRetryStatus(response.status) || attempt === WB_READ_ATTEMPTS) throw lastError
    } catch (requestError) {
      lastError = requestError
      if (
        String(requestError).includes('no_permission')
        || (response && !shouldRetryStatus(response.status))
        || attempt === WB_READ_ATTEMPTS
      ) throw requestError
    } finally {
      clearTimeout(timeout)
    }

    const delayMs = retryDelayMs(attempt, response)
    console.warn(JSON.stringify({ scope: 'wb-fbs', event: 'wb_read_retry', path, attempt, delay_ms: delayMs, error: String(lastError) }))
    await sleep(delayMs)
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function wbGet(apiKey: string, path: string, params?: Record<string, string>) {
  return wbReadJson(apiKey, path, {}, params)
}

async function wbPostOrderIds(apiKey: string, path: string, orderIds: string[]) {
  return wbReadJson(apiKey, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: wbOrderIdsBody(orderIds),
  })
}

async function wbPut(apiKey: string, path: string, body: unknown) {
  const r = await fetch(`${WB_BASE}${path}`, {
    method: 'PUT',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (r.status === 401 || r.status === 403) throw new Error('no_permission')
  if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
  return null
}

async function wbPatchNoContent(apiKey: string, path: string, rawBody?: string) {
  const r = await fetch(`${WB_BASE}${path}`, {
    method: 'PATCH',
    headers: { Authorization: apiKey, ...(rawBody ? { 'Content-Type': 'application/json' } : {}) },
    ...(rawBody ? { body: rawBody } : {}),
  })
  if (r.status === 401 || r.status === 403) throw new Error('no_permission')
  if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

type WbStockValue = { chrtId: number; amount: number }

async function fetchWbStocks(apiKey: string, warehouseId: number, chrtIds: number[]) {
  const result = new Map<number, number>()
  for (const part of chunks(Array.from(new Set(chrtIds)), 1000)) {
    if (!part.length) continue
    const response = await wbReadJson(apiKey, `/api/v3/stocks/${warehouseId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chrtIds: part }),
    }) as { stocks?: WbStockValue[] }
    for (const stock of response?.stocks ?? []) {
      result.set(Number(stock.chrtId), Number(stock.amount) || 0)
    }
  }
  return result
}

async function canManageFbsStocks(accountId: string, userId: string, isServiceRole: boolean) {
  if (isServiceRole) return true
  const members = await sbGet(
    'account_members',
    `account_id=eq.${encodeURIComponent(accountId)}&user_id=eq.${encodeURIComponent(userId)}&select=role&limit=1`,
    true,
  )
  if (members.some((member) => ['owner', 'admin'].includes(String(member.role ?? '')))) return true

  const assignments = await sbGet(
    'role_assignments',
    `account_id=eq.${encodeURIComponent(accountId)}&user_id=eq.${encodeURIComponent(userId)}&select=roles!inner(permissions)`,
    true,
  )
  return assignments.some((assignment) => {
    const role = assignment.roles as { permissions?: Record<string, unknown> } | undefined
    return role?.permissions?.fbs_stocks_manage === true
  })
}

function stockUpdateError(error: unknown) {
  const message = errorMessage(error)
  if (message.includes('WB 400')) return { message: 'Wildberries отклонил данные остатков. Проверьте товары и количества.', status: 400 }
  if (message.includes('WB 402')) return { message: 'Wildberries требует оплату или ограничил работу магазина.', status: 402 }
  if (message.includes('WB 404')) return { message: 'Склад продавца не найден в Wildberries.', status: 404 }
  if (message.includes('WB 406')) return { message: 'Wildberries временно заблокировал обновление остатков этого склада.', status: 406 }
  if (message.includes('WB 409')) return { message: 'Wildberries не принял остатки. Проверьте доступность товаров для FBS.', status: 409 }
  if (message.includes('WB 429')) return { message: 'Слишком много запросов к Wildberries. Повторите попытку немного позже.', status: 429 }
  if (message.includes('no_permission')) return { message: 'API-ключ магазина не имеет права управлять остатками. Добавьте категорию «Маркетплейс».', status: 403 }
  return { message: 'Не удалось обновить остатки в Wildberries. Повторите попытку.', status: 502 }
}

function normalizeWbOrderStatus(status: Record<string, unknown>): WbOrderStatus {
  const supplierStatus = String(status.supplierStatus ?? '').trim()
  const wbStatus = String(status.wbStatus ?? '').trim()
  if (!supplierStatus || !wbStatus) throw new Error(`WB вернул неполный статус заказа ${String(status.id ?? '')}`)
  return { supplierStatus, wbStatus }
}

async function getAllOrdersForThirtyDays(apiKey: string, dateFromTs: number) {
  const orders: Record<string, unknown>[] = []
  let cursor = '0'
  const seenCursors = new Set<string>()

  for (let page = 1; page <= 10_000; page += 1) {
    const data = await wbGet(apiKey, '/api/v3/orders', {
      limit: String(WB_PAGE_LIMIT),
      next: cursor,
      dateFrom: String(dateFromTs),
    })
    const pageOrders = Array.isArray(data?.orders) ? data.orders as Record<string, unknown>[] : []
    orders.push(...pageOrders)

    const nextCursor = String(data?.next ?? '0')
    console.log(JSON.stringify({ scope: 'wb-fbs', event: 'orders_page_loaded', page, count: pageOrders.length, next: nextCursor }))
    if (nextCursor === '0') return orders
    if (pageOrders.length === 0) throw new Error(`WB вернул пустую страницу с ненулевым курсором ${nextCursor}`)
    if (seenCursors.has(nextCursor)) throw new Error(`WB pagination returned the same cursor: ${nextCursor}`)
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  throw new Error('WB pagination exceeded the safety limit')
}

async function getAllSupplies(apiKey: string, closed: boolean, requestedLimit = WB_PAGE_LIMIT) {
  const supplies: Record<string, unknown>[] = []
  const limit = Math.min(Math.max(requestedLimit, 1), WB_PAGE_LIMIT)
  let cursor = '0'
  const seenCursors = new Set<string>()

  for (let page = 1; page <= 10_000; page += 1) {
    const data = await wbGet(apiKey, '/api/v3/supplies', {
      limit: String(limit),
      next: cursor,
      isSupplyClosed: String(closed),
    })
    const pageSupplies = Array.isArray(data?.supplies) ? data.supplies as Record<string, unknown>[] : []
    supplies.push(...pageSupplies)
    const nextCursor = String(data?.next ?? '0')
    if (nextCursor === '0') return supplies
    if (pageSupplies.length === 0) throw new Error(`WB returned an empty supplies page with non-zero cursor ${nextCursor}`)
    if (seenCursors.has(nextCursor)) throw new Error(`WB supplies pagination returned the same cursor: ${nextCursor}`)
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  throw new Error('WB supplies pagination exceeded the safety limit')
}

async function getOrderStatuses(apiKey: string, orderIds: string[]) {
  const statuses = new Map<string, WbOrderStatus>()
  for (const batch of chunks([...new Set(orderIds)], 1000)) {
    const data = await wbPostOrderIds(apiKey, '/api/v3/orders/status', batch)
    for (const rawStatus of (Array.isArray(data?.orders) ? data.orders : [])) {
      const orderId = wbId(rawStatus.id)
      statuses.set(orderId, normalizeWbOrderStatus(rawStatus))
    }
  }
  const missingIds = orderIds.filter((orderId) => !statuses.has(orderId))
  if (missingIds.length > 0) {
    throw new Error(`WB не вернул статусы для ${missingIds.length} заказов: ${missingIds.slice(0, 10).join(', ')}`)
  }
  return statuses
}

function statusCounts(statuses: Map<string, WbOrderStatus>, newOrderIds: Set<string>) {
  const pairs: Record<string, number> = {}
  for (const status of statuses.values()) {
    const key = `${status.supplierStatus}|${status.wbStatus}`
    pairs[key] = (pairs[key] ?? 0) + 1
  }
  return { total: statuses.size, new_endpoint: newOrderIds.size, pairs }
}

function logNewOrdersReconciliation(statuses: Map<string, WbOrderStatus>, newOrderIds: Set<string>) {
  const derivedNewIds = new Set(
    [...statuses.entries()]
      .filter(([, status]) => status.supplierStatus === 'new' && status.wbStatus === 'waiting')
      .map(([orderId]) => orderId),
  )
  const onlyInNewEndpoint = [...newOrderIds].filter((orderId) => !derivedNewIds.has(orderId))
  const onlyInStatuses = [...derivedNewIds].filter((orderId) => !newOrderIds.has(orderId))
  if (onlyInNewEndpoint.length === 0 && onlyInStatuses.length === 0) return
  // Статус может измениться прямо между двумя официальными WB-запросами.
  // Ничего не придумываем: отображаем более свежую пару статусов из /orders/status,
  // а расхождение сохраняем в структурированных логах для диагностики.
  console.warn(JSON.stringify({
    scope: 'wb-fbs',
    event: 'new_orders_changed_during_sync',
    new_endpoint_count: newOrderIds.size,
    status_new_count: derivedNewIds.size,
    only_in_new_endpoint: onlyInNewEndpoint.slice(0, 20),
    only_in_statuses: onlyInStatuses.slice(0, 20),
  }))
}

async function applySyncSnapshot(params: {
  storeId: string
  accountId: string
  syncedAt: string
  snapshotFrom: string
  orders: Record<string, unknown>[]
  statuses: Array<Record<string, string>>
  counts: Record<string, unknown>
}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_fbs_sync_snapshot`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_store_id: params.storeId,
      p_account_id: params.accountId,
      p_synced_at: params.syncedAt,
      p_snapshot_from: params.snapshotFrom,
      p_orders: params.orders,
      p_statuses: params.statuses,
      p_status_counts: params.counts,
    }),
  })
  if (!response.ok) throw new Error(`DB atomic sync failed ${response.status}: ${(await response.text()).slice(0, 500)}`)
}

async function writeSyncFailure(storeId: string, message: string) {
  const previousLog = (await sbGet('fbs_sync_log', `store_id=eq.${encodeURIComponent(storeId)}&select=last_synced_at,orders_count,status_counts,snapshot_from&limit=1`, true))[0]
  const response = await fetch(`${SUPABASE_URL}/rest/v1/fbs_sync_log?on_conflict=store_id`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      store_id: storeId,
      last_synced_at: previousLog?.last_synced_at ?? null,
      orders_count: previousLog?.orders_count ?? 0,
      status_counts: previousLog?.status_counts ?? {},
      snapshot_from: previousLog?.snapshot_from ?? null,
      error: message.slice(0, 4000),
    }),
  })
  if (!response.ok) console.error(JSON.stringify({ scope: 'wb-fbs', event: 'sync_error_write_failed', status: response.status, error: await response.text() }))
}

const activeSyncs = new Map<string, Promise<Record<string, unknown>>>()

async function syncOrders(storeId: string, apiKey: string): Promise<Record<string, unknown>> {
  const dateFrom = new Date(Date.now() - 30 * 24 * 3600_000)
  const dateFromTs = Math.floor(dateFrom.getTime() / 1000)

  try {
    const [allOrders, newResult] = await Promise.all([
      getAllOrdersForThirtyDays(apiKey, dateFromTs),
      wbGet(apiKey, '/api/v3/orders/new'),
    ])
    const newOrders = Array.isArray(newResult?.orders) ? newResult.orders as Record<string, unknown>[] : []
    const newOrderIds = new Set(newOrders.map((order) => wbId(order.id)))
    const orderMap = new Map<string, Record<string, unknown>>()
    allOrders.forEach((order) => orderMap.set(wbId(order.id), order))
    newOrders.forEach((order) => orderMap.set(wbId(order.id), order))

    const statuses = await getOrderStatuses(apiKey, [...orderMap.keys()])
    logNewOrdersReconciliation(statuses, newOrderIds)

    const storeRows = await sbGet('stores', `id=eq.${encodeURIComponent(storeId)}&select=account_id&limit=1`, true)
    const accountId = storeRows[0]?.account_id
    if (!accountId) throw new Error('Магазин не найден')

    const nowIso = new Date().toISOString()
    const rows = Array.from(orderMap.entries())
      .map(([orderId, order]) => ({
        wb_order_id: orderId,
        supplier_status: statuses.get(orderId)!.supplierStatus,
        wb_system_status: statuses.get(orderId)!.wbStatus,
        supply_id: order.supplyId || null,
        rid: order.rid ?? null,
        article: order.article ?? null,
        nm_id: order.nmId ?? null,
        chrt_id: order.chrtId ?? null,
        skus: Array.isArray(order.skus) ? order.skus : [],
        price: order.price ?? 0,
        warehouse_id: order.warehouseId ?? 0,
        created_at: order.createdAt ?? null,
        ddate: order.ddate || null,
        data: order,
      }))

    const statusRows = [...statuses.entries()].map(([orderId, status]) => ({
      wb_order_id: orderId,
      supplier_status: status.supplierStatus,
      wb_system_status: status.wbStatus,
    }))
    const counts = statusCounts(statuses, newOrderIds)
    await applySyncSnapshot({
      storeId,
      accountId: String(accountId),
      syncedAt: nowIso,
      snapshotFrom: dateFrom.toISOString(),
      orders: rows,
      statuses: statusRows,
      counts,
    })
    console.log(JSON.stringify({ scope: 'wb-fbs', event: 'sync_finished', store_id: storeId, synced: rows.length, counts }))
    return { synced: rows.length, partial: false, status_counts: counts, last_synced_at: nowIso }
  } catch (syncError) {
    const message = errorMessage(syncError)
    await writeSyncFailure(storeId, message)
    console.error(JSON.stringify({ scope: 'wb-fbs', event: 'sync_failed', store_id: storeId, error: message }))
    throw syncError
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    // Auth — verify JWT via Supabase Auth REST API
    const authHdr = req.headers.get('Authorization')
    if (!authHdr) return err('Не авторизован', 401)
    const bearerToken = authHdr.replace(/^Bearer\s+/i, '')
    // Gateway Supabase уже проверяет подпись JWT. Сравнение по роли поддерживает
    // и legacy service_role JWT, и новые внутренние ключи проекта.
    const isServiceRole = bearerToken === SUPABASE_SERVICE_KEY || jwtRole(bearerToken) === 'service_role'
    const userId = isServiceRole ? 'service-role' : await sbAuthGetUser(authHdr)
    if (!userId) return err('Не авторизован', 401)

    const body = await req.json()
    const { action, store_id, wb_warehouse_id, stocks } = body

    if (!store_id) return err('store_id обязателен')

    // Verify user has access to store via RLS (use user's token)
    const anonKey = SUPABASE_ANON_KEY
    const accessRows = isServiceRole ? [{ id: store_id }] : await (async () => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/stores?id=eq.${encodeURIComponent(store_id)}&select=id&limit=1`, {
        headers: { apikey: anonKey, Authorization: authHdr, Accept: 'application/json' },
      })
      if (!r.ok) return []
      return r.json() as Promise<Record<string, unknown>[]>
    })()
    if (!accessRows.length) return err('Нет доступа к магазину', 403)

    // Get api_key via service role
    const storeRows = await sbGet(`stores`, `id=eq.${encodeURIComponent(store_id)}&select=api_key,account_id&limit=1`, true)
    const apiKey = storeRows[0]?.api_key as string | undefined
    const accountId = String(storeRows[0]?.account_id ?? '')
    if (!apiKey) return err('API ключ магазина не указан')

    // ── Actions ────────────────────────────────────────────────────────────

    if (action === 'get_orders_new') {
      const data = await wbGet(apiKey, '/api/v3/orders/new')
      return ok(data)
    }

    if (action === 'get_wb_warehouses') {
      const data = await wbGet(apiKey, '/api/v3/warehouses')
      return ok(data)
    }

    if (action === 'get_wb_warehouse_directory') {
      const [warehouses, offices] = await Promise.all([
        wbGet(apiKey, '/api/v3/warehouses'),
        wbGet(apiKey, '/api/v3/offices'),
      ])
      return ok({ warehouses, offices })
    }

    if (action === 'get_stocks') {
      const warehouseId = Number(wb_warehouse_id)
      const rawChrtIds = Array.isArray(body.chrt_ids) ? body.chrt_ids : []
      const chrtIds = Array.from(new Set(rawChrtIds.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0)))
      if (!Number.isSafeInteger(warehouseId) || warehouseId <= 0) return err('Выберите склад продавца Wildberries')
      if (!chrtIds.length) return ok({ stocks: [] })
      try {
        const values = await fetchWbStocks(apiKey, warehouseId, chrtIds)
        return ok({ stocks: chrtIds.map((chrtId) => ({ chrtId, amount: values.get(chrtId) ?? 0 })) })
      } catch (stockError) {
        const readable = stockUpdateError(stockError)
        return err(readable.message, readable.status)
      }
    }

    if (action === 'update_stocks') {
      const warehouseId = Number(wb_warehouse_id)
      if (!Number.isSafeInteger(warehouseId) || warehouseId <= 0) return err('Выберите склад продавца Wildberries')
      if (!Array.isArray(stocks) || stocks.length === 0) return err('Добавьте хотя бы одно изменение остатка')
      if (stocks.length > 5000) return err('За одну операцию можно изменить не более 5000 позиций')
      if (!await canManageFbsStocks(accountId, userId, isServiceRole)) {
        return err('У вас нет права изменять остатки FBS', 403)
      }

      const normalized = stocks.map((stock: unknown) => {
        const value = stock as Record<string, unknown>
        return {
          chrtId: Number(value?.chrtId),
          amount: Number(value?.amount),
          productBarcode: String(value?.productBarcode ?? '').trim() || null,
        }
      })
      if (normalized.some((stock) => (
        !Number.isSafeInteger(stock.chrtId)
        || stock.chrtId <= 0
        || !Number.isSafeInteger(stock.amount)
        || stock.amount < 0
        || stock.amount > 1_000_000_000
      ))) return err('Остатки должны быть целыми числами от 0 до 1 000 000 000')
      if (new Set(normalized.map((stock) => stock.chrtId)).size !== normalized.length) {
        return err('В списке изменений есть повторяющиеся размеры товара')
      }

      const warehouses = await wbGet(apiKey, '/api/v3/warehouses') as Array<{ id?: number }>
      if (!Array.isArray(warehouses) || !warehouses.some((warehouse) => Number(warehouse.id) === warehouseId)) {
        return err('Выбранный склад не найден среди складов продавца Wildberries', 404)
      }

      const requestedChrtIds = normalized.map((stock) => stock.chrtId)
      const validRows = await sbRpc<Array<{ chrt_id: number }>>('get_store_fbs_chrt_ids', {
        p_store_id: store_id,
        p_chrt_ids: requestedChrtIds,
      })
      const validChrtIds = new Set(validRows.map((row) => Number(row.chrt_id)))
      const unknown = requestedChrtIds.filter((chrtId) => !validChrtIds.has(chrtId))
      if (unknown.length) {
        return err(`Не найдены в товарах выбранного магазина размеры chrtId: ${unknown.slice(0, 5).join(', ')}`, 409)
      }

      const operationId = crypto.randomUUID()
      let previous = new Map<number, number>()
      try {
        previous = await fetchWbStocks(apiKey, warehouseId, requestedChrtIds)
        for (const [index, part] of chunks(normalized, 1000).entries()) {
          await wbPut(apiKey, `/api/v3/stocks/${warehouseId}`, {
            stocks: part.map(({ chrtId, amount }) => ({ chrtId, amount })),
          })
          if (index < Math.ceil(normalized.length / 1000) - 1) await sleep(220)
        }

        await sleep(350)
        let confirmed = await fetchWbStocks(apiKey, warehouseId, requestedChrtIds)
        let hasMismatch = normalized.some((stock) => confirmed.get(stock.chrtId) !== stock.amount)
        if (hasMismatch) {
          await sleep(700)
          confirmed = await fetchWbStocks(apiKey, warehouseId, requestedChrtIds)
          hasMismatch = normalized.some((stock) => confirmed.get(stock.chrtId) !== stock.amount)
        }

        const results = normalized.map((stock) => ({
          chrtId: stock.chrtId,
          requestedAmount: stock.amount,
          previousAmount: previous.get(stock.chrtId) ?? 0,
          confirmedAmount: confirmed.get(stock.chrtId) ?? 0,
          status: confirmed.get(stock.chrtId) === stock.amount ? 'confirmed' : 'mismatch',
        }))
        try {
          await sbWrite('fbs_stock_updates', 'POST', normalized.map((stock) => {
            const result = results.find((item) => item.chrtId === stock.chrtId)!
            return {
              operation_id: operationId,
              account_id: accountId,
              store_id,
              wb_warehouse_id: warehouseId,
              chrt_id: stock.chrtId,
              product_barcode: stock.productBarcode,
              previous_amount: result.previousAmount,
              requested_amount: stock.amount,
              confirmed_amount: result.confirmedAmount,
              status: result.status,
              changed_by: isServiceRole ? null : userId,
            }
          }), '', 'return=minimal')
        } catch (auditError) {
          console.error(JSON.stringify({ scope: 'wb-fbs', event: 'stock_audit_failed', operation_id: operationId, error: String(auditError) }))
        }
        return ok({
          success: !hasMismatch,
          operation_id: operationId,
          updated: results.filter((result) => result.status === 'confirmed').length,
          mismatched: results.filter((result) => result.status === 'mismatch').length,
          results,
        })
      } catch (stockError) {
        const readable = stockUpdateError(stockError)
        try {
          await sbWrite('fbs_stock_updates', 'POST', normalized.map((stock) => ({
            operation_id: operationId,
            account_id: accountId,
            store_id,
            wb_warehouse_id: warehouseId,
            chrt_id: stock.chrtId,
            product_barcode: stock.productBarcode,
            previous_amount: previous.get(stock.chrtId) ?? null,
            requested_amount: stock.amount,
            confirmed_amount: null,
            status: 'failed',
            error_message: readable.message,
            changed_by: isServiceRole ? null : userId,
          })), '', 'return=minimal')
        } catch (auditError) {
          console.error(JSON.stringify({ scope: 'wb-fbs', event: 'stock_failure_audit_failed', operation_id: operationId, error: String(auditError) }))
        }
        return err(readable.message, readable.status)
      }
    }

    if (action === 'get_orders_all') {
      // dateFrom/dateTo — Unix timestamp (seconds), обязательные limit + next
      const { date_from_ts } = body as { date_from_ts?: number }
      const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 3600_000) / 1000)
      const orders = await getAllOrdersForThirtyDays(apiKey, date_from_ts ?? thirtyDaysAgo)
      return ok({ orders, next: '0' })
    }

    if (action === 'sync_orders') {
      const currentSync = activeSyncs.get(store_id)
      if (currentSync) return ok({ ...(await currentSync), reused: true })

      const syncPromise = syncOrders(store_id, apiKey)
      activeSyncs.set(store_id, syncPromise)
      try {
        return ok(await syncPromise)
      } finally {
        if (activeSyncs.get(store_id) === syncPromise) activeSyncs.delete(store_id)
      }
    }

    if (action === 'create_supply') {
      const { name = '' } = body as { name?: string }
      const r = await fetch(`${WB_BASE}/api/v3/supplies`, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (r.status === 401 || r.status === 403) throw new Error('no_permission')
      if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
      return ok(await r.json())
    }

    if (action === 'add_order_to_supply') {
      const { supply_id, order_id } = body as { supply_id: string; order_id: string }
      if (!supply_id || !order_id) return err('supply_id и order_id обязательны')
      // Новый bulk-endpoint (старый /api/v3/supplies/{id}/orders/{orderId} удалён 18.12.2025)
      const r = await fetch(`${WB_BASE}/api/marketplace/v3/supplies/${encodeURIComponent(supply_id)}/orders`, {
        method: 'PATCH',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: wbOrderIdsBody([String(order_id)]),
      })
      if (r.status === 401 || r.status === 403) throw new Error('no_permission')
      // 409 = WB отклонил конкретный заказ (старый/несовместимый); возвращаем детали без throw
      if (r.status === 409) {
        const details = await r.json().catch(() => [])
        return ok({ success: false, failed: details })
      }
      if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
      return ok({ success: true })
    }

    if (action === 'deliver_supply') {
      const { supply_id } = body as { supply_id: string }
      if (!supply_id) return err('supply_id обязателен')
      const missingReservations = Number(await sbRpc<number>('count_fbs_supply_orders_missing_stock_reservation', {
        p_store_id: store_id,
        p_supply_id: supply_id,
      }))
      if (missingReservations > 0) {
        return err(`Сначала выберите короб для ${missingReservations} FBS-заказов с товаром на складе`)
      }
      await wbPatchNoContent(apiKey, `/api/v3/supplies/${encodeURIComponent(supply_id)}/deliver`)
      return ok({ success: true })
    }

    if (action === 'get_supplies') {
      // isSupplyClosed=false → В сборке, true → В доставке/Завершённые
      const { closed = false, limit = 50 } = body as { closed?: boolean; limit?: number }
      const supplies = await getAllSupplies(apiKey, closed, limit)
      return ok({ supplies, next: '0' })
    }

    if (action === 'get_supply_qr') {
      const supplyId = String(body.supply_id ?? '').trim()
      if (!supplyId) return err('ID поставки обязателен')

      // QR разрешён только для поставки, которая прямо сейчас отображается
      // в ELESTET на вкладке «В доставке».
      const supplyOrders = await sbGet(
        'fbs_orders',
        `store_id=eq.${encodeURIComponent(store_id)}&supply_id=eq.${encodeURIComponent(supplyId)}&supplier_status=eq.complete&is_in_latest_snapshot=eq.true&select=wb_system_status`,
        true,
      )
      const finalStatuses = new Set(['sold', 'canceled', 'canceled_by_client', 'declined_by_client', 'defect'])
      if (!supplyOrders.some((order) => !finalStatuses.has(String(order.wb_system_status ?? '')))) {
        return err('QR поставки можно печатать только на вкладке «В доставке»', 409)
      }

      try {
        const qr = await wbGet(apiKey, `/api/v3/supplies/${encodeURIComponent(supplyId)}/barcode`, { type: 'png' })
        const file = String(qr?.file ?? '')
        if (!file) return err('Wildberries не вернул файл QR поставки', 502)
        return ok({ barcode: String(qr?.barcode ?? supplyId), file })
      } catch (qrError) {
        const message = errorMessage(qrError)
        if (message.includes('WB 404')) return err('Поставка не найдена в Wildberries', 404)
        if (message.includes('WB 409')) return err('QR поставки ещё не готов. Обновите данные и повторите попытку.', 409)
        if (message.includes('WB 400')) return err('Wildberries не может сформировать QR этой поставки', 400)
        throw qrError
      }
    }

    if (action === 'get_orders_status') {
      const { order_ids } = body as { order_ids: string[] }
      if (!order_ids?.length) return err('order_ids обязателен')
      return ok(await wbPostOrderIds(apiKey, '/api/v3/orders/status', order_ids.map(String)))
    }

    if (action === 'get_scan_catalog') {
      const orderRows = await sbGet(
        'fbs_orders',
        `store_id=eq.${encodeURIComponent(store_id)}&supplier_status=eq.confirm&wb_system_status=eq.waiting&is_in_latest_snapshot=eq.true&select=wb_order_id,data`,
        true,
      )
      const eligibleFromSnapshot = new Set(orderRows.filter((row) => {
        const raw = (row.data ?? {}) as Record<string, unknown>
        const required = Array.isArray(raw.requiredMeta) ? raw.requiredMeta.map(String) : []
        const optional = Array.isArray(raw.optionalMeta) ? raw.optionalMeta.map(String) : []
        return required.includes('sgtin') || optional.includes('sgtin')
      }).map((row) => String(row.wb_order_id)))
      const allConfirmIds = orderRows.map((row) => String(row.wb_order_id))
      const eligibleIdsSet = new Set(eligibleFromSnapshot)
      for (let index = 0; index < allConfirmIds.length; index += 100) {
        const batchIds = allConfirmIds.slice(index, index + 100)
        const metaResponse = await wbReadJson(apiKey, '/api/marketplace/v3/orders/meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: wbOrderIdsBody(batchIds),
        })
        for (const meta of metadataOrders(metaResponse)) {
          if (metadataSupportsSgtin(meta)) eligibleIdsSet.add(metadataOrderId(meta))
        }
      }
      const eligibleIds = [...eligibleIdsSet].filter(Boolean)
      const cachedRows = await sbGet(
        'fbs_wb_qr_catalog',
        `store_id=eq.${encodeURIComponent(store_id)}&supports_sgtin=eq.true&select=order_id,qr_value,part_a,part_b`,
        true,
      )
      const cachedByOrder = new Map(cachedRows.map((row) => [String(row.order_id), row]))
      const missingIds = eligibleIds.filter((orderId) => !cachedByOrder.has(orderId))
      for (let index = 0; index < missingIds.length; index += 100) {
        const stickers = await fetchWbStickers(apiKey, missingIds.slice(index, index + 100), false)
        await cacheWbStickerCatalog(accountId, store_id, stickers, true)
        for (const sticker of stickers) {
          const orderId = String(sticker.orderId ?? '')
          const partA = String(sticker.partA ?? '')
          const partB = String(sticker.partB ?? '')
          const qrValue = String(sticker.barcode ?? '') || `${partA}${partB}`
          if (orderId && qrValue) cachedByOrder.set(orderId, {
            order_id: orderId,
            qr_value: qrValue,
            part_a: partA || null,
            part_b: partB || null,
          })
        }
      }
      const catalog = eligibleIds.flatMap((orderId) => {
        const row = cachedByOrder.get(orderId)
        return row ? [{
          orderId,
          qrValue: String(row.qr_value),
          partA: row.part_a == null ? '' : String(row.part_a),
          partB: row.part_b == null ? '' : String(row.part_b),
        }] : []
      })
      return ok({ catalog, eligible: eligibleIds.length, missing: eligibleIds.length - catalog.length })
    }

    if (action === 'submit_marking_session') {
      const sessionId = String(body.session_id ?? '')
      const deviceId = String(body.device_id ?? '')
      if (!sessionId || !deviceId) return err('session_id и device_id обязательны')

      const existingSessions = await sbGet(
        'fbs_marking_sessions',
        `id=eq.${encodeURIComponent(sessionId)}&store_id=eq.${encodeURIComponent(store_id)}&select=*&limit=1`,
        true,
      )
      const existingSession = existingSessions[0]
      if (!existingSession || existingSession.created_by !== userId || existingSession.device_id !== deviceId) {
        return err('Сессия этого устройства не найдена', 404)
      }
      if (existingSession.pending_order_id) return err('Сначала завершите или сбросьте ожидающую пару')
      if (existingSession.status === 'completed') return ok({ success: true, sent: 0, failed: 0, alreadyCompleted: true })
      if (existingSession.status === 'submitting') {
        const started = new Date(String(existingSession.submit_started_at ?? 0)).getTime()
        if (Number.isFinite(started) && Date.now() - started < 2 * 60_000) return err('Эта сессия уже отправляется', 409)
        await sbWrite('fbs_marking_sessions', 'PATCH', { status: 'partial', updated_at: new Date().toISOString() }, `id=eq.${encodeURIComponent(sessionId)}&status=eq.submitting`)
      }

      const claimed = await sbWrite(
        'fbs_marking_sessions',
        'PATCH',
        { status: 'submitting', submit_started_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        `id=eq.${encodeURIComponent(sessionId)}&store_id=eq.${encodeURIComponent(store_id)}&status=in.(active,partial)&select=*`,
      )
      if (claimed.length === 0) return err('Сессию уже завершает другое окно или устройство', 409)

      const pairRows = await sbGet(
        'fbs_marking_pairs',
        `session_id=eq.${encodeURIComponent(sessionId)}&status=in.(draft,error)&select=*&order=created_at.asc`,
        true,
      )
      if (pairRows.length === 0) {
        await sbWrite('fbs_marking_sessions', 'PATCH', { status: 'active', submit_started_at: null, updated_at: new Date().toISOString() }, `id=eq.${encodeURIComponent(sessionId)}`)
        return err('В сессии нет новых пар для отправки')
      }

      const orderIds = pairRows.map((pair) => String(pair.order_id))
      const statusResponse = await wbPostOrderIds(apiKey, '/api/v3/orders/status', orderIds)
      const statusList = Array.isArray(statusResponse)
        ? statusResponse as Record<string, unknown>[]
        : ((statusResponse as { orders?: Record<string, unknown>[] })?.orders ?? [])
      const statusByOrder = new Map(statusList.map((status) => [String(status.id ?? status.orderId ?? ''), status]))
      const metaResponse = await wbReadJson(apiKey, '/api/marketplace/v3/orders/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: wbOrderIdsBody(orderIds),
      })
      const metaByOrder = new Map(metadataOrders(metaResponse).map((meta) => [metadataOrderId(meta), meta]))

      let sent = 0
      const failures: Array<{ orderId: string; error: string }> = []
      for (const pair of pairRows) {
        const pairId = String(pair.id)
        const orderId = String(pair.order_id)
        const sgtin = String(pair.sgtin)
        try {
          const status = statusByOrder.get(orderId)
          if (String(status?.supplierStatus ?? '') !== 'confirm' || String(status?.wbStatus ?? '') !== 'waiting') {
            throw new Error('Заказ уже не находится на сборке')
          }
          const existingSgtins = currentSgtins(metaByOrder.get(orderId))
          if (existingSgtins.length > 0 && !existingSgtins.includes(sgtin)) {
            throw new Error('В Wildberries у заказа уже указан другой КИЗ')
          }
          if (!existingSgtins.includes(sgtin)) {
            await wbPut(apiKey, `/api/v3/orders/${encodeURIComponent(orderId)}/meta/sgtin`, { sgtins: [sgtin] })
          }
          await sbWrite('fbs_marking_pairs', 'PATCH', {
            status: 'sent', error: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }, `id=eq.${encodeURIComponent(pairId)}`)
          sent += 1
        } catch (pairError) {
          const message = errorMessage(pairError)
          failures.push({ orderId, error: message })
          await sbWrite('fbs_marking_pairs', 'PATCH', {
            status: 'error', error: message, updated_at: new Date().toISOString(),
          }, `id=eq.${encodeURIComponent(pairId)}`)
        }
      }
      const finishedAt = new Date().toISOString()
      await sbWrite('fbs_marking_sessions', 'PATCH', failures.length === 0 ? {
        status: 'completed', completed_at: finishedAt, submit_started_at: null,
        last_seen_at: finishedAt, updated_at: finishedAt,
      } : {
        status: 'partial', submit_started_at: null, last_seen_at: finishedAt, updated_at: finishedAt,
      }, `id=eq.${encodeURIComponent(sessionId)}`)
      return ok({ success: failures.length === 0, sent, failed: failures.length, failures })
    }

    if (action === 'get_sticker') {
      const { order_ids, fmt = 'svg', w = 58, h = 40 } = body as { order_ids: string[]; fmt?: string; w?: number; h?: number }
      if (!order_ids?.length) return err('order_ids обязателен')
      const r = await fetch(`${WB_BASE}/api/v3/orders/stickers?type=${fmt}&width=${w}&height=${h}`, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: wbOrderIdsBody(order_ids.map(String)),
      })
      if (r.status === 401 || r.status === 403) throw new Error('no_permission')
      if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
      const stickerResponse = parseWbJson(await r.text())
      await cacheWbStickerCatalog(accountId, store_id, stickerResponse?.stickers ?? [])
      return ok(stickerResponse)
    }

    return err('Неизвестный action')
  } catch (e) {
    const msg = String(e)
    if (msg.includes('no_permission')) return err('Нет прав доступа к WB API. Проверьте API ключ.', 403)
    return err(msg, 500)
  }
})
