import { useCallback, useEffect, useMemo, useState } from 'react'
import jsPDF from 'jspdf'
import { supabase } from '../lib/supabase'
import { PhotoThumb } from '../components/ui/PhotoThumb'
import type { Store } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FbsOrder {
  id: number
  rid: string
  createdAt: string
  ddate: string
  warehouseId: number
  article: string
  nmId: number
  chrtId: number
  skus: string[]
  price: number
  convertedPrice: number
  currencyCode: number
  // enriched
  cellLocation: CellLocation | null
  shipStatus: 'pending' | 'assembling' | 'delivering' | 'done'
  supply_id: string | null
}

interface CellLocation {
  warehouseName: string
  wbWarehouseId: string
  zoneName: string
  col: string
  row: number
  qty: number
  reservedQty: number
  cellItemId: string
}

interface WbWarehouse {
  id: number
  name: string
  officeId?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWbPhotoUrl(nmId: number): string {
  const vol = Math.floor(nmId / 100000)
  const part = Math.floor(nmId / 1000)
  let basket: number
  if (vol <= 143) basket = 1
  else if (vol <= 287) basket = 2
  else if (vol <= 431) basket = 3
  else if (vol <= 719) basket = 4
  else if (vol <= 1007) basket = 5
  else if (vol <= 1061) basket = 6
  else if (vol <= 1115) basket = 7
  else if (vol <= 1169) basket = 8
  else if (vol <= 1313) basket = 9
  else if (vol <= 1601) basket = 10
  else if (vol <= 1655) basket = 11
  else if (vol <= 1919) basket = 12
  else if (vol <= 2045) basket = 13
  else if (vol <= 2189) basket = 14
  else if (vol <= 2405) basket = 15
  else if (vol <= 2621) basket = 16
  else if (vol <= 2837) basket = 17
  else basket = 18
  return `https://basket-${String(basket).padStart(2, '0')}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/c246x328/1.webp`
}

function slaLabel(ddate: string, createdAt?: string): { text: string; cls: string } {
  // Если есть ddate — показываем остаток/просрочку
  if (ddate) {
    const diff = new Date(ddate).getTime() - Date.now()
    if (!isNaN(diff)) {
      if (diff < 0) {
        const h = Math.floor(Math.abs(diff) / 3600000)
        return { text: `${h}ч назад`, cls: 'text-red-600 font-bold' }
      }
      const h = Math.floor(diff / 3600000)
      if (h < 8) return { text: `${h}ч`, cls: 'text-red-500 font-semibold' }
      if (h < 24) return { text: `${h}ч`, cls: 'text-amber-500 font-semibold' }
      const d = Math.floor(h / 24)
      return { text: `${d}д ${h % 24}ч`, cls: 'text-slate-600' }
    }
  }
  // Fallback: время с момента создания заказа
  if (createdAt) {
    const elapsed = Date.now() - new Date(createdAt).getTime()
    if (!isNaN(elapsed) && elapsed > 0) {
      const h = Math.floor(elapsed / 3600000)
      const m = Math.floor((elapsed % 3600000) / 60000)
      const cls = h >= 48 ? 'text-red-500 font-semibold' : h >= 24 ? 'text-amber-500' : 'text-slate-500'
      if (h >= 24) return { text: `${Math.floor(h / 24)}д ${h % 24}ч назад`, cls }
      return { text: `${h}ч ${m}мин назад`, cls }
    }
  }
  return { text: '—', cls: 'text-slate-400' }
}

async function invokeFbs(storeId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase!.auth.getSession()
  const token = session?.access_token ?? ''
  const sbUrl = import.meta.env.VITE_SUPABASE_URL as string
  const sbKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const res = await fetch(`${sbUrl}/functions/v1/wb-fbs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: sbKey,
    },
    body: JSON.stringify({ ...body, store_id: storeId }),
  })
  const d = await res.json() as Record<string, unknown>
  console.log('[wb-fbs]', res.status, d)
  if (!res.ok || d?.error) throw new Error((d?.error as string) || `HTTP ${res.status}`)
  return d
}

// ─── FbsOrdersPage ────────────────────────────────────────────────────────────

type TabKey = 'pending' | 'assembling' | 'delivering' | 'done'

interface Props {
  stores: Store[]
  accountId: string
}

export function FbsOrdersPage({ stores, accountId }: Props) {
  const storesWithKey = useMemo(() => stores.filter((s) => s.api_key), [stores])

  const lsKey = `fbs_store_${accountId}`
  const tabLsKey = `fbs_tab_${accountId}`
  // localStorage только для UI (магазин + таб + done-статусы)
  const doneLsKey = `fbs_done_${accountId}`
  const getDoneIds = (): Set<number> => {
    try { return new Set(JSON.parse(localStorage.getItem(doneLsKey) ?? '[]')) } catch { return new Set() }
  }
  const saveDoneId = (id: number) => {
    const s = getDoneIds(); s.add(id); localStorage.setItem(doneLsKey, JSON.stringify([...s]))
  }

  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    const saved = localStorage.getItem(lsKey)
    return (saved && storesWithKey.some((s) => s.id === saved)) ? saved : (storesWithKey[0]?.id ?? '')
  })
  const [orders, setOrders] = useState<FbsOrder[]>([])
  const [wbWarehouses, setWbWarehouses] = useState<WbWarehouse[]>([])
  const [loading, setLoading] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const saved = localStorage.getItem(tabLsKey)
    return (['pending','assembling','delivering','done'].includes(saved ?? '') ? saved : 'pending') as TabKey
  })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [assembleModal, setAssembleModal] = useState<{ ids: number[] } | null>(null)
  const [assembleTab, setAssembleTab] = useState<'new' | 'existing'>('new')
  const [newSupplyName, setNewSupplyName] = useState('')
  const [openSupplies, setOpenSupplies] = useState<{ id: string; name: string; ordersCount?: number }[]>([])
  const [loadingSupplies, setLoadingSupplies] = useState(false)
  const [orderMenuId, setOrderMenuId] = useState<number | null>(null)
  const [expandedSupplyIds, setExpandedSupplyIds] = useState<Set<string>>(new Set())

  // Склады WB при смене магазина
  useEffect(() => {
    if (!selectedStoreId) return
    void invokeFbs(selectedStoreId, { action: 'get_wb_warehouses' })
      .then((d) => setWbWarehouses((Array.isArray(d) ? d : (d.result ?? d.warehouses ?? [])) as WbWarehouse[]))
      .catch(() => setWbWarehouses([]))
  }, [selectedStoreId])

  const enrichWithCells = useCallback(async (rawOrders: FbsOrder[]): Promise<FbsOrder[]> => {
    if (!supabase || rawOrders.length === 0) return rawOrders
    const allBarcodes = [...new Set(rawOrders.flatMap((o) => o.skus))]
    if (allBarcodes.length === 0) return rawOrders
    const { data: items } = await (supabase as any)
      .from('wms_cell_items')
      .select(`id, barcode, qty, reserved_qty,
        wms_cells(col, row,
          wms_zones(name,
            wms_warehouses(name, fbs_enabled, wb_warehouse_id)
          )
        )`)
      .eq('account_id', accountId)
      .in('barcode', allBarcodes)
      .gt('qty', 0)
    const cellMap = new Map<string, CellLocation>()
    for (const item of (items ?? [])) {
      const wh = item.wms_cells?.wms_zones?.wms_warehouses
      if (!wh?.fbs_enabled) continue
      const loc: CellLocation = {
        warehouseName: wh.name, wbWarehouseId: wh.wb_warehouse_id ?? '',
        zoneName: item.wms_cells?.wms_zones?.name ?? '',
        col: item.wms_cells?.col ?? '', row: item.wms_cells?.row ?? 0,
        qty: item.qty, reservedQty: item.reserved_qty ?? 0, cellItemId: item.id,
      }
      for (const sku of rawOrders.find(o => o.skus.includes(item.barcode))?.skus ?? [item.barcode]) {
        if (!cellMap.has(sku)) cellMap.set(sku, loc)
      }
    }
    return rawOrders.map(o => ({ ...o, cellLocation: o.skus.map(s => cellMap.get(s)).find(Boolean) ?? null }))
  }, [accountId])

  // WB статус → наш shipStatus
  const wbToShip = (wbStatus: string, id: number): FbsOrder['shipStatus'] => {
    if (getDoneIds().has(id)) return 'done'
    if (wbStatus === 'confirm') return 'assembling'
    if (wbStatus === 'complete') return 'delivering'
    return 'pending'
  }

  // Читаем заказы из fbs_orders (Supabase DB)
  const readFromDb = useCallback(async () => {
    if (!supabase || !selectedStoreId) return
    const { data: rows } = await (supabase as any)
      .from('fbs_orders')
      .select('*')
      .eq('store_id', selectedStoreId)
      .not('wb_status', 'in', '("cancel","cancel_carrier")')
      .order('created_at', { ascending: false })
      .limit(500)

    const mapped: FbsOrder[] = (rows ?? []).map((row: any) => {
      const d = row.data ?? {}
      return {
        id: row.wb_order_id,
        rid: d.rid ?? row.rid ?? '',
        createdAt: row.created_at ?? '',
        ddate: row.ddate ?? '',
        warehouseId: row.warehouse_id ?? d.warehouseId ?? 0,
        article: row.article ?? d.article ?? '',
        nmId: row.nm_id ?? d.nmId ?? 0,
        chrtId: row.chrt_id ?? d.chrtId ?? 0,
        skus: row.skus ?? d.skus ?? [],
        price: row.price ?? d.price ?? 0,
        convertedPrice: d.convertedPrice ?? 0,
        currencyCode: d.currencyCode ?? 643,
        cellLocation: null,
        shipStatus: wbToShip(row.wb_status, row.wb_order_id),
        supply_id: row.supply_id ?? null,
      } as FbsOrder
    })
    const enriched = await enrichWithCells(mapped)
    setOrders(enriched)

    // Проверяем sync log
    const { data: syncLog } = await (supabase as any)
      .from('fbs_sync_log')
      .select('last_synced_at')
      .eq('store_id', selectedStoreId)
      .single()
    if (syncLog?.last_synced_at) setLastSyncedAt(new Date(syncLog.last_synced_at))
  }, [selectedStoreId, enrichWithCells])

  // Синк с WB → upsert в fbs_orders → перечитываем из DB
  const doSync = useCallback(async () => {
    if (!selectedStoreId) return
    setLoading(true); setError(null)
    try {
      await invokeFbs(selectedStoreId, { action: 'sync_orders' })
      await readFromDb()
      setLastSyncedAt(new Date())
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [selectedStoreId, readFromDb])

  // При смене магазина: читаем из DB, если данные старые — фоновый синк
  useEffect(() => {
    if (!selectedStoreId) return
    void readFromDb().then(() => {
      setLastSyncedAt(prev => {
        const stale = !prev || (Date.now() - prev.getTime()) > 10 * 60_000
        if (stale) void doSync()
        return prev
      })
    })

    // Автосинк каждые 2 минуты — без нажатия "Обновить"
    const timer = setInterval(() => { void doSync() }, 2 * 60_000)
    return () => clearInterval(timer)
  }, [selectedStoreId])

  const mapRawOrder = useCallback((o: any, status: FbsOrder['shipStatus']): FbsOrder => ({
    id: o.id, rid: o.rid ?? '', createdAt: o.createdAt ?? '', ddate: o.ddate ?? '',
    warehouseId: o.warehouseId ?? 0, article: o.article ?? '', nmId: o.nmId ?? 0,
    chrtId: o.chrtId ?? 0, skus: o.skus ?? [], price: o.price ?? 0,
    convertedPrice: o.convertedPrice ?? 0, currencyCode: o.currencyCode ?? 643,
    cellLocation: null, shipStatus: status,
  }), [])

  // Склады WB при смене магазина
  useEffect(() => {
    if (!selectedStoreId) return
    void invokeFbs(selectedStoreId, { action: 'get_wb_warehouses' })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d.result ?? d.warehouses ?? [])
        setWbWarehouses(list as WbWarehouse[])
      })
      .catch(() => setWbWarehouses([]))
  }, [selectedStoreId])


  // ─── Handlers ──────────────────────────────────────────────────────────────

  const setStatus = (ids: number[], status: FbsOrder['shipStatus']) => {
    if (status === 'done') ids.forEach(saveDoneId)
    setOrders((prev) => prev.map((o) => ids.includes(o.id) ? { ...o, shipStatus: status } : o))
    setSelected(new Set())
  }

  const openAssembleModal = async (ids: number[]) => {
    const date = new Date().toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' })
    setNewSupplyName(`Сборка ${date}`)
    setAssembleTab('new')
    setAssembleModal({ ids })
    setLoadingSupplies(true)
    try {
      const d = await invokeFbs(selectedStoreId, { action: 'get_supplies', closed: false, limit: 50 })
      const sups = (d.supplies ?? d ?? []) as any[]
      setOpenSupplies(sups.map((s: any) => ({ id: s.id, name: s.name || s.id, ordersCount: s.ordersCount })))
    } catch { setOpenSupplies([]) }
    finally { setLoadingSupplies(false) }
  }

  const handleAssemble = async (ids: number[], existingSupplyId?: string) => {
    setBusyIds((s) => new Set([...s, ...ids]))
    setAssembleModal(null)
    try {
      let supplyId: string
      if (existingSupplyId) {
        supplyId = existingSupplyId
      } else {
        const supRes = await invokeFbs(selectedStoreId, { action: 'create_supply', name: newSupplyName || `Сборка ${new Date().toLocaleDateString('ru')}` })
        supplyId = supRes.id as string
        if (!supplyId) throw new Error('WB не вернул ID поставки')
      }
      const failedIds: number[] = []
      for (const orderId of ids) {
        try {
          const res = await invokeFbs(selectedStoreId, { action: 'add_order_to_supply', supply_id: supplyId, order_id: orderId })
          if (res.success === false) failedIds.push(orderId)
        } catch { failedIds.push(orderId) }
      }
      void doSync()
      if (failedIds.length > 0 && failedIds.length < ids.length) {
        alert(`Часть заказов добавлена. Не удалось добавить: ${failedIds.join(', ')} (возможно устарели или не соответствуют складу поставки)`)
      } else if (failedIds.length === ids.length) {
        alert(`Не удалось добавить заказы в поставку: ${failedIds.join(', ')}. Возможно они устарели или не соответствуют складу.`)
      }
    } catch (e) {
      alert(`Ошибка при переводе в сборку: ${String(e)}`)
    } finally {
      setBusyIds((s) => { const n = new Set(s); ids.forEach(i => n.delete(i)); return n })
    }
  }

  const handleShip = async (orders2ship: FbsOrder[]) => {
    if (!supabase) return
    const ids = orders2ship.map((o) => o.id)
    setBusyIds((s) => new Set([...s, ...ids]))
    try {
      for (const order of orders2ship) {
        if (!order.cellLocation) continue
        const { data: current } = await (supabase as any)
          .from('wms_cell_items').select('qty').eq('id', order.cellLocation.cellItemId).single()
        const newQty = Math.max(0, (current?.qty ?? 1) - 1)
        await (supabase as any).from('wms_cell_items')
          .update({ qty: newQty, updated_at: new Date().toISOString() })
          .eq('id', order.cellLocation.cellItemId)
        if (order.cellLocation.wbWarehouseId) {
          await invokeFbs(selectedStoreId, {
            action: 'update_stocks',
            wb_warehouse_id: order.cellLocation.wbWarehouseId,
            stocks: [{ sku: order.skus[0], amount: newQty }],
          }).catch(() => null)
        }
      }
      setStatus(ids, 'delivering')
    } catch (e) { alert(String(e)) }
    finally { setBusyIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n }) }
  }

  const handlePrintSticker = async (order: FbsOrder) => {
    setBusyIds((s) => new Set([...s, order.id]))
    try {
      // PNG 58×40 от WB API → jsPDF → открывается в Chrome PDF viewer (тёмный фон)
      const res = await invokeFbs(selectedStoreId, {
        action: 'get_sticker', order_ids: [order.id], fmt: 'png', w: 58, h: 40
      }).catch(() => null)
      const stickers = (res?.stickers as any[]) ?? []

      if (stickers.length > 0 && stickers[0]?.file) {
        buildAndOpenPdf(stickers.map((s: any) => s.file as string))
      } else {
        printPickingSlip([order], wbWhName(order.warehouseId))
      }
    } catch (e) { alert(String(e)) }
    finally { setBusyIds((s) => { const n = new Set(s); n.delete(order.id); return n }) }
  }

  // jsPDF — каждый стикер 58×40мм, открывается как PDF (тёмный фон Chrome PDF viewer)
  function buildAndOpenPdf(base64PngList: string[]) {
    const W = 58, H = 40
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [W, H] })
    base64PngList.forEach((b64, i) => {
      if (i > 0) doc.addPage([W, H], 'landscape')
      doc.addImage(`data:image/png;base64,${b64}`, 'PNG', 0, 0, W, H)
    })
    const url = doc.output('bloburl') as unknown as string
    window.open(url, '_blank')
  }

  // Наш picking slip (fallback если стикер WB недоступен)
  function printPickingSlip(orders: FbsOrder[], wbWh: string) {
    const pages = orders.map((order) => {
      const loc = order.cellLocation
      return `<div class="page">
        <div class="big">#${order.id}</div>
        ${loc ? `<div class="cell">${loc.col}${loc.row} <span style="font-size:12px;font-weight:400">${loc.zoneName} · ${loc.warehouseName}</span></div>` : ''}
        <div class="row"><span>WB арт.</span><span>${order.nmId}</span></div>
        <div class="row"><span>Артикул</span><span>${order.article||'—'}</span></div>
        ${order.skus.map(s=>`<div class="row"><span>Баркод</span><span>${s}</span></div>`).join('')}
        <div class="row"><span>Склад WB</span><span>${wbWh}</span></div>
        <hr/><div style="font-size:9px;color:#888;text-align:center">${new Date().toLocaleString('ru')}</div>
      </div>`
    }).join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { size: 80mm 100mm; margin: 4mm; }
  body { font-family: monospace; font-size: 11px; margin: 0; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .big { font-size: 18px; font-weight: bold; margin: 2mm 0; }
  .cell { font-size: 24px; font-weight: 900; margin: 2mm 0; border: 1px solid #000; padding: 2mm; text-align: center; }
  .row { display: flex; justify-content: space-between; border-bottom: 1px dashed #ccc; padding: 1mm 0; }
  hr { border: none; border-top: 1px solid #000; margin: 2mm 0; }
</style></head>
<body>${pages}<script>window.onload=()=>window.print()</script></body></html>`
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    window.open(URL.createObjectURL(blob), '_blank')
  }
  const wbWhName = (id: number) => {
    const w = wbWarehouses.find((wh) => wh.id === id)
    if (!w) return `#${id}`
    return w.name
  }

  // ─── No stores guard ────────────────────────────────────────────────────────

  if (storesWithKey.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <div className="mb-3 text-2xl">🔑</div>
          <p className="text-sm font-semibold text-slate-700">Нет магазинов с API ключом</p>
          <p className="mt-1 text-xs text-slate-500">Добавьте API ключ WB в настройках магазина</p>
        </div>
      </div>
    )
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'pending',    label: 'Новые' },
    { key: 'assembling', label: 'На сборке' },
    { key: 'delivering', label: 'В доставке' },
    { key: 'done',       label: 'Отгружено' },
  ]
  const tabOrders = orders.filter((o) => o.shipStatus === activeTab)
  const selectedTab = tabOrders.filter((o) => selected.has(o.id))
  const allTabSelected = tabOrders.length > 0 && tabOrders.every((o) => selected.has(o.id))

  const toggleSelect = (id: number) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const toggleAll = () => setSelected(allTabSelected ? new Set() : new Set(tabOrders.map((o) => o.id)))

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <select
          value={selectedStoreId}
          onChange={(e) => { setSelectedStoreId(e.target.value); localStorage.setItem(lsKey, e.target.value); setOrders([]); setSelected(new Set()) }}
          className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-violet-400"
        >
          {storesWithKey.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <button type="button" onClick={() => void doSync()} disabled={loading || !selectedStoreId}
          className="flex h-8 items-center gap-1.5 rounded-xl bg-violet-500 px-4 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-50 transition">
          {loading
            ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10"/></svg>
            : <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>}
          {loading ? 'Загрузка...' : 'Обновить'}
        </button>

        {/* Массовые действия */}
        {selectedTab.length > 0 && activeTab === 'pending' && (
          <button type="button" onClick={() => void openAssembleModal(selectedTab.map((o) => o.id))}
            className="h-8 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-white hover:bg-amber-600 transition">
            Взять в сборку ({selectedTab.length})
          </button>
        )}
        {selectedTab.length > 0 && activeTab === 'assembling' && (
          <button type="button" onClick={() => void handleShip(selectedTab)}
            disabled={busyIds.size > 0}
            className="h-8 rounded-xl bg-emerald-500 px-4 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 transition">
            Отгрузить выбранные ({selectedTab.length})
          </button>
        )}
        {selectedTab.length > 0 && activeTab === 'delivering' && (
          <button type="button" onClick={() => setStatus(selectedTab.map((o) => o.id), 'done')}
            className="h-8 rounded-xl bg-slate-600 px-4 text-xs font-semibold text-white hover:bg-slate-700 transition">
            Завершить выбранные ({selectedTab.length})
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 bg-white px-5">
        {tabs.map(({ key, label }) => {
          const count = orders.filter((o) => o.shipStatus === key).length
          return (
            <button key={key} type="button"
              onClick={() => {
                const newTab = key as TabKey
                setActiveTab(newTab)
                localStorage.setItem(tabLsKey, newTab)
                setSelected(new Set())
              }}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
                activeTab === key ? 'border-violet-500 text-violet-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {label}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  key === 'pending' ? 'bg-blue-100 text-blue-600' :
                  key === 'assembling' ? 'bg-amber-100 text-amber-600' :
                  key === 'delivering' ? 'bg-violet-100 text-violet-600' :
                  'bg-emerald-100 text-emerald-700'
                }`}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-xs text-red-600">{error}</div>
      )}

      {!loading && tabOrders.length === 0 && !error && (
        <div className="flex h-full items-center justify-center text-sm text-slate-400">
          {orders.length === 0 ? 'Загрузка...' : `Нет заказов в статусе "${tabs.find(t => t.key === activeTab)?.label}"`}
        </div>
      )}

      {tabOrders.length > 0 && activeTab === 'assembling' && (() => {
        // Группируем по supply_id для аккордеона
        const supplyGroups = new Map<string, FbsOrder[]>()
        tabOrders.forEach((o) => {
          const key = o.supply_id ?? '__none__'
          if (!supplyGroups.has(key)) supplyGroups.set(key, [])
          supplyGroups.get(key)!.push(o)
        })
        return (
          <div className="flex-1 overflow-auto">
            {Array.from(supplyGroups.entries()).map(([supplyId, supplyOrders]) => {
              const isExpanded = expandedSupplyIds.has(supplyId)
              const toggle = () => setExpandedSupplyIds((prev) => { const n = new Set(prev); n.has(supplyId) ? n.delete(supplyId) : n.add(supplyId); return n })
              const wh = wbWhName(supplyOrders[0]?.warehouseId ?? 0)
              return (
                <div key={supplyId} className="border-b border-slate-200">
                  {/* Строка поставки (родитель) */}
                  <div className="flex cursor-pointer items-center gap-3 bg-white px-4 py-3 hover:bg-slate-50 transition-colors" onClick={toggle}>
                    <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <div className="flex flex-1 items-center gap-4 min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{supplyId === '__none__' ? 'Без поставки' : supplyId}</p>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{supplyOrders.length} зак.</span>
                      {wh && <span className="text-xs text-slate-400">{wh}</span>}
                    </div>
                    {supplyId !== '__none__' && (
                      <button type="button" title="Отгрузить всю поставку"
                        disabled={busyIds.size > 0}
                        onClick={(e) => { e.stopPropagation(); void handleShip(supplyOrders) }}
                        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-40 transition">
                        Отгрузить всё
                      </button>
                    )}
                  </div>
                  {/* Аккордеон — заказы */}
                  <div style={{ display: 'grid', gridTemplateRows: isExpanded ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease' }}>
                    <div className="overflow-hidden">
                      <table className="w-full text-xs border-t border-slate-100 bg-slate-50/50">
                        <tbody>
                          {supplyOrders.map((order) => {
                            const sla = slaLabel(order.ddate, order.createdAt)
                            const loc = order.cellLocation
                            const isBusy = busyIds.has(order.id)
                            return (
                              <tr key={order.id} className="border-b border-slate-100 hover:bg-white transition-colors">
                                <td className="px-3 py-2 w-8">
                                  <input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleSelect(order.id)} className="h-3.5 w-3.5 rounded accent-violet-500 cursor-pointer" />
                                </td>
                                <td className="px-2 py-2 w-12">
                                  <PhotoThumb url={getWbPhotoUrl(order.nmId)} className="h-9 w-9 rounded-lg" />
                                </td>
                                <td className="px-4 py-2">
                                  <div className="font-mono text-[11px] text-slate-400">{order.id}</div>
                                  <a href={`https://www.wildberries.ru/catalog/${order.nmId}/detail.aspx`} target="_blank" rel="noreferrer" className="font-mono text-blue-600 hover:underline">{order.nmId}</a>
                                </td>
                                <td className="px-4 py-2 text-slate-700">{order.article || '—'}</td>
                                <td className="px-4 py-2 font-mono text-slate-600">{order.skus[0]}</td>
                                <td className="px-4 py-2">
                                  {loc ? <span className="font-semibold text-violet-700">{loc.col}{loc.row} <span className="text-slate-400 font-normal">{loc.warehouseName}</span></span> : <span className="text-amber-500">Не найден</span>}
                                </td>
                                <td className={`px-4 py-2 whitespace-nowrap ${sla.cls}`}>{sla.text}</td>
                                <td className="px-4 py-2">
                                  <div className="flex items-center gap-1.5">
                                    <button type="button" title="Печать стикера" disabled={isBusy} onClick={() => void handlePrintSticker(order)}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 disabled:opacity-40 transition">
                                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                                    </button>
                                    <button type="button" disabled={!loc || isBusy} onClick={() => void handleShip([order])}
                                      className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-40 transition">
                                      {isBusy ? '...' : 'Отгрузить'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {tabOrders.length > 0 && activeTab !== 'assembling' && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white">
              <tr>
                <th className="px-3 py-3">
                  <input type="checkbox" checked={allTabSelected} onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded accent-violet-500 cursor-pointer" />
                </th>
                <th className="px-2 py-3" />
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Заказ / Арт. WB</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Арт. продавца</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Баркоды</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Адрес</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-500">Кол-во</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">WB склад</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Время</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {tabOrders.map((order) => {
                const sla = slaLabel(order.ddate, order.createdAt)
                const loc = order.cellLocation
                const isBusy = busyIds.has(order.id)
                const isChecked = selected.has(order.id)
                return (
                  <tr key={order.id}
                    className={`border-b border-slate-100 transition ${isChecked ? 'bg-violet-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(order.id)}
                        className="h-3.5 w-3.5 rounded accent-violet-500 cursor-pointer" />
                    </td>
                    <td className="px-2 py-2">
                      <PhotoThumb url={getWbPhotoUrl(order.nmId)} className="h-10 w-10 rounded-lg" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-[11px] text-slate-400">{order.id}</div>
                      <a href={`https://www.wildberries.ru/catalog/${order.nmId}/detail.aspx`}
                        target="_blank" rel="noreferrer"
                        className="font-mono text-blue-600 hover:underline">{order.nmId}</a>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{order.article || '—'}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">
                      {order.skus.length === 1
                        ? order.skus[0]
                        : <div className="flex flex-col gap-0.5">{order.skus.map((s) => <span key={s}>{s}</span>)}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {loc ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-semibold text-violet-700">{loc.col}{loc.row}</span>
                          <span className="text-slate-400">{loc.zoneName} · {loc.warehouseName}</span>
                        </span>
                      ) : <span className="text-amber-500">Не найден</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{loc ? loc.qty : '—'}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{wbWhName(order.warehouseId)}</td>
                    <td className={`px-4 py-3 whitespace-nowrap ${sla.cls}`}>{sla.text}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {/* Стикер — скрыт на табе Новые, WB не выдаёт стикеры до перевода в сборку */}
                        {activeTab !== 'pending' && (
                          <button type="button" title="Печать стикера" disabled={isBusy}
                            onClick={() => void handlePrintSticker(order)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 disabled:opacity-40 transition">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                              <rect x="6" y="14" width="12" height="8"/>
                            </svg>

                          </button>
                        )}
                        {/* Действия для Новых — 3-точечное меню */}
                        {activeTab === 'pending' && (
                          <div className="relative">
                            <button type="button" disabled={isBusy}
                              onClick={(e) => { e.stopPropagation(); setOrderMenuId(orderMenuId === order.id ? null : order.id) }}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 disabled:opacity-40 transition">
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
                            </button>
                            {orderMenuId === order.id && (
                              <div className="absolute right-0 top-8 z-50 w-52 rounded-2xl border border-slate-200 bg-white shadow-xl py-1" onClick={(e) => e.stopPropagation()}>
                                <button type="button"
                                  onClick={() => { setOrderMenuId(null); void openAssembleModal([order.id]) }}
                                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                                  Создать поставку
                                </button>
                                <button type="button"
                                  onClick={() => { setOrderMenuId(null); setAssembleTab('existing'); void openAssembleModal([order.id]) }}
                                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><path d="m15 14 5 5"/><path d="m20 14-5 5"/></svg>
                                  Добавить к созданной
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {activeTab === 'assembling' && (
                          <button type="button" disabled={!loc || isBusy}
                            onClick={() => void handleShip([order])}
                            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-40 transition">
                            {isBusy ? '...' : 'Отгрузить'}
                          </button>
                        )}
                        {activeTab === 'delivering' && (
                          <button type="button"
                            onClick={() => setStatus([order.id], 'done')}
                            className="rounded-lg bg-slate-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600 transition">
                            Завершить
                          </button>
                        )}
                        {activeTab === 'done' && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">✓</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {/* Клик вне меню — закрываем */}
      {orderMenuId !== null && (
        <div className="fixed inset-0 z-40" onClick={() => setOrderMenuId(null)} />
      )}

      {/* Модалка выбора поставки */}
      {assembleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAssembleModal(null)}>
          <div className="flex w-[50vw] flex-col rounded-3xl bg-white shadow-2xl overflow-hidden" style={{ height: '90vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-2">
              <h2 className="text-base font-semibold text-slate-800 mb-4 pt-5">В сборку ({assembleModal.ids.length} заказ{assembleModal.ids.length > 1 ? 'а' : ''})</h2>
              {/* Табы */}
              <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 mb-4">
                {(['new', 'existing'] as const).map((tab) => (
                  <button key={tab} type="button"
                    onClick={() => setAssembleTab(tab)}
                    className={`flex-1 rounded-xl py-2 text-sm font-medium transition-colors ${assembleTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {tab === 'new' ? 'Создать поставку' : 'Добавить к созданной'}
                  </button>
                ))}
              </div>

              {assembleTab === 'new' ? (
                <div className="space-y-3">
                  <label className="text-xs font-medium text-slate-600">Название поставки</label>
                  <input
                    type="text"
                    autoFocus
                    value={newSupplyName}
                    onChange={(e) => setNewSupplyName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2 px-6">
                  {loadingSupplies ? (
                    <p className="py-4 text-center text-sm text-slate-400">Загрузка поставок...</p>
                  ) : openSupplies.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-400">Нет открытых поставок на WB</p>
                  ) : (
                    openSupplies.map((sup) => (
                      <button key={sup.id} type="button"
                        onClick={() => void handleAssemble(assembleModal.ids, sup.id)}
                        className="w-full flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left hover:border-violet-300 hover:bg-violet-50 transition-colors">
                        <div>
                          <p className="text-sm font-medium text-slate-800">{sup.name}</p>
                          <p className="text-xs text-slate-400 font-mono">{sup.id}</p>
                        </div>
                        {sup.ordersCount != null && (
                          <span className="text-xs text-slate-400">{sup.ordersCount} зак.</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
              {assembleTab === 'new' && (
                <button type="button"
                  disabled={!newSupplyName.trim()}
                  onClick={() => void handleAssemble(assembleModal.ids)}
                  className="flex-1 rounded-2xl bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition">
                  Создать и добавить
                </button>
              )}
              <button type="button"
                onClick={() => setAssembleModal(null)}
                className="flex-1 rounded-2xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
