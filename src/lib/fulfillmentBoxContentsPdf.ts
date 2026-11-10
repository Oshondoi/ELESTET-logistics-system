import jsPDF from 'jspdf'

export type FulfillmentBoxContentsFormat = 'a4' | '120x75'
export type FulfillmentBoxContentsOrientation = 'portrait' | 'landscape'

export interface FulfillmentBoxContentsRow {
  barcode: string
  wbArticle: string
  sellerArticle: string
  productName: string
  quantity: number
}

export interface FulfillmentBoxContentsPageSource {
  batchNumber: number | null
  batchName: string
  legalName: string
  recipientCode: string
  supplyNumber: number
  warehouseName: string
  cargoDate: string
  boxNumber: number
  rows: FulfillmentBoxContentsRow[]
}

interface PageGeometry {
  width: number
  height: number
  scale: number
  rowsPerPage: number
  margin: number
}

function pageGeometry(format: FulfillmentBoxContentsFormat, orientation: FulfillmentBoxContentsOrientation): PageGeometry {
  const landscape = orientation === 'landscape'
  if (format === 'a4') {
    return {
      width: landscape ? 297 : 210,
      height: landscape ? 210 : 297,
      scale: 5,
      margin: 12,
      rowsPerPage: landscape ? 12 : 24,
    }
  }
  return {
    width: landscape ? 120 : 75,
    height: landscape ? 75 : 120,
    scale: 6,
    margin: 4,
    rowsPerPage: landscape ? 4 : 8,
  }
}

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
  orientation: FulfillmentBoxContentsOrientation,
): string {
  const settings = pageGeometry(format, orientation)
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

  const titleSize = px(isA4 ? 5.2 : 3.2)
  const numberSize = px(isA4 ? 9.2 : 5.8)
  context.font = `800 ${titleSize}px Arial, sans-serif`
  context.fillText('Короб', margin, margin)
  const titleWidth = context.measureText('Короб ').width
  context.font = `900 ${numberSize}px Arial, sans-serif`
  context.fillText(`№${source.boxNumber}`, margin + titleWidth, margin - px(isA4 ? 1.2 : 0.7))
  context.textAlign = 'right'
  context.font = `700 ${px(isA4 ? 4 : 2.8)}px Arial, sans-serif`
  context.fillText(`${page}/${pages}`, canvas.width - margin, margin + px(1.2))
  context.textAlign = 'left'

  const info = [
    ['ИП/ОсОО', source.legalName || '—'],
    ['Код получателя', source.recipientCode || '—'],
    ['Склад назначения', source.warehouseName || '—'],
    ['Сдача на склад/карго (РЕД ЭКСПРЕС), Бишкек', source.cargoDate || '—'],
    ['Партия', `${source.batchNumber != null ? `P-${source.batchNumber}` : source.batchName || '—'} · Поставка S-${source.supplyNumber}`],
  ]
  const infoSize = px(isA4 ? 3.3 : 2.15)
  const infoStep = px(isA4 ? 4.6 : 3.15)
  let infoY = margin + px(isA4 ? 11 : 7.2)
  info.forEach(([label, value]) => {
    context.font = `600 ${infoSize}px Arial, sans-serif`
    context.fillStyle = '#334155'
    const labelText = `${label}: `
    context.fillText(labelText, margin, infoY)
    const labelWidth = context.measureText(labelText).width
    context.font = `700 ${infoSize}px Arial, sans-serif`
    context.fillStyle = '#0f172a'
    context.fillText(fitText(context, value, Math.max(20, contentWidth - labelWidth)), margin + labelWidth, infoY)
    infoY += infoStep
  })

  const tableTop = infoY + px(isA4 ? 2.2 : 1.2)
  const headerHeight = px(isA4 ? 8 : 5.4)
  const rowHeight = px(isA4 ? 7.2 : 5.6)
  const barcodeWidth = contentWidth * 0.22
  const wbWidth = contentWidth * 0.14
  const sellerWidth = contentWidth * 0.18
  const nameWidth = contentWidth * 0.36
  const quantityWidth = contentWidth - barcodeWidth - wbWidth - sellerWidth - nameWidth
  const columns = [
    { label: 'Баркод', width: barcodeWidth, align: 'left' as const },
    { label: 'Артикул WB', width: wbWidth, align: 'left' as const },
    { label: 'Артикул продавца', width: sellerWidth, align: 'left' as const },
    { label: 'Наименование', width: nameWidth, align: 'left' as const },
    { label: 'Кол-во', width: quantityWidth, align: 'right' as const },
  ]

  context.fillStyle = '#f1f5f9'
  context.fillRect(margin, tableTop, contentWidth, headerHeight)
  context.fillStyle = '#334155'
  context.font = `700 ${px(isA4 ? 3.1 : 2.05)}px Arial, sans-serif`
  context.textBaseline = 'middle'
  let columnX = margin
  columns.forEach((column) => {
    context.textAlign = column.align
    const textX = column.align === 'right' ? columnX + column.width - px(1.4) : columnX + px(1.4)
    context.fillText(column.label, textX, tableTop + headerHeight / 2)
    columnX += column.width
  })

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

    const values = [row.barcode || '—', row.wbArticle || '—', row.sellerArticle || '—', row.productName || '—', String(row.quantity)]
    context.fillStyle = '#0f172a'
    context.font = `600 ${px(isA4 ? 3.2 : 2.15)}px Arial, sans-serif`
    let cellX = margin
    columns.forEach((column, cellIndex) => {
      context.textAlign = column.align
      const textX = column.align === 'right' ? cellX + column.width - px(1.4) : cellX + px(1.4)
      context.fillText(fitText(context, values[cellIndex], column.width - px(2.8)), textX, y + rowHeight / 2)
      cellX += column.width
    })
    context.textAlign = 'left'
  })

  return canvas.toDataURL('image/png')
}

export function buildFulfillmentBoxContentsPdf(
  sources: FulfillmentBoxContentsPageSource[],
  format: FulfillmentBoxContentsFormat,
  orientation: FulfillmentBoxContentsOrientation,
): Blob {
  const printable = sources.filter((source) => source.rows.length > 0)
  if (printable.length === 0) throw new Error('В выбранных коробах нет товаров')

  const settings = pageGeometry(format, orientation)
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [settings.width, settings.height],
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
      if (documentPage > 0) pdf.addPage([settings.width, settings.height], 'portrait')
      pdf.addImage(
        renderPage(source, rows, index + 1, chunks.length, format, orientation),
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
