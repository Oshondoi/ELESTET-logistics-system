import jsPDF from 'jspdf'

export type FulfillmentBoxContentsFormat = 'a4' | '120x75'

export interface FulfillmentBoxContentsRow {
  barcode: string
  wbArticle: string
  quantity: number
}

export interface FulfillmentBoxContentsPageSource {
  batchNumber: number | null
  batchName: string
  supplyNumber: number
  warehouseName: string
  boxNumber: number
  rows: FulfillmentBoxContentsRow[]
}

const pageSettings = {
  a4: { width: 210, height: 297, scale: 5, rowsPerPage: 30, margin: 12 },
  '120x75': { width: 120, height: 75, scale: 6, rowsPerPage: 7, margin: 5 },
} as const

function fitText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (context.measureText(value).width <= maxWidth) return value
  let result = value
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1)
  return `${result}…`
}

function renderPage(
  source: FulfillmentBoxContentsPageSource,
  rows: FulfillmentBoxContentsRow[],
  page: number,
  pages: number,
  format: FulfillmentBoxContentsFormat,
): string {
  const settings = pageSettings[format]
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(settings.width * settings.scale)
  canvas.height = Math.round(settings.height * settings.scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось подготовить страницу содержимого короба')

  const px = (mm: number) => mm * settings.scale
  const margin = px(settings.margin)
  const contentWidth = canvas.width - margin * 2
  const isA4 = format === 'a4'

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#0f172a'
  context.textBaseline = 'top'

  context.font = `700 ${px(isA4 ? 6.2 : 4.2)}px Arial, sans-serif`
  context.fillText(`Короб №${source.boxNumber}`, margin, margin)
  context.textAlign = 'right'
  context.font = `700 ${px(isA4 ? 4 : 3)}px Arial, sans-serif`
  context.fillText(`${page}/${pages}`, canvas.width - margin, margin + px(0.8))
  context.textAlign = 'left'

  const batchLabel = `${source.batchNumber != null ? `P-${source.batchNumber}` : source.batchName || 'Партия'} · S-${source.supplyNumber} · ${source.warehouseName || 'Склад не указан'}`
  context.font = `600 ${px(isA4 ? 3.8 : 2.7)}px Arial, sans-serif`
  context.fillStyle = '#334155'
  context.fillText(fitText(context, batchLabel, contentWidth), margin, margin + px(isA4 ? 8.5 : 6.3))

  const tableTop = margin + px(isA4 ? 17 : 12)
  const headerHeight = px(isA4 ? 9 : 6.5)
  const rowHeight = px(isA4 ? 8 : 6.7)
  const barcodeWidth = contentWidth * 0.46
  const articleWidth = contentWidth * 0.34
  const quantityWidth = contentWidth - barcodeWidth - articleWidth

  context.fillStyle = '#f1f5f9'
  context.fillRect(margin, tableTop, contentWidth, headerHeight)
  context.fillStyle = '#334155'
  context.font = `700 ${px(isA4 ? 3.5 : 2.55)}px Arial, sans-serif`
  context.textBaseline = 'middle'
  context.fillText('Баркод', margin + px(2), tableTop + headerHeight / 2)
  context.fillText('Артикул WB', margin + barcodeWidth + px(2), tableTop + headerHeight / 2)
  context.textAlign = 'right'
  context.fillText('Кол-во', margin + contentWidth - px(2), tableTop + headerHeight / 2)
  context.textAlign = 'left'

  rows.forEach((row, index) => {
    const y = tableTop + headerHeight + rowHeight * index
    context.fillStyle = index % 2 === 0 ? '#ffffff' : '#f8fafc'
    context.fillRect(margin, y, contentWidth, rowHeight)
    context.strokeStyle = '#e2e8f0'
    context.lineWidth = Math.max(1, px(0.15))
    context.beginPath()
    context.moveTo(margin, y + rowHeight)
    context.lineTo(margin + contentWidth, y + rowHeight)
    context.stroke()

    context.fillStyle = '#0f172a'
    context.font = `600 ${px(isA4 ? 3.65 : 2.65)}px Arial, sans-serif`
    context.textBaseline = 'middle'
    context.fillText(fitText(context, row.barcode || '—', barcodeWidth - px(4)), margin + px(2), y + rowHeight / 2)
    context.fillText(fitText(context, row.wbArticle || '—', articleWidth - px(4)), margin + barcodeWidth + px(2), y + rowHeight / 2)
    context.textAlign = 'right'
    context.fillText(String(row.quantity), margin + barcodeWidth + articleWidth + quantityWidth - px(2), y + rowHeight / 2)
    context.textAlign = 'left'
  })

  return canvas.toDataURL('image/png')
}

export function buildFulfillmentBoxContentsPdf(
  sources: FulfillmentBoxContentsPageSource[],
  format: FulfillmentBoxContentsFormat,
): Blob {
  const printable = sources.filter((source) => source.rows.length > 0)
  if (printable.length === 0) throw new Error('В выбранных коробах нет товаров')

  const settings = pageSettings[format]
  const orientation = settings.width > settings.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: format === 'a4' ? 'a4' : [settings.width, settings.height],
    compress: true,
    putOnlyUsedFonts: true,
  })

  let documentPage = 0
  printable.forEach((source) => {
    const chunks: FulfillmentBoxContentsRow[][] = []
    for (let index = 0; index < source.rows.length; index += settings.rowsPerPage) {
      chunks.push(source.rows.slice(index, index + settings.rowsPerPage))
    }
    chunks.forEach((rows, index) => {
      if (documentPage > 0) pdf.addPage(format === 'a4' ? 'a4' : [settings.width, settings.height], orientation)
      pdf.addImage(
        renderPage(source, rows, index + 1, chunks.length, format),
        'PNG',
        0,
        0,
        settings.width,
        settings.height,
        undefined,
        'FAST',
      )
      documentPage += 1
    })
  })

  return pdf.output('blob')
}
