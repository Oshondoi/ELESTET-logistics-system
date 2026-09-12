import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import jsPDF from 'jspdf'
import JsBarcode from 'jsbarcode'
import { supabase } from '../lib/supabase'
import { PhotoThumb } from '../components/ui/PhotoThumb'
import { triggerSync as triggerProductSync } from '../services/productService'
import { invokeFbs } from '../services/fbsApi'
import { FbsKizScannerModal } from '../components/fbs/FbsKizScannerModal'
import { FbsStocksPanel } from '../components/fbs/FbsStocksPanel'
import { FbsDispatchReport } from '../components/fbs/FbsDispatchReport'
import { FbsStoreSelect } from '../components/fbs/FbsStoreSelect'
import { FbsWarehouseSelect } from '../components/fbs/FbsWarehouseSelect'
import { fetchFbsWorkContexts } from '../services/fbsAccessService'
import { applyExcelWorksheetStandards } from '../lib/excelStandards'
import { DEFAULT_PERMISSIONS } from '../types'
import type { Product } from '../types'
import type { FbsWorkContext } from '../services/fbsAccessService'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FbsOrder {
  id: string
  rid: string
  createdAt: string
  ddate: string
  warehouseId: number
  officeId: number
  cargoType: number | null
  crossBorderType: number | null
  isB2b: boolean | null
  article: string
  nmId: number
  chrtId: number
  skus: string[]
  price: number
  convertedPrice: number
  currencyCode: number
  // enriched
  photoUrl: string | null
  productBarcode: string | null
  productName: string | null
  productBrand: string | null
  productColor: string | null
  productVendorCode: string | null
  productSize: string | null
  productLocations: ProductLocation[]
  stockAllocation: FbsStockAllocation | null
  shipStatus: TabKey
  supplierStatus: string
  wbSystemStatus: string
  isInLatestSnapshot: boolean
  supply_id: string | null
  acceptedAt: string | null
  requiresKiz: boolean
  kizStatus: 'draft' | 'sent' | 'error' | null
}

interface ProductLocation {
  productBarcode: string
  quantity: number
  physicalQuantity: number
  reservedQuantity: number
  awaitingQuantity: number
  boxItemId: string
  boxId: string
  batchNumber: number
  batchName: string
  supplyNumber: number
  boxNumber: number
  boxBarcode: string
  warehouseName: string | null
  rackName: string | null
  sideName: string | null
  palletAddress: string | null
  slotNumber: number | null
  addressCode: string | null
  addressText: string | null
  isAddressed: boolean
  fbsEligible: boolean
}

interface FbsStockAllocation {
  id: string
  boxItemId: string | null
  boxId: string | null
  productBarcode: string
  quantity: number
  status: 'reserved' | 'awaiting_wb' | 'consumed' | 'released'
  requiresReview: boolean
  reviewReason: string | null
}

function KizStatusBadge({ order }: { order: FbsOrder }) {
  if (order.shipStatus === 'pending' || (!order.requiresKiz && !order.kizStatus)) return null
  const sent = order.kizStatus === 'sent'
  const title = sent
    ? 'КИЗ привязан к заказу в Wildberries'
    : 'КИЗ не привязан к заказу в Wildberries'
  return (
    <div className="mt-1 flex">
      <span
        title={title}
        aria-label={title}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold leading-none ${sent
          ? 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-300'
          : 'bg-slate-200 text-slate-500 ring-1 ring-inset ring-slate-300'}`}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" /></svg>
        КИЗ
      </span>
    </div>
  )
}

interface WbWarehouse {
  id: number
  name: string
  officeId?: number
}

interface WbOffice {
  id: number
  name: string
  address?: string
  city?: string
}

interface FbsInternalWarehouse {
  id: string
  name: string
  wb_warehouse_id: string | null
}

const ALL_WAREHOUSES_FILTER = 'all'
const QUICK_SYNC_MAX_AGE_MS = 15 * 60_000
const ACTIVE_FAST_SYNC_MAX_AGE_MS = 30_000
const OPTIMISTIC_SUPPLY_TRANSITION_TTL_MS = 10 * 60_000

interface WbSupply {
  id: string
  name: string
  ordersCount?: number
  done?: boolean
  createdAt?: string
  closedAt?: string | null
  scanDt?: string | null
  destinationOfficeId?: number | null
  cargoType?: number | null
  crossBorderType?: number | null
  isB2b?: boolean | null
  availableOnWb?: boolean
}

interface OptimisticOrderSupply {
  supplyId: string
  expiresAt: number
}

interface OptimisticCreatedSupply {
  supply: WbSupply
  expiresAt: number
}

function wbSupplyFromDbRow(row: any, optimisticName?: string): WbSupply {
  const supplyId = String(row.wb_supply_id)
  const dbName = String(row.name ?? '').trim()
  return {
    id: supplyId,
    name: (dbName && dbName !== supplyId ? dbName : optimisticName?.trim()) || dbName || supplyId,
    ordersCount: row.raw_data?.ordersCount,
    done: row.done === true,
    createdAt: row.wb_created_at,
    closedAt: row.wb_closed_at ?? null,
    scanDt: row.wb_scan_at ?? null,
    destinationOfficeId: row.destination_office_id ?? row.raw_data?.destinationOfficeId ?? null,
    cargoType: row.cargo_type ?? row.raw_data?.cargoType ?? null,
    crossBorderType: row.cross_border_type ?? row.raw_data?.crossBorderType ?? null,
    isB2b: row.is_b2b ?? row.raw_data?.isB2b ?? null,
    availableOnWb: row.available_on_wb !== false,
  }
}

interface AssembleFailure {
  orderId: string
  kind: string
  message: string
}

interface AssembleResultModal {
  title: string
  message: string
  failures: AssembleFailure[]
}

interface SupplyDispatchModal {
  supply: WbSupply
  orders: FbsOrder[]
  destination: 'pvz' | 'warehouse' | null
  boxes: string[]
  amount: string
  loading: boolean
  busy: boolean
  error: string | null
}

interface FbsArchiveReport {
  id: string
  account_id: string
  store_id: string
  period_from: string
  period_to: string
  rows_count: number
  order_ids: string[]
  status: 'ready' | 'failed'
  created_at: string
  expires_at: string
}

interface StickerPrintOptions {
  supply: boolean
  picking: boolean
  locations: boolean
  productBarcode: boolean
  wb: boolean
}

interface StickerPrintModal {
  orders: FbsOrder[]
  supply: WbSupply | null
  mode: 'selected' | 'supply'
  options: StickerPrintOptions
}

interface StickerPageImage {
  data: string
  format: 'JPEG' | 'PNG'
  alias?: string
}

const STICKER_PRINT_OPTIONS_KEY = 'elestet_fbs_sticker_print_options_v1'

function loadStickerPrintOptions(accountId: string): StickerPrintOptions {
  const defaults: StickerPrintOptions = { supply: true, picking: true, locations: true, productBarcode: true, wb: true }
  try {
    const saved = JSON.parse(localStorage.getItem(`${STICKER_PRINT_OPTIONS_KEY}:${accountId}`) || '{}') as Partial<StickerPrintOptions>
    return (Object.keys(defaults) as Array<keyof StickerPrintOptions>).reduce((options, key) => {
      options[key] = typeof saved[key] === 'boolean' ? saved[key] : defaults[key]
      return options
    }, { ...defaults })
  } catch {
    return defaults
  }
}

function saveStickerPrintOptions(accountId: string, options: StickerPrintOptions) {
  try {
    localStorage.setItem(`${STICKER_PRINT_OPTIONS_KEY}:${accountId}`, JSON.stringify(options))
  } catch {
    // Печать продолжит работать и при запрещённом браузером localStorage.
  }
}

interface PickingListRow {
  orderId: string
  photoUrl: string | null
  photoDataUrl: string | null
  brand: string
  name: string
  size: string
  color: string
  vendorCode: string
  sticker: string
  barcode: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ProductSizeData = { chrtID?: number; chrtId?: number; techSize?: string; skus?: string[] }
type ProductPhotoData = { c246x328?: string; big?: string }

function normalizeSkus(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((sku) => sku.trim()).filter(Boolean)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(String).map((sku) => sku.trim()).filter(Boolean)
  } catch {
    // Some legacy rows may contain one plain barcode instead of a JSON array.
  }
  return [value.trim()]
}

function productPhotoUrl(product: Product | undefined): string | null {
  const photos = Array.isArray(product?.photos) ? product.photos as ProductPhotoData[] : []
  return photos[0]?.c246x328 ?? photos[0]?.big ?? null
}

function fbsOrderBarcode(order: Pick<FbsOrder, 'skus'>): string | null {
  return order.skus.find(Boolean) ?? null
}

function productSizeByBarcode(product: Product | undefined, barcode: string | null, orderChrtId?: number): string | null {
  if (!product || !barcode) return null
  const sizes = Array.isArray(product.sizes) ? product.sizes as ProductSizeData[] : []
  const matchingSize = sizes.find((size) => size.skus?.includes(barcode))
  if (!matchingSize) return null
  const productChrtId = matchingSize.chrtID ?? matchingSize.chrtId
  if (orderChrtId && productChrtId && Number(productChrtId) !== Number(orderChrtId)) return null
  return matchingSize.techSize?.trim() || null
}

function productStockTotals(locations: ProductLocation[]) {
  return locations.reduce((totals, location) => ({
    available: totals.available + (location.fbsEligible ? location.quantity : 0),
    unassigned: totals.unassigned + (location.fbsEligible ? 0 : location.quantity),
    reserved: totals.reserved + location.reservedQuantity,
    awaiting: totals.awaiting + location.awaitingQuantity,
  }), { available: 0, unassigned: 0, reserved: 0, awaiting: 0 })
}

function FbsStockQuantityCell({ order }: { order: FbsOrder }) {
  if (order.productLocations.length === 0) return <span className="text-slate-400">—</span>
  const totals = productStockTotals(order.productLocations)
  const bound = totals.reserved + totals.awaiting
  return (
    <div className="whitespace-nowrap text-right">
      <div className="font-semibold text-slate-900">{totals.available} в коробах</div>
      {totals.unassigned > 0 && <div className="mt-0.5 text-[11px] font-medium text-amber-600">{totals.unassigned} без FBS-склада</div>}
      {bound > 0 && <div className="mt-0.5 text-[11px] font-medium text-violet-600">{bound} привязано к заказам</div>}
    </div>
  )
}

function OrderIdentityCell({ order }: { order: FbsOrder }) {
  const barcode = order.productBarcode
  return (
    <div className="space-y-0.5 whitespace-nowrap">
      <div className="flex items-baseline gap-1.5">
        <span className="w-12 shrink-0 text-[11px] text-slate-400">Заказ №</span>
        <span className="font-semibold text-slate-900">{order.id}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="w-12 shrink-0 text-[11px] text-slate-400">Арт. WB</span>
        <a
          href={`https://www.wildberries.ru/catalog/${order.nmId}/detail.aspx`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-blue-600 hover:underline"
        >
          {order.nmId}
        </a>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="w-12 shrink-0 text-[11px] text-slate-400">Баркод</span>
        <span className={`font-mono text-[11px] ${barcode ? 'text-slate-500' : 'text-amber-500'}`}>
          {barcode || 'Не получен'}
        </span>
      </div>
    </div>
  )
}

function productLocationAddress(location: ProductLocation): string | null {
  if (!location.isAddressed) return null
  const place = location.palletAddress && location.slotNumber
    ? `${location.palletAddress}-K${location.slotNumber}`
    : null
  const parts = [location.warehouseName, location.rackName, location.sideName, place].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : location.addressCode
}

function ProductLocationsCell({ order }: { order: FbsOrder }) {
  const barcode = order.productBarcode
  const locations = order.productLocations

  if (!barcode) {
    return (
      <div>
        <div className="font-semibold text-amber-500">Адрес не найден</div>
        <div className="mt-0.5 text-[11px] text-slate-400">Нет баркода для поиска на складе</div>
      </div>
    )
  }

  if (locations.length === 0) {
    return (
      <div>
        <div className="font-semibold text-amber-500">Не найден</div>
        <div className="mt-0.5 text-[11px] text-slate-500">Товара нет ни в одном коробе</div>
      </div>
    )
  }

  const renderLocation = (location: ProductLocation) => {
    const isSelected = order.stockAllocation?.boxItemId === location.boxItemId
      && ['reserved', 'awaiting_wb'].includes(order.stockAllocation.status)
    return (
    <div key={`${location.boxBarcode}-${location.productBarcode}`} className="min-w-0 py-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <div className={`truncate font-semibold ${location.isAddressed ? 'text-violet-700' : 'text-amber-500'}`} title={productLocationAddress(location) ?? 'Короб ещё не размещён в WMS'}>
          {productLocationAddress(location) ?? 'Без адреса'}
        </div>
        {isSelected && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${order.stockAllocation?.status === 'awaiting_wb' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {order.stockAllocation?.status === 'awaiting_wb' ? 'ЖДЁТ WB' : 'ВЫБРАН'}
          </span>
        )}
        {!location.fbsEligible && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">БЕЗ FBS-СКЛАДА</span>
        )}
      </div>
      <div className="truncate text-[11px] text-slate-500" title={`P-${location.batchNumber} · S-${location.supplyNumber} · Короб ${location.boxNumber} · ${location.quantity} шт.`}>
        P-{location.batchNumber} · S-{location.supplyNumber} · Короб {location.boxNumber} · {location.quantity} шт.
      </div>
    </div>
    )
  }

  const selectedBoxItemId = ['reserved', 'awaiting_wb'].includes(order.stockAllocation?.status ?? '')
    ? order.stockAllocation?.boxItemId
    : null
  const orderedLocations = selectedBoxItemId
    ? [...locations].sort((left, right) => Number(right.boxItemId === selectedBoxItemId) - Number(left.boxItemId === selectedBoxItemId))
    : locations
  const visibleLocations = orderedLocations.slice(0, 2)
  const hiddenLocations = orderedLocations.slice(2)

  return (
    <div>
      {visibleLocations.map(renderLocation)}
      {hiddenLocations.length > 0 && (
        <div className="mt-0.5 text-[11px] font-semibold text-violet-600">
          Ещё {hiddenLocations.length} {boxCountWord(hiddenLocations.length)}
        </div>
      )}
    </div>
  )
}

function slaLabel(
  ddate: string,
  createdAt?: string,
  acceptedAt?: string | null,
  isAcceptedByWb = false,
): { text: string; cls: string } {
  const hoursAndMinutes = (milliseconds: number) => {
    const totalMinutes = Math.max(0, Math.floor(Math.abs(milliseconds) / 60000))
    return `${Math.floor(totalMinutes / 60)}ч ${totalMinutes % 60}мин`
  }
  // После официального scanDt поставки показываем зафиксированное время
  // от создания заказа до приёмки WB. Оно больше не растёт каждый день.
  if (acceptedAt && createdAt) {
    const elapsed = new Date(acceptedAt).getTime() - new Date(createdAt).getTime()
    if (!isNaN(elapsed) && elapsed >= 0) {
      const h = Math.floor(elapsed / 3600000)
      const cls = h >= 48 ? 'text-red-500 font-semibold' : h >= 24 ? 'text-amber-500' : 'text-slate-500'
      return { text: hoursAndMinutes(elapsed), cls }
    }
  }
  // Статус уже подтверждает приёмку, но точного scanDt нет: не выдаём
  // постоянно растущий возраст заказа за время доставки.
  if (isAcceptedByWb) return { text: '—', cls: 'text-slate-400' }
  // Если есть ddate — показываем остаток/просрочку
  if (ddate) {
    const diff = new Date(ddate).getTime() - Date.now()
    if (!isNaN(diff)) {
      if (diff < 0) {
        return { text: `${hoursAndMinutes(diff)} назад`, cls: 'text-red-600 font-bold' }
      }
      const h = Math.floor(diff / 3600000)
      if (h < 8) return { text: hoursAndMinutes(diff), cls: 'text-red-500 font-semibold' }
      if (h < 24) return { text: hoursAndMinutes(diff), cls: 'text-amber-500 font-semibold' }
      return { text: hoursAndMinutes(diff), cls: 'text-slate-600' }
    }
  }
  // Fallback: время с момента создания заказа
  if (createdAt) {
    const elapsed = Date.now() - new Date(createdAt).getTime()
    if (!isNaN(elapsed) && elapsed > 0) {
      const h = Math.floor(elapsed / 3600000)
      const cls = h >= 48 ? 'text-red-500 font-semibold' : h >= 24 ? 'text-amber-500' : 'text-slate-500'
      return { text: `${hoursAndMinutes(elapsed)} назад`, cls }
    }
  }
  return { text: '—', cls: 'text-slate-400' }
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function staleDataMessage(lastSyncedAt: Date | null) {
  const suffix = lastSyncedAt
    ? `Последняя успешная синхронизация: ${lastSyncedAt.toLocaleString('ru-RU')}.`
    : 'Успешной синхронизации ещё не было.'
  return `Не удалось полностью обновить данные WB. Показаны последние сохранённые данные. ${suffix}`
}

async function imageUrlToPngDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const bitmap = await createImageBitmap(await response.blob())
    const canvas = document.createElement('canvas')
    canvas.width = 120
    canvas.height = 120
    const context = canvas.getContext('2d')
    if (!context) return null
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
    bitmap.close()
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

const STICKER_WIDTH_PX = 580
const STICKER_HEIGHT_PX = 400

function createStickerCanvas(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = STICKER_WIDTH_PX
  canvas.height = STICKER_HEIGHT_PX
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Браузер не поддерживает генерацию стикеров')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, STICKER_WIDTH_PX, STICKER_HEIGHT_PX)
  context.fillStyle = '#000000'
  context.textBaseline = 'top'
  return { canvas, context }
}

function textStickerPage(canvas: HTMLCanvasElement): StickerPageImage {
  return { data: canvas.toDataURL('image/jpeg', 0.94), format: 'JPEG' }
}

function losslessStickerPage(canvas: HTMLCanvasElement, alias?: string): StickerPageImage {
  return { data: canvas.toDataURL('image/png'), format: 'PNG', alias }
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 2,
  align: CanvasTextAlign = 'left',
): number {
  const words = String(text || '—').trim().split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
      if (lines.length === maxLines - 1) break
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  context.textAlign = align
  lines.forEach((value, index) => context.fillText(value, x, y + index * lineHeight, maxWidth))
  context.textAlign = 'left'
  return y + lines.length * lineHeight
}

function wrappedLineCount(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2,
): number {
  const words = String(text || '—').trim().split(/\s+/)
  let lines = 0
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate
    } else {
      lines += 1
      line = word
      if (lines === maxLines - 1) break
    }
  }
  if (line && lines < maxLines) lines += 1
  return lines
}

function stickerVariantKey(order: FbsOrder): string {
  return `${fbsOrderBarcode(order) ?? ''}|${order.chrtId || ''}|${order.nmId}`
}

function stickerPageCount(modal: StickerPrintModal): number {
  const variants = new Map<string, FbsOrder>()
  modal.orders.forEach((order) => {
    const key = stickerVariantKey(order)
    if (!variants.has(key)) variants.set(key, order)
  })
  const articleCount = variants.size
  return (modal.options.supply ? 1 : 0)
    + (modal.options.picking ? articleCount : 0)
    + (modal.options.locations ? articleCount : 0)
    + (modal.options.productBarcode ? modal.orders.length : 0)
    + (modal.options.wb ? modal.orders.length : 0)
}

function printableProductLocations(order: FbsOrder): ProductLocation[] {
  const unique = new Map<string, ProductLocation>()
  for (const location of order.productLocations) {
    const key = `${location.boxBarcode}|${location.addressCode ?? ''}|${location.slotNumber ?? ''}`
    if (!unique.has(key)) unique.set(key, location)
  }
  return [...unique.values()]
}

function boxCountWord(count: number): string {
  const lastTwoDigits = count % 100
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return 'коробов'
  const lastDigit = count % 10
  if (lastDigit === 1) return 'короб'
  if (lastDigit >= 2 && lastDigit <= 4) return 'короба'
  return 'коробов'
}

function formatStickerDate(value?: string, supplyName?: string): string {
  if (value) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString('ru-RU')
  }
  const dateInName = supplyName?.match(/\b\d{2}\.\d{2}\.\d{4}\b/)?.[0]
  return dateInName || new Date().toLocaleDateString('ru-RU')
}

function buildSupplySticker(supply: WbSupply, orders: FbsOrder[], articleCount: number): StickerPageImage {
  const { canvas, context } = createStickerCanvas()
  const date = formatStickerDate(supply.createdAt, supply.name)
  context.font = '700 30px Arial, sans-serif'
  context.fillText(date, 28, 24)
  context.font = '400 28px Arial, sans-serif'
  context.fillText('Поставка:', 28, 84)
  context.font = '700 30px Arial, sans-serif'
  let y = drawWrappedText(context, supply.name, 28, 120, 524, 34, 2)
  context.font = '400 28px Arial, sans-serif'
  y += 28
  context.fillText('Товаров итого:', 28, y)
  context.font = '700 30px Arial, sans-serif'
  context.fillText(String(orders.length), 238, y)
  y += 54
  context.font = '400 28px Arial, sans-serif'
  context.fillText('Артикулов итого:', 28, y)
  context.font = '700 30px Arial, sans-serif'
  context.fillText(String(articleCount), 270, y)
  return textStickerPage(canvas)
}

function buildPickingSticker(order: FbsOrder, quantity: number): StickerPageImage {
  const { canvas, context } = createStickerCanvas()
  context.font = '700 38px Arial, sans-serif'
  context.fillText(`${quantity} шт.`, 24, 18)
  context.font = '700 24px Arial, sans-serif'
  let y = drawWrappedText(context, order.productName || `Товар WB ${order.nmId}`, 24, 70, 532, 28, 2)
  context.font = '400 21px Arial, sans-serif'
  context.fillText('Бренд:', 24, y + 4)
  context.font = '700 21px Arial, sans-serif'
  context.fillText(order.productBrand || '—', 100, y + 4)
  y += 30
  context.font = '400 21px Arial, sans-serif'
  context.fillText('Цвет:', 24, y + 4)
  context.font = '700 21px Arial, sans-serif'
  context.fillText(order.productColor || '—', 90, y + 4)
  y += 30
  context.font = '400 21px Arial, sans-serif'
  context.fillText('Размер:', 24, y + 4)
  context.font = '700 21px Arial, sans-serif'
  context.fillText(order.productSize || '—', 108, y + 4)
  y += 40
  context.font = '400 21px Arial, sans-serif'
  context.fillText('Артикул WB:', 24, y)
  context.font = '700 21px Arial, sans-serif'
  context.fillText(String(order.nmId), 158, y)
  y += 30
  context.font = '400 21px Arial, sans-serif'
  context.fillText('Баркод:', 24, y)
  context.font = '700 21px Arial, sans-serif'
  context.fillText(fbsOrderBarcode(order) || '—', 112, y)
  y += 30
  context.font = '400 21px Arial, sans-serif'
  context.fillText('Артикул:', 24, y)
  context.font = '700 21px Arial, sans-serif'
  drawWrappedText(context, order.productVendorCode || order.article || '—', 24, y + 27, 532, 25, 2)
  return textStickerPage(canvas)
}

function buildLocationStickers(order: FbsOrder): StickerPageImage[] {
  const selectedBoxItemId = ['reserved', 'awaiting_wb'].includes(order.stockAllocation?.status ?? '')
    ? order.stockAllocation?.boxItemId
    : null
  const locations = selectedBoxItemId
    ? printableProductLocations(order).sort((left, right) => Number(right.boxItemId === selectedBoxItemId) - Number(left.boxItemId === selectedBoxItemId))
    : printableProductLocations(order)
  const { canvas, context } = createStickerCanvas()
  context.font = '700 34px Arial, sans-serif'
  context.fillText('Адрес товара', 24, 18)

  if (locations.length === 0) {
    context.font = '700 28px Arial, sans-serif'
    context.fillText('Не найден на складе', 24, 82)
    return [textStickerPage(canvas)]
  }

  let y = 66
  let rendered = 0
  const bottomLimit = STICKER_HEIGHT_PX - 24
  for (const [index, location] of locations.entries()) {
    const address = productLocationAddress(location)
    let estimatedHeight = 12
    if (address) {
      context.font = '700 28px Arial, sans-serif'
      estimatedHeight += wrappedLineCount(context, address, 532, 2) * 32 + 5
    }
    context.font = '400 22px Arial, sans-serif'
    const details = `P-${location.batchNumber} · S-${location.supplyNumber} · Короб ${location.boxNumber} · ${location.quantity} шт.`
    estimatedHeight += wrappedLineCount(context, details, 532, 2) * 26
    const footerReserve = index < locations.length - 1 ? 34 : 0
    if (y + estimatedHeight + footerReserve > bottomLimit) break

    if (address) {
      context.font = '700 28px Arial, sans-serif'
      y = drawWrappedText(context, address, 24, y, 532, 32, 2) + 5
    }
    context.font = '400 22px Arial, sans-serif'
    y = drawWrappedText(
      context,
      details,
      24,
      y,
      532,
      26,
      2,
    ) + 12
    rendered += 1
  }

  const remainingBoxes = locations.length - rendered
  if (remainingBoxes > 0) {
    context.font = '700 25px Arial, sans-serif'
    context.fillText(`Ещё ${remainingBoxes} ${boxCountWord(remainingBoxes)}`, 24, Math.min(y + 2, bottomLimit - 30))
  }
  return [textStickerPage(canvas)]
}

