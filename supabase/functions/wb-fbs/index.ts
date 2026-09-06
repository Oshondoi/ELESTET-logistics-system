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

// PostgREST ограничивает один ответ тысячей строк. Для фоновой сверки нужно
// прочитать все активные заказы/поставки, поэтому идём диапазонами.
async function sbGetAll(table: string, params: string, serviceRole = false): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  const key = serviceRole ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY
  for (let offset = 0; offset < 1_000_000; offset += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        Range: `${offset}-${offset + 999}`,
      },
    })
    if (!r.ok) throw new Error(`DB ${r.status}: ${await r.text()}`)
    const page = await r.json() as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
  throw new Error(`DB pagination exceeded the safety limit for ${table}`)
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
  const responseText = await r.text()
  return (responseText ? parseWbJson(responseText) : undefined) as T
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
  if (typeof raw === 'string' && raw) return [raw]
  const detail = metadataDetail(value, 'sgtin')
  const detailValue = detail?.value
  if (Array.isArray(detailValue)) return detailValue.map(String).filter(Boolean)
  return typeof detailValue === 'string' && detailValue ? [detailValue] : []
}

function metadataDetail(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (!value) return undefined
  const details = Array.isArray(value.metaDetails) ? value.metaDetails as Record<string, unknown>[] : []
  return details.find((detail) => String(detail.key ?? detail.type ?? '').toLowerCase() === key.toLowerCase())
}

function metadataSupportsSgtin(value: Record<string, unknown> | undefined): boolean {
  if (!value) return false
  const meta = value.meta && typeof value.meta === 'object' ? value.meta as Record<string, unknown> : {}
  if (Object.prototype.hasOwnProperty.call(meta, 'sgtin') || Object.prototype.hasOwnProperty.call(value, 'sgtin')) return true
  return Boolean(metadataDetail(value, 'sgtin'))
}

function metadataSgtinSent(value: Record<string, unknown> | undefined): boolean {
  if (currentSgtins(value).length > 0) return true
  return String(metadataDetail(value, 'sgtin')?.decision ?? '').toLowerCase() === 'filled'
}

type CachedKizState = {
  requires_kiz?: boolean
  sent_to_wb?: boolean
  checked_at?: string
}

async function loadKizStateMap(storeId: string) {
  const rows = await sbGetAll(
    'fbs_kiz_order_states',
    `store_id=eq.${encodeURIComponent(storeId)}&select=order_id,requires_kiz,sent_to_wb,checked_at&order=order_id.asc`,
    true,
  )
  return new Map(rows.map((row) => [String(row.order_id ?? ''), row as CachedKizState]))
}

async function cacheKizOrderStates(
  accountId: string,
  storeId: string,
  metadata: Record<string, unknown>[],
  requestedOrderIds: string[] = [],
  existingStates?: Map<string, CachedKizState>,
) {
  const metadataByOrderId = new Map(metadata.flatMap((meta) => {
    const orderId = metadataOrderId(meta)
    return orderId ? [[orderId, meta] as const] : []
  }))
  const stateByOrderId = existingStates ?? await loadKizStateMap(storeId)
  const orderIds = requestedOrderIds.length > 0
    ? [...new Set(requestedOrderIds.map(String).filter((orderId) => Boolean(orderId) && metadataByOrderId.has(orderId)))]
    : [...metadataByOrderId.keys()]
  const rows = orderIds.map((orderId) => {
    const meta = metadataByOrderId.get(orderId)
    const previous = stateByOrderId.get(orderId)
    return {
      account_id: accountId,
      store_id: storeId,
      order_id: orderId,
      // Подтверждённый WB зелёный статус нельзя снимать из-за пустого или
      // неполного следующего ответа API. Отрицательный ответ лишь не добавляет
      // нового подтверждения.
      requires_kiz: previous?.requires_kiz === true || metadataSupportsSgtin(meta),
      sent_to_wb: previous?.sent_to_wb === true || metadataSgtinSent(meta),
      checked_at: new Date().toISOString(),
    }
  })
  if (rows.length === 0) return
  await sbWrite(
    'fbs_kiz_order_states',
    'POST',
    rows,
    'on_conflict=store_id,order_id',
    'resolution=merge-duplicates,return=minimal',
  )
  for (const row of rows) stateByOrderId.set(row.order_id, row)
}

async function refreshKizOrderStatesFromWb(
  apiKey: string,
  accountId: string,
  storeId: string,
  orderIds: string[],
  knownStates?: Map<string, CachedKizState>,
) {
  const uniqueOrderIds = [...new Set(orderIds.map(String).filter(Boolean))]
  const existingStates = knownStates ?? await loadKizStateMap(storeId)
  let checked = 0
  for (let index = 0; index < uniqueOrderIds.length; index += 100) {
    const batchIds = uniqueOrderIds.slice(index, index + 100)
    const metaResponse = await wbReadJson(apiKey, '/api/marketplace/v3/orders/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: wbOrderIdsBody(batchIds),
    })
    await cacheKizOrderStates(accountId, storeId, metadataOrders(metaResponse), batchIds, existingStates)
    checked += batchIds.length
  }
  return checked
}

