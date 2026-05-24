import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import {
  fetchStoreProductCosts,
  fetchWbFinanceRows,
  fetchWbWeeklyReportRows,
  fetchWbWeeklyReports,
  syncWbFinanceReport,
  syncWbWeeklyReportDetails,
  syncWbWeeklyReportsList,
} from '../services/financeReportService'
import type {
  Store,
  WbFinanceReportRow,
  WbFinanceWeeklyReport,
  WbFinanceWeeklyReportRow,
} from '../types'

type FinanceTab = 'summary' | 'articles' | 'operations' | 'weekly'

interface WeeklyColumn {
  key: string
  label: string
}

interface WeeklyListColumn {
  key: string
  label: string
}

interface FinanceReportPageProps {
  accountId: string
  stores: Store[]
}

interface EnrichedRow extends WbFinanceReportRow {
  cost_price: number
  cogs: number
  // WB сводка: Итого к оплате = for_pay - logistics - storage - acceptance - penalties - deduction + additional_payment
  wb_to_pay: number
  net_profit: number
}

interface ArticleAggregate {
  key: string
  nm_id: number | null
  vendor_code: string
  sales_qty: number          // кол-во проданных (строки Продажа)
  returns_qty: number        // кол-во возвратов
  retail_sales: number       // gross продажа (retail_amount > 0)
  for_pay: number
  wb_to_pay: number
  logistics_cost: number
  storage_cost: number
  acceptance_cost: number
  penalties: number
  deduction: number
  additional_payment: number
  cogs: number
  net_profit: number
  cost_price: number
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function monthStartIso(): string {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

const TABS: Array<{ key: FinanceTab; label: string }> = [
  { key: 'summary', label: 'Сводка' },
  { key: 'articles', label: 'По артикулам' },
  { key: 'operations', label: 'Операции WB' },
  { key: 'weekly', label: 'Еженедельные отчеты' },
]

const WEEKLY_COLUMNS: WeeklyColumn[] = [
  { key: 'row_number', label: '№' },
  { key: 'realizationreport_id', label: 'Номер отчета' },
  { key: 'gi_id', label: 'Номер поставки' },
  { key: 'subject_name', label: 'Предмет' },
  { key: 'nm_id', label: 'Код номенклатуры' },
  { key: 'brand_name', label: 'Бренд' },
  { key: 'sa_name', label: 'Артикул поставщика' },
  { key: 'ts_name', label: 'Название' },
  { key: 'barcode', label: 'Баркод' },
  { key: 'doc_type_name', label: 'Тип документа' },
  { key: 'quantity', label: 'Количество' },
  { key: 'retail_price', label: 'Розничная цена' },
  { key: 'retail_amount', label: 'Розничная сумма' },
  { key: 'sale_percent', label: 'Согласованная скидка, %' },
  { key: 'commission_percent', label: 'Процент комиссии' },
  { key: 'office_name', label: 'Склад' },
  { key: 'supplier_oper_name', label: 'Обоснование для оплаты' },
  { key: 'order_dt', label: 'Дата заказа' },
  { key: 'sale_dt', label: 'Дата продажи' },
  { key: 'rr_dt', label: 'Дата операции' },
  { key: 'shk_id', label: 'Штрихкод' },
  { key: 'retail_price_withdisc_rub', label: 'Розничная цена с учетом согласованной скидки' },
  { key: 'delivery_amount', label: 'Количество доставок' },
  { key: 'return_amount', label: 'Количество возвратов' },
  { key: 'delivery_rub', label: 'Стоимость логистики' },
  { key: 'gi_box_type_name', label: 'Тип коробов' },
  { key: 'product_discount_for_report', label: 'Согласованный продуктовый дисконт, %' },
  { key: 'supplier_promo', label: 'Промокод' },
  { key: 'srid', label: 'Уникальный номер заказа' },
  { key: 'ppvz_spp_prc', label: 'Скидка постоянного покупателя, %' },
  { key: 'ppvz_kvw_prc_base', label: 'Размер кВВ, % базовый' },
  { key: 'ppvz_kvw_prc', label: 'Итоговый кВВ, %' },
  { key: 'ppvz_for_pay', label: 'К перечислению продавцу за реализованный товар' },
  { key: 'ppvz_reward', label: 'Возмещение за выдачу и возврат товаров на ПВЗ' },
  { key: 'acquiring_fee', label: 'Возмещение издержек по эквайрингу' },
  { key: 'acquiring_bank', label: 'Наименование банка-эквайера' },
  { key: 'ppvz_vw', label: 'Вознаграждение WB без НДС' },
  { key: 'ppvz_vw_nds', label: 'НДС с вознаграждения WB' },
  { key: 'ppvz_office_id', label: 'Номер офиса' },
  { key: 'ppvz_office_name', label: 'Наименование офиса доставки' },
  { key: 'ppvz_supplier_id', label: 'Номер партнера' },
  { key: 'ppvz_supplier_name', label: 'Наименование партнера' },
  { key: 'ppvz_inn', label: 'ИНН партнера' },
  { key: 'declaration_number', label: 'Номер таможенной декларации' },
  { key: 'sticker_id', label: 'Номер стикера' },
  { key: 'site_country', label: 'Страна' },
  { key: 'penalty', label: 'Штраф' },
  { key: 'additional_payment', label: 'Доплаты' },
  { key: 'rebill_logistic_cost', label: 'Возмещение издержек по перевозке' },
  { key: 'storage_fee', label: 'Стоимость хранения' },
  { key: 'deduction', label: 'Удержания' },
  { key: 'acceptance', label: 'Стоимость платной приемки' },
  { key: 'currency_name', label: 'Валюта отчета' },
]

const WEEKLY_LIST_COLUMNS: WeeklyListColumn[] = [
  { key: 'report_id', label: '№ отчёта' },
  { key: 'legal_entity', label: 'Юридическое лицо' },
  { key: 'period', label: 'Период' },
  { key: 'report_date', label: 'Дата формирования' },
  { key: 'report_type', label: 'Тип отчёта' },
  { key: 'sale_amount', label: 'Продажа' },
  { key: 'loyalty_compensation', label: 'В том числе Компенсация скидки по программе лояльности' },
  { key: 'for_pay', label: 'К перечислению за товар' },
  { key: 'logistics_cost', label: 'Стоимость логистики' },
  { key: 'storage_cost', label: 'Стоимость хранения' },
  { key: 'acceptance_cost', label: 'Стоимость операций при приёмке' },
  { key: 'other_amount', label: 'Прочие удержания/выплаты' },
  { key: 'penalties', label: 'Общая сумма штрафов' },
  { key: 'to_pay', label: 'Итого к оплате' },
  { key: 'currency_name', label: 'Валюта' },
]

function formatWeeklyValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number') return value.toLocaleString('ru-RU', { maximumFractionDigits: 4 })
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const str = String(value)
  return str.trim() ? str : '—'
}

function formatPeriod(from: string | null, to: string | null): string {
  if (!from && !to) return '—'
  if (from && to) return `с ${from} по ${to}`
  return from ?? to ?? '—'
}

const LS_STORE_KEY = (accountId: string) => `finance-report-store-${accountId}`

export const FinanceReportPage = ({ accountId, stores }: FinanceReportPageProps) => {
  // Сортировка: сначала с API ключом (алфавит), потом без ключа (алфавит)
  const sortedStores = useMemo(() => {
    const withKey = stores
      .filter((s) => s.api_key)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    const withoutKey = stores
      .filter((s) => !s.api_key)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    return [...withKey, ...withoutKey]
  }, [stores])

  const storesWithKey = useMemo(() => stores.filter((s) => s.api_key), [stores])

  const [tab, setTab] = useState<FinanceTab>('summary')
  const [storeId, setStoreId] = useState<string>(() => {
    const saved = localStorage.getItem(LS_STORE_KEY(accountId))
    return saved ?? ''
  })
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false)
  const storeDropdownRef = useRef<HTMLDivElement>(null)
  const [dateFrom, setDateFrom] = useState(monthStartIso())
  const [dateTo, setDateTo] = useState(todayIso())
  const [rows, setRows] = useState<WbFinanceReportRow[]>([])
  const [weeklyReports, setWeeklyReports] = useState<WbFinanceWeeklyReport[]>([])
  const [selectedWeeklyReportId, setSelectedWeeklyReportId] = useState<number | null>(null)
  const [weeklyReportRows, setWeeklyReportRows] = useState<WbFinanceWeeklyReportRow[]>([])
  const [isWeeklyDetailsLoading, setIsWeeklyDetailsLoading] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [costByNm, setCostByNm] = useState<Map<number, number>>(new Map())
  const [vendorByNm, setVendorByNm] = useState<Map<number, string>>(new Map())

