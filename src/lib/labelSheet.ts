import JsBarcode from 'jsbarcode'
import jsPDF from 'jspdf'
import { kizMarkImage } from './kizLabel'
import type { PrintCode } from '../services/kizCacheService'
import type { StickerTemplate } from '../types'

export type LabelSizeId = '58x40' | '120x75'
export type LabelMode = 'barcode' | 'kiz' | 'combined'
export type LabelBlockType =
  | 'barcode'
  | 'kiz'
  | 'name'
  | 'article'
  | 'sellerArticle'
  | 'size'
  | 'color'
  | 'brand'
  | 'composition'
  | 'supplier'
  | 'address'
  | 'date'
  | 'country'
  | 'icons'
  | 'number'

export type LabelBlock = {
  id: string
  type: LabelBlockType
  x: number
  y: number
  w: number
  h: number
}

export type LabelGuides = {
  top: number
  right: number
  bottom: number
  left: number
}

export type GuideSide = 'top' | 'right' | 'bottom' | 'left'

export type LabelTemplate = {
  id: string
  account_id: string
  name: string
  size: LabelSizeId
  mode: LabelMode
  blocks: LabelBlock[]
  guides: LabelGuides
  created_at: string
  updated_at: string
}

export type SheetIcons = {
  wash: boolean
  iron: boolean
  noBleach: boolean
  noTumble: boolean
  dryClean: boolean
  eac: boolean
}

export type SheetGoods = {
  barcode: string
  name: string
  article: string
  sellerArticle: string
  size: string
  color: string
  brand: string
  composition: string
  supplier: string
  address: string
  date: string
  country: string
  icons: SheetIcons
}

export type SheetPage = {
  goods: SheetGoods
  code?: PrintCode | null
  number?: number
  placeholder?: boolean
}

const PX_PER_MM = 12

export const LABEL_FIELDS: Array<{ type: LabelBlockType; title: string; example: string; w: number; h: number }> = [
  { type: 'barcode', title: 'Штрихкод', example: 'Штрихкод', w: 32, h: 12 },
  { type: 'kiz', title: 'КИЗ', example: 'КИЗ', w: 20, h: 26 },
  { type: 'name', title: 'Название', example: 'Название товара', w: 32, h: 4 },
  { type: 'article', title: 'Артикул WB', example: 'Артикул WB', w: 32, h: 3.4 },
  { type: 'sellerArticle', title: 'Артикул продавца', example: 'Артикул продавца', w: 32, h: 3.4 },
  { type: 'size', title: 'Размер', example: 'Размер', w: 16, h: 3.4 },
  { type: 'color', title: 'Цвет', example: 'Цвет', w: 16, h: 3.4 },
  { type: 'brand', title: 'Бренд', example: 'Бренд', w: 32, h: 3.4 },
  { type: 'composition', title: 'Состав', example: 'Состав', w: 32, h: 3.4 },
  { type: 'supplier', title: 'Поставщик', example: 'Поставщик', w: 32, h: 3.4 },
  { type: 'address', title: 'Адрес', example: 'Адрес поставщика', w: 32, h: 3.4 },
  { type: 'date', title: 'Дата производства', example: '01.01.2026', w: 32, h: 3.4 },
  { type: 'country', title: 'Страна', example: 'Страна', w: 32, h: 3.4 },
  { type: 'icons', title: 'Значки', example: 'Значки', w: 32, h: 5 },
  { type: 'number', title: 'Номер листа', example: '1', w: 6, h: 4 },
]

export function labelSizeMm(size: LabelSizeId): { w: number; h: number } {
  return size === '120x75' ? { w: 120, h: 75 } : { w: 58, h: 40 }
}

export function edgeGuides(): LabelGuides {
  return { top: 0, right: 0, bottom: 0, left: 0 }
}

export function innerBox(sheet: { w: number; h: number }, guides: LabelGuides) {
  const left = Math.max(0, Math.min(sheet.w, guides.left))
  const right = Math.max(0, Math.min(sheet.w - left, guides.right))
  const top = Math.max(0, Math.min(sheet.h, guides.top))
  const bottom = Math.max(0, Math.min(sheet.h - top, guides.bottom))
  return { x: left, y: top, w: Math.max(0, sheet.w - left - right), h: Math.max(0, sheet.h - top - bottom) }
}

