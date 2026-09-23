/**
 * wb-supply — синхронизирует безопасные метаданные FBW-поставки.
 * Получение packageCode и PDF оставлено за выключенным флагом: WB API не
 * предоставляет подтверждённый стабильный номер короба для packageCode[].
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'
// @ts-ignore
import qrcodegen from 'https://esm.sh/qrcode-generator@1.4.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WB_BASE = 'https://supplies-api.wildberries.ru'
// API package order is not documented as box identity. Keep the old code
// available for a future verified shadow test, but disabled by default and in
// production until WB provides a stable ordinal.
const WB_PACKAGE_SYNC_ENABLED = Deno.env.get('WB_PACKAGE_SYNC_ENABLED') === 'true'
const PACKAGE_SYNC_DISABLED = {
  package_count: 0,
  box_count: null,
  mapped_count: 0,
  warning: null,
}

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

interface WbSupplyDetails {
  statusID?: number | null
  boxTypeID?: number | null
  isBoxOnPallet?: boolean | null
  createDate?: string | null
  supplyDate?: string | null
  factDate?: string | null
  updatedDate?: string | null
  warehouseID?: number | null
  warehouseName?: string | null
  actualWarehouseID?: number | null
  actualWarehouseName?: string | null
  transitWarehouseID?: number | null
  transitWarehouseName?: string | null
  acceptanceCost?: number | null
  paidAcceptanceCoefficient?: number | null
  rejectReason?: string | null
  quantity?: number | null
  readyForSaleQuantity?: number | null
  acceptedQuantity?: number | null
  unloadingQuantity?: number | null
  depersonalizedQuantity?: number | null
}

interface WbSupplyGood {
  barcode?: string
  vendorCode?: string
  nmID?: number
  needKiz?: boolean
  tnved?: string
  techSize?: string
  color?: string
  supplierBoxAmount?: number
  quantity?: number
  readyForSaleQuantity?: number
  unloadingQuantity?: number
  acceptedQuantity?: number
}

interface PackageSyncResult {
  package_count: number
  box_count: number | null
  mapped_count: number
  warning: string | null
}

type WbPackageCodeKind = 'ordinary' | 'external' | 'legacy'

const detectPackageCodeKind = (codes: string[]): WbPackageCodeKind | null => {
  if (codes.length === 0) return null
  if (codes.every((code) => /^\d+$/.test(code))) return 'ordinary'
  if (codes.every((code) => code.startsWith('$Ts;'))) return 'external'
  if (codes.every((code) => /^WB_/i.test(code))) return 'legacy'
  return null
}

async function syncPackagesToElestet(
  db: ReturnType<typeof createClient>,
  accountId: string,
  packages: WbPackage[],
  lineId?: string,
  fulfillmentSupplyId?: string,
): Promise<PackageSyncResult> {
  const packageCodes = packages.map((item) => item.packageCode?.trim()).filter((code): code is string => Boolean(code))
  const packageCodeKind = detectPackageCodeKind(packageCodes)

  if (packageCodes.length !== packages.length || new Set(packageCodes).size !== packageCodes.length) {
    throw new Error('WB вернул пустые или повторяющиеся ШК коробов. Привязка отменена.')
  }

  let resolvedSupplyId = fulfillmentSupplyId || ''
  let resolvedLineId = lineId || ''

  if (resolvedSupplyId) {
    const { data: supply, error } = await db.from('fulfillment_supplies')
      .select('id, trip_line_id')
      .eq('id', resolvedSupplyId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    if (!supply) throw new Error('Поставка Фулфилмента не найдена')
    resolvedLineId = resolvedLineId || supply.trip_line_id || ''
  } else if (resolvedLineId) {
    const { data: line, error: lineError } = await db.from('trip_lines')
      .select('fulfillment_supply_id')
      .eq('id', resolvedLineId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (lineError) throw lineError
    resolvedSupplyId = line?.fulfillment_supply_id || ''

    if (!resolvedSupplyId) {
      const { data: supply, error: supplyError } = await db.from('fulfillment_supplies')
        .select('id')
        .eq('trip_line_id', resolvedLineId)
        .eq('account_id', accountId)
        .maybeSingle()
      if (supplyError) throw supplyError
      resolvedSupplyId = supply?.id || ''
    }
  }

  if (resolvedLineId) {
    const { error } = await db.from('trip_lines').update({
      wb_packages_snapshot: packages,
      ...(!resolvedSupplyId && (packageCodeKind === 'ordinary' || packageCodeKind === 'legacy')
        ? { wb_package_codes: packageCodes }
        : {}),
    }).eq('id', resolvedLineId).eq('account_id', accountId)
    if (error) throw error
  }

  if (!resolvedSupplyId) {
    return { package_count: packageCodes.length, box_count: null, mapped_count: 0, warning: null }
  }

  const { data: boxes, error: boxesError } = await db.from('fulfillment_boxes')
    .select('id, box_number, wb_barcode, wb_external_barcode')
    .eq('supply_id', resolvedSupplyId)
    .eq('account_id', accountId)
    .order('box_number', { ascending: true })
    .order('id', { ascending: true })
  if (boxesError) throw boxesError
  const expectedBoxCount = boxes?.length ?? 0

  if (packageCodes.length === 0) {
    return {
      package_count: 0,
      box_count: expectedBoxCount,
      mapped_count: 0,
      warning: `WB API пока вернул 0 ШК коробов. В ELESTET ${expectedBoxCount} коробов. Это не связано с пустым содержимым: WB обычно отдаёт и пустые короба. Повторите синхронизацию после обновления данных поставки на стороне WB.`,
    }
  }

  if (packageCodes.length !== expectedBoxCount) {
    const warning = `WB вернул ${packageCodes.length} ШК коробов, а в поставке ELESTET ${expectedBoxCount}. Сохранённые ШК не изменены; привязка не выполнена до совпадения количества.`
    return { package_count: packageCodes.length, box_count: expectedBoxCount, mapped_count: 0, warning }
  }

  if (!packageCodeKind) {
    return {
      package_count: packageCodes.length,
      box_count: expectedBoxCount,
      mapped_count: 0,
      warning: 'WB вернул ШК коробов неизвестного или смешанного формата. Сохранённые обычные и печатные ШК не изменены.',
    }
  }

  // An Excel import establishes a verified WB code -> ELESTET box identity.
  // If WB later returns the exact same set in another order, keep that known
  // identity instead of moving codes between boxes. A genuinely new set still
  // follows the untouched WB response order above.
  let codesToAssign = packageCodes
  const existingCodes = (boxes ?? []).map((box) => (
    packageCodeKind === 'external'
      ? String(box.wb_external_barcode ?? '').trim()
      : String(box.wb_barcode ?? '').trim()
  ))
  if (
    existingCodes.every(Boolean)
    && new Set(existingCodes).size === existingCodes.length
    && existingCodes.every((code) => packageCodes.includes(code))
  ) {
    codesToAssign = existingCodes
  }

  const { error: assignError } = await db.rpc('assign_fulfillment_wb_box_codes_by_kind', {
    p_supply_id: resolvedSupplyId,
    p_codes: codesToAssign,
    p_kind: packageCodeKind,
  })
  if (assignError) throw new Error(`Не удалось привязать ШК WB к коробам ELESTET: ${assignError.message}`)

  return { package_count: packageCodes.length, box_count: expectedBoxCount, mapped_count: packageCodes.length, warning: null }
}

async function wbError(resp: Response): Promise<Error> {
  let detail = ''
  try {
    const body = await resp.json() as { detail?: string; title?: string }
    detail = body.detail ?? body.title ?? ''
  } catch { /* ignore non-JSON error body */ }
  if (resp.status === 401) return new Error('Неверный API-ключ WB. Проверьте ключ в настройках магазина.')
  if (resp.status === 403) return new Error('Поставка принадлежит другому магазину или у API-ключа нет доступа к поставкам.')
  if (resp.status === 404) return new Error('Поставка не найдена в WB. Проверьте ID поставки.')
  if (resp.status === 429) return new Error('WB временно ограничил частоту запросов. Подождите немного и повторите синхронизацию.')
  return new Error(`Ошибка WB ${resp.status}${detail ? ': ' + detail : ''}`)
}

