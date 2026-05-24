import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const WB_BASE = 'https://statistics-api.wildberries.ru'

const WB_FINANCE_BASE_CANDIDATES = [
  'https://common-api.wildberries.ru',
  'https://suppliers-api.wildberries.ru',
]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function fail(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function toNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function isoDateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null
  return value.slice(0, 10)
}

function toText(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

function minDate(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a <= b ? a : b
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function buildOpUid(row: Record<string, unknown>, index: number): string {
  const parts = [
    String(row.rrd_id ?? row.realizationreport_id ?? ''),
    String(row.shk_id ?? row.shk ?? row.barcode ?? ''),
    String(row.nm_id ?? ''),
    String(row.supplier_oper_name ?? row.doc_type_name ?? ''),
    String(row.sale_dt ?? row.rr_dt ?? row.create_dt ?? ''),
    String(index),
  ]
  return parts.join('|')
}

function asRecord(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  return row as Record<string, unknown>
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function parseIsoDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function toIsoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function startOfIsoWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const shift = day === 0 ? -6 : 1 - day // Monday start
  d.setUTCDate(d.getUTCDate() + shift)
  return d
}

function endOfIsoWeek(date: Date): Date {
  const s = startOfIsoWeek(date)
  const e = new Date(s)
  e.setUTCDate(e.getUTCDate() + 6)
  return e
}

function buildWeeklyRanges(dateFrom: string, dateTo: string): Array<{ from: string; to: string }> {
  const fromDate = parseIsoDateOnly(dateFrom)
  const toDate = parseIsoDateOnly(dateTo)
  if (!fromDate || !toDate || fromDate > toDate) return []

  const firstWeekStart = startOfIsoWeek(fromDate)
  const lastWeekEnd = endOfIsoWeek(toDate)

  const ranges: Array<{ from: string; to: string }> = []
  const cursor = new Date(firstWeekStart)
  while (cursor <= lastWeekEnd) {
    const weekStart = new Date(cursor)
    const weekEnd = new Date(cursor)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
    ranges.push({ from: toIsoDateOnly(weekStart), to: toIsoDateOnly(weekEnd) })
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  }
  return ranges
}

function isFinanceEndpointUnavailable(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('не удалось найти рабочий finance endpoint') ||
    m.includes('path not found') ||
    m.includes('dns error') ||
    m.includes('name or service not known')
  )
}

async function fetchReportRows(apiKey: string, dateFrom: string, dateTo: string): Promise<Array<Record<string, unknown>>> {
  let cursor = 0
  const result: Array<Record<string, unknown>> = []
  const maxRetries = 5

  for (let page = 0; page < 200; page++) {
    const url = `${WB_BASE}/api/v5/supplier/reportDetailByPeriod?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}&limit=100000&rrdid=${cursor}`
    let resp: Response | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      resp = await fetch(url, { headers: { Authorization: apiKey } })

      // WB может отдавать 429 даже с валидным ключом при burst-нагрузке.
      if (resp.status === 429 && attempt < maxRetries) {
        const retryAfterHeader = resp.headers.get('Retry-After')
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0
        const backoffMs = Math.min(1500 * (2 ** attempt), 20000)
        await sleep(retryAfterMs > 0 ? retryAfterMs : backoffMs)
        continue
      }

      // Транзиентные ошибки WB API: повторяем запрос.
      if ((resp.status >= 500 && resp.status <= 504) && attempt < maxRetries) {
        await sleep(Math.min(1000 * (2 ** attempt), 10000))
        continue
      }

      break
    }

    if (!resp) throw new Error('WB: не удалось получить ответ от API')

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error('WB: нет доступа к финансовому отчёту. Проверьте API-ключ.')
      if (resp.status === 429) throw new Error('WB: временное ограничение частоты запросов. Повторите синхронизацию через 1-2 минуты.')
      const txt = await resp.text().catch(() => '')
      throw new Error(`WB ${resp.status}${txt ? `: ${txt}` : ''}`)
    }

    // WB API может вернуть пустое тело или null для периодов без данных
    const text = await resp.text()
    if (!text || text.trim() === '' || text.trim() === 'null') break
    let batch: Array<Record<string, unknown>>
    try {
      const parsed = JSON.parse(text)
      batch = Array.isArray(parsed) ? parsed : []
    } catch {
      break
    }
    if (batch.length === 0) break

    result.push(...batch)

    if (batch.length < 100000) break
    const last = batch[batch.length - 1]
    cursor = toNumber(last.rrd_id)
    if (cursor <= 0) break

    // Небольшая пауза между страницами, чтобы не упираться в burst-лимиты WB.
    await sleep(250)
  }

  return result
}