  // Инициализация: если сохранённый id нет в списке — берём первый с API
  useEffect(() => {
    const ids = new Set(stores.map((s) => s.id))
    if (!storeId || !ids.has(storeId)) {
      const first = storesWithKey[0] ?? sortedStores[0]
      if (first) setStoreId(first.id)
    }
  }, [stores]) // eslint-disable-line react-hooks/exhaustive-deps

  // Сохраняем выбор в localStorage
  const handleSelectStore = (id: string) => {
    setStoreId(id)
    localStorage.setItem(LS_STORE_KEY(accountId), id)
    setStoreDropdownOpen(false)
  }

  // Закрываем дропдаун по клику вне
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (storeDropdownRef.current && !storeDropdownRef.current.contains(e.target as Node)) {
        setStoreDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadRows = async () => {
    if (!accountId || !storeId) return
    setIsLoading(true)
    setError(null)
    try {
      const [reportRows, costs] = await Promise.all([
        fetchWbFinanceRows({ accountId, storeId, dateFrom, dateTo }),
        fetchStoreProductCosts(storeId),
      ])

      const nextCostMap = new Map<number, number>()
      const nextVendorMap = new Map<number, string>()
      costs.forEach((p) => {
        nextCostMap.set(p.nm_id, Number(p.cost_price ?? 0))
        if (p.vendor_code) nextVendorMap.set(p.nm_id, p.vendor_code)
      })

      setRows(reportRows)
      setCostByNm(nextCostMap)
      setVendorByNm(nextVendorMap)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить фин-отчет')
      setRows([])
      setCostByNm(new Map())
      setVendorByNm(new Map())
    } finally {
      setIsLoading(false)
    }
  }

  const loadWeeklyReports = async () => {
    if (!accountId || !storeId) return
    try {
      const data = await fetchWbWeeklyReports({ accountId, storeId, dateFrom, dateTo })
      setWeeklyReports(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить недельные отчеты')
      setWeeklyReports([])
    }
  }

  const loadWeeklyReportRows = async (reportId: number) => {
    if (!accountId || !storeId) return
    setIsWeeklyDetailsLoading(true)
    setError(null)
    try {
      let data = await fetchWbWeeklyReportRows({ accountId, storeId, reportId })

      // Если детализация ещё не загружена в БД — синкаем только выбранный отчёт.
      if (data.length === 0) {
        await syncWbWeeklyReportDetails({ accountId, storeId, reportId })
        data = await fetchWbWeeklyReportRows({ accountId, storeId, reportId })
      }

      setWeeklyReportRows(data)
      setSelectedWeeklyReportId(reportId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить строки недельного отчета')
      setWeeklyReportRows([])
    } finally {
      setIsWeeklyDetailsLoading(false)
    }
  }

  useEffect(() => {
    void loadRows()
    void loadWeeklyReports()
    setSelectedWeeklyReportId(null)
    setWeeklyReportRows([])
  }, [accountId, storeId, dateFrom, dateTo])

  const handleSync = async () => {
    if (!accountId || !storeId) return
    setIsSyncing(true)
    setError(null)
    try {
      if (tab === 'weekly') {
        // Быстрый sync weekly: только список отчётов за период.
        await syncWbWeeklyReportsList({ accountId, storeId, dateFrom, dateTo })
        await loadWeeklyReports()
      } else {
        await syncWbFinanceReport({ accountId, storeId, dateFrom, dateTo })
        await Promise.all([loadRows(), loadWeeklyReports()])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Синхронизация не удалась')
    } finally {
      setIsSyncing(false)
    }
  }

  const enrichedRows = useMemo<EnrichedRow[]>(() => {
    return rows.map((row) => {
      const costPrice = row.nm_id != null ? (costByNm.get(row.nm_id) ?? 0) : 0
      // Кол-во только для строк Продажи
      const isSale = Number(row.retail_amount) > 0
      const qty = isSale ? Number(row.quantity ?? 0) : 0
      const cogs = qty * costPrice

      // Итого к оплате (точная формула WB сводки):
      // = К перечислению - Логистика - Хранение - Приёмка - Штрафы - Удержания + Доплаты
      const wbToPay =
        Number(row.for_pay ?? 0)
        - Number(row.logistics_cost ?? 0)
        - Number(row.storage_cost ?? 0)
        - Number(row.acceptance_cost ?? 0)
        - Number(row.penalties ?? 0)
        - Number(row.deduction ?? 0)
        + Number(row.additional_payment ?? 0)

      return {
        ...row,
        cost_price: costPrice,
        cogs,
        wb_to_pay: wbToPay,
        net_profit: wbToPay - cogs,
      }
    })
  }, [rows, costByNm])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return enrichedRows

    return enrichedRows.filter((row) => {
      const vendor = (row.vendor_code ?? (row.nm_id != null ? vendorByNm.get(row.nm_id) : '') ?? '').toLowerCase()
      return (
        String(row.nm_id ?? '').includes(q) ||
        vendor.includes(q) ||
        String(row.barcode ?? '').includes(q) ||
        String(row.operation_name ?? '').toLowerCase().includes(q)
      )
    })
  }, [enrichedRows, search, vendorByNm])

  const totals = useMemo(() => {
    return filteredRows.reduce((acc, row) => {
      // WB «Продажа» = GROSS: сумма retail_amount где > 0 (только строки Продажа)
      if (Number(row.retail_amount) > 0) {
        acc.retail += Number(row.retail_amount)
        acc.salesQty += Number(row.quantity ?? 0)
      }
      if (Number(row.retail_amount) < 0) {
        acc.returns += Math.abs(Number(row.retail_amount))
        acc.returnsQty += Number(row.quantity ?? 0)
      }
      // WB «К перечислению за товар» = SUM(ppvz_for_pay) включая отрицательные возвраты
      acc.forPay += Number(row.for_pay ?? 0)
      // WB удержания
      acc.logistics += Number(row.logistics_cost ?? 0)
      acc.storage += Number(row.storage_cost ?? 0)
      acc.acceptance += Number(row.acceptance_cost ?? 0)
      acc.penalties += Number(row.penalties ?? 0)
      acc.deduction += Number(row.deduction ?? 0)
      acc.additionalPayment += Number(row.additional_payment ?? 0)
      // WB «Итого к оплате»
      acc.wbToPay += row.wb_to_pay
      // Внутренняя юнит-экономика
      acc.cogs += row.cogs
      acc.netProfit += row.net_profit
      return acc
    }, {
      salesQty: 0,
      returnsQty: 0,
      retail: 0,
      returns: 0,
      forPay: 0,
      logistics: 0,
      storage: 0,
      acceptance: 0,
      penalties: 0,
      deduction: 0,
      additionalPayment: 0,
      wbToPay: 0,
      cogs: 0,
      netProfit: 0,
    })
  }, [filteredRows])

  const articleRows = useMemo<ArticleAggregate[]>(() => {
    const map = new Map<string, ArticleAggregate>()

    filteredRows.forEach((row) => {
      const vendor = row.vendor_code ?? (row.nm_id != null ? vendorByNm.get(row.nm_id) ?? '' : '')
      const key = `${row.nm_id ?? 'no-nm'}|${vendor}`
      const current = map.get(key) ?? {
        key,
        nm_id: row.nm_id,
        vendor_code: vendor,
        sales_qty: 0,
        returns_qty: 0,
        retail_sales: 0,
        for_pay: 0,
        wb_to_pay: 0,
        logistics_cost: 0,
        storage_cost: 0,
        acceptance_cost: 0,
        penalties: 0,
        deduction: 0,
        additional_payment: 0,
        cogs: 0,
        net_profit: 0,
        cost_price: row.cost_price,
      }

      const ra = Number(row.retail_amount ?? 0)
      if (ra > 0) {
        current.retail_sales += ra
        current.sales_qty += Number(row.quantity ?? 0)
      } else if (ra < 0) {
        current.returns_qty += Number(row.quantity ?? 0)
      }
      current.for_pay += Number(row.for_pay ?? 0)
      current.wb_to_pay += row.wb_to_pay
      current.logistics_cost += Number(row.logistics_cost ?? 0)
      current.storage_cost += Number(row.storage_cost ?? 0)
      current.acceptance_cost += Number(row.acceptance_cost ?? 0)
      current.penalties += Number(row.penalties ?? 0)
      current.deduction += Number(row.deduction ?? 0)
      current.additional_payment += Number(row.additional_payment ?? 0)
      current.cogs += row.cogs
      current.net_profit += row.net_profit
      if (!current.cost_price && row.cost_price) current.cost_price = row.cost_price

      map.set(key, current)
    })

    return [...map.values()].sort((a, b) => b.net_profit - a.net_profit)
  }, [filteredRows, vendorByNm])

  const selectedWeeklyReport = useMemo(
    () => weeklyReports.find((r) => r.report_id === selectedWeeklyReportId) ?? null,
    [weeklyReports, selectedWeeklyReportId],
  )

  const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="rounded-3xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Кастомный дропдаун с цветными шариками */}
          <div ref={storeDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setStoreDropdownOpen((v) => !v)}
              className="flex h-10 min-w-[160px] max-w-[260px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:border-slate-300"
            >
              {(() => {
                const s = sortedStores.find((x) => x.id === storeId)
                return s ? (
                  <>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${s.api_key ? 'bg-emerald-500' : 'bg-rose-400'}`} />
                    <span className="truncate">{s.name}</span>
                  </>
                ) : <span className="text-slate-400">Выберите магазин</span>
              })()}
              <svg className="ml-auto h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>

            {storeDropdownOpen && (
              <div className="absolute left-0 top-11 z-50 min-w-[220px] rounded-2xl border border-slate-200 bg-white py-1 shadow-lg">
                {sortedStores.map((s, idx) => {
                  const prevHasKey = idx > 0 ? !!sortedStores[idx - 1].api_key : true
                  const showDivider = idx > 0 && !s.api_key && prevHasKey
                  return (
                    <Fragment key={s.id}>
                      {showDivider && <div key={`div-${s.id}`} className="my-1 border-t border-slate-100" />}
                      <button
                        type="button"
                        onClick={() => handleSelectStore(s.id)}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-slate-50 ${
                          s.id === storeId ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-700'
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${s.api_key ? 'bg-emerald-500' : 'bg-rose-400'}`} />
                        {s.name}
                      </button>
                    </Fragment>
                  )
                })}
              </div>
            )}
          </div>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          />

          <div className="relative flex-1 min-w-[240px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск: артикул WB, артикул продавца, баркод, операция..."
              className="h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            className="rounded-2xl px-4 py-2.5"
            disabled={isSyncing || !storeId}
            onClick={() => void handleSync()}
          >
            {isSyncing ? 'Синхронизация...' : 'Синхронизировать WB'}
          </Button>
        </div>

        {error && <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
      </Card>

      {tab === 'summary' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {/* === WB-сводка === */}
          <Card className="rounded-3xl p-4">
            <p className="text-xs text-slate-400">Продажи (шт)</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{Math.round(totals.salesQty)}</p>
            {totals.returnsQty > 0 && <p className="text-xs text-slate-400">Возвраты: {Math.round(totals.returnsQty)} шт</p>}
          </Card>
          <Card className="rounded-3xl p-4">
            <p className="text-xs text-slate-400">Продажа (gross)</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{fmt(totals.retail)}</p>
            {totals.returns > 0 && <p className="text-xs text-rose-400">Возвраты: −{fmt(totals.returns)}</p>}
          </Card>
          <Card className="rounded-3xl p-4">
            <p className="text-xs text-slate-400">К перечислению за товар</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{fmt(totals.forPay)}</p>
          </Card>
          <Card className="rounded-3xl p-4">
            <p className="text-xs text-slate-400">Стоимость логистики</p>
            <p className="mt-1 text-xl font-semibold text-amber-600">{fmt(totals.logistics)}</p>
          </Card>
          <Card className="rounded-3xl p-4">
            <p className="text-xs text-slate-400">Стоимость хранения</p>
            <p className="mt-1 text-xl font-semibold text-amber-600">{fmt(totals.storage)}</p>
          </Card>
          <Card className="rounded-3xl p-4">
            <p className="text-xs text-slate-400">Стоимость приёмки</p>
            <p className="mt-1 text-xl font-semibold text-amber-600">{fmt(totals.acceptance)}</p>
          </Card>
          <Card className="rounded-3xl p-4">
            <p className="text-xs text-slate-400">Общая сумма штрафов</p>
            <p className="mt-1 text-xl font-semibold text-amber-600">{fmt(totals.penalties)}</p>
          </Card>
          <Card className="rounded-3xl p-4">
            {/* WB «Прочие удержания/выплаты» = additional_payment − deduction (net) */}
            <p className="text-xs text-slate-400">Прочие удерж/выплаты</p>
            <p className={`mt-1 text-xl font-semibold ${
              (totals.additionalPayment - totals.deduction) >= 0 ? 'text-emerald-600' : 'text-amber-600'
            }`}>{fmt(totals.additionalPayment - totals.deduction)}</p>
          </Card>
          {/* === Итого к оплате WB === */}
          <Card className="col-span-full rounded-3xl border-2 border-slate-200 p-4 xl:col-span-2">
            <p className="text-xs text-slate-400">Итого к оплате (WB)</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{fmt(totals.wbToPay)}</p>
            <p className="mt-1 text-xs text-slate-400">
              {fmt(totals.forPay)} − {fmt(totals.logistics)} − {fmt(totals.storage)} − {fmt(totals.acceptance)} − {fmt(totals.penalties)} − {fmt(totals.deduction)} + {fmt(totals.additionalPayment)}
            </p>
          </Card>
          {/* === Внутренняя экономика === */}
          <Card className="rounded-3xl p-4">
            <p className="text-xs text-slate-400">Себестоимость</p>
            <p className="mt-1 text-xl font-semibold text-slate-700">{fmt(totals.cogs)}</p>
          </Card>
          <Card className="rounded-3xl p-4">
            <p className="text-xs text-slate-400">Чистая прибыль</p>
            <p className={`mt-1 text-xl font-semibold ${totals.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(totals.netProfit)}</p>
          </Card>
        </div>
      )}

      {tab === 'articles' && (
        <Card className="overflow-hidden rounded-3xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Артикул WB</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Артикул продавца</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Кол-во</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Выручка</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">К перечислению</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Итого к оплате</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Себес/шт</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Себестоимость</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Прибыль</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {isLoading && (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-400">Загрузка...</td></tr>
                )}
                {!isLoading && articleRows.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-400">Нет данных за период</td></tr>
                )}
                {articleRows.map((row) => (
                  <tr key={row.key}>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{row.nm_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-700">{row.vendor_code || '—'}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{Math.round(row.sales_qty)}<span className="ml-1 text-slate-400">/{Math.round(row.returns_qty)}</span></td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{fmt(row.retail_sales)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{fmt(row.for_pay)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{fmt(row.wb_to_pay)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{fmt(row.cost_price)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{fmt(row.cogs)}</td>
                    <td className={`px-4 py-2.5 text-right text-xs font-semibold ${row.net_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(row.net_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'operations' && (
        <Card className="overflow-hidden rounded-3xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Дата</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Операция</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Артикул WB</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Артикул продавца</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Баркод</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Кол-во</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Выручка</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">К выплате</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Логистика+хран+приемка+штрафы+прочее</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Итого к оплате</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Себестоимость</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">Профит</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {isLoading && (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-sm text-slate-400">Загрузка...</td></tr>
                )}
                {!isLoading && filteredRows.length === 0 && (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-sm text-slate-400">Нет данных за период</td></tr>
                )}
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{row.report_date ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-700">{row.doc_type ?? row.operation_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{row.nm_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-700">{row.vendor_code ?? (row.nm_id != null ? vendorByNm.get(row.nm_id) ?? '—' : '—')}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{row.barcode ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{fmt(row.quantity)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{fmt(row.retail_amount)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{fmt(row.for_pay)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-amber-600">{fmt(
                      Number(row.logistics_cost ?? 0)
                      + Number(row.storage_cost ?? 0)
                      + Number(row.acceptance_cost ?? 0)
                      + Number(row.penalties ?? 0)
                      + Number(row.deduction ?? 0)
                      - Number(row.additional_payment ?? 0)
                    )}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{fmt(row.wb_to_pay)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-700">{fmt(row.cogs)}</td>
                    <td className={`px-4 py-2.5 text-right text-xs font-semibold ${row.net_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(row.net_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'weekly' && (
        <Card className="overflow-hidden rounded-3xl">
          {!selectedWeeklyReportId ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {WEEKLY_LIST_COLUMNS.map((column) => (
                      <th key={column.key} className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {isLoading && (
                    <tr>
                      <td colSpan={WEEKLY_LIST_COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-400">Загрузка...</td>
                    </tr>
                  )}
                  {!isLoading && weeklyReports.length === 0 && (
                    <tr>
                      <td colSpan={WEEKLY_LIST_COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-400">Нажмите Синхронизировать WB, чтобы загрузить недельные отчеты</td>
                    </tr>
                  )}
                  {weeklyReports.map((report) => (
                    <tr
                      key={report.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => void loadWeeklyReportRows(report.report_id)}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-indigo-600">{formatWeeklyValue(report.report_id)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{formatWeeklyValue(report.legal_entity)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{formatPeriod(report.period_from, report.period_to)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{formatWeeklyValue(report.report_date)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{formatWeeklyValue(report.report_type)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{fmt(report.sale_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{fmt(report.loyalty_compensation)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{fmt(report.for_pay)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{fmt(report.logistics_cost)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{fmt(report.storage_cost)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{fmt(report.acceptance_cost)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{fmt(report.other_amount)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{fmt(report.penalties)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-900">{fmt(report.to_pay)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">{formatWeeklyValue(report.currency_name)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-3 pt-3">
                <div className="text-sm text-slate-600">
                  Отчет № {selectedWeeklyReport?.report_id ?? selectedWeeklyReportId} {selectedWeeklyReport ? `(${formatPeriod(selectedWeeklyReport.period_from, selectedWeeklyReport.period_to)})` : ''}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-xl px-3 py-1.5"
                  onClick={() => {
                    setSelectedWeeklyReportId(null)
                    setWeeklyReportRows([])
                  }}
                >
                  Назад к списку
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      {WEEKLY_COLUMNS.map((column) => (
                        <th key={column.key} className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {isWeeklyDetailsLoading && (
                      <tr>
                        <td colSpan={WEEKLY_COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-400">Загрузка...</td>
                      </tr>
                    )}
                    {!isWeeklyDetailsLoading && weeklyReportRows.length === 0 && (
                      <tr>
                        <td colSpan={WEEKLY_COLUMNS.length} className="px-4 py-12 text-center text-sm text-slate-400">Строки отчета не найдены</td>
                      </tr>
                    )}
                    {weeklyReportRows.map((row) => {
                      const raw = row.raw && typeof row.raw === 'object' ? row.raw : {}
                      return (
                        <tr key={row.id}>
                          {WEEKLY_COLUMNS.map((column) => {
                            const value = column.key === 'row_number' ? row.row_number : (raw as Record<string, unknown>)[column.key]
                            return (
                              <td key={column.key} className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-700">
                                {formatWeeklyValue(value)}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
