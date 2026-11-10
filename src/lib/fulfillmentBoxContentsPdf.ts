import jsPDF from 'jspdf'

export type FulfillmentBoxContentsFormat = 'a4' | '120x75'
export type FulfillmentBoxContentsOrientation = 'portrait' | 'landscape'

export interface FulfillmentBoxInfoPageSource {
  batchNumber: number | null
  batchName: string
  legalName: string
  recipientCode: string
  supplyNumber: number
  warehouseName: string
  handoverTo: string
  category: string
  handoverDate: string
  tripLabel: string
  boxNumber: number
}

interface PageGeometry {
  width: number
  height: number
  scale: number
  margin: number
}

function pageGeometry(format: FulfillmentBoxContentsFormat, orientation: FulfillmentBoxContentsOrientation): PageGeometry {
  const landscape = orientation === 'landscape'
  const width = format === 'a4' ? (landscape ? 297 : 210) : (landscape ? 120 : 75)
  const height = format === 'a4' ? (landscape ? 210 : 297) : (landscape ? 75 : 120)
  return {
    width,
    height,
    scale: format === 'a4' ? 5 : 6,
    margin: format === 'a4' ? 10 : 3.5,
  }
}

function fitText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (context.measureText(value).width <= maxWidth) return value
  let result = value
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1)
  return `${result}…`
}

