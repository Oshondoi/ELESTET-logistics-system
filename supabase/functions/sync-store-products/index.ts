import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Supabase автоматически инжектирует эти переменные в Edge Functions
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// WB API: получить все карточки товаров (с пагинацией)
async function fetchAllWbCards(apiKey: string): Promise<unknown[]> {
  const cards: unknown[] = []
  let cursor: { updatedAt?: string; nmID?: number } | null = null
  const MAX_PAGES = 200 // защита от бесконечного цикла (200 * 100 = 20 000 товаров)

  for (let page = 0; page < MAX_PAGES; page++) {
    const body: Record<string, unknown> = {
      settings: {
        cursor: {
          limit: 100,
          ...(cursor?.updatedAt ? { updatedAt: cursor.updatedAt } : {}),
          ...(cursor?.nmID ? { nmID: cursor.nmID } : {}),
        },
        filter: { withPhoto: -1 }, // -1 = все товары (с фото и без)
      },
    }

    const resp = await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`WB API ${resp.status}: ${errText}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await resp.json()) as any
    const batch: unknown[] = data.cards ?? []
    cards.push(...batch)

    // Если вернулось меньше limit — это последняя страница
    if (batch.length < 100) break

    // Курсор для следующей страницы
    cursor = {
      updatedAt: data.cursor?.updatedAt,
      nmID: data.cursor?.nmID,
    }
  }

  return cards
}

// Преобразует карточку WB в строку таблицы products
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformCard(card: any, storeId: string, accountId: string) {
  const barcodes: string[] = (card.sizes ?? []).flatMap(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => (s.skus ?? []) as string[]
  )

  // Извлекаем нужные характеристики
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chars: Array<{ name: string; value: unknown }> = card.characteristics ?? []
  const getChar = (names: string[]): string | null => {
    for (const name of names) {
      const found = chars.find((c) => c.name?.toLowerCase() === name.toLowerCase())
      if (found) {
        const val = found.value
        if (Array.isArray(val)) return val.join(', ') || null
        if (typeof val === 'string') return val || null
      }
    }
    return null
  }

  return {
    account_id: accountId,
    store_id: storeId,
    nm_id: card.nmID as number,
    vendor_code: (card.vendorCode as string | undefined) ?? null,
    name: (card.title as string | undefined) ?? null,
    brand: (card.brand as string | undefined) ?? null,
    category: (card.subjectName as string | undefined) ?? null,
    color: getChar(['Цвет', 'Цвета', 'Основной цвет']),
    composition: getChar(['Состав', 'Состав материала']),
    country: getChar(['Страна производства', 'Страна изготовления', 'Страна']),
    barcodes,
    photos: card.photos ?? null,
    sizes: card.sizes ?? null,
    raw_data: card,
    synced_at: new Date().toISOString(),
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    // Supabase PostgresError / FunctionsHttpError
    const obj = e as Record<string, unknown>
    const msg = obj.message ?? obj.msg ?? obj.error ?? obj.details ?? obj.hint
    if (msg) return String(msg)
    try { return JSON.stringify(e) } catch { /* ignore */ }
  }
  return String(e)
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { store_id } = (await req.json()) as { store_id?: string }
    if (!store_id) return jsonResponse({ success: false, error: 'store_id обязателен' })

    // ── Проверяем доступ пользователя ────────────────────────────
    const jwt = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!jwt) return jsonResponse({ success: false, error: 'Unauthorized' })

    // Клиент с правами пользователя — для проверки RLS
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })

    // Клиент с service role — для записи в products и sync_log (обходит RLS)
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Получаем магазин через userClient — RLS гарантирует, что пользователь имеет доступ
    const { data: store, error: storeErr } = await userClient
      .from('stores')
      .select('id, account_id, api_key, name')
      .eq('id', store_id)
      .single()

    if (storeErr || !store) return jsonResponse({ success: false, error: 'Магазин не найден или нет доступа' })
    if (!store.api_key) return jsonResponse({ success: false, error: 'У магазина не задан API ключ' })

    // ── Загружаем товары из WB ────────────────────────────────────
    let cards: unknown[]
    try {
      cards = await fetchAllWbCards(store.api_key as string)
    } catch (wbErr: unknown) {
      const msg = errMsg(wbErr)

      // Логируем ошибку синхронизации
      await adminClient.from('store_sync_log').insert({
        store_id: store.id,
        products_count: 0,
        status: 'error',
        error_message: msg,
        synced_at: new Date().toISOString(),
      })

      return jsonResponse({ success: false, error: `Ошибка WB API: ${msg}` })
    }

    // ── Upsert в products (батчами по 500) ───────────────────────
    const rows = cards.map((card) => transformCard(card, store.id as string, store.account_id as string))
    const BATCH_SIZE = 500

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const { error: upsertErr } = await adminClient
        .from('products')
        .upsert(batch, { onConflict: 'store_id,nm_id' })

      if (upsertErr) throw upsertErr
    }

    // ── Логируем успех ────────────────────────────────────────────
    await adminClient.from('store_sync_log').insert({
      store_id: store.id,
      products_count: rows.length,
      status: 'ok',
      synced_at: new Date().toISOString(),
    })

    return jsonResponse({ success: true, count: rows.length })
  } catch (err: unknown) {
    const msg = errMsg(err)
    console.error('sync-store-products error:', msg)
    return jsonResponse({ success: false, error: msg })
  }
})
