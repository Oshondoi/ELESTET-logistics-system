import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

async function getCreds(svc: ReturnType<typeof createClient>, store_id: string) {
  const { data } = await svc.from('stores').select('teksher_login, teksher_password').eq('id', store_id).single()
  return data as { teksher_login: string | null; teksher_password: string | null } | null
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

    // Сохраняем credentials (только их — данные не кешируем)
    await svc.from('stores').update({ teksher_login: login, teksher_password: password, teksher_participant_id: participantId, teksher_participant_name: participantName }).eq('id', store_id)

    return ok({ connected: true, participantId, participantName })
  }

  // ── action: disconnect ──────────────────────────────────────────────────────
  if (action === 'disconnect') {
    await svc.from('stores').update({ teksher_login: null, teksher_password: null, teksher_participant_id: null, teksher_participant_name: null }).eq('id', store_id)
    return ok({ disconnected: true })
  }

  // Для всех остальных actions — нужны credentials
  const creds = await getCreds(svc, store_id)
  if (!creds?.teksher_login || !creds?.teksher_password) return ok({ connected: false })

  let token: string
  try { token = await tkLogin(creds.teksher_login, creds.teksher_password) }
  catch (e) { return err((e as Error).message) }

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
    const params = new URLSearchParams({ page: String(page), size: String(size), productGroupCode: 'LP RF' })
    if (status) params.set('status', status)
    let r = await fetch(`${BASE}/marking_codes/filter?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) {
      const p2 = new URLSearchParams({ page: String(page), size: String(size) })
      if (status) p2.set('status', status)
      r = await fetch(`${BASE}/marking_codes/filter?${p2}`, { headers: { Authorization: `Bearer ${token}` } })
    }
    if (r.status === 404 || r.status === 204) return ok({ items: [], total: 0 })
    if (!r.ok) return ok({ items: [], total: 0 })
    const d = await r.json() as Record<string, unknown>
    return ok({
      items: d.content ?? d.items ?? [],
      total: (d.page as Record<string, unknown>)?.totalElements ?? d.totalElements ?? 0,
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
    if (!quantity || quantity < 1 || quantity > 10000) return err('quantity: 1–10000')
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
    const { gtin, fullName, trademark, tnved } = body as Record<string, string>
    if (!gtin || !fullName) return err('gtin и fullName обязательны')
    const { data: storeRec } = await svc.from('stores').select('teksher_participant_id').eq('id', store_id).single()
    const participantId = (storeRec as Record<string, unknown>)?.teksher_participant_id as string | null

    const profileR = await fetch(`${BASE}/users/getCurrentUser`, { headers: { Authorization: `Bearer ${token}` } })
    const profile = profileR.ok ? await profileR.json() as Record<string, unknown> : {}
    const gcp = gtin.slice(0, 9)

    const payload: Record<string, unknown> = {
      gtin, gcp, fullName,
      trademark: trademark || undefined,
      tnved: tnved || undefined,
      attributes: [{ attributeTypeCode: 'name', value: fullName }],
    }
    if (participantId) payload.participantId = participantId
    if ((profile as Record<string, Record<string, unknown>>)?.participant?.id) payload.participantId = (profile as Record<string, Record<string, unknown>>).participant.id

    const r = await fetch(`${BASE}/products/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await r.json() as Record<string, unknown>
    if (!r.ok) return err((d?.message as string) ?? `Ошибка создания: ${r.status}`)
    return ok({ success: true, product: d })
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
    const r = await fetch(`${BASE}/participants/${participantId}/identifiers`, { headers: { Authorization: `Bearer ${token}` } })
    const d = r.ok ? await r.json() as unknown[] : []
    const first = (d[0] as Record<string, unknown>) ?? {}
    return ok({ gcp: first.gcp ?? '', gln: first.gln ?? '', participantId })
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

  return err(`Неизвестный action: ${action}`)
})
