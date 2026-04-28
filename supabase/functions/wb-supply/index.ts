/**
 * wb-supply — скачивает штрихкоды поставки FBW через WB API.
 *
 * Принимает POST { account_id, line_id, wb_supply_id? }
 * Если wb_supply_id передан — сохраняет его в БД.
 * Возвращает { wb_supply_id, barcodes: [{barcode, quantity}] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WB_SUPPLIES_BASE = 'https://supplies-api.wildberries.ru'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getDb() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonError(message: string) {
  // Всегда 200 — ошибка кладётся в data.error (паттерн проекта)
  return new Response(JSON.stringify({ error: message }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface WbPackageItem {
  packageCode: string
  quantity: number
  barcodes: { barcode: string; quantity: number }[]
}

// ── WB: получить список штрихкодов упаковки поставки ─────────────
async function getWbPackage(apiKey: string, supplyId: string): Promise<WbPackageItem[]> {
  const resp = await fetch(
    `${WB_SUPPLIES_BASE}/api/v1/supplies/${supplyId}/package`,
    { headers: { Authorization: apiKey } },
  )
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`WB package ${resp.status}: ${text}`)
  }
  return await resp.json() as WbPackageItem[]
}

// ── Main ─────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let account_id: string, line_id: string, wb_supply_id: string | undefined
  try {
    const body = await req.json() as { account_id?: string; line_id?: string; wb_supply_id?: string }
    account_id = body.account_id ?? ''
    line_id = body.line_id ?? ''
    wb_supply_id = body.wb_supply_id?.trim() || undefined
    if (!account_id || !line_id) throw new Error('account_id и line_id обязательны')
  } catch (e) {
    return jsonError(String(e))
  }

  const db = getDb()

  // 1. Получаем trip_line + магазин с api_key
  const { data: line, error: lineErr } = await db
    .from('trip_lines')
    .select('id, account_id, wb_supply_id, stores(api_key)')
    .eq('id', line_id)
    .eq('account_id', account_id)
    .single()

  if (lineErr || !line) return jsonError('Строка поставки не найдена')

  const store = (line.stores as { api_key: string | null } | null)
  if (!store?.api_key) return jsonError('У магазина не задан API ключ WB. Добавьте его в настройках магазина.')

  const apiKey = store.api_key

  // 2. Определяем ID поставки (из запроса или из БД)
  const supplyId = wb_supply_id ?? (line.wb_supply_id as string | null)
  if (!supplyId) return jsonError('Не указан ID поставки WB. Введите его в поле WB.')

  // 3. Если передан новый wb_supply_id — сохраняем в БД
  if (wb_supply_id && wb_supply_id !== line.wb_supply_id) {
    await db
      .from('trip_lines')
      .update({ wb_supply_id })
      .eq('id', line_id)
      .eq('account_id', account_id)
  }

  try {
    // 4. Получаем штрихкоды упаковки
    const packages = await getWbPackage(apiKey, supplyId)
    const barcodes: { barcode: string; quantity: number }[] = packages.flatMap((pkg) => pkg.barcodes)

    return jsonOk({ wb_supply_id: supplyId, barcodes })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e))
  }
})