async function kizOrdersToRefresh(storeId: string, onlyMissing: boolean, forceRefresh: boolean) {
  const orderRows = await sbGetAll(
    'fbs_orders',
    `store_id=eq.${encodeURIComponent(storeId)}&supplier_status=in.(confirm,complete)&is_in_latest_snapshot=eq.true&select=wb_order_id,data&order=wb_order_id.asc`,
    true,
  )
  const existingStates = await loadKizStateMap(storeId)
  const eligibleCatalogRows = onlyMissing ? await sbGetAll(
    'fbs_wb_qr_catalog',
    `store_id=eq.${encodeURIComponent(storeId)}&supports_sgtin=eq.true&select=order_id&order=order_id.asc`,
    true,
  ) : []
  const eligibleCatalogIds = new Set(eligibleCatalogRows.map((row) => String(row.order_id ?? '')))
  const orderIds = orderRows.flatMap((row) => {
    const orderId = String(row.wb_order_id ?? '')
    if (!orderId) return []
    if (!onlyMissing) return [orderId]
    const state = existingStates.get(orderId)
    if (state?.sent_to_wb === true) return []
    const checkedAt = state?.checked_at ? new Date(state.checked_at).getTime() : Number.NaN
    if (!forceRefresh && Number.isFinite(checkedAt) && Date.now() - checkedAt < 5 * 60_000) return []
    const raw = (row.data ?? {}) as Record<string, unknown>
    const required = Array.isArray(raw.requiredMeta) ? raw.requiredMeta.map(String) : []
    const optional = Array.isArray(raw.optionalMeta) ? raw.optionalMeta.map(String) : []
    const requiresKiz = state?.requires_kiz === true
      || eligibleCatalogIds.has(orderId)
      || required.includes('sgtin')
      || optional.includes('sgtin')
    return requiresKiz ? [orderId] : []
  })
  return { orderIds, existingStates }
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

function wbProblem(text: string): { code: string; message: string } {
  try {
    const parsed = parseWbJson(text) as Record<string, unknown>
    return {
      code: String(parsed.code ?? '').trim(),
      message: String(parsed.message ?? parsed.detail ?? parsed.title ?? '').trim(),
    }
  } catch {
    return { code: '', message: '' }
  }
}

async function putWbOrderSgtin(apiKey: string, orderId: string, sgtin: string) {
  let retrySeconds = 0
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${WB_BASE}/api/v3/orders/${encodeURIComponent(orderId)}/meta/sgtin`, {
      method: 'PUT',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sgtins: [sgtin] }),
    })
    if (response.ok) return
    if (response.status === 401 || response.status === 403) throw new Error('Нет доступа к Marketplace API WB')

    const responseText = await response.text()
    const problem = wbProblem(responseText)
    if (response.status === 429) {
      const headerSeconds = Number(response.headers.get('X-Ratelimit-Retry') ?? response.headers.get('Retry-After') ?? '')
      retrySeconds = Number.isFinite(headerSeconds) && headerSeconds > 0 ? headerSeconds : Math.min(2 ** attempt, 30)
      if (attempt < 4) {
        await sleep((retrySeconds * 1000) + 150)
        continue
      }
      throw new Error(`WB временно ограничил частоту запросов. Повторите отправку через ${retrySeconds} сек.`)
    }
    if (response.status === 409 && (problem.code === 'FailedToUpdateMeta' || /Processing status|confirm/i.test(problem.message))) {
      throw new Error('WB отклонил КИЗ: заказ уже не находится «На сборке». После передачи «В доставку» WB не разрешает изменять КИЗ.')
    }
    const wbCode = problem.code ? `, ${problem.code}` : ''
    throw new Error(`WB отклонил КИЗ заказа №${orderId} (HTTP ${response.status}${wbCode}).`)
  }
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

async function getAllOrdersForPeriod(apiKey: string, dateFromTs: number, dateToTs?: number) {
  const orders: Record<string, unknown>[] = []
  let cursor = '0'
  const seenCursors = new Set<string>()

  for (let page = 1; page <= 10_000; page += 1) {
    const data = await wbGet(apiKey, '/api/v3/orders', {
      limit: String(WB_PAGE_LIMIT),
      next: cursor,
      dateFrom: String(dateFromTs),
      ...(dateToTs ? { dateTo: String(dateToTs) } : {}),
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

type SyncMode = 'incremental' | 'full'
type SyncTrigger = 'automatic' | 'manual' | 'store_connected' | 'nightly'

type NormalizedSupply = {
  wb_supply_id: string
  name: string | null
  done: boolean
  wb_created_at: string | null
  wb_closed_at: string | null
  wb_scan_at: string | null
  destination_office_id: number | null
  cargo_type: number | null
  cross_border_type: number | null
  is_b2b: boolean | null
  raw_data: Record<string, unknown>
}

const finalWbStatuses = new Set([
  'sold', 'canceled', 'canceled_by_client', 'declined_by_client', 'defect',
])

function nullableNumber(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function nullableTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const timestamp = new Date(value)
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null
}

function normalizeSupply(raw: Record<string, unknown>): NormalizedSupply | null {
  const supplyId = String(raw.id ?? '').trim()
  if (!supplyId) return null
  return {
    wb_supply_id: supplyId,
    name: String(raw.name ?? '').trim() || null,
    done: raw.done === true,
    wb_created_at: nullableTimestamp(raw.createdAt ?? raw.created_at),
    wb_closed_at: nullableTimestamp(raw.closedAt ?? raw.closed_at),
    wb_scan_at: nullableTimestamp(raw.scanDt ?? raw.scan_dt),
    destination_office_id: nullableNumber(raw.destinationOfficeId ?? raw.destination_office_id),
    cargo_type: nullableNumber(raw.cargoType ?? raw.cargo_type),
    cross_border_type: nullableNumber(raw.crossBorderType ?? raw.cross_border_type),
    is_b2b: typeof raw.isB2b === 'boolean' ? raw.isB2b : null,
    raw_data: raw,
  }
}

function mergeSupply(left: Record<string, unknown>, right: Record<string, unknown>) {
  const merged = { ...left, ...right }
  for (const key of ['createdAt', 'closedAt', 'scanDt', 'name', 'destinationOfficeId', 'cargoType', 'crossBorderType']) {
    if (right[key] == null || right[key] === '') merged[key] = left[key]
  }
  merged.done = left.done === true || right.done === true
  return merged
}

async function getAllSupplyMetadata(apiKey: string, mode: SyncMode) {
  // Быстрый режиму достаточно всех открытых и последней страницы закрытых
  // поставок: именно там появляются только что переданные поставки. Полная
  // сверка ночью и по отдельной кнопке проходит всю пагинацию закрытых.
  const recentClosedPromise = mode === 'full'
    ? getAllSupplies(apiKey, true, WB_PAGE_LIMIT)
    : wbGet(apiKey, '/api/v3/supplies', {
        limit: String(WB_PAGE_LIMIT),
        next: '0',
        isSupplyClosed: 'true',
      }).then((data) => Array.isArray(data?.supplies) ? data.supplies as Record<string, unknown>[] : [])
  const [openSupplies, closedSupplies] = await Promise.all([
    getAllSupplies(apiKey, false, WB_PAGE_LIMIT),
    recentClosedPromise,
  ])
  const supplyMap = new Map<string, Record<string, unknown>>()
  for (const supply of [...openSupplies, ...closedSupplies]) {
    const supplyId = String(supply.id ?? '').trim()
    if (!supplyId) continue
    supplyMap.set(supplyId, supplyMap.has(supplyId) ? mergeSupply(supplyMap.get(supplyId)!, supply) : supply)
  }
  return [...supplyMap.values()]
}

function normalizedOrderRows(
  orderMap: Map<string, Record<string, unknown>>,
  statuses: Map<string, WbOrderStatus>,
) {
  return [...orderMap.entries()].map(([orderId, order]) => ({
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
}

function normalizedStatusRows(statuses: Map<string, WbOrderStatus>) {
  return [...statuses.entries()].map(([orderId, status]) => ({
    wb_order_id: orderId,
    supplier_status: status.supplierStatus,
    wb_system_status: status.wbStatus,
  }))
}

async function syncOrdersIncremental(storeId: string, accountId: string, apiKey: string) {
  const [newResult, cachedOrders] = await Promise.all([
    wbGet(apiKey, '/api/v3/orders/new'),
    sbGetAll(
      'fbs_orders',
      `store_id=eq.${encodeURIComponent(storeId)}&is_in_latest_snapshot=eq.true&select=wb_order_id,supplier_status,wb_system_status`,
      true,
    ),
  ])
  const newOrders = Array.isArray(newResult?.orders) ? newResult.orders as Record<string, unknown>[] : []
  const newOrderIds = new Set(newOrders.map((order) => wbId(order.id)))
  const cachedByOrderId = new Map(cachedOrders.map((order) => [String(order.wb_order_id), order]))
  const activeOrderIds = cachedOrders
    .filter((order) => {
      const supplierStatus = String(order.supplier_status ?? '')
      const wbStatus = String(order.wb_system_status ?? '')
      return supplierStatus === 'new' || supplierStatus === 'confirm'
        || (supplierStatus === 'complete' && !finalWbStatuses.has(wbStatus))
    })
    .map((order) => String(order.wb_order_id))
  const idsToCheck = [...new Set([...activeOrderIds, ...newOrderIds])]
  const statuses = await getOrderStatuses(apiKey, idsToCheck)
  logNewOrdersReconciliation(statuses, newOrderIds)
  const changedStatuses = new Map(
    [...statuses.entries()].filter(([orderId, status]) => {
      const previous = cachedByOrderId.get(orderId)
      return !previous
        || String(previous.supplier_status ?? '') !== status.supplierStatus
        || String(previous.wb_system_status ?? '') !== status.wbStatus
    }),
  )
  const orderMap = new Map(newOrders.map((order) => [wbId(order.id), order]))
  const nowIso = new Date().toISOString()
  const counts = statusCounts(statuses, newOrderIds)
  await sbRpc('apply_fbs_incremental_sync', {
    p_store_id: storeId,
    p_account_id: accountId,
    p_synced_at: nowIso,
    p_new_orders: normalizedOrderRows(orderMap, statuses),
    p_statuses: normalizedStatusRows(changedStatuses),
    p_status_counts: counts,
  })
  return {
    synced: idsToCheck.length,
    new_orders: newOrders.length,
    changed_statuses: changedStatuses.size,
    counts,
    last_synced_at: nowIso,
  }
}

async function getFullOrderHistory(apiKey: string, supplies: NormalizedSupply[]) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const supplyTimes = supplies
    .map((supply) => supply.wb_created_at ? new Date(supply.wb_created_at).getTime() : Number.NaN)
    .filter(Number.isFinite)
  const fallbackStart = Date.now() - 30 * 24 * 3600_000
  // Заказ создаётся раньше поставки и может быть добавлен в неё значительно
  // позже. Поэтому createdAt поставки нельзя использовать как нижнюю границу
  // истории без запаса: WB фильтрует /orders именно по дате заказа.
  const supplyHistoryStart = supplyTimes.length > 0
    ? Math.min(...supplyTimes) - 90 * 24 * 3600_000
    : fallbackStart
  const historyStartMs = Math.min(supplyHistoryStart, fallbackStart)
  const orderMap = new Map<string, Record<string, unknown>>()
  const maxWindowSeconds = (30 * 24 * 3600) - 1

  for (let dateFrom = Math.floor(historyStartMs / 1000); dateFrom <= nowSeconds;) {
    const dateTo = Math.min(dateFrom + maxWindowSeconds, nowSeconds)
    const periodOrders = await getAllOrdersForPeriod(apiKey, dateFrom, dateTo)
    for (const order of periodOrders) orderMap.set(wbId(order.id), order)
    dateFrom = dateTo + 1
  }
  const newResult = await wbGet(apiKey, '/api/v3/orders/new')
  const newOrders = Array.isArray(newResult?.orders) ? newResult.orders as Record<string, unknown>[] : []
  for (const order of newOrders) orderMap.set(wbId(order.id), order)
  return { orderMap, newOrderIds: new Set(newOrders.map((order) => wbId(order.id))), historyStartMs }
}

async function syncOrdersFull(
  storeId: string,
  accountId: string,
  apiKey: string,
  supplies: NormalizedSupply[],
  syncId: string,
) {
  const { orderMap, newOrderIds, historyStartMs } = await getFullOrderHistory(apiKey, supplies)
  const statuses = await getOrderStatuses(apiKey, [...orderMap.keys()])
  logNewOrdersReconciliation(statuses, newOrderIds)
  const nowIso = new Date().toISOString()
  const counts = statusCounts(statuses, newOrderIds)
  const orderRows = normalizedOrderRows(orderMap, statuses)
  for (const orderBatch of chunks(orderRows, 250)) {
    await sbRpc('apply_fbs_full_sync_batch', {
      p_store_id: storeId,
      p_account_id: accountId,
      p_sync_id: syncId,
      p_synced_at: nowIso,
      p_orders: orderBatch,
    })
  }
  await sbRpc('finish_fbs_full_sync', {
    p_store_id: storeId,
    p_sync_id: syncId,
    p_synced_at: nowIso,
    p_snapshot_from: new Date(historyStartMs).toISOString(),
    p_orders_count: orderMap.size,
    p_status_counts: counts,
  })
  return { synced: orderMap.size, counts, last_synced_at: nowIso }
}

async function fetchSupplyMemberships(apiKey: string, supplies: NormalizedSupply[]) {
  const memberships: Array<{ wb_supply_id: string; wb_order_id: string }> = []
  const loadedSupplyIds: string[] = []
  const failedSupplyIds: string[] = []
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < supplies.length) {
      const index = nextIndex
      nextIndex += 1
      const supply = supplies[index]
      try {
        const data = await wbGet(apiKey, `/api/marketplace/v3/supplies/${encodeURIComponent(supply.wb_supply_id)}/order-ids`)
        const orderIds = Array.isArray(data?.orderIds) ? data.orderIds : []
        for (const orderId of orderIds) {
          const normalizedId = wbId(orderId)
          if (normalizedId) memberships.push({ wb_supply_id: supply.wb_supply_id, wb_order_id: normalizedId })
        }
        loadedSupplyIds.push(supply.wb_supply_id)
      } catch (membershipError) {
        const message = errorMessage(membershipError)
        if (message.includes('no_permission') || message.includes('WB 401') || message.includes('WB 403')) throw membershipError
        failedSupplyIds.push(supply.wb_supply_id)
        console.warn(JSON.stringify({
          scope: 'wb-fbs', event: 'supply_membership_failed',
          supply_id: supply.wb_supply_id, error: message,
        }))
      }
      await sleep(410)
    }
  }
  await Promise.all([worker(), worker()])
  return { memberships, loadedSupplyIds, failedSupplyIds }
}

async function syncSupplyTimeline(
  storeId: string,
  accountId: string,
  apiKey: string,
  rawSupplies: Record<string, unknown>[],
  mode: SyncMode,
  trigger: SyncTrigger,
) {
  const supplies = rawSupplies.map(normalizeSupply).filter((supply): supply is NormalizedSupply => Boolean(supply))
  const existingRows = await sbGetAll(
    'fbs_supplies',
    `store_id=eq.${encodeURIComponent(storeId)}&select=wb_supply_id,done,wb_closed_at,wb_scan_at,last_orders_synced_at`,
    true,
  )
  const existing = new Map(existingRows.map((row) => [String(row.wb_supply_id), row]))
  const recentBoundary = Date.now() - 45 * 24 * 3600_000
  const incrementalSuppliesToLoad = supplies.filter((supply) => {
    if (mode === 'full') return true
    const previous = existing.get(supply.wb_supply_id)
    const isRecent = supply.wb_created_at ? new Date(supply.wb_created_at).getTime() >= recentBoundary : false
    if (!previous) return !supply.done || isRecent
    return !supply.done
      || !previous.last_orders_synced_at
      || String(previous.wb_closed_at ?? '') !== String(supply.wb_closed_at ?? '')
      || String(previous.wb_scan_at ?? '') !== String(supply.wb_scan_at ?? '')
  })
  const fullRefreshBoundary = Date.now() - 20 * 3600_000
  const pendingFullSupplies = mode === 'full' ? supplies.filter((supply) => {
    const previous = existing.get(supply.wb_supply_id)
    const lastOrdersSync = previous?.last_orders_synced_at
      ? new Date(String(previous.last_orders_synced_at)).getTime()
      : Number.NaN
    return !Number.isFinite(lastOrdersSync) || lastOrdersSync < fullRefreshBoundary
  }) : []
  // Ночная история больших магазинов продолжается небольшими этапами. Ручная
  // полная сверка выбранного магазина остаётся полной в одном запуске.
  const suppliesToLoad = mode === 'full'
    ? (trigger === 'nightly' ? pendingFullSupplies.slice(0, 40) : supplies)
    : incrementalSuppliesToLoad
  const fullMembershipComplete = mode === 'full'
    && (trigger !== 'nightly' || pendingFullSupplies.length <= suppliesToLoad.length)
  const membershipSupplyIds = new Set(suppliesToLoad.map((supply) => supply.wb_supply_id))
  const suppliesToPersist = supplies.filter((supply) => {
    const previous = existing.get(supply.wb_supply_id)
    return (mode === 'full' && trigger !== 'nightly')
      || !previous
      || membershipSupplyIds.has(supply.wb_supply_id)
      || Boolean(previous.done) !== supply.done
      || String(previous.wb_closed_at ?? '') !== String(supply.wb_closed_at ?? '')
      || String(previous.wb_scan_at ?? '') !== String(supply.wb_scan_at ?? '')
  })
  const membershipResult = await fetchSupplyMemberships(apiKey, suppliesToLoad)
  const membershipsBySupply = new Map<string, Array<{ wb_supply_id: string; wb_order_id: string }>>()
  for (const membership of membershipResult.memberships) {
    const rows = membershipsBySupply.get(membership.wb_supply_id) ?? []
    rows.push(membership)
    membershipsBySupply.set(membership.wb_supply_id, rows)
  }
  const loadedSet = new Set(membershipResult.loadedSupplyIds)
  const nowIso = new Date().toISOString()
  const aggregate = { supplies: 0, memberships: 0, attempts: 0 }

  for (const supplyBatch of chunks(suppliesToPersist, mode === 'full' ? 5 : 50)) {
    const loadedIds = supplyBatch.map((supply) => supply.wb_supply_id).filter((supplyId) => loadedSet.has(supplyId))
    const memberships = loadedIds.flatMap((supplyId) => membershipsBySupply.get(supplyId) ?? [])
    const result = await sbRpc<Record<string, number>>('apply_fbs_supply_sync_batch', {
      p_store_id: storeId,
      p_account_id: accountId,
      p_synced_at: nowIso,
      p_supplies: supplyBatch,
      p_memberships: memberships,
      p_loaded_supply_ids: loadedIds,
      p_is_full: false,
    })
    aggregate.supplies += Number(result?.supplies ?? 0)
    aggregate.memberships += Number(result?.memberships ?? 0)
    aggregate.attempts += Number(result?.attempts ?? 0)
  }
  if (suppliesToPersist.length === 0 || (fullMembershipComplete && membershipResult.failedSupplyIds.length === 0)) {
    await sbRpc('apply_fbs_supply_sync_batch', {
      p_store_id: storeId,
      p_account_id: accountId,
      p_synced_at: nowIso,
      p_supplies: [],
      p_memberships: [],
      p_loaded_supply_ids: [],
      p_is_full: fullMembershipComplete && membershipResult.failedSupplyIds.length === 0,
    })
  }
  return {
    ...aggregate,
    received_supplies: supplies.length,
    persisted_supplies: suppliesToPersist.length,
    checked_memberships: membershipResult.loadedSupplyIds.length,
    failed_memberships: membershipResult.failedSupplyIds.length,
    failed_supply_ids: membershipResult.failedSupplyIds.slice(0, 20),
    partial: membershipResult.failedSupplyIds.length > 0 || (mode === 'full' && !fullMembershipComplete),
  }
}

async function startSyncJob(storeId: string, mode: SyncMode, trigger: SyncTrigger, requestedBy: string | null) {
  const rows = await sbRpc<Array<{ job_id: string; acquired: boolean; active_job_type: string }>>('start_fbs_sync_job', {
    p_store_id: storeId,
    p_job_type: mode,
    p_trigger_source: trigger,
    p_requested_by: requestedBy,
  })
  return rows[0]
}

async function finishSyncJob(jobId: string, status: 'completed' | 'failed' | 'skipped', counts: unknown, error: string | null) {
  await sbRpc('finish_fbs_sync_job', {
    p_job_id: jobId,
    p_status: status,
    p_result_counts: counts ?? {},
    p_error: error,
  })
}

const activeSyncs = new Map<string, Promise<Record<string, unknown>>>()

async function syncStore(
  storeId: string,
  accountId: string,
  apiKey: string,
  mode: SyncMode,
  trigger: SyncTrigger,
  requestedBy: string | null,
): Promise<Record<string, unknown>> {
  const job = await startSyncJob(storeId, mode, trigger, requestedBy)
  if (!job?.acquired) {
    return { reused: true, job_id: job?.job_id, active_job_type: job?.active_job_type, partial: false }
  }

  try {
    const rawSupplies = await getAllSupplyMetadata(apiKey, mode)
    const normalizedSupplies = rawSupplies
      .map(normalizeSupply)
      .filter((supply): supply is NormalizedSupply => Boolean(supply))
    const previousSync = mode === 'full' && trigger === 'nightly'
      ? (await sbGet('fbs_sync_log', `store_id=eq.${encodeURIComponent(storeId)}&select=last_full_at&limit=1`, true))[0]
      : undefined
    const previousFullAt = previousSync?.last_full_at
      ? new Date(String(previousSync.last_full_at)).getTime()
      : Number.NaN
    const orderHistoryIsFresh = Number.isFinite(previousFullAt)
      && previousFullAt >= Date.now() - 20 * 3600_000
    const orderResult = mode === 'full' && !orderHistoryIsFresh
      ? await syncOrdersFull(storeId, accountId, apiKey, normalizedSupplies, job.job_id)
      : await syncOrdersIncremental(storeId, accountId, apiKey)
    const supplyResult = await syncSupplyTimeline(storeId, accountId, apiKey, rawSupplies, mode, trigger)
    let nightlyKizChecked = 0
    if (mode === 'full' && trigger === 'nightly') {
      const { orderIds, existingStates } = await kizOrdersToRefresh(storeId, true, true)
      nightlyKizChecked = await refreshKizOrderStatesFromWb(
        apiKey, accountId, storeId, orderIds, existingStates,
      )
    }
    const result = {
      mode,
      synced: orderResult.synced,
      new_orders: 'new_orders' in orderResult ? orderResult.new_orders : null,
      changed_statuses: 'changed_statuses' in orderResult ? orderResult.changed_statuses : null,
      status_counts: orderResult.counts,
      supplies: supplyResult,
      kiz_checked: nightlyKizChecked,
      partial: supplyResult.partial,
      last_synced_at: orderResult.last_synced_at,
      job_id: job.job_id,
    }
    await finishSyncJob(job.job_id, 'completed', result, null)
    console.log(JSON.stringify({ scope: 'wb-fbs', event: 'sync_finished', store_id: storeId, ...result }))
    return result
  } catch (syncError) {
    const message = errorMessage(syncError)
    await Promise.allSettled([
      writeSyncFailure(storeId, message),
      finishSyncJob(job.job_id, 'failed', {}, message),
    ])
    console.error(JSON.stringify({ scope: 'wb-fbs', event: 'sync_failed', store_id: storeId, mode, error: message }))
    throw syncError
  }
}

async function syncAllStores(mode: SyncMode, trigger: SyncTrigger) {
  const stores = await sbGetAll(
    'stores',
    'api_key=not.is.null&deleted_at=is.null&select=id,account_id,api_key',
    true,
  )
  const results: Array<Record<string, unknown>> = []
  let nextStore = 0
  const worker = async () => {
    while (nextStore < stores.length) {
      const store = stores[nextStore]
      nextStore += 1
      const storeId = String(store.id)
      try {
        const result = await syncStore(
          storeId,
          String(store.account_id),
          String(store.api_key),
          mode,
          trigger,
          null,
        )
        results.push({ store_id: storeId, ok: true, ...result })
      } catch (storeError) {
        results.push({ store_id: storeId, ok: false, error: errorMessage(storeError) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(mode === 'full' ? 2 : 4, Math.max(stores.length, 1)) }, worker))
  return {
    mode,
    stores: stores.length,
    succeeded: results.filter((result) => result.ok === true).length,
    failed: results.filter((result) => result.ok !== true).length,
    results,
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

    // Серверный планировщик вызывает этот режим service-role токеном. Ошибка
    // одного магазина сохраняется отдельно и не останавливает остальные.
    if (action === 'sync_all_stores') {
      if (!isServiceRole) return err('Доступно только системному планировщику', 403)
      const requestedMode = body.mode === 'full' ? 'full' : 'incremental'
      const trigger: SyncTrigger = requestedMode === 'full' ? 'nightly' : 'automatic'
      return ok(await syncAllStores(requestedMode, trigger))
    }

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
      const rawChrtIds: unknown[] = Array.isArray(body.chrt_ids) ? body.chrt_ids : []
      const chrtIds: number[] = Array.from(new Set(
        rawChrtIds.map((value: unknown) => Number(value)).filter((value: number) => Number.isSafeInteger(value) && value > 0),
      ))
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
      const { date_from_ts, date_to_ts } = body as { date_from_ts?: number; date_to_ts?: number }
      const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 3600_000) / 1000)
      const orders = await getAllOrdersForPeriod(apiKey, date_from_ts ?? thirtyDaysAgo, date_to_ts)
      return ok({ orders, next: '0' })
    }

    if (action === 'sync_orders' || action === 'sync_store_service') {
      if (action === 'sync_store_service' && !isServiceRole) {
        return err('Доступно только системному планировщику', 403)
      }
      const mode: SyncMode = body.mode === 'full' ? 'full' : 'incremental'
      const isManualRequest = action === 'sync_orders' && body.trigger_source === 'manual'
      if (action === 'sync_orders' && mode === 'incremental' && !isManualRequest) {
        const previousRows = await sbGet(
          'fbs_sync_log',
          `store_id=eq.${encodeURIComponent(store_id)}&select=last_incremental_at,last_synced_at&limit=1`,
          true,
        )
        const previousTimestamp = previousRows[0]?.last_incremental_at ?? previousRows[0]?.last_synced_at
        const previousTime = previousTimestamp ? new Date(String(previousTimestamp)).getTime() : Number.NaN
        if (Number.isFinite(previousTime) && Date.now() - previousTime < 5 * 60_000) {
          return ok({
            mode,
            reused: true,
            throttled: true,
            partial: false,
            synced: 0,
            last_synced_at: new Date(previousTime).toISOString(),
          })
        }
      }
      const currentSync = activeSyncs.get(store_id)
      if (currentSync) return ok({ ...(await currentSync), reused: true })

      const syncPromise = syncStore(
        store_id,
        accountId,
        apiKey,
        mode,
        action === 'sync_store_service'
          ? (mode === 'full' ? 'nightly' : 'automatic')
          : (mode === 'full' || isManualRequest ? 'manual' : 'automatic'),
        isServiceRole ? null : userId,
      )
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
      const orderRows = await sbGetAll(
        'fbs_orders',
        `store_id=eq.${encodeURIComponent(store_id)}&supplier_status=eq.confirm&wb_system_status=eq.waiting&is_in_latest_snapshot=eq.true&select=wb_order_id,data&order=wb_order_id.asc`,
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
      const existingKizStates = await loadKizStateMap(store_id)
      for (let index = 0; index < allConfirmIds.length; index += 100) {
        const batchIds = allConfirmIds.slice(index, index + 100)
        const metaResponse = await wbReadJson(apiKey, '/api/marketplace/v3/orders/meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: wbOrderIdsBody(batchIds),
        })
        const metadata = metadataOrders(metaResponse)
        await cacheKizOrderStates(accountId, store_id, metadata, batchIds, existingKizStates)
        for (const meta of metadata) {
          if (metadataSupportsSgtin(meta)) eligibleIdsSet.add(metadataOrderId(meta))
        }
      }
      const eligibleIds = [...eligibleIdsSet].filter(Boolean)
      const cachedRows = await sbGetAll(
        'fbs_wb_qr_catalog',
        `store_id=eq.${encodeURIComponent(store_id)}&supports_sgtin=eq.true&select=order_id,qr_value,part_a,part_b&order=order_id.asc`,
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

    if (action === 'diagnose_scan_qr') {
      const scanValues: string[] = Array.isArray(body.scan_values)
        ? [...new Set((body.scan_values as unknown[]).map((value: unknown) => String(value ?? '').trim()).filter(Boolean))].slice(0, 8)
        : []
      if (scanValues.length === 0 || scanValues.some((value) => value.length > 300)) return err('Некорректный QR для диагностики')

      let catalogRow: Record<string, unknown> | undefined
      for (const scanValue of scanValues) {
        const rows = await sbGet(
          'fbs_wb_qr_catalog',
          `store_id=eq.${encodeURIComponent(store_id)}&qr_value=eq.${encodeURIComponent(scanValue)}&select=order_id,supports_sgtin&limit=1`,
          true,
        )
        if (rows[0]) {
          catalogRow = rows[0]
          break
        }
      }
      if (!catalogRow) return ok({ found: false })

      const orderId = String(catalogRow.order_id ?? '')
      const orderRows = await sbGet(
        'fbs_orders',
        `store_id=eq.${encodeURIComponent(store_id)}&wb_order_id=eq.${encodeURIComponent(orderId)}&select=wb_order_id,supplier_status,wb_system_status,is_in_latest_snapshot&limit=1`,
        true,
      )
      const order = orderRows[0]
      return ok({
        found: true,
        orderId,
        supportsSgtin: catalogRow.supports_sgtin === true,
        orderFound: Boolean(order),
        isLatest: order?.is_in_latest_snapshot === true,
        supplierStatus: String(order?.supplier_status ?? ''),
        wbStatus: String(order?.wb_system_status ?? ''),
      })
    }

    if (action === 'get_kiz_order_states') {
      const onlyMissing = body.only_missing !== false
      const forceRefresh = body.force === true
      const { orderIds, existingStates } = await kizOrdersToRefresh(store_id, onlyMissing, forceRefresh)
      const checked = await refreshKizOrderStatesFromWb(apiKey, accountId, store_id, orderIds, existingStates)
      return ok({ checked, requested: orderIds.length, only_missing: onlyMissing })
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
      // WB rejects large metadata reads even though the status endpoint accepts
      // the same list. Their integration guidance recommends batches of 50-100.
      const initialMetadata: Record<string, unknown>[] = []
      for (let index = 0; index < orderIds.length; index += 100) {
        const batchIds = orderIds.slice(index, index + 100)
        const metaResponse = await wbReadJson(apiKey, '/api/marketplace/v3/orders/meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: wbOrderIdsBody(batchIds),
        })
        initialMetadata.push(...metadataOrders(metaResponse))
      }
      const metaByOrder = new Map(initialMetadata.map((meta) => [metadataOrderId(meta), meta]))
      await cacheKizOrderStates(accountId, store_id, initialMetadata, orderIds)

      let sent = 0
      let lastMetadataWriteAt = 0
      const sentOrderIds: string[] = []
      const failures: Array<{ orderId: string; error: string }> = []
      for (const pair of pairRows) {
        const pairId = String(pair.id)
        const orderId = String(pair.order_id)
        const sgtin = String(pair.sgtin)
        try {
          const status = statusByOrder.get(orderId)
          const supplierStatus = String(status?.supplierStatus ?? '')
          const wbStatus = String(status?.wbStatus ?? '')
          if (!status) throw new Error(`WB не вернул актуальный статус заказа №${orderId}.`)
          if (supplierStatus === 'complete') {
            throw new Error(`Заказ №${orderId} уже передан «В доставку». WB разрешает привязать КИЗ только пока заказ находится «На сборке».`)
          }
          if (supplierStatus !== 'confirm' || wbStatus !== 'waiting') {
            throw new Error(`КИЗ заказа №${orderId} нельзя отправить: статус продавца «${supplierStatus || 'не указан'}», статус WB «${wbStatus || 'не указан'}». WB принимает КИЗ только в статусе «На сборке».`)
          }
          const existingSgtins = currentSgtins(metaByOrder.get(orderId))
          if (existingSgtins.length > 0 && !existingSgtins.includes(sgtin)) {
            throw new Error('В Wildberries у заказа уже указан другой КИЗ')
          }
          if (!existingSgtins.includes(sgtin)) {
            const intervalWait = 65 - (Date.now() - lastMetadataWriteAt)
            if (intervalWait > 0) await sleep(intervalWait)
            await putWbOrderSgtin(apiKey, orderId, sgtin)
            lastMetadataWriteAt = Date.now()
          }
          await sbWrite('fbs_marking_pairs', 'PATCH', {
            status: 'sent', error: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }, `id=eq.${encodeURIComponent(pairId)}`)
          sent += 1
          sentOrderIds.push(orderId)
        } catch (pairError) {
          const message = errorMessage(pairError)
          failures.push({ orderId, error: message })
          await sbWrite('fbs_marking_pairs', 'PATCH', {
            status: 'error', error: message, updated_at: new Date().toISOString(),
          }, `id=eq.${encodeURIComponent(pairId)}`)
        }
      }
      if (sentOrderIds.length > 0) {
        const confirmedAt = new Date().toISOString()
        await sbWrite(
          'fbs_kiz_order_states',
          'POST',
          [...new Set(sentOrderIds)].map((orderId) => ({
            account_id: accountId,
            store_id,
            order_id: orderId,
            requires_kiz: true,
            sent_to_wb: true,
            checked_at: confirmedAt,
          })),
          'on_conflict=store_id,order_id',
          'resolution=merge-duplicates,return=minimal',
        )
        try {
          await refreshKizOrderStatesFromWb(apiKey, accountId, store_id, sentOrderIds)
        } catch (verificationError) {
          console.error(JSON.stringify({ scope: 'wb-fbs', event: 'kiz_metadata_readback_failed', error: errorMessage(verificationError) }))
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