function assertNumericSupplyId(supplyId: string): void {
  if (!/^\d+$/.test(supplyId)) throw new Error('Для FBO нужен числовой ID поставки WB, а не ID FBS вида WB-GI-…')
}

async function fetchPackages(apiKey: string, supplyId: string): Promise<WbPackage[]> {
  assertNumericSupplyId(supplyId)
  const resp = await fetch(`${WB_BASE}/api/v1/supplies/${supplyId}/package`, {
    headers: { Authorization: apiKey },
  })
  if (!resp.ok) throw await wbError(resp)
  const data = await resp.json()
  const packages = Array.isArray(data) ? (data as WbPackage[]) : []

  // Position in the WB response is the only box-order signal available from
  // this endpoint. Keep it byte-for-byte: sorting opaque packageCode values
  // breaks the same row pairing that WB uses in its Excel barcode template.
  return packages
}

async function fetchSupplyDetails(apiKey: string, supplyId: string): Promise<WbSupplyDetails> {
  assertNumericSupplyId(supplyId)
  const resp = await fetch(`${WB_BASE}/api/v1/supplies/${supplyId}`, {
    headers: { Authorization: apiKey },
  })
  if (!resp.ok) throw await wbError(resp)
  return await resp.json() as WbSupplyDetails
}

/** ELESTET cargo type: 1=boxes, 2=pallets. */
function cargoTypeFromDetails(data: WbSupplyDetails): number | null {
  // WB boxTypeID=1 means pallet QR labels.
  if (data.boxTypeID === 1) return 2
  // For WB boxTypeID=2, isBoxOnPallet distinguishes boxes from pallets.
  if (data.boxTypeID === 2) return data.isBoxOnPallet ? 2 : 1
  return null
}

