import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/userMessage'
import { invokeFbs } from '../../services/fbsApi'
import { PhotoThumb } from '../ui/PhotoThumb'

interface WbWarehouse {
  id: number
  name: string
  displayName?: string
}

interface StockCatalogRow {
  product_id: string
  nm_id: number
  chrt_id: number
  barcode: string
  tech_size: string
  product_name: string
  vendor_code: string | null
  brand: string | null
  color: string | null
  photo_url: string | null
  physical_quantity: number
  reserved_quantity: number
  awaiting_quantity: number
  available_quantity: number
  calculated_quantity: number
}

interface StockUpdateRow {
  operation_id: string
  status: 'confirmed' | 'mismatch' | 'failed'
  created_at: string
}

type StockFilter = 'all' | 'positive' | 'changed' | 'difference' | 'zero' | 'errors'

interface Props {
  accountId: string
  storeId: string
  warehouses: WbWarehouse[]
  canManage: boolean
}

const PAGE_SIZE = 1000

function splitIntoChunks<T>(values: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

function parseAmount(value: string) {
  if (!/^\d+$/.test(value)) return null
  const amount = Number(value)
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 1_000_000_000 ? amount : null
}

async function loadCalculatedQuantities(accountId: string, storeId: string): Promise<Map<string, number>> {
  if (!supabase) return new Map<string, number>()
  const { data: serverRows, error: serverError } = await (supabase as any).rpc('get_fbs_calculated_stock', {
    p_account_id: accountId,
    p_store_id: storeId,
  })
  if (!serverError) {
    return new Map<string, number>((serverRows ?? []).map((row: any) => [
      String(row.barcode ?? ''),
      Number(row.calculated_quantity ?? 0),
    ]))
  }
  if (!['PGRST202', '42883'].includes(String(serverError.code ?? ''))) throw serverError

  const received = new Map<string, number>()
  const active = new Map<string, number>()
  const dispatched = new Map<string, number>()
  const activeOrderCandidates: Array<{ orderId: string; barcode: string }> = []
  const dispatchedOrderIds = new Set<string>()

  const batchIds: string[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await (supabase as any)
      .from('fulfillment_batches')
      .select('id')
      .eq('account_id', accountId)
      .eq('store_id', storeId)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    batchIds.push(...(data ?? []).map((row: any) => String(row.id)))
    if ((data ?? []).length < PAGE_SIZE) break
  }

  for (const ids of splitIntoChunks(batchIds, 100)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await (supabase as any)
        .from('fulfillment_items')
        .select('barcode,qty_received')
        .in('batch_id', ids)
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      for (const row of data ?? []) {
        const barcode = String(row.barcode ?? '').trim()
        if (barcode) received.set(barcode, (received.get(barcode) ?? 0) + Number(row.qty_received ?? 0))
      }
      if ((data ?? []).length < PAGE_SIZE) break
    }
  }

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await (supabase as any)
      .from('fbs_orders')
      .select('wb_order_id,skus')
      .eq('account_id', accountId)
      .eq('store_id', storeId)
      .eq('is_in_latest_snapshot', true)
      .in('supplier_status', ['new', 'confirm'])
      .eq('wb_system_status', 'waiting')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    for (const row of data ?? []) {
      const skus = Array.isArray(row.skus) ? row.skus : []
      const barcode = String(skus[0] ?? '').trim()
      if (barcode) activeOrderCandidates.push({ orderId: String(row.wb_order_id ?? ''), barcode })
    }
    if ((data ?? []).length < PAGE_SIZE) break
  }

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await (supabase as any)
      .from('fbs_dispatch_events')
      .select('wb_order_id,product_barcode,quantity')
      .eq('account_id', accountId)
      .eq('store_id', storeId)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    for (const row of data ?? []) {
      const barcode = String(row.product_barcode ?? '').trim()
      const orderId = String(row.wb_order_id ?? '').trim()
      if (orderId) dispatchedOrderIds.add(orderId)
      if (barcode) dispatched.set(barcode, (dispatched.get(barcode) ?? 0) + Number(row.quantity ?? 0))
    }
    if ((data ?? []).length < PAGE_SIZE) break
  }

  for (const order of activeOrderCandidates) {
    if (!dispatchedOrderIds.has(order.orderId)) active.set(order.barcode, (active.get(order.barcode) ?? 0) + 1)
  }

  const allBarcodes = new Set([...received.keys(), ...active.keys(), ...dispatched.keys()])
  return new Map<string, number>([...allBarcodes].map((barcode) => [
    barcode,
    (received.get(barcode) ?? 0) - (active.get(barcode) ?? 0) - (dispatched.get(barcode) ?? 0),
  ]))
}

