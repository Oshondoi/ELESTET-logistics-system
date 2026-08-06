/**
 * wb-fbs — прокси для WB Marketplace FBS API
 * Управление FBS-заказами и остатками
 * Без внешних импортов — только Deno fetch()
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const WB_BASE = 'https://marketplace-api.wildberries.ru'

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

async function wbGet(apiKey: string, path: string, params?: Record<string, string>) {
  const url = new URL(`${WB_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const r = await fetch(url.toString(), { headers: { Authorization: apiKey } })
  if (r.status === 401 || r.status === 403) throw new Error('no_permission')
  if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
  return r.json()
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

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    // Auth — verify JWT via Supabase Auth REST API
    const authHdr = req.headers.get('Authorization')
    if (!authHdr) return err('Не авторизован', 401)
    const userId = await sbAuthGetUser(authHdr)
    if (!userId) return err('Не авторизован', 401)

    const body = await req.json()
    const { action, store_id, wb_warehouse_id, stocks } = body

    if (!store_id) return err('store_id обязателен')

    // Verify user has access to store via RLS (use user's token)
    const anonKey = SUPABASE_ANON_KEY
    const accessRows = await (async () => {
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
      const { date_from_ts, limit = 1000 } = body as { date_from_ts?: number; limit?: number }
      const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 3600_000) / 1000)
      const params: Record<string, string> = {
        limit: String(Math.min(limit, 1000)),
        next: '0',
        dateFrom: String(date_from_ts ?? thirtyDaysAgo),
      }
      const data = await wbGet(apiKey, '/api/v3/orders', params)
      return ok(data)
    }

    if (action === 'sync_orders') {
      // Синк: WB → fbs_orders в Supabase (upsert)
      const dateFromTs = Math.floor((Date.now() - 30 * 24 * 3600_000) / 1000)

      // Получаем заказы за 30 дней + новые
      const [allRes, newRes] = await Promise.all([
        wbGet(apiKey, '/api/v3/orders', { limit: '1000', next: '0', dateFrom: String(dateFromTs) }),
        wbGet(apiKey, '/api/v3/orders/new'),
      ])
      const allOrders: any[] = allRes.orders ?? []
      const newOrders: any[] = newRes.orders ?? []

      // Мёрджим: новые перезаписывают если пересекаются по id
      const orderMap = new Map<number, any>()
      allOrders.forEach(o => orderMap.set(o.id, o))
      newOrders.forEach(o => orderMap.set(o.id, o))
      const merged: any[] = Array.from(orderMap.values())

      // Получаем supplierStatus для всех
      let statusMap = new Map<number, string>()
      if (merged.length > 0) {
        const sr = await fetch(`${WB_BASE}/api/v3/orders/status`, {
          method: 'POST',
          headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orders: merged.map(o => o.id) }),
        })
        if (sr.ok) {
          const sd = await sr.json()
          const WB_CANCEL_STATUSES = new Set(['declined_by_client', 'canceled', 'cancel_by_client'])
          ;(sd.orders ?? []).forEach((s: any) => {
            const status = WB_CANCEL_STATUSES.has(s.wbStatus) ? 'cancel' : (s.supplierStatus ?? 'new')
            statusMap.set(s.id, status)
          })
        }
      }
      // orders/new всегда new если не нашли в status
      newOrders.forEach(o => { if (!statusMap.has(o.id)) statusMap.set(o.id, 'new') })

      // Получаем account_id магазина
      const storeR = await fetch(`${SUPABASE_URL}/rest/v1/stores?id=eq.${store_id}&select=account_id&limit=1`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      })
      const storeData = await storeR.json()
      const account_id = storeData[0]?.account_id
      if (!account_id) return err('Магазин не найден')

      // Upsert rows в fbs_orders
      const rows = merged.map(o => ({
        account_id,
        store_id,
        wb_order_id: o.id,
        wb_status: statusMap.get(o.id) ?? 'new',
        supply_id: o.supplyId || null,
        rid: o.rid ?? null,
        article: o.article ?? null,
        nm_id: o.nmId ?? null,
        chrt_id: o.chrtId ?? null,
        // skus не включаем — jsonb vs text[] mismatch в PostgREST; читается из data.skus
        price: o.price ?? 0,
        warehouse_id: o.warehouseId ?? 0,
        created_at: o.createdAt ?? null,
        ddate: o.ddate || null,
        data: o,
        synced_at: new Date().toISOString(),
      }))

      if (rows.length > 0) {
        const upsertR = await fetch(`${SUPABASE_URL}/rest/v1/fbs_orders?on_conflict=store_id,wb_order_id`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(rows),
        })
        if (!upsertR.ok) {
          const errText = await upsertR.text()
          throw new Error(`DB upsert failed ${upsertR.status}: ${errText.slice(0, 300)}`)
        }
      }

      // Получаем наши DB-заказы со статусом 'new' — проверим их у WB отдельно
      const dbNewR = await fetch(`${SUPABASE_URL}/rest/v1/fbs_orders?store_id=eq.${store_id}&wb_status=eq.new&select=wb_order_id`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      })
      const dbNewOrders: { wb_order_id: number }[] = await dbNewR.json().catch(() => [])
      const dbNewIds = dbNewOrders.map(o => o.wb_order_id).filter(id => !orderMap.has(id))

      // Проверяем статус стейл-заказов (которые есть в DB как new, но не пришли от WB)
      if (dbNewIds.length > 0) {
        const sr2 = await fetch(`${WB_BASE}/api/v3/orders/status`, {
          method: 'POST',
          headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orders: dbNewIds }),
        })
        if (sr2.ok) {
          const sd2 = await sr2.json()
          const WB_CANCEL_STATUSES2 = new Set(['declined_by_client', 'canceled', 'cancel_by_client'])
          const staleRows = (sd2.orders ?? []).map((s: any) => ({
            store_id, wb_order_id: s.id,
            wb_status: WB_CANCEL_STATUSES2.has(s.wbStatus) ? 'cancel' : (s.supplierStatus && s.supplierStatus !== 'new' ? s.supplierStatus : 'cancel'),
            synced_at: new Date().toISOString(),
          }))
          // Заказы которых WB вообще не знает (не вернул в status) → cancel
          const returnedIds = new Set((sd2.orders ?? []).map((s: any) => s.id))
          dbNewIds.filter(id => !returnedIds.has(id)).forEach(id => staleRows.push({
            store_id, wb_order_id: id, wb_status: 'cancel', synced_at: new Date().toISOString(),
          }))
          if (staleRows.length > 0) {
            await fetch(`${SUPABASE_URL}/rest/v1/fbs_orders`, {
              method: 'POST',
              headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
              body: JSON.stringify(staleRows),
            })
          }
        }
      }

      // Обновляем sync log
      await fetch(`${SUPABASE_URL}/rest/v1/fbs_sync_log`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ store_id, last_synced_at: new Date().toISOString(), orders_count: rows.length, error: null }),
      })

      return ok({ synced: rows.length })
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
      const { supply_id, order_id } = body as { supply_id: string; order_id: number }
      if (!supply_id || !order_id) return err('supply_id и order_id обязательны')
      // Новый bulk-endpoint (старый /api/v3/supplies/{id}/orders/{orderId} удалён 18.12.2025)
      const r = await fetch(`${WB_BASE}/api/marketplace/v3/supplies/${encodeURIComponent(supply_id)}/orders`, {
        method: 'PATCH',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: [order_id] }),
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

    if (action === 'get_supplies') {
      // isSupplyClosed=false → В сборке, true → В доставке/Завершённые
      const { closed = false, limit = 50 } = body as { closed?: boolean; limit?: number }
      const data = await wbGet(apiKey, '/api/v3/supplies', {
        limit: String(limit),
        next: '0',
        isSupplyClosed: String(closed),
      })
      return ok(data)
    }

    if (action === 'get_supply_orders') {
      const { supply_id } = body as { supply_id: string }
      if (!supply_id) return err('supply_id обязателен')
      const data = await wbGet(apiKey, `/api/v3/supplies/${supply_id}/orders`)
      return ok(data)
    }

    if (action === 'get_orders_status') {
      const { order_ids } = body as { order_ids: number[] }
      if (!order_ids?.length) return err('order_ids обязателен')
      const r = await fetch(`${WB_BASE}/api/v3/orders/status`, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: order_ids }),
      })
      if (r.status === 401 || r.status === 403) throw new Error('no_permission')
      if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
      return ok(await r.json())
    }

    if (action === 'get_sticker') {
      const { order_ids, fmt = 'svg', w = 58, h = 40 } = body as { order_ids: number[]; fmt?: string; w?: number; h?: number }
      if (!order_ids?.length) return err('order_ids обязателен')
      const r = await fetch(`${WB_BASE}/api/v3/orders/stickers?type=${fmt}&width=${w}&height=${h}`, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: order_ids }),
      })
      if (r.status === 401 || r.status === 403) throw new Error('no_permission')
      if (!r.ok) throw new Error(`WB ${r.status}: ${await r.text()}`)
      return ok(await r.json())
    }

    return err('Неизвестный action')
  } catch (e) {
    const msg = String(e)
    if (msg.includes('no_permission')) return err('Нет прав доступа к WB API. Проверьте API ключ.', 403)
    return err(msg, 500)
  }
})