function buildProductBarcodeSticker(order: FbsOrder, sellerName: string): StickerPageImage {
  const barcode = fbsOrderBarcode(order)
  if (!barcode) throw new Error(`У заказа ${order.id} отсутствует товарный баркод`)
  const { canvas, context } = createStickerCanvas()
  const barcodeCanvas = document.createElement('canvas')
  try {
    JsBarcode(barcodeCanvas, barcode, {
      format: /^\d{13}$/.test(barcode) ? 'EAN13' : 'CODE128',
      width: 2.2,
      height: 72,
      displayValue: true,
      font: 'Arial',
      fontSize: 18,
      margin: 0,
    })
  } catch {
    JsBarcode(barcodeCanvas, barcode, { format: 'CODE128', width: 2, height: 72, displayValue: true, font: 'Arial', fontSize: 18, margin: 0 })
  }
  const barcodeWidth = Math.min(520, barcodeCanvas.width)
  const barcodeHeight = Math.min(112, barcodeCanvas.height * (barcodeWidth / barcodeCanvas.width))
  context.drawImage(barcodeCanvas, (STICKER_WIDTH_PX - barcodeWidth) / 2, 12, barcodeWidth, barcodeHeight)
  let y = 130
  context.font = '400 20px Arial, sans-serif'
  y = drawWrappedText(context, sellerName || 'Продавец Wildberries', STICKER_WIDTH_PX / 2, y, 530, 23, 2, 'center')
  y += 3
  context.font = '700 23px Arial, sans-serif'
  y = drawWrappedText(context, order.productName || `Товар WB ${order.nmId}`, STICKER_WIDTH_PX / 2, y, 530, 27, 2, 'center')
  context.font = '400 20px Arial, sans-serif'
  context.textAlign = 'center'
  context.fillText(`Бренд: ${order.productBrand || '—'}`, STICKER_WIDTH_PX / 2, y + 3)
  context.fillText(`Цвет: ${order.productColor || '—'}`, STICKER_WIDTH_PX / 2, y + 29)
  context.fillText(`Размер: ${order.productSize || '—'}`, STICKER_WIDTH_PX / 2, y + 55)
  context.fillText('Артикул:', STICKER_WIDTH_PX / 2, y + 85)
  context.font = '700 20px Arial, sans-serif'
  context.fillText(order.productVendorCode || order.article || '—', STICKER_WIDTH_PX / 2, y + 111)
  context.textAlign = 'left'
  return losslessStickerPage(canvas, `product-barcode-${stickerVariantKey(order)}`)
}

// ─── FbsOrdersPage ────────────────────────────────────────────────────────────

type TabKey = 'pending' | 'assembling' | 'delivering' | 'completed' | 'cancelled' | 'archive'

function isFinalFbsOrder(order: Pick<FbsOrder, 'supplierStatus' | 'wbSystemStatus'>): boolean {
  return order.supplierStatus === 'cancel'
    || ['sold', 'canceled', 'canceled_by_client', 'declined_by_client', 'defect'].includes(order.wbSystemStatus)
}

const WB_ACCEPTED_ORDER_STATUSES = new Set([
  'sorted', 'ready_for_pickup', 'postponed_delivery', 'accepted_by_carrier',
  'sent_to_carrier', 'sold', 'canceled_by_client', 'defect',
])