export function FbsStocksPanel({ accountId, storeId, warehouses, canManage }: Props) {
  const warehouseStorageKey = `fbs_stock_warehouse_${accountId}_${storeId}`
  const [warehouseId, setWarehouseId] = useState<number>(0)
  const [catalog, setCatalog] = useState<StockCatalogRow[]>([])
  const [wbAmounts, setWbAmounts] = useState<Record<number, number>>({})
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [errorChrtIds, setErrorChrtIds] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StockFilter>('all')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [history, setHistory] = useState<StockUpdateRow[]>([])
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)

  useEffect(() => {
    const saved = Number(localStorage.getItem(warehouseStorageKey))
    const next = warehouses.some((warehouse) => warehouse.id === saved) ? saved : (warehouses[0]?.id ?? 0)
    setWarehouseId(next)
    setDrafts({})
    setErrorChrtIds(new Set())
  }, [warehouseStorageKey, warehouses])

  const loadHistory = useCallback(async (selectedWarehouseId: number) => {
    if (!supabase || !storeId || !selectedWarehouseId) return
    const { data, error } = await (supabase as any)
      .from('fbs_stock_updates')
      .select('operation_id,status,created_at')
      .eq('store_id', storeId)
      .eq('wb_warehouse_id', selectedWarehouseId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    setHistory((data ?? []) as StockUpdateRow[])
  }, [storeId])

  const loadStocks = useCallback(async () => {
    if (!supabase || !accountId || !storeId || !warehouseId) return
    setLoading(true)
    setNotice(null)
    try {
      const rows: StockCatalogRow[] = []
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await (supabase as any)
          .rpc('get_fbs_stock_catalog', { p_account_id: accountId, p_store_id: storeId })
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw error
        const page = (data ?? []) as StockCatalogRow[]
        rows.push(...page)
        if (page.length < PAGE_SIZE) break
      }

      const hasServerCalculation = rows.every((row) => Number.isFinite(Number(row.calculated_quantity)))
      const calculatedQuantities = hasServerCalculation ? null : await loadCalculatedQuantities(accountId, storeId)
      const normalizedRows = rows.map((row) => ({
        ...row,
        calculated_quantity: hasServerCalculation
          ? Number(row.calculated_quantity)
          : (calculatedQuantities?.get(row.barcode) ?? 0),
      }))

      const amounts: Record<number, number> = {}
      for (const chrtIds of splitIntoChunks(rows.map((row) => Number(row.chrt_id)), PAGE_SIZE)) {
        const response = await invokeFbs(storeId, {
          action: 'get_stocks',
          wb_warehouse_id: warehouseId,
          chrt_ids: chrtIds,
        })
        for (const stock of response.stocks ?? []) amounts[Number(stock.chrtId)] = Number(stock.amount) || 0
      }
      setCatalog(normalizedRows)
      setWbAmounts(amounts)
      setDrafts({})
      setErrorChrtIds(new Set())
      setLastLoadedAt(new Date())
      await loadHistory(warehouseId)
    } catch (loadError) {
      setNotice({ kind: 'error', text: toUserMessage(loadError) })
    } finally {
      setLoading(false)
    }
  }, [accountId, loadHistory, storeId, warehouseId])

  useEffect(() => {
    if (warehouseId) void loadStocks()
  }, [loadStocks, warehouseId])

  const changedRows = useMemo(() => catalog.flatMap((row) => {
    const draft = drafts[row.chrt_id]
    if (draft == null) return []
    const amount = parseAmount(draft)
    if (amount == null || amount === (wbAmounts[row.chrt_id] ?? 0)) return []
    return [{ row, amount }]
  }), [catalog, drafts, wbAmounts])

  const invalidCount = useMemo(() => Object.entries(drafts).filter(([, value]) => parseAmount(value) == null).length, [drafts])

  const wbSummary = useMemo(() => {
    let positions = 0
    let units = 0
    for (const row of catalog) {
      const amount = wbAmounts[row.chrt_id] ?? 0
      if (amount > 0) positions += 1
      units += amount
    }
    return { positions, units }
  }, [catalog, wbAmounts])

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU')
    const rows = catalog.filter((row) => {
      const current = wbAmounts[row.chrt_id] ?? 0
      const isChanged = drafts[row.chrt_id] != null && parseAmount(drafts[row.chrt_id]) !== current
      const matchesFilter = filter === 'all'
        || (filter === 'positive' && current > 0)
        || (filter === 'changed' && isChanged)
        || (filter === 'difference' && row.available_quantity !== current)
        || (filter === 'zero' && current === 0)
        || (filter === 'errors' && errorChrtIds.has(row.chrt_id))
      if (!matchesFilter) return false
      if (!query) return true
      return [row.product_name, row.vendor_code, row.brand, row.barcode, row.nm_id, row.chrt_id, row.tech_size, row.color]
        .some((value) => String(value ?? '').toLocaleLowerCase('ru-RU').includes(query))
    })

    // В первую очередь показываем реальные ненулевые остатки WB. Иначе при
    // большом каталоге первые сотни нулевых строк выглядят как пустой склад.
    return rows.sort((left, right) => {
      const amountDifference = (wbAmounts[right.chrt_id] ?? 0) - (wbAmounts[left.chrt_id] ?? 0)
      if (amountDifference !== 0) return amountDifference
      return String(left.product_name ?? '').localeCompare(String(right.product_name ?? ''), 'ru-RU')
    })
  }, [catalog, drafts, errorChrtIds, filter, search, wbAmounts])

  const historyOperations = useMemo(() => {
    const grouped = new Map<string, { id: string; createdAt: string; confirmed: number; mismatch: number; failed: number }>()
    for (const row of history) {
      const operation = grouped.get(row.operation_id) ?? { id: row.operation_id, createdAt: row.created_at, confirmed: 0, mismatch: 0, failed: 0 }
      operation[row.status] += 1
      grouped.set(row.operation_id, operation)
    }
    return Array.from(grouped.values()).slice(0, 5)
  }, [history])

  const applyAvailableAmounts = () => {
    if (!canManage) return
    const next: Record<number, string> = {}
    for (const row of catalog) {
      if (row.available_quantity !== (wbAmounts[row.chrt_id] ?? 0)) next[row.chrt_id] = String(row.available_quantity)
    }
    setDrafts(next)
    setErrorChrtIds(new Set())
    setFilter('changed')
    setNotice({ kind: 'info', text: 'Свободные остатки ELESTET только подставлены в форму. Для отправки в WB нажмите «Сохранить в WB».' })
  }

  const saveChanges = async () => {
    if (!canManage || saving || !warehouseId || !changedRows.length || invalidCount > 0) return
    setSaving(true)
    setConfirmOpen(false)
    setNotice(null)
    try {
      const mismatches = new Set<number>()
      let confirmedCount = 0
      const nextAmounts = { ...wbAmounts }
      for (const part of splitIntoChunks(changedRows, 5000)) {
        const response = await invokeFbs(storeId, {
          action: 'update_stocks',
          wb_warehouse_id: warehouseId,
          stocks: part.map(({ row, amount }) => ({ chrtId: row.chrt_id, amount, productBarcode: row.barcode })),
        })
        for (const result of response.results ?? []) {
          const chrtId = Number(result.chrtId)
          nextAmounts[chrtId] = Number(result.confirmedAmount) || 0
          if (result.status === 'confirmed') confirmedCount += 1
          else mismatches.add(chrtId)
        }
      }
      setWbAmounts(nextAmounts)
      setErrorChrtIds(mismatches)
      setDrafts((current) => {
        const next = { ...current }
        for (const { row } of changedRows) if (!mismatches.has(row.chrt_id)) delete next[row.chrt_id]
        return next
      })
      await loadHistory(warehouseId)
      setLastLoadedAt(new Date())
      if (mismatches.size) {
        setFilter('errors')
        setNotice({ kind: 'error', text: `WB подтвердил ${confirmedCount} позиций. Не совпали после проверки: ${mismatches.size}. Они оставлены в фильтре «Ошибки».` })
      } else {
        setNotice({ kind: 'success', text: `Wildberries подтвердил обновление ${confirmedCount} позиций.` })
      }
    } catch (saveError) {
      setNotice({ kind: 'error', text: toUserMessage(saveError) })
    } finally {
      setSaving(false)
    }
  }

  if (!warehouses.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-md rounded-3xl border border-amber-200 bg-amber-50 px-6 py-5">
          <p className="font-semibold text-amber-900">У магазина нет склада продавца WB</p>
          <p className="mt-2 text-sm leading-6 text-amber-700">Создайте и привяжите FBS-склад в кабинете Wildberries, затем обновите страницу.</p>
        </div>
      </div>
    )
  }

  const zeroChanges = changedRows.filter(({ amount }) => amount === 0).length
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === warehouseId)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <select
          value={warehouseId}
          onChange={(event) => {
            const next = Number(event.target.value)
            setWarehouseId(next)
            localStorage.setItem(warehouseStorageKey, String(next))
            setDrafts({})
            setErrorChrtIds(new Set())
          }}
          className="h-9 min-w-[240px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-400"
        >
          {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.displayName || warehouse.name}</option>)}
        </select>

        <div className="relative min-w-[240px] flex-1">
          <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Товар, артикул, баркод, размер…" className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-400" />
        </div>

        <select value={filter} onChange={(event) => setFilter(event.target.value as StockFilter)} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-400">
          <option value="all">Все товары</option>
          <option value="positive">Есть на WB ({wbSummary.positions})</option>
          <option value="changed">Изменённые ({changedRows.length})</option>
          <option value="difference">Расхождения с ELESTET</option>
          <option value="zero">Нулевые на WB</option>
          <option value="errors">Ошибки ({errorChrtIds.size})</option>
        </select>

        <button type="button" onClick={() => void loadStocks()} disabled={loading || saving} className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
          <svg viewBox="0 0 24 24" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></svg>
          Обновить из WB
        </button>

        {canManage && (
          <button type="button" onClick={applyAvailableAmounts} disabled={loading || saving || !catalog.length} title="Только подставляет свободные остатки в поля, но не отправляет их автоматически" className="h-9 rounded-xl border border-violet-200 bg-violet-50 px-3 text-sm font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-40">
            Подставить из ELESTET
          </button>
        )}

        {canManage && (
          <button type="button" onClick={() => setConfirmOpen(true)} disabled={loading || saving || !changedRows.length || invalidCount > 0} className="h-9 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? 'Отправка…' : `Сохранить в WB${changedRows.length ? ` (${changedRows.length})` : ''}`}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-2 text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Остаток WB задаётся абсолютным количеством для каждого размера товара.</span>
          {!loading && lastLoadedAt && (
            <strong className="text-emerald-700">
              Сейчас на WB: {wbSummary.positions} позиций · {wbSummary.units.toLocaleString('ru-RU')} шт.
            </strong>
          )}
        </div>
        <span>{lastLoadedAt ? `Проверено: ${lastLoadedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Ещё не загружено'}</span>
      </div>

      {notice && (
        <div className={`mx-5 mt-3 flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${notice.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-current opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {!canManage && <div className="mx-5 mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">Доступен только просмотр. Для изменения нужно право «Управление остатками на складах WB».</div>}

      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="max-h-[calc(100vh-17rem)] overflow-auto [scrollbar-gutter:stable]">
            <table className="w-full min-w-[1420px] text-xs">
              <thead className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 text-left text-[10px] uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <th className="w-14 px-3 py-2.5" />
                  <th className="px-3 py-2.5">Товар</th>
                  <th className="px-3 py-2.5">Артикулы</th>
                  <th className="px-3 py-2.5">Размер / цвет</th>
                  <th className="px-3 py-2.5">Баркод</th>
                  <th className="px-3 py-2.5 text-right">Физически</th>
                  <th className="px-3 py-2.5 text-right">Резерв</th>
                  <th className="px-3 py-2.5 text-right">Свободно</th>
                  <th className="px-3 py-2.5 text-right" title="Принято в партиях − активные FBS-заказы − передано в доставку">Расчётный остаток</th>
                  <th className="px-3 py-2.5 text-right">Сейчас WB</th>
                  <th className="sticky right-0 z-30 min-w-[170px] border-l border-slate-200 bg-slate-50 px-3 py-2.5 text-center shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">Новый остаток WB</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={11} className="py-14 text-center text-sm text-slate-400">Загрузка товаров и остатков Wildberries…</td></tr>
                ) : visibleRows.length === 0 ? (
                  <tr><td colSpan={11} className="py-14 text-center text-sm text-slate-400">По выбранному фильтру товаров нет</td></tr>
                ) : visibleRows.map((row) => {
                  const current = wbAmounts[row.chrt_id] ?? 0
                  const value = drafts[row.chrt_id] ?? String(current)
                  const parsed = parseAmount(value)
                  const changed = parsed != null && parsed !== current
                  const hasError = errorChrtIds.has(row.chrt_id)
                  const reserve = row.reserved_quantity + row.awaiting_quantity
                  return (
                    <tr key={row.chrt_id} className={`${hasError ? 'bg-rose-50/50' : changed ? 'bg-violet-50/40' : ''} align-middle hover:bg-slate-50`}>
                      <td className="px-3 py-2"><PhotoThumb url={row.photo_url} className="h-9 w-9 rounded-lg" /></td>
                      <td className="px-3 py-2"><div className="max-w-[300px] font-semibold text-slate-800">{row.product_name || 'Без названия'}</div><div className="mt-0.5 text-[11px] text-slate-400">{row.brand || '—'}</div></td>
                      <td className="px-3 py-2"><div className="font-mono text-blue-600">{row.nm_id}</div><div className="mt-0.5 text-slate-400">{row.vendor_code || '—'} · chrt {row.chrt_id}</div></td>
                      <td className="px-3 py-2 text-slate-600">{row.tech_size || '—'}{row.color ? ` / ${row.color}` : ''}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{row.barcode || '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-700">{row.physical_quantity}</td>
                      <td className="px-3 py-2 text-right text-amber-600">{reserve}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-700">{row.available_quantity}</td>
                      <td className={`px-3 py-2 text-right font-bold ${row.calculated_quantity < 0 ? 'text-rose-600' : 'text-violet-700'}`}>{row.calculated_quantity}</td>
                      <td className="px-3 py-2 text-right text-base font-bold text-slate-800">{current}</td>
                      <td className={`sticky right-0 z-10 border-l px-3 py-2 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)] ${hasError ? 'border-rose-200 bg-rose-50' : changed ? 'border-violet-200 bg-violet-50' : 'border-slate-100 bg-white'}`}>
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" disabled={!canManage || saving} onClick={() => setDrafts((currentDrafts) => ({ ...currentDrafts, [row.chrt_id]: String(row.available_quantity) }))} title="Подставить свободный остаток ELESTET" className="h-8 rounded-lg border border-slate-200 px-2 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-40">={row.available_quantity}</button>
                          <input type="text" inputMode="numeric" disabled={!canManage || saving} value={value} onChange={(event) => setDrafts((currentDrafts) => ({ ...currentDrafts, [row.chrt_id]: event.target.value.replace(/\s/g, '') }))} aria-label={`Новый остаток ${row.product_name}, размер ${row.tech_size}`} className={`h-9 w-24 rounded-xl border bg-white px-3 text-right text-sm font-semibold outline-none disabled:bg-slate-100 ${parsed == null ? 'border-rose-400 text-rose-700' : changed ? 'border-violet-400 text-violet-800 ring-2 ring-violet-100' : 'border-slate-200 text-slate-700'}`} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {historyOperations.length > 0 && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-800">Последние отправки на этот склад</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              {historyOperations.map((operation) => (
                <div key={operation.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                  <div className="font-medium text-slate-700">{new Date(operation.createdAt).toLocaleString('ru-RU')}</div>
                  <div className="mt-1 text-emerald-700">Подтверждено: {operation.confirmed}</div>
                  {(operation.mismatch > 0 || operation.failed > 0) && <div className="text-rose-600">Проблемы: {operation.mismatch + operation.failed}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setConfirmOpen(false)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900">Отправить остатки в Wildberries?</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">Будут изменены <strong>{changedRows.length}</strong> позиций на складе «{selectedWarehouse?.displayName || selectedWarehouse?.name}».</p>
            {zeroChanges > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">У {zeroChanges} позиций остаток станет нулевым — они перестанут быть доступны для новых заказов FBS.</div>}
            <p className="mt-3 text-xs leading-5 text-slate-400">ELESTET после отправки повторно запросит данные WB и покажет несовпадения.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">Отмена</button>
              <button type="button" onClick={() => void saveChanges()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">Отправить в WB</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
