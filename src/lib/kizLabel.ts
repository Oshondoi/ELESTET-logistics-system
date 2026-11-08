import bwipjs from 'bwip-js/browser'
import jsPDF from 'jspdf'
import type { LabelGoods, PrintCode } from '../services/kizCacheService'

export type LabelLayout = 'vertical' | 'horizontal'

const PDF_LIMIT = 1000

function parts(item: PrintCode): { gtin: string; serial: string } {
  if (item.gtin && item.serial) return { gtin: item.gtin, serial: item.serial }
  const head = item.code.split('\u001d')[0]
  const match = head.match(/^01(\d{14})21(.+)$/)
  return {
    gtin: item.gtin || match?.[1] || '',
    serial: item.serial || match?.[2] || '',
  }
}

function matrix(code: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const text = code.startsWith('^FNC1') ? code : `^FNC1${code.replace(/\u001d/g, '^GS')}`
  try {
    bwipjs.toCanvas(canvas, { bcid: 'gs1datamatrix', text, scale: 6, parsefnc: true, paddingwidth: 0, paddingheight: 0 })
  } catch {
    bwipjs.toCanvas(canvas, { bcid: 'datamatrix', text: code, scale: 6, paddingwidth: 0, paddingheight: 0 })
  }
  return canvas
}

function attributeValue(product: Record<string, unknown> | null, needles: string[]): string {
  if (!product) return ''
  for (const needle of needles) {
    const direct = product[needle]
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
  }
  const attributes = Array.isArray(product.attributes) ? product.attributes : []
  for (const item of attributes) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const name = String(row.name ?? row.attributeName ?? row.code ?? '').toLowerCase()
    if (!needles.some((needle) => name.includes(needle))) continue
    const value = row.value ?? row.attributeValue
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function goodsOf(product: Record<string, unknown> | null, linked: LabelGoods): LabelGoods {
  return {
    name: attributeValue(product, ['fullName', 'full_name', 'name']) || linked.name,
    article: attributeValue(product, ['article', 'model', 'vendorCode', 'sku']) || linked.article,
    color: attributeValue(product, ['color', 'colour']) || linked.color,
    size: attributeValue(product, ['size']) || linked.size,
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= maxWidth) line = next
    else {
      if (line) lines.push(line)
      line = word
    }
  })
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

function drawVertical(item: PrintCode, number: number): HTMLCanvasElement {
  const dpi = 120
  const width = 4 * dpi
  const height = 6 * dpi
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Браузер не смог подготовить лист печати')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  const code = matrix(item.code)
  const size = Math.round(2.35 * dpi)
  ctx.drawImage(code, (width - size) / 2, Math.round(0.55 * dpi), size, size)
  const { gtin, serial } = parts(item)
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'
  ctx.font = `700 ${Math.round(0.22 * dpi)}px Arial`
  ctx.fillText(gtin, width / 2, Math.round(3.25 * dpi))
  ctx.fillText(serial, width / 2, Math.round(3.62 * dpi))
  ctx.textAlign = 'right'
  ctx.font = `700 ${Math.round(0.2 * dpi)}px Arial`
  ctx.fillText(String(number), width - Math.round(0.28 * dpi), height - Math.round(0.28 * dpi))
  return canvas
}

function drawHorizontal(item: PrintCode, goods: LabelGoods, number: number): HTMLCanvasElement {
  const dpi = 120
  const width = 6 * dpi
  const height = 4 * dpi
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Браузер не смог подготовить лист печати')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'left'
  const left = Math.round(0.28 * dpi)
  const textWidth = Math.round(3.15 * dpi)
  ctx.font = `700 ${Math.round(0.2 * dpi)}px Arial`
  let y = Math.round(0.48 * dpi)
  wrap(ctx, goods.name || '—', textWidth).forEach((line) => {
    ctx.fillText(line, left, y)
    y += Math.round(0.28 * dpi)
  })
  y += Math.round(0.08 * dpi)
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(left, y)
  ctx.lineTo(left + textWidth, y)
  ctx.stroke()
  y += Math.round(0.38 * dpi)
  const rows = [
    ['Модель/Артикул:', goods.article],
    ['Цвет:', goods.color],
    ['Размер:', goods.size],
  ]
  rows.forEach(([label, value]) => {
    ctx.font = `400 ${Math.round(0.16 * dpi)}px Arial`
    ctx.fillText(label, left, y)
    y += Math.round(0.28 * dpi)
    ctx.font = `700 ${Math.round(0.2 * dpi)}px Arial`
    ctx.fillText(value || '—', left, y)
    y += Math.round(0.4 * dpi)
  })
  const code = matrix(item.code)
  const size = Math.round(1.7 * dpi)
  const codeX = Math.round(3.85 * dpi)
  const codeY = Math.round(0.35 * dpi)
  ctx.drawImage(code, codeX, codeY, size, size)
  const { gtin, serial } = parts(item)
  ctx.font = `700 ${Math.round(0.16 * dpi)}px Arial`
  ctx.fillText(gtin, codeX, codeY + size + Math.round(0.28 * dpi))
  ctx.fillText(serial, codeX, codeY + size + Math.round(0.52 * dpi))
  ctx.textAlign = 'right'
  ctx.fillText(String(number), width - Math.round(0.22 * dpi), height - Math.round(0.22 * dpi))
  return canvas
}

export function buildKizPdf(
  items: PrintCode[],
  layout: LabelLayout,
  product: Record<string, unknown> | null,
  linked: LabelGoods,
): { pdf: jsPDF; limited: boolean } {
  const source = items.slice(0, PDF_LIMIT)
  const goods = goodsOf(product, linked)
  const portrait = layout === 'vertical'
  const pdf = new jsPDF({ unit: 'in', format: portrait ? [4, 6] : [6, 4], orientation: portrait ? 'portrait' : 'landscape' })
  source.forEach((item, index) => {
    if (index > 0) pdf.addPage()
    const canvas = portrait ? drawVertical(item, index + 1) : drawHorizontal(item, goods, index + 1)
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, portrait ? 4 : 6, portrait ? 6 : 4)
  })
  return { pdf, limited: items.length > PDF_LIMIT }
}

export function downloadKizCsv(items: PrintCode[], operationId: string): void {
  const blob = new Blob([items.map((item) => item.code).join('\n') + '\n'], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `kiz-${operationId}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 30_000)
}

export function openKizPdf(pdf: jsPDF, operationId: string, layout: LabelLayout, print: boolean): void {
  if (!print) {
    pdf.save(`kiz-${operationId}-${layout === 'vertical' ? 'vertical' : 'horizontal'}.pdf`)
    return
  }
  const url = URL.createObjectURL(pdf.output('blob'))
  const win = window.open(url)
  if (!win) throw new Error('Браузер заблокировал окно печати. Разрешите всплывающие окна.')
  window.setTimeout(() => {
    try { win.print() } catch { /* the PDF viewer still has its own print button */ }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }, 700)
}
