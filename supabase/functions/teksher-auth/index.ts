import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const TEKSHER_BASE = 'https://label.teksher.kg/facade/api/v1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Получить JWT токен от Teksher ─────────────────────────────────────────────
async function teksherLogin(login: string, password: string): Promise<string> {
  const resp = await fetch(`${TEKSHER_BASE.replace('/api/v1', '')}/oauth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: login, password }),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Teksher auth failed (${resp.status}): ${text}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await resp.json() as any
  // Teksher возвращает { status: 'SUCCESS', data: { access_token: '...' } }
  const token = data?.data?.access_token ?? data.token ?? data.accessToken ?? data.access_token
  if (!token) throw new Error('Teksher не вернул токен')
  return token as string
}

// ── Получить профиль участника (participantId, имя) ──────────────────────────
async function teksherProfile(token: string): Promise<{ participantId: string; participantName: string }> {
  // GET /facade/api/v1/users/getCurrentUser → { id, fullName, participant: { id } }
  const resp = await fetch(`${TEKSHER_BASE}/users/getCurrentUser`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`Teksher profile error: ${resp.status}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await resp.json() as any
  return {
    participantId: String(data?.participant?.id ?? data.id ?? ''),
    participantName: (data.fullName ?? data.name ?? '') as string,
  }
}

// ── Получить баланс кодов ─────────────────────────────────────────────────────
async function teksherBalance(token: string): Promise<{ balance: number; balanceMoney: number }> {
  // balance (KM codes) — сумма по product_groups/balance ("Объединённый счёт" или первый элемент)
  // balanceMoney — монетарный баланс из billing/balance
  const [pgResp, billingResp] = await Promise.all([
    fetch(`${TEKSHER_BASE}/product_groups/balance`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${TEKSHER_BASE}/participants/billing/balance`, { headers: { Authorization: `Bearer ${token}` } }),
  ])

  let balance = 0
  if (pgResp.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pgData = await pgResp.json() as any
    const contracts: any[] = pgData?.contracts ?? []
    // Предпочитаем Объединённый счёт, если нет — сумма всех
    const combined = contracts.find((c: any) => c.name?.includes('Объедин') || c.name?.includes('Объедин'))
    balance = combined ? combined.balance : contracts.reduce((s: number, c: any) => s + (c.balance ?? 0), 0)
  }

  let balanceMoney = 0
  if (billingResp.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const billingData = await billingResp.json() as any
    const entries: any[] = Array.isArray(billingData) ? billingData : [billingData]
    balanceMoney = entries.reduce((s: number, e: any) => s + (e.saldo ?? e.enable ?? 0), 0)
  }

  return { balance, balanceMoney }
}

// ── Количество товаров (GTIN) ─────────────────────────────────────────────────
async function teksherProductCount(token: string): Promise<number> {
  // Spring Data pageable: { page: { totalElements: N } }
  const resp = await fetch(`${TEKSHER_BASE}/products?page=0&size=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await resp.json() as any
  return (data.page?.totalElements ?? data.totalElements ?? data.total ?? 0) as number
}

// ── Количество операций ───────────────────────────────────────────────────────
async function teksherOperationCount(token: string): Promise<number> {
  // Spring Data pageable: { page: { totalElements: N } }
  const resp = await fetch(`${TEKSHER_BASE}/marking_codes/filter?page=0&size=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await resp.json() as any
  return (data.page?.totalElements ?? data.totalElements ?? data.total ?? 0) as number
}

// ── Получить свежие данные с Teksher и сохранить в БД ────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAndSaveStats(serviceClient: any, login: string, password: string, store_id: string) {
  const token = await teksherLogin(login, password)
  const [profile, bal, products, operations] = await Promise.all([
    teksherProfile(token),
    teksherBalance(token),
    teksherProductCount(token),
    teksherOperationCount(token),
  ])
  const syncedAt = new Date().toISOString()
  await serviceClient
    .from('stores')
    .update({
      teksher_participant_name: profile.participantName,
      teksher_balance: bal.balance,
      teksher_balance_money: bal.balanceMoney,
      teksher_products: products,
      teksher_operations: operations,
      teksher_synced_at: syncedAt,
    })
    .eq('id', store_id)
  return { connected: true as const, participantId: profile.participantId, participantName: profile.participantName, balance: bal.balance, balanceMoney: bal.balanceMoney, products, operations, syncedAt }
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonError('Не авторизован', 401)

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return jsonError('Не авторизован', 401)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await req.json() as any
  const { store_id, action = 'connect' } = body as { store_id?: string; action?: string }

  if (!store_id) return jsonError('store_id обязателен')

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: memberCheck } = await userClient
    .from('stores')
    .select('id')
    .eq('id', store_id)
    .single()

  if (!memberCheck) return jsonError('Магазин не найден или нет доступа', 403)

  // ── action: connect — сохранить логин+пароль, получить и закешировать данные ─
  if (action === 'connect') {
    const { login, password } = body as { login?: string; password?: string }
    if (!login || !password) return jsonError('login и password обязательны')

    // Сначала сохраняем credentials (password только в БД, никогда не возвращается клиенту)
    await serviceClient
      .from('stores')
      .update({ teksher_login: login, teksher_password: password })
      .eq('id', store_id)

    let stats: Awaited<ReturnType<typeof fetchAndSaveStats>>
    try {
      stats = await fetchAndSaveStats(serviceClient, login, password, store_id)
    } catch (e) {
      return jsonError((e as Error).message)
    }

    // Сохраняем participant_id отдельно (он из profile, не из stats)
    await serviceClient
      .from('stores')
      .update({ teksher_participant_id: stats.participantId })
      .eq('id', store_id)

    return jsonOk(stats)
  }

  // ── action: stats — читаем из БД (мгновенно, без вызова Teksher) ─────────────
  if (action === 'stats') {
    const { data: store, error: storeErr } = await serviceClient
      .from('stores')
      .select('teksher_login, teksher_participant_id, teksher_participant_name, teksher_balance, teksher_balance_money, teksher_products, teksher_operations, teksher_synced_at')
      .eq('id', store_id)
      .single()

    // Если колонки ещё не созданы (SQL патч не применён) — пробуем минимальный select
    if (storeErr) {
      const { data: storeMin } = await serviceClient
        .from('stores')
        .select('teksher_login, teksher_participant_id')
        .eq('id', store_id)
        .single()
      if (!storeMin) return jsonError('Магазин не найден')
      if (!storeMin.teksher_login) return jsonOk({ connected: false })
      // Колонки кеша ещё не созданы — сообщаем что нужна синхронизация
      return jsonOk({ connected: true, participantId: storeMin.teksher_participant_id ?? '', participantName: '', balance: 0, balanceMoney: 0, products: 0, operations: 0, syncedAt: null, needsSync: true })
    }

    if (!store) return jsonError('Магазин не найден')
    if (!store.teksher_login) return jsonOk({ connected: false })

    return jsonOk({
      connected: true,
      participantId: store.teksher_participant_id ?? '',
      participantName: store.teksher_participant_name ?? '',
      balance: store.teksher_balance ?? 0,
      balanceMoney: store.teksher_balance_money ?? 0,
      products: store.teksher_products ?? 0,
      operations: store.teksher_operations ?? 0,
      syncedAt: store.teksher_synced_at ?? null,
    })
  }

  // ── action: sync — свежие данные с Teksher + сохранить в БД ─────────────────
  if (action === 'sync') {
    const { data: store, error: storeErr } = await serviceClient
      .from('stores')
      .select('teksher_login, teksher_password, teksher_participant_id')
      .eq('id', store_id)
      .single()

    if (storeErr || !store) return jsonError('Магазин не найден')
    if (!store.teksher_login || !store.teksher_password) return jsonOk({ connected: false })

    try {
      const stats = await fetchAndSaveStats(serviceClient, store.teksher_login as string, store.teksher_password as string, store_id)
      return jsonOk({ ...stats, participantId: store.teksher_participant_id ?? stats.participantId })
    } catch (e) {
      return jsonError(`Ошибка синхронизации: ${(e as Error).message}`)
    }
  }

  // ── action: products — список товаров (GTIN) с пагинацией ───────────────────
  if (action === 'products') {
    const { data: store } = await serviceClient
      .from('stores')
      .select('teksher_login, teksher_password')
      .eq('id', store_id)
      .single()

    if (!store?.teksher_login || !store?.teksher_password) return jsonOk({ connected: false })

    const { page = 0, size = 20, search = '' } = body as { page?: number; size?: number; search?: string }

    try {
      const token = await teksherLogin(store.teksher_login as string, store.teksher_password as string)
      const params = new URLSearchParams({ page: String(page), size: String(size) })
      if (search) params.set('name', search)
      const resp = await fetch(`${TEKSHER_BASE}/products?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) throw new Error(`Teksher products error: ${resp.status}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await resp.json() as any
      return jsonOk({
        items: data.content ?? data.items ?? [],
        totalElements: data.page?.totalElements ?? data.totalElements ?? 0,
        totalPages: data.page?.totalPages ?? data.totalPages ?? 1,
        pageNumber: data.page?.number ?? page,
      })
    } catch (e) {
      return jsonError((e as Error).message)
    }
  }

  // ── action: codes — список КИЗ-кодов с пагинацией и фильтром по статусу ──────
  if (action === 'codes') {
    const { data: store } = await serviceClient
      .from('stores')
      .select('teksher_login, teksher_password')
      .eq('id', store_id)
      .single()

    if (!store?.teksher_login || !store?.teksher_password) return jsonOk({ connected: false })

    const { page = 0, size = 30, status = '', productGroupCode = 'LP RF' } = body as { page?: number; size?: number; status?: string; productGroupCode?: string }

    try {
      const token = await teksherLogin(store.teksher_login as string, store.teksher_password as string)
      const params = new URLSearchParams({ page: String(page), size: String(size), productGroupCode })
      if (status) params.set('status', status)
      const resp = await fetch(`${TEKSHER_BASE}/marking_codes/filter?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) throw new Error(`Teksher codes error: ${resp.status}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await resp.json() as any
      return jsonOk({
        items: data.content ?? data.items ?? [],
        totalElements: data.page?.totalElements ?? data.totalElements ?? 0,
        totalPages: data.page?.totalPages ?? data.totalPages ?? 1,
      })
    } catch (e) {
      return jsonError((e as Error).message)
    }
  }

  // ── action: operations — журнал операций ─────────────────────────────────────
  if (action === 'operations') {
    const { data: store } = await serviceClient
      .from('stores')
      .select('teksher_login, teksher_password')
      .eq('id', store_id)
      .single()

    if (!store?.teksher_login || !store?.teksher_password) return jsonOk({ connected: false })

    const { page = 0, size = 20 } = body as { page?: number; size?: number }

    try {
      const token = await teksherLogin(store.teksher_login as string, store.teksher_password as string)
      const params = new URLSearchParams({ page: String(page), size: String(size) })
      const resp = await fetch(`${TEKSHER_BASE}/operations?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) throw new Error(`Teksher operations error: ${resp.status}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await resp.json() as any
      return jsonOk({
        items: data.content ?? data.items ?? (Array.isArray(data) ? data : []),
        totalElements: data.page?.totalElements ?? data.totalElements ?? 0,
        totalPages: data.page?.totalPages ?? data.totalPages ?? 1,
      })
    } catch (e) {
      return jsonError((e as Error).message)
    }
  }

  // ── action: disconnect — удалить credentials и кеш ───────────────────────────
  if (action === 'disconnect') {
    await serviceClient
      .from('stores')
      .update({
        teksher_login: null,
        teksher_password: null,
        teksher_participant_id: null,
        teksher_participant_name: null,
        teksher_balance: null,
        teksher_balance_money: null,
        teksher_products: null,
        teksher_operations: null,
        teksher_synced_at: null,
      })
      .eq('id', store_id)

    return jsonOk({ disconnected: true })
  }

  return jsonError(`Неизвестный action: ${action}`)
})
