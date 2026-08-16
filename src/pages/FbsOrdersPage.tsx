import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import jsPDF from 'jspdf'
import JsBarcode from 'jsbarcode'
import { supabase } from '../lib/supabase'
import { PhotoThumb } from '../components/ui/PhotoThumb'
import { triggerSync as triggerProductSync } from '../services/productService'
import type { Product, Store } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FbsOrder {
  id: string
  rid: string
  createdAt: string
  ddate: string
  warehouseId: number
  officeId: number
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
  shipStatus: TabKey
  supplierStatus: string
  wbSystemStatus: string
  isInLatestSnapshot: boolean
  supply_id: string | null
}

interface ProductLocation {
  productBarcode: string
  quantity: number
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

interface WbSupply {
  id: string
  name: string
  ordersCount?: number
  done?: boolean
  createdAt?: string
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

function productLocationQuantity(locations: ProductLocation[]): number {
  return locations.reduce((total, location) => total + location.quantity, 0)
}

function OrderIdentityCell({ order }: { order: FbsOrder }) {
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
        <div className="font-semibold text-amber-500">Баркод не получен</div>
        <div className="mt-0.5 text-[11px] text-slate-400">Невозможно найти товар на складе</div>
      </div>
    )
  }

  if (locations.length === 0) {
    return (
      <div>
        <div className="font-semibold text-amber-500">Не найден</div>
        <div className="mt-0.5 text-[11px] text-slate-500">Товара нет ни в одном коробе</div>
        <div className="mt-0.5 font-mono text-[11px] text-slate-400">{barcode}</div>
      </div>
    )
  }

  const renderLocation = (location: ProductLocation) => (
    <div key={`${location.boxBarcode}-${location.productBarcode}`} className="min-w-0 py-0.5">
      <div className={`truncate font-semibold ${location.isAddressed ? 'text-violet-700' : 'text-amber-500'}`} title={productLocationAddress(location) ?? 'Короб ещё не размещён в WMS'}>
        {productLocationAddress(location) ?? 'Без адреса'}
      </div>
      <div className="truncate text-[11px] text-slate-500" title={`P-${location.batchNumber} · S-${location.supplyNumber} · Короб ${location.boxNumber} · ${location.quantity} шт.`}>
        P-{location.batchNumber} · S-{location.supplyNumber} · Короб {location.boxNumber} · {location.quantity} шт.
      </div>
    </div>
  )

  const visibleLocations = locations.slice(0, 2)
  const hiddenLocations = locations.slice(2)

  return (
    <div>
      {visibleLocations.map(renderLocation)}
      {hiddenLocations.length > 0 && (
        <details className="mt-0.5">
          <summary className="cursor-pointer select-none text-[11px] font-semibold text-violet-600 hover:text-violet-700">
            Ещё {hiddenLocations.length} {hiddenLocations.length === 1 ? 'короб' : 'короба'}
          </summary>
          <div className="mt-1 border-l border-violet-200 pl-2">{hiddenLocations.map(renderLocation)}</div>
        </details>
      )}
      <div className="mt-0.5 font-mono text-[11px] text-slate-400">{barcode}</div>
    </div>
  )
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
  const locations = printableProductLocations(order)
  const { canvas, context } = createStickerCanvas()
  context.font = '700 34px Arial, sans-serif'
  context.fillText('Адрес товара', 24, 18)
  context.font = '700 23px Arial, sans-serif'
  const titleEnd = drawWrappedText(context, order.productName || `Товар WB ${order.nmId}`, 24, 66, 532, 27, 2)
  context.font = '400 20px Arial, sans-serif'
  const metaEnd = drawWrappedText(context, `Баркод: ${fbsOrderBarcode(order) || '—'} · Арт. WB: ${order.nmId}`, 24, titleEnd + 3, 532, 23, 2)
  const y = metaEnd + 20

  if (locations.length === 0) {
    context.font = '700 28px Arial, sans-serif'
    context.fillText('Не найден на складе', 24, y + 25)
    context.font = '400 22px Arial, sans-serif'
    context.fillText('Товара нет ни в одном актуальном коробе', 24, y + 67)
    return [textStickerPage(canvas)]
  }

