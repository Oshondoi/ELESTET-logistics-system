import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { decryptTeksherSecret, encryptTeksherSecret, isEncryptedTeksherSecret } from './teksherCrypto.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const FACADE = 'https://label.teksher.kg/facade'
const BASE = `${FACADE}/api/v1`
const ORDER_BASE = `${FACADE}/order/api/v1`
const TRANSGRAN_BASE = `${FACADE}/transgran/api/v1`

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// ── Auth Teksher ──────────────────────────────────────────────────────────────
async function tkLogin(login: string, password: string): Promise<string> {
  const r = await fetch(`${FACADE}/oauth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: login, password }),
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`Ошибка входа в Teksher (${r.status}): ${t}`)
  }
  const d = await r.json() as Record<string, unknown>
  const token = (d?.data as Record<string, unknown>)?.access_token ?? d.access_token
  if (!token) throw new Error('Teksher не вернул токен')
  return token as string
}

// Возвращает JWT токен: сначала проверяет кеш в stores, потом логинится если надо.
async function getToken(svc: ReturnType<typeof createClient>, store_id: string): Promise<string> {
  const { data } = await svc
    .from('stores')
    .select('teksher_login, teksher_password, teksher_token, teksher_token_exp')
    .eq('id', store_id)
    .single()
  const row = data as {
    teksher_login: string | null
    teksher_password: string | null
    teksher_token: string | null
    teksher_token_exp: string | null
  } | null

  if (!row?.teksher_login || !row?.teksher_password) throw new Error('connected:false')

  const password = await decryptTeksherSecret(row.teksher_password)

  // Если токен ещё действителен — возвращаем сразу. Старую открытую запись
  // одновременно переводим в шифрованный формат без изменения UX.
  if (row.teksher_token && row.teksher_token_exp) {
    const exp = new Date(row.teksher_token_exp).getTime()
    if (exp > Date.now() + 60_000) {
      const token = await decryptTeksherSecret(row.teksher_token)
      const updates: Record<string, string> = {}
      if (!isEncryptedTeksherSecret(row.teksher_password)) updates.teksher_password = await encryptTeksherSecret(password)
      if (!isEncryptedTeksherSecret(row.teksher_token)) updates.teksher_token = await encryptTeksherSecret(token)
      if (Object.keys(updates).length > 0) await svc.from('stores').update(updates).eq('id', store_id)
      return token
    }
  }

  // Логинимся и кешируем новый токен
  const token = await tkLogin(row.teksher_login, password)
  const exp = new Date(Date.now() + 25 * 60 * 1000).toISOString()  // кеш на 25 минут
  await svc.from('stores').update({
    teksher_password: await encryptTeksherSecret(password),
    teksher_token: await encryptTeksherSecret(token),
    teksher_token_exp: exp,
  }).eq('id', store_id)
  return token
}

type JsonObject = Record<string, unknown>
type TransgranIssue = { code: string; level: 'warning' | 'error'; message: string; details?: JsonObject }

const SPECIAL_DATE_GROUPS = new Set(['petfood', 'chemistry', 'milk', 'autofluids'])
const READY_FOR_TRANSGRAN_STATUSES = new Set(['APPLIED', 'PAYED', 'MARKED'])

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function unwrapTeksher(value: unknown): unknown {
  const object = asObject(value)
  return Object.prototype.hasOwnProperty.call(object, 'data') ? object.data : value
}

function arrayFromResponse(value: unknown): JsonObject[] {
  const unwrapped = unwrapTeksher(value)
  if (Array.isArray(unwrapped)) return unwrapped.map(asObject)
  const object = asObject(unwrapped)
  const rows = object.content ?? object.items ?? object.results
  return Array.isArray(rows) ? rows.map(asObject) : []
}

async function teksherJson(url: string, token: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...init, headers })
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try { data = JSON.parse(text) }
    catch { data = text }
  }
  if (!response.ok) {
    const object = asObject(data)
    const message = String(object.message ?? object.error ?? text ?? `HTTP ${response.status}`)
    throw new Error(`Teksher (${response.status}): ${message.slice(0, 500)}`)
  }
  return data
}

function exactMarkingCode(row: JsonObject): string {
  return String(row.code ?? row.markingCode ?? row.barcode ?? '')
}

function extractGtin(kiz: string): string | null {
  const match = /^01(\d{14})21/.exec(kiz)
  return match?.[1] ?? null
}

function isValidGtin14(gtin: string): boolean {
  if (!/^\d{14}$/.test(gtin)) return false
  let sum = 0
  for (let index = 0; index < 13; index += 1) sum += Number(gtin[index]) * (index % 2 === 0 ? 3 : 1)
  return (10 - (sum % 10)) % 10 === Number(gtin[13])
}

function hasStructuredCryptoTail(kiz: string): boolean {
  // Prefer true GS1 separators. The fallback is the documented Russian LP
  // structure when a scanner removed ASCII 29: serial(13), AI 91(4), AI 92.
  const parts = kiz.split('\u001d')
  if (parts.length > 1) {
    const ai91 = parts.find((part) => /^91[!-~]{4}$/.test(part))
    const ai92 = parts.find((part) => /^92[!-~]+$/.test(part))
    return Boolean(ai91 && ai92 && parts.indexOf(ai91) < parts.indexOf(ai92))
  }
  return /^01\d{14}21[!-~]{13}91[!-~]{4}92[!-~]+$/.test(kiz)
}

function extractPhoto(product: JsonObject): string | null {
  const photos = Array.isArray(product.photos) ? product.photos : []
  const first = asObject(photos[0])
  return String(first.c246x328 ?? first.big ?? first.c516x688 ?? '') || null
}

function mapTransgranStatus(rawValue: unknown): string {
  const raw = String(rawValue ?? '').toUpperCase()
  if (['SUCCESS', 'COMPLETED', 'COMPLETE', 'DONE', 'ACCEPTED'].includes(raw)) return 'completed'
  if (['REJECTED', 'FAILED', 'ERROR', 'DECLINED'].includes(raw)) return 'rejected'
  if (['CANCELLED', 'CANCELED'].includes(raw)) return 'cancelled'
  if (raw === 'WAITING') return 'waiting'
  if (raw === 'PROGRESS' || raw === 'IN_PROGRESS' || raw === 'PROCESSING') return 'progress'
  return raw ? 'progress' : 'waiting'
}

function transgranOperationId(value: unknown): string | null {
  const unwrapped = unwrapTeksher(value)
  if (typeof unwrapped === 'string' || typeof unwrapped === 'number') return String(unwrapped)
  const object = asObject(unwrapped)
  const id = object.operationId ?? object.transgranOperationId ?? object.id
  return id == null ? null : String(id)
}

async function findTeksherCode(token: string, kiz: string): Promise<{ match: JsonObject | null; matches: JsonObject[]; error: string | null }> {
  try {
    const params = new URLSearchParams({ page: '0', size: '20', code: kiz })
    const response = await teksherJson(`${BASE}/marking_codes/filter?${params}`, token)
    const rows = arrayFromResponse(response)
    const match = rows.find((row) => exactMarkingCode(row) === kiz) ?? null
    return { match, matches: rows, error: null }
  } catch (reason) {
    return { match: null, matches: [], error: reason instanceof Error ? reason.message : 'Ошибка запроса Teksher' }
  }
}

async function loadTeksherCodeHistory(token: string, id: unknown): Promise<JsonObject[]> {
  if (id == null || id === '') return []
  try { return arrayFromResponse(await teksherJson(`${BASE}/marking_codes/${encodeURIComponent(String(id))}/history`, token)) }
  catch { return [] }
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const authHdr = req.headers.get('Authorization')
  if (!authHdr) return err('Не авторизован', 401)

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHdr } } })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return err('Не авторизован', 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err('Неверный JSON') }

  const action = body.action as string
  const store_id = body.store_id as string
  if (!store_id) return err('store_id обязателен')

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Проверяем доступ к магазину
  const { data: storeAccess } = await userClient.from('stores').select('id').eq('id', store_id).single()
  if (!storeAccess) return err('Магазин не найден или нет доступа', 403)

  // ── action: connect ─────────────────────────────────────────────────────────
  if (action === 'connect') {
    const login = body.login as string
    const password = body.password as string
    if (!login || !password) return err('login и password обязательны')

    let token: string
    try { token = await tkLogin(login, password) }
    catch (e) { return err((e as Error).message) }

    // Получаем профиль участника
    const profileR = await fetch(`${BASE}/users/getCurrentUser`, { headers: { Authorization: `Bearer ${token}` } })
    const profile = profileR.ok ? await profileR.json() as Record<string, unknown> : {}
    const participantId = String((profile as Record<string, Record<string, unknown>>)?.participant?.id ?? profile.id ?? '')
    const participantName = (profile.fullName ?? profile.name ?? '') as string

    // Пароль и кешированный токен хранятся только как AES-256-GCM ciphertext.
    // Ключ находится в Edge Secret и физически отделён от базы данных.
    const tokenExp = new Date(Date.now() + 25 * 60 * 1000).toISOString()
    await svc.from('stores').update({
      teksher_login: login,
      teksher_password: await encryptTeksherSecret(password),
      teksher_participant_id: participantId,
      teksher_participant_name: participantName,
      teksher_token: await encryptTeksherSecret(token),
      teksher_token_exp: tokenExp,
    }).eq('id', store_id)

    return ok({ connected: true, participantId, participantName })
  }

  // ── action: disconnect ──────────────────────────────────────────────────────
  if (action === 'disconnect') {
    await svc.from('stores').update({ teksher_login: null, teksher_password: null, teksher_participant_id: null, teksher_participant_name: null, teksher_token: null, teksher_token_exp: null }).eq('id', store_id)
    return ok({ disconnected: true })
  }

  // Для всех остальных actions — получаем токен (из кеша или свежий)
  let token: string
  try { token = await getToken(svc, store_id) }
  catch (e) {
    const msg = (e as Error).message
    if (msg === 'connected:false') return ok({ connected: false })
    return err(msg)
  }

  // ── action: stats ───────────────────────────────────────────────────────────
  if (action === 'stats') {
    const { data: store } = await svc.from('stores').select('teksher_participant_id, teksher_participant_name').eq('id', store_id).single()

    const [pgR, billR] = await Promise.all([
      fetch(`${BASE}/product_groups/balance`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${BASE}/participants/billing/balance`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
    let balance = 0
    if (pgR.ok) {
      const pg = await pgR.json() as Record<string, unknown>
      const contracts = (pg?.contracts as Record<string, unknown>[]) ?? []
      const combined = contracts.find((c) => String(c.name ?? '').includes('Объедин'))
      balance = combined ? Number(combined.balance) : contracts.reduce((s, c) => s + Number(c.balance ?? 0), 0)
    }
    let balanceMoney = 0
    let course = 0
    let productGroup = 'lp'
    if (billR.ok) {
      const bill = await billR.json() as unknown
      const entries: Record<string, unknown>[] = Array.isArray(bill) ? bill : [bill as Record<string, unknown>]
      balanceMoney = entries.reduce((s, e) => s + Number((e as Record<string, unknown>).saldo ?? (e as Record<string, unknown>).enable ?? 0), 0)
      const firstEntry = (entries[0] ?? {}) as Record<string, unknown>
      course = Number(firstEntry.course ?? 0)
      productGroup = String(firstEntry.productGroup ?? '')
    }
    return ok({ connected: true, participantName: (store as Record<string, unknown>)?.teksher_participant_name ?? '', participantId: (store as Record<string, unknown>)?.teksher_participant_id ?? '', balance, balanceMoney, course, productGroup })
  }

  // ── action: products ────────────────────────────────────────────────────────
  if (action === 'products') {
    const page = Number(body.page ?? 0)
    const size = Number(body.size ?? 20)
    const search = (body.search as string) ?? ''
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (search) params.set('name', search)
    const r = await fetch(`${BASE}/products?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return err(`Teksher: ${r.status}`)
    const d = await r.json() as Record<string, unknown>
    return ok({
      items: d.content ?? d.items ?? [],
      total: (d.page as Record<string, unknown>)?.totalElements ?? d.totalElements ?? 0,
      page: (d.page as Record<string, unknown>)?.number ?? page,
    })
  }

  // ── action: codes ───────────────────────────────────────────────────────────
  if (action === 'codes') {
    const page = Number(body.page ?? 0)
    const size = Number(body.size ?? 30)
    const status = (body.status as string) ?? ''
    const productGroupCode = typeof body.productGroupCode === 'string' ? body.productGroupCode.trim() : ''
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (productGroupCode) params.set('productGroupCode', productGroupCode)
    if (status) params.set('status', status)
    const r = await fetch(`${BASE}/marking_codes/filter?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (r.status === 404 || r.status === 204) return ok({ items: [], total: 0 })
    if (!r.ok) return ok({ items: [], total: 0 })
    const d = await r.json() as Record<string, unknown>
    return ok({
      items: d.content ?? d.items ?? [],
      total: (d.page as Record<string, unknown>)?.totalElements ?? d.totalElements ?? 0,
    })
  }

  // ── action: validate_fulfillment_kiz ───────────────────────────────────────
  // Validate the exact physical code against Teksher and cache only its product.
  // This avoids depending on a complete /products cache during warehouse work.
  if (action === 'validate_fulfillment_kiz') {
    const kiz = String(body.kiz ?? '').replace(/[\r\n\t]+$/g, '')
    const gtin = extractGtin(kiz)
    if (!gtin || !isValidGtin14(gtin)) return err('В КИЗ не найден корректный GTIN-14')
    if (!hasStructuredCryptoTail(kiz)) return err('КИЗ не содержит полного криптографического хвоста 91/92')

    const lookup = await findTeksherCode(token, kiz)
    if (lookup.error) return err(lookup.error)
    if (!lookup.match) return ok({ found: false, gtin })

    const code = lookup.match
    const nestedProduct = asObject(code.product)
    const product = Object.keys(nestedProduct).length > 0 ? nestedProduct : code
    const productGtin = String(product.gtin ?? code.gtin ?? gtin)
    if (productGtin !== gtin) return err('TekSher вернул другой GTIN для отсканированного КИЗа')

    const attributes = Array.isArray(product.attributes) ? product.attributes : []
    const cachedProduct = {
      store_id,
      teksher_id: product.id == null ? null : String(product.id),
      gtin,
      name: String(product.name ?? code.productName ?? code.name ?? '') || null,
      full_name: String(product.fullName ?? product.full_name ?? code.productFullName ?? '') || null,
      product_group_code: String(product.productGroupCode ?? product.product_group_code ?? code.productGroupCode ?? '') || null,
      status: String(product.status ?? code.status ?? code.state ?? '') || null,
      codes_count: null,
      trademark: String(product.trademark ?? product.brand ?? '') || null,
      manufacturer_full_name: String(product.manufacturerFullName ?? product.manufacturer_full_name ?? '') || null,
      manufactured_country_id: product.manufacturedCountryId == null ? null : Number(product.manufacturedCountryId),
      manufactured_country_code: String(product.manufacturedCountryCode ?? '') || null,
      manufactured_country_name: String(product.manufacturedCountryName ?? '') || null,
      attributes,
      synced_at: new Date().toISOString(),
    }
    const { error: cacheError } = await svc.from('teksher_products').upsert(cachedProduct, { onConflict: 'store_id,gtin' })
    if (cacheError) return err(`Не удалось сохранить товар TekSher: ${cacheError.message}`)

    return ok({
      found: true,
      gtin,
      code_id: code.id ?? code.markingCodeId ?? null,
      status: code.status ?? code.state ?? null,
      product: cachedProduct,
    })
  }

  // ── action: operations ──────────────────────────────────────────────────────
  if (action === 'operations') {
    const page = Number(body.page ?? 0)
    const size = Number(body.size ?? 20)
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    const r = await fetch(`${BASE}/operations/filter?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return ok({ items: [], total: 0 })
    const d = await r.json() as Record<string, unknown>
    const rawItems = (d.content ?? d.items ?? []) as Record<string, unknown>[]
    return ok({
      items: rawItems.map((op) => ({ ...op, id: op.operationId ?? op.id, gtin: (op.product as Record<string, unknown>)?.gtin ?? op.gtin })),
      total: (d.page as Record<string, unknown>)?.totalElements ?? d.totalElements ?? 0,
    })
  }

  // ── action: operation_ready ─────────────────────────────────────────────────
  if (action === 'operation_ready') {
    const orderId = body.orderId as string
    if (!orderId) return err('orderId обязателен')
    const r = await fetch(`${ORDER_BASE}/operations/${orderId}/ready`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return ok({ ready: false })
    const d = await r.json() as Record<string, unknown>
    return ok({ ready: Boolean(d.ready) })
  }

  // ── action: emit ────────────────────────────────────────────────────────────
  if (action === 'emit') {
    const gtin = body.gtin as string
    const quantity = Number(body.quantity)
    if (!gtin) return err('gtin обязателен')
    if (!quantity || quantity < 1 || quantity > 1000) return err('Количество КИЗов должно быть от 1 до 1000')
    const r = await fetch(`${ORDER_BASE}/operations/multi`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        extension: 'lp',
        countryId: 199,
        items: [{ gtin, markingCodesAmount: quantity, dataSupplier: 'AUTO', template: 'SHORT' }],
      }),
    })
    const d = await r.json() as Record<string, unknown>
    if (!r.ok) return err((d?.message as string) ?? `Ошибка эмиссии: ${r.status}`)
    const operationIds = Object.keys((d?.data as Record<string, unknown>) ?? {})
    return ok({ success: true, operationId: operationIds[0] ?? null })
  }

  // ── action: utilise ─────────────────────────────────────────────────────────
  if (action === 'utilise') {
    const orderId = body.orderId as string
    if (!orderId) return err('orderId обязателен')
    const readyR = await fetch(`${ORDER_BASE}/operations/${orderId}/ready`, { headers: { Authorization: `Bearer ${token}` } })
    if (readyR.ok) {
      const rd = await readyR.json() as Record<string, unknown>
      if (!rd.ready) return err('Коды ещё не готовы. Попробуйте позже.')
    }
    const r = await fetch(`${ORDER_BASE}/operations/utilisation`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ extension: 'lp', dataSupplier: 'AUTO', orderId }),
    })
    const d = await r.json() as Record<string, unknown>
    if (!r.ok) return err((d?.message as string) ?? `Ошибка нанесения: ${r.status}`)
    return ok({ success: true })
  }

  // ── action: create_product ──────────────────────────────────────────────────
  if (action === 'create_product') {
    const {
      gtin, fullName, trademark,
      producerINN, producerName,
    } = body as Record<string, string>
    const countryId = body.countryId != null ? Number(body.countryId) : undefined
    const tnvedId = body.tnvedId != null ? Number(body.tnvedId) : undefined
    const attributes = (body.attributes as Array<{ attributeTypeCode: string; value: string }>) ?? []

    if (!gtin || !fullName) return err('gtin и fullName обязательны')
    const { data: storeRec } = await svc.from('stores').select('teksher_participant_id').eq('id', store_id).single()
    const participantId = (storeRec as Record<string, unknown>)?.teksher_participant_id as string | null

    // Получаем GCP/GLN из данных участника
    let gcp = gtin.slice(1, 10)
    let gln: string | undefined
    if (participantId) {
      const rIds = await fetch(`${BASE}/participants/${participantId}/identifiers`, { headers: { Authorization: `Bearer ${token}` } })
      if (rIds.ok) {
        const ids = await rIds.json() as unknown[]
        const first = (ids[0] as Record<string, unknown>) ?? {}
        if (first.gcp) gcp = String(first.gcp)
        if (first.gln) gln = String(first.gln)
      }
    }

    const payload: Record<string, unknown> = {
      gtin,
      gcp,
      gln,
      fullName,
      trademark: trademark || undefined,
      tnved: tnvedId,
      manufacturerInn: producerINN || undefined,
      manufacturerFullName: producerName || undefined,
      manufacturedCountryId: countryId || undefined,
      attributes,
    }
    if (participantId) payload.participantId = participantId

    const r = await fetch(`${BASE}/products/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await r.json() as Record<string, unknown>
    if (!r.ok) return err((d?.message as string) ?? `Ошибка создания: ${r.status}`)
    return ok({ success: true, product: d })
  }

  // ── action: tnved_list ──────────────────────────────────────────────────────
  if (action === 'tnved_list') {
    const search = (body.search as string) ?? ''
    const page = Number(body.page ?? 0)
    const size = Number(body.size ?? 50)

    // Сначала пробуем локальную БД (быстро, без лишнего API-вызова)
    const { count } = await svc.from('tnved_codes').select('*', { count: 'exact', head: true })
    if (count && count > 0) {
      let query = svc.from('tnved_codes').select('code,sub_position_name,position,position_name,group_name,subgroup_id,subgroup_name,teksher_id')
      if (search) {
        if (/^\d/.test(search)) query = query.ilike('code', `${search}%`)
        else query = query.ilike('sub_position_name', `%${search}%`)
      }
      const { data: rows } = await query.range(page * size, page * size + size - 1)
      if (rows && rows.length > 0) {
        return ok({
          items: rows.map((r) => ({
            fullCode: r.code, subPositionName: r.sub_position_name,
            position: r.position, positionName: r.position_name, groupName: r.group_name,
            subgroupId: r.subgroup_id ?? null,
            subgroupName: r.subgroup_name ?? null,
            teksherTnvedId: r.teksher_id ?? null,
          })),
          total: count,
        })
      }
    }

    // Fallback: Teksher API (если БД ещё не заполнена)
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (search) {
      if (/^\d/.test(search)) params.set('fullCode', search)
      else params.set('name', search)
    }
    const r = await fetch(`${BASE}/tnveds?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return ok({ items: [], total: 0 })
    const d = await r.json() as Record<string, unknown>
    const raw = (d.content ?? d.items ?? (Array.isArray(d) ? d : [])) as Record<string, unknown>[]
    const total = (d.page as Record<string, unknown>)?.totalElements ?? d.totalElements ?? 0
    const items = raw.map(item => ({
      id:              item.id,
      fullCode:        item.code ?? item.fullCode,
      subPositionName: item.name ?? item.subPositionName,
      position:        item.rootCode ?? item.position,
      positionName:    item.rootName ?? item.positionName,
      groupName:       (item.productSubgroup as Record<string,unknown>)?.name ?? item.groupName,
      subgroupId:      (item.productSubgroup as Record<string,unknown>)?.id ?? null,
    }))
    return ok({ items, total })
  }

  // ── action: countries ───────────────────────────────────────────────────────
  if (action === 'countries') {
    // DB-first: если кэш есть — возвращаем сразу
    const { data: cached, count } = await svc.from('countries').select('teksher_id,name,code', { count: 'exact' })
    if (count && count > 0 && cached) {
      return ok({ items: (cached as Array<Record<string, unknown>>).map(r => ({ id: r.teksher_id, name: r.name, code: r.code })) })
    }
    // Fallback: Teksher API + upsert в DB
    const r = await fetch(`${BASE}/countries`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return ok({ items: [] })
    const d = await r.json() as unknown
    const raw = (Array.isArray(d) ? d : (d as Record<string, unknown>).content ?? (d as Record<string, unknown>).items ?? []) as Record<string, unknown>[]
    const rows = raw.filter(c => c.id && c.name).map(c => ({
      teksher_id: Number(c.id),
      name: String(c.name ?? ''),
      code: c.code ? String(c.code) : null,
      synced_at: new Date().toISOString(),
    }))
    if (rows.length > 0) void svc.from('countries').upsert(rows, { onConflict: 'teksher_id' })
    return ok({ items: raw.map(c => ({ id: c.id, name: c.name, code: c.code })) })
  }

  // ── action: refresh_countries ───────────────────────────────────────────────
  if (action === 'refresh_countries') {
    const r = await fetch(`${BASE}/countries`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return err(`Ошибка загрузки стран: ${r.status}`)
    const d = await r.json() as unknown
    const raw = (Array.isArray(d) ? d : (d as Record<string, unknown>).content ?? (d as Record<string, unknown>).items ?? []) as Record<string, unknown>[]
    const rows = raw.filter(c => c.id && c.name).map(c => ({
      teksher_id: Number(c.id),
      name: String(c.name ?? ''),
      code: c.code ? String(c.code) : null,
      synced_at: new Date().toISOString(),
    }))
    if (rows.length > 0) await svc.from('countries').upsert(rows, { onConflict: 'teksher_id' })
    return ok({ items: raw.map(c => ({ id: c.id, name: c.name, code: c.code })), synced: rows.length })
  }

  // ── action: publish_product ─────────────────────────────────────────────────
  if (action === 'publish_product') {
    const productId = body.productId as string
    if (!productId) return err('productId обязателен')
    const r = await fetch(`${BASE}/products/${productId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'PUBLISHED' }),
    })
    if (!r.ok) {
      const d = await r.json() as Record<string, unknown>
      return err((d?.message as string) ?? `Ошибка публикации: ${r.status}`)
    }
    return ok({ success: true })
  }

  // ── action: participant_info ────────────────────────────────────────────────
  if (action === 'participant_info') {
    const { data: storeRec } = await svc.from('stores').select('teksher_participant_id').eq('id', store_id).single()
    const participantId = (storeRec as Record<string, unknown>)?.teksher_participant_id as string | null
    if (!participantId) return err('participantId не найден. Переподключите Teksher.')
    const [rIds, rProfile] = await Promise.all([
      fetch(`${BASE}/participants/${participantId}/identifiers`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${BASE}/participants/${participantId}`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
    const ids = rIds.ok ? await rIds.json() as unknown[] : []
    const first = (ids[0] as Record<string, unknown>) ?? {}
    const profile = rProfile.ok ? await rProfile.json() as Record<string, unknown> : {}
    const inn = profile.inn ?? profile.taxId ?? profile.taxCode ?? ''
    const companyName = profile.fullName ?? profile.name ?? profile.companyName ?? profile.legalName ?? ''
    return ok({ gcp: first.gcp ?? '', gln: first.gln ?? '', participantId, inn, companyName })
  }

  // ── action: topup_qr ────────────────────────────────────────────────────────
  if (action === 'topup_qr') {
    const productGroupAlias = (body.productGroupAlias as string) ?? 'lp'
    const r = await fetch(`${BASE}/qrcode?productGroupAlias=${encodeURIComponent(productGroupAlias)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!r.ok) return ok({ qrError: `QR код недоступен (${r.status})` })
    const ct = r.headers.get('content-type') ?? ''
    if (ct.includes('image') || ct.includes('octet-stream')) {
      const buf = await r.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
      const mime = ct.split(';')[0] || 'image/png'
      return ok({ qrDataUrl: `data:${mime};base64,${btoa(binary)}` })
    }
    try {
      const d = await r.json() as Record<string, unknown>
      // Teksher returns { data: "<qr-string>", status: "SUCCESS", qrTransactionId: "..." }
      const qrString = d.data ?? d.url ?? d.qrUrl ?? d.qrCode ?? d.image
      if (qrString) return ok({ qrString: String(qrString), qrTransactionId: d.qrTransactionId ?? null })
    } catch { /* ignore */ }
    return ok({ qrError: 'Неизвестный формат QR кода' })
  }

  // ── action: attribute_templates ────────────────────────────────────────────
  if (action === 'attribute_templates') {
    let subgroupId = body.subgroupId != null ? Number(body.subgroupId) : null

    // Если subgroupId не передан, ищем по tnvedCode в БД
    if (!subgroupId && body.tnvedCode) {
      const tnvedCode = body.tnvedCode as string
      const { data: tnvedRow } = await svc
        .from('tnved_codes')
        .select('subgroup_id')
        .eq('code', tnvedCode)
        .maybeSingle()
      subgroupId = (tnvedRow as Record<string, unknown> | null)?.subgroup_id != null
        ? Number((tnvedRow as Record<string, unknown>).subgroup_id)
        : null
    }

    if (!subgroupId) return ok({ attributes: [], subgroupId: null, source: 'no_subgroup' })

    // Проверяем кэш в БД
    const { data: cached } = await svc
      .from('attribute_templates')
      .select('templates')
      .eq('subgroup_id', subgroupId)
      .maybeSingle()
    if (cached && (cached as Record<string, unknown>).templates) {
      const tpls = (cached as Record<string, unknown>).templates
      const arr = Array.isArray(tpls) ? tpls : []
      if (arr.length > 0) {
        return ok({ attributes: arr, subgroupId, source: 'db' })
      }
    }

    // Fallback: запрашиваем у Teksher API (если БД пуста или не заполнена)
    const templatesR = await fetch(`${BASE}/products/attribute_templates?subgroupId=${subgroupId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!templatesR.ok) return ok({ attributes: [], subgroupId, source: 'api_error' })
    const raw = await templatesR.json() as unknown
    const templates = Array.isArray(raw) ? raw : []

    // Сохраняем в БД для следующих вызовов
    void svc.from('attribute_templates').upsert({
      subgroup_id: subgroupId,
      templates,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'subgroup_id' })

    return ok({ attributes: templates, subgroupId, source: 'api', rawType: typeof raw, isArray: Array.isArray(raw) })
  }

  // ── action: product_groups ────────────────────────────────────────────────
  if (action === 'product_groups') {
    const response = await teksherJson(`${BASE}/product_groups?page=0&size=200`, token)
    return ok({ items: arrayFromResponse(response) })
  }

  // ── action: transgran_diagnose ────────────────────────────────────────────
  if (action === 'transgran_diagnose') {
    const shipmentId = String(body.shipment_id ?? '')
    if (!shipmentId) return err('shipment_id обязателен')
    const { data: shipment, error: shipmentError } = await svc.from('transgran_shipments')
      .select('*').eq('id', shipmentId).eq('store_id', store_id).single()
    if (shipmentError || !shipment) return err('Трансгран не найден или относится к другому магазину', 404)

    await svc.from('transgran_shipments').update({ status: 'checking', last_error: null }).eq('id', shipmentId)
    const { data: itemRows, error: itemsError } = await svc.from('transgran_items')
      .select('*').eq('shipment_id', shipmentId).order('created_at')
    if (itemsError) return err(itemsError.message)
    const items = (itemRows ?? []) as JsonObject[]
    if (items.length === 0) return err('В трансгране нет КИЗов')

    const { data: productRows } = await svc.from('products')
      .select('id,store_id,nm_id,vendor_code,name,brand,category,color,composition,country,barcodes,photos,sizes,raw_data')
      .eq('store_id', store_id).limit(10000)
    const products = (productRows ?? []) as JsonObject[]

    const normalizedCodes = [...new Set(items.map((item) => String(item.kiz_normalized ?? '')).filter(Boolean))]
    const previousItems: JsonObject[] = []
    for (const codes of chunk(normalizedCodes, 70)) {
      const { data } = await svc.from('transgran_items')
        .select('id,shipment_id,kiz_normalized,created_at')
        .eq('account_id', String(shipment.account_id)).in('kiz_normalized', codes).neq('shipment_id', shipmentId)
      previousItems.push(...((data ?? []) as JsonObject[]))
    }
    const previousShipmentIds = [...new Set(previousItems.map((item) => String(item.shipment_id)).filter(Boolean))]
    const previousShipments = new Map<string, JsonObject>()
    for (const ids of chunk(previousShipmentIds, 80)) {
      if (ids.length === 0) continue
      const { data } = await svc.from('transgran_shipments')
        .select('id,scheme,wb_supply_id,document_number,destination_city,destination_name,status,teksher_operation_id,teksher_status,shipment_date,created_at')
        .in('id', ids)
      for (const row of (data ?? []) as JsonObject[]) previousShipments.set(String(row.id), row)
    }

    const diagnostics: JsonObject[] = []
    for (const itemBatch of chunk(items, 8)) {
      const batchRows = await Promise.all(itemBatch.map(async (item) => {
        const issues: TransgranIssue[] = []
        const kiz = String(item.kiz_normalized ?? item.kiz_raw ?? '')
        const gtin = extractGtin(kiz)
        if (!gtin) issues.push({ code: 'invalid_gs1', level: 'error', message: 'Не найден обязательный префикс 01 + GTIN-14 + 21. Проверьте полный КИЗ сканером.' })
        else if (!isValidGtin14(gtin)) issues.push({ code: 'invalid_gtin_checksum', level: 'error', message: `GTIN ${gtin} не прошёл проверку контрольной цифры. Повторно отсканируйте исходный DataMatrix.` })
        if (!hasStructuredCryptoTail(kiz)) issues.push({ code: 'crypto_tail_unconfirmed', level: 'warning', message: 'Не удалось структурно подтвердить криптографические части AI 91/92 и их разделители. Сравните код посимвольно с исходным CSV Teksher.' })

        const barcode = String(item.barcode ?? asObject(item.product_snapshot).barcode ?? '')
        const snapshot = asObject(item.product_snapshot)
        const snapshotNmId = String(snapshot.nm_id ?? snapshot.nmId ?? '')
        const productMatches = products.filter((product) => {
          const barcodes = Array.isArray(product.barcodes) ? product.barcodes.map(String) : []
          return (barcode && barcodes.includes(barcode)) || (snapshotNmId && String(product.nm_id ?? '') === snapshotNmId)
        })
        if (productMatches.length === 0) issues.push({ code: 'product_not_found', level: 'warning', message: 'Товар не найден в БД ELESTET по баркоду или артикулу WB. КИЗ сохранён, но карточку нужно сверить вручную.' })
        if (productMatches.length > 1) issues.push({ code: 'multiple_products', level: 'warning', message: `Найдено несколько карточек товара (${productMatches.length}). Показаны возможные совпадения.` })
        const localProduct = productMatches.length === 1 ? {
          ...productMatches[0], photo_url: extractPhoto(productMatches[0]),
        } : null

        const teksher = await findTeksherCode(token, kiz)
        let teksherHistory: JsonObject[] = []
        if (teksher.error) issues.push({ code: 'teksher_unavailable', level: 'warning', message: `Teksher не удалось проверить: ${teksher.error}` })
        else if (!teksher.match) issues.push({ code: 'teksher_code_not_found', level: 'error', message: 'Teksher не вернул точное совпадение этого КИЗа.' })
        else {
          const remoteGtin = String(teksher.match.gtin ?? '')
          const remoteStatus = String(teksher.match.status ?? '').toUpperCase()
          if (gtin && remoteGtin && gtin !== remoteGtin) issues.push({ code: 'gtin_mismatch', level: 'error', message: `GTIN КИЗа ${gtin} не совпадает с GTIN Teksher ${remoteGtin}.` })
          if (!READY_FOR_TRANSGRAN_STATUSES.has(remoteStatus)) {
            issues.push({
              code: remoteStatus === 'IMPORT_REGISTRATION' ? 'already_in_transgran' : 'teksher_status_not_applied',
              level: 'warning',
              message: remoteStatus === 'IMPORT_REGISTRATION'
                ? 'Teksher уже показывает для КИЗа регистрацию импорта/трансграна. Проверьте предыдущий документ.'
                : `Статус КИЗа в Teksher «${remoteStatus || 'неизвестен'}», а по руководству перед отгрузкой нужен статус «Нанесён».`,
            })
          }
          teksherHistory = await loadTeksherCodeHistory(token, teksher.match.id)
        }

        const previous = previousItems
          .filter((row) => String(row.kiz_normalized) === kiz)
          .map((row) => previousShipments.get(String(row.shipment_id)))
          .filter(Boolean) as JsonObject[]
        if (previous.length > 0) issues.push({
          code: 'previous_transgran', level: 'warning',
          message: `КИЗ уже встречался в ${previous.length} трансгран-операц${previous.length === 1 ? 'ии' : 'иях'}. История показана ниже; повтор не блокируется.`,
          details: { shipments: previous },
        })
        const source = asObject(item.source_snapshot)
        const fbsStatus = String(source.pair_status ?? '')
        const supplierStatus = String(source.supplier_status ?? '')
        const wbStatus = String(source.wb_status ?? '')
        if (fbsStatus === 'error') issues.push({ code: 'fbs_send_error', level: 'warning', message: `КИЗ не был передан в WB: ${String(source.pair_error ?? 'ошибка без текста')}` })
        if (fbsStatus === 'cancelled' || ['cancel', 'canceled', 'cancelled'].includes(supplierStatus) || ['canceled', 'cancelled', 'declined_by_client'].includes(wbStatus)) {
          issues.push({ code: 'fbs_order_cancelled', level: 'warning', message: 'Связанный FBS-заказ отменён. Уточните фактическое местонахождение товара.' })
        }

        const level = issues.some((issue) => issue.level === 'error') ? 'error' : issues.length > 0 ? 'warning' : 'ok'
        const remote = teksher.match
        const mergedSnapshot = localProduct ? { ...snapshot, local_product: localProduct } : { ...snapshot, possible_products: productMatches.map((product) => ({ ...product, photo_url: extractPhoto(product) })) }
        await svc.from('transgran_items').update({
          gtin: gtin ?? item.gtin,
          product_snapshot: mergedSnapshot,
          validation_level: level,
          issues,
          teksher_code_id: remote?.id == null ? null : String(remote.id),
          teksher_status: remote?.status == null ? null : String(remote.status),
          teksher_history: teksherHistory,
          checked_at: new Date().toISOString(),
        }).eq('id', String(item.id))
        return { ...item, gtin: gtin ?? item.gtin, product_snapshot: mergedSnapshot, validation_level: level, issues, teksher_code_id: remote?.id ?? null, teksher_status: remote?.status ?? null, teksher_history: teksherHistory, previous_shipments: previous }
      }))
      diagnostics.push(...batchRows)
    }

    const counts = diagnostics.reduce((total, item) => {
      const level = String(item.validation_level)
      if (level === 'error') total.errors += 1
      else if (level === 'warning') total.warnings += 1
      else total.ok += 1
      return total
    }, { ok: 0, warnings: 0, errors: 0 })
    await svc.from('transgran_shipments').update({ status: 'ready', last_error: null }).eq('id', shipmentId)
    await svc.from('transgran_events').insert({
      shipment_id: shipmentId, account_id: shipment.account_id, event_type: 'diagnosed', old_status: shipment.status,
      new_status: 'ready', actor_user_id: user.id, details: counts,
    })
    return ok({ shipment: { ...shipment, status: 'ready' }, items: diagnostics, counts })
  }

  // ── action: transgran_submit ──────────────────────────────────────────────
  if (action === 'transgran_submit') {
    const shipmentId = String(body.shipment_id ?? '')
    if (!shipmentId) return err('shipment_id обязателен')
    const { data: shipment, error: shipmentError } = await svc.from('transgran_shipments')
      .select('*').eq('id', shipmentId).eq('store_id', store_id).single()
    if (shipmentError || !shipment) return err('Трансгран не найден или относится к другому магазину', 404)
    if (shipment.teksher_operation_id) return err('Операция Teksher уже создана. Используйте обновление статуса.')
    if (shipment.movement_kind === 'inside_russia') return err('Это внутренняя перевозка по России. ELESTET сохранит связь FBS с прежним трансграном, но не создаст повторную государственную операцию.')
    const required: Array<[string, unknown]> = [
      ['номер документа', shipment.document_number], ['дата документа', shipment.document_date],
      ['дата отгрузки', shipment.shipment_date], ['получатель', shipment.recipient_name],
      ['ИНН получателя', shipment.recipient_inn], ['КПП получателя', shipment.recipient_kpp],
      ['товарная группа', shipment.product_group_alias],
    ]
    const missing = required.filter(([, value]) => !String(value ?? '').trim()).map(([label]) => label)
    if (missing.length > 0) return err(`Заполните: ${missing.join(', ')}`)
    const { data: itemRows, error: itemsError } = await svc.from('transgran_items')
      .select('id,kiz_raw,kiz_normalized,gtin').eq('shipment_id', shipmentId).order('created_at')
    if (itemsError || !itemRows?.length) return err('В трансгране нет КИЗов')

    const today = new Date().toISOString().slice(0, 10)
    if (String(shipment.shipment_date) > today) return err('Дата отгрузки не может быть позже даты создания операции трансграна')
    const expectedGtins = [...new Set(itemRows.map((item) => extractGtin(String(item.kiz_normalized ?? item.kiz_raw ?? ''))).filter(Boolean))] as string[]
    if (expectedGtins.length === 0) return err('В КИЗах не найден ни один корректный GTIN')
    if (SPECIAL_DATE_GROUPS.has(String(shipment.product_group_alias))) {
      const productDates = new Map((Array.isArray(shipment.products_payload) ? shipment.products_payload : []).map((row) => {
        const product = asObject(row)
        return [String(product.gtin ?? ''), product] as const
      }))
      for (const gtin of expectedGtins) {
        const dates = productDates.get(gtin)
        const productionDate = String(dates?.productionDate ?? '')
        const expirationDate = String(dates?.expirationDate ?? '')
        if (!productionDate || !expirationDate) return err(`Для GTIN ${gtin} заполните дату производства и срок годности`)
        if (productionDate > expirationDate) return err(`Для GTIN ${gtin} дата производства позже срока годности`)
      }
    }

    await svc.from('transgran_shipments').update({ status: 'submitting', last_error: null }).eq('id', shipmentId)
    try {
      const csv = itemRows.map((item) => String(item.kiz_raw ?? item.kiz_normalized)).join('\n')
      const form = new FormData()
      form.append('file', new Blob([csv], { type: 'text/csv;charset=utf-8' }), `transgran-${shipmentId}.csv`)
      const uploadRaw = await teksherJson(`${TRANSGRAN_BASE}/files/marking_code`, token, { method: 'POST', body: form })
      const upload = asObject(unwrapTeksher(uploadRaw))
      const fileId = String(upload.id ?? upload.fileId ?? '')
      if (!fileId) throw new Error('Teksher загрузил CSV, но не вернул ID файла')
      const fileGtins = Array.isArray(upload.gtins) ? upload.gtins.map(String) : []
      if (fileGtins.length === 0) throw new Error('Teksher загрузил CSV, но не вернул распознанные GTIN. Операция не создана: проверьте файл и повторите.')
      const expectedGtinSet = new Set(expectedGtins)
      const returnedGtinSet = new Set(fileGtins)
      const missingGtins = expectedGtins.filter((gtin) => !returnedGtinSet.has(gtin))
      const extraGtins = fileGtins.filter((gtin) => !expectedGtinSet.has(gtin))
      if (missingGtins.length > 0 || extraGtins.length > 0) {
        throw new Error(`Teksher распознал другой состав GTIN. Не найдены: ${missingGtins.join(', ') || '—'}; лишние: ${extraGtins.join(', ') || '—'}. Операция не создана.`)
      }
      const payload = {
        countryCode: String(shipment.operation_country_code || 'RU'),
        extension: String(shipment.product_group_alias),
        documentNumber: String(shipment.document_number),
        documentDate: String(shipment.document_date),
        shipmentDate: String(shipment.shipment_date),
        recipientName: String(shipment.recipient_name),
        recipientInn: String(shipment.recipient_inn),
        recipientKpp: String(shipment.recipient_kpp),
        fileId,
        products: Array.isArray(shipment.products_payload) ? shipment.products_payload : [],
      }
      const createRaw = await teksherJson(`${TRANSGRAN_BASE}/operations/create`, token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const operationId = transgranOperationId(createRaw)
      if (!operationId) throw new Error('Teksher создал операцию, но не вернул её ID')
      const responseObject = asObject(unwrapTeksher(createRaw))
      const rawStatus = String(responseObject.status ?? 'WAITING')
      const status = mapTransgranStatus(rawStatus)
      const now = new Date().toISOString()
      await svc.from('transgran_shipments').update({
        file_id: fileId, file_gtins: fileGtins, status, teksher_operation_id: operationId,
        teksher_status: rawStatus, response_snapshot: createRaw, submitted_at: now, last_error: null,
      }).eq('id', shipmentId)
      await svc.from('transgran_events').insert({
        shipment_id: shipmentId, account_id: shipment.account_id, event_type: 'submitted_to_teksher',
        old_status: shipment.status, new_status: status, actor_user_id: user.id,
        details: { operation_id: operationId, file_id: fileId, file_gtins: fileGtins, items: itemRows.length },
      })
      return ok({ success: true, operationId, status, teksherStatus: rawStatus, fileId, fileGtins })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Не удалось создать трансгран'
      await svc.from('transgran_shipments').update({ status: 'error', last_error: message }).eq('id', shipmentId)
      await svc.from('transgran_events').insert({ shipment_id: shipmentId, account_id: shipment.account_id, event_type: 'submit_failed', old_status: 'submitting', new_status: 'error', actor_user_id: user.id, details: { message } })
      return err(message)
    }
  }

  // ── action: transgran_sync ────────────────────────────────────────────────
  if (action === 'transgran_sync') {
    const shipmentId = String(body.shipment_id ?? '')
    const { data: shipment } = await svc.from('transgran_shipments').select('*')
      .eq('id', shipmentId).eq('store_id', store_id).single()
    if (!shipment?.teksher_operation_id) return err('У трансграна ещё нет операции Teksher')
    let raw: unknown
    try {
      raw = await teksherJson(`${TRANSGRAN_BASE}/operations/${encodeURIComponent(String(shipment.teksher_operation_id))}`, token)
    } catch {
      const filtered = await teksherJson(`${TRANSGRAN_BASE}/operations/filter?page=0&size=100`, token)
      raw = arrayFromResponse(filtered).find((row) => String(row.operationId ?? row.id) === String(shipment.teksher_operation_id))
      if (!raw) return err('Операция не найдена в актуальном списке Teksher')
    }
    const operation = asObject(unwrapTeksher(raw))
    const rawStatus = String(operation.status ?? operation.operationStatus ?? '')
    const status = mapTransgranStatus(rawStatus)
    const updates: JsonObject = {
      status, teksher_status: rawStatus, teksher_process_description: String(operation.processDescription ?? operation.description ?? '') || null,
      response_snapshot: raw, last_error: null,
    }
    if (status === 'completed') updates.completed_at = new Date().toISOString()
    await svc.from('transgran_shipments').update(updates).eq('id', shipmentId)
    if (status !== shipment.status || rawStatus !== shipment.teksher_status) await svc.from('transgran_events').insert({
      shipment_id: shipmentId, account_id: shipment.account_id, event_type: 'status_synced',
      old_status: shipment.status, new_status: status, actor_user_id: user.id,
      details: { old_teksher_status: shipment.teksher_status, teksher_status: rawStatus, operation },
    })
    return ok({ status, teksherStatus: rawStatus, operation })
  }

  // ── action: transgran_cancel ──────────────────────────────────────────────
  if (action === 'transgran_cancel') {
    const shipmentId = String(body.shipment_id ?? '')
    const documentNumber = String(body.document_number ?? '').trim()
    if (!documentNumber) return err('Укажите номер документа отмены')
    const { data: shipment } = await svc.from('transgran_shipments').select('*')
      .eq('id', shipmentId).eq('store_id', store_id).single()
    if (!shipment?.teksher_operation_id) return err('У трансграна нет операции Teksher')
    const remoteStatus = String(shipment.teksher_status ?? '').toUpperCase()
    if (!['WAITING', 'PROGRESS'].includes(remoteStatus)) return err('Teksher разрешает запрос отмены только для статусов WAITING или PROGRESS. Сначала обновите статус.')
    const response = await teksherJson(`${TRANSGRAN_BASE}/operations/cancel`, token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        countryCode: String(shipment.operation_country_code || 'RU'),
        extension: String(shipment.product_group_alias),
        transgranOperationId: String(shipment.teksher_operation_id),
        documentNumber,
      }),
    })
    await svc.from('transgran_shipments').update({ status: 'cancel_requested', cancellation_document_number: documentNumber, response_snapshot: response, last_error: null }).eq('id', shipmentId)
    await svc.from('transgran_events').insert({
      shipment_id: shipmentId, account_id: shipment.account_id, event_type: 'cancellation_requested',
      old_status: shipment.status, new_status: 'cancel_requested', actor_user_id: user.id,
      details: { document_number: documentNumber, response },
    })
    return ok({ success: true, status: 'cancel_requested' })
  }

  return err(`Неизвестный action: ${action}`)
})
