import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { fetchBatches, fetchOtkLogs, fetchMarkingLogs, fetchSupplies, fetchBatchConsumables, fetchPackagingLogs } from '../services/fulfillmentService'
import { fetchWorkTariffs, fetchConsumables, fetchConsumableCatalog } from '../services/directoriesService'
import { supabase } from '../lib/supabase'
import type {
  FulfillmentBatch, FulfillmentBatchStatus, FulfillmentOtkLog, FulfillmentMarkingLog,
  FulfillmentWorkTariff, FulfillmentSupplyWithBoxes, BatchConsumable, Consumable, Store, Trip, TripLine,
  ConsumableCatalogItem, FulfillmentPackagingLog,
} from '../types'

type Tab = 'invoice' | 'payroll' | 'earned'
type BatchFilter = 'all' | 'active' | 'done'

const TABS: { key: Tab; label: string }[] = [
  { key: 'invoice', label: 'Выставление счёта' },
  { key: 'payroll', label: 'Фонд оплаты труда' },
  { key: 'earned',  label: 'Заработана' },
]

const FILTER_LABELS: Record<BatchFilter, string> = {
  all: 'Все',
  active: 'В работе',
  done: 'Завершённые',
}

const BATCH_STATUS_LABEL: Record<FulfillmentBatchStatus, string> = {
  active: 'В работе',
  done: 'Завершена',
  cancelled: 'Отменена',
}

const BATCH_STATUS_STYLE: Record<FulfillmentBatchStatus, string> = {
  active: 'bg-orange-100 text-orange-700',
  done: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

// ─── Invoice Modal ────────────────────────────────────────────

const TRIP_STATUS_STYLE: Record<string, string> = {
  'Формируется': 'bg-slate-100 text-slate-500',
  'Отправлен':   'bg-blue-100 text-blue-600',
  'Прибыл':      'bg-violet-100 text-violet-600',
  'Завершён':    'bg-emerald-100 text-emerald-700',
}

interface InfoRowProps { label: string; value: React.ReactNode }
const InfoRow = ({ label, value }: InfoRowProps) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5">
    <span className="text-xs text-slate-500 shrink-0">{label}</span>
    <span className="text-sm font-medium text-slate-900 text-right">{value ?? <span className="text-slate-300">—</span>}</span>
  </div>
)

interface WorkLine { name: string; price: number; qty: number; currency: string }

// Merge OTK + marking logs → group by tariff ID, sum qty; attach price from tariff dict
function buildWorkLines(
  logs: Array<{ tariff: string; qty: number; qty_defect: number }>,
  tariffMap: Record<string, FulfillmentWorkTariff>,
): WorkLine[] {
  const map: Record<string, WorkLine> = {}
  for (const l of logs) {
    const tariffId = l.tariff
    const t = tariffMap[tariffId]
    // skip if tariff not found in directory
    if (!t) continue
    const qty = l.qty + (l.qty_defect ?? 0)
    if (map[tariffId]) {
      map[tariffId].qty += qty
    } else {
      map[tariffId] = { name: t.name, price: t.price_per_unit, qty, currency: t.currency }
    }
  }
  return Object.values(map)
}

interface InvoiceModalProps {
  batch: FulfillmentBatch
  store: Store | null
  invoiceUrl: string
  onClose: () => void
}

