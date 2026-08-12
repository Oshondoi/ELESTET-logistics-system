import jsPDF from 'jspdf'
import * as bwipjs from 'bwip-js/browser'

export interface FulfillmentBoxQrLabel {
  barcode: string
  accountShortId: number
  batchShortId: number
  supplyNumber: number
  boxNumber: number
  storeName: string
  warehouseName: string
}

const LABEL_WIDTH_MM = 60
const LABEL_HEIGHT_MM = 40

// Геометрия этикетки 60x40 мм.
const QR_LEFT_MM = 2
const QR_TOP_MM = 3.5
const QR_SIZE_MM = 28.4
const DIVIDER_X_MM = 31.8
const INFO_LEFT_MM = 33.5
const INFO_TOP_MM = 1.5
const INFO_WIDTH_MM = 24.7
const INFO_HEIGHT_MM = 31.5
const BOTTOM_CODE_Y_MM = 37.4

// Кириллица остаётся компактным растром только в правой информационной области.
// 12 px/mm ~= 305 DPI — достаточно для чёткой термопечати.
const INFO_SCALE = 12
const INFO_CANVAS_WIDTH = Math.round(INFO_WIDTH_MM * INFO_SCALE)
const INFO_CANVAS_HEIGHT = Math.round(INFO_HEIGHT_MM * INFO_SCALE)

const fitCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
  weight = 600,
) => {
  let size = startSize
  while (size > minSize) {
    ctx.font = `${weight} ${size}px Arial, sans-serif`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 1
  }
  ctx.font = `${weight} ${size}px Arial, sans-serif`
  return size
}

/**
 * Рисует QR непосредственно командами PDF, без canvas/PNG.
 * Горизонтальные соседние модули объединяются в один прямоугольник — так PDF
 * получается заметно компактнее, чем при отрисовке каждого квадрата отдельно.
 */
const drawVectorQr = (pdf: jsPDF, value: string) => {
  let sourceWidth = 0
  let sourceHeight = 0
  const path: Array<{ op: 'm' | 'l' | 'h'; c: number[] }> = []

  const drawing: Parameters<typeof bwipjs.qrcode>[1] = {
    scale: () => null,
    measure: () => ({ width: 0, ascent: 0, descent: 0 }),
    init: (width, height) => {
      sourceWidth = width
      sourceHeight = height
    },
    line: () => undefined,
    polygon: (points) => {
      points.forEach(([x, y], index) => {
        path.push({
          op: index === 0 ? 'm' : 'l',
          c: [
            QR_LEFT_MM + (x / sourceWidth) * QR_SIZE_MM,
            QR_TOP_MM + (y / sourceHeight) * QR_SIZE_MM,
          ],
        })
      })
      path.push({ op: 'h', c: [] })
    },
    hexagon: () => undefined,
    ellipse: () => undefined,
    fill: () => undefined,
    text: () => undefined,
    end: () => undefined,
  }

  bwipjs.qrcode({
    bcid: 'qrcode',
    text: value,
    scale: 1,
    paddingwidth: 0,
    paddingheight: 0,
  }, drawing)

  if (!sourceWidth || !sourceHeight || path.length === 0) {
    throw new Error('Не удалось сформировать QR-код короба')
  }

  pdf.setFillColor(0, 0, 0)
  pdf.path(path)
  pdf.fillEvenOdd()
}

/**
 * jsPDF не умеет надёжно печатать кириллицу стандартным Helvetica без
 * встраивания мегабайтного шрифта. Поэтому растрируется только маленький
 * информационный блок справа, а не вся страница вместе с QR.
 */
const renderInfoBlock = (label: FulfillmentBoxQrLabel) => {
  const canvas = document.createElement('canvas')
  canvas.width = INFO_CANVAS_WIDTH
  canvas.height = INFO_CANVAS_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не удалось подготовить информацию этикетки короба')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#0f172a'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const left = 6
  const maxWidth = canvas.width - left * 2

  ctx.font = '700 35px Arial, sans-serif'
  ctx.fillText(`КОРОБ №${label.boxNumber}`, left, 41)

  const store = label.storeName?.trim() || 'Магазин не указан'
  fitCanvasText(ctx, store, maxWidth, 27, 18, 700)
  ctx.fillText(store, left, 111)

  const warehouse = label.warehouseName?.trim() || 'Склад не указан'
  fitCanvasText(ctx, warehouse, maxWidth, 25, 17, 600)
  ctx.fillText(warehouse, left, 159)

  ctx.fillStyle = '#334155'
  ctx.font = '600 23px Arial, sans-serif'
  ctx.fillText(`Партия P${label.batchShortId}`, left, 237)
  ctx.fillText(`Поставка S${label.supplyNumber}`, left, 287)

  return canvas.toDataURL('image/png')
}

export const buildFulfillmentBoxQrPdf = (labels: FulfillmentBoxQrLabel[]): Blob => {
  if (labels.length === 0) throw new Error('Нет коробов для печати')

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [LABEL_WIDTH_MM, LABEL_HEIGHT_MM],
    compress: true,
    putOnlyUsedFonts: true,
  })

  labels.forEach((label, index) => {
    if (index > 0) pdf.addPage([LABEL_WIDTH_MM, LABEL_HEIGHT_MM], 'landscape')

    drawVectorQr(pdf, label.barcode)

    pdf.setDrawColor(203, 213, 225)
    pdf.setLineWidth(0.18)
    pdf.line(DIVIDER_X_MM, 2.3, DIVIDER_X_MM, 32.7)

    pdf.addImage(
      renderInfoBlock(label),
      'PNG',
      INFO_LEFT_MM,
      INFO_TOP_MM,
      INFO_WIDTH_MM,
      INFO_HEIGHT_MM,
      undefined,
      'FAST',
    )

    pdf.setTextColor(0, 0, 0)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7.4)
    pdf.text(label.barcode, LABEL_WIDTH_MM / 2, BOTTOM_CODE_Y_MM, { align: 'center' })
  })

  return pdf.output('blob')
}
