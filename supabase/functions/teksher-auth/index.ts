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

  // Если токен ещё действителен — возвращаем сразу
  if (row.teksher_token && row.teksher_token_exp) {
    const exp = new Date(row.teksher_token_exp).getTime()
    if (exp > Date.now() + 60_000) return row.teksher_token  // запас буфер 1 минута
  }

  // Логинимся и кешируем новый токен
  const token = await tkLogin(row.teksher_login, row.teksher_password)
  const exp = new Date(Date.now() + 25 * 60 * 1000).toISOString()  // кеш на 25 минут
  await svc.from('stores').update({ teksher_token: token, teksher_token_exp: exp }).eq('id', store_id)
  return token
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

    // Сохраняем credentials + кешируем токен
    const tokenExp = new Date(Date.now() + 25 * 60 * 1000).toISOString()
    await svc.from('stores').update({ teksher_login: login, teksher_password: password, teksher_participant_id: participantId, teksher_participant_name: participantName, teksher_token: token, teksher_token_exp: tokenExp }).eq('id', store_id)

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

  return err(`Неизвестный action: ${action}`)
})