export function clampGuideSide(guides: LabelGuides, side: GuideSide, sheet: { w: number; h: number }, blocks: LabelBlock[]): LabelGuides {
  const next = { ...guides }
  const widest = blocks.reduce((max, block) => Math.max(max, block.w), 0)
  const tallest = blocks.reduce((max, block) => Math.max(max, block.h), 0)
  if (side === 'top') next.top = Math.max(0, Math.min(next.top, sheet.h - next.bottom - tallest))
  if (side === 'bottom') next.bottom = Math.max(0, Math.min(next.bottom, sheet.h - next.top - tallest))
  if (side === 'left') next.left = Math.max(0, Math.min(next.left, sheet.w - next.right - widest))
  if (side === 'right') next.right = Math.max(0, Math.min(next.right, sheet.w - next.left - widest))
  return next
}

export function blocksPastGuides(blocks: LabelBlock[], sheet: { w: number; h: number }, guides: LabelGuides): LabelBlock[] {
  const box = innerBox(sheet, guides)
  return blocks.filter((block) => (
    block.x < box.x - 0.05
    || block.y < box.y - 0.05
    || block.x + block.w > box.x + box.w + 0.05
    || block.y + block.h > box.y + box.h + 0.05
  ))
}

export function shiftUnderGuides(blocks: LabelBlock[], sheet: { w: number; h: number }, guides: LabelGuides): LabelBlock[] {
  const box = innerBox(sheet, guides)
  return blocks.map((block) => {
    let x = Math.max(box.x, block.x)
    let y = Math.max(box.y, block.y)
    if (x + block.w > box.x + box.w) x = box.x + box.w - block.w
    if (y + block.h > box.y + box.h) y = box.y + box.h - block.h
    return { ...block, x, y }
  })
}

export function blocksForMode(mode: LabelMode): LabelBlockType[] {
  return LABEL_FIELDS
    .map((field) => field.type)
    .filter((type) => {
      if (mode === 'barcode') return type !== 'kiz' && type !== 'number'
      if (mode === 'kiz') return type !== 'barcode'
      return true
    })
}

export function defaultBlocks(size: LabelSizeId, mode: LabelMode): LabelBlock[] {
  const sheet = labelSizeMm(size)
  const textW = mode === 'barcode' ? sheet.w - 4 : Math.max(24, sheet.w - 26)
  const blocks: LabelBlock[] = []
  let y = 2
  const push = (type: LabelBlockType, w: number, h: number, x = 2) => {
    if (y + h > sheet.h - 1) return
    blocks.push({ id: type, type, x, y, w: Math.min(w, sheet.w - x - 1), h })
    y += h + 0.6
  }
  if (mode !== 'kiz') push('barcode', textW, Math.min(12, sheet.h * 0.28))
  for (const type of ['name', 'article', 'sellerArticle', 'size', 'color', 'brand', 'composition', 'supplier', 'address', 'date', 'country'] as LabelBlockType[]) {
    const field = LABEL_FIELDS.find((item) => item.type === type)!
    push(type, textW, field.h)
  }
  const icons = LABEL_FIELDS.find((item) => item.type === 'icons')!
  if (y + icons.h <= sheet.h) push('icons', textW, icons.h)
  if (mode !== 'barcode') {
    blocks.push({ id: 'kiz', type: 'kiz', x: sheet.w - 22, y: 2, w: 20, h: Math.min(28, sheet.h - 8) })
    blocks.push({ id: 'number', type: 'number', x: sheet.w - 8, y: sheet.h - 5, w: 6, h: 4 })
  }
  return blocks
}

const EXAMPLE: SheetGoods = {
  barcode: '',
  name: 'Название товара',
  article: 'Артикул WB',
  sellerArticle: 'Артикул продавца',
  size: 'Размер',
  color: 'Цвет',
  brand: 'Бренд',
  composition: 'Состав',
  supplier: 'Поставщик',
  address: 'Адрес поставщика',
  date: '01.01.2026',
  country: 'Страна',
  icons: { wash: true, iron: true, noBleach: true, noTumble: true, dryClean: true, eac: true },
}