const InvoiceModal = ({ batch, store, invoiceUrl, onClose }: InvoiceModalProps) => {
  const [supplyLogisticsData, setSupplyLogisticsData] = useState<Array<{
    supply: FulfillmentSupplyWithBoxes
    trip: Trip | null
    tripLine: TripLine | null
    workTariff: FulfillmentWorkTariff | null
  }>>([])  
  const [logisticsLoading, setLogisticsLoading] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [tgClicked, setTgClicked] = useState(false)
  const [waClicked, setWaClicked] = useState(false)
  const shareRef = useRef<HTMLDivElement>(null)
  const [otkLogs, setOtkLogs] = useState<FulfillmentOtkLog[]>([])
  const [markingLogs, setMarkingLogs] = useState<FulfillmentMarkingLog[]>([])
  const [supplies, setSupplies] = useState<FulfillmentSupplyWithBoxes[]>([])
  const [tariffs, setTariffs] = useState<FulfillmentWorkTariff[]>([])
  const [batchConsumables, setBatchConsumables] = useState<BatchConsumable[]>([])
  const [accountConsumables, setAccountConsumables] = useState<Consumable[]>([])
  const [packagingLogs, setPackagingLogs] = useState<FulfillmentPackagingLog[]>([])
  const [catalogItems, setCatalogItems] = useState<ConsumableCatalogItem[]>([])
  const [worksLoading, setWorksLoading] = useState(true)
  const logisticsTariffType = batch.logistics_tariff_type ?? null

  // Fetch works (OTK, marking, supplies, tariffs)
  useEffect(() => {
    setWorksLoading(true)
    const fetchWorks = async () => {
      const [otk, marking, suppliesData, tariffsData, consumablesData, accountConsumablesData, packLogs, catalog] = await Promise.all([
        fetchOtkLogs(batch.id),
        fetchMarkingLogs(batch.id),
        fetchSupplies(batch.id),
        fetchWorkTariffs(batch.account_id),
        fetchBatchConsumables(batch.id),
        fetchConsumables(batch.account_id),
        fetchPackagingLogs(batch.id),
        fetchConsumableCatalog(batch.account_id),
      ])
      setOtkLogs(otk)
      setMarkingLogs(marking)
      setSupplies(suppliesData)
      setTariffs(tariffsData)
      setBatchConsumables(consumablesData)
      setAccountConsumables(accountConsumablesData as Consumable[])
      setPackagingLogs(packLogs)
      setCatalogItems(catalog as ConsumableCatalogItem[])
    }
    fetchWorks().catch(console.error).finally(() => setWorksLoading(false))
  }, [batch.id, batch.account_id])

  // Fetch logistics per supply
  useEffect(() => {
    if (!supabase || supplies.length === 0) return
    const suppliesWithTrip = supplies.filter((s) => s.trip_id)
    if (suppliesWithTrip.length === 0) return
    setLogisticsLoading(true)
    const fetchLogistics = async () => {
      // Кэш: чтобы не дублировать запросы при нескольких поставках с одним рейсом/складом
      const tripCache: Record<string, Trip> = {}
      const tripLineCache: Record<string, TripLine> = {}
      const warehouseIdCache: Record<string, string> = {}  // отметка «уже запрашивали»
      const wbTariffCache: Record<string, FulfillmentWorkTariff | null> = {}
      const results: Array<{
        supply: FulfillmentSupplyWithBoxes
        trip: Trip | null
        tripLine: TripLine | null
        workTariff: FulfillmentWorkTariff | null
      }> = []
      for (const supply of suppliesWithTrip) {
        let trip: Trip | null = null
        if (supply.trip_id) {
          if (tripCache[supply.trip_id]) {
            trip = tripCache[supply.trip_id]
          } else {
            const { data } = await supabase!.from('trips').select('*').eq('id', supply.trip_id).single()
            trip = (data as Trip | null) ?? null
            if (trip) tripCache[supply.trip_id] = trip
          }
        }
        let tripLine: TripLine | null = null
        if (supply.trip_line_id) {
          if (tripLineCache[supply.trip_line_id]) {
            tripLine = tripLineCache[supply.trip_line_id]
          } else {
            const { data } = await supabase!.from('trip_lines').select('*').eq('id', supply.trip_line_id).single()
            tripLine = (data as TripLine | null) ?? null
            if (tripLine) tripLineCache[supply.trip_line_id] = tripLine
          }
        }
        // Тариф берётся из fulfillment_work_tariffs (stage=wb_unload, name=склад поставки)
        // Используем supply.warehouse_name — надёжнее tripLine.destination_warehouse
        let workTariff: FulfillmentWorkTariff | null = null
        const wName = supply.warehouse_name
        if (wName) {
          if (wName in warehouseIdCache) {
            workTariff = wbTariffCache[wName] ?? null
          } else {
            const { data } = await (supabase as any)
              .from('fulfillment_work_tariffs')
              .select('*')
              .eq('account_id', batch.account_id)
              .eq('stage', 'wb_unload')
              .eq('name', wName)
              .maybeSingle()
            workTariff = (data as FulfillmentWorkTariff | null) ?? null
            warehouseIdCache[wName] = wName
            wbTariffCache[wName] = workTariff
          }
        }
        results.push({ supply, trip, tripLine, workTariff })
      }
      setSupplyLogisticsData(results)
    }
    fetchLogistics().catch(console.error).finally(() => setLogisticsLoading(false))
  }, [supplies, batch.account_id])

  // Close share dropdown on outside click
  useEffect(() => {
    if (!shareOpen) return
    const handle = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [shareOpen])

  const tariffMap = useMemo(() => {
    const m: Record<string, FulfillmentWorkTariff> = {}
    for (const t of tariffs) m[t.id] = t
    return m
  }, [tariffs])

  // Merge OTK + marking into single grouped list
  const allWorkLines = useMemo(() => {
    const combined = [...otkLogs, ...markingLogs]
    return buildWorkLines(combined, tariffMap)
  }, [otkLogs, markingLogs, tariffMap])

  // Total boxes across all supplies
  const totalBoxes = useMemo(
    () => supplies.reduce((s, sup) => s + sup.boxes.length, 0),
    [supplies]
  )

  // Расходники из каталога: ZIP-пакеты (из логов упаковки) + Короба (из партии)
  const catalogConsumableLines = useMemo(() => {
    const lines: Array<{ id: string; name: string; price: number; qty: number; currency: string }> = []
    // ZIP-пакеты: группируем логи упаковки по catalog_consumable_id, суммируем zip_bags_qty
    const zipMap: Record<string, number> = {}
    for (const log of packagingLogs) {
      if (log.catalog_consumable_id && (log.zip_bags_qty ?? 0) > 0) {
        zipMap[log.catalog_consumable_id] = (zipMap[log.catalog_consumable_id] ?? 0) + (log.zip_bags_qty ?? 0)
      }
    }
    for (const [catalogId, qty] of Object.entries(zipMap)) {
      const item = catalogItems.find((i) => i.id === catalogId)
      if (item) lines.push({ id: catalogId, name: `ZIP-пакет ${item.size}`, price: item.price, qty, currency: item.currency })
    }
    // Короба: из поля batch
    if (batch.box_catalog_consumable_id && (batch.boxes_qty ?? 0) > 0) {
      const item = catalogItems.find((i) => i.id === batch.box_catalog_consumable_id)
      if (item) lines.push({ id: `box_${item.id}`, name: `Короб ${item.size}`, price: item.price, qty: batch.boxes_qty!, currency: item.currency })
    }
    return lines
  }, [packagingLogs, catalogItems, batch.box_catalog_consumable_id, batch.boxes_qty])

  // Subtotals
  const fulfillmentSubtotal = useMemo(() => {
    let total = 0
    const recTariff = Object.values(tariffMap).find(x => x.stage === 'reception')
    total += (recTariff?.price_per_unit ?? 0) * (batch.qty_received_sum ?? 0)
    for (const line of allWorkLines) total += line.price * line.qty
    if (batch.stage_packaging && batchConsumables.length > 0) {
      for (const bc of batchConsumables) {
        const cons = accountConsumables.find(c => c.id === bc.consumable_id)
        if (cons) total += cons.price * bc.qty
      }
    }
    if (batch.stage_packing && totalBoxes > 0) {
      const packTariff = Object.values(tariffMap).find(x => x.stage === 'packing')
      total += (packTariff?.price_per_unit ?? 0) * totalBoxes
    }
    return total
  }, [tariffMap, batch.qty_received_sum, batch.stage_packing, batch.stage_packaging, allWorkLines, totalBoxes, batchConsumables, accountConsumables])
  const consumablesSubtotal = useMemo(() => {
    let total = 0
    if (batch.stage_packaging) {
      for (const bc of batchConsumables) {
        const cons = accountConsumables.find(c => c.id === bc.consumable_id)
        if (cons) total += cons.price * bc.qty
      }
    }
    for (const line of catalogConsumableLines) total += line.price * line.qty
    return total
  }, [batch.stage_packaging, batchConsumables, accountConsumables, catalogConsumableLines])
  const logisticsSubtotal = useMemo(() => {
    return supplyLogisticsData.reduce((total, { supply, workTariff }) => {
      const effectiveTariffType = supply.logistics_tariff_type ?? logisticsTariffType
      if (!effectiveTariffType || !workTariff) return total
      const boxQty = supply.boxes.length
      const weight = supply.weight ?? 0
      if (effectiveTariffType === 'per_box') {
        return total + (workTariff.price_per_unit ?? 0) * boxQty
      }
      return total + (workTariff.price_per_kg ?? 0) * weight
    }, 0)
  }, [supplyLogisticsData, logisticsTariffType])
  const grandTotal = fulfillmentSubtotal + consumablesSubtotal + logisticsSubtotal

  const formatDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : null

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40"
      style={{ zIndex: 50 }}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              {batch.short_id != null && (
                <span className="text-xs font-mono text-slate-400">I-{batch.short_id}</span>
              )}
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${BATCH_STATUS_STYLE[batch.status]}`}>
                {BATCH_STATUS_LABEL[batch.status]}
              </span>
            </div>
            <h2 className="mt-1 text-base font-semibold text-slate-800">{batch.name}</h2>
            {store && (
              <p className="text-xs text-slate-400">
                {store.supplier ?? store.name}
                {' · '}
                <span className="font-mono">{store.store_code}</span>
              </p>
            )}
            <p className="mt-0.5 text-xs text-slate-400">{formatDate(batch.created_at)}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Share button */}
            <div className="relative" ref={shareRef}>
              <button
                type="button"
                title="Поделиться счётом"
                onClick={() => setShareOpen((v) => !v)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${shareOpen ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </button>
              {shareOpen && (
                <div className="absolute right-0 top-9 z-50 flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl" style={{ minWidth: 180 }}>
                  <a href={`https://t.me/share/url?url=${encodeURIComponent(invoiceUrl)}`} target="_blank" rel="noreferrer"
                    onClick={() => { setTgClicked(true); setTimeout(() => setTgClicked(false), 600); setShareOpen(false) }}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 ${tgClicked ? 'bg-[#e8f4fd]' : ''}`}>
                    <span className={`flex h-7 w-7 items-center justify-center rounded-xl transition-colors ${tgClicked ? 'bg-[#29b6f6] text-white' : 'bg-[#e8f4fd] text-[#29b6f6]'}`}>
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                      </svg>
                    </span>
                    Telegram
                  </a>
                  <a href={`https://wa.me/?text=${encodeURIComponent(invoiceUrl)}`} target="_blank" rel="noreferrer"
                    onClick={() => { setWaClicked(true); setTimeout(() => setWaClicked(false), 600); setShareOpen(false) }}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 ${waClicked ? 'bg-[#e8f5e9]' : ''}`}>
                    <span className={`flex h-7 w-7 items-center justify-center rounded-xl transition-colors ${waClicked ? 'bg-[#25d366] text-white' : 'bg-[#e8f5e9] text-[#25d366]'}`}>
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                      </svg>
                    </span>
                    WhatsApp
                  </a>
                </div>
              )}
            </div>
            {/* Close button */}
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-3 gap-4 min-h-0">

            {/* Фулфилмент — карточка */}
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              {/* Шапка карточки */}
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="text-sm font-semibold text-slate-900">Фулфилмент</span>
                {fulfillmentSubtotal > 0 && (
                  <span className="text-xs font-semibold text-slate-500">{fulfillmentSubtotal.toLocaleString('ru-RU')}</span>
                )}
              </div>

              {/* Контент */}
              <div className="px-4 py-2">
                {worksLoading ? (
                  <div className="py-4 text-xs text-slate-400">Загрузка работ…</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">Услуга</th>
                        <th className="w-16 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Цена</th>
                        <th className="w-14 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Кол-во</th>
                        <th className="w-16 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {/* Reception */}
                      {(batch.qty_received_sum ?? 0) > 0 && (() => {
                        const t = Object.values(tariffMap).find(x => x.stage === 'reception')
                        const price = t?.price_per_unit ?? 0
                        const qty = batch.qty_received_sum ?? 0
                        return (
                          <tr key="reception">
                            <td className="py-2 text-slate-800">Приёмка</td>
                            <td className="py-2 text-right font-medium text-slate-900">{price > 0 ? price : '—'}</td>
                            <td className="py-2 text-right font-medium text-slate-900">{qty}</td>
                            <td className="py-2 text-right font-medium text-slate-900">{price > 0 ? price * qty : '—'}</td>
                          </tr>
                        )
                      })()}

                      {/* OTK + Marking (merged) */}
                      {allWorkLines.map((line) => (
                        <tr key={line.name}>
                          <td className="py-2 text-slate-800">{line.name}</td>
                          <td className="py-2 text-right font-medium text-slate-900">{line.price > 0 ? line.price : '—'}</td>
                          <td className="py-2 text-right font-medium text-slate-900">{line.qty}</td>
                          <td className="py-2 text-right font-medium text-slate-900">{line.price > 0 ? line.price * line.qty : '—'}</td>
                        </tr>
                      ))}

                      {/* Упаковка — расходники */}
                      {batch.stage_packaging && batchConsumables.map((bc) => {
                        const cons = accountConsumables.find(c => c.id === bc.consumable_id)
                        if (!cons) return null
                        return (
                          <tr key={bc.id}>
                            <td className="py-2 text-slate-800">Упаковка · {cons.name}</td>
                            <td className="py-2 text-right font-medium text-slate-900">{cons.price > 0 ? cons.price : '—'}</td>
                            <td className="py-2 text-right font-medium text-slate-900">{bc.qty}</td>
                            <td className="py-2 text-right font-medium text-slate-900">{cons.price > 0 ? cons.price * bc.qty : '—'}</td>
                          </tr>
                        )
                      })}

                      {/* Packing */}
                      {batch.stage_packing && totalBoxes > 0 && (() => {
                        const t = Object.values(tariffMap).find(x => x.stage === 'packing')
                        const price = t?.price_per_unit ?? 0
                        return (
                          <tr key="packing">
                            <td className="py-2 text-slate-800">Формирование коробов</td>
                            <td className="py-2 text-right font-medium text-slate-900">{price > 0 ? price : '—'}</td>
                            <td className="py-2 text-right font-medium text-slate-900">{totalBoxes}</td>
                            <td className="py-2 text-right font-medium text-slate-900">{price > 0 ? price * totalBoxes : '—'}</td>
                          </tr>
                        )
                      })()}
                    </tbody>
                  </table>
                )}

                {batch.otk_discrepancy != null && batch.otk_discrepancy !== 0 && (
                  <InfoRow label="Расхождение ОТК" value={<span className="text-red-500">{batch.otk_discrepancy}</span>} />
                )}
                {batch.comment && (
                  <InfoRow label="Комментарий" value={batch.comment} />
                )}
              </div>
            </div>

            {/* Логистика — карточка */}
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              {/* Шапка карточки */}
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="text-sm font-semibold text-slate-900">Логистика</span>
                {logisticsSubtotal > 0 && (
                  <span className="text-xs font-semibold text-slate-500">{logisticsSubtotal.toLocaleString('ru-RU')}</span>
                )}
              </div>

              {/* Контент */}
              <div className="px-4 py-2">
                {worksLoading || (supplies.some((s) => s.trip_id) && logisticsLoading) ? (
                  <p className="py-4 text-sm text-slate-400">Загрузка…</p>
                ) : !supplies.some((s) => s.trip_id) ? (
                  <p className="py-4 text-sm text-slate-400">Рейс не привязан</p>
                ) : (
                  <>
                    {/* Таблица услуг логистики */}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">Услуга</th>
                          <th className="w-16 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Цена</th>
                          <th className="w-14 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Кол-во</th>
                          <th className="w-16 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Сумма</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {supplyLogisticsData.map(({ supply, tripLine, workTariff }) => {
                          const effectiveTariffType = supply.logistics_tariff_type ?? logisticsTariffType
                          const warehouseName = supply.warehouse_name || tripLine?.destination_warehouse || ''
                          const warehouseLabel = warehouseName ? (
                            <span className="ml-1 text-[10px] text-slate-400">{warehouseName}</span>
                          ) : null
                          return (
                            <React.Fragment key={supply.id}>
                              {/* За короб */}
                              {effectiveTariffType === 'per_box' && workTariff && (
                                <tr>
                                  <td className="py-2 text-slate-800">Перевозка{warehouseLabel}</td>
                                  <td className="py-2 text-right font-medium text-slate-900">{workTariff.price_per_unit > 0 ? workTariff.price_per_unit : '—'}</td>
                                  <td className="py-2 text-right font-medium text-slate-900">{supply.boxes.length}</td>
                                  <td className="py-2 text-right font-medium text-slate-900">
                                    {workTariff.price_per_unit > 0 ? workTariff.price_per_unit * supply.boxes.length : '—'}
                                  </td>
                                </tr>
                              )}
                              {/* За кг */}
                              {effectiveTariffType === 'per_kg' && workTariff && (
                                <tr>
                                  <td className="py-2 text-slate-800">Перевозка (кг){warehouseLabel}</td>
                                  <td className="py-2 text-right font-medium text-slate-900">{(workTariff.price_per_kg ?? 0) > 0 ? workTariff.price_per_kg : '—'}</td>
                                  <td className="py-2 text-right font-medium text-slate-900">{supply.weight ?? '—'}</td>
                                  <td className="py-2 text-right font-medium text-slate-900">
                                    {(workTariff.price_per_kg ?? 0) > 0 && (supply.weight ?? 0) > 0
                                      ? workTariff.price_per_kg! * supply.weight!
                                      : '—'}
                                  </td>
                                </tr>
                              )}
                              {/* Нет тарифа для этой поставки */}
                              {!workTariff && (
                                <tr>
                                  <td colSpan={4} className="py-3 text-xs text-slate-400">
                                    Тарифы не настроены{warehouseName ? ` (${warehouseName})` : ''}
                                  </td>
                                </tr>
                              )}
                              {/* Тариф есть, но тип не определён */}
                              {workTariff && !effectiveTariffType && (
                                <tr>
                                  <td colSpan={4} className="py-3 text-xs text-amber-500">Тип тарифа не задан в настройках партии</td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>

                    {/* Метаданные рейсов */}
                    {supplyLogisticsData.some(({ trip, tripLine }) => trip || tripLine) && (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        {/* Дедублицируем рейсы */}
                        {Array.from(
                          new Map(
                            supplyLogisticsData
                              .filter(({ trip }) => trip)
                              .map(({ trip }) => [trip!.id, trip!])
                          ).values()
                        ).map((trip) => (
                          <React.Fragment key={trip.id}>
                            <InfoRow
                              label="Рейс"
                              value={
                                <span className="flex items-center gap-1.5">
                                  <span>{trip.trip_number ?? `Черновик #${trip.draft_number}`}</span>
                                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TRIP_STATUS_STYLE[trip.status] ?? 'bg-slate-100 text-slate-500'}`}>
                                    {trip.status}
                                  </span>
                                </span>
                              }
                            />
                            <InfoRow label="Перевозчик" value={trip.carrier || null} />
                            <InfoRow label="Дата отправки" value={formatDate(trip.departure_date)} />
                            <InfoRow label="Дата прибытия" value={formatDate(trip.arrived_at)} />
                          </React.Fragment>
                        ))}
                        {/* Строки tripLine по каждой поставке */}
                        {supplyLogisticsData
                          .filter(({ tripLine }) => tripLine)
                          .map(({ supply, tripLine }) => (
                            <React.Fragment key={supply.id}>
                              <InfoRow label="Поставка №" value={tripLine!.shipment_number} />
                              <InfoRow label="Склад назначения" value={tripLine!.destination_warehouse || null} />
                              <InfoRow label="Коробов" value={tripLine!.box_qty} />
                              <InfoRow label="Единиц" value={tripLine!.units_qty} />
                              <InfoRow label="Дата приёмки (МП)" value={formatDate(tripLine!.reception_date)} />
                              <InfoRow label="Отгружено" value={formatDate(tripLine!.shipped_date)} />
                            </React.Fragment>
                          ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Расходники — карточка */}
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="text-sm font-semibold text-slate-900">Расходники</span>
                {consumablesSubtotal > 0 && (
                  <span className="text-xs font-semibold text-slate-500">{consumablesSubtotal.toLocaleString('ru-RU')}</span>
                )}
              </div>
              <div className="px-4 py-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">Услуга</th>
                      <th className="w-16 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Цена</th>
                      <th className="w-14 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Кол-во</th>
                      <th className="w-16 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">Сумма</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {/* Старые расходники (старая система) */}
                    {batch.stage_packaging && batchConsumables.map((bc) => {
                      const cons = accountConsumables.find(c => c.id === bc.consumable_id)
                      if (!cons) return null
                      return (
                        <tr key={bc.id}>
                          <td className="py-2 text-slate-800">{cons.name}</td>
                          <td className="py-2 text-right font-medium text-slate-900">{cons.price > 0 ? cons.price : '—'}</td>
                          <td className="py-2 text-right font-medium text-slate-900">{bc.qty}</td>
                          <td className="py-2 text-right font-medium text-slate-900">{cons.price > 0 ? cons.price * bc.qty : '—'}</td>
                        </tr>
                      )
                    })}
                    {/* Расходники из каталога (ZIP-пакеты + Короба) */}
                    {catalogConsumableLines.map((line) => (
                      <tr key={line.id}>
                        <td className="py-2 text-slate-800">{line.name}</td>
                        <td className="py-2 text-right font-medium text-slate-900">{line.price > 0 ? line.price : '—'}</td>
                        <td className="py-2 text-right font-medium text-slate-900">{line.qty}</td>
                        <td className="py-2 text-right font-medium text-slate-900">{line.price > 0 ? line.price * line.qty : '—'}</td>
                      </tr>
                    ))}
                    {/* Пусто */}
                    {consumablesSubtotal === 0 && batchConsumables.length === 0 && catalogConsumableLines.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-xs text-slate-300">Расходники не добавлены</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-3 border-t border-slate-100 shrink-0">
          <div>
            <p className="text-xs text-slate-400">Итого к оплате</p>
            <p className="text-base font-bold text-slate-900">{grandTotal > 0 ? grandTotal.toLocaleString('ru-RU') : '—'}</p>
          </div>
          <button
            type="button"
            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 transition"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Placeholder ─────────────────────────────────────────────

const Placeholder = () => (
  <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    </div>
    <div>
      <p className="text-sm font-medium text-slate-600">Раздел в разработке</p>
      <p className="mt-0.5 text-xs text-slate-400">Функционал появится здесь</p>
    </div>
  </div>
)

interface InvoicesPageProps {
  accountId: string
  accountShortId: number | null
  stores: Store[]
  initialInvoiceShortId?: number | null
  onInvoiceUrlConsumed?: () => void
}

export const InvoicesPage = ({ accountId, accountShortId, stores, initialInvoiceShortId, onInvoiceUrlConsumed }: InvoicesPageProps) => {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('invoice')
  const [batches, setBatches] = useState<FulfillmentBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<BatchFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedBatch, setSelectedBatch] = useState<FulfillmentBatch | null>(null)
  const [shareMenuPos, setShareMenuPos] = useState<{ left: number; anchorTop: number; anchorBottom: number; openUp: boolean; batchId: string; batchUrl: string } | null>(null)
  const [linkCopiedId, setLinkCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (!shareMenuPos) return
    const close = () => setShareMenuPos(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [shareMenuPos])

  useEffect(() => {
    if (!accountId) return
    setLoading(true)
    fetchBatches(accountId)
      .then(setBatches)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [accountId])

  // Auto-open invoice from URL
  useEffect(() => {
    if (!initialInvoiceShortId || loading || batches.length === 0) return
    const target = batches.find((b) => b.short_id === initialInvoiceShortId)
    if (target) {
      setSelectedBatch(target)
      if (accountShortId != null) {
        navigate(`/invoices/C-${accountShortId}/I-${initialInvoiceShortId}`, { replace: true })
      }
    }
    onInvoiceUrlConsumed?.()
  }, [initialInvoiceShortId, loading, batches.length])

  const storeMap = useMemo(() => {
    const m: Record<string, Store> = {}
    stores.forEach((s) => { m[s.id] = s })
    return m
  }, [stores])

  const filtered = useMemo(() => {
    let list = batches
    if (filter !== 'all') list = list.filter((b) => b.status === filter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((b) => {
        // Invoice ID: i-18, i18, 18
        if (b.short_id != null) {
          if (`i-${b.short_id}` === q) return true
          if (`i${b.short_id}` === q) return true
          if (`${b.short_id}` === q) return true
        }
        // Batch name
        if (b.name.toLowerCase().includes(q)) return true
        // Batch P-N: p-18, p18
        if (b.short_id != null) {
          if (`p-${b.short_id}` === q) return true
          if (`p${b.short_id}` === q) return true
        }
        const s = b.store_id ? storeMap[b.store_id] : null
        if (!s) return false
        return (
          s.name.toLowerCase().includes(q) ||
          s.store_code.toLowerCase().includes(q) ||
          (s.supplier ?? '').toLowerCase().includes(q) ||
          (s.supplier_full ?? '').toLowerCase().includes(q)
        )
      })
    }
    return list
  }, [batches, filter, search, storeMap])

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
              activeTab === tab.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Invoice tab */}
      {activeTab === 'invoice' && (
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по партии или магазину…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              />
            </div>
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              {(['all', 'active', 'done'] as BatchFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    filter === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {FILTER_LABELS[f]}
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-slate-400">{filtered.length} партий</span>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">Загрузка…</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">Нет партий</div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/70">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">ID</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Партия</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Магазин</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Статус</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-400">Создана</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">Принято</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-blue-500">ОТК</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-violet-500">Маркировка</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-slate-500">Коробов</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-emerald-600">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((b) => {
                    const store = b.store_id ? storeMap[b.store_id] : null
                    return (
                      <tr
                        key={b.id}
                        className="hover:bg-slate-50/60 cursor-pointer"
                        onClick={() => {
                          setSelectedBatch(b)
                          if (accountShortId != null && b.short_id != null) {
                            navigate(`/invoices/C-${accountShortId}/I-${b.short_id}`, { replace: true })
                          }
                        }}
                      >
                        <td className="px-4 py-2.5 text-xs text-slate-400 font-mono" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <span>{b.short_id != null ? `I-${b.short_id}` : '—'}</span>
                            {accountShortId != null && b.short_id != null && (() => {
                              const invoiceUrl = `${window.location.origin}/invoices/C-${accountShortId}/I-${b.short_id}`
                              return (
                                <button type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (shareMenuPos?.batchId === b.id) { setShareMenuPos(null); return }
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                    const openUp = rect.bottom + 130 > window.innerHeight - 20
                                    setShareMenuPos({ left: rect.left, anchorTop: rect.top, anchorBottom: rect.bottom, openUp, batchId: b.id, batchUrl: invoiceUrl })
                                  }}
                                  className="flex h-6 w-6 items-center justify-center rounded text-blue-400 hover:text-blue-600 hover:bg-blue-50">
                                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                                  </svg>
                                </button>
                              )
                            })()}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-700">
                          <div className="flex items-center gap-2">
                            {b.short_id != null && (
                              <span className="shrink-0 text-xs font-mono text-slate-400">P-{b.short_id}</span>
                            )}
                            <span>{b.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {store ? (
                            <div>
                              <div className="font-medium text-slate-700">{store.supplier ?? store.name}</div>
                              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                                <span>{store.name}</span>
                                <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-mono text-slate-400">{store.store_code}</span>
                              </div>
                            </div>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col items-start">
                            {b.status === 'active' && (
                              <svg viewBox="0 0 24 24" className="h-4 w-4 text-orange-500" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                              </svg>
                            )}
                            {b.status === 'done' && (
                              <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                              </svg>
                            )}
                            {b.status === 'cancelled' && (
                              <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                              </svg>
                            )}
                            <span className={`mt-0.5 text-[10px] font-medium leading-tight ${
                              b.status === 'active' ? 'text-orange-600' : b.status === 'done' ? 'text-emerald-600' : 'text-slate-400'
                            }`}>
                              {BATCH_STATUS_LABEL[b.status]}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-slate-400">{formatDate(b.created_at)}</td>
                        <td className="px-4 py-2.5 text-center font-medium text-slate-700">{b.qty_received_sum ?? 0}</td>
                        <td className="px-4 py-2.5 text-center font-medium text-blue-600">
                          {b.stage_otk ? (b.qty_otk_sum ?? 0) : <span className="text-slate-200">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center font-medium text-violet-600">
                          {b.stage_marking ? (b.qty_marked_sum ?? 0) : <span className="text-slate-200">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center font-medium text-slate-700">
                          {b.stage_packing ? (b.qty_packed_sum ?? 0) : <span className="text-slate-200">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-slate-300">—</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab !== 'invoice' && <Placeholder />}

      {shareMenuPos && createPortal(
        <div
          style={{
            position: 'fixed',
            left: shareMenuPos.left,
            ...(shareMenuPos.openUp
              ? { bottom: window.innerHeight - shareMenuPos.anchorTop + 4 }
              : { top: shareMenuPos.anchorBottom + 4 }),
            zIndex: 9999,
          }}
          className="w-52 rounded-xl border border-slate-100 bg-white py-1 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <a href={`https://t.me/share/url?url=${encodeURIComponent(shareMenuPos.batchUrl)}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => setShareMenuPos(null)}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-500 shrink-0" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.932z"/>
            </svg>
            Telegram
          </a>
          <a href={`https://wa.me/?text=${encodeURIComponent(shareMenuPos.batchUrl)}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => setShareMenuPos(null)}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-green-500 shrink-0" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            WhatsApp
          </a>
          <div className="my-1 border-t border-slate-100" />
          <button type="button"
            className="flex w-full items-center gap-2 px-3 py-2 font-[inherit] text-xs text-slate-700 hover:bg-slate-50"
            onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(shareMenuPos.batchUrl); setLinkCopiedId(shareMenuPos.batchId); setTimeout(() => setLinkCopiedId(null), 2000) }}>
            {linkCopiedId === shareMenuPos.batchId ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            )}
            {linkCopiedId === shareMenuPos.batchId ? 'Скопировано!' : 'Копировать ссылку'}
          </button>
        </div>,
        document.body
      )}

      {selectedBatch && (
        <InvoiceModal
          batch={selectedBatch}
          store={selectedBatch.store_id ? storeMap[selectedBatch.store_id] ?? null : null}
          invoiceUrl={
            accountShortId != null && selectedBatch.short_id != null
              ? `${window.location.origin}/invoices/C-${accountShortId}/I-${selectedBatch.short_id}`
              : window.location.href
          }
          onClose={() => {
            setSelectedBatch(null)
            navigate('/invoices', { replace: true })
          }}
        />
      )}
    </div>
  )
}