  const bestLocation = locations[0]
  context.font = '700 28px Arial, sans-serif'
  const addressEnd = drawWrappedText(context, productLocationAddress(bestLocation) ?? 'Без адреса', 24, y, 532, 32, 2)
  context.font = '400 22px Arial, sans-serif'
  const detailsEnd = drawWrappedText(
    context,
    `P-${bestLocation.batchNumber} · S-${bestLocation.supplyNumber} · Короб ${bestLocation.boxNumber} · ${bestLocation.quantity} шт.`,
    24,
    addressEnd + 5,
    532,
    26,
    2,
  )
  const remainingBoxes = locations.length - 1
  if (remainingBoxes > 0) {
    context.font = '700 25px Arial, sans-serif'
    context.fillText(`Ещё ${remainingBoxes} ${boxCountWord(remainingBoxes)}`, 24, detailsEnd + 22)
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

type TabKey = 'pending' | 'assembling' | 'delivering' | 'completed' | 'cancelled' | 'archive'

function tabForOfficialWbStatus(
  supplierStatus: string,
  wbSystemStatus: string,
  isInLatestSnapshot: boolean,
): TabKey {
  if (!isInLatestSnapshot) return 'archive'
  if (supplierStatus === 'new' && wbSystemStatus === 'waiting') return 'pending'
  if (supplierStatus === 'confirm' && wbSystemStatus === 'waiting') return 'assembling'
  if (supplierStatus === 'cancel' || wbSystemStatus === 'declined_by_client' || wbSystemStatus === 'canceled') return 'cancelled'
  if (wbSystemStatus === 'sold' || wbSystemStatus === 'canceled_by_client' || wbSystemStatus === 'defect') return 'completed'
  if (supplierStatus === 'complete') return 'delivering'
  return 'archive'
}

interface Props {
  stores: Store[]
  accountId: string
}

export function FbsOrdersPage({ stores, accountId }: Props) {
  const storesWithKey = useMemo(() => stores.filter((s) => s.api_key), [stores])

  const lsKey = `fbs_store_${accountId}`
  const tabLsKey = `fbs_tab_${accountId}`
  // localStorage хранит только настройки интерфейса. Статусы заказов всегда приходят из WB.

  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    const saved = localStorage.getItem(lsKey)
    return (saved && storesWithKey.some((s) => s.id === saved)) ? saved : (storesWithKey[0]?.id ?? '')
  })
  const [orders, setOrders] = useState<FbsOrder[]>([])
  const [wbWarehouses, setWbWarehouses] = useState<WbWarehouse[]>([])
  const [wbOffices, setWbOffices] = useState<WbOffice[]>([])
  const [loading, setLoading] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const saved = localStorage.getItem(tabLsKey)
    return (['pending','assembling','delivering','completed','cancelled','archive'].includes(saved ?? '') ? saved : 'pending') as TabKey
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [assembleModal, setAssembleModal] = useState<{ ids: string[]; mode: 'assemble' | 'move'; sourceSupplyIds: string[] } | null>(null)
  const [assembleTab, setAssembleTab] = useState<'new' | 'existing'>('new')
  const [newSupplyName, setNewSupplyName] = useState('')
  const [openSupplies, setOpenSupplies] = useState<WbSupply[]>([])
  const [loadingSupplies, setLoadingSupplies] = useState(false)
  const [orderMenuId, setOrderMenuId] = useState<string | null>(null)
  const [expandedSupplyIds, setExpandedSupplyIds] = useState<Set<string>>(new Set())
  const [pickingListMenuOpen, setPickingListMenuOpen] = useState(false)
  const [stickerPrintModal, setStickerPrintModal] = useState<StickerPrintModal | null>(null)
  const [syncingProducts, setSyncingProducts] = useState(false)
  const [productSyncNotice, setProductSyncNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const syncInFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  const selectedStoreIdRef = useRef(selectedStoreId)
  const lastSyncedAtRef = useRef<Date | null>(null)
  selectedStoreIdRef.current = selectedStoreId

  useEffect(() => {
    setPickingListMenuOpen(false)
  }, [selected])

  // Склад продавца и связанный официальный пункт приёмки FBS загружаются одним запросом.
  useEffect(() => {
    if (!selectedStoreId) return
    void invokeFbs(selectedStoreId, { action: 'get_wb_warehouse_directory' })
      .then((data) => {
        setWbWarehouses((data.warehouses ?? []) as WbWarehouse[])
        setWbOffices((data.offices ?? []) as WbOffice[])
      })
      .catch(() => {
        setWbWarehouses([])
        setWbOffices([])
      })
  }, [selectedStoreId])

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
      p_account_id: accountId,
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
      }
      locationsByBarcode.set(barcode, [...(locationsByBarcode.get(barcode) ?? []), location])
    }
    return productEnriched.map((order) => ({
      ...order,
      productLocations: (order.productBarcode ? locationsByBarcode.get(order.productBarcode) : undefined)
        ?? order.skus.flatMap((sku) => locationsByBarcode.get(sku) ?? []),
    }))
  }, [accountId, selectedStoreId])

  // Читаем заказы из fbs_orders (Supabase DB)
  const readFromDb = useCallback(async () => {
    if (!supabase || !selectedStoreId) return
    const rows: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data: pageRows, error: pageError } = await (supabase as any)
        .from('fbs_orders')
        .select('*')
        .eq('store_id', selectedStoreId)
        .order('created_at', { ascending: false })
        .range(from, from + 999)
      if (pageError) throw pageError
      rows.push(...(pageRows ?? []))
      if ((pageRows ?? []).length < 1000) break
    }

    const mapped: FbsOrder[] = (rows ?? []).map((row: any) => {
      const d = row.data ?? {}
      const supplierStatus = String(row.supplier_status ?? row.wb_status ?? '')
      const wbSystemStatus = String(row.wb_system_status ?? '')
      const isInLatestSnapshot = row.is_in_latest_snapshot !== false
      return {
        id: String(row.wb_order_id),
        rid: d.rid ?? row.rid ?? '',
        createdAt: row.created_at ?? '',
        ddate: row.ddate ?? '',
        warehouseId: row.warehouse_id ?? d.warehouseId ?? 0,
        officeId: d.officeId ?? 0,
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
        shipStatus: tabForOfficialWbStatus(supplierStatus, wbSystemStatus, isInLatestSnapshot),
        supplierStatus,
        wbSystemStatus,
        isInLatestSnapshot,
        supply_id: row.supply_id ?? null,
      } as FbsOrder
    })
    const enriched = await enrichWithCells(mapped)
    setOrders(enriched)

    // Проверяем sync log
    const { data: syncLog } = await (supabase as any)
      .from('fbs_sync_log')
      .select('last_synced_at,error,orders_count,status_counts')
      .eq('store_id', selectedStoreId)
      .single()
    const successfulSync = syncLog?.last_synced_at ? new Date(syncLog.last_synced_at) : null
    const latestSnapshotCount = mapped.filter((order) => order.isInLatestSnapshot).length
    const expectedCount = Number(syncLog?.orders_count ?? latestSnapshotCount)
    const snapshotMismatch = Number.isFinite(expectedCount) && expectedCount !== latestSnapshotCount
    lastSyncedAtRef.current = successfulSync
    setLastSyncedAt(successfulSync)
    setError(syncLog?.error
      ? staleDataMessage(successfulSync)
      : snapshotMismatch
        ? `Проверка целостности не пройдена: WB-снимок содержит ${expectedCount} заказов, загружено ${latestSnapshotCount}. Показаны последние сохранённые данные.`
        : null)
    return enriched
  }, [selectedStoreId, enrichWithCells])

  const loadOpenSupplies = useCallback(async () => {
    if (!selectedStoreId) return
    const d = await invokeFbs(selectedStoreId, { action: 'get_supplies', closed: false, limit: 1000 })
    const sups = (d.supplies ?? d ?? []) as any[]
    setOpenSupplies(sups
      .filter((s: any) => s.done !== true)
      .map((s: any) => ({
        id: s.id,
        name: s.name || s.id,
        ordersCount: s.ordersCount,
        done: s.done,
        createdAt: s.createdAt ?? s.created_at,
      })))
  }, [selectedStoreId])

  // Синк с WB → upsert в fbs_orders → перечитываем из DB
  const doSync = useCallback((): Promise<void> => {
    if (!selectedStoreId) return Promise.resolve()
    const existingSync = syncInFlightRef.current.get(selectedStoreId)
    if (existingSync) return existingSync

    const storeId = selectedStoreId
    const syncPromise = (async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await invokeFbs(storeId, { action: 'sync_orders' })
        await Promise.all([readFromDb(), loadOpenSupplies()])
        const serverSyncTime = typeof result.last_synced_at === 'string' ? new Date(result.last_synced_at) : null
        if (result.partial === true) {
          setError(staleDataMessage(serverSyncTime ?? lastSyncedAtRef.current))
        } else {
          const successfulSync = serverSyncTime ?? new Date()
          lastSyncedAtRef.current = successfulSync
          setLastSyncedAt(successfulSync)
        }
      } catch {
        setError(staleDataMessage(lastSyncedAtRef.current))
      } finally {
        if (selectedStoreIdRef.current === storeId) setLoading(false)
      }
    })()

    syncInFlightRef.current.set(storeId, syncPromise)
    void syncPromise.finally(() => {
      if (syncInFlightRef.current.get(storeId) === syncPromise) syncInFlightRef.current.delete(storeId)
    })
    return syncPromise
  }, [selectedStoreId, readFromDb, loadOpenSupplies])

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

  // При смене магазина: читаем из DB, если данные старые — фоновый синк
  useEffect(() => {
    if (!selectedStoreId) return
    void loadOpenSupplies().catch(() => setOpenSupplies([]))
    void readFromDb()
      .then(() => {
        const previousSync = lastSyncedAtRef.current
        const stale = !previousSync || (Date.now() - previousSync.getTime()) > 10 * 60_000
        if (stale) void doSync()
      })
      .catch(() => setError(staleDataMessage(lastSyncedAtRef.current)))

    // Автосинк каждые 2 минуты — без нажатия "Обновить"
    const timer = setInterval(() => { void doSync() }, 2 * 60_000)
    return () => clearInterval(timer)
  }, [selectedStoreId])

  const mapRawOrder = useCallback((o: any, status: FbsOrder['shipStatus']): FbsOrder => ({
    id: String(o.id), rid: o.rid ?? '', createdAt: o.createdAt ?? '', ddate: o.ddate ?? '',
    warehouseId: o.warehouseId ?? 0, officeId: o.officeId ?? 0, article: o.article ?? '', nmId: o.nmId ?? 0,
    chrtId: o.chrtId ?? 0, skus: o.skus ?? [], price: o.price ?? 0,
    convertedPrice: o.convertedPrice ?? 0, currencyCode: o.currencyCode ?? 643,
    photoUrl: null, productBarcode: null, productName: null, productBrand: null, productColor: null,
    productVendorCode: null, productSize: null, productLocations: [], shipStatus: status,
    supplierStatus: status === 'pending' ? 'new' : status === 'assembling' ? 'confirm' : 'complete',
    wbSystemStatus: 'waiting', isInLatestSnapshot: true, supply_id: null,
  }), [])

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const openAssembleModal = async (
    ids: string[],
    initialTab: 'new' | 'existing' = 'new',
    mode: 'assemble' | 'move' = 'assemble',
    sourceSupplyIds: string[] = [],
  ) => {
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
    const operationMode = assembleModal?.mode ?? 'assemble'
    setBusyIds((s) => new Set([...s, ...ids]))
    setAssembleModal(null)
    try {
      let supplyId: string
      if (existingSupplyId) {
        supplyId = existingSupplyId
      } else {
        const storeName = storesWithKey.find((store) => store.id === selectedStoreId)?.name?.trim() || 'Магазин'
        const defaultName = `${storeName} ${new Date().toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
        const supRes = await invokeFbs(selectedStoreId, { action: 'create_supply', name: newSupplyName.trim() || defaultName })
        supplyId = supRes.id as string
        if (!supplyId) throw new Error('WB не вернул ID поставки')
      }
      const failedIds: string[] = []
      for (const orderId of ids) {
        try {
          const res = await invokeFbs(selectedStoreId, { action: 'add_order_to_supply', supply_id: supplyId, order_id: orderId })
          if (res.success === false) failedIds.push(orderId)
        } catch { failedIds.push(orderId) }
      }
      const successIds = ids.filter((id) => !failedIds.includes(id))
      if (successIds.length > 0) {
        setOrders((previous) => previous.map((order) => successIds.includes(order.id)
          ? { ...order, shipStatus: 'assembling' as const, supplierStatus: 'confirm', wbSystemStatus: 'waiting', supply_id: supplyId }
          : order))
        setSelected((previous) => {
          const next = new Set(previous)
          successIds.forEach((id) => next.delete(id))
          return next
        })
      }
      void doSync()
      if (failedIds.length > 0 && failedIds.length < ids.length) {
        alert(`Часть заказов ${operationMode === 'move' ? 'перенесена' : 'добавлена'}. Не удалось ${operationMode === 'move' ? 'перенести' : 'добавить'}: ${failedIds.join(', ')} (возможно устарели или не соответствуют складу поставки)`)
      } else if (failedIds.length === ids.length) {
        alert(`Не удалось ${operationMode === 'move' ? 'перенести' : 'добавить'} заказы в поставку: ${failedIds.join(', ')}. Возможно они устарели или не соответствуют складу.`)
      }
    } catch (e) {
      alert(`${operationMode === 'move' ? 'Ошибка при переносе' : 'Ошибка при переводе в сборку'}: ${String(e)}`)
    } finally {
      setBusyIds((s) => { const n = new Set(s); ids.forEach(i => n.delete(i)); return n })
    }
  }

  const handleShip = async (supplyId: string, orders2ship: FbsOrder[]) => {
    if (!supabase) return
    const ids = orders2ship.map((o) => o.id)
    setBusyIds((s) => new Set([...s, ...ids]))
    try {
      // Статус меняет только WB: сначала передаём целую поставку в доставку.
      await invokeFbs(selectedStoreId, { action: 'deliver_supply', supply_id: supplyId })
      setSelected(new Set())
      await Promise.all([doSync(), loadOpenSupplies()])
    } catch (e) { alert(String(e)) }
    finally { setBusyIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n }) }
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

  const openStickerPrintModal = (ordersToPrint: FbsOrder[], supply: WbSupply | null, mode: StickerPrintModal['mode']) => {
    if (ordersToPrint.length === 0) return
    setPickingListMenuOpen(false)
    setStickerPrintModal({
      orders: ordersToPrint,
      supply,
      mode,
      options: { supply: mode === 'supply', picking: true, locations: true, productBarcode: true, wb: true },
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
    sheet['!cols'] = [{ wch: 13 }, { wch: 18 }, { wch: 38 }, { wch: 11 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 20 }]
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
    const officeId = order.officeId || sellerWarehouse?.officeId || 0
    const office = wbOffices.find((item) => Number(item.id) === Number(officeId))
    return {
      officialName: office?.name || (officeId ? `Склад WB #${officeId}` : 'Склад WB не определён'),
      sellerName: sellerWarehouse?.name || (order.warehouseId ? `Склад продавца #${order.warehouseId}` : 'Склад продавца не определён'),
      address: office?.address || null,
    }
  }

  const renderWbWarehouseCell = (order: FbsOrder) => {
    const warehouse = wbWarehouseInfo(order)
    return (
      <div className="min-w-0 leading-tight" title={warehouse.address ?? undefined}>
        <div className="truncate font-semibold text-slate-700">{warehouse.officialName}</div>
        <div className="mt-1 truncate text-[11px] text-slate-400">Ваш склад: {warehouse.sellerName}</div>
      </div>
    )
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
    { key: 'completed',  label: 'Завершённые' },
    { key: 'cancelled',  label: 'Отменённые' },
    { key: 'archive',    label: 'Архив' },
  ]
  const tabOrders = orders.filter((o) => o.shipStatus === activeTab)
  const ordersWithoutSize = tabOrders.filter((order) => !order.productSize)
  const selectedTab = tabOrders.filter((o) => selected.has(o.id))
  const allTabSelected = tabOrders.length > 0 && tabOrders.every((o) => selected.has(o.id))

  const toggleSelect = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const toggleAll = () => setSelected(allTabSelected ? new Set() : new Set(tabOrders.map((o) => o.id)))
  const toggleSupplySelection = (supplyOrders: FbsOrder[]) => setSelected((previous) => {
    const ids = supplyOrders.map((order) => order.id)
    const allSelected = ids.length > 0 && ids.every((id) => previous.has(id))
    return allSelected ? new Set() : new Set(ids)
  })
  const toggleSupplyOrderSelection = (orderId: string, supplyOrders: FbsOrder[]) => setSelected((previous) => {
    const supplyIds = new Set(supplyOrders.map((order) => order.id))
    const next = new Set(Array.from(previous).filter((id) => supplyIds.has(id)))
    next.has(orderId) ? next.delete(orderId) : next.add(orderId)
    return next
  })

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <select
          value={selectedStoreId}
          onChange={(e) => { setSelectedStoreId(e.target.value); localStorage.setItem(lsKey, e.target.value); setOrders([]); setOpenSupplies([]); setSelected(new Set()); setProductSyncNotice(null); setError(null); setLastSyncedAt(null); lastSyncedAtRef.current = null }}
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
                  key === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                  key === 'cancelled' ? 'bg-red-100 text-red-600' :
                  'bg-slate-200 text-slate-600'
                }`}>{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <span className="font-semibold">Данные могут быть устаревшими.</span>{' '}{error}
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

      {!loading && tabOrders.length === 0 && !(activeTab === 'assembling' && openSupplies.length > 0) && !error && (
        <div className="flex h-full items-center justify-center text-sm text-slate-400">
          {orders.length === 0 ? 'Загрузка...' : `Нет заказов в статусе "${tabs.find(t => t.key === activeTab)?.label}"`}
        </div>
      )}

      {(tabOrders.length > 0 || openSupplies.length > 0) && activeTab === 'assembling' && (() => {
        // Основой списка служат поставки WB, включая пустые; заказы вкладываются по supply_id
        const supplyGroups = new Map<string, { supply: WbSupply | null; orders: FbsOrder[] }>()
        openSupplies.forEach((supply) => supplyGroups.set(supply.id, { supply, orders: [] }))
        tabOrders.forEach((o) => {
          const key = o.supply_id ?? '__none__'
          if (!supplyGroups.has(key)) supplyGroups.set(key, { supply: null, orders: [] })
          supplyGroups.get(key)!.orders.push(o)
        })
        return (
          <div className="flex-1 overflow-auto">
            {Array.from(supplyGroups.entries()).map(([supplyId, group]) => {
              const { supply, orders: supplyOrders } = group
              const isExpanded = expandedSupplyIds.has(supplyId)
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
              const wh = supplyOrders.length > 0
                ? (wbWarehouses.find((warehouse) => Number(warehouse.id) === Number(supplyOrders[0].warehouseId))?.name || '')
                : ''
              return (
                <div key={supplyId} className="border-b border-slate-200">
                  {/* Строка поставки (родитель) */}
                  <div className="flex cursor-pointer items-center gap-3 bg-white px-4 py-3 hover:bg-slate-50 transition-colors" onClick={toggle}>
                    <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <div className="flex flex-1 items-center gap-4 min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{supplyId === '__none__' ? 'Без поставки' : (supply?.name || supplyId)}</p>
                        {supplyId !== '__none__' && supply?.name && supply.name !== supplyId && (
                          <p className="font-mono text-[11px] text-slate-400">{supplyId}</p>
                        )}
                      </div>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{supplyOrders.length} зак.</span>
                      {wh && <span className="text-xs text-slate-400">{wh}</span>}
                    </div>
                    {supplyId !== '__none__' && supplyOrders.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button type="button" title="Распечатать стикеры поставки" aria-label="Распечатать стикеры поставки"
                          disabled={busyIds.size > 0}
                          onClick={(e) => { e.stopPropagation(); openStickerPrintModal(supplyOrders, supply ?? { id: supplyId, name: supplyId }, 'supply') }}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-wait disabled:opacity-40">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                        </button>
                        <button type="button" title="Передать в доставку" aria-label="Передать поставку в доставку"
                          disabled={busyIds.size > 0}
                          onClick={(e) => { e.stopPropagation(); void handleShip(supplyId, supplyOrders) }}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-wait disabled:opacity-40">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14m-5-5 5 5-5 5" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Аккордеон — заказы */}
                  <div style={{ display: 'grid', gridTemplateRows: isExpanded ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease' }}>
                    <div className="overflow-hidden">
                      {supplyOrders.length === 0 ? (
                        <div className="border-t border-slate-100 bg-slate-50/50 px-12 py-4 text-xs text-slate-400">В поставке пока нет заказов</div>
                      ) : <div className="border-t border-slate-100 bg-slate-50/50">
                        <table className="w-full text-xs">
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
                              <th className="px-4 py-2 text-left font-semibold">Заказ / Артикул WB</th>
                              <th className="px-4 py-2 text-left font-semibold">Товар</th>
                              <th className="px-4 py-2 text-left font-semibold">Адрес товара / Баркод</th>
                              <th className="px-4 py-2 text-left font-semibold">Время</th>
                              <th className="px-4 py-2 text-left font-semibold">Склад FBS</th>
                              <th className="px-4 py-2 text-left font-semibold">Действия</th>
                            </tr>
                          </thead>
                        <tbody>
                          {supplyOrders.map((order) => {
                            const sla = slaLabel(order.ddate, order.createdAt)
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
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-2">
                                  <ProductLocationsCell order={order} />
                                </td>
                                <td className={`px-4 py-2 whitespace-nowrap ${sla.cls}`}>{sla.text}</td>
                                <td className="max-w-48 px-4 py-2">{renderWbWarehouseCell(order)}</td>
                                <td className="px-4 py-2">
                                  <div className="flex items-center gap-1.5">
                                    {supplyId !== '__none__' && (
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
                                    <button type="button" title="Выбрать стикеры для печати" disabled={isBusy} onClick={() => openStickerPrintModal([order], null, 'selected')}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 disabled:opacity-40 transition">
                                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        </table>
                        {selectedSupplyOrders.length > 0 && (
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
                            {supplyId !== '__none__' && (
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
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Заказ / Артикул WB</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Товар</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Адрес товара / Баркод</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-500">Кол-во</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Склад FBS</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-500">Время</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {tabOrders.map((order) => {
                const sla = slaLabel(order.ddate, order.createdAt)
                const isBusy = busyIds.has(order.id)
                const isChecked = selected.has(order.id)
                return (
                  <tr key={order.id}
                    className={`border-b border-slate-100 transition ${isChecked ? 'bg-violet-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(order.id)}
                        className="h-3.5 w-3.5 rounded accent-violet-500 cursor-pointer" />
                    </td>
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
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ProductLocationsCell order={order} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{order.productLocations.length > 0 ? productLocationQuantity(order.productLocations) : '—'}</td>
                    <td className="max-w-48 px-4 py-3">{renderWbWarehouseCell(order)}</td>
                    <td className={`px-4 py-3 whitespace-nowrap ${sla.cls}`}>{sla.text}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {/* Стикер — скрыт на табе Новые, WB не выдаёт стикеры до перевода в сборку */}
                        {(activeTab === 'delivering' || activeTab === 'completed') && (
                          <button type="button" title="Выбрать стикеры для печати" disabled={isBusy}
                            onClick={() => openStickerPrintModal([order], null, 'selected')}
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
                        onChange={() => setStickerPrintModal((current) => current ? {
                          ...current,
                          options: { ...current.options, [option.key]: !current.options[option.key] },
                        } : null)}
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
                  ) : openSupplies.filter((sup) => !assembleModal.sourceSupplyIds.includes(sup.id)).length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-400">Нет открытых поставок на WB</p>
                  ) : (
                    openSupplies.filter((sup) => !assembleModal.sourceSupplyIds.includes(sup.id)).map((sup) => (
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