export function examplePage(): SheetPage {
  return { goods: EXAMPLE, placeholder: true, number: 1 }
}

export function goodsFromSticker(sticker: StickerTemplate): SheetGoods {
  const date = sticker.production_date
  const formatted = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
    : (date ?? '')
  return {
    barcode: sticker.barcode,
    name: sticker.name,
    article: sticker.show_wb_article === false ? '' : (sticker.article ?? ''),
    sellerArticle: sticker.show_seller_article === false ? '' : (sticker.seller_article ?? ''),
    size: sticker.size ?? '',
    color: sticker.color ?? '',
    brand: sticker.brand ?? '',
    composition: sticker.composition ?? '',
    supplier: sticker.supplier ?? '',
    address: sticker.supplier_address ?? '',
    date: formatted,
    country: sticker.country ?? '',
    icons: {
      wash: sticker.icon_wash,
      iron: sticker.icon_iron,
      noBleach: sticker.icon_no_bleach,
      noTumble: sticker.icon_no_tumble_dry,
      dryClean: Boolean(sticker.icon_dry_clean),
      eac: sticker.icon_eac,
    },
  }
}

const iconSources: Array<{ key: keyof SheetIcons; src: string }> = [
  { key: 'wash', src: '/icons/wash-30.svg' },
  { key: 'iron', src: '/icons/iron.svg' },
  { key: 'noBleach', src: '/icons/no-bleach.svg' },
  { key: 'noTumble', src: '/icons/no-tumble-dry.svg' },
  { key: 'dryClean', src: '/icons/dry-clean.svg' },
  { key: 'eac', src: '/eac.svg' },
]

const iconImages: Partial<Record<string, HTMLImageElement>> = {}
if (typeof document !== 'undefined') {
  for (const icon of iconSources) {
    const image = new Image()
    image.src = icon.src
    iconImages[icon.key] = image
  }
}

function fitLine(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let next = text
  while (next.length > 1 && ctx.measureText(`${next}…`).width > width) next = next.slice(0, -1)
  return next.length > 1 ? `${next}…` : ''
}

function drawBarcodeGraphic(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, barcode: string, placeholder: boolean) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  if (placeholder || !barcode) {
    const bars = 28
    const gap = w / bars
    for (let i = 0; i < bars; i += 1) {
      ctx.fillStyle = '#111'
      ctx.fillRect(x + i * gap, y, i % 3 === 0 ? gap * 0.7 : gap * 0.35, h * 0.72)
    }
    ctx.fillStyle = '#111'
    ctx.font = `${Math.max(8, Math.round(h * 0.18))}px Arial`
    ctx.textAlign = 'center'
    ctx.fillText('Штрихкод', x + w / 2, y + h * 0.92)
    ctx.restore()
    return
  }
  const canvas = document.createElement('canvas')
  try {
    JsBarcode(canvas, barcode, {
      format: 'EAN13',
      width: 2,
      height: Math.max(20, Math.round(h * 0.7)),
      displayValue: true,
      fontSize: Math.max(10, Math.round(h * 0.16)),
      margin: 0,
      background: '#ffffff',
      lineColor: '#000000',
      flat: true,
    })
  } catch {
    ctx.restore()
    return false
  }
  const scale = Math.min(w / canvas.width, (h * 0.96) / canvas.height)
  const dw = canvas.width * scale
  const dh = canvas.height * scale
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(canvas, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  ctx.restore()
  return true
}

function drawPlaceholderMatrix(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.strokeStyle = '#111'
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, size, size)
  const cell = size / 8
  ctx.fillStyle = '#111'
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if ((row + col) % 2 === 0) ctx.fillRect(x + col * cell, y + row * cell, cell, cell)
    }
  }
}

function drawKizBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, page: SheetPage) {
  const textH = Math.min(h * 0.28, 28)
  const size = Math.min(w, h - textH)
  const left = x + (w - size) / 2
  if (page.placeholder || !page.code) {
    drawPlaceholderMatrix(ctx, left, y, size)
    ctx.fillStyle = '#111'
    ctx.textAlign = 'center'
    ctx.font = `700 ${Math.max(8, Math.round(textH * 0.38))}px Arial`
    ctx.fillText('00000000000000', x + w / 2, y + size + textH * 0.45)
    ctx.fillText('серия', x + w / 2, y + size + textH * 0.9)
    return
  }
  const mark = kizMarkImage(page.code.code)
  const scale = size / mark.image.width
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(mark.image, left, y, mark.image.width * scale, mark.image.height * scale)
  ctx.fillStyle = '#111'
  ctx.textAlign = 'center'
  ctx.font = `700 ${Math.max(8, Math.round(textH * 0.38))}px Arial`
  ctx.fillText(mark.gtin, x + w / 2, y + size + textH * 0.45)
  ctx.fillText(mark.serial, x + w / 2, y + size + textH * 0.9)
}

function fieldText(type: LabelBlockType, goods: SheetGoods, number?: number): string {
  const map: Partial<Record<LabelBlockType, string>> = {
    name: goods.name,
    article: goods.article,
    sellerArticle: goods.sellerArticle,
    size: goods.size,
    color: goods.color,
    brand: goods.brand,
    composition: goods.composition,
    supplier: goods.supplier,
    address: goods.address,
    date: goods.date,
    country: goods.country,
    number: number ? String(number) : '',
  }
  return map[type] ?? ''
}

export function renderSheet(template: Pick<LabelTemplate, 'size' | 'blocks'>, page: SheetPage): { canvas: HTMLCanvasElement; barcodeDrawn: boolean } {
  const sheet = labelSizeMm(template.size)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sheet.w * PX_PER_MM)
  canvas.height = Math.round(sheet.h * PX_PER_MM)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Браузер не смог подготовить лист печати')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#111111'
  ctx.textBaseline = 'middle'
  let barcodeDrawn = page.placeholder || !template.blocks.some((block) => block.type === 'barcode')
  for (const block of template.blocks) {
    const x = block.x * PX_PER_MM
    const y = block.y * PX_PER_MM
    const w = block.w * PX_PER_MM
    const h = block.h * PX_PER_MM
    if (block.type === 'barcode') {
      barcodeDrawn = drawBarcodeGraphic(ctx, x, y, w, h, page.goods.barcode, Boolean(page.placeholder)) !== false && Boolean(page.goods.barcode || page.placeholder)
      continue
    }
    if (block.type === 'kiz') {
      drawKizBlock(ctx, x, y, w, h, page)
      continue
    }
    if (block.type === 'icons') {
      const active = iconSources.filter((icon) => page.goods.icons[icon.key])
      const size = Math.min(h, w / Math.max(1, active.length))
      active.forEach((icon, index) => {
        const image = iconImages[icon.key]
        if (image && image.complete && image.naturalWidth > 0) ctx.drawImage(image, x + index * size, y, size, size)
      })
      continue
    }
    const text = fieldText(block.type, page.goods, page.number)
    if (!text) continue
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.fillStyle = '#111'
    ctx.textAlign = block.type === 'number' ? 'right' : 'left'
    ctx.font = `700 ${Math.max(8, Math.round(h * 0.62))}px Arial`
    const shown = fitLine(ctx, text, w - 2)
    ctx.fillText(shown, block.type === 'number' ? x + w : x, y + h / 2)
    ctx.restore()
  }
  return { canvas, barcodeDrawn }
}

export function renderSystemCombined(page: SheetPage): HTMLCanvasElement {
  const blocks = defaultBlocks('58x40', 'combined')
  return renderSheet({ size: '58x40', blocks }, page).canvas
}

export function pagesToPdf(size: LabelSizeId, canvases: HTMLCanvasElement[]): jsPDF {
  const sheet = labelSizeMm(size)
  const pdf = new jsPDF({ unit: 'mm', format: [sheet.w, sheet.h], orientation: 'landscape' })
  canvases.forEach((canvas, index) => {
    if (index > 0) pdf.addPage([sheet.w, sheet.h], 'landscape')
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, sheet.w, sheet.h)
  })
  return pdf
}