async function wbFinancePost(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const maxRetries = 5
  const pathCandidates = [
    path,
    path.replace('/api/finance/v1/', '/api/v1/finance/'),
    path.replace('/api/finance/v1/', '/api/v1/'),
  ]

  const urlCandidates: string[] = []
  for (const base of WB_FINANCE_BASE_CANDIDATES) {
    for (const p of pathCandidates) {
      const url = `${base}${p}`
      if (!urlCandidates.includes(url)) urlCandidates.push(url)
    }
  }

  let lastError = ''
  for (const url of urlCandidates) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let resp: Response
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
      } catch (e) {
        // Сетевые/DNS ошибки: пробуем следующий candidate URL.
        lastError = `${url}: ${e instanceof Error ? e.message : String(e)}`
        break
      }

      if ((resp.status === 429 || (resp.status >= 500 && resp.status <= 504)) && attempt < maxRetries) {
        const retryAfterHeader = resp.headers.get('Retry-After')
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0
        const backoffMs = Math.min(1500 * (2 ** attempt), 20000)
        await sleep(retryAfterMs > 0 ? retryAfterMs : backoffMs)
        continue
      }

      if (!resp.ok) {
        if (resp.status === 404) {
          const txt = await resp.text().catch(() => '')
          lastError = `404 @ ${url}${txt ? `: ${txt}` : ''}`
          break
        }
        if (resp.status === 401 || resp.status === 403) throw new Error('WB: нет доступа к финансовым отчетам. Проверьте API-ключ.')
        if (resp.status === 429) throw new Error('WB: временное ограничение частоты запросов. Повторите синхронизацию через 1-2 минуты.')
        const txt = await resp.text().catch(() => '')
        throw new Error(`WB Finance ${resp.status}${txt ? `: ${txt}` : ''}`)
      }

      const text = await resp.text()
      if (!text || text.trim() === '' || text.trim() === 'null') return []
      try {
        return JSON.parse(text)
      } catch {
        return []
      }
    }
  }

  throw new Error(`WB: не удалось найти рабочий Finance endpoint. ${lastError}`)
}

async function fetchSalesReportsList(apiKey: string, dateFrom: string, dateTo: string): Promise<Array<Record<string, unknown>>> {
  const result: Array<Record<string, unknown>> = []
  const limit = 100
  let offset = 0

  for (let page = 0; page < 50; page++) {
    const payload = {
      dateFrom,
      dateTo,
      limit,
      offset,
      period: 'weekly',
    }
    const json = await wbFinancePost(apiKey, '/api/finance/v1/sales-reports/list', payload)
    const batch = Array.isArray(json) ? json : []
    if (batch.length === 0) break

    batch.forEach((item) => {
      const row = asRecord(item)
      if (row) result.push(row)
    })

    if (batch.length < limit) break
    offset += limit

    // В документации лимит 1 запрос/мин; бережем лимит на пагинации.
    await sleep(61000)
  }

  return result
}