async function fetchGoods(apiKey: string, supplyId: string): Promise<WbSupplyGood[]> {
  assertNumericSupplyId(supplyId)
  const result: WbSupplyGood[] = []
  const limit = 1000
  for (let offset = 0; ; offset += limit) {
    const resp = await fetch(`${WB_BASE}/api/v1/supplies/${supplyId}/goods?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: apiKey },
    })
    if (!resp.ok) throw await wbError(resp)
    const data = await resp.json()
    const page = Array.isArray(data) ? data as WbSupplyGood[] : []
    result.push(...page)
    if (page.length < limit) break
  }
  return result
}

const dateOnly = (value?: string | null) => value ? value.slice(0, 10) : null
const finiteNumber = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value : null

function supplySummary(details: WbSupplyDetails, cargoType = cargoTypeFromDetails(details)): Record<string, unknown> {
  return {
    wb_status_id: finiteNumber(details.statusID),
    wb_cargo_type: cargoType,
    wb_created_at: details.createDate || null,
    planned_marketplace_delivery_date: dateOnly(details.supplyDate),
    wb_acceptance_date: dateOnly(details.factDate),
    wb_updated_at: details.updatedDate || null,
    wb_acceptance_coefficient: finiteNumber(details.paidAcceptanceCoefficient),
    wb_acceptance_cost: finiteNumber(details.acceptanceCost),
    wb_reject_reason: details.rejectReason?.trim() || null,
    wb_quantity: finiteNumber(details.quantity),
    wb_ready_for_sale_quantity: finiteNumber(details.readyForSaleQuantity),
    wb_accepted_quantity: finiteNumber(details.acceptedQuantity),
    wb_unloading_quantity: finiteNumber(details.unloadingQuantity),
    wb_depersonalized_quantity: finiteNumber(details.depersonalizedQuantity),
    wb_warehouse_id: finiteNumber(details.warehouseID),
    wb_warehouse_name: details.warehouseName || null,
    wb_actual_warehouse_id: finiteNumber(details.actualWarehouseID),
    wb_actual_warehouse_name: details.actualWarehouseName || null,
    wb_transit_warehouse_id: finiteNumber(details.transitWarehouseID),
    wb_transit_warehouse_name: details.transitWarehouseName || null,
    wb_synced_at: new Date().toISOString(),
  }
}

function fulfillmentMetadata(summary: Record<string, unknown>): Record<string, unknown> {
  return {
    wb_warehouse_id: summary.wb_warehouse_id ?? null,
    wb_warehouse_name: summary.wb_warehouse_name ?? null,
    wb_planned_delivery_date: summary.planned_marketplace_delivery_date ?? null,
    wb_cargo_type: summary.wb_cargo_type ?? null,
    wb_synced_at: summary.wb_synced_at ?? null,
  }
}

async function persistWbSummaryForLine(
  db: ReturnType<typeof createClient>,
  accountId: string,
  lineId: string,
  summary: Record<string, unknown>,
): Promise<void> {
  const { data: line, error: lineError } = await db.from('trip_lines')
    .update(summary)
    .eq('id', lineId)
    .eq('account_id', accountId)
    .select('fulfillment_supply_id')
    .maybeSingle()
  if (lineError) throw lineError

  let supplyId = line?.fulfillment_supply_id || ''
  if (!supplyId) {
    const { data: supply, error: supplyError } = await db.from('fulfillment_supplies')
      .select('id')
      .eq('trip_line_id', lineId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (supplyError) throw supplyError
    supplyId = supply?.id || ''
  }
  if (!supplyId) return

  const { error: fulfillmentError } = await db.from('fulfillment_supplies')
    .update(fulfillmentMetadata(summary))
    .eq('id', supplyId)
    .eq('account_id', accountId)
  if (fulfillmentError) throw fulfillmentError
}

async function persistWbSummaryForFulfillment(
  db: ReturnType<typeof createClient>,
  accountId: string,
  supplyId: string,
  lineId: string | null,
  summary: Record<string, unknown>,
): Promise<void> {
  const { error: supplyError } = await db.from('fulfillment_supplies')
    .update(fulfillmentMetadata(summary))
    .eq('id', supplyId)
    .eq('account_id', accountId)
  if (supplyError) throw supplyError
  if (!lineId) return

  const { error: lineError } = await db.from('trip_lines')
    .update(summary)
    .eq('id', lineId)
    .eq('account_id', accountId)
  if (lineError) throw lineError
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

  let account_id: string, line_id: string, fulfillment_supply_id: string, wb_supply_id: string | undefined, action: string
  try {
    const body = await req.json() as { account_id?: string; line_id?: string; fulfillment_supply_id?: string; wb_supply_id?: string; action?: string }
    account_id = body.account_id ?? ''
    line_id = body.line_id ?? ''
    fulfillment_supply_id = body.fulfillment_supply_id ?? ''
    wb_supply_id = body.wb_supply_id?.trim() || undefined
    action = body.action ?? 'stickers'
    if (!account_id || (!line_id && !fulfillment_supply_id)) throw new Error('account_id и ID поставки обязательны')
  } catch (e) { return jsonError(String(e)) }

  const db = getDb()
  // Fulfillment boxes can be assigned before the supply is transferred to Logistics.
  // Resolve the WB token from the batch's store, never from a client-supplied ID.
  if (fulfillment_supply_id) {
    if (line_id || !['sync_summary', 'cargo_type', 'package_info'].includes(action)) return jsonError('Недопустимое действие для поставки Фулфилмента')
    if (action === 'package_info' && !WB_PACKAGE_SYNC_ENABLED) return jsonError('Привязка ШК коробов через API отключена. Загрузите Excel WB.')
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!jwt) return jsonError('Требуется вход в ELESTET')
    const { data: authData, error: authError } = await db.auth.getUser(jwt)
    if (authError || !authData.user) return jsonError('Сессия ELESTET недействительна')
    const { data: membership } = await db.from('account_members').select('account_id')
      .eq('account_id', account_id).eq('user_id', authData.user.id).maybeSingle()
    if (!membership) return jsonError('Нет доступа к этой компании')
    const { data: supply } = await db.from('fulfillment_supplies')
      .select('id, account_id, batch_id, trip_line_id, wb_supply_id')
      .eq('id', fulfillment_supply_id).eq('account_id', account_id).maybeSingle()
    if (!supply) return jsonError('Поставка Фулфилмента не найдена')
    if (!supply.wb_supply_id) return jsonError('Сначала привяжите ID поставки WB')
    const { data: batch } = await db.from('fulfillment_batches')
      .select('store_id').eq('id', supply.batch_id).eq('account_id', account_id).maybeSingle()
    if (!batch?.store_id) return jsonError('У партии не выбран магазин WB')
    const { data: batchStore } = await db.from('stores').select('api_key')
      .eq('id', batch.store_id).eq('account_id', account_id).maybeSingle()
    if (!batchStore?.api_key) return jsonError('У магазина не задан API-ключ WB')
    try {
      const details = await fetchSupplyDetails(batchStore.api_key, supply.wb_supply_id)
      const summary = supplySummary(details)
      await persistWbSummaryForFulfillment(
        db,
        account_id,
        fulfillment_supply_id,
        supply.trip_line_id || null,
        summary,
      )
      if (action !== 'package_info') return jsonOk({ summary, cargo_type: summary.wb_cargo_type, package_sync: PACKAGE_SYNC_DISABLED })
      const packages = await fetchPackages(batchStore.api_key, supply.wb_supply_id)
      const packageSync = await syncPackagesToElestet(db, account_id, packages, supply.trip_line_id || undefined, fulfillment_supply_id)
      return jsonOk({ package_codes: packages.map((pkg) => pkg.packageCode), package_sync: packageSync, summary })
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : String(e))
    }
  }

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
    try {
      const details = await fetchSupplyDetails(apiKey, supplyId)
      const summary = supplySummary(details)
      await persistWbSummaryForLine(db, account_id, line_id, summary)
      return jsonOk({ cargo_type: summary.wb_cargo_type, summary })
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : String(e))
    }
  }

  // action=package_info — список штрихкодов коробов WB (для Excel-шаблона распределения)
  if (action === 'package_info') {
    if (!WB_PACKAGE_SYNC_ENABLED) return jsonError('Привязка ШК коробов через API отключена. Загрузите Excel WB.')
    try {
      const [details, packages] = await Promise.all([
        fetchSupplyDetails(apiKey, supplyId),
        fetchPackages(apiKey, supplyId),
      ])
      const summary = supplySummary(details)
      await persistWbSummaryForLine(db, account_id, line_id, summary)
      const packageSync = await syncPackagesToElestet(db, account_id, packages, line_id)
      return jsonOk({ package_codes: packages.map((p) => p.packageCode), package_sync: packageSync, summary })
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : String(e))
    }
  }

  // Full WB summary. `mp_date` remains as a compatibility alias for old clients.
  if (action === 'sync_summary' || action === 'mp_date') {
    try {
      const details = await fetchSupplyDetails(apiKey, supplyId)
      const summary = { ...supplySummary(details) }
      await persistWbSummaryForLine(db, account_id, line_id, summary)
      return jsonOk({
        summary,
        package_sync: PACKAGE_SYNC_DISABLED,
        mp_date: summary.planned_marketplace_delivery_date,
        fact_date: summary.wb_acceptance_date,
      })
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : String(e))
    }
  }

  // On-demand detailed snapshot for the ELESTET ↔ WB reconciliation window.
  if (action === 'sync_detail') {
    try {
      const [details, goods] = await Promise.all([
        fetchSupplyDetails(apiKey, supplyId),
        fetchGoods(apiKey, supplyId),
      ])
      const summary = supplySummary(details)
      const updates = {
        ...summary,
        wb_goods_snapshot: goods,
      }
      await persistWbSummaryForLine(db, account_id, line_id, updates)
      return jsonOk({ summary: updates, goods, packages: [], package_sync: PACKAGE_SYNC_DISABLED })
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!WB_PACKAGE_SYNC_ENABLED) return jsonError('Скачивание ШК коробов через API отключено. Используйте ШК WB, загруженные из Excel.')

  try {
    const [packages, details] = await Promise.all([
      fetchPackages(apiKey, supplyId),
      fetchSupplyDetails(apiKey, supplyId),
    ])
    const summary = supplySummary(details)
    if (packages.length === 0) {
      return jsonError('В поставке нет упакованных товаров. Упакуйте товары в ЛК WB.')
    }
    const packageCodes = packages.map((p) => p.packageCode)
    // Синяя кнопка WB обновляет не только ШК коробов, но и актуальные факты поставки.
    await persistWbSummaryForLine(db, account_id, line_id, {
      ...summary,
      wb_packages_snapshot: packages,
    })
    const packageSync = await syncPackagesToElestet(db, account_id, packages, line_id)
    const pdfBytes = await buildPdf(packages)
    const stickerUrl = await uploadPdf(db, account_id, line_id, pdfBytes, 'qr-stickers')
    return jsonOk({
      wb_supply_id: supplyId,
      sticker_urls: [stickerUrl],
      cargo_type: summary.wb_cargo_type,
      package_codes: packageCodes,
      package_sync: packageSync,
      summary,
    })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : String(e))
  }
})
