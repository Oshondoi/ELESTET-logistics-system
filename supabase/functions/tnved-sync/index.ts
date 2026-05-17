import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const FACADE = 'https://label.teksher.kg/facade'
const BASE = `${FACADE}/api/v1`

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function resp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

async function tkLogin(login: string, password: string): Promise<string> {
  const r = await fetch(`${FACADE}/oauth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: login, password }),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`Teksher login failed (${r.status}): ${txt.slice(0, 200)}`)
  }
  const d = await r.json() as Record<string, unknown>
  const token = (d?.data as Record<string, unknown>)?.access_token ?? d.access_token
  if (!token) throw new Error('Teksher не вернул токен')
  return token as string
}

// Функция синхронизации базы ТН ВЭД из Teksher → Supabase.
// Всегда возвращает HTTP 200 (успех или { error: "..." }).
// Вызывается: вручную кнопкой в UI, или автоматически pg_cron в 22:00 UTC (04:00 Бишкек).

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Найти любой магазин с подключённым Teksher
    const { data: stores, error: storesErr } = await svc
      .from('stores')
      .select('id, teksher_login, teksher_password')
      .not('teksher_login', 'is', null)
      .not('teksher_password', 'is', null)
      .limit(1)

    if (storesErr) return resp({ error: `Ошибка БД при поиске магазинов: ${storesErr.message}` })

    const store = (stores as Array<{ id: string; teksher_login: string; teksher_password: string }> | null)?.[0]
    if (!store) return resp({ error: 'Нет магазинов с подключённым Teksher' })

    let token: string
    try { token = await tkLogin(store.teksher_login, store.teksher_password) }
    catch (e) { return resp({ error: `Ошибка входа в Teksher: ${(e as Error).message}` }) }

    // Постранично скачать все коды ТН ВЭД
    const PAGE_SIZE = 100
    let page = 0
    let total = 0
    const allRows: Array<{
      code: string; sub_position_name: string; position: string; position_name: string; group_name: string; synced_at: string;
      subgroup_id: number | null; subgroup_name: string | null; teksher_id: number | null;
    }> = []

    const now = new Date().toISOString()
    while (true) {
      const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) })
      let r: Response
      try {
        r = await fetch(`${BASE}/tnveds?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      } catch (e) {
        return resp({ error: `Ошибка сети при запросе ТН ВЭД: ${(e as Error).message}` })
      }

      if (!r.ok) {
        const txt = await r.text().catch(() => '')
        if (page === 0) return resp({ error: `Teksher /tnved вернул ${r.status}: ${txt.slice(0, 300)}` })
        break // Дошли до конца
      }

      const d = await r.json() as Record<string, unknown>
      const items = (d.content ?? d.items ?? []) as Record<string, unknown>[]

      for (const item of items) {
        const code = String(item.code ?? item.fullCode ?? '').trim()
        if (!code) continue
        const sg = item.productSubgroup as Record<string, unknown> | null
        allRows.push({
          code,
          sub_position_name: String(item.name ?? item.subPositionName ?? ''),
          position:          String(item.rootCode ?? item.position ?? ''),
          position_name:     String(item.rootName ?? item.positionName ?? ''),
          group_name:        String(sg?.name ?? item.groupName ?? ''),
          synced_at:         now,
          teksher_id:        item.id != null ? Number(item.id) : null,
          subgroup_id:       sg?.id != null ? Number(sg.id) : null,
          subgroup_name:     sg?.name != null ? String(sg.name) : null,
        })
      }

      const totalEl = Number((d.page as Record<string, unknown>)?.totalElements ?? d.totalElements ?? 0)
      if (totalEl > 0) total = totalEl
      if (items.length < PAGE_SIZE || (total > 0 && allRows.length >= total) || page > 300) break
      page++
    }

    if (allRows.length === 0) {
      return resp({ error: 'Teksher вернул 0 кодов ТН ВЭД' })
    }

    // Пакетный upsert по 500 строк
    const BATCH = 500
    const upsertErrors: string[] = []
    for (let i = 0; i < allRows.length; i += BATCH) {
      const { error } = await svc.from('tnved_codes').upsert(allRows.slice(i, i + BATCH), { onConflict: 'code' })
      if (error) upsertErrors.push(error.message)
    }

    if (upsertErrors.length > 0) {
      return resp({ error: `Ошибка записи в БД: ${upsertErrors[0]}` })
    }

    // ── Синхронизируем шаблоны атрибутов для каждой уникальной подгруппы ─────────────────────────
    const uniqueSubgroups = new Map<number, string>()
    for (const row of allRows) {
      if (row.subgroup_id != null && !uniqueSubgroups.has(row.subgroup_id)) {
        uniqueSubgroups.set(row.subgroup_id, row.subgroup_name ?? '')
      }
    }

    let templatesSynced = 0
    for (const [subgroupId, subgroupName] of uniqueSubgroups) {
      try {
        const tr = await fetch(`${BASE}/products/attribute_templates?subgroupId=${subgroupId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!tr.ok) continue
        const templates = await tr.json() as unknown
        await svc.from('attribute_templates').upsert({
          subgroup_id: subgroupId,
          subgroup_name: subgroupName,
          templates: templates,
          synced_at: now,
        }, { onConflict: 'subgroup_id' })
        templatesSynced++
      } catch { /* skip this subgroup */ }
    }

    // Обновить метаданные
    await svc.from('tnved_meta').upsert({ id: 1, last_sync_at: now, total_codes: allRows.length })

    return resp({ success: true, synced: allRows.length, pages: page + 1, subgroups: uniqueSubgroups.size, templatesSynced })

  } catch (e) {
    return resp({ error: `Неожиданная ошибка: ${(e as Error).message}` })
  }
})