async function fetchSalesReportDetailsByReportId(apiKey: string, reportId: number): Promise<Array<Record<string, unknown>>> {
  const result: Array<Record<string, unknown>> = []
  const limit = 2000
  let rrdID = 0

  for (let page = 0; page < 200; page++) {
    const payload = {
      limit,
      rrdID,
      fields: [
        'rrdId',
        'nmId',
        'giId',
        'docTypeName',
        'retailAmount',
        'acquiringFee',
        'srid',
      ],
    }
    const json = await wbFinancePost(apiKey, `/api/finance/v1/sales-reports/detailed/${reportId}`, payload)
    const batch = Array.isArray(json) ? json : []
    if (batch.length === 0) break

    const rows = batch
      .map((item) => asRecord(item))
      .filter((row): row is Record<string, unknown> => row !== null)
    result.push(...rows)

    if (rows.length < limit) break
    const last = rows[rows.length - 1]
    rrdID = toNumber(last.rrdId)
    if (rrdID <= 0) break

    await sleep(61000)
  }

  return result
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return fail('Не авторизован')

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return fail('Не авторизован')

  const body = await req.json().catch(() => ({})) as {
    account_id?: string
    store_id?: string
    date_from?: string
    date_to?: string
    mode?: 'weekly_list' | 'weekly_details'
    report_id?: number
  }

  const accountId = body.account_id ?? ''
  const storeId = body.store_id ?? ''
  const dateFrom = body.date_from ?? ''
  const dateTo = body.date_to ?? ''
  const mode = body.mode ?? 'legacy'
  const reportId = toNumber(body.report_id)

  if (!accountId || !storeId) {
    return fail('account_id и store_id обязательны')
  }

  if ((mode === 'legacy' || mode === 'weekly_list') && (!dateFrom || !dateTo)) {
    return fail('account_id, store_id, date_from, date_to обязательны')
  }

  if (mode === 'weekly_details' && reportId <= 0) {
    return fail('report_id обязателен для weekly_details')
  }

  const weeklyRanges = buildWeeklyRanges(dateFrom, dateTo)
  if (weeklyRanges.length === 0) {
    return fail('Невалидный диапазон дат. Ожидается формат YYYY-MM-DD и date_from <= date_to')
  }
  if (weeklyRanges.length > 80) {
    return fail('Слишком большой период для недельной синхронизации. Выберите диапазон до 80 недель')
  }

  const expandedFrom = weeklyRanges[0].from
  const expandedTo = weeklyRanges[weeklyRanges.length - 1].to

  const { data: store, error: storeErr } = await userClient
    .from('stores')
    .select('id, account_id, api_key')
    .eq('id', storeId)
    .eq('account_id', accountId)
    .single()

  if (storeErr || !store) return fail('Магазин не найден или нет доступа')
  if (!store.api_key) return fail('У магазина не задан API-ключ WB')

  const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  if (mode === 'weekly_list') {
    const weeklyRanges = buildWeeklyRanges(dateFrom, dateTo)
    if (weeklyRanges.length === 0) {
      return fail('Невалидный диапазон дат. Ожидается формат YYYY-MM-DD и date_from <= date_to')
    }
    const expandedFrom = weeklyRanges[0].from
    const expandedTo = weeklyRanges[weeklyRanges.length - 1].to

    try {
      let list: Array<Record<string, unknown>> = []
      let usedFallback = false
      try {
        list = await fetchSalesReportsList(store.api_key as string, expandedFrom, expandedTo)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (!isFinanceEndpointUnavailable(message)) throw e

        // Fallback: строим weekly list из проверенного statistics-api.
        usedFallback = true
        const legacyRows = await fetchReportRows(store.api_key as string, expandedFrom, expandedTo)
        const byReport = new Map<number, Record<string, unknown>>()
        legacyRows.forEach((raw) => {
          const row = asRecord(raw)
          if (!row) return
          const id = toNumber(row.realizationreport_id)
          if (id <= 0) return

          const current = byReport.get(id)
          const rrDate =
            isoDateOnly(row.rr_dt) ??
            isoDateOnly(row.sale_dt) ??
            isoDateOnly(row.order_dt) ??
            isoDateOnly(row.create_dt) ??
            expandedFrom

          if (!current) {
            byReport.set(id, {
              reportId: id,
              sellerFinanceName: toText(row.supplier_name) ?? toText(row.supplier_contract_name),
              dateFrom: rrDate,
              dateTo: rrDate,
              createdAt: isoDateOnly(row.create_dt) ?? rrDate,
              type: 'Основной',
              retailAmountSum: toNumber(row.retail_amount) > 0 ? toNumber(row.retail_amount) : 0,
              cashbackCompensationSum: 0,
              forPaySum: toNumber(row.ppvz_for_pay),
              deliveryServiceSum: toNumber(row.delivery_rub) + toNumber(row.rebill_logistic_cost),
              paidStorageSum: toNumber(row.storage_fee),
              paidAcceptanceSum: toNumber(row.acceptance),
              additionalPaymentSum: toNumber(row.additional_payment),
              deductionSum: toNumber(row.deduction),
              totalPenaltySum: toNumber(row.penalty),
              currency: toText(row.currency_name),
            })
            return
          }

          const from = toText(current.dateFrom)
          const to = toText(current.dateTo)
          current.dateFrom = minDate(from, rrDate)
          current.dateTo = maxDate(to, rrDate)
          current.createdAt = maxDate(toText(current.createdAt), isoDateOnly(row.create_dt) ?? rrDate)
          current.retailAmountSum = toNumber(current.retailAmountSum) + (toNumber(row.retail_amount) > 0 ? toNumber(row.retail_amount) : 0)
          current.forPaySum = toNumber(current.forPaySum) + toNumber(row.ppvz_for_pay)
          current.deliveryServiceSum = toNumber(current.deliveryServiceSum) + toNumber(row.delivery_rub) + toNumber(row.rebill_logistic_cost)
          current.paidStorageSum = toNumber(current.paidStorageSum) + toNumber(row.storage_fee)
          current.paidAcceptanceSum = toNumber(current.paidAcceptanceSum) + toNumber(row.acceptance)
          current.additionalPaymentSum = toNumber(current.additionalPaymentSum) + toNumber(row.additional_payment)
          current.deductionSum = toNumber(current.deductionSum) + toNumber(row.deduction)
          current.totalPenaltySum = toNumber(current.totalPenaltySum) + toNumber(row.penalty)
          if (!toText(current.currency)) current.currency = toText(row.currency_name)
        })
        list = [...byReport.values()]
      }

      const mapped = list.map((r) => ({
        account_id: accountId,
        store_id: storeId,
        report_id: toNumber(r.reportId),
        legal_entity: toText(r.sellerFinanceName),
        period_from: isoDateOnly(r.dateFrom) ?? expandedFrom,
        period_to: isoDateOnly(r.dateTo) ?? expandedTo,
        report_date: isoDateOnly(r.createdAt),
        report_type: toText(r.type) ?? 'Основной',
        sale_amount: toNumber(r.retailAmountSum),
        loyalty_compensation: toNumber(r.cashbackCompensationSum),
        for_pay: toNumber(r.forPaySum),
        logistics_cost: toNumber(r.deliveryServiceSum),
        storage_cost: toNumber(r.paidStorageSum),
        acceptance_cost: toNumber(r.paidAcceptanceSum),
        other_amount: toNumber(r.additionalPaymentSum) - toNumber(r.deductionSum),
        penalties: toNumber(r.totalPenaltySum),
        to_pay: toNumber(r.forPaySum)
          - toNumber(r.deliveryServiceSum)
          - toNumber(r.paidStorageSum)
          - toNumber(r.paidAcceptanceSum)
          - toNumber(r.totalPenaltySum)
          - toNumber(r.deductionSum)
          + toNumber(r.additionalPaymentSum),
        currency_name: toText(r.currency),
        rows_count: 0,
        raw: r,
        synced_at: new Date().toISOString(),
      })).filter((r) => r.report_id > 0)

      if (mapped.length > 0) {
        const { error } = await adminDb
          .from('wb_finance_weekly_reports')
          .upsert(mapped, { onConflict: 'store_id,report_id' })
        if (error) return fail(`DB weekly list upsert: ${error.message}`)
      }

      return ok({ success: true, count: mapped.length, mode, fallback: usedFallback })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  }

  if (mode === 'weekly_details') {
    try {
      let details: Array<Record<string, unknown>> = []
      let usedFallback = false
      try {
        details = await fetchSalesReportDetailsByReportId(store.api_key as string, reportId)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (!isFinanceEndpointUnavailable(message)) throw e

        usedFallback = true
        const { data: header, error: headerErr } = await adminDb
          .from('wb_finance_weekly_reports')
          .select('period_from, period_to')
          .eq('account_id', accountId)
          .eq('store_id', storeId)
          .eq('report_id', reportId)
          .single()
        if (headerErr || !header) throw new Error('Не найден weekly report для fallback-детализации')

        const from = String(header.period_from)
        const to = String(header.period_to)
        const legacyRows = await fetchReportRows(store.api_key as string, from, to)
        details = legacyRows
          .map((raw) => asRecord(raw))
          .filter((row): row is Record<string, unknown> => row !== null)
          .filter((row) => toNumber(row.realizationreport_id) === reportId)
      }

      // Строгая пересборка отчёта: удаляем все старые строки выбранного reportId,
      // затем вставляем только актуальный набор из WB.
      const { error: deleteErr } = await adminDb
        .from('wb_finance_weekly_report_rows')
        .delete()
        .eq('account_id', accountId)
        .eq('store_id', storeId)
        .eq('report_id', reportId)
      if (deleteErr) return fail(`DB weekly details delete: ${deleteErr.message}`)

      const mappedRows = details.map((row, idx) => ({
        account_id: accountId,
        store_id: storeId,
        report_id: reportId,
        row_number: idx + 1,
        op_uid: [String(reportId), String(row.rrdId ?? ''), String(row.srid ?? ''), String(row.nmId ?? ''), String(idx)].join('|'),
        realizationreport_id: reportId,
        gi_id: (row.giId ?? row.gi_id) != null ? toNumber(row.giId ?? row.gi_id) : null,
        subject_name: toText(row.subjectName ?? row.subject_name),
        nm_id: (row.nmId ?? row.nm_id) != null ? toNumber(row.nmId ?? row.nm_id) : null,
        brand_name: toText(row.brandName ?? row.brand_name),
        sa_name: toText(row.supplierArticle ?? row.sa_name),
        ts_name: toText(row.title ?? row.ts_name),
        barcode: toText(row.sku ?? row.barcode),
        doc_type_name: toText(row.docTypeName ?? row.doc_type_name),
        quantity: toNumber(row.quantity),
        retail_price: toNumber(row.retailPrice ?? row.retail_price),
        retail_amount: toNumber(row.retailAmount ?? row.retail_amount),
        sale_percent: toNumber(row.salePercent ?? row.sale_percent),
        commission_percent: toNumber(row.commissionPercent ?? row.commission_percent),
        office_name: toText(row.officeName ?? row.office_name),
        supplier_oper_name: toText(row.supplierOperName ?? row.supplier_oper_name),
        order_dt: toText(row.orderDt ?? row.order_dt),
        sale_dt: toText(row.saleDt ?? row.sale_dt),
        rr_dt: toText(row.rrDt ?? row.rr_dt),
        shk_id: toText(row.shkId ?? row.shk_id),
        retail_price_withdisc_rub: toNumber(row.retailPriceWithDisc ?? row.retail_price_withdisc_rub),
        delivery_amount: toNumber(row.deliveryAmount ?? row.delivery_amount),
        return_amount: toNumber(row.returnAmount ?? row.return_amount),
        delivery_rub: toNumber(row.deliveryRub ?? row.delivery_rub),
        gi_box_type_name: toText(row.giBoxTypeName ?? row.gi_box_type_name),
        product_discount_for_report: toNumber(row.productDiscountForReport ?? row.product_discount_for_report),
        supplier_promo: toNumber(row.supplierPromo ?? row.supplier_promo),
        srid: toText(row.srid),
        ppvz_spp_prc: toNumber(row.spp ?? row.ppvz_spp_prc),
        ppvz_kvw_prc_base: toNumber(row.kvwPercentBase ?? row.ppvz_kvw_prc_base),
        ppvz_kvw_prc: toNumber(row.kvwPercent ?? row.ppvz_kvw_prc),
        ppvz_for_pay: toNumber(row.forPay ?? row.ppvz_for_pay),
        ppvz_reward: toNumber(row.reward ?? row.ppvz_reward),
        acquiring_fee: toNumber(row.acquiringFee ?? row.acquiring_fee),
        acquiring_bank: toText(row.acquiringBank ?? row.acquiring_bank),
        ppvz_vw: toNumber(row.wbServicePercent ?? row.ppvz_vw),
        ppvz_vw_nds: toNumber(row.wbServicePercentVat ?? row.ppvz_vw_nds),
        ppvz_office_id: (row.officeId ?? row.ppvz_office_id) != null ? toNumber(row.officeId ?? row.ppvz_office_id) : null,
        ppvz_office_name: toText(row.officeName ?? row.ppvz_office_name),
        ppvz_supplier_id: (row.supplierId ?? row.ppvz_supplier_id) != null ? toNumber(row.supplierId ?? row.ppvz_supplier_id) : null,
        ppvz_supplier_name: toText(row.supplierName ?? row.ppvz_supplier_name),
        ppvz_inn: toText(row.supplierInn ?? row.ppvz_inn),
        declaration_number: toText(row.declarationNumber ?? row.declaration_number),
        sticker_id: toText(row.stickerId ?? row.sticker_id),
        site_country: toText(row.siteCountry ?? row.site_country),
        penalty: toNumber(row.penalty),
        additional_payment: toNumber(row.additionalPayment ?? row.additional_payment),
        rebill_logistic_cost: toNumber(row.rebillLogisticCost ?? row.rebill_logistic_cost),
        storage_fee: toNumber(row.storageFee ?? row.storage_fee),
        deduction: toNumber(row.deduction),
        acceptance: toNumber(row.paidAcceptance ?? row.acceptance),
        currency_name: toText(row.currency ?? row.currency_name),
        raw: row,
        synced_at: new Date().toISOString(),
      }))

      if (mappedRows.length > 0) {
        const CHUNK = 1000
        for (let i = 0; i < mappedRows.length; i += CHUNK) {
          const chunk = mappedRows.slice(i, i + CHUNK)
          const { error } = await adminDb
            .from('wb_finance_weekly_report_rows')
            .upsert(chunk, { onConflict: 'store_id,op_uid' })
          if (error) return fail(`DB weekly details upsert: ${error.message}`)
        }
      }

      const { error: updateErr } = await adminDb
        .from('wb_finance_weekly_reports')
        .update({ rows_count: mappedRows.length, synced_at: new Date().toISOString() })
        .eq('store_id', storeId)
        .eq('report_id', reportId)
      if (updateErr) return fail(`DB weekly report update: ${updateErr.message}`)

      return ok({ success: true, count: mappedRows.length, mode, report_id: reportId, fallback: usedFallback })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  }

  let rows: Array<Record<string, unknown>>
  try {
    // Важно для UX: один запрос за диапазон, расширенный до полных недель,
    // чтобы не висела кнопка синхронизации на длинных периодах.
    rows = await fetchReportRows(store.api_key as string, expandedFrom, expandedTo)
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }

  try {
  const safeRows = rows
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => row !== null)

  const mapped = safeRows.map((row, idx) => {
    // ── Даты ───────────────────────────────────────────────────
    const reportDate =
      isoDateOnly(row.sale_dt) ??
      isoDateOnly(row.rr_dt) ??
      isoDateOnly(row.order_dt) ??
      isoDateOnly(row.create_dt)

    // ── Тип операции ────────────────────────────────────────────
    // doc_type_name — «Продажа», «Возврат», «Штраф» и т.д.
    // supplier_oper_name — детальное обоснование строки
    const docType = row.doc_type_name != null ? String(row.doc_type_name) : null
    const operationName = row.supplier_oper_name != null ? String(row.supplier_oper_name) : docType

    // ── Продажа (WB «Продажа» в сводке) ────────────────────────
    // retail_amount = итоговая сумма строки (уже учитывает quantity).
    // Для строк Продажа — положительная, для Возврата — отрицательная.
    // WB в сводке показывает GROSS: только строки где retail_amount > 0.
    const retailAmount = toNumber(row.retail_amount)

    // ── К перечислению (WB ppvz_for_pay) ───────────────────────
    // Суммируется по ВСЕМ строкам: продажи +, возвраты -.
    // Это и есть «К перечислению за товар» в сводке WB.
    const forPay = toNumber(row.ppvz_for_pay)

    // ── Комиссия WB ─────────────────────────────────────────────
    const commission = toNumber(row.ppvz_sales_commission)

    // ── Логистика (WB «Стоимость логистики») ────────────────────
    // delivery_rub — логистика WB
    // rebill_logistic_cost — возмещение доп. перевозки
    const logisticsCost = toNumber(row.delivery_rub) + toNumber(row.rebill_logistic_cost)

    // ── Хранение (WB «Стоимость хранения») ─────────────────────
    const storageCost = toNumber(row.storage_fee)

    // ── Приёмка (WB «Стоимость операций при приёмке») ───────────
    const acceptanceCost = toNumber(row.acceptance)

    // ── Штрафы (WB «Общая сумма штрафов») ──────────────────────
    const penalties = toNumber(row.penalty)

    // ── Удержания и доплаты РАЗДЕЛЬНО ───────────────────────────
    // deduction — удержания (в сводке WB вычитается)
    // additional_payment — доплаты (в сводке WB прибавляется)
    // WB «Прочие удержания/выплаты» = additional_payment - deduction
    const deduction = toNumber(row.deduction)
    const additionalPayment = toNumber(row.additional_payment)

    const quantity = toNumber(row.quantity)

    return {
      account_id: accountId,
      store_id: storeId,
      period_from: expandedFrom,
      period_to: expandedTo,
      report_date: reportDate,
      nm_id: row.nm_id != null ? toNumber(row.nm_id) : null,
      barcode: row.barcode != null ? String(row.barcode) : null,
      vendor_code: row.sa_name != null ? String(row.sa_name) : null,
      doc_type: docType,
      operation_name: operationName,
      quantity,
      retail_amount: retailAmount,
      for_pay: forPay,
      commission,
      logistics_cost: logisticsCost,
      storage_cost: storageCost,
      acceptance_cost: acceptanceCost,
      penalties,
      deduction,
      additional_payment: additionalPayment,
      op_uid: buildOpUid(row, idx),
      raw: row,
      synced_at: new Date().toISOString(),
    }
  })

  const CHUNK = 1000
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const chunk = mapped.slice(i, i + CHUNK)
    const { error } = await adminDb
      .from('wb_finance_report_rows')
      .upsert(chunk, { onConflict: 'store_id,op_uid' })
    if (error) return fail(`DB upsert: ${error.message}`)
  }

  type WeeklyAcc = {
    report_id: number
    legal_entity: string | null
    period_from: string | null
    period_to: string | null
    report_date: string | null
    report_type: string | null
    sale_amount: number
    loyalty_compensation: number
    for_pay: number
    logistics_cost: number
    storage_cost: number
    acceptance_cost: number
    other_amount: number
    penalties: number
    to_pay: number
    currency_name: string | null
    rows_count: number
    raw: Record<string, unknown>
  }

  const weeklyByReport = new Map<number, WeeklyAcc>()
  const rowCounters = new Map<number, number>()

  const weeklyRows = safeRows
    .map((row, idx) => {
      const reportId = toNumber(row.realizationreport_id)
      if (reportId <= 0) return null

      const count = (rowCounters.get(reportId) ?? 0) + 1
      rowCounters.set(reportId, count)

      const reportDate =
        isoDateOnly(row.create_dt) ??
        isoDateOnly(row.rr_dt) ??
        isoDateOnly(row.sale_dt) ??
        isoDateOnly(row.order_dt)

      const rowPeriodDate =
        isoDateOnly(row.rr_dt) ??
        isoDateOnly(row.sale_dt) ??
        isoDateOnly(row.order_dt) ??
        isoDateOnly(row.create_dt)

      const retailAmount = toNumber(row.retail_amount)
      const forPay = toNumber(row.ppvz_for_pay)
      const logisticsCost = toNumber(row.delivery_rub) + toNumber(row.rebill_logistic_cost)
      const storageCost = toNumber(row.storage_fee)
      const acceptanceCost = toNumber(row.acceptance)
      const penalties = toNumber(row.penalty)
      const deduction = toNumber(row.deduction)
      const additionalPayment = toNumber(row.additional_payment)
      const loyaltyCompensation = toNumber(row.loyalty_compensation)

      const current = weeklyByReport.get(reportId)
      if (!current) {
        weeklyByReport.set(reportId, {
          report_id: reportId,
          legal_entity:
            toText(row.supplier_name) ??
            toText(row.supplier_contract_name) ??
            toText(row.suppliercontract_code),
          period_from: rowPeriodDate ?? expandedFrom,
          period_to: rowPeriodDate ?? expandedTo,
          report_date: reportDate,
          report_type: toText(row.report_type_name) ?? 'Основной',
          sale_amount: retailAmount > 0 ? retailAmount : 0,
          loyalty_compensation: loyaltyCompensation,
          for_pay: forPay,
          logistics_cost: logisticsCost,
          storage_cost: storageCost,
          acceptance_cost: acceptanceCost,
          other_amount: deduction - additionalPayment,
          penalties,
          to_pay: forPay - logisticsCost - storageCost - acceptanceCost - penalties - deduction + additionalPayment,
          currency_name: toText(row.currency_name),
          rows_count: 1,
          raw: row,
        })
      } else {
        current.period_from = minDate(current.period_from, rowPeriodDate)
        current.period_to = maxDate(current.period_to, rowPeriodDate)
        current.report_date = maxDate(current.report_date, reportDate)
        current.sale_amount += retailAmount > 0 ? retailAmount : 0
        current.loyalty_compensation += loyaltyCompensation
        current.for_pay += forPay
        current.logistics_cost += logisticsCost
        current.storage_cost += storageCost
        current.acceptance_cost += acceptanceCost
        current.other_amount += deduction - additionalPayment
        current.penalties += penalties
        current.to_pay += forPay - logisticsCost - storageCost - acceptanceCost - penalties - deduction + additionalPayment
        current.rows_count += 1
        if (!current.currency_name) current.currency_name = toText(row.currency_name)
        if (!current.legal_entity) {
          current.legal_entity =
            toText(row.supplier_name) ??
            toText(row.supplier_contract_name) ??
            toText(row.suppliercontract_code)
        }
      }

      return {
        account_id: accountId,
        store_id: storeId,
        report_id: reportId,
        row_number: count,
        op_uid: buildOpUid(row, idx),
        realizationreport_id: reportId,
        gi_id: row.gi_id != null ? toNumber(row.gi_id) : null,
        subject_name: toText(row.subject_name),
        nm_id: row.nm_id != null ? toNumber(row.nm_id) : null,
        brand_name: toText(row.brand_name),
        sa_name: toText(row.sa_name),
        ts_name: toText(row.ts_name),
        barcode: toText(row.barcode),
        doc_type_name: toText(row.doc_type_name),
        quantity: toNumber(row.quantity),
        retail_price: toNumber(row.retail_price),
        retail_amount: retailAmount,
        sale_percent: toNumber(row.sale_percent),
        commission_percent: toNumber(row.commission_percent),
        office_name: toText(row.office_name),
        supplier_oper_name: toText(row.supplier_oper_name),
        order_dt: toText(row.order_dt),
        sale_dt: toText(row.sale_dt),
        rr_dt: toText(row.rr_dt),
        shk_id: toText(row.shk_id),
        retail_price_withdisc_rub: toNumber(row.retail_price_withdisc_rub),
        delivery_amount: toNumber(row.delivery_amount),
        return_amount: toNumber(row.return_amount),
        delivery_rub: toNumber(row.delivery_rub),
        gi_box_type_name: toText(row.gi_box_type_name),
        product_discount_for_report: toNumber(row.product_discount_for_report),
        supplier_promo: toNumber(row.supplier_promo),
        srid: toText(row.srid),
        ppvz_spp_prc: toNumber(row.ppvz_spp_prc),
        ppvz_kvw_prc_base: toNumber(row.ppvz_kvw_prc_base),
        ppvz_kvw_prc: toNumber(row.ppvz_kvw_prc),
        ppvz_for_pay: forPay,
        ppvz_reward: toNumber(row.ppvz_reward),
        acquiring_fee: toNumber(row.acquiring_fee),
        acquiring_bank: toText(row.acquiring_bank),
        ppvz_vw: toNumber(row.ppvz_vw),
        ppvz_vw_nds: toNumber(row.ppvz_vw_nds),
        ppvz_office_id: row.ppvz_office_id != null ? toNumber(row.ppvz_office_id) : null,
        ppvz_office_name: toText(row.ppvz_office_name),
        ppvz_supplier_id: row.ppvz_supplier_id != null ? toNumber(row.ppvz_supplier_id) : null,
        ppvz_supplier_name: toText(row.ppvz_supplier_name),
        ppvz_inn: toText(row.ppvz_inn),
        declaration_number: toText(row.declaration_number),
        sticker_id: toText(row.sticker_id),
        site_country: toText(row.site_country),
        penalty: penalties,
        additional_payment: additionalPayment,
        rebill_logistic_cost: toNumber(row.rebill_logistic_cost),
        storage_fee: storageCost,
        deduction,
        acceptance: acceptanceCost,
        currency_name: toText(row.currency_name),
        raw: row,
        synced_at: new Date().toISOString(),
      }
    })
    .filter((v): v is Record<string, unknown> => v !== null)

  const weeklyHeaders = [...weeklyByReport.values()].map((h) => ({
    account_id: accountId,
    store_id: storeId,
    report_id: h.report_id,
    legal_entity: h.legal_entity,
    period_from: h.period_from ?? expandedFrom,
    period_to: h.period_to ?? expandedTo,
    report_date: h.report_date,
    report_type: h.report_type,
    sale_amount: h.sale_amount,
    loyalty_compensation: h.loyalty_compensation,
    for_pay: h.for_pay,
    logistics_cost: h.logistics_cost,
    storage_cost: h.storage_cost,
    acceptance_cost: h.acceptance_cost,
    other_amount: h.other_amount,
    penalties: h.penalties,
    to_pay: h.to_pay,
    currency_name: h.currency_name,
    rows_count: h.rows_count,
    raw: h.raw,
    synced_at: new Date().toISOString(),
  }))

  for (let i = 0; i < weeklyHeaders.length; i += CHUNK) {
    const chunk = weeklyHeaders.slice(i, i + CHUNK)
    const { error } = await adminDb
      .from('wb_finance_weekly_reports')
      .upsert(chunk, { onConflict: 'store_id,report_id' })
    if (error) return fail(`DB weekly headers upsert: ${error.message}`)
  }

  for (let i = 0; i < weeklyRows.length; i += CHUNK) {
    const chunk = weeklyRows.slice(i, i + CHUNK)
    const { error } = await adminDb
      .from('wb_finance_weekly_report_rows')
      .upsert(chunk, { onConflict: 'store_id,op_uid' })
    if (error) return fail(`DB weekly rows upsert: ${error.message}`)
  }

  return ok({ success: true, count: mapped.length })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('wb-finance-report internal error:', message)
    return fail(`Внутренняя ошибка функции: ${message}`)
  }
})
