/**
 * wb-supply — генерирует PDF со стикерами QR-кодов (58x40 мм) для поставки WB.
 * GET /api/v1/supplies/{ID}/package -> packageCode[] -> PDF
 * /passes не существует в WB Supplies API (404)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'
// @ts-ignore
import qrcodegen from 'https://esm.sh/qrcode-generator@1.4.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WB_BASE = 'https://supplies-api.wildberries.ru'

const PAGE_W = 164.4
const PAGE_H = 113.4

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getDb() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
function jsonError(message: string) {
  return new Response(JSON.stringify({ error: message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

interface WbPackage {
  packageCode: string
  quantity: number
  barcodes: Array<{ barcode: string; quantity: number }>
}

async function fetchPackages(apiKey: string, supplyId: string): Promise<WbPackage[]> {
  const resp = await fetch(`${WB_BASE}/api/v1/supplies/${supplyId}/package`, {
    headers: { Authorization: apiKey },
  })
  if (!resp.ok) {
    let detail = ''
    try { detail = ((await resp.json()) as { detail?: string }).detail ?? '' } catch { /* ignore */ }
    if (resp.status === 401) throw new Error('Неверный API-ключ WB. Проверьте ключ в настройках магазина.')
    if (resp.status === 403) throw new Error('Поставка принадлежит другому магазину. Убедитесь, что ID поставки и API-ключ от одного магазина.')
    if (resp.status === 404) throw new Error('Поставка не найдена в WB. Проверьте ID поставки.')
    throw new Error(`Ошибка WB ${resp.status}${detail ? ': ' + detail : ''}`)
  }
  const data = await resp.json()
  return Array.isArray(data) ? (data as WbPackage[]) : []
}

/** Получить тип отгрузки поставки: 1=короба, 2=паллеты */
async function fetchSupplyCargoType(apiKey: string, supplyId: string): Promise<number | null> {
  try {
    const resp = await fetch(`${WB_BASE}/api/v1/supplies/${supplyId}`, {
      headers: { Authorization: apiKey },
    })
    if (!resp.ok) return null
    const data = await resp.json() as { boxTypeID?: number; isBoxOnPallet?: boolean }
    // boxTypeID=1 → QR-паллеты ("На паллете")
    if (data.boxTypeID === 1) return 2
    // boxTypeID=2 → зависит от isBoxOnPallet
    if (data.boxTypeID === 2) return data.isBoxOnPallet ? 2 : 1
    return null
  } catch {
    return null
  }
}

// deno-lint-ignore no-explicit-any
function drawQrCode(page: any, text: string, x: number, y: number, size: number): void {
  const qr = qrcodegen(0, 'M')
  qr.addData(text)
  qr.make()
  const n: number = qr.getModuleCount()
  const cell = size / n
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        page.drawRectangle({
          x: x + c * cell,
          y: y + (n - 1 - r) * cell,
          width: cell + 0.3,
          height: cell + 0.3,
          color: rgb(0, 0, 0),
        })
      }
    }
  }
}

async function buildPdf(packages: WbPackage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const pkg of packages) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    const qrSize = 88
    const qrX = (PAGE_W - qrSize) / 2
    const qrY = PAGE_H - qrSize - 8
    drawQrCode(page, pkg.packageCode, qrX, qrY, qrSize)
    const textW = font.widthOfTextAtSize(pkg.packageCode, 8)
    page.drawText(pkg.packageCode, {
      x: Math.max((PAGE_W - textW) / 2, 4),
      y: 5,
      size: 8,
      font,
      color: rgb(0, 0, 0),
    })
  }
  return new Uint8Array(await doc.save())
}

async function uploadPdf(
  db: ReturnType<typeof createClient>,
  accountId: string,
  lineId: string,
  data: Uint8Array,
  suffix: string,
): Promise<string> {
  const path = `${accountId}/${lineId}/${Date.now()}_${suffix}.pdf`
  const { error } = await db.storage.from('trip-stickers').upload(path, data, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(`Storage upload: ${error.message}`)
  return db.storage.from('trip-stickers').getPublicUrl(path).data.publicUrl
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let account_id: string, line_id: string, wb_supply_id: string | undefined, action: string
  try {
    const body = await req.json() as { account_id?: string; line_id?: string; wb_supply_id?: string; action?: string }
    account_id = body.account_id ?? ''
    line_id = body.line_id ?? ''
    wb_supply_id = body.wb_supply_id?.trim() || undefined
    action = body.action ?? 'stickers'
    if (!account_id || !line_id) throw new Error('account_id и line_id обязательны')
  } catch (e) { return jsonError(String(e)) }

  const db = getDb()
  const { data: line, error: lineErr } = await db
    .from('trip_lines')
    .select('id, account_id, wb_supply_id, stores(api_key)')
    .eq('id', line_id)
    .eq('account_id', account_id)
    .single()

  if (lineErr || !line) return jsonError('Строка поставки не найдена')
  const store = line.stores as { api_key: string | null } | null
  if (!store?.api_key) return jsonError('У магазина не задан API ключ WB.')

  const apiKey = store.api_key
  const supplyId = wb_supply_id ?? (line.wb_supply_id as string | null)
  if (!supplyId) return jsonError('Не указан ID поставки WB.')

  if (wb_supply_id && wb_supply_id !== line.wb_supply_id) {
    await db.from('trip_lines').update({ wb_supply_id }).eq('id', line_id).eq('account_id', account_id)
  }

  // action=cargo_type — только тип отгрузки, без PDF
  if (action === 'cargo_type') {
    const cargoType = await fetchSupplyCargoType(apiKey, supplyId)
    if (cargoType !== null) {
      await db.from('trip_lines').update({ wb_cargo_type: cargoType }).eq('wb_supply_id', supplyId).eq('account_id', account_id)
    }
    return jsonOk({ cargo_type: cargoType })
  }

  try {
    const [packages, cargoType] = await Promise.all([
      fetchPackages(apiKey, supplyId),
      fetchSupplyCargoType(apiKey, supplyId),
    ])
    // Сохраняем тип отгрузки в БД
    if (cargoType !== null) {
      await db.from('trip_lines').update({ wb_cargo_type: cargoType }).eq('wb_supply_id', supplyId).eq('account_id', account_id)
    }
    packages.sort((a, b) => {
      const numA = parseInt(a.packageCode.replace(/\D/g, ''), 10) || 0
      const numB = parseInt(b.packageCode.replace(/\D/g, ''), 10) || 0
      return numA - numB
    })
    if (packages.length === 0) {
      return jsonError('В поставке нет упакованных товаров. Упакуйте товары в ЛК WB.')
    }
    const pdfBytes = await buildPdf(packages)
    const stickerUrl = await uploadPdf(db, account_id, line_id, pdfBytes, 'qr-stickers')
    return jsonOk({ wb_supply_id: supplyId, sticker_urls: [stickerUrl], cargo_type: cargoType })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e))
  }
})
