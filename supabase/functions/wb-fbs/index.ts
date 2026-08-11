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
    const storeRows = await sbGet(`stores`, `id=eq.${encodeURIComponent(store_id)}&select=api_key&limit=1`, true)
    const apiKey = storeRows[0]?.api_key as string | undefined
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

    if (action === 'update_stocks') {
      if (!wb_warehouse_id) return err('wb_warehouse_id обязателен')
      if (!stocks || !Array.isArray(stocks)) return err('stocks обязателен (массив)')
      await wbPut(apiKey, `/api/v3/stocks/${wb_warehouse_id}`, { stocks })
      return ok({ success: true })
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
      await wbPatchNoContent(apiKey, `/api/v3/supplies/${encodeURIComponent(supply_id)}/deliver`)
      return ok({ success: true })
    }

    if (action === 'get_supplies') {
      // isSupplyClosed=false → В сборке, true → В доставке/Завершённые
      const { closed = false, limit = 50 } = body as { closed?: boolean; limit?: number }
      const supplies = await getAllSupplies(apiKey, closed, limit)
      return ok({ supplies, next: '0' })
    }

    if (action === 'get_orders_status') {
      const { order_ids } = body as { order_ids: string[] }
      if (!order_ids?.length) return err('order_ids обязателен')
      return ok(await wbPostOrderIds(apiKey, '/api/v3/orders/status', order_ids.map(String)))
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
      return ok(parseWbJson(await r.text()))
    }

    return err('Неизвестный action')
  } catch (e) {
    const msg = String(e)
    if (msg.includes('no_permission')) return err('Нет прав доступа к WB API. Проверьте API ключ.', 403)
    return err(msg, 500)
  }
})