function formatSupplyTimestamp(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function acceptedSupplyOrdersCount(orders: FbsOrder[]): number {
  return orders.filter((order) => WB_ACCEPTED_ORDER_STATUSES.has(order.wbSystemStatus)).length
}

function SupplyWbStatus({ supply }: { supply: WbSupply }) {
  const closedAt = formatSupplyTimestamp(supply.closedAt)

  if (supply.done !== true) {
    return (
      <span
        title="Поставка ещё открыта в Wildberries. QR поставки становится доступен после передачи в доставку."
        className="whitespace-nowrap rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
      >
        На сборке
      </span>
    )
  }

  if (!formatSupplyTimestamp(supply.scanDt)) {
    return (
      <span
        title={`Поставка передана в доставку${closedAt ? ` ${closedAt}` : ''}, но Wildberries ещё не вернул время сканирования QR. Закрытие поставки не означает её приёмку.`}
        className="whitespace-nowrap rounded-lg bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700"
      >
        Ожидает сканирования
      </span>
    )
  }

  return (
    <span
      title="WB отсканировал QR поставки и начал её обработку. Поштучная приёмка считается отдельно по статусам заказов."
      className="whitespace-nowrap rounded-lg bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700"
    >
      Поставка в обработке
    </span>
  )
}

function isOfficialCompletedOrder(order: Pick<FbsOrder, 'wbSystemStatus' | 'createdAt'>): boolean {
  if (order.wbSystemStatus !== 'sold') return false
  const createdAt = new Date(order.createdAt)
  if (Number.isNaN(createdAt.getTime())) return true
  const retentionStart = new Date()
  retentionStart.setMonth(retentionStart.getMonth() - 3)
  return createdAt >= retentionStart
}

function isOfficialCancelledOrder(order: Pick<FbsOrder, 'supplierStatus' | 'wbSystemStatus' | 'createdAt'>): boolean {
  const cancelled = order.supplierStatus === 'cancel'
    || ['canceled', 'canceled_by_client', 'declined_by_client', 'defect'].includes(order.wbSystemStatus)
  if (!cancelled) return false
  const createdAt = new Date(order.createdAt)
  if (Number.isNaN(createdAt.getTime())) return true
  const retentionStart = new Date()
  retentionStart.setMonth(retentionStart.getMonth() - 3)
  return createdAt >= retentionStart
}

function isArchiveEligibleOrder(order: Pick<FbsOrder, 'supplierStatus' | 'wbSystemStatus' | 'createdAt'>): boolean {
  if (!isFinalFbsOrder(order)) return false
  const createdAt = new Date(order.createdAt)
  if (Number.isNaN(createdAt.getTime())) return false
  const retentionStart = new Date()
  retentionStart.setMonth(retentionStart.getMonth() - 3)
  return createdAt < retentionStart
}

function completedOrderStatusLabel(order: Pick<FbsOrder, 'supplierStatus' | 'wbSystemStatus'>): string {
  if (order.wbSystemStatus === 'sold') return 'Товар выкуплен'
  if (order.wbSystemStatus === 'canceled_by_client') return 'Покупатель отказался'
  if (order.wbSystemStatus === 'declined_by_client') return 'Отменено покупателем'
  if (order.wbSystemStatus === 'defect') return 'Найдены дефекты'
  if (order.supplierStatus === 'cancel' || order.wbSystemStatus === 'canceled') return 'Отменено'
  return 'Завершено'
}

const WB_ORDER_STATUS_VIEW: Record<string, { label: string; className: string; description: string }> = {
  waiting: {
    label: 'Ожидает приёмки WB',
    className: 'bg-amber-100 text-amber-700',
    description: 'Заказ передан продавцом, но Wildberries ещё не завершил приёмку.',
  },
  sorted: {
    label: 'Отсортирован',
    className: 'bg-indigo-100 text-indigo-700',
    description: 'Wildberries принял и отсортировал заказ.',
  },
  ready_for_pickup: {
    label: 'Ждёт покупателя',
    className: 'bg-violet-100 text-violet-700',
    description: 'Заказ прибыл в ПВЗ и ожидает покупателя.',
  },
  postponed_delivery: {
    label: 'Доставка отложена',
    className: 'bg-amber-100 text-amber-700',
    description: 'Курьерская доставка заказа перенесена.',
  },
  accepted_by_carrier: {
    label: 'Принят перевозчиком',
    className: 'bg-sky-100 text-sky-700',
    description: 'Заказ принят службой доставки в стране продавца.',
  },
  sent_to_carrier: {
    label: 'Отправлен перевозчику',
    className: 'bg-blue-100 text-blue-700',
    description: 'Заказ направляется на склад службы доставки в стране продавца.',
  },
  sold: {
    label: 'Товар выкуплен',
    className: 'bg-emerald-100 text-emerald-700',
    description: 'Покупатель получил заказ.',
  },
  canceled: {
    label: 'Отменён',
    className: 'bg-orange-100 text-orange-700',
    description: 'Заказ отменён.',
  },
  canceled_by_client: {
    label: 'Покупатель отказался',
    className: 'bg-orange-100 text-orange-700',
    description: 'Покупатель отказался от заказа при получении.',
  },
  declined_by_client: {
    label: 'Отменён покупателем',
    className: 'bg-orange-100 text-orange-700',
    description: 'Покупатель отменил заказ в первый час.',
  },
  defect: {
    label: 'Обнаружен брак',
    className: 'bg-rose-100 text-rose-700',
    description: 'Заказ отменён по причине брака.',
  },
}

function WbOrderStatusBadge({ order }: { order: Pick<FbsOrder, 'supplierStatus' | 'wbSystemStatus'> }) {
  const status = order.wbSystemStatus || 'unknown'
  const view = WB_ORDER_STATUS_VIEW[status] ?? {
    label: `Статус WB: ${status}`,
    className: 'bg-slate-100 text-slate-600',
    description: 'Wildberries вернул новый статус, которого ещё нет в справочнике интерфейса.',
  }
  return (
    <span
      title={`${view.description} supplierStatus: ${order.supplierStatus}; wbStatus: ${status}`}
      className={`inline-flex whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold ${view.className}`}
    >
      {view.label}
    </span>
  )
}

function tabForOfficialWbStatus(
  supplierStatus: string,
  wbSystemStatus: string,
  isInLatestSnapshot: boolean,
): TabKey {
  if (supplierStatus === 'new' && wbSystemStatus === 'waiting') return 'pending'
  if (supplierStatus === 'confirm' && wbSystemStatus === 'waiting') return 'assembling'
  if (supplierStatus === 'cancel'
    || ['canceled', 'canceled_by_client', 'declined_by_client', 'defect'].includes(wbSystemStatus)) return 'cancelled'
  if (wbSystemStatus === 'sold') return 'completed'
  if (isInLatestSnapshot && supplierStatus === 'complete') return 'delivering'
  return 'archive'
}

function reconcileOptimisticOrderSupply(
  orderId: string,
  supplierStatus: string,
  wbSystemStatus: string,
  isInLatestSnapshot: boolean,
  supplyId: string | null,
  pendingTransitions: Map<string, OptimisticOrderSupply>,
) {
  const pending = pendingTransitions.get(orderId)
  if (!pending) return { supplierStatus, wbSystemStatus, isInLatestSnapshot, supplyId }

  const dbTab = tabForOfficialWbStatus(supplierStatus, wbSystemStatus, isInLatestSnapshot)
  const transitionExpired = pending.expiresAt <= Date.now()
  const orderIsFinal = dbTab === 'completed' || dbTab === 'cancelled'
  const membershipConfirmed = supplyId === pending.supplyId
    && (supplierStatus === 'confirm' || supplierStatus === 'complete')

  if (transitionExpired || orderIsFinal) {
    pendingTransitions.delete(orderId)
    return { supplierStatus, wbSystemStatus, isInLatestSnapshot, supplyId }
  }

  // Подтверждённую строку БД показываем как есть, но короткое время храним
  // защиту: запоздавшее realtime-событие могло быть создано раньше неё.
  if (membershipConfirmed) return { supplierStatus, wbSystemStatus, isInLatestSnapshot, supplyId }

  // WB и наша БД обновляют статус заказа и состав поставки не атомарно.
  // Пока обе части не подтвердились, сохраняем уже подтверждённое пользователю
  // действие и не показываем временную строку «Без поставки».
  return {
    supplierStatus: 'confirm',
    wbSystemStatus: 'waiting',
    isInLatestSnapshot: true,
    supplyId: pending.supplyId,
  }
}

interface Props {
  accountId: string
}

export function FbsOrdersPage({ accountId }: Props) {
  const lsKey = `fbs_store_${accountId}`
  const companyLsKey = `fbs_company_${accountId}`
  const tabLsKey = `fbs_tab_${accountId}`
  // localStorage хранит только настройки интерфейса. Статусы заказов всегда приходят из WB.

  const [workContexts, setWorkContexts] = useState<FbsWorkContext[]>([])
  const [workContextsLoading, setWorkContextsLoading] = useState(true)
  const [workContextsError, setWorkContextsError] = useState<string | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState(() => localStorage.getItem(companyLsKey) || accountId)
  const [selectedStoreId, setSelectedStoreId] = useState(() => localStorage.getItem(lsKey) || '')
  const selectedContext = useMemo(
    () => workContexts.find((context) => context.company_id === selectedCompanyId) ?? null,
    [selectedCompanyId, workContexts],
  )
  const storesWithKey = selectedContext?.stores ?? []
  const workingAccountId = selectedContext?.company_id ?? accountId
  const fbsPermissions = selectedContext?.permissions ?? DEFAULT_PERMISSIONS
  const canManageStocks = fbsPermissions.fbs_stocks_manage
  const [orders, setOrders] = useState<FbsOrder[]>([])
  const [wbWarehouses, setWbWarehouses] = useState<WbWarehouse[]>([])
  const [wbOffices, setWbOffices] = useState<WbOffice[]>([])
  const [wbDirectoryStoreId, setWbDirectoryStoreId] = useState<string | null>(null)
  const [internalWarehouses, setInternalWarehouses] = useState<FbsInternalWarehouse[]>([])
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState(ALL_WAREHOUSES_FILTER)
  const [pageSection, setPageSection] = useState<'orders' | 'stocks' | 'dispatches'>(() => {
    const savedSection = localStorage.getItem(`fbs_section_${accountId}`)
    return savedSection === 'stocks' || savedSection === 'dispatches' ? savedSection : 'orders'
  })
  const [quickSyncLoading, setQuickSyncLoading] = useState(false)
  const [fullSyncLoading, setFullSyncLoading] = useState(false)
  const [fastSyncV2Enabled, setFastSyncV2Enabled] = useState<boolean | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const saved = localStorage.getItem(tabLsKey)
    return (['pending','assembling','delivering','completed','cancelled','archive'].includes(saved ?? '') ? saved : 'pending') as TabKey
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedSupplyIds, setSelectedSupplyIds] = useState<Set<string>>(new Set())
  const [groupCompletedBySupplies, setGroupCompletedBySupplies] = useState(false)
  const [archiveReports, setArchiveReports] = useState<FbsArchiveReport[]>([])
  const [archivePeriodFrom, setArchivePeriodFrom] = useState(() => {
    const date = new Date()
    date.setFullYear(date.getFullYear() - 1)
    return date.toISOString().slice(0, 10)
  })
  const [archivePeriodTo, setArchivePeriodTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [supplyQrBusyIds, setSupplyQrBusyIds] = useState<Set<string>>(new Set())
  const [acceptanceActBusyIds, setAcceptanceActBusyIds] = useState<Set<string>>(new Set())
  const [copiedSupplyId, setCopiedSupplyId] = useState<string | null>(null)
  const [assembleModal, setAssembleModal] = useState<{ ids: string[]; mode: 'assemble' | 'move'; sourceSupplyIds: string[] } | null>(null)
  const [assembleResultModal, setAssembleResultModal] = useState<AssembleResultModal | null>(null)
  const [assembleTab, setAssembleTab] = useState<'new' | 'existing'>('new')
  const [newSupplyName, setNewSupplyName] = useState('')
  const [openSupplies, setOpenSupplies] = useState<WbSupply[]>([])
  const [closedSupplies, setClosedSupplies] = useState<WbSupply[]>([])
  const currentSupplyOrderCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const order of orders) {
      if (!order.isInLatestSnapshot || !order.supply_id) continue
      counts.set(order.supply_id, (counts.get(order.supply_id) ?? 0) + 1)
    }
    return counts
  }, [orders])
  const [loadingSupplies, setLoadingSupplies] = useState(false)
  const [deleteSupplyModal, setDeleteSupplyModal] = useState<{
    supply: WbSupply
    busy: boolean
    error: string | null
  } | null>(null)
  const [orderMenuId, setOrderMenuId] = useState<string | null>(null)
  const [expandedSupplyIds, setExpandedSupplyIds] = useState<Set<string>>(new Set())
  const [pickingListMenuOpen, setPickingListMenuOpen] = useState(false)
  const [stickerPrintModal, setStickerPrintModal] = useState<StickerPrintModal | null>(null)
  const [syncingProducts, setSyncingProducts] = useState(false)
  const [productSyncNotice, setProductSyncNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [kizScannerOpen, setKizScannerOpen] = useState(false)
  const [boxSelectionOrder, setBoxSelectionOrder] = useState<FbsOrder | null>(null)
  const [boxSelectionMode, setBoxSelectionMode] = useState<'bind' | 'return'>('bind')
  const [boxSelectionBusy, setBoxSelectionBusy] = useState(false)
  const [boxScanValue, setBoxScanValue] = useState('')
  const [dispatchModal, setDispatchModal] = useState<SupplyDispatchModal | null>(null)
  const syncInFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  const copiedSupplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualQuickRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingManualQuickRetryStoreRef = useRef<string | null>(null)
  const dbReadGenerationRef = useRef(0)
  const pageMountedRef = useRef(true)
  const selectedStoreIdRef = useRef(selectedStoreId)
  const lastSyncedAtRef = useRef<Date | null>(null)
  const ordersRef = useRef<FbsOrder[]>([])
  const optimisticSupplyNamesRef = useRef<Map<string, string>>(new Map())
  const optimisticOrderSuppliesRef = useRef<Map<string, OptimisticOrderSupply>>(new Map())
  const optimisticCreatedSuppliesRef = useRef<Map<string, OptimisticCreatedSupply>>(new Map())
  selectedStoreIdRef.current = selectedStoreId
  ordersRef.current = orders

  useEffect(() => {
    setPickingListMenuOpen(false)
  }, [selected])

  useEffect(() => {
    pageMountedRef.current = true
    return () => {
      pageMountedRef.current = false
      if (copiedSupplyTimerRef.current) clearTimeout(copiedSupplyTimerRef.current)
      if (manualQuickRetryTimerRef.current) clearTimeout(manualQuickRetryTimerRef.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    optimisticSupplyNamesRef.current.clear()
    optimisticOrderSuppliesRef.current.clear()
    optimisticCreatedSuppliesRef.current.clear()
    setFastSyncV2Enabled(null)
    setWorkContextsLoading(true)
    setWorkContextsError(null)
    void fetchFbsWorkContexts(accountId)
      .then((contexts) => {
        if (cancelled) return
        setWorkContexts(contexts)
        const savedCompanyId = localStorage.getItem(`fbs_company_${accountId}`)
        const nextContext = contexts.find((context) => context.company_id === savedCompanyId)
          ?? contexts.find((context) => context.company_id === accountId)
          ?? contexts[0]
          ?? null
        const nextCompanyId = nextContext?.company_id ?? ''
        setSelectedCompanyId(nextCompanyId)
        if (nextCompanyId) localStorage.setItem(`fbs_company_${accountId}`, nextCompanyId)
        const savedStoreId = savedCompanyId ? localStorage.getItem(`fbs_store_${accountId}`) : null
        setSelectedStoreId(savedStoreId && nextContext?.stores.some((store) => store.id === savedStoreId) ? savedStoreId : '')
        if (!savedStoreId || !nextContext?.stores.some((store) => store.id === savedStoreId)) {
          localStorage.removeItem(`fbs_store_${accountId}`)
        }
      })
      .catch((contextError) => {
        if (cancelled) return
        setWorkContexts([])
        setSelectedStoreId('')
        setWorkContextsError(contextError instanceof Error ? contextError.message : 'Не удалось загрузить доступ FBS')
      })
      .finally(() => {
        if (!cancelled) setWorkContextsLoading(false)
      })
    return () => { cancelled = true }
  }, [accountId])

  const copySupplyId = useCallback(async (supplyId: string) => {
    try {
      await navigator.clipboard.writeText(supplyId)
      if (copiedSupplyTimerRef.current) clearTimeout(copiedSupplyTimerRef.current)
      setCopiedSupplyId(supplyId)
      copiedSupplyTimerRef.current = setTimeout(() => {
        setCopiedSupplyId(null)
        copiedSupplyTimerRef.current = null
      }, 1600)
    } catch {
      setError('Не удалось скопировать QR-код поставки. Разрешите сайту доступ к буферу обмена и повторите попытку.')
    }
  }, [])

  useEffect(() => {
    if (!selectedStoreId) {
      setSelectedWarehouseFilter(ALL_WAREHOUSES_FILTER)
      return
    }
    try {
      setSelectedWarehouseFilter(
        localStorage.getItem(`fbs_warehouse_filter_${accountId}_${selectedStoreId}`) || ALL_WAREHOUSES_FILTER,
      )
    } catch {
      setSelectedWarehouseFilter(ALL_WAREHOUSES_FILTER)
    }
    setSelected(new Set())
    setSelectedSupplyIds(new Set())
    setSyncNotice(null)
    setDispatchModal(null)
    pendingManualQuickRetryStoreRef.current = null
    if (manualQuickRetryTimerRef.current) {
      clearTimeout(manualQuickRetryTimerRef.current)
      manualQuickRetryTimerRef.current = null
    }
  }, [accountId, selectedStoreId])

  useEffect(() => {
    if (!selectedStoreId) {
      setFastSyncV2Enabled(null)
      return
    }
    const storeId = selectedStoreId
    let cancelled = false
    setFastSyncV2Enabled(null)
    void invokeFbs(storeId, { action: 'get_fbs_sync_mode' })
      .then((result) => {
        if (!cancelled && selectedStoreIdRef.current === storeId) {
          setFastSyncV2Enabled(result.fast_sync_v2_enabled === true)
        }
      })
      .catch(() => {
        if (!cancelled && selectedStoreIdRef.current === storeId) setFastSyncV2Enabled(false)
      })
    return () => { cancelled = true }
  }, [selectedStoreId])

  useEffect(() => {
    if (!supabase || !workingAccountId) return
    let cancelled = false
    setInternalWarehouses([])
    void (supabase as any)
      .from('wms_warehouses')
      .select('id,name,wb_warehouse_id')
      .eq('account_id', workingAccountId)
      .eq('fbs_enabled', true)
      .then(({ data }: { data: FbsInternalWarehouse[] | null }) => {
        if (cancelled) return
        setInternalWarehouses(data ?? [])
      })
    return () => { cancelled = true }
  }, [workingAccountId])

  // Склад продавца и связанный официальный пункт приёмки FBS загружаются одним запросом.
  useEffect(() => {
    if (!selectedStoreId) return
    let cancelled = false
    setWbDirectoryStoreId(null)
    setWbWarehouses([])
    setWbOffices([])
    void invokeFbs(selectedStoreId, { action: 'get_wb_warehouse_directory' })
      .then((data) => {
        if (cancelled) return
        setWbWarehouses((data.warehouses ?? []) as WbWarehouse[])
        setWbOffices((data.offices ?? []) as WbOffice[])
        setWbDirectoryStoreId(selectedStoreId)
      })
      .catch(() => {
        if (cancelled) return
        setWbWarehouses([])
        setWbOffices([])
        setWbDirectoryStoreId(selectedStoreId)
      })
    return () => { cancelled = true }
  }, [selectedStoreId])

  useEffect(() => {
    if (
      !selectedStoreId
      || wbDirectoryStoreId !== selectedStoreId
      || selectedWarehouseFilter === ALL_WAREHOUSES_FILTER
      || wbWarehouses.some((warehouse) => String(warehouse.id) === selectedWarehouseFilter)
    ) return
    setSelectedWarehouseFilter(ALL_WAREHOUSES_FILTER)
    try {
      localStorage.setItem(`fbs_warehouse_filter_${accountId}_${selectedStoreId}`, ALL_WAREHOUSES_FILTER)
    } catch {
      // Filtering remains available without persistence.
    }
  }, [accountId, selectedStoreId, selectedWarehouseFilter, wbDirectoryStoreId, wbWarehouses])

  const orderMatchesWarehouseFilter = useCallback((order: FbsOrder) => (
    selectedWarehouseFilter === ALL_WAREHOUSES_FILTER
    || String(order.warehouseId) === selectedWarehouseFilter
  ), [selectedWarehouseFilter])

  const loadArchiveReports = useCallback(async () => {
    if (!supabase || !selectedStoreId) return
    const now = new Date().toISOString()
    await (supabase as any)
      .from('fbs_archive_reports')
      .delete()
      .eq('store_id', selectedStoreId)
      .lt('expires_at', now)
    const { data, error: reportsError } = await (supabase as any)
      .from('fbs_archive_reports')
      .select('*')
      .eq('store_id', selectedStoreId)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
    if (reportsError) throw reportsError
    setArchiveReports((data ?? []) as FbsArchiveReport[])
  }, [selectedStoreId])

  useEffect(() => {
    if (activeTab !== 'archive') return
    void loadArchiveReports().catch((reportError) => {
      setArchiveNotice(`Не удалось загрузить архивные отчёты: ${String(reportError)}`)
    })
  }, [activeTab, loadArchiveReports])

  const enrichWithCells = useCallback(async (rawOrders: FbsOrder[]): Promise<FbsOrder[]> => {
    if (!supabase || rawOrders.length === 0) return rawOrders
    const nmIds = [...new Set(rawOrders.map((order) => order.nmId).filter(Boolean))]
    const { data: productRows } = nmIds.length > 0
      ? await (supabase as any)
        .from('products')
        .select('id, account_id, store_id, nm_id, cost_price, vendor_code, name, brand, category, color, composition, country, barcodes, photos, sizes, raw_data, synced_at, created_at')
        .eq('store_id', selectedStoreId)
        .in('nm_id', nmIds)
      : { data: [] }
    const productByNmId = new Map<number, Product>((productRows ?? []).map((product: Product) => [product.nm_id, product]))
    const productEnriched = rawOrders.map((order) => {
      const product = productByNmId.get(order.nmId)
      const barcode = fbsOrderBarcode(order)
      return {
        ...order,
        photoUrl: productPhotoUrl(product),
        productBarcode: barcode,
        productName: product?.name?.trim() || null,
        productBrand: product?.brand?.trim() || null,
        productColor: product?.color?.trim() || null,
        productVendorCode: product?.vendor_code?.trim() || order.article?.trim() || null,
        productSize: productSizeByBarcode(product, barcode, order.chrtId),
      }
    })

    const allBarcodes = [...new Set(productEnriched.flatMap((order) => order.productBarcode ? [order.productBarcode] : order.skus))]
    if (allBarcodes.length === 0) return productEnriched
    const { data: locationRows, error: locationError } = await (supabase as any).rpc('get_fbs_product_locations', {
      p_account_id: workingAccountId,
      p_barcodes: allBarcodes,
    })
    if (locationError) throw locationError
    const locationsByBarcode = new Map<string, ProductLocation[]>()
    for (const row of (locationRows ?? [])) {
      const barcode = String(row.product_barcode ?? '')
      if (!barcode) continue
      const location: ProductLocation = {
        productBarcode: barcode,
        quantity: Number(row.quantity ?? 0),
        physicalQuantity: Number(row.physical_quantity ?? row.quantity ?? 0),
        reservedQuantity: Number(row.reserved_quantity ?? 0),
        awaitingQuantity: Number(row.awaiting_quantity ?? 0),
        boxItemId: String(row.box_item_id ?? ''),
        boxId: String(row.box_id ?? ''),
        batchNumber: Number(row.batch_number ?? 0),
        batchName: String(row.batch_name ?? ''),
        supplyNumber: Number(row.supply_number ?? 0),
        boxNumber: Number(row.box_number ?? 0),
        boxBarcode: String(row.box_barcode ?? ''),
        warehouseName: row.warehouse_name ?? null,
        rackName: row.rack_name ?? null,
        sideName: row.side_name ?? null,
        palletAddress: row.pallet_address ?? null,
        slotNumber: row.slot_number == null ? null : Number(row.slot_number),
        addressCode: row.address_code ?? null,
        addressText: row.address_text ?? null,
        isAddressed: row.is_addressed === true,
        fbsEligible: row.fbs_eligible === true,
      }
      locationsByBarcode.set(barcode, [...(locationsByBarcode.get(barcode) ?? []), location])
    }
    return productEnriched.map((order) => ({
      ...order,
      productLocations: (order.productBarcode ? locationsByBarcode.get(order.productBarcode) : undefined)
        ?? order.skus.flatMap((sku) => locationsByBarcode.get(sku) ?? []),
    }))
  }, [selectedStoreId, workingAccountId])

  // Читаем заказы из fbs_orders (Supabase DB)
  const readFromDb = useCallback(async () => {
    if (!supabase || !selectedStoreId) return
    const storeId = selectedStoreId
    const readGeneration = ++dbReadGenerationRef.current
    const rows: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data: pageRows, error: pageError } = await (supabase as any)
        .from('fbs_orders')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .range(from, from + 999)
      if (pageError) throw pageError
      rows.push(...(pageRows ?? []))
      if ((pageRows ?? []).length < 1000) break
    }

    const { data: allocationRows, error: allocationError } = await (supabase as any)
      .from('fbs_stock_allocations')
      .select('id, wb_order_id, box_item_id, box_id, product_barcode, quantity, status, requires_review, review_reason')
      .eq('store_id', storeId)
    if (allocationError && allocationError.code !== '42P01') throw allocationError
    const allocationByOrderId = new Map<string, FbsStockAllocation>((allocationRows ?? []).map((row: any) => [String(row.wb_order_id), {
      id: String(row.id),
      boxItemId: row.box_item_id ? String(row.box_item_id) : null,
      boxId: row.box_id ? String(row.box_id) : null,
      productBarcode: String(row.product_barcode ?? ''),
      quantity: Number(row.quantity ?? 1),
      status: row.status as FbsStockAllocation['status'],
      requiresReview: row.requires_review === true,
      reviewReason: row.review_reason ? String(row.review_reason) : null,
    }]))

    const exactAcceptanceRows: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data: pageRows, error: pageError } = await (supabase as any)
        .from('fbs_dispatch_attempts')
        .select('wb_order_id,wb_supply_id,accepted_at,is_current_membership,updated_at')
        .eq('store_id', storeId)
        .eq('acceptance_source', 'wb_scan_dt')
        .eq('acceptance_is_estimated', false)
        .not('accepted_at', 'is', null)
        .order('updated_at', { ascending: false })
        .range(from, from + 999)
      if (pageError?.code === '42P01') break
      if (pageError) throw pageError
      exactAcceptanceRows.push(...(pageRows ?? []))
      if ((pageRows ?? []).length < 1000) break
    }
    const acceptanceRowsByOrderId = new Map<string, any[]>()
    for (const acceptanceRow of exactAcceptanceRows) {
      const orderId = String(acceptanceRow.wb_order_id ?? '')
      if (!orderId) continue
      acceptanceRowsByOrderId.set(orderId, [
        ...(acceptanceRowsByOrderId.get(orderId) ?? []),
        acceptanceRow,
      ])
    }

    const { data: kizCatalogRows, error: kizCatalogError } = await (supabase as any)
      .from('fbs_wb_qr_catalog')
      .select('order_id')
      .eq('store_id', storeId)
      .eq('supports_sgtin', true)
    if (kizCatalogError && kizCatalogError.code !== '42P01') throw kizCatalogError
    const kizEligibleOrderIds = new Set((kizCatalogRows ?? []).map((row: any) => String(row.order_id ?? '')))

    const kizStateRows: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data: pageRows, error: pageError } = await (supabase as any)
        .from('fbs_kiz_order_states')
        .select('order_id,requires_kiz,sent_to_wb')
        .eq('store_id', storeId)
        .order('order_id', { ascending: true })
        .range(from, from + 999)
      if (pageError?.code === '42P01') break
      if (pageError) throw pageError
      kizStateRows.push(...(pageRows ?? []))
      if ((pageRows ?? []).length < 1000) break
    }
    const kizStateByOrderId = new Map<string, any>(kizStateRows.map((row: any) => [String(row.order_id ?? ''), row]))

    const mapped: FbsOrder[] = (rows ?? []).map((row: any) => {
      const d = row.data ?? {}
      const orderId = String(row.wb_order_id)
      const reconciledState = reconcileOptimisticOrderSupply(
        orderId,
        String(row.supplier_status ?? row.wb_status ?? ''),
        String(row.wb_system_status ?? ''),
        row.is_in_latest_snapshot !== false,
        row.supply_id == null ? null : String(row.supply_id),
        optimisticOrderSuppliesRef.current,
      )
      const { supplierStatus, wbSystemStatus, isInLatestSnapshot, supplyId } = reconciledState
      const acceptanceRows = acceptanceRowsByOrderId.get(orderId) ?? []
      const acceptanceRow = acceptanceRows.find((candidate: any) => (
        candidate.is_current_membership === true && String(candidate.wb_supply_id) === String(row.supply_id ?? '')
      )) ?? acceptanceRows.find((candidate: any) => String(candidate.wb_supply_id) === String(row.supply_id ?? ''))
        ?? acceptanceRows.find((candidate: any) => candidate.is_current_membership === true)
        ?? acceptanceRows[0]
      return {
        id: orderId,
        rid: d.rid ?? row.rid ?? '',
        createdAt: row.created_at ?? '',
        ddate: row.ddate ?? '',
        warehouseId: row.warehouse_id ?? d.warehouseId ?? 0,
        officeId: d.officeId ?? 0,
        cargoType: d.cargoType == null ? null : Number(d.cargoType),
        crossBorderType: d.crossBorderType == null ? null : Number(d.crossBorderType),
        isB2b: typeof d.options?.isB2B === 'boolean'
          ? d.options.isB2B
          : (typeof d.isB2b === 'boolean' ? d.isB2b : null),
        article: row.article ?? d.article ?? '',
        nmId: row.nm_id ?? d.nmId ?? 0,
        chrtId: row.chrt_id ?? d.chrtId ?? 0,
        skus: (() => {
          const columnSkus = normalizeSkus(row.skus)
          return columnSkus.length > 0 ? columnSkus : normalizeSkus(d.skus)
        })(),
        price: row.price ?? d.price ?? 0,
        convertedPrice: d.convertedPrice ?? 0,
        currencyCode: d.currencyCode ?? 643,
        photoUrl: null,
        productBarcode: null,
        productName: null,
        productBrand: null,
        productColor: null,
        productVendorCode: null,
        productSize: null,
        productLocations: [],
        stockAllocation: allocationByOrderId.get(String(row.wb_order_id)) ?? null,
        shipStatus: tabForOfficialWbStatus(supplierStatus, wbSystemStatus, isInLatestSnapshot),
        supplierStatus,
        wbSystemStatus,
        isInLatestSnapshot,
        supply_id: supplyId,
        acceptedAt: acceptanceRow?.accepted_at ?? null,
        requiresKiz: kizStateByOrderId.get(orderId)?.requires_kiz === true
          || kizEligibleOrderIds.has(orderId)
          || (Array.isArray(d.requiredMeta) && d.requiredMeta.includes('sgtin'))
          || (Array.isArray(d.optionalMeta) && d.optionalMeta.includes('sgtin')),
        kizStatus: kizStateByOrderId.get(orderId)?.sent_to_wb === true ? 'sent' : null,
      } as FbsOrder
    })
    const enriched = await enrichWithCells(mapped)

    // Проверяем sync log
    const { data: syncLog } = await (supabase as any)
      .from('fbs_sync_log')
      .select('last_synced_at,error')
      .eq('store_id', storeId)
      .single()
    const successfulSync = syncLog?.last_synced_at ? new Date(syncLog.last_synced_at) : null
    // Несколько realtime/ручных перечитываний могут идти одновременно.
    // Только самое новое из них имеет право менять экран.
    if (selectedStoreIdRef.current !== storeId || dbReadGenerationRef.current !== readGeneration) return enriched
    setOrders(enriched)
    lastSyncedAtRef.current = successfulSync
    setLastSyncedAt(successfulSync)
    setError(syncLog?.error ? staleDataMessage(successfulSync) : null)
    return enriched
  }, [selectedStoreId, enrichWithCells])

  useEffect(() => {
    if (!supabase || !selectedStoreId) return
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => { void readFromDb() }, 120)
    }
    const applyOrderChange = (payload: any) => {
      if (!fastSyncV2Enabled || payload.eventType !== 'UPDATE') {
        scheduleRefresh()
        return
      }
      const row = payload.new ?? {}
      const orderId = String(row.wb_order_id ?? '')
      if (!orderId || !ordersRef.current.some((order) => order.id === orderId)) {
        scheduleRefresh()
        return
      }
      const supplierStatus = String(row.supplier_status ?? row.wb_status ?? '')
      const wbSystemStatus = String(row.wb_system_status ?? '')
      const isInLatestSnapshot = row.is_in_latest_snapshot !== false
      const reconciledState = reconcileOptimisticOrderSupply(
        orderId,
        supplierStatus,
        wbSystemStatus,
        isInLatestSnapshot,
        row.supply_id == null ? null : String(row.supply_id),
        optimisticOrderSuppliesRef.current,
      )
      setOrders((previous) => previous.map((order) => order.id === orderId ? {
        ...order,
        supplierStatus: reconciledState.supplierStatus,
        wbSystemStatus: reconciledState.wbSystemStatus,
        isInLatestSnapshot: reconciledState.isInLatestSnapshot,
        supply_id: reconciledState.supplyId,
        shipStatus: tabForOfficialWbStatus(
          reconciledState.supplierStatus,
          reconciledState.wbSystemStatus,
          reconciledState.isInLatestSnapshot,
        ),
      } : order))
      const syncedAt = row.synced_at ? new Date(row.synced_at) : null
      if (syncedAt && Number.isFinite(syncedAt.getTime())) {
        lastSyncedAtRef.current = syncedAt
        setLastSyncedAt(syncedAt)
      }
    }
    const channel = (supabase as any)
      .channel(`fbs-stock:${selectedStoreId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'fbs_orders', filter: `store_id=eq.${selectedStoreId}`,
      }, applyOrderChange)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'fbs_dispatch_attempts', filter: `store_id=eq.${selectedStoreId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'fbs_stock_allocations', filter: `store_id=eq.${selectedStoreId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'fulfillment_box_items', filter: `account_id=eq.${workingAccountId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'fbs_marking_pairs', filter: `store_id=eq.${selectedStoreId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'fbs_wb_qr_catalog', filter: `store_id=eq.${selectedStoreId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'fbs_kiz_order_states', filter: `store_id=eq.${selectedStoreId}`,
      }, scheduleRefresh)
      .subscribe()
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      void (supabase as any).removeChannel(channel)
    }
  }, [fastSyncV2Enabled, selectedStoreId, readFromDb, workingAccountId])

  const loadOpenSupplies = useCallback(async () => {
    if (!supabase || !selectedStoreId) return
    const storeId = selectedStoreId
    const data: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data: pageRows, error: suppliesError } = await (supabase as any)
        .from('fbs_supplies')
        .select('wb_supply_id,name,done,wb_created_at,wb_closed_at,wb_scan_at,destination_office_id,cargo_type,cross_border_type,is_b2b,available_on_wb,raw_data')
        .eq('store_id', storeId)
        .eq('done', false)
        .eq('available_on_wb', true)
        .order('wb_created_at', { ascending: false })
        .range(from, from + 999)
      if (suppliesError) throw suppliesError
      data.push(...(pageRows ?? []))
      if ((pageRows ?? []).length < 1000) break
    }
    if (selectedStoreIdRef.current !== storeId) return
    const supplies = data.map((row) => {
      const supplyId = String(row.wb_supply_id)
      const dbName = String(row.name ?? '').trim()
      const supply = wbSupplyFromDbRow(row, optimisticSupplyNamesRef.current.get(supplyId))
      if (dbName && dbName !== supplyId) optimisticSupplyNamesRef.current.delete(supplyId)
      return supply
    })
    const now = Date.now()
    for (const [supplyId, optimistic] of optimisticCreatedSuppliesRef.current.entries()) {
      if (optimistic.expiresAt <= now) {
        optimisticCreatedSuppliesRef.current.delete(supplyId)
      } else if (!supplies.some((supply) => supply.id === supplyId)) {
        supplies.unshift(optimistic.supply)
      }
    }
    setOpenSupplies(supplies)
  }, [selectedStoreId])

  const loadClosedSupplies = useCallback(async () => {
    if (!supabase || !selectedStoreId) return
    const storeId = selectedStoreId
    const data: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data: pageRows, error: suppliesError } = await (supabase as any)
        .from('fbs_supplies')
        .select('wb_supply_id,name,done,wb_created_at,wb_closed_at,wb_scan_at,destination_office_id,cargo_type,cross_border_type,is_b2b,available_on_wb,raw_data')
        .eq('store_id', storeId)
        .eq('done', true)
        .order('wb_closed_at', { ascending: false })
        .range(from, from + 999)
      if (suppliesError) throw suppliesError
      data.push(...(pageRows ?? []))
      if ((pageRows ?? []).length < 1000) break
    }
    if (selectedStoreIdRef.current !== storeId) return
    setClosedSupplies(data.map((row) => {
      const supplyId = String(row.wb_supply_id)
      const dbName = String(row.name ?? '').trim()
      const supply = wbSupplyFromDbRow(row, optimisticSupplyNamesRef.current.get(supplyId))
      if (dbName && dbName !== supplyId) optimisticSupplyNamesRef.current.delete(supplyId)
      return supply
    }))
  }, [selectedStoreId])

  useEffect(() => {
    if (!supabase || !selectedStoreId) return
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleSupplyRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        void Promise.all([loadOpenSupplies(), loadClosedSupplies()])
      }, 120)
    }
    const applySupplyChange = (payload: any) => {
      if (!fastSyncV2Enabled) {
        scheduleSupplyRefresh()
        return
      }
      const row = payload.new ?? payload.old ?? {}
      const supplyId = String(row.wb_supply_id ?? '')
      if (!supplyId) {
        scheduleSupplyRefresh()
        return
      }
      if (payload.eventType === 'DELETE') {
        optimisticCreatedSuppliesRef.current.delete(supplyId)
        optimisticSupplyNamesRef.current.delete(supplyId)
        setOpenSupplies((previous) => previous.filter((supply) => supply.id !== supplyId))
        setClosedSupplies((previous) => previous.filter((supply) => supply.id !== supplyId))
        return
      }
      const dbName = String(row.name ?? '').trim()
      const supply = wbSupplyFromDbRow(row, optimisticSupplyNamesRef.current.get(supplyId))
      if (supply.availableOnWb === false && !supply.done) {
        optimisticCreatedSuppliesRef.current.delete(supplyId)
        setOpenSupplies((previous) => previous.filter((item) => item.id !== supplyId))
        return
      }
      if (dbName && dbName !== supplyId) optimisticSupplyNamesRef.current.delete(supplyId)
      const upsert = (previous: WbSupply[]) => [supply, ...previous.filter((item) => item.id !== supply.id)]
      if (supply.done) {
        setOpenSupplies((previous) => previous.filter((item) => item.id !== supply.id))
        setClosedSupplies(upsert)
      } else {
        setClosedSupplies((previous) => previous.filter((item) => item.id !== supply.id))
        setOpenSupplies(upsert)
      }
    }
    const channel = (supabase as any)
      .channel(`fbs-supplies:${selectedStoreId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'fbs_supplies', filter: `store_id=eq.${selectedStoreId}`,
      }, applySupplyChange)
      .subscribe()
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      void (supabase as any).removeChannel(channel)
    }
  }, [fastSyncV2Enabled, selectedStoreId, loadOpenSupplies, loadClosedSupplies])

  const waitForServerSyncJob = useCallback(async (storeId: string, jobId: string) => {
    if (!supabase) return null
    const deadline = Date.now() + 150_000
    while (Date.now() < deadline && selectedStoreIdRef.current === storeId) {
      const { data: job, error: jobError } = await (supabase as any)
        .from('fbs_sync_jobs')
        .select('status,result_counts,error')
        .eq('store_id', storeId)
        .eq('id', jobId)
        .maybeSingle()
      if (jobError) throw jobError
      if (job?.status === 'completed') {
        return { ...(job.result_counts ?? {}), reused: true, job_id: jobId }
      }
      if (job?.status === 'failed') throw new Error(String(job.error || 'Синхронизация завершилась с ошибкой'))
      if (job?.status === 'skipped') return { ...(job.result_counts ?? {}), reused: true, job_id: jobId }
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }
    return null
  }, [])

  // Синк с WB → upsert в fbs_orders → перечитываем из DB
  const doSync = useCallback((
    mode: 'incremental' | 'full' = 'incremental',
    triggerSource: 'manual' | 'automatic' = 'manual',
  ): Promise<void> => {
    if (!selectedStoreId) return Promise.resolve()
    if (mode === 'full' && !fbsPermissions.fbs_full_sync) {
      setError('У вас нет права на полную сверку с WB.')
      return Promise.resolve()
    }
    if (mode === 'incremental' && !fbsPermissions.fbs_sync) {
      if (triggerSource === 'manual') setError('У вас нет права на быстрое обновление FBS.')
      return Promise.resolve()
    }
    const storeId = selectedStoreId
    const useFastOrdersLane = mode === 'incremental' && fastSyncV2Enabled
    const syncKey = useFastOrdersLane ? `${storeId}:fast-orders` : `${storeId}:legacy`
    const existingSync = syncInFlightRef.current.get(syncKey)
    if (existingSync && mode === 'incremental') return existingSync

    const showBlockingLoader = triggerSource === 'manual'
    const runSync = async () => {
      if (showBlockingLoader) {
        if (mode === 'full') setFullSyncLoading(true)
        else setQuickSyncLoading(true)
      }
      setError(null)
      if (mode === 'full') setSyncNotice('Полная сверка с Wildberries запущена. Загружаем заказы и поставки...')
      try {
        if (useFastOrdersLane) {
          // Поставки обновляются независимо и никогда не удерживают кнопку.
          // Realtime применит их по строкам, а перечитывание страхует браузеры,
          // в которых событие подписки пришло раньше завершения запроса.
          void invokeFbs(storeId, { action: 'sync_supplies_fast', trigger_source: triggerSource })
            .then((supplyResult) => supplyResult.fallback === true
              ? undefined
              : Promise.all([loadOpenSupplies(), loadClosedSupplies()]))
            .catch((supplyError) => {
              console.warn('Фоновое обновление поставок FBS не завершено:', supplyError)
            })

          const fastResult = await invokeFbs(storeId, {
            action: 'sync_orders_fast',
            trigger_source: triggerSource,
          })
          if (fastResult.fallback !== true) {
            // Один актуальный снимок БД. Проверка КИЗ и повторное чтение в
            // быстрый путь не входят и не задерживают пользователя.
            await readFromDb()
            if (selectedStoreIdRef.current !== storeId) return
            const serverSyncTime = typeof fastResult.last_synced_at === 'string'
              ? new Date(fastResult.last_synced_at)
              : null
            if (fastResult.partial === true) {
              setError(staleDataMessage(serverSyncTime ?? lastSyncedAtRef.current))
            } else if (serverSyncTime && Number.isFinite(serverSyncTime.getTime())) {
              lastSyncedAtRef.current = serverSyncTime
              setLastSyncedAt(serverSyncTime)
            }
            return
          }
          // Если флаг отключили между открытием страницы и нажатием кнопки,
          // безопасно продолжаем по неизменённому legacy-пути.
          setFastSyncV2Enabled(false)
        }

        let result = await invokeFbs(storeId, { action: 'sync_orders', mode, trigger_source: triggerSource })
        if (result.reused === true && result.throttled !== true && result.job_id && typeof result.synced !== 'number') {
          const completedResult = await waitForServerSyncJob(storeId, String(result.job_id))
          if (completedResult) result = completedResult
        }
        // Заказы и поставки должны появиться на экране сразу после основного
        // синка; проверка КИЗ не должна задерживать переходы между вкладками.
        await Promise.all([readFromDb(), loadOpenSupplies(), loadClosedSupplies()])
        try {
          await invokeFbs(storeId, {
            action: 'get_kiz_order_states',
            only_missing: mode === 'incremental',
            force: triggerSource === 'manual',
          })
          await readFromDb()
        } catch (kizVerificationError) {
          console.warn('Не удалось обновить подтверждение КИЗ из WB:', kizVerificationError)
        }
        if (selectedStoreIdRef.current !== storeId) return
        const serverSyncTime = typeof result.last_synced_at === 'string' ? new Date(result.last_synced_at) : null
        if (result.partial === true) {
          setError(staleDataMessage(serverSyncTime ?? lastSyncedAtRef.current))
        } else {
          const successfulSync = serverSyncTime ?? new Date()
          lastSyncedAtRef.current = successfulSync
          setLastSyncedAt(successfulSync)
        }
        if (mode === 'full') {
          if (result.reused === true && typeof result.synced !== 'number') {
            setSyncNotice('Синхронизация магазина ещё выполняется. Экран обновится автоматически после её завершения.')
          } else if (result.partial === true) {
            setSyncNotice('Заказы обновлены, но Wildberries не вернул состав части поставок. Сохранённые данные не удалены; повторите полную сверку позже.')
          } else {
            const supplyResult = result.supplies as Record<string, unknown> | undefined
            const supplyCount = Number(supplyResult?.received_supplies ?? 0)
            const membershipCount = Number(supplyResult?.memberships ?? 0)
            setSyncNotice(`Полная сверка завершена: ${Number(result.synced ?? 0)} заказов, ${supplyCount} поставок, ${membershipCount} связей с заказами.`)
          }
        }
      } catch (syncError) {
        setError(mode === 'full'
          ? `Полная сверка не завершена: ${syncError instanceof Error ? syncError.message : String(syncError)} Старые корректные данные сохранены.`
          : staleDataMessage(lastSyncedAtRef.current))
        if (mode === 'full') setSyncNotice(null)
      } finally {
        if (showBlockingLoader && selectedStoreIdRef.current === storeId) {
          if (mode === 'full') setFullSyncLoading(false)
          else setQuickSyncLoading(false)
        }
      }
    }
    const syncPromise = existingSync && mode === 'full'
      ? existingSync.catch(() => undefined).then(runSync)
      : runSync()

    syncInFlightRef.current.set(syncKey, syncPromise)
    void syncPromise.finally(() => {
      if (syncInFlightRef.current.get(syncKey) === syncPromise) syncInFlightRef.current.delete(syncKey)
    })
    return syncPromise
  }, [fastSyncV2Enabled, fbsPermissions.fbs_full_sync, fbsPermissions.fbs_sync, selectedStoreId, readFromDb, loadOpenSupplies, loadClosedSupplies, waitForServerSyncJob])

  const clearManualQuickRetry = useCallback(() => {
    if (manualQuickRetryTimerRef.current) clearTimeout(manualQuickRetryTimerRef.current)
    manualQuickRetryTimerRef.current = null
    pendingManualQuickRetryStoreRef.current = null
  }, [])

  const handleManualQuickSync = useCallback(async () => {
    if (!selectedStoreId || !fbsPermissions.fbs_sync) return
    const storeId = selectedStoreId
    clearManualQuickRetry()
    await doSync('incremental', 'manual')
    if (!pageMountedRef.current || selectedStoreIdRef.current !== storeId) return
    // В v2 актуальность поддерживает короткий независимый order-lane.
    // Старый повтор через минуту остаётся только у магазинов на legacy.
    if (fastSyncV2Enabled) return
    manualQuickRetryTimerRef.current = setTimeout(() => {
      manualQuickRetryTimerRef.current = null
      if (selectedStoreIdRef.current !== storeId) return
      if (document.visibilityState === 'hidden') {
        pendingManualQuickRetryStoreRef.current = storeId
        return
      }
      void doSync('incremental', 'automatic')
    }, 60_000)
  }, [clearManualQuickRetry, doSync, fastSyncV2Enabled, fbsPermissions.fbs_sync, selectedStoreId])

  const handleFullSync = useCallback(() => {
    clearManualQuickRetry()
    return doSync('full', 'manual')
  }, [clearManualQuickRetry, doSync])

  const handleProductSync = async () => {
    if (!selectedStoreId || syncingProducts) return
    setSyncingProducts(true)
    setProductSyncNotice(null)
    try {
      await triggerProductSync(selectedStoreId)
      const refreshedOrders = await readFromDb()
      const missingCount = (refreshedOrders ?? []).filter((order) => order.shipStatus === activeTab && !order.productSize).length
      setProductSyncNotice(missingCount === 0
        ? { kind: 'success', text: 'Товары синхронизированы. Размеры заказов обновлены.' }
        : { kind: 'error', text: `Синхронизация завершена, но размер не найден у ${missingCount} заказов. Проверьте их карточки на Wildberries.` })
    } catch (syncError) {
      setProductSyncNotice({
        kind: 'error',
        text: syncError instanceof Error ? syncError.message : 'Не удалось синхронизировать товары',
      })
    } finally {
      setSyncingProducts(false)
    }
  }

  // На fast-v2 открытая вкладка проверяет активные статусы примерно раз в
  // 30 секунд. Legacy-магазины сохраняют прежний интервал 15 минут.
  useEffect(() => {
    if (!selectedStoreId || fastSyncV2Enabled === null) return
    const storeId = selectedStoreId
    let cancelled = false
    const syncIfStale = () => {
      if (cancelled || selectedStoreIdRef.current !== storeId || document.visibilityState === 'hidden') return
      const previousSync = lastSyncedAtRef.current
      const maxAge = fastSyncV2Enabled ? ACTIVE_FAST_SYNC_MAX_AGE_MS : QUICK_SYNC_MAX_AGE_MS
      const stale = !previousSync || (Date.now() - previousSync.getTime()) >= maxAge
      if (stale) void doSync('incremental', 'automatic')
    }

    void Promise.all([
      readFromDb(),
      loadOpenSupplies().catch(() => { if (selectedStoreIdRef.current === storeId) setOpenSupplies([]) }),
      loadClosedSupplies().catch(() => { if (selectedStoreIdRef.current === storeId) setClosedSupplies([]) }),
    ])
      .then(() => {
        if (cancelled || selectedStoreIdRef.current !== storeId) return
        const previousSync = lastSyncedAtRef.current
        const maxAge = fastSyncV2Enabled ? ACTIVE_FAST_SYNC_MAX_AGE_MS : QUICK_SYNC_MAX_AGE_MS
        const stale = !previousSync || (Date.now() - previousSync.getTime()) >= maxAge
        if (stale) void doSync('incremental', 'automatic')
      })
      .catch(() => setError(staleDataMessage(lastSyncedAtRef.current)))

    const timer = window.setInterval(syncIfStale, 30_000)
    let visibleRefreshTimer: ReturnType<typeof setTimeout> | null = null
    const refreshAfterReturn = () => {
      if (visibleRefreshTimer) clearTimeout(visibleRefreshTimer)
      visibleRefreshTimer = setTimeout(() => {
        visibleRefreshTimer = null
        if (cancelled || selectedStoreIdRef.current !== storeId || document.visibilityState === 'hidden') return
        void Promise.all([
          readFromDb(),
          loadOpenSupplies(),
          loadClosedSupplies(),
        ]).then(() => {
          if (cancelled || selectedStoreIdRef.current !== storeId) return
          if (pendingManualQuickRetryStoreRef.current === storeId) {
            pendingManualQuickRetryStoreRef.current = null
            void doSync('incremental', 'automatic')
            return
          }
          syncIfStale()
        }).catch(() => setError(staleDataMessage(lastSyncedAtRef.current)))
      }, 80)
    }
    const onFocus = () => refreshAfterReturn()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshAfterReturn()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (visibleRefreshTimer) clearTimeout(visibleRefreshTimer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fastSyncV2Enabled, fbsPermissions.fbs_sync, selectedStoreId, doSync, loadClosedSupplies, loadOpenSupplies, readFromDb])

  const mapRawOrder = useCallback((o: any, status: FbsOrder['shipStatus']): FbsOrder => ({
    id: String(o.id), rid: o.rid ?? '', createdAt: o.createdAt ?? '', ddate: o.ddate ?? '',
    warehouseId: o.warehouseId ?? 0, officeId: o.officeId ?? 0, article: o.article ?? '', nmId: o.nmId ?? 0,
    cargoType: o.cargoType == null ? null : Number(o.cargoType),
    crossBorderType: o.crossBorderType == null ? null : Number(o.crossBorderType),
    isB2b: typeof o.options?.isB2B === 'boolean' ? o.options.isB2B : (typeof o.isB2b === 'boolean' ? o.isB2b : null),
    chrtId: o.chrtId ?? 0, skus: o.skus ?? [], price: o.price ?? 0,
    convertedPrice: o.convertedPrice ?? 0, currencyCode: o.currencyCode ?? 643,
    photoUrl: null, productBarcode: null, productName: null, productBrand: null, productColor: null,
    productVendorCode: null, productSize: null, productLocations: [], shipStatus: status,
    stockAllocation: null,
    supplierStatus: status === 'pending' ? 'new' : status === 'assembling' ? 'confirm' : 'complete',
    wbSystemStatus: 'waiting', isInLatestSnapshot: true, supply_id: null,
    acceptedAt: null,
    requiresKiz: false, kizStatus: null,
  }), [])

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const openAssembleModal = async (
    ids: string[],
    initialTab: 'new' | 'existing' = 'new',
    mode: 'assemble' | 'move' = 'assemble',
    sourceSupplyIds: string[] = [],
  ) => {
    if (!fbsPermissions.fbs_assembly) return
    const date = new Date().toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const storeName = storesWithKey.find((store) => store.id === selectedStoreId)?.name?.trim() || 'Магазин'
    setNewSupplyName(`${storeName} ${date}`)
    setAssembleTab(mode === 'move' ? 'existing' : initialTab)
    setAssembleModal({ ids, mode, sourceSupplyIds })
    setLoadingSupplies(true)
    try {
      await loadOpenSupplies()
    } catch { setOpenSupplies([]) }
    finally { setLoadingSupplies(false) }
  }

  const handleAssemble = async (ids: string[], existingSupplyId?: string) => {
    if (!fbsPermissions.fbs_assembly) return
    const storeId = selectedStoreId
    const operationMode = assembleModal?.mode ?? 'assemble'
    const originalOrders = new Map(ordersRef.current.filter((order) => ids.includes(order.id)).map((order) => [order.id, order]))
    const selectedTargetSupply = existingSupplyId ? openSupplies.find((supply) => supply.id === existingSupplyId) : null
    const selectedOrders = [...originalOrders.values()]
    const incompatibleReasons: string[] = []
    if (new Set(selectedOrders.map((order) => order.warehouseId).filter(Boolean)).size > 1) incompatibleReasons.push('разные склады продавца')
    if (new Set(selectedOrders.map((order) => order.cargoType).filter((value) => value != null && value > 0)).size > 1) incompatibleReasons.push('разные габаритные типы')
    if (new Set(selectedOrders.map((order) => order.crossBorderType).filter((value) => value != null)).size > 1) incompatibleReasons.push('разные кроссбордерные типы')
    if (new Set(selectedOrders.map((order) => order.isB2b).filter((value) => value != null)).size > 1) incompatibleReasons.push('одновременно B2B- и обычные заказы')
    if (incompatibleReasons.length > 0) {
      setAssembleModal(null)
      setAssembleResultModal({
        title: 'Эти заказы нельзя объединить',
        message: `В выборе есть ${incompatibleReasons.join(', ')}. Wildberries требует переносить такие заказы в разные поставки.`,
        failures: ids.map((orderId) => ({ orderId, kind: 'mixed_orders', message: 'Нужна отдельная совместимая поставка.' })),
      })
      return
    }
    let optimisticSupplyId: string | null = null
    setBusyIds((s) => new Set([...s, ...ids]))
    setAssembleModal(null)
    try {
      let supplyId: string
      if (existingSupplyId) {
        supplyId = existingSupplyId
      } else {
        const storeName = storesWithKey.find((store) => store.id === selectedStoreId)?.name?.trim() || 'Магазин'
        const defaultName = `${storeName} ${new Date().toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
        const supplyName = newSupplyName.trim() || defaultName
        const supRes = await invokeFbs(storeId, { action: 'create_supply', name: supplyName })
        supplyId = supRes.id as string
        if (!supplyId) throw new Error('WB не вернул ID поставки')
        if (selectedStoreIdRef.current === storeId) {
          const displayedSupplyName = String(supRes.name ?? supplyName).trim() || supplyName
          optimisticSupplyNamesRef.current.set(supplyId, displayedSupplyName)
          const createdSupply: WbSupply = {
            id: supplyId,
            name: displayedSupplyName,
            ordersCount: 0,
            done: false,
            createdAt: new Date().toISOString(),
            closedAt: null,
            scanDt: null,
          }
          optimisticCreatedSuppliesRef.current.set(supplyId, {
            supply: createdSupply,
            expiresAt: Date.now() + OPTIMISTIC_SUPPLY_TRANSITION_TTL_MS,
          })
          setOpenSupplies((previous) => [createdSupply, ...previous.filter((supply) => supply.id !== supplyId)])
        }
      }
      optimisticSupplyId = supplyId
      const existingSupply = openSupplies.find((supply) => supply.id === supplyId)
      if (existingSupply?.name && existingSupply.name !== supplyId) {
        optimisticSupplyNamesRef.current.set(supplyId, existingSupply.name)
      }
      const transitionExpiresAt = Date.now() + OPTIMISTIC_SUPPLY_TRANSITION_TTL_MS
      ids.forEach((orderId) => optimisticOrderSuppliesRef.current.set(orderId, { supplyId, expiresAt: transitionExpiresAt }))
      if (selectedStoreIdRef.current === storeId) {
        // Проецируем весь переход одним кадром до сетевых запросов. Поэтому
        // новая поставка не успевает отрисоваться пустой рядом с «Без поставки».
        setOrders((previous) => previous.map((order) => ids.includes(order.id)
          ? { ...order, shipStatus: 'assembling' as const, supplierStatus: 'confirm', wbSystemStatus: 'waiting', supply_id: supplyId }
          : order))
      }
      const failures: AssembleFailure[] = []
      for (const orderId of ids) {
        try {
          const res = await invokeFbs(storeId, { action: 'add_order_to_supply', supply_id: supplyId, order_id: orderId })
          if (res.success === false) {
            failures.push({
              orderId,
              kind: String(res.failure?.kind ?? 'wb_rejected'),
              message: String(res.failure?.message ?? 'Wildberries не разрешил перенести заказ в эту поставку.'),
            })
          }
        } catch (requestError) {
          failures.push({
            orderId,
            kind: 'request_failed',
            message: requestError instanceof Error ? requestError.message : 'Не удалось связаться с сервисом. Заказ не перенесён.',
          })
        }
      }
      const failedIds = failures.map((failure) => failure.orderId)
      const successIds = ids.filter((id) => !failedIds.includes(id))
      failedIds.forEach((orderId) => optimisticOrderSuppliesRef.current.delete(orderId))
      if (successIds.length > 0 && selectedStoreIdRef.current === storeId) {
        setOrders((previous) => previous.map((order) => successIds.includes(order.id)
          ? { ...order, shipStatus: 'assembling' as const, supplierStatus: 'confirm', wbSystemStatus: 'waiting', supply_id: supplyId }
          : order))
        setOpenSupplies((previous) => previous.map((supply) => supply.id === supplyId
          ? { ...supply, ordersCount: Math.max(0, Number(supply.ordersCount ?? 0)) + successIds.length }
          : supply))
        setSelected((previous) => {
          const next = new Set(previous)
          successIds.forEach((id) => next.delete(id))
          return next
        })
      }
      if (failedIds.length > 0 && selectedStoreIdRef.current === storeId) {
        setOrders((previous) => previous.map((order) => {
          const originalOrder = originalOrders.get(order.id)
          return originalOrder && failedIds.includes(order.id) ? originalOrder : order
        }))
      }
      // Экран и БД уже получили подтверждённое действие. Фоновая проверка
      // сверяет ответ WB, но не включает ручной загрузчик и не удерживает
      // пользователя в старой вкладке даже при legacy sync.
      void doSync('incremental', 'automatic')
      if (failures.some((failure) => failure.kind === 'supply_not_found')) {
        setOpenSupplies((previous) => previous.filter((supply) => supply.id !== supplyId))
        void loadOpenSupplies()
      }
      if (failures.length > 0) {
        const uniqueMessages = [...new Set(failures.map((failure) => failure.message))]
        const targetName = selectedTargetSupply?.name && selectedTargetSupply.name !== selectedTargetSupply.id
          ? `«${selectedTargetSupply.name}»`
          : `№ ${supplyId}`
        const sourceSupplyIds = [...new Set(failures
          .map((failure) => originalOrders.get(failure.orderId)?.supply_id)
          .filter((sourceId): sourceId is string => Boolean(sourceId)))]
        const sourceNames = sourceSupplyIds.map((sourceId) => {
          const sourceSupply = openSupplies.find((supply) => supply.id === sourceId)
          return sourceSupply?.name && sourceSupply.name !== sourceId ? `«${sourceSupply.name}»` : `№ ${sourceId}`
        })
        const unchangedLocation = sourceNames.length > 0
          ? `Неперенесённые заказы остались в ${sourceNames.length === 1 ? `поставке ${sourceNames[0]}` : 'исходных поставках'}.`
          : 'Неперенесённые заказы остались без поставки.'
        const targetMissing = failures.some((failure) => failure.kind === 'supply_not_found')
        const resultPrefix = successIds.length > 0
          ? `${successIds.length} из ${ids.length} заказов успешно ${operationMode === 'move' ? 'перенесены' : 'добавлены'}. `
          : ''
        setAssembleResultModal({
          title: successIds.length > 0 ? 'Перенос выполнен частично' : (ids.length === 1 ? 'Заказ не перенесён' : 'Заказы не перенесены'),
          message: targetMissing
            ? `${resultPrefix}Поставки ${targetName} больше нет в Wildberries. Она удалена из списка — выберите другую поставку. ${unchangedLocation}`
            : `${resultPrefix}${uniqueMessages.join(' ')} ${unchangedLocation}`,
          failures,
        })
      }
    } catch (e) {
      ids.forEach((orderId) => optimisticOrderSuppliesRef.current.delete(orderId))
      if (optimisticSupplyId && selectedStoreIdRef.current === storeId) {
        setOrders((previous) => previous.map((order) => originalOrders.get(order.id) ?? order))
      }
      setAssembleResultModal({
        title: operationMode === 'move' ? 'Перенос не выполнен' : 'Заказы не добавлены',
        message: e instanceof Error ? e.message : String(e),
        failures: [],
      })
    } finally {
      setBusyIds((s) => { const n = new Set(s); ids.forEach(i => n.delete(i)); return n })
    }
  }

  const reserveOrderFromBox = async (order: FbsOrder, location: ProductLocation) => {
    if (!supabase || boxSelectionBusy || !fbsPermissions.fbs_assembly) return
    setBoxSelectionBusy(true)
    try {
      const { error: reservationError } = await (supabase as any).rpc('reserve_fbs_order_from_box', {
        p_store_id: selectedStoreId,
        p_order_id: order.id,
        p_box_id: location.boxId,
      })
      if (reservationError) throw reservationError
      setBoxSelectionOrder(null)
      setBoxScanValue('')
      await readFromDb()
    } catch (reservationError: any) {
      alert(reservationError?.message || 'Не удалось взять товар из выбранного короба')
    } finally {
      setBoxSelectionBusy(false)
    }
  }

  const receiveOrderIntoBox = async (order: FbsOrder, targetBoxId: string) => {
    if (!supabase || boxSelectionBusy || !fbsPermissions.fbs_assembly) return
    setBoxSelectionBusy(true)
    try {
      const { error: receiveError } = await (supabase as any).rpc('receive_fbs_order_bound_stock', {
        p_store_id: selectedStoreId,
        p_order_id: order.id,
        p_target_box_id: targetBoxId,
        p_note: 'Ручная переприёмка отменённого FBS-заказа',
      })
      if (receiveError) throw receiveError
      setBoxSelectionOrder(null)
      setBoxScanValue('')
      await readFromDb()
    } catch (receiveError: any) {
      alert(receiveError?.message || 'Не удалось вернуть товар в выбранный короб')
    } finally {
      setBoxSelectionBusy(false)
    }
  }

  const applySelectedBox = async (order: FbsOrder, location: ProductLocation) => {
    if (boxSelectionMode === 'return') await receiveOrderIntoBox(order, location.boxId)
    else await reserveOrderFromBox(order, location)
  }

  const reserveScannedBox = async () => {
    if (!boxSelectionOrder) return
    const scanned = boxScanValue.trim()
    if (!scanned) return
    const location = boxSelectionOrder.productLocations.find((candidate) => candidate.boxBarcode === scanned)
    if (boxSelectionMode === 'return' && !location) {
      const { data: targetBox, error: targetBoxError } = await (supabase as any)
        .from('fulfillment_boxes')
        .select('id')
        .eq('account_id', workingAccountId)
        .eq('barcode', scanned)
        .maybeSingle()
      if (targetBoxError) {
        alert(targetBoxError.message || 'Не удалось проверить QR целевого короба')
        return
      }
      if (!targetBox?.id) {
        alert('Короб с таким QR не найден')
        setBoxScanValue('')
        return
      }
      await receiveOrderIntoBox(boxSelectionOrder, String(targetBox.id))
      return
    }
    if (!location) {
      alert('Этот короб не содержит товар выбранного FBS-заказа')
      setBoxScanValue('')
      return
    }
    await applySelectedBox(boxSelectionOrder, location)
  }

  const releaseOrderBoxReservation = async (order: FbsOrder) => {
    if (!supabase || boxSelectionBusy || !fbsPermissions.fbs_assembly || order.stockAllocation?.status !== 'reserved') return
    setBoxSelectionBusy(true)
    try {
      const { error: releaseError } = await (supabase as any).rpc('release_fbs_order_box_reservation', {
        p_store_id: selectedStoreId,
        p_order_id: order.id,
      })
      if (releaseError) throw releaseError
      setBoxSelectionOrder(null)
      setBoxScanValue('')
      await readFromDb()
    } catch (releaseError: any) {
      alert(releaseError?.message || 'Не удалось вернуть товар в исходный короб')
    } finally {
      setBoxSelectionBusy(false)
    }
  }

  const getSupplyBoxes = async (supplyId: string): Promise<string[]> => {
    const response = await invokeFbs(selectedStoreId, { action: 'get_supply_boxes', supply_id: supplyId })
    return (Array.isArray(response.boxes) ? response.boxes : []).map(String).filter(Boolean)
  }

  const openSupplyDispatchModal = async (supply: WbSupply, orders2ship: FbsOrder[]) => {
    if (!fbsPermissions.fbs_dispatch) return
    const storeId = selectedStoreId
    setDispatchModal({
      supply,
      orders: orders2ship,
      destination: null,
      boxes: [],
      amount: '1',
      loading: true,
      busy: false,
      error: null,
    })
    try {
      const boxes = await getSupplyBoxes(supply.id)
      if (selectedStoreIdRef.current !== storeId) return
      setDispatchModal((current) => current?.supply.id === supply.id
        ? { ...current, boxes, destination: boxes.length > 0 ? 'pvz' : current.destination, loading: false }
        : current)
    } catch (boxError) {
      setDispatchModal((current) => current?.supply.id === supply.id
        ? { ...current, loading: false, error: boxError instanceof Error ? boxError.message : String(boxError) }
        : current)
    }
  }

  const handleDeleteSupply = async () => {
    if (!deleteSupplyModal || deleteSupplyModal.busy || !fbsPermissions.fbs_assembly) return
    const storeId = selectedStoreId
    const supply = deleteSupplyModal.supply
    setDeleteSupplyModal((current) => current ? { ...current, busy: true, error: null } : null)
    try {
      await invokeFbs(storeId, { action: 'delete_supply', supply_id: supply.id })
      if (selectedStoreIdRef.current !== storeId) return
      optimisticSupplyNamesRef.current.delete(supply.id)
      optimisticCreatedSuppliesRef.current.delete(supply.id)
      for (const [orderId, transition] of optimisticOrderSuppliesRef.current.entries()) {
        if (transition.supplyId === supply.id) optimisticOrderSuppliesRef.current.delete(orderId)
      }
      setOpenSupplies((current) => current.filter((item) => item.id !== supply.id))
      setClosedSupplies((current) => current.filter((item) => item.id !== supply.id))
      setSelectedSupplyIds((current) => {
        const next = new Set(current)
        next.delete(supply.id)
        return next
      })
      setExpandedSupplyIds((current) => {
        const next = new Set(current)
        next.delete(supply.id)
        return next
      })
      setDeleteSupplyModal(null)
    } catch (deleteError) {
      if (selectedStoreIdRef.current !== storeId) return
      setDeleteSupplyModal((current) => current ? {
        ...current,
        busy: false,
        error: String(deleteError).replace(/^Error:\s*/, ''),
      } : null)
    }
  }

  const refreshDispatchBoxes = async (supplyId: string) => {
    const boxes = await getSupplyBoxes(supplyId)
    setDispatchModal((current) => current?.supply.id === supplyId ? { ...current, boxes } : current)
    return boxes
  }

  const addSupplyBoxes = async () => {
    if (!dispatchModal || dispatchModal.busy) return
    const supplyId = dispatchModal.supply.id
    const amount = Number(dispatchModal.amount)
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000) {
      setDispatchModal((current) => current?.supply.id === supplyId
        ? { ...current, error: 'Укажите количество коробов от 1 до 1000.' }
        : current)
      return
    }
    setDispatchModal((current) => current?.supply.id === supplyId ? { ...current, busy: true, error: null } : current)
    try {
      await invokeFbs(selectedStoreId, { action: 'add_supply_boxes', supply_id: supplyId, amount })
      await refreshDispatchBoxes(supplyId)
      setDispatchModal((current) => current?.supply.id === supplyId ? { ...current, amount: '1' } : current)
    } catch (boxError) {
      // POST нельзя автоматически повторять: ответ мог потеряться уже после
      // создания коробов. Перечитываем список WB и показываем точный итог.
      await refreshDispatchBoxes(supplyId).catch(() => undefined)
      setDispatchModal((current) => current?.supply.id === supplyId
        ? { ...current, error: boxError instanceof Error ? boxError.message : String(boxError) }
        : current)
    } finally {
      setDispatchModal((current) => current?.supply.id === supplyId ? { ...current, busy: false } : current)
    }
  }

  const deleteSupplyBoxes = async (boxIds: string[]) => {
    if (!dispatchModal || dispatchModal.busy || boxIds.length === 0) return
    const supplyId = dispatchModal.supply.id
    const question = boxIds.length === 1 ? 'Удалить это грузоместо?' : `Удалить все грузоместа (${boxIds.length})?`
    if (!window.confirm(question)) return
    setDispatchModal((current) => current?.supply.id === supplyId ? { ...current, busy: true, error: null } : current)
    try {
      await invokeFbs(selectedStoreId, { action: 'delete_supply_boxes', supply_id: supplyId, box_ids: boxIds })
      await refreshDispatchBoxes(supplyId)
    } catch (boxError) {
      await refreshDispatchBoxes(supplyId).catch(() => undefined)
      setDispatchModal((current) => current?.supply.id === supplyId
        ? { ...current, error: boxError instanceof Error ? boxError.message : String(boxError) }
        : current)
    } finally {
      setDispatchModal((current) => current?.supply.id === supplyId ? { ...current, busy: false } : current)
    }
  }

  const printSupplyBoxes = async (boxIds: string[]) => {
    if (!dispatchModal || dispatchModal.busy || boxIds.length === 0 || !fbsPermissions.fbs_assembly) return
    const supplyId = dispatchModal.supply.id
    const previewWindow = window.open('', '_blank')
    if (previewWindow) previewWindow.document.body.innerHTML = '<div style="font:14px Arial;padding:24px;color:#475569">Получаем QR грузомест из Wildberries…</div>'
    setDispatchModal((current) => current?.supply.id === supplyId ? { ...current, busy: true, error: null } : current)
    try {
      const response = await invokeFbs(selectedStoreId, {
        action: 'get_supply_box_stickers', supply_id: supplyId, box_ids: boxIds,
      })
      const stickers = (Array.isArray(response.stickers) ? response.stickers : []) as Array<{ barcode?: string; file?: string }>
      const pages = stickers
        .filter((sticker) => typeof sticker.file === 'string' && sticker.file.length > 0)
        .map((sticker, index): StickerPageImage => ({
          data: `data:image/png;base64,${sticker.file}`,
          format: 'PNG',
          alias: `wb-cargo-${supplyId}-${index + 1}`,
        }))
      if (pages.length !== boxIds.length) {
        throw new Error(`Wildberries вернул ${pages.length} QR из ${boxIds.length}. Поставка должна содержать заказы.`)
      }
      const url = buildStickerPdfUrl(pages)
      if (previewWindow) previewWindow.location.href = url
      else window.open(url, '_blank')
    } catch (printError) {
      previewWindow?.close()
      setDispatchModal((current) => current?.supply.id === supplyId
        ? { ...current, error: printError instanceof Error ? printError.message : String(printError) }
        : current)
    } finally {
      setDispatchModal((current) => current?.supply.id === supplyId ? { ...current, busy: false } : current)
    }
  }

  const handleShip = async (supplyId: string, orders2ship: FbsOrder[]): Promise<boolean> => {
    if (!supabase || !fbsPermissions.fbs_dispatch) return false
    const storeId = selectedStoreId
    const ids = orders2ship.map((o) => o.id)
    setBusyIds((s) => new Set([...s, ...ids]))
    try {
      // Статус меняет только WB: сначала передаём целую поставку в доставку.
      await invokeFbs(storeId, { action: 'deliver_supply', supply_id: supplyId })
      const dispatchRpc = fastSyncV2Enabled ? 'mark_fbs_supply_dispatched_v2' : 'mark_fbs_supply_dispatched'
      const { error: dispatchError } = await (supabase as any).rpc(dispatchRpc, {
        p_store_id: storeId,
        p_supply_id: supplyId,
      })
      if (dispatchError) console.warn('Не удалось сразу перевести резерв FBS в ожидание WB:', dispatchError)
      if (selectedStoreIdRef.current === storeId) {
        const closedAt = new Date().toISOString()
        setOrders((previous) => previous.map((order) => ids.includes(order.id)
          ? { ...order, shipStatus: 'delivering' as const, supplierStatus: 'complete', wbSystemStatus: 'waiting', supply_id: supplyId }
          : order))
        setOpenSupplies((previous) => previous.filter((supply) => supply.id !== supplyId))
        setClosedSupplies((previous) => {
          const source = openSupplies.find((supply) => supply.id === supplyId)
            ?? previous.find((supply) => supply.id === supplyId)
          const delivered: WbSupply = {
            ...(source ?? { id: supplyId, name: supplyId }),
            done: true,
            closedAt,
          }
          return [delivered, ...previous.filter((supply) => supply.id !== supplyId)]
        })
      }
      setSelected(new Set())
      setSelectedSupplyIds(new Set())
      setDispatchModal(null)
      if (fastSyncV2Enabled) {
        void doSync('incremental', 'automatic')
        return true
      }
      await Promise.all([doSync('incremental'), loadOpenSupplies()])
      return true
    } catch (e) {
      alert(String(e))
      return false
    }
    finally { setBusyIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n }) }
  }

  const deliverFromDispatchModal = async () => {
    if (!dispatchModal || dispatchModal.loading || dispatchModal.busy || !dispatchModal.destination) return
    if (dispatchModal.destination === 'pvz' && dispatchModal.boxes.length === 0) {
      setDispatchModal((current) => current ? { ...current, error: 'Для ПВЗ сначала создайте хотя бы одно грузоместо.' } : current)
      return
    }
    if (dispatchModal.destination === 'warehouse' && dispatchModal.boxes.length > 0) {
      const confirmed = window.confirm('В поставке уже есть грузоместа для ПВЗ. Передать её на склад или в СЦ всё равно?')
      if (!confirmed) return
    }
    await handleShip(dispatchModal.supply.id, dispatchModal.orders)
  }

  const getWbStickerFiles = async (ordersToPrint: FbsOrder[]): Promise<Map<string, string>> => {
    const ids = ordersToPrint.map((order) => order.id)
    const filesByOrderId = new Map<string, string>()
    for (let index = 0; index < ids.length; index += 100) {
      const response = await invokeFbs(selectedStoreId, {
        action: 'get_sticker', order_ids: ids.slice(index, index + 100), fmt: 'png', w: 58, h: 40,
      })
      for (const sticker of (response.stickers as Array<{ orderId: string | number; file?: string }> | undefined) ?? []) {
        if (typeof sticker.file === 'string' && sticker.file.length > 0) filesByOrderId.set(String(sticker.orderId), sticker.file)
      }
    }
    const missingIds = ids.filter((id) => !filesByOrderId.has(id))
    if (missingIds.length > 0) {
      throw new Error(`Wildberries не вернул стикеры для ${missingIds.length} заказов: ${missingIds.slice(0, 5).join(', ')}${missingIds.length > 5 ? '…' : ''}`)
    }
    return filesByOrderId
  }

  const handleSupplyQrPrint = async (supplyId: string) => {
    if (activeTab !== 'delivering' || supplyQrBusyIds.has(supplyId) || !fbsPermissions.fbs_assembly) return
    const previewWindow = window.open('', '_blank')
    if (previewWindow) previewWindow.document.body.innerHTML = '<div style="font:14px Arial;padding:24px;color:#475569">Получаем QR поставки из Wildberries…</div>'
    setSupplyQrBusyIds((current) => new Set(current).add(supplyId))
    try {
      const response = await invokeFbs(selectedStoreId, { action: 'get_supply_qr', supply_id: supplyId })
      const file = typeof response.file === 'string' ? response.file : ''
      if (!file) throw new Error('Wildberries не вернул файл QR поставки')
      const url = buildStickerPdfUrl([{
        data: `data:image/png;base64,${file}`,
        format: 'PNG',
        alias: `wb-supply-${supplyId}`,
      }])
      if (previewWindow) previewWindow.location.href = url
      else window.open(url, '_blank')
    } catch (printError) {
      previewWindow?.close()
      const message = printError instanceof Error ? printError.message : String(printError)
      alert(`Не удалось распечатать QR поставки: ${message}`)
    } finally {
      setSupplyQrBusyIds((current) => {
        const next = new Set(current)
        next.delete(supplyId)
        return next
      })
    }
  }

  const handleAcceptanceActDownload = async (supplyId: string) => {
    if (acceptanceActBusyIds.has(supplyId) || !fbsPermissions.fbs_view) return
    setAcceptanceActBusyIds((current) => new Set(current).add(supplyId))
    try {
      const response = await invokeFbs(selectedStoreId, {
        action: 'download_acceptance_act',
        supply_id: supplyId,
      })
      if (response.available !== true) {
        alert(String(response.message || 'Wildberries ещё не сформировал акт приёмки для этой поставки.'))
        return
      }

      const base64Document = typeof response.document === 'string' ? response.document.replace(/\s/g, '') : ''
      if (!base64Document) throw new Error('Wildberries вернул пустой файл акта приёмки')
      const binary = atob(base64Document)
      const byteParts: ArrayBuffer[] = []
      for (let offset = 0; offset < binary.length; offset += 8192) {
        const slice = binary.slice(offset, offset + 8192)
        const buffer = new ArrayBuffer(slice.length)
        const bytes = new Uint8Array(buffer)
        for (let index = 0; index < slice.length; index += 1) bytes[index] = slice.charCodeAt(index)
        byteParts.push(buffer)
      }

      const blob = new Blob(byteParts, { type: 'application/zip' })
      const downloadUrl = URL.createObjectURL(blob)
      const returnedName = typeof response.file_name === 'string'
        ? response.file_name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, '').trim()
        : ''
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = returnedName || `Акт приёмки № ${supplyId}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
    } catch (downloadError) {
      const message = downloadError instanceof Error ? downloadError.message : String(downloadError)
      alert(`Не удалось скачать акт приёмки: ${message}`)
    } finally {
      setAcceptanceActBusyIds((current) => {
        const next = new Set(current)
        next.delete(supplyId)
        return next
      })
    }
  }

  const openStickerPrintModal = (ordersToPrint: FbsOrder[], supply: WbSupply | null, mode: StickerPrintModal['mode']) => {
    if (ordersToPrint.length === 0 || !fbsPermissions.fbs_assembly) return
    setPickingListMenuOpen(false)
    const savedOptions = loadStickerPrintOptions(workingAccountId)
    setStickerPrintModal({
      orders: ordersToPrint,
      supply,
      mode,
      options: { ...savedOptions, supply: mode === 'supply' ? savedOptions.supply : false },
    })
  }

  const handleCombinedStickerPrint = async () => {
    if (!stickerPrintModal) return
    const { orders: ordersToPrint, supply, mode, options } = stickerPrintModal
    if (!options.supply && !options.picking && !options.locations && !options.productBarcode && !options.wb) return
    const previewWindow = window.open('', '_blank')
    if (previewWindow) previewWindow.document.body.innerHTML = '<div style="font:14px Arial;padding:24px;color:#475569">Формируем стикеры…</div>'
    const ids = ordersToPrint.map((order) => order.id)
    setStickerPrintModal(null)
    setBusyIds((current) => new Set([...current, ...ids]))
    try {
      const wbFiles = options.wb ? await getWbStickerFiles(ordersToPrint) : new Map<string, string>()
      const groups = new Map<string, FbsOrder[]>()
      for (const order of ordersToPrint) {
        const key = stickerVariantKey(order)
        groups.set(key, [...(groups.get(key) ?? []), order])
      }
      const pages: StickerPageImage[] = []
      if (mode === 'supply' && options.supply) {
        if (!supply) throw new Error('Не найдены данные поставки')
        pages.push(buildSupplySticker(supply, ordersToPrint, groups.size))
      }
      const selectedStore = storesWithKey.find((store) => store.id === selectedStoreId)
      const sellerName = selectedStore?.supplier?.trim() || selectedStore?.supplier_full?.trim() || selectedStore?.name?.trim() || 'Продавец Wildberries'
      for (const groupOrders of groups.values()) {
        if (options.picking) pages.push(buildPickingSticker(groupOrders[0], groupOrders.length))
        if (options.locations) pages.push(...buildLocationStickers(groupOrders[0]))
        const productBarcodePage = options.productBarcode ? buildProductBarcodeSticker(groupOrders[0], sellerName) : null
        for (const order of groupOrders) {
          if (productBarcodePage) pages.push(productBarcodePage)
          if (options.wb) pages.push({ data: `data:image/png;base64,${wbFiles.get(order.id)!}`, format: 'PNG' })
        }
      }
      const url = buildStickerPdfUrl(pages)
      if (previewWindow) previewWindow.location.href = url
      else window.open(url, '_blank')
    } catch (error) {
      previewWindow?.close()
      alert(`Не удалось сформировать стикеры: ${String(error)}`)
    } finally {
      setBusyIds((current) => { const next = new Set(current); ids.forEach((id) => next.delete(id)); return next })
    }
  }

  const buildPickingListRows = async (ordersToExport: FbsOrder[]): Promise<PickingListRow[]> => {
    if (!supabase) throw new Error('Supabase не подключён')
    const nmIds = [...new Set(ordersToExport.map((order) => order.nmId))]
    const { data: productData, error: productsError } = await (supabase as any)
      .from('products')
      .select('id, account_id, store_id, nm_id, cost_price, vendor_code, name, brand, category, color, composition, country, barcodes, photos, sizes, raw_data, synced_at, created_at')
      .eq('store_id', selectedStoreId)
      .in('nm_id', nmIds)
    if (productsError) throw productsError

    const productByNmId = new Map<number, Product>((productData ?? []).map((product: Product) => [product.nm_id, product]))
    const stickerByOrderId = new Map<string, { partA?: number; partB?: number }>()
    const ids = ordersToExport.map((order) => order.id)
    for (let index = 0; index < ids.length; index += 100) {
      const response = await invokeFbs(selectedStoreId, {
        action: 'get_sticker', order_ids: ids.slice(index, index + 100), fmt: 'png', w: 58, h: 40,
      })
      for (const sticker of (response.stickers as Array<{ orderId: string | number; partA?: number; partB?: number }> | undefined) ?? []) {
        stickerByOrderId.set(String(sticker.orderId), sticker)
      }
    }

    const imageCache = new Map<number, Promise<string | null>>()
    return Promise.all(ordersToExport.map(async (order) => {
      const product = productByNmId.get(order.nmId)
      const barcode = fbsOrderBarcode(order) ?? ''
      const photoUrl = productPhotoUrl(product)
      const sticker = stickerByOrderId.get(order.id)
      if (photoUrl && !imageCache.has(order.nmId)) imageCache.set(order.nmId, imageUrlToPngDataUrl(photoUrl))
      return {
        orderId: order.id,
        photoUrl,
        photoDataUrl: photoUrl ? await imageCache.get(order.nmId)! : null,
        brand: product?.brand?.trim() || '—',
        name: product?.name?.trim() || `Товар WB ${order.nmId}`,
        size: productSizeByBarcode(product, barcode, order.chrtId) ?? '—',
        color: product?.color?.trim() || '—',
        vendorCode: order.article?.trim() || product?.vendor_code?.trim() || '—',
        sticker: sticker
          ? `${sticker.partA ?? ''} ${sticker.partB == null ? '' : String(sticker.partB).padStart(4, '0')}`.trim()
          : '—',
        barcode: barcode || '—',
      }
    }))
  }

  const createPickingListPdfUrl = async (rows: PickingListRow[], supplyLabel: string): Promise<string> => {
    const { default: html2canvas } = await import('html2canvas')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const rowsPerPage = 8
    const date = new Date().toLocaleDateString('ru-RU')

    for (let offset = 0; offset < rows.length; offset += rowsPerPage) {
      const pageRows = rows.slice(offset, offset + rowsPerPage)
      const element = document.createElement('div')
      element.style.cssText = 'position:fixed;left:-12000px;top:0;width:1120px;background:#fff;padding:34px 38px;color:#172033;font-family:Arial,sans-serif;box-sizing:border-box'
      element.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
          <div><div style="font-size:15px;margin-bottom:5px">Дата: ${escapeHtml(date)}</div><div style="font-size:25px;font-weight:800">Лист подбора ${escapeHtml(supplyLabel)}</div><div style="font-size:15px;margin-top:6px">Количество товаров: ${rows.length}</div></div>
          <div style="font-size:27px;font-weight:900;letter-spacing:1px">ELESTET</div>
        </div>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px">
          <thead><tr>${['№ задания','Фото','Бренд','Наименование','Размер','Цвет','Артикул продавца','Стикер'].map((title, index) => `<th style="border:1px solid #8993a4;padding:7px;text-align:left;width:${[11,9,11,24,8,11,14,12][index]}%">${title}</th>`).join('')}</tr></thead>
          <tbody>${pageRows.map((row) => `<tr style="height:72px">
            <td style="border:1px solid #8993a4;padding:7px;font-weight:700">${row.orderId}</td>
            <td style="border:1px solid #8993a4;padding:4px;text-align:center">${row.photoDataUrl ? `<img src="${row.photoDataUrl}" style="width:58px;height:58px;object-fit:contain"/>` : '—'}</td>
            <td style="border:1px solid #8993a4;padding:7px">${escapeHtml(row.brand)}</td>
            <td style="border:1px solid #8993a4;padding:7px">${escapeHtml(row.name)}</td>
            <td style="border:1px solid #8993a4;padding:7px">${escapeHtml(row.size)}</td>
            <td style="border:1px solid #8993a4;padding:7px">${escapeHtml(row.color)}</td>
            <td style="border:1px solid #8993a4;padding:7px">${escapeHtml(row.vendorCode)}</td>
            <td style="border:1px solid #8993a4;padding:7px;font-size:16px;font-weight:800">${escapeHtml(row.sticker)}</td>
          </tr>`).join('')}</tbody>
        </table>`
      document.body.appendChild(element)
      try {
        const canvas = await html2canvas(element, { backgroundColor: '#ffffff', scale: 1.5, useCORS: true, logging: false })
        if (offset > 0) pdf.addPage('a4', 'landscape')
        const maxWidth = 281
        const maxHeight = 194
        const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height)
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 8, 8, canvas.width * ratio, canvas.height * ratio)
      } finally {
        element.remove()
      }
    }
    return pdf.output('bloburl') as unknown as string
  }

  const downloadPickingListExcel = async (rows: PickingListRow[], supplyLabel: string) => {
    const XLSX = await import('xlsx')
    const data: Array<Array<string | number>> = [
      [`Дата: ${new Date().toLocaleDateString('ru-RU')}`],
      [`Лист подбора ${supplyLabel}`],
      [],
      [`Количество товаров: ${rows.length}`],
      ['Фото', 'Бренд', 'Наименование', 'Размер', 'Цвет', 'Артикул продавца', 'Стикер', 'Баркод'],
      ...rows.map((row) => ['', row.brand, row.name, row.size, row.color, row.vendorCode, row.sticker, row.barcode]),
    ]
    const sheet = XLSX.utils.aoa_to_sheet(data)
    applyExcelWorksheetStandards(XLSX.utils, sheet, { headerRow: 4 })
    if (sheet['!cols']) sheet['!cols'][0] = { wch: 13 }
    sheet['!rows'] = [{ hpt: 20 }, { hpt: 30 }, { hpt: 8 }, { hpt: 20 }, { hpt: 28 }, ...rows.map(() => ({ hpt: 72 }))]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Лист подбора')
    const workbookBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })

    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(workbookBytes)
    const images = rows
      .map((row, index) => ({ index, data: row.photoDataUrl?.split(',')[1] }))
      .filter((image): image is { index: number; data: string } => Boolean(image.data))

    if (images.length > 0) {
      images.forEach((image, index) => zip.file(`xl/media/image${index + 1}.png`, image.data, { base64: true }))
      const anchors = images.map((image, index) => {
        const row = image.index + 5
        return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>100000</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>70000</xdr:rowOff></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 1}" name="Фото ${index + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${index + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`
      }).join('')
      zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`)
      zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${images.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${index + 1}.png"/>`).join('')}</Relationships>`)
      zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>')
      const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
      zip.file('xl/worksheets/sheet1.xml', sheetXml.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>'))
      let contentTypes = await zip.file('[Content_Types].xml')!.async('string')
      if (!contentTypes.includes('Extension="png"')) contentTypes = contentTypes.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')
      contentTypes = contentTypes.replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>')
      zip.file('[Content_Types].xml', contentTypes)
    }

    const result = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(result)
    link.download = `Лист_подбора_${supplyLabel.replace(/[\\/:*?"<>|]+/g, '_')}_${new Date().toLocaleDateString('ru-RU').replace(/\./g, '-')}.xlsx`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  const handlePickingList = async (format: 'pdf' | 'excel', ordersToExport: FbsOrder[], supplyLabel: string) => {
    if (ordersToExport.length === 0) return
    const ids = ordersToExport.map((order) => order.id)
    const previewWindow = format === 'pdf' ? window.open('', '_blank') : null
    if (previewWindow) previewWindow.document.body.innerHTML = '<div style="font:14px Arial;padding:24px;color:#475569">Формируем лист подбора…</div>'
    setPickingListMenuOpen(false)
    setBusyIds((current) => new Set([...current, ...ids]))
    try {
      const rows = await buildPickingListRows(ordersToExport)
      if (format === 'pdf') {
        const url = await createPickingListPdfUrl(rows, supplyLabel)
        if (previewWindow) previewWindow.location.href = url
        else window.open(url, '_blank')
      } else {
        await downloadPickingListExcel(rows, supplyLabel)
      }
    } catch (error) {
      previewWindow?.close()
      alert(`Не удалось сформировать лист подбора: ${String(error)}`)
    } finally {
      setBusyIds((current) => { const next = new Set(current); ids.forEach((id) => next.delete(id)); return next })
    }
  }

  // Каждый стикер — отдельная страница PDF 58×40 мм.
  function buildStickerPdfUrl(pageImages: StickerPageImage[]): string {
    const W = 58, H = 40
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [W, H] })
    pageImages.forEach((image, i) => {
      if (i > 0) doc.addPage([W, H], 'landscape')
      doc.addImage(image.data, image.format, 0, 0, W, H, image.alias, image.format === 'PNG' ? 'FAST' : undefined)
    })
    return doc.output('bloburl') as unknown as string
  }
  const wbWarehouseInfo = (order: FbsOrder) => {
    const sellerWarehouse = wbWarehouses.find((warehouse) => Number(warehouse.id) === Number(order.warehouseId))
    const internalWarehouse = internalWarehouses.find((warehouse) => Number(warehouse.wb_warehouse_id) === Number(order.warehouseId))
    const officeId = order.officeId || sellerWarehouse?.officeId || 0
    const office = wbOffices.find((item) => Number(item.id) === Number(officeId))
    return {
      officialName: office?.name || (officeId ? `Склад WB #${officeId}` : 'Склад WB не определён'),
      sellerName: internalWarehouse?.name || sellerWarehouse?.name || (order.warehouseId ? `Склад продавца #${order.warehouseId}` : 'Склад продавца не определён'),
      address: office?.address || null,
    }
  }

  const warehouseFilterOptions = Array.from(
    new Map(wbWarehouses.map((warehouse) => [String(warehouse.id), warehouse])).values(),
  ).map((warehouse) => {
    const internalWarehouse = internalWarehouses.find((item) => Number(item.wb_warehouse_id) === Number(warehouse.id))
    const orderOfficeId = orders.find((order) => Number(order.warehouseId) === Number(warehouse.id))?.officeId || 0
    const officeId = warehouse.officeId || orderOfficeId
    const office = wbOffices.find((item) => Number(item.id) === Number(officeId))
    return {
      id: String(warehouse.id),
      officeId,
      officialName: office?.name || (officeId ? `Склад WB #${officeId}` : 'Склад WB не определён'),
      sellerWbName: warehouse.name || `Склад продавца #${warehouse.id}`,
      sellerName: internalWarehouse?.name || warehouse.name || `Склад продавца #${warehouse.id}`,
    }
  })

  const currentOrdersBySupply = new Map<string, FbsOrder[]>()
  orders.forEach((order) => {
    if (!order.isInLatestSnapshot || !order.supply_id) return
    currentOrdersBySupply.set(order.supply_id, [...(currentOrdersBySupply.get(order.supply_id) ?? []), order])
  })
  const selectedWarehouseOption = warehouseFilterOptions.find((warehouse) => warehouse.id === selectedWarehouseFilter) ?? null
  const ordersBeingAssembled = assembleModal
    ? assembleModal.ids.map((orderId) => orders.find((order) => order.id === orderId)).filter((order): order is FbsOrder => Boolean(order))
    : []
  const assemblyWarehouseIds = new Set(ordersBeingAssembled.map((order) => String(order.warehouseId)).filter((id) => id !== '0'))
  const assemblyOfficeIds = new Set(ordersBeingAssembled.map((order) => Number(order.officeId)).filter((id) => id > 0))

  const supplyWarehouseInfo = (supply: WbSupply) => {
    const supplyOrders = currentOrdersBySupply.get(supply.id) ?? []
    if (supplyOrders[0]) {
      const warehouse = wbWarehouseInfo(supplyOrders[0])
      return { ...warehouse, sellerLine: `Ваш склад: ${warehouse.sellerName}`, unassigned: false }
    }

    const officeId = Number(supply.destinationOfficeId ?? 0)
    const office = wbOffices.find((item) => Number(item.id) === officeId)
    const matchingWarehouses = warehouseFilterOptions.filter((warehouse) => warehouse.officeId === officeId)
    const preferredWarehouse = selectedWarehouseOption?.officeId === officeId
      ? selectedWarehouseOption
      : matchingWarehouses.length === 1 ? matchingWarehouses[0] : null
    if (officeId > 0) {
      return {
        officialName: office?.name || `Склад WB #${officeId}`,
        sellerName: preferredWarehouse?.sellerName || 'Склад продавца не определён',
        sellerLine: preferredWarehouse ? `Ваш склад: ${preferredWarehouse.sellerName}` : 'Ваш склад не удалось определить',
        address: office?.address || null,
        unassigned: false,
      }
    }

    const prospectiveWarehouse = selectedWarehouseOption
      ?? (assemblyWarehouseIds.size === 1
        ? warehouseFilterOptions.find((warehouse) => assemblyWarehouseIds.has(warehouse.id)) ?? null
        : null)
    return {
      officialName: prospectiveWarehouse ? `Назначится: ${prospectiveWarehouse.officialName}` : 'Склад назначится первым заказом',
      sellerName: prospectiveWarehouse?.sellerName || 'Поставка пока не привязана к складу',
      sellerLine: prospectiveWarehouse ? `Ваш склад: ${prospectiveWarehouse.sellerName}` : 'Ваш склад тоже назначится первым заказом',
      address: null,
      unassigned: true,
    }
  }

  const supplyMatchesCurrentSelection = (supply: WbSupply) => {
    const supplyOrders = currentOrdersBySupply.get(supply.id) ?? []
    if (selectedWarehouseFilter !== ALL_WAREHOUSES_FILTER) {
      if (supplyOrders.length > 0) {
        if (!supplyOrders.some((order) => String(order.warehouseId) === selectedWarehouseFilter)) return false
      } else {
        const officeId = Number(supply.destinationOfficeId ?? 0)
        if (officeId > 0 && (!selectedWarehouseOption?.officeId || officeId !== selectedWarehouseOption.officeId)) return false
      }
    }

    if (ordersBeingAssembled.length === 0 || supplyOrders.length === 0) {
      const officeId = Number(supply.destinationOfficeId ?? 0)
      return officeId === 0 || assemblyOfficeIds.size === 0 || (assemblyOfficeIds.size === 1 && assemblyOfficeIds.has(officeId))
    }
    if (assemblyWarehouseIds.size !== 1) return false
    const targetWarehouseId = [...assemblyWarehouseIds][0]
    return supplyOrders.every((order) => String(order.warehouseId) === targetWarehouseId)
  }

  const availableAssemblySupplies = openSupplies.filter((supply) => (
    supply.availableOnWb !== false
    && !assembleModal?.sourceSupplyIds.includes(supply.id)
    && supplyMatchesCurrentSelection(supply)
  ))

  const dispatchDestinationMap = new Map<number, { id: number; officialName: string; sellerNames: string[] }>()
  warehouseFilterOptions
    .filter((warehouse) => warehouse.officeId > 0)
    .forEach((warehouse) => {
      const destination = dispatchDestinationMap.get(warehouse.officeId)
      if (!destination) {
        dispatchDestinationMap.set(warehouse.officeId, {
          id: warehouse.officeId,
          officialName: warehouse.officialName,
          sellerNames: [warehouse.sellerWbName],
        })
        return
      }
      if (!destination.sellerNames.includes(warehouse.sellerWbName)) {
        destination.sellerNames.push(warehouse.sellerWbName)
      }
    })
  const dispatchWbDestinations = Array.from(dispatchDestinationMap.values()).map((warehouse) => ({
    id: warehouse.id,
    name: `${warehouse.sellerNames.join(', ')} — ${warehouse.officialName}`,
  }))

  const stockWbWarehouses = wbWarehouses.map((warehouse) => {
    const orderOfficeId = orders.find((order) => Number(order.warehouseId) === Number(warehouse.id))?.officeId || 0
    const officeId = warehouse.officeId || orderOfficeId
    const officialName = wbOffices.find((office) => Number(office.id) === Number(officeId))?.name
    return {
      ...warehouse,
      displayName: officialName && officialName !== warehouse.name
        ? `${warehouse.name} — ${officialName}`
        : warehouse.name,
    }
  })

  const renderWbWarehouseCell = (order: FbsOrder) => {
    const warehouse = wbWarehouseInfo(order)
    return (
      <div className="min-w-0 leading-tight" title={warehouse.address ?? undefined}>
        <div className="truncate font-semibold text-slate-700">{warehouse.officialName}</div>
        <div className="mt-1 truncate text-[11px] text-slate-400">Ваш склад: {warehouse.sellerName}</div>
      </div>
    )
  }

  const fbsOrdersExportRows = (ordersToExport: FbsOrder[]) => ordersToExport.map((order) => {
    const warehouse = wbWarehouseInfo(order)
    return {
      'Заказ №': order.id,
      'Дата заказа': order.createdAt ? new Date(order.createdAt).toLocaleString('ru-RU') : '',
      'Статус': completedOrderStatusLabel(order),
      'Артикул WB': order.nmId,
      'Артикул продавца': order.productVendorCode || order.article || '',
      'Товар': order.productName || '',
      'Бренд': order.productBrand || '',
      'Размер': order.productSize || '',
      'Баркод': order.productBarcode || fbsOrderBarcode(order) || '',
      'Поставка WB': order.supply_id || '',
      'Склад продавца': warehouse.sellerName,
      'Склад приёмки WB': warehouse.officialName,
    }
  })

  const downloadFbsOrdersExcel = async (ordersToExport: FbsOrder[], sheetName: string, filename: string) => {
    const XLSX = await import('xlsx')
    const rows = fbsOrdersExportRows(ordersToExport)
    const sheet = rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['Заказ №', 'Дата заказа', 'Статус', 'Артикул WB', 'Артикул продавца', 'Товар', 'Бренд', 'Размер', 'Баркод', 'Поставка WB', 'Склад продавца', 'Склад приёмки WB']])
    applyExcelWorksheetStandards(XLSX.utils, sheet)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
    XLSX.writeFile(workbook, filename)
  }

  const downloadCompletedOrdersExcel = async (ordersToExport: FbsOrder[]) => {
    if (ordersToExport.length === 0) return
    await downloadFbsOrdersExcel(
      ordersToExport,
      'Завершённые',
      `FBS_Завершённые_${new Date().toLocaleDateString('ru-RU').replace(/\./g, '-')}.xlsx`,
    )
  }

  const createArchiveReport = async () => {
    if (!supabase || !selectedStoreId || archiveBusy) return
    if (!archivePeriodFrom || !archivePeriodTo || archivePeriodFrom > archivePeriodTo) {
      setArchiveNotice('Проверьте период: дата начала должна быть не позже даты окончания.')
      return
    }
    if (archiveReports.length >= 100) {
      setArchiveNotice('Достигнут лимит: одновременно можно хранить не больше 100 отчётов.')
      return
    }
    setArchiveBusy(true)
    setArchiveNotice(null)
    try {
      const reportOrders = orders.filter((order) => {
        if (!orderMatchesWarehouseFilter(order) || !isArchiveEligibleOrder(order) || !order.createdAt) return false
        const orderDate = new Date(order.createdAt).toISOString().slice(0, 10)
        return orderDate >= archivePeriodFrom && orderDate <= archivePeriodTo
      })
      const { error: insertError } = await (supabase as any)
        .from('fbs_archive_reports')
        .insert({
          account_id: workingAccountId,
          store_id: selectedStoreId,
          period_from: archivePeriodFrom,
          period_to: archivePeriodTo,
          rows_count: reportOrders.length,
          order_ids: reportOrders.map((order) => order.id),
          status: 'ready',
        })
      if (insertError) throw insertError
      await loadArchiveReports()
      setArchiveNotice(`Отчёт сформирован: ${reportOrders.length} заказов.`)
    } catch (reportError) {
      setArchiveNotice(`Не удалось сформировать отчёт: ${String(reportError)}`)
    } finally {
      setArchiveBusy(false)
    }
  }

  const downloadArchiveReport = async (report: FbsArchiveReport) => {
    const reportOrderIds = new Set(report.order_ids.map(String))
    const reportOrders = orders.filter((order) => reportOrderIds.has(order.id))
    await downloadFbsOrdersExcel(
      reportOrders,
      'Архив FBS',
      `FBS_Архив_${report.period_from}_${report.period_to}.xlsx`,
    )
  }

  const deleteArchiveReport = async (reportId: string) => {
    if (!supabase || archiveBusy) return
    setArchiveBusy(true)
    setArchiveNotice(null)
    try {
      const { error: deleteError } = await (supabase as any)
        .from('fbs_archive_reports')
        .delete()
        .eq('id', reportId)
        .eq('store_id', selectedStoreId)
      if (deleteError) throw deleteError
      setArchiveReports((current) => current.filter((report) => report.id !== reportId))
    } catch (reportError) {
      setArchiveNotice(`Не удалось удалить отчёт: ${String(reportError)}`)
    } finally {
      setArchiveBusy(false)
    }
  }

  if (workContextsLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm font-medium text-slate-500">Загружаем доступ FBS...</p>
      </div>
    )
  }

  if (workContextsError && workContexts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-md rounded-2xl border border-rose-100 bg-rose-50 px-5 py-4">
          <p className="text-sm font-semibold text-rose-700">Не удалось загрузить доступ FBS</p>
          <p className="mt-1 text-xs text-rose-600">{workContextsError}</p>
        </div>
      </div>
    )
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'pending',    label: 'Новые' },
    { key: 'assembling', label: 'На сборке' },
    { key: 'delivering', label: 'В доставке' },
    { key: 'completed',  label: 'Завершённые' },
    { key: 'cancelled',  label: 'Отменённые' },
    { key: 'archive',    label: 'Архив' },
  ]
  const warehouseOrders = orders.filter(orderMatchesWarehouseFilter)
  const completedOrders = warehouseOrders.filter(isOfficialCompletedOrder)
  const cancelledOrders = warehouseOrders.filter(isOfficialCancelledOrder)
  const archiveEligibleOrders = orders.filter((order) => orderMatchesWarehouseFilter(order) && isArchiveEligibleOrder(order))
  const tabOrders = activeTab === 'completed'
    ? completedOrders
    : activeTab === 'cancelled'
      ? cancelledOrders
      : activeTab === 'archive'
        ? []
        : orders.filter((o) => o.shipStatus === activeTab && orderMatchesWarehouseFilter(o))
  const showEmptyOpenSupplies = selectedWarehouseFilter === ALL_WAREHOUSES_FILTER
  const ordersWithoutSize = tabOrders.filter((order) => !order.productSize)
  const selectedTab = tabOrders.filter((o) => selected.has(o.id))
  const allTabSelected = tabOrders.length > 0 && tabOrders.every((o) => selected.has(o.id))

  const toggleSelect = (id: string) => {
    setSelectedSupplyIds(new Set())
    setSelected((s) => {
      const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
    })
  }
  const toggleAll = () => {
    setSelectedSupplyIds(new Set())
    setSelected(allTabSelected ? new Set() : new Set(tabOrders.map((o) => o.id)))
  }
  const toggleSupplySelection = (supplyOrders: FbsOrder[]) => {
    setSelectedSupplyIds(new Set())
    setSelected((previous) => {
      const ids = supplyOrders.map((order) => order.id)
      const allSelected = ids.length > 0 && ids.every((id) => previous.has(id))
      return allSelected ? new Set() : new Set(ids)
    })
  }
  const toggleSupplyOrderSelection = (orderId: string, supplyOrders: FbsOrder[]) => {
    setSelectedSupplyIds(new Set())
    setSelected((previous) => {
      const supplyIds = new Set(supplyOrders.map((order) => order.id))
      const next = new Set(Array.from(previous).filter((id) => supplyIds.has(id)))
      next.has(orderId) ? next.delete(orderId) : next.add(orderId)
      return next
    })
  }

  const handleStoreChange = (nextStoreId: string) => {
    optimisticSupplyNamesRef.current.clear()
    optimisticOrderSuppliesRef.current.clear()
    optimisticCreatedSuppliesRef.current.clear()
    setFastSyncV2Enabled(null)
    setSelectedStoreId(nextStoreId)
    if (nextStoreId) localStorage.setItem(lsKey, nextStoreId)
    else localStorage.removeItem(lsKey)
    setOrders([])
    setOpenSupplies([])
    setClosedSupplies([])
    setArchiveReports([])
    setArchiveNotice(null)
    setDeleteSupplyModal(null)
    setSelected(new Set())
    setSelectedSupplyIds(new Set())
    setProductSyncNotice(null)
    setError(null)
    setQuickSyncLoading(false)
    setFullSyncLoading(false)
    setLastSyncedAt(null)
    lastSyncedAtRef.current = null
  }

  const handleCompanyChange = (nextCompanyId: string) => {
    if (!nextCompanyId || nextCompanyId === selectedCompanyId) return
    setSelectedCompanyId(nextCompanyId)
    localStorage.setItem(companyLsKey, nextCompanyId)
    handleStoreChange('')
    setWbWarehouses([])
    setWbOffices([])
    setInternalWarehouses([])
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="relative z-20 flex items-end gap-1 border-b border-slate-200 bg-white px-5 pt-2">
        {([
          { key: 'orders' as const, label: 'Заказы' },
          { key: 'stocks' as const, label: 'Остатки FBS' },
          { key: 'dispatches' as const, label: 'Отчёт' },
        ]).map((section) => (
          <button
            key={section.key}
            type="button"
            onClick={() => {
              setPageSection(section.key)
              localStorage.setItem(`fbs_section_${accountId}`, section.key)
              setSelected(new Set())
              setSelectedSupplyIds(new Set())
            }}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition ${pageSection === section.key ? 'border-violet-500 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {section.label}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-end gap-3 pb-2">
          {pageSection === 'dispatches' && <div id="fbs-dispatch-period-controls" />}
          <label className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700">
            <span className="whitespace-nowrap">Компания</span>
            <select
              value={selectedCompanyId}
              onChange={(event) => handleCompanyChange(event.target.value)}
              className="max-w-[260px] bg-transparent text-sm font-semibold text-slate-800 outline-none"
            >
              {workContexts.map((context) => (
                <option key={context.company_id} value={context.company_id}>{context.company_name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <FbsStoreSelect value={selectedStoreId} stores={storesWithKey} onChange={handleStoreChange} disabled={!selectedContext} />
        {pageSection === 'stocks' && <div id="fbs-stocks-warehouse-controls" className="contents" />}

        {pageSection === 'orders' && <>
        <FbsWarehouseSelect
          value={selectedWarehouseFilter}
          onChange={(warehouseId) => {
            setSelectedWarehouseFilter(warehouseId)
            setSelected(new Set())
            setSelectedSupplyIds(new Set())
            try {
              localStorage.setItem(`fbs_warehouse_filter_${accountId}_${selectedStoreId}`, warehouseId)
            } catch {
              // Filtering remains available without persistence.
            }
          }}
          ariaLabel="Фильтр по складу FBS"
          title="Фильтр по складу FBS"
          options={[
            { value: ALL_WAREHOUSES_FILTER, label: 'Все склады' },
            ...warehouseFilterOptions.map((warehouse) => ({
              value: warehouse.id,
              label: `${warehouse.sellerName} — Склад WB: ${warehouse.officialName}`,
            })),
          ]}
        />

        <button type="button" onClick={() => void handleManualQuickSync()} disabled={quickSyncLoading || fastSyncV2Enabled === null || !selectedStoreId || !fbsPermissions.fbs_sync}
          title="Получить новые заказы и изменения активных заказов и поставок"
          className="flex h-8 items-center gap-1.5 rounded-xl bg-violet-500 px-4 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-50 transition">
          {quickSyncLoading
            ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10"/></svg>
            : <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>}
          {quickSyncLoading ? 'Загрузка...' : 'Обновить'}
        </button>

        <button type="button" onClick={() => void handleFullSync()} disabled={fullSyncLoading || !selectedStoreId || !fbsPermissions.fbs_full_sync}
          title="Заново сверить с Wildberries всю доступную историю заказов, поставок и КИЗ"
          className="flex h-8 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50">
          {fullSyncLoading ? 'Полная сверка...' : 'Полная сверка с WB'}
        </button>

        <button type="button" onClick={() => setKizScannerOpen(true)} disabled={!selectedStoreId || !fbsPermissions.fbs_assembly}
          className="flex h-8 items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-4 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-40">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5v4M3 5h4M21 5v4M21 5h-4M3 19v-4M3 19h4M21 19v-4M21 19h-4"/><path d="M7 12h10"/></svg>
          Сканировать КИЗ
        </button>

        {/* Массовые действия */}
        {fbsPermissions.fbs_assembly && selectedTab.length > 0 && activeTab === 'pending' && (
          <button type="button" onClick={() => void openAssembleModal(selectedTab.map((o) => o.id))}
            className="h-8 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-white hover:bg-amber-600 transition">
            Взять в сборку ({selectedTab.length})
          </button>
        )}
        </>}
      </div>

      {!selectedStoreId ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 p-8 text-center">
          <div className="max-w-sm rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-800">
              {storesWithKey.length > 0 ? 'Выберите магазин' : 'Нет доступных магазинов FBS'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {storesWithKey.length > 0
                ? 'До выбора магазина данные не загружаются и синхронизация не запускается.'
                : 'Для этой компании вам не разрешён ни один магазин с API-ключом WB.'}
            </p>
          </div>
        </div>
      ) : pageSection === 'stocks' ? (
        <FbsStocksPanel
          key={`${workingAccountId}:${selectedStoreId}`}
          accountId={workingAccountId}
          storeId={selectedStoreId}
          warehouses={stockWbWarehouses}
          sourceWarehouses={internalWarehouses}
          canManage={canManageStocks}
          warehouseControlsContainerId="fbs-stocks-warehouse-controls"
        />
      ) : pageSection === 'dispatches' ? (
        <FbsDispatchReport
          key={`${workingAccountId}:${selectedStoreId}`}
          accountId={workingAccountId}
          storeId={selectedStoreId}
          wbDestinations={dispatchWbDestinations}
          periodControlsContainerId="fbs-dispatch-period-controls"
        />
      ) : <>
      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 bg-white px-5">
        {tabs.map(({ key, label }) => {
          // WB keeps all non-final complete orders inside "В доставке", but its
          // tab badge counts only orders not received by Wildberries yet.
          const count: number | null = key === 'delivering'
            ? warehouseOrders.filter((order) => (
              order.isInLatestSnapshot
              && order.supplierStatus === 'complete'
              && order.wbSystemStatus === 'waiting'
            )).length
            : key === 'completed'
              ? completedOrders.length
              : key === 'cancelled'
                ? cancelledOrders.length
                : key === 'archive'
                  ? null
                  : warehouseOrders.filter((order) => order.shipStatus === key).length
          return (
            <button key={key} type="button"
              onClick={() => {
                const newTab = key as TabKey
                setActiveTab(newTab)
                localStorage.setItem(tabLsKey, newTab)
                setSelected(new Set())
                setSelectedSupplyIds(new Set())
              }}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
                activeTab === key ? 'border-violet-500 text-violet-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {label}
              {count !== null && count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  key === 'pending' ? 'bg-blue-100 text-blue-600' :
                  key === 'assembling' ? 'bg-amber-100 text-amber-600' :
                  key === 'delivering' ? 'bg-violet-100 text-violet-600' :
                  key === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                  key === 'cancelled' ? 'bg-red-100 text-red-600' :
                  'bg-slate-200 text-slate-600'
                }`}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {activeTab === 'completed' && (
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
          <button
            type="button"
            role="switch"
            aria-checked={groupCompletedBySupplies}
            onClick={() => {
              setGroupCompletedBySupplies((current) => !current)
              setSelected(new Set())
              setSelectedSupplyIds(new Set())
            }}
            className="group flex cursor-pointer items-center gap-2.5 text-xs font-medium text-slate-600 outline-none"
          >
            <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 group-focus-visible:ring-2 group-focus-visible:ring-violet-300 group-focus-visible:ring-offset-2 ${groupCompletedBySupplies ? 'bg-violet-500' : 'bg-slate-300'}`}>
              <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${groupCompletedBySupplies ? 'translate-x-4' : 'translate-x-0'}`} />
            </span>
            <span>Сгруппировать по поставкам</span>
          </button>
          <button
            type="button"
            disabled={completedOrders.length === 0}
            onClick={() => void downloadCompletedOrdersExcel(completedOrders)}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Выгрузить в Excel
          </button>
        </div>
      )}

      {error && (
        <div className="mx-5 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Данные могут быть устаревшими.</span>{' '}{error}
        </div>
      )}

      {syncNotice && (
        <div className="mx-5 mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">
          {syncNotice}
        </div>
      )}

      {ordersWithoutSize.length > 0 && (
        <div className="mx-5 mt-3 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <div>
            <span className="font-semibold">Не удалось определить размер у {ordersWithoutSize.length} заказов.</span>{' '}
            Данные товаров могут быть не синхронизированы.
          </div>
          <button
            type="button"
            disabled={syncingProducts}
            onClick={() => void handleProductSync()}
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-amber-500 px-3 font-semibold text-white transition hover:bg-amber-600 disabled:cursor-wait disabled:opacity-60"
          >
            {syncingProducts && <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10"/></svg>}
            {syncingProducts ? 'Синхронизация...' : 'Синхронизировать товары'}
          </button>
        </div>
      )}

      {productSyncNotice && (
        <div className={`mx-5 mt-2 rounded-xl px-4 py-2.5 text-xs ${productSyncNotice.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {productSyncNotice.text}
        </div>
      )}

      {activeTab === 'archive' && (
        <div className="flex-1 overflow-auto bg-slate-50 p-5 [scrollbar-gutter:stable]">
          <div className="mx-auto max-w-6xl space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Архив заказов FBS</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                    Сформируйте Excel по финальным заказам старше трёх месяцев. Отчёт хранится 7 дней и фиксирует состав заказов на момент создания.
                  </p>
                </div>
                <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
                  Доступно заказов: <span className="font-bold text-slate-900">{archiveEligibleOrders.length}</span>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-end gap-3">
                <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                  <span className="block">Дата начала</span>
                  <input
                    type="date"
                    value={archivePeriodFrom}
                    max={archivePeriodTo}
                    onChange={(event) => setArchivePeriodFrom(event.target.value)}
                    className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400"
                  />
                </label>
                <label className="space-y-1.5 text-xs font-semibold text-slate-600">
                  <span className="block">Дата окончания</span>
                  <input
                    type="date"
                    value={archivePeriodTo}
                    min={archivePeriodFrom}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setArchivePeriodTo(event.target.value)}
                    className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400"
                  />
                </label>
                <button
                  type="button"
                  disabled={archiveBusy || archiveReports.length >= 100}
                  onClick={() => void createArchiveReport()}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-xl bg-violet-500 px-4 text-xs font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {archiveBusy
                    ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10"/></svg>
                    : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  Сформировать файл
                </button>
              </div>
              <p className="mt-3 text-[11px] text-slate-400">
                Архив содержит данные, которые сервис успел сохранить из API WB. Лимит — 100 действующих отчётов на магазин.
              </p>
              {archiveNotice && (
                <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">{archiveNotice}</div>
              )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-slate-900">Сформированные отчёты</h3>
                <span className="text-xs text-slate-400">{archiveReports.length} из 100</span>
              </div>
              {archiveReports.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-slate-400">Пока нет сформированных отчётов</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-5 py-3 text-left font-semibold">Статус</th>
                        <th className="px-5 py-3 text-left font-semibold">Период заказов</th>
                        <th className="px-5 py-3 text-left font-semibold">Заказов</th>
                        <th className="px-5 py-3 text-left font-semibold">Создан</th>
                        <th className="px-5 py-3 text-left font-semibold">Хранение</th>
                        <th className="sticky right-0 z-10 border-l border-slate-200 bg-slate-50 px-5 py-3 text-right font-semibold shadow-[-10px_0_18px_-16px_rgba(15,23,42,0.7)]">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {archiveReports.map((report) => {
                        const daysLeft = Math.max(1, Math.ceil((new Date(report.expires_at).getTime() - Date.now()) / 86_400_000))
                        return (
                          <tr key={report.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-5 py-3"><span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700">Готов</span></td>
                            <td className="px-5 py-3 font-medium text-slate-700">{new Date(`${report.period_from}T00:00:00`).toLocaleDateString('ru-RU')} — {new Date(`${report.period_to}T00:00:00`).toLocaleDateString('ru-RU')}</td>
                            <td className="px-5 py-3 font-semibold text-slate-900">{report.rows_count}</td>
                            <td className="px-5 py-3 text-slate-500">{new Date(report.created_at).toLocaleString('ru-RU')}</td>
                            <td className="px-5 py-3 text-slate-500">Удалится через {daysLeft} дн.</td>
                            <td className="sticky right-0 z-[4] border-l border-slate-200 bg-white px-5 py-3 shadow-[-10px_0_18px_-16px_rgba(15,23,42,0.7)]">
                              <div className="flex justify-end gap-2">
                                <button type="button" title="Скачать XLSX" onClick={() => void downloadArchiveReport(report)} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 font-semibold text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
                                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                  XLSX
                                </button>
                                <button type="button" title="Удалить отчёт" disabled={archiveBusy} onClick={() => void deleteArchiveReport(report.id)} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {!quickSyncLoading && !fullSyncLoading && activeTab !== 'archive' && tabOrders.length === 0 && !(activeTab === 'assembling' && showEmptyOpenSupplies && openSupplies.length > 0) && !error && (
        <div className="flex h-full items-center justify-center text-sm text-slate-400">
          {orders.length === 0 ? 'Загрузка...' : `Нет заказов в статусе "${tabs.find(t => t.key === activeTab)?.label}"`}
        </div>
      )}

      {((activeTab === 'assembling' && (tabOrders.length > 0 || (showEmptyOpenSupplies && openSupplies.length > 0))) || (activeTab === 'delivering' && tabOrders.length > 0) || (activeTab === 'completed' && groupCompletedBySupplies && tabOrders.length > 0)) && (() => {
        const isAssemblingTab = activeTab === 'assembling'
        const isDeliveringTab = activeTab === 'delivering'
        const isCompletedGroupedTab = activeTab === 'completed'
        const parentActionColumnWidth = isCompletedGroupedTab ? '80px' : '128px'
        const parentGridTemplateColumns = `18px 18px minmax(180px, 1.35fr) minmax(140px, 0.9fr) minmax(140px, 1fr) minmax(145px, 1fr) minmax(72px, 0.55fr) minmax(130px, 0.85fr) ${parentActionColumnWidth}`
        // На сборке показываем и пустые открытые поставки. В доставке — только
        // активные родительские поставки, найденные у заказов текущей вкладки.
        const supplyGroups = new Map<string, { supply: WbSupply | null; orders: FbsOrder[] }>()
        if (isAssemblingTab && showEmptyOpenSupplies) openSupplies.forEach((supply) => supplyGroups.set(supply.id, { supply, orders: [] }))
        tabOrders.forEach((o) => {
          const key = o.supply_id ?? '__none__'
          const supplyDirectory = isAssemblingTab ? openSupplies : closedSupplies
          if (!supplyGroups.has(key)) supplyGroups.set(key, {
            supply: supplyDirectory.find((supply) => supply.id === key)
              ?? optimisticCreatedSuppliesRef.current.get(key)?.supply
              ?? (optimisticSupplyNamesRef.current.get(key)
                ? { id: key, name: optimisticSupplyNamesRef.current.get(key)! }
                : null),
            orders: [],
          })
          supplyGroups.get(key)!.orders.push(o)
        })
        const supplyGroupEntries = Array.from(supplyGroups.entries())
        const selectableSupplyIds = supplyGroupEntries
          .map(([supplyId]) => supplyId)
          .filter((supplyId) => supplyId !== '__none__')
        const selectedParentCount = selectableSupplyIds.filter((supplyId) => selectedSupplyIds.has(supplyId)).length
        const selectedParentEntry = selectedParentCount === 1
          ? supplyGroupEntries.find(([supplyId]) => selectedSupplyIds.has(supplyId))
          : undefined
        const allParentsSelected = selectableSupplyIds.length > 0 && selectedParentCount === selectableSupplyIds.length
        const someParentsSelected = selectedParentCount > 0 && !allParentsSelected
        const toggleAllParents = () => {
          setSelected(new Set())
          setPickingListMenuOpen(false)
          setSelectedSupplyIds(allParentsSelected ? new Set() : new Set(selectableSupplyIds))
        }
        return (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <div className="h-full w-full overflow-auto overscroll-contain [scrollbar-gutter:stable]">
            <div
              className="sticky top-0 z-10 grid min-w-[1160px] items-center gap-x-4 border-b border-slate-200 bg-white py-2.5 pl-4 pr-0 text-[11px] font-semibold text-slate-500"
              style={{ gridTemplateColumns: parentGridTemplateColumns }}
            >
              <span aria-hidden="true" />
              <input
                type="checkbox"
                title="Выбрать все поставки"
                aria-label="Выбрать все поставки"
                ref={(element) => { if (element) element.indeterminate = someParentsSelected }}
                checked={allParentsSelected}
                onChange={toggleAllParents}
                className="h-3.5 w-3.5 cursor-pointer rounded accent-violet-500"
              />
              <span>Поставка</span>
              <span>QR-код поставки</span>
              <span>Статус</span>
              <span>Время сканирования QR-кода</span>
              <span>Заказы</span>
              <span>Склад</span>
              <span className="sticky right-0 z-20 flex h-full items-center justify-end border-l border-slate-200 bg-white px-2 shadow-[-10px_0_18px_-16px_rgba(15,23,42,0.7)]">Действия</span>
            </div>
            {supplyGroupEntries.map(([supplyId, group]) => {
              const { supply, orders: supplyOrders } = group
              const isExpanded = expandedSupplyIds.has(supplyId)
              const isParentSelected = selectedSupplyIds.has(supplyId)
              const selectedSupplyOrders = supplyOrders.filter((order) => selected.has(order.id))
              const allSupplySelected = supplyOrders.length > 0 && selectedSupplyOrders.length === supplyOrders.length
              const someSupplySelected = selectedSupplyOrders.length > 0 && !allSupplySelected
              const toggle = () => {
                if (isExpanded) {
                  setSelected((previous) => {
                    const next = new Set(previous)
                    supplyOrders.forEach((order) => next.delete(order.id))
                    return next
                  })
                }
                setExpandedSupplyIds((prev) => { const n = new Set(prev); n.has(supplyId) ? n.delete(supplyId) : n.add(supplyId); return n })
              }
              const toggleParentSelection = () => {
                if (supplyId === '__none__') return
                setSelected(new Set())
                setPickingListMenuOpen(false)
                setSelectedSupplyIds((previous) => {
                  const next = new Set(previous)
                  next.has(supplyId) ? next.delete(supplyId) : next.add(supplyId)
                  return next
                })
              }
              const allSupplyOrders = supplyId === '__none__'
                ? supplyOrders
                : orders.filter((order) => order.supply_id === supplyId && orderMatchesWarehouseFilter(order))
              const totalOrderCount = Math.max(supply?.ordersCount ?? 0, allSupplyOrders.length, supplyOrders.length)
              const acceptedOrders = acceptedSupplyOrdersCount(allSupplyOrders)
              const supplyWarehouse = supplyOrders[0] ? wbWarehouseInfo(supplyOrders[0]) : null
              const scanTimestamp = formatSupplyTimestamp(supply?.scanDt)
              return (
                <div key={supplyId} className="border-b border-slate-200">
                  {/* Строка поставки (родитель) */}
                  <div
                    className={`group grid min-h-[68px] min-w-[1160px] cursor-pointer items-center gap-x-4 py-3 pl-4 pr-0 transition-colors ${isParentSelected ? 'bg-violet-50' : 'bg-white hover:bg-slate-50'}`}
                    style={{ gridTemplateColumns: parentGridTemplateColumns }}
                    onClick={toggle}
                  >
                    <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    {supplyId !== '__none__' ? (
                      <input
                        type="checkbox"
                        title="Выбрать поставку"
                        aria-label={`Выбрать поставку ${supply?.name || supplyId}`}
                        checked={isParentSelected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={toggleParentSelection}
                        className="h-3.5 w-3.5 cursor-pointer rounded accent-violet-500"
                      />
                    ) : <span className="h-3.5 w-3.5" />}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{supplyId === '__none__' ? 'Без поставки' : (supply?.name || supplyId)}</p>
                    </div>
                    {supplyId === '__none__' ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <button
                        type="button"
                        title={copiedSupplyId === supplyId ? 'QR-код поставки скопирован' : 'Скопировать QR-код поставки'}
                        aria-label={copiedSupplyId === supplyId ? `QR-код поставки ${supplyId} скопирован` : `Скопировать QR-код поставки ${supplyId}`}
                        onClick={(event) => { event.stopPropagation(); void copySupplyId(supplyId) }}
                        className={`group inline-flex min-w-0 max-w-full cursor-copy items-center gap-1 rounded px-1 py-0.5 font-mono text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-200 ${copiedSupplyId === supplyId ? 'bg-emerald-100 text-emerald-700' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-600'}`}
                      >
                        <span className="truncate">{supplyId}</span>
                        {copiedSupplyId === supplyId ? (
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4L19 6" /></svg>
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
                        )}
                      </button>
                    )}
                    <div>{supplyId !== '__none__' && supply ? <SupplyWbStatus supply={supply} /> : <span className="text-xs text-slate-400">—</span>}</div>
                    <span className="text-xs text-slate-600">{scanTimestamp ?? '—'}</span>
                    <div className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800">{totalOrderCount}</span>
                      {supply?.done === true && (
                        <span className="block whitespace-nowrap text-[10px] text-slate-500">принято {acceptedOrders}/{totalOrderCount}</span>
                      )}
                    </div>
                    {supplyWarehouse ? (
                      <div className="min-w-0 leading-tight" title={supplyWarehouse.address ?? undefined}>
                        <div className="truncate text-xs font-semibold text-slate-700">{supplyWarehouse.officialName}</div>
                        <div className="mt-1 truncate text-[10px] text-slate-400">Ваш склад: {supplyWarehouse.sellerName}</div>
                      </div>
                    ) : <span className="text-xs text-slate-400">—</span>}
                    <div
                      className={`sticky right-0 z-[5] flex min-h-[44px] items-center justify-end gap-2 border-l border-slate-200 px-2 shadow-[-10px_0_18px_-16px_rgba(15,23,42,0.7)] ${isParentSelected ? 'bg-violet-50' : 'bg-white group-hover:bg-slate-50'}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {!isCompletedGroupedTab && supplyId !== '__none__' && supplyOrders.length > 0 && (
                        <button type="button" title="Распечатать стикеры поставки" aria-label="Распечатать стикеры поставки"
                          disabled={busyIds.size > 0 || !fbsPermissions.fbs_assembly}
                          onClick={() => openStickerPrintModal(supplyOrders, supply ?? { id: supplyId, name: supplyId }, 'supply')}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-wait disabled:opacity-40">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                        </button>
                      )}
                      {isDeliveringTab && supplyId !== '__none__' && supplyOrders.length > 0 && (
                          <button
                            type="button"
                            title="Распечатать официальный QR поставки WB"
                            aria-label="Распечатать официальный QR поставки WB"
                            disabled={supplyQrBusyIds.has(supplyId) || !fbsPermissions.fbs_assembly}
                            onClick={() => void handleSupplyQrPrint(supplyId)}
                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-violet-200 bg-violet-50 text-violet-700 transition hover:bg-violet-100 disabled:cursor-wait disabled:opacity-40"
                          >
                            {supplyQrBusyIds.has(supplyId) ? (
                              <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" strokeDasharray="28" strokeDashoffset="8" /></svg>
                            ) : (
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3z" />
                                <path d="M15 15h2v2h-2zM19 15h2v6h-6v-2M15 19h2" />
                              </svg>
                            )}
                          </button>
                      )}
                      {(isDeliveringTab || isCompletedGroupedTab) && supplyId !== '__none__' && (
                        <button
                          type="button"
                          title={isDeliveringTab ? 'Скачать акт приёмки WB — доступен после обработки поставки' : 'Скачать акт приёмки WB'}
                          aria-label={`Скачать акт приёмки поставки ${supplyId}`}
                          disabled={acceptanceActBusyIds.has(supplyId) || !fbsPermissions.fbs_view}
                          onClick={() => void handleAcceptanceActDownload(supplyId)}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-violet-200 bg-violet-50 text-violet-700 transition hover:bg-violet-100 disabled:cursor-wait disabled:opacity-40"
                        >
                          {acceptanceActBusyIds.has(supplyId) ? (
                            <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" strokeDasharray="28" strokeDashoffset="8" /></svg>
                          ) : (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <path d="M14 2v6h6M12 11v7m-3-3 3 3 3-3" />
                            </svg>
                          )}
                        </button>
                      )}
                      {isAssemblingTab && supplyId !== '__none__' && supplyOrders.length > 0 && (
                          <button type="button" title="Передать в доставку" aria-label="Передать поставку в доставку"
                            disabled={busyIds.size > 0 || !fbsPermissions.fbs_dispatch}
                            onClick={() => void openSupplyDispatchModal(supply ?? { id: supplyId, name: supplyId }, supplyOrders)}
                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-wait disabled:opacity-40">
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M5 12h14m-5-5 5 5-5 5" />
                            </svg>
                          </button>
                      )}
                      {isAssemblingTab && supplyId !== '__none__' && fbsPermissions.fbs_assembly && (
                        <button
                          type="button"
                          title={totalOrderCount > 0 ? 'Удалить можно только пустую поставку' : 'Удалить пустую поставку'}
                          aria-label="Удалить поставку"
                          disabled={busyIds.size > 0 || totalOrderCount > 0 || supply?.done === true}
                          onClick={() => setDeleteSupplyModal({
                            supply: supply ?? { id: supplyId, name: supplyId, done: false },
                            busy: false,
                            error: null,
                          })}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 disabled:opacity-70"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/></svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Аккордеон — заказы */}
                  <div style={{ display: 'grid', gridTemplateRows: isExpanded ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease' }}>
                    <div className="overflow-hidden">
                      {supplyOrders.length === 0 ? (
                        <div className="border-t border-slate-100 bg-slate-50/50 px-12 py-4 text-xs text-slate-400">В поставке пока нет заказов</div>
                      ) : <div className="border-t border-slate-100 bg-slate-50/50">
                        <table className="w-full min-w-[1160px] text-xs">
                          <thead className="border-b border-slate-200 bg-slate-100/70 text-slate-500">
                            <tr>
                              <th className="w-8 px-3 py-2">
                                <input
                                  type="checkbox"
                                  title="Выбрать все заказы поставки"
                                  aria-label="Выбрать все заказы поставки"
                                  ref={(element) => { if (element) element.indeterminate = someSupplySelected }}
                                  checked={allSupplySelected}
                                  onChange={() => toggleSupplySelection(supplyOrders)}
                                  className="h-3.5 w-3.5 cursor-pointer rounded accent-violet-500"
                                />
                              </th>
                              <th className="px-4 py-2 text-left font-semibold">Заказ</th>
                              <th className="px-4 py-2 text-left font-semibold">Товар</th>
                              <th className="px-4 py-2 text-left font-semibold">Адрес товара</th>
                              <th className="px-4 py-2 text-right font-semibold">Кол-во</th>
                              <th className="px-4 py-2 text-left font-semibold">Время</th>
                              <th className="px-4 py-2 text-left font-semibold">Склад FBS</th>
                              {isDeliveringTab && <th className="px-4 py-2 text-left font-semibold">Статус WB</th>}
                              <th className={`sticky right-0 z-10 border-l border-slate-200 bg-slate-100 px-4 py-2 text-left font-semibold shadow-[-10px_0_18px_-16px_rgba(15,23,42,0.7)] ${isCompletedGroupedTab ? '' : 'w-px whitespace-nowrap'}`}>{isCompletedGroupedTab ? 'Статус' : 'Действия'}</th>
                            </tr>
                          </thead>
                        <tbody>
                          {supplyOrders.map((order) => {
                            const sla = slaLabel(
                              order.ddate,
                              order.createdAt,
                              order.acceptedAt,
                              WB_ACCEPTED_ORDER_STATUSES.has(order.wbSystemStatus),
                            )
                            const isBusy = busyIds.has(order.id)
                            return (
                              <tr key={order.id} className="border-b border-slate-100 hover:bg-white transition-colors">
                                <td className="px-3 py-2 w-8">
                                  <input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleSupplyOrderSelection(order.id, supplyOrders)} className="h-3.5 w-3.5 rounded accent-violet-500 cursor-pointer" />
                                </td>
                                <td className="px-4 py-2">
                                  <OrderIdentityCell order={order} />
                                </td>
                                <td className="px-4 py-2">
                                  <div className="flex min-w-0 items-center gap-3">
                                    <PhotoThumb url={order.photoUrl} className="h-10 w-10 shrink-0 rounded-lg" />
                                    <div className="min-w-0">
                                      <a
                                        href={`https://www.wildberries.ru/catalog/${order.nmId}/detail.aspx`}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={order.productName || `Товар WB ${order.nmId}`}
                                        className="block truncate font-semibold text-slate-900 transition-colors hover:text-[#a73afd]"
                                      >
                                        {order.productName || `Товар WB ${order.nmId}`}
                                      </a>
                                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                                        {order.productBrand || '—'} · Арт. {order.productVendorCode || order.article || '—'} ·{' '}
                                        {order.productSize
                                          ? <>Р-р {order.productSize}</>
                                          : <span className="font-semibold text-red-500">Размер не определён</span>}
                                      </div>
                                      <KizStatusBadge order={order} />
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-2">
                                  <ProductLocationsCell order={order} />
                                  {isAssemblingTab && fbsPermissions.fbs_assembly && order.productLocations.length > 0 && (
                                    <button
                                      type="button"
                                      disabled={isBusy || !order.productLocations.some((location) => location.fbsEligible)}
                                      title={!order.productLocations.some((location) => location.fbsEligible) ? 'Сначала назначьте коробу внутренний склад с включённым режимом FBS' : undefined}
                                      onClick={() => { setBoxSelectionMode('bind'); setBoxScanValue(''); setBoxSelectionOrder(order) }}
                                      className={`mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold transition disabled:cursor-wait disabled:opacity-40 ${order.stockAllocation?.status === 'reserved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'}`}
                                    >
                                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>
                                      {order.stockAllocation?.status === 'reserved' ? 'Изменить короб' : 'Взять из короба'}
                                    </button>
                                  )}
                                </td>
                                <td className="px-4 py-2">
                                  <FbsStockQuantityCell order={order} />
                                </td>
                                <td className={`px-4 py-2 whitespace-nowrap ${sla.cls}`}>{sla.text}</td>
                                <td className="max-w-48 px-4 py-2">{renderWbWarehouseCell(order)}</td>
                                {isDeliveringTab && (
                                  <td className="px-4 py-2">
                                    <WbOrderStatusBadge order={order} />
                                  </td>
                                )}
                                <td className={`sticky right-0 z-[4] border-l border-slate-200 bg-slate-50 px-4 py-2 shadow-[-10px_0_18px_-16px_rgba(15,23,42,0.7)] ${isCompletedGroupedTab ? '' : 'w-px whitespace-nowrap'}`}>
                                  <div className="flex items-center justify-center gap-1.5">
                                    {isAssemblingTab && fbsPermissions.fbs_assembly && supplyId !== '__none__' && (
                                      <button
                                        type="button"
                                        title="Перенести в другую поставку"
                                        disabled={isBusy}
                                        onClick={() => void openAssembleModal([order.id], 'existing', 'move', [supplyId])}
                                        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-wait disabled:opacity-40"
                                      >
                                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3" />
                                        </svg>
                                      </button>
                                    )}
                                    {!isCompletedGroupedTab && fbsPermissions.fbs_assembly && (
                                      <button type="button" title="Выбрать стикеры для печати" disabled={isBusy} onClick={() => openStickerPrintModal([order], null, 'selected')}
                                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 disabled:opacity-40 transition">
                                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                                      </button>
                                    )}
                                    {isCompletedGroupedTab && (
                                      <span className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                                        order.wbSystemStatus === 'sold'
                                          ? 'bg-emerald-100 text-emerald-700'
                                          : order.wbSystemStatus === 'defect'
                                            ? 'bg-rose-100 text-rose-700'
                                            : 'bg-orange-100 text-orange-700'
                                      }`}>
                                        {completedOrderStatusLabel(order)}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        </table>
                        {selectedSupplyOrders.length > 0 && !isCompletedGroupedTab && (
                          <>
                          <div className="pointer-events-none fixed inset-0 z-30 bg-slate-950/10" />
                          <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_12px_40px_rgba(15,23,42,0.24)]">
                            <span className="whitespace-nowrap px-2 text-xs font-semibold text-slate-700">
                              Выбрано: {selectedSupplyOrders.length} из {supplyOrders.length}
                            </span>
                            <button
                              type="button"
                              disabled={busyIds.size > 0}
                              onClick={() => openStickerPrintModal(selectedSupplyOrders, null, 'selected')}
                              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-wait disabled:opacity-40"
                            >
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                              Печать
                            </button>
                            {isAssemblingTab && fbsPermissions.fbs_assembly && supplyId !== '__none__' && (
                              <button
                                type="button"
                                disabled={busyIds.size > 0}
                                onClick={() => void openAssembleModal(selectedSupplyOrders.map((order) => order.id), 'existing', 'move', [supplyId])}
                                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-blue-200 px-3 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 disabled:cursor-wait disabled:opacity-40"
                              >
                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14m-5-5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                Перенести
                              </button>
                            )}
                            <div className="relative">
                              <button
                                type="button"
                                disabled={busyIds.size > 0}
                                onClick={() => setPickingListMenuOpen((open) => !open)}
                                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-wait disabled:opacity-40"
                              >
                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                                Лист подбора
                                <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${pickingListMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              </button>
                              {pickingListMenuOpen && (
                                <div className="absolute bottom-11 right-0 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                                  <button type="button" onClick={() => void handlePickingList('pdf', selectedSupplyOrders, supplyId)} className="w-full cursor-pointer px-4 py-2.5 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50">Открыть в PDF</button>
                                  <button type="button" onClick={() => void handlePickingList('excel', selectedSupplyOrders, supplyId)} className="w-full cursor-pointer px-4 py-2.5 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50">Скачать в Excel</button>
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              title="Снять выбор"
                              aria-label="Снять выбор"
                              onClick={() => { setSelected(new Set()); setPickingListMenuOpen(false) }}
                              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round"/></svg>
                            </button>
                          </div>
                          </>
                        )}
                      </div>}
                    </div>
                  </div>
                </div>
              )
            })}
            {selectedParentCount > 0 && (
              <>
                <div className="pointer-events-none fixed inset-0 z-30 bg-slate-950/10" />
                <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_12px_40px_rgba(15,23,42,0.24)]">
                  <span className="whitespace-nowrap px-2 text-xs font-semibold text-slate-700">
                    Выбрано поставок: {selectedParentCount}
                  </span>
                  {!isCompletedGroupedTab && selectedParentEntry && selectedParentEntry[1].orders.length > 0 && (
                    <button
                      type="button"
                      disabled={busyIds.size > 0}
                      onClick={() => {
                        const [supplyId, group] = selectedParentEntry
                        openStickerPrintModal(group.orders, group.supply ?? { id: supplyId, name: supplyId }, 'supply')
                      }}
                      className="flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-wait disabled:opacity-40"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                      Печать
                    </button>
                  )}
                  {isAssemblingTab && fbsPermissions.fbs_dispatch && selectedParentEntry && selectedParentEntry[1].orders.length > 0 && (
                    <button
                      type="button"
                      disabled={busyIds.size > 0}
                      onClick={() => {
                        const [supplyId, group] = selectedParentEntry
                        void openSupplyDispatchModal(group.supply ?? { id: supplyId, name: supplyId }, group.orders)
                      }}
                      className="flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-emerald-200 px-3 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-40"
                    >
                      Передать в доставку
                    </button>
                  )}
                  <button
                    type="button"
                    title="Снять выбор поставок"
                    aria-label="Снять выбор поставок"
                    onClick={() => setSelectedSupplyIds(new Set())}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round"/></svg>
                  </button>
                </div>
              </>
            )}
            </div>
          </div>
        )
      })()}

      {tabOrders.length > 0 && activeTab !== 'assembling' && activeTab !== 'delivering' && !(activeTab === 'completed' && groupCompletedBySupplies) && (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="h-full w-full overflow-auto overscroll-contain [scrollbar-gutter:stable]">
            <table className="w-full min-w-[1100px] text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white">
              <tr>
                {activeTab !== 'completed' && activeTab !== 'cancelled' && (
                  <th className="px-3 py-3">
                    <input type="checkbox" checked={allTabSelected} onChange={toggleAll}
                      className="h-3.5 w-3.5 translate-x-[30px] rounded accent-violet-500 cursor-pointer" />
                  </th>
                )}
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Заказ</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Товар</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Адрес товара</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-500">Кол-во</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Склад FBS</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Время</th>
                <th className="sticky right-0 z-20 border-l border-slate-200 bg-white px-4 py-3 text-left font-semibold text-slate-500 shadow-[-10px_0_18px_-16px_rgba(15,23,42,0.7)]">{activeTab === 'completed' || activeTab === 'cancelled' ? 'Статус' : 'Действия'}</th>
              </tr>
            </thead>
            <tbody>
              {tabOrders.map((order) => {
                const sla = slaLabel(
                  order.ddate,
                  order.createdAt,
                  order.acceptedAt,
                  WB_ACCEPTED_ORDER_STATUSES.has(order.wbSystemStatus),
                )
                const isBusy = busyIds.has(order.id)
                const isChecked = selected.has(order.id)
                return (
                  <tr key={order.id}
                    className={`border-b border-slate-100 transition ${isChecked ? 'bg-violet-50' : 'hover:bg-slate-50'}`}>
                    {activeTab !== 'completed' && activeTab !== 'cancelled' && (
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(order.id)}
                          className="h-3.5 w-3.5 translate-x-[30px] rounded accent-violet-500 cursor-pointer" />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <OrderIdentityCell order={order} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <PhotoThumb url={order.photoUrl} className="h-12 w-12 shrink-0 rounded-lg" />
                        <div className="min-w-0">
                          <a
                            href={`https://www.wildberries.ru/catalog/${order.nmId}/detail.aspx`}
                            target="_blank"
                            rel="noreferrer"
                            title={order.productName || `Товар WB ${order.nmId}`}
                            className="block truncate font-semibold text-slate-900 transition-colors hover:text-[#a73afd]"
                          >
                            {order.productName || `Товар WB ${order.nmId}`}
                          </a>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500">
                            {order.productBrand || '—'} · Арт. {order.productVendorCode || order.article || '—'} ·{' '}
                            {order.productSize
                              ? <>Р-р {order.productSize}</>
                              : <span className="font-semibold text-red-500">Размер не определён</span>}
                          </div>
                          <KizStatusBadge order={order} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ProductLocationsCell order={order} />
                    </td>
                    <td className="px-4 py-3"><FbsStockQuantityCell order={order} /></td>
                    <td className="max-w-48 px-4 py-3">{renderWbWarehouseCell(order)}</td>
                    <td className={`px-4 py-3 whitespace-nowrap ${sla.cls}`}>{sla.text}</td>
                    <td className={`sticky right-0 z-[4] border-l border-slate-200 px-4 py-3 shadow-[-10px_0_18px_-16px_rgba(15,23,42,0.7)] ${isChecked ? 'bg-violet-50' : 'bg-white'}`}>
                      <div className="flex items-center gap-1.5">
                        {order.stockAllocation?.requiresReview && (
                          <span title={order.stockAllocation.reviewReason ?? undefined} className="whitespace-nowrap rounded-lg bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                            Проверить учёт
                          </span>
                        )}
                        {/* Действия для Новых — 3-точечное меню */}
                        {activeTab === 'pending' && fbsPermissions.fbs_assembly && (
                          <div className="relative">
                            <button type="button" disabled={isBusy}
                              onClick={(e) => { e.stopPropagation(); setOrderMenuId(orderMenuId === order.id ? null : order.id) }}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 disabled:opacity-40 transition">
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
                            </button>
                            {orderMenuId === order.id && (
                              <div className="absolute right-0 top-8 z-50 w-52 rounded-2xl border border-slate-200 bg-white shadow-xl py-1" onClick={(e) => e.stopPropagation()}>
                                <button type="button"
                                  onClick={() => { setOrderMenuId(null); void openAssembleModal([order.id], 'new') }}
                                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                                  Создать поставку
                                </button>
                                <button type="button"
                                  onClick={() => { setOrderMenuId(null); void openAssembleModal([order.id], 'existing') }}
                                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><path d="m15 14 5 5"/><path d="m20 14-5 5"/></svg>
                                  Добавить к созданной
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {activeTab === 'completed' && (
                          <span className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                            order.wbSystemStatus === 'sold'
                              ? 'bg-emerald-100 text-emerald-700'
                              : order.wbSystemStatus === 'defect'
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-orange-100 text-orange-700'
                          }`}>
                            {completedOrderStatusLabel(order)}
                          </span>
                        )}
                        {activeTab === 'cancelled' && (
                          <>
                            <span className="whitespace-nowrap rounded-lg bg-orange-100 px-2.5 py-1 text-[11px] font-semibold text-orange-700">
                              {completedOrderStatusLabel(order)}
                            </span>
                            {fbsPermissions.fbs_assembly && ['reserved', 'awaiting_wb'].includes(order.stockAllocation?.status ?? '') && (
                              <button
                                type="button"
                                disabled={isBusy}
                                title="Фактически принять товар обратно: выбрать короб из списка или отсканировать QR любого целевого FBS-короба"
                                onClick={() => { setBoxSelectionMode('return'); setBoxScanValue(''); setBoxSelectionOrder(order) }}
                                className="h-7 whitespace-nowrap rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Принять обратно
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Клик вне меню — закрываем */}
      {orderMenuId !== null && (
        <div className="fixed inset-0 z-40" onClick={() => setOrderMenuId(null)} />
      )}

      {deleteSupplyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          onClick={() => { if (!deleteSupplyModal.busy) setDeleteSupplyModal(null) }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="px-6 pb-3 pt-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/></svg>
              </div>
              <h2 className="text-lg font-bold text-slate-900">Удалить пустую поставку?</h2>
              <p className="mt-2 text-sm leading-5 text-slate-500">
                «{deleteSupplyModal.supply.name}» будет удалена в Wildberries и исчезнет из ELESTET.
              </p>
              <p className="mt-2 font-mono text-xs text-slate-400">{deleteSupplyModal.supply.id}</p>
              {deleteSupplyModal.error && (
                <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">{deleteSupplyModal.error}</div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 pb-6 pt-3">
              <button type="button" disabled={deleteSupplyModal.busy} onClick={() => setDeleteSupplyModal(null)} className="h-10 cursor-pointer rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-40">Отмена</button>
              <button type="button" disabled={deleteSupplyModal.busy} onClick={() => void handleDeleteSupply()} className="flex h-10 min-w-28 cursor-pointer items-center justify-center gap-2 rounded-xl bg-red-500 px-4 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-wait disabled:opacity-50">
                {deleteSupplyModal.busy && <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" strokeDasharray="28" strokeDashoffset="8"/></svg>}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {boxSelectionOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => { if (!boxSelectionBusy) setBoxSelectionOrder(null) }}>
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{boxSelectionMode === 'return' ? 'Принять товар обратно' : 'Взять товар из короба'}</h2>
                <p className="mt-1 text-sm text-slate-500">Заказ № {boxSelectionOrder.id} · {boxSelectionOrder.productName || `Товар WB ${boxSelectionOrder.nmId}`}</p>
              </div>
              <button type="button" disabled={boxSelectionBusy} title="Закрыть" onClick={() => setBoxSelectionOrder(null)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:opacity-40">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="border-b border-slate-100 px-6 py-4">
              <p className="mb-2 text-xs font-semibold text-slate-600">
                {boxSelectionMode === 'return'
                  ? 'Выберите короб с этим товаром или отсканируйте QR любого фактического целевого короба'
                  : 'Выберите исходный короб мышкой или отсканируйте его QR'}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  autoFocus
                  value={boxScanValue}
                  onChange={(event) => setBoxScanValue(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void reserveScannedBox() } }}
                  placeholder="QR короба"
                  disabled={boxSelectionBusy}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
                <button type="button" disabled={!boxScanValue.trim() || boxSelectionBusy} onClick={() => void reserveScannedBox()} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
                  {boxSelectionMode === 'return' ? 'Принять' : 'Взять'}
                </button>
              </div>
              {boxSelectionMode === 'bind' && boxSelectionOrder.stockAllocation?.status === 'reserved' && (
                <button
                  type="button"
                  disabled={boxSelectionBusy}
                  onClick={() => void releaseOrderBoxReservation(boxSelectionOrder)}
                  className="mt-3 inline-flex cursor-pointer items-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-wait disabled:opacity-40"
                >
                  Вернуть в исходный короб
                </button>
              )}
            </div>
            <div className="space-y-2 overflow-y-auto px-6 py-5">
              {boxSelectionOrder.productLocations.map((location) => {
                const isCurrent = ['reserved', 'awaiting_wb'].includes(boxSelectionOrder.stockAllocation?.status ?? '')
                  && boxSelectionOrder.stockAllocation?.boxItemId === location.boxItemId
                const canSelect = location.fbsEligible
                  && (boxSelectionMode === 'return' || location.quantity > 0 || isCurrent)
                return (
                  <button
                    key={location.boxItemId}
                    type="button"
                    disabled={!canSelect || boxSelectionBusy}
                    onClick={() => void applySelectedBox(boxSelectionOrder, location)}
                    className={`flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition ${isCurrent ? 'border-emerald-300 bg-emerald-50' : canSelect ? 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/50' : 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-55'}`}
                  >
                    <span className="min-w-0">
                      <span className={`block truncate font-semibold ${location.isAddressed ? 'text-violet-700' : 'text-amber-600'}`}>{productLocationAddress(location) ?? 'Без адреса'}</span>
                      <span className="mt-1 block text-xs text-slate-500">P-{location.batchNumber} · S-{location.supplyNumber} · Короб {location.boxNumber}</span>
                      <span className="mt-0.5 block font-mono text-[11px] text-slate-400">{location.boxBarcode}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block text-sm font-bold ${canSelect ? 'text-slate-900' : 'text-red-500'}`}>{location.quantity} в коробе</span>
                      {!location.fbsEligible && <span className="mt-1 block text-[10px] font-bold text-amber-600">НАЗНАЧЬТЕ FBS-СКЛАД</span>}
                      {isCurrent && <span className="mt-1 block text-[10px] font-bold text-emerald-600">ВЫБРАН ДЛЯ ЗАКАЗА</span>}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="border-t border-slate-100 px-6 py-4 text-xs text-slate-500">
              {boxSelectionMode === 'return'
                ? 'После подтверждения 1 шт. будет добавлена в выбранный короб, а привязка к заказу закроется. Повторная приёмка этого заказа количество не увеличит.'
                : 'После выбора 1 шт. сразу удаляется из исходного короба и привязывается к заказу. Отмена заказа сама товар в короб не возвращает.'}
            </div>
          </div>
        </div>
      )}

      {dispatchModal && (() => {
        const shippingBusy = dispatchModal.orders.some((order) => busyIds.has(order.id))
        const modalBusy = dispatchModal.busy || shippingBusy
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            onClick={() => { if (!modalBusy) setDispatchModal(null) }}
          >
            <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-slate-900">Подготовить поставку к передаче</h2>
                  <p className="mt-1 truncate text-sm text-slate-500">{dispatchModal.supply.name} · {dispatchModal.orders.length} заказов</p>
                </div>
                <button
                  type="button"
                  title="Закрыть"
                  aria-label="Закрыть"
                  disabled={modalBusy}
                  onClick={() => setDispatchModal(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:cursor-wait disabled:opacity-40"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg>
                </button>
              </div>

              <div className="overflow-y-auto px-6 py-5">
                <p className="mb-3 text-sm font-semibold text-slate-800">Куда повезёте поставку?</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={modalBusy || dispatchModal.loading}
                    onClick={() => setDispatchModal((current) => current ? { ...current, destination: 'pvz', error: null } : current)}
                    className={`rounded-2xl border p-4 text-left transition ${dispatchModal.destination === 'pvz' ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-100' : 'border-slate-200 hover:border-violet-200 hover:bg-violet-50/50'}`}
                  >
                    <span className="block text-sm font-bold text-slate-900">В ПВЗ</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">Нужен отдельный QR на каждый транспортировочный короб.</span>
                  </button>
                  <button
                    type="button"
                    disabled={modalBusy || dispatchModal.loading}
                    onClick={() => setDispatchModal((current) => current ? { ...current, destination: 'warehouse', error: null } : current)}
                    className={`rounded-2xl border p-4 text-left transition ${dispatchModal.destination === 'warehouse' ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/50'}`}
                  >
                    <span className="block text-sm font-bold text-slate-900">На склад или в СЦ</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">Грузоместа не нужны. После передачи появится общий QR поставки.</span>
                  </button>
                </div>

                {dispatchModal.loading ? (
                  <div className="py-10 text-center text-sm text-slate-400">Проверяем грузоместа в Wildberries…</div>
                ) : dispatchModal.destination === 'pvz' ? (
                  <div className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">Грузоместа: {dispatchModal.boxes.length}</p>
                        <p className="mt-1 text-xs text-slate-500">1 грузоместо = 1 транспортировочный короб. Раскладывать заказы по коробам в системе не нужно.</p>
                      </div>
                      {dispatchModal.boxes.length > 0 && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={modalBusy}
                            onClick={() => void printSupplyBoxes(dispatchModal.boxes)}
                            className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-wait disabled:opacity-40"
                          >
                            Распечатать все QR
                          </button>
                          <button
                            type="button"
                            disabled={modalBusy}
                            onClick={() => void deleteSupplyBoxes(dispatchModal.boxes)}
                            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-40"
                          >
                            Удалить все
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={dispatchModal.amount}
                        disabled={modalBusy}
                        onChange={(event) => setDispatchModal((current) => current ? { ...current, amount: event.target.value, error: null } : current)}
                        className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        aria-label="Количество новых грузомест"
                      />
                      <button
                        type="button"
                        disabled={modalBusy || !dispatchModal.amount}
                        onClick={() => void addSupplyBoxes()}
                        className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-40"
                      >
                        Добавить короба
                      </button>
                    </div>

                    {dispatchModal.boxes.length > 0 && (
                      <div className="mt-4 max-h-48 space-y-2 overflow-y-auto">
                        {dispatchModal.boxes.map((boxId, index) => (
                          <div key={boxId} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600">Короб {index + 1}: {boxId}</span>
                            <button type="button" disabled={modalBusy} onClick={() => void printSupplyBoxes([boxId])} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-violet-600 transition hover:bg-violet-50 disabled:opacity-40">QR</button>
                            <button type="button" disabled={modalBusy} onClick={() => void deleteSupplyBoxes([boxId])} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-500 transition hover:bg-red-50 disabled:opacity-40">Удалить</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : dispatchModal.destination === 'warehouse' ? (
                  <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">
                    Передадим поставку в доставку. Затем на вкладке «В доставке» можно распечатать официальный QR поставки для склада или СЦ.
                  </div>
                ) : null}

                {dispatchModal.error && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{dispatchModal.error}</div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
                <button type="button" disabled={modalBusy} onClick={() => setDispatchModal(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-40">Отмена</button>
                <button
                  type="button"
                  disabled={modalBusy || dispatchModal.loading || !dispatchModal.destination || (dispatchModal.destination === 'pvz' && dispatchModal.boxes.length === 0)}
                  onClick={() => void deliverFromDispatchModal()}
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {shippingBusy ? 'Передаём…' : dispatchModal.destination === 'pvz' ? 'Передать грузоместа в доставку' : 'Передать поставку в доставку'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {kizScannerOpen && selectedStoreId && (
        <FbsKizScannerModal
          accountId={workingAccountId}
          storeId={selectedStoreId}
          storeName={storesWithKey.find((store) => store.id === selectedStoreId)?.name ?? 'Магазин WB'}
          orders={orders}
          onKizStatesUpdated={async () => { await readFromDb() }}
          onClose={() => setKizScannerOpen(false)}
        />
      )}

      {/* Выбор комплекта стикеров */}
      {stickerPrintModal && (() => {
        const printOptions: Array<{
          key: keyof StickerPrintOptions
          title: string
          badge: string
          description: string
        }> = [
          ...(stickerPrintModal.mode === 'supply' ? [{
            key: 'supply' as const,
            title: 'Данные о поставке',
            badge: 'Не нужно клеить',
            description: 'Дата, название и итоговое количество товаров в поставке.',
          }] : []),
          {
            key: 'picking',
            title: 'Информация о товаре',
            badge: 'Не нужно клеить',
            description: 'Количество, название, размер, артикул WB и баркод для подбора.',
          },
          {
            key: 'locations',
            title: 'Адрес товара',
            badge: 'Для сборки',
            description: 'Все складские адреса товара, а для коробов без размещения — партия, поставка и короб.',
          },
          {
            key: 'productBarcode',
            title: 'Штрихкод товара',
            badge: 'Необязательно',
            description: 'Товарный баркод и краткая информация для внутреннего сканирования.',
          },
          {
            key: 'wb',
            title: 'Стикер WB',
            badge: 'Обязательно для доставки',
            description: 'Официальный уникальный стикер заказа, полученный от Wildberries.',
          },
        ]
        const pageCount = stickerPageCount(stickerPrintModal)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setStickerPrintModal(null)}>
            <div className="w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Распечатать стикеры</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {stickerPrintModal.mode === 'supply'
                      ? `${stickerPrintModal.supply?.name || 'Поставка'} · ${stickerPrintModal.orders.length} заказов`
                      : `Выбрано заказов: ${stickerPrintModal.orders.length}`}
                  </p>
                </div>
                <button type="button" title="Закрыть" aria-label="Закрыть" onClick={() => setStickerPrintModal(null)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round"/></svg>
                </button>
              </div>
              <div className="space-y-2 px-6 py-5">
                {printOptions.map((option) => {
                  const checked = stickerPrintModal.options[option.key]
                  return (
                    <label key={option.key} className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition ${checked ? 'border-violet-200 bg-violet-50/60' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setStickerPrintModal((current) => {
                          if (!current) return null
                          const nextValue = !current.options[option.key]
                          const nextOptions = { ...current.options, [option.key]: nextValue }
                          saveStickerPrintOptions(workingAccountId, {
                            ...loadStickerPrintOptions(workingAccountId),
                            [option.key]: nextValue,
                          })
                          return { ...current, options: nextOptions }
                        })}
                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-violet-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{option.title}</span>
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${option.key === 'wb' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>{option.badge}</span>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
                <span className="text-sm font-semibold text-slate-700">Итого: {pageCount} стикеров</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStickerPrintModal(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50">Отмена</button>
                  <button type="button" disabled={pageCount === 0} onClick={() => void handleCombinedStickerPrint()} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    Распечатать
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Модалка выбора поставки */}
      {assembleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAssembleModal(null)}>
          <div className="flex w-[50vw] flex-col rounded-3xl bg-white shadow-2xl overflow-hidden" style={{ height: '90vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-2">
              <h2 className="text-base font-semibold text-slate-800 mb-4 pt-5">
                {assembleModal.mode === 'move' ? 'Перенести' : 'В сборку'} ({assembleModal.ids.length} заказ{assembleModal.ids.length > 1 ? 'а' : ''})
              </h2>
              {/* Табы */}
              <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 mb-4">
                {(['new', 'existing'] as const).map((tab) => (
                  <button key={tab} type="button"
                    onClick={() => setAssembleTab(tab)}
                    className={`flex-1 cursor-pointer rounded-xl py-2 text-sm font-medium transition-colors ${assembleTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {tab === 'new'
                      ? 'Создать поставку'
                      : assembleModal.mode === 'move' ? 'Выбрать существующую' : 'Добавить к созданной'}
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
                  ) : availableAssemblySupplies.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-400">
                      {selectedWarehouseFilter === ALL_WAREHOUSES_FILTER
                        ? 'Нет подходящих открытых поставок на WB'
                        : 'Для выбранного склада нет подходящих открытых поставок'}
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(10rem,0.8fr)_6rem] items-center gap-4 px-4 pb-1 text-xs font-medium text-slate-400">
                        <span>Поставка</span>
                        <span>Склад</span>
                        <span className="text-right">Заказов</span>
                      </div>
                      {availableAssemblySupplies.map((sup) => {
                        const warehouse = supplyWarehouseInfo(sup)
                        return (
                          <button key={sup.id} type="button"
                            onClick={() => void handleAssemble(assembleModal.ids, sup.id)}
                            className="grid w-full grid-cols-[minmax(0,1fr)_minmax(10rem,0.8fr)_6rem] items-center gap-4 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-violet-50">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-800">{sup.name}</p>
                              <p className="truncate font-mono text-xs text-slate-400">{sup.id}</p>
                            </div>
                            <div className="min-w-0">
                              <p className={`truncate text-xs font-medium ${warehouse.unassigned ? 'text-violet-600' : 'text-slate-700'}`}>{warehouse.officialName}</p>
                              <p className="truncate text-[11px] text-slate-400">{warehouse.sellerLine}</p>
                            </div>
                            <span className="text-right text-sm font-semibold tabular-nums text-slate-700">
                              {currentSupplyOrderCounts.get(sup.id) ?? 0}
                            </span>
                          </button>
                        )
                      })}
                    </>
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

      {assembleResultModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setAssembleResultModal(null)}>
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{assembleResultModal.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{assembleResultModal.message}</p>
              </div>
              <button type="button" aria-label="Закрыть" onClick={() => setAssembleResultModal(null)} className="shrink-0 rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {assembleResultModal.failures.length > 0 && (
              <div className="mt-4 max-h-48 overflow-y-auto rounded-2xl bg-slate-50 px-4 py-2">
                {assembleResultModal.failures.map((failure) => (
                  <div key={failure.orderId} className="py-2 text-sm text-slate-700">
                    <span className="font-semibold">Заказ № {failure.orderId}</span>
                    {assembleResultModal.failures.length > 1 && <span className="ml-2 text-slate-500">{failure.message}</span>}
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={() => setAssembleResultModal(null)} className="mt-5 w-full rounded-2xl bg-violet-600 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700">
              Понятно
            </button>
          </div>
        </div>
      )}
      </>}
    </div>
  )
}
