/**
 * wb-advert — прокси для WB Advertising API (advert-api.wildberries.ru)
 * Все действия с рекламными кампаниями: список, статистика, кластеры, ставки, минус-фразы
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ADVERT_BASE = 'https://advert-api.wildberries.ru'

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

async function wbGet(apiKey: string, path: string, params?: Record<string, string>) {
  const url = new URL(`${ADVERT_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const r = await fetch(url.toString(), { headers: { Authorization: apiKey } })
  if (r.status === 401 || r.status === 403) throw new Error('no_adv_permission')
  if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
  return r.json()
}

async function wbPost(apiKey: string, path: string, body: unknown) {
  const r = await fetch(`${ADVERT_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (r.status === 401 || r.status === 403) throw new Error('no_adv_permission')
  if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
  const text = await r.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

async function wbDelete(apiKey: string, path: string, body: unknown) {
  const r = await fetch(`${ADVERT_BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (r.status === 401 || r.status === 403) throw new Error('no_adv_permission')
  if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
  return null
}

// Батч-загрузка остатков бюджетов кампаний (rate limit WB: 5 req/sec)
async function batchFetchBudgets(apiKey: string, ids: number[]): Promise<Record<number, number>> {
  const result: Record<number, number> = {}
  const BATCH = 5
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)
    const settled = await Promise.allSettled(batch.map(async id => {
      const fetchBudget = async () => {
        const r = await fetch(`${ADVERT_BASE}/adv/v1/budget?id=${id}`, { headers: { Authorization: apiKey } })
        if (r.status === 429) return null
        if (!r.ok) return null
        const d = await r.json()
        // WB может вернуть { total }, { balance }, просто число или другое
        if (typeof d === 'number') return d
        return (d?.total ?? d?.balance ?? d?.budget ?? d?.sum ?? null) as number | null
      }
      let total = await fetchBudget()
      // retry once on null (may have been 429)
      if (total === null) {
        await new Promise(r => setTimeout(r, 500))
        total = await fetchBudget()
      }
      return { id, total }
    }))
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value.total != null) result[s.value.id] = s.value.total
    }
    if (i + BATCH < ids.length) await new Promise(r => setTimeout(r, 300))
  }
  return result
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Auth
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

  // Проверяем доступ к магазину
  const { data: storeAccess } = await userClient.from('stores').select('id').eq('id', store_id).single()
  if (!storeAccess) return err('Магазин не найден или нет доступа', 403)

  // Получаем API-ключ магазина
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: storeRow } = await svc.from('stores').select('api_key').eq('id', store_id).single()
  const apiKey = (storeRow as { api_key?: string | null } | null)?.api_key
  if (!apiKey) return err('API-ключ не настроен для этого магазина')

  try {

    // ── Probe: найти рабочий endpoint ─────────────────────────────────────────
    if (action === 'probe') {
      const paths = [
        '/adv/v1/adverts',
        '/adv/v1/promotion/adverts',
        '/adv/v2/promotion/adverts',
        '/adv/v3/promotion/adverts',
        '/adv/v2/adverts',
        '/adv/v3/adverts',
        '/adv/v0/adverts',
        '/adv/v1/campaigns',
        '/adv/v2/campaigns',
        '/adv/v1/promotion/campaigns',
      ]
      const results: Record<string, string> = {}
      for (const path of paths) {
        try {
          const r = await fetch(`${ADVERT_BASE}${path}?status=11&limit=1`, {
            headers: { Authorization: apiKey },
          })
          const text = await r.text()
          results[path] = `${r.status}: ${text.slice(0, 120)}`
        } catch (e) {
          results[path] = `ERR: ${String(e).slice(0, 80)}`
        }
      }
      return ok({ probe: results })
    }

    if (action === 'campaigns') {
      // GET /api/advert/v2/adverts — правильный endpoint по документации WB
      // Параметр: statuses (строка через запятую), payment_type опционально
      const url = new URL(`${ADVERT_BASE}/api/advert/v2/adverts`)
      url.searchParams.set('statuses', '4,7,9,11')
      const r = await fetch(url.toString(), { headers: { Authorization: apiKey } })
      if (r.status === 401 || r.status === 403) throw new Error('no_adv_permission')
      if (r.status === 204) return ok({ campaigns: [] })
      if (r.status === 429) throw new Error('WB ограничил запросы (429). Подождите минуту и обновите страницу.')
      if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
      const text = await r.text()
      if (!text || text === 'null') return ok({ campaigns: [] })
      const data = JSON.parse(text)
      const raw: Array<Record<string, unknown>> = Array.isArray(data) ? data : (data?.adverts ?? [])
      // Нормализация: WB возвращает {id, bid_type, settings:{name, status, ...}, nm_settings}
      const campaigns = raw.map(a => {
        const s = (a.settings ?? {}) as Record<string, unknown>
        return {
          advertId: a.id ?? a.advertId,
          name: s.name ?? a.name ?? `Кампания ${a.id}`,
          type: a.bid_type === 'manual' ? 9 : 8,
          status: s.status ?? a.status ?? 11,
          createTime: a.createTime ?? s.createTime ?? '',
          changeTime: a.changeTime ?? s.changeTime ?? '',
          budget: s.budget,
          dailyBudget: s.dailyBudget,
        }
      })
      // Загружаем остатки бюджетов батчами по 5 (rate limit WB: 5 req/sec)
      const campaignIds = campaigns.map(c => Number(c.advertId)).filter(Boolean)
      const budgets = await batchFetchBudgets(apiKey, campaignIds)
      const campaignsWithBudgets = campaigns.map(c => ({
        ...c,
        budget: budgets[Number(c.advertId)] ?? c.budget ?? null,
      }))
      return ok({ campaigns: campaignsWithBudgets })
    }

    // ── Статистика кампаний ───────────────────────────────────────────────────
    if (action === 'campaign_stats') {
      const ids = body.ids as number[]
      const dates = body.dates as string[]
      if (!ids?.length || !dates?.length) return ok({ stats: [] })
      // GET /adv/v3/fullstats — только GET/HEAD (POST → 405)
      const url = new URL(`${ADVERT_BASE}/adv/v3/fullstats`)
      url.searchParams.set('ids', ids.join(','))
      url.searchParams.set('beginDate', dates[0])
      url.searchParams.set('endDate', dates[dates.length - 1])
      const r = await fetch(url.toString(), { headers: { Authorization: apiKey } })
      if (r.status === 401 || r.status === 403) throw new Error('no_adv_permission')
      if (r.status === 204) return ok({ stats: [] })
      if (r.status === 429) throw new Error('WB ограничил запросы на статистику (429). Подождите ~20 секунд и обновите.')
      if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
      const text = await r.text()
      if (!text || text === 'null') return ok({ stats: [] })
      const raw = JSON.parse(text)
      const rawArr: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : (raw?.data ?? raw?.stats ?? [])
      // Нормализация полей WB → наш интерфейс
      const stats = rawArr.map(s => ({
        advertId: s.advertId,
        views: s.views ?? 0,
        clicks: s.clicks ?? 0,
        ctr: s.ctr ?? 0,
        cpc: s.cpc ?? 0,
        sum: s.sum ?? 0,
        orders: s.orders ?? 0,
        ordersSumRub: s.sum_price ?? 0,   // WB → наш CampaignStat.ordersSumRub
        cr: s.cr,
        atbs: s.atbs,
        shks: s.shks,
      }))
      return ok({ stats })
    }

    // ── Пауза кампании — GET /adv/v0/pause ─────────────────────────────────────
    if (action === 'pause_campaign') {
      const id = body.id as number
      await wbGet(apiKey, '/adv/v0/pause', { id: String(id) })
      return ok({ ok: true })
    }

    // ── Запуск кампании — GET /adv/v0/start ────────────────────────────────────
    if (action === 'start_campaign') {
      const id = body.id as number
      await wbGet(apiKey, '/adv/v0/start', { id: String(id) })
      return ok({ ok: true })
    }

    // ── Список кластеров кампании ─────────────────────────────────────────────
    if (action === 'clusters') {
      const id = body.id as number
      // Требует: { items: [{ id }] }, ответ: { items: [...] }
      const data = await wbPost(apiKey, '/adv/v0/normquery/list', { items: [{ id }] })
      const clusters = (data as Record<string, unknown>)?.items ?? data ?? []
      return ok({ clusters })
    }

    // ── Статистика кластеров ──────────────────────────────────────────────────
    if (action === 'cluster_stats') {
      const id = body.id as number
      const dates = body.dates as string[]
      if (!dates?.length) return ok({ stats: [] })
      // Требует: { from, to, items: [{ id }] }, ответ: { stats: [...] }
      const data = await wbPost(apiKey, '/adv/v0/normquery/stats', {
        from: dates[0],
        to: dates[dates.length - 1],
        items: [{ id }],
      })
      const stats = (data as Record<string, unknown>)?.stats ?? data ?? []
      return ok({ stats })
    }

    // ── Установить ставку кластера ────────────────────────────────────────────
    if (action === 'set_bid') {
      const id = body.id as number
      const bids = body.bids as Array<{ phrase: string; bid: number }>
      await wbPost(apiKey, '/adv/v0/normquery/bids', { id, bids })
      return ok({ ok: true })
    }

    // ── Удалить ставку кластера (деактивация) ─────────────────────────────────
    if (action === 'delete_bid') {
      const id = body.id as number
      const phrases = body.phrases as string[]
      await wbDelete(apiKey, '/adv/v0/normquery/bids', { id, phrases })
      return ok({ ok: true })
    }

    // ── Вернуть базовую ставку ────────────────────────────────────────────────
    if (action === 'reset_bid') {
      // "Вернуть базовую ставку" = удалить кастомную ставку кластера
      const id = body.id as number
      const phrases = body.phrases as string[]
      await wbDelete(apiKey, '/adv/v0/normquery/bids', { id, phrases })
      return ok({ ok: true })
    }

    // ── Получить минус-фразы ──────────────────────────────────────────────────
    if (action === 'get_minus') {
      const id = body.id as number
      // WB требует: { Items: [id] }
      const data = await wbPost(apiKey, '/adv/v0/normquery/get-minus', { Items: [id] })
      // Ответ: [{advertId, minus: string[]}] или просто string[]
      let minus: string[] = []
      if (Array.isArray(data)) {
        if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
          minus = (data[0] as Record<string, unknown>).minus as string[] ?? []
        } else if (typeof data[0] === 'string') {
          minus = data as string[]
        }
      }
      return ok({ minus })
    }

    // ── Установить минус-фразы ────────────────────────────────────────────────
    if (action === 'set_minus') {
      const id = body.id as number
      const minus = body.minus as string[]
      // WB требует: { Items: [{ id, minus }] }
      await wbPost(apiKey, '/adv/v0/normquery/set-minus', { Items: [{ id, minus }] })
      return ok({ ok: true })
    }

    // ── Рекомендации по ставкам — GET /api/advert/v0/bids/recommendations ──────────
    if (action === 'bid_recommendations') {
      const id = body.id as number
      const data = await wbGet(apiKey, '/api/advert/v0/bids/recommendations', { id: String(id) })
      return ok({ recommendations: data ?? [] })
    }

    // ── Диагностика: сырой ответ WB на бюджет кампании ─────────────────
    if (action === 'probe_budget') {
      const id = body.id as number
      const r = await fetch(`${ADVERT_BASE}/adv/v1/budget?id=${id}`, { headers: { Authorization: apiKey } })
      const text = await r.text()
      return ok({ status: r.status, raw: text, id, url: `/adv/v1/budget?id=${id}` })
    }

    // ── Баланс единого счёта ─────────────────────────────────────────────────
    if (action === 'balance') {
      const data = await wbGet(apiKey, '/adv/v1/balance')
      return ok({ balance: data })
    }

    // ── Бюджет одной кампании ─────────────────────────────────────────────────
    if (action === 'campaign_budget') {
      const id = body.id as number
      const data = await wbGet(apiKey, '/adv/v1/budget', { id: String(id) })
      return ok({ budget: (data as Record<string, unknown>)?.total ?? null })
    }

    // ── Пополнить бюджет кампании ─────────────────────────────────────────────
    if (action === 'deposit_budget') {
      const id = body.id as number
      const sum = body.sum as number
      await wbPost(apiKey, '/adv/v1/budget/deposit', { id, sum, type: 1 })
      // Возвращаем обновлённый остаток бюджета
      const budgetData = await wbGet(apiKey, '/adv/v1/budget', { id: String(id) })
      return ok({ ok: true, newBudget: (budgetData as Record<string, unknown>)?.total ?? null })
    }

    return err(`Неизвестный action: ${action}`)

  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'no_adv_permission') {
      return ok({ error: 'no_adv_permission', message: 'API-ключ не имеет прав на рекламу. Добавьте разрешение «Реклама» в настройках ключа в кабинете WB.' })
    }
    // Возвращаем ошибку как 200 чтобы видеть реальный текст в UI
    return ok({ error: 'wb_error', message: msg })
  }
})