function renderPage(
  source: FulfillmentBoxInfoPageSource,
  format: FulfillmentBoxContentsFormat,
  orientation: FulfillmentBoxContentsOrientation,
  geometry?: PageGeometry,
): string {
  const settings = geometry ?? pageGeometry(format, orientation)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(settings.width * settings.scale)
  canvas.height = Math.round(settings.height * settings.scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось подготовить страницу инфо короба')

  const px = (mm: number) => mm * settings.scale
  const margin = px(settings.margin)
  const contentWidth = canvas.width - margin * 2
  const contentHeight = canvas.height - margin * 2
  const isA4 = format === 'a4'
  const titleHeight = contentHeight * 0.22
  const info = [
    ['ИП/ОсОО', source.legalName || '—'],
    ['Код получателя', source.recipientCode || '—'],
    ['Склад назначения', source.warehouseName || '—'],
    ['Сдача на', source.handoverTo || '—'],
    ['Партия', `${source.batchNumber != null ? `P-${source.batchNumber}` : source.batchName || '—'} · Поставка S-${source.supplyNumber}`],
    ['Изделие', source.category || '—'],
    ['Дата сдачи', source.handoverDate || '—'],
  ]
  const infoRowHeight = (contentHeight - titleHeight) / info.length
  const tableTop = margin + titleHeight
  const tableHeight = infoRowHeight * info.length
  const labelWidth = contentWidth * 0.42

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = '#0f172a'
  context.lineWidth = Math.max(2, px(isA4 ? 0.45 : 0.3))
  context.lineJoin = 'miter'

  const write = (text: string, x: number, y: number, width: number, height: number, weight: number, heightRatio: number) => {
    const pad = px(isA4 ? 2 : 1)
    const maxWidth = Math.max(8, width - pad * 2)
    let size = Math.floor(height * heightRatio)
    const min = Math.max(11, px(isA4 ? 3.4 : 2.2))
    while (size > min) {
      context.font = `${weight} ${size}px Arial, sans-serif`
      if (context.measureText(text).width <= maxWidth) break
      size -= 1
    }
    context.font = `${weight} ${size}px Arial, sans-serif`
    context.fillStyle = '#0f172a'
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.fillText(fitText(context, text, maxWidth), x + pad, y + height / 2)
  }

  const leftStrong = `№${source.boxNumber}`
  const rightStrong = source.tripLabel.startsWith('Рейс ') ? source.tripLabel.slice('Рейс '.length) : source.tripLabel || '—'
  const rightPlain = source.tripLabel.startsWith('Рейс ') ? 'Рейс ' : ''
  const leftTitle = `Короб ${leftStrong}`
  const rightTitle = `${rightPlain}${rightStrong}`
  const titlePad = px(isA4 ? 2 : 1)
  const titleMax = Math.max(8, contentWidth * 0.5 - titlePad * 2)
  let titleSize = Math.floor(titleHeight * 0.72)
  const titleMin = Math.max(12, px(isA4 ? 4 : 2.6))
  while (titleSize > titleMin) {
    context.font = `900 ${titleSize}px Arial, sans-serif`
    if (context.measureText(leftTitle).width <= titleMax && context.measureText(rightTitle).width <= titleMax) break
    titleSize -= 1
  }
  const titleY = margin + titleHeight / 2
  const drawTitleSide = (plain: string, strong: string, x: number) => {
    context.fillStyle = '#0f172a'
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.font = `400 ${titleSize}px Arial, sans-serif`
    const plainWidth = plain ? context.measureText(plain).width : 0
    if (plain) context.fillText(plain, x + titlePad, titleY)
    context.font = `900 ${titleSize}px Arial, sans-serif`
    context.fillText(fitText(context, strong, Math.max(8, titleMax - plainWidth)), x + titlePad + plainWidth, titleY)
  }
  drawTitleSide('Короб ', leftStrong, margin)
  drawTitleSide(rightPlain, rightStrong, margin + contentWidth * 0.5)

  context.strokeRect(margin, tableTop, contentWidth, tableHeight)
  const valueX = margin + labelWidth
  info.forEach(([label, value], index) => {
    const y = tableTop + infoRowHeight * index
    context.fillStyle = '#f8fafc'
    context.fillRect(margin + context.lineWidth, y + context.lineWidth, labelWidth - context.lineWidth * 1.5, infoRowHeight - context.lineWidth)
    write(label, margin, y, labelWidth, infoRowHeight, 700, 0.42)
    write(value, valueX, y, contentWidth - labelWidth, infoRowHeight, 800, 0.46)
    if (index < info.length - 1) {
      context.beginPath()
      context.moveTo(margin, y + infoRowHeight)
      context.lineTo(margin + contentWidth, y + infoRowHeight)
      context.stroke()
    }
  })
  context.beginPath()
  context.moveTo(valueX, tableTop)
  context.lineTo(valueX, tableTop + tableHeight)
  context.stroke()

  return canvas.toDataURL('image/png')
}

function buildHalfA4(sources: FulfillmentBoxInfoPageSource[]): Blob {
  const settings: PageGeometry = { width: 210, height: 148.5, scale: 5, margin: 6 }
  const images = sources.map((source) => renderPage(source, 'a4', 'portrait', settings))
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
    putOnlyUsedFonts: true,
  })
  images.forEach((image, index) => {
    if (index > 0 && index % 2 === 0) pdf.addPage('a4', 'portrait')
    pdf.addImage(image, 'PNG', 0, index % 2 === 0 ? 0 : 148.5, 210, 148.5, undefined, 'FAST')
    if (index % 2 === 0 && index + 1 < images.length) {
      pdf.setDrawColor(0, 0, 0)
      pdf.setLineWidth(0.8)
      pdf.setLineDashPattern([4, 2], 0)
      pdf.line(4, 148.5, 206, 148.5)
      pdf.setLineDashPattern([], 0)
    }
  })
  return pdf.output('blob')
}

export function buildFulfillmentBoxInfoPdf(
  sources: FulfillmentBoxInfoPageSource[],
  format: FulfillmentBoxContentsFormat,
  orientation: FulfillmentBoxContentsOrientation,
  half = false,
): Blob {
  if (sources.length === 0) throw new Error('Нет коробов для печати')
  if (half && format === 'a4') return buildHalfA4(sources)

  const settings = pageGeometry(format, orientation)
  const pageOrientation = settings.width > settings.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({
    orientation: pageOrientation,
    unit: 'mm',
    format: [settings.width, settings.height],
    compress: true,
    putOnlyUsedFonts: true,
  })

  sources.forEach((source, index) => {
    if (index > 0) pdf.addPage([settings.width, settings.height], pageOrientation)
    pdf.addImage(
      renderPage(source, format, orientation),
      'PNG',
      0,
      0,
      settings.width,
      settings.height,
      undefined,
      'FAST',
    )
  })

  return pdf.output('blob')
}
