import jsPDF from 'jspdf'
import * as bwipjs from 'bwip-js/browser'

export type WmsLocationQrLabel = {
  code: string
  title: string
  warehouseName: string
  rackName: string
  sideName: string
  address: string
}

const W = 60
const H = 40

const drawQr = (pdf: jsPDF, value: string) => {
  let sourceWidth = 0
  let sourceHeight = 0
  const path: Array<{ op: 'm' | 'l' | 'h'; c: number[] }> = []
  const left = 2
  const top = 3
  const size = 28
  const drawing: Parameters<typeof bwipjs.qrcode>[1] = {
    scale: () => null,
    measure: () => ({ width: 0, ascent: 0, descent: 0 }),
    init: (width, height) => { sourceWidth = width; sourceHeight = height },
    line: () => undefined,
    polygon: (points) => {
      points.forEach(([x, y], index) => path.push({
        op: index === 0 ? 'm' : 'l',
        c: [left + (x / sourceWidth) * size, top + (y / sourceHeight) * size],
      }))
      path.push({ op: 'h', c: [] })
    },
    hexagon: () => undefined,
    ellipse: () => undefined,
    fill: () => undefined,
    text: () => undefined,
    end: () => undefined,
  }
  bwipjs.qrcode({ bcid: 'qrcode', text: value, scale: 1, paddingwidth: 0, paddingheight: 0 }, drawing)
  if (!sourceWidth || !sourceHeight) throw new Error('Не удалось сформировать QR адреса')
  pdf.setFillColor(0, 0, 0)
  pdf.path(path)
  pdf.fillEvenOdd()
}

const infoImage = (label: WmsLocationQrLabel) => {
  const canvas = document.createElement('canvas')
  canvas.width = 310
  canvas.height = 320
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не удалось подготовить этикетку адреса')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#0f172a'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  const lines = [label.title, label.warehouseName, label.rackName, label.sideName, label.address]
  const sizes = [35, 24, 24, 22, 32]
  const weights = [700, 600, 600, 600, 700]
  const ys = [38, 105, 155, 205, 274]
  lines.forEach((line, index) => {
    let size = sizes[index]
    do {
      ctx.font = `${weights[index]} ${size}px Arial, sans-serif`
      if (ctx.measureText(line).width <= 292) break
      size -= 1
    } while (size > 15)
    ctx.fillText(line, 6, ys[index])
  })
  return canvas.toDataURL('image/png')
}

export function buildWmsLocationQrPdf(labels: WmsLocationQrLabel[]): Blob {
  if (!labels.length) throw new Error('Нет адресов для печати')
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [W, H], compress: true, putOnlyUsedFonts: true })
  labels.forEach((label, index) => {
    if (index) pdf.addPage([W, H], 'landscape')
    drawQr(pdf, label.code)
    pdf.setDrawColor(203, 213, 225); pdf.setLineWidth(0.18); pdf.line(31.5, 2, 31.5, 32)
    pdf.addImage(infoImage(label), 'PNG', 33, 1.5, 25, 30.5, undefined, 'FAST')
    pdf.setTextColor(0, 0, 0); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.6)
    pdf.text(label.code, W / 2, 37.2, { align: 'center' })
  })
  return pdf.output('blob')
}
