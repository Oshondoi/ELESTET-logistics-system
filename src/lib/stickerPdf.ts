import JsBarcode from 'jsbarcode'
import jsPDF from 'jspdf'
import type { StickerTemplate } from '../types'

/* ── Размеры холста ─────────────────────────────────────────── */
const W_MM = 58
const H_MM = 40
const W_PX = W_MM * 10   // 580
const H_PX = H_MM * 10   // 400
const PAD  = 14

/* ── Зоны (px) ─────────────────────────────────────────────────
   HEADER  = 120px  — штрихкод
   BODY    = 236px  — текстовые поля (полная ширина)
   FOOTER  =  44px  — иконки по уходу + ЕАС (горизонтально)
   Итого   = 400px ✓
────────────────────────────────────────────────────────────── */
const HEADER_H = 120
const FOOTER_H = 44
const BODY_H   = H_PX - HEADER_H - FOOTER_H  // 236
const BODY_Y   = HEADER_H                     // 120
const FOOTER_Y = BODY_Y + BODY_H              // 356

/* ── Вспомогательная: жирная метка + обычный текст ─────────── */
const boldLabel = (
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  px: number,
  py: number,
  fontSize: number,
  maxX = W_PX - PAD,
): number => {
  if (!value) return py
  ctx.fillStyle = '#111'
  ctx.font = `bold ${fontSize}px Arial, sans-serif`
  const lw = ctx.measureText(label).width
  ctx.fillText(label, px, py)
  ctx.font = `${fontSize}px Arial, sans-serif`
  const clean = value.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
  let val = clean
  while (ctx.measureText(val).width > maxX - px - lw && val.length > 2) val = val.slice(0, -1)
  if (val !== clean) val += '…'
  ctx.fillText(val, px + lw, py)
  return py + Math.round(fontSize * 1.38)
}

/* ── Знак ЕАС — из файла public/eac.svg ────────────────────────
   Файл загружается один раз при старте, браузер кэширует.
────────────────────────────────────────────────────────────── */
const _eacImg: HTMLImageElement | null = typeof document !== 'undefined' ? new Image() : null
if (_eacImg) _eacImg.src = '/eac.svg'

const drawEAC = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
  if (_eacImg && _eacImg.complete && _eacImg.naturalWidth > 0) {
    ctx.drawImage(_eacImg, x, y, size, size)
  } else {
    /* fallback на rect-рисование если файл ещё не загрузился */
    ctx.save()
    const bw = Math.max(2, Math.round(size / 13))
    ctx.strokeStyle = '#111'
    ctx.lineWidth = bw
    ctx.strokeRect(x + bw / 2, y + bw / 2, size - bw, size - bw)
    const t  = Math.round(size * 0.095)
    const cw = Math.round(size * 0.215)
    const ch = Math.round(size * 0.54)
    const gp = Math.round(size * 0.052)
    const tw = cw * 3 + gp * 2
    const ox = x + Math.round((size - tw) / 2)
    const oy = y + Math.round((size - ch) / 2)
    ctx.fillStyle = '#111'
    const ex = ox
    ctx.fillRect(ex, oy, t, ch)
    ctx.fillRect(ex, oy, cw, t)
    ctx.fillRect(ex, oy + ((ch - t) >> 1), Math.round(cw * 0.72), t)
    ctx.fillRect(ex, oy + ch - t, cw, t)
    const ax = ox + cw + gp
    ctx.fillRect(ax, oy, t, ch)
    ctx.fillRect(ax + cw - t, oy, t, ch)
    ctx.fillRect(ax, oy, cw, t)
    ctx.fillRect(ax, oy + Math.round(ch * 0.42), cw, t)
    const sx = ox + (cw + gp) * 2
    ctx.fillRect(sx, oy, t, ch)
    ctx.fillRect(sx, oy, cw, t)
    ctx.fillRect(sx, oy + ch - t, cw, t)
    ctx.restore()
  }
}

/* ── Иконки по уходу — 2-колоночная сетка ───────────────────── */
/* ── Подвал: иконки по уходу + ЕАС горизонтально ──────────── */
const drawFooterIcons = (
  ctx: CanvasRenderingContext2D,
  footerY: number,
  footerH: number,
) => {
  ctx.save()
  const size = 26                          // px — ≈2.6мм на стикере
  const gap  = 10
  const items = 5                          // 4 иконки + ЕАС
  const totalW = items * size + (items - 1) * gap
  const startX = Math.round((W_PX - totalW) / 2)
  const startY = footerY + Math.round((footerH - size) / 2)
  const sw = Math.max(1, Math.round(size / 14))

  ctx.strokeStyle = '#333'
  ctx.fillStyle   = '#333'
  ctx.lineWidth   = sw

  for (let i = 0; i < 4; i++) {
    const x  = startX + i * (size + gap)
    const y  = startY
    const cx = x + size / 2
    const cy = y + size / 2

    ctx.save()
    ctx.lineWidth = sw

    if (i === 0) {
      /* Стирка 30°C — корыто */
      const r = Math.round(size * 0.18)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + size, y)
      ctx.lineTo(x + size, y + size - r)
      ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size)
      ctx.lineTo(x + r, y + size)
      ctx.quadraticCurveTo(x, y + size, x, y + size - r)
      ctx.closePath()
      ctx.stroke()
      ctx.font = `bold ${Math.round(size * 0.33)}px Arial`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('30', cx, cy + size * 0.08)
    } else if (i === 1) {
      /* Утюг */
      ctx.beginPath()
      ctx.moveTo(x + size * 0.30, y + size * 0.28)
      ctx.lineTo(x + size * 0.30, y + size * 0.10)
      ctx.lineTo(x + size * 0.72, y + size * 0.10)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x,              y + size * 0.30)
      ctx.lineTo(x + size,       y + size * 0.30)
      ctx.lineTo(x + size * 0.88, y + size * 0.72)
      ctx.lineTo(x + size * 0.12, y + size * 0.72)
      ctx.closePath()
      ctx.stroke()
    } else if (i === 2) {
      /* Нельзя отбеливать — треугольник с × */
      ctx.beginPath()
      ctx.moveTo(x + size / 2, y)
      ctx.lineTo(x + size,     y + size * 0.82)
      ctx.lineTo(x,            y + size * 0.82)
      ctx.closePath()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x + size * 0.30, y + size * 0.28)
      ctx.lineTo(x + size * 0.70, y + size * 0.64)
      ctx.moveTo(x + size * 0.70, y + size * 0.28)
      ctx.lineTo(x + size * 0.30, y + size * 0.64)
      ctx.stroke()
    } else {
      /* Нельзя в барабан — квадрат + круг + × */
      ctx.strokeRect(x, y, size, size)
      ctx.beginPath()
      ctx.arc(cx, cy, size * 0.30, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x + size * 0.27, y + size * 0.27)
      ctx.lineTo(x + size * 0.73, y + size * 0.73)
      ctx.moveTo(x + size * 0.73, y + size * 0.27)
      ctx.lineTo(x + size * 0.27, y + size * 0.73)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 5-й элемент: ЕАС
  const eacX = startX + 4 * (size + gap)
  drawEAC(ctx, eacX, startY, size)

  ctx.restore()
}

/* ── Основная функция рендера ────────────────────────────────── */
const renderStickerToCanvas = (tpl: StickerTemplate): string => {
  const canvas = document.createElement('canvas')
  canvas.width  = W_PX
  canvas.height = H_PX
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W_PX, H_PX)

  /* ════════════════════════════════
     ШАПКА: штрихкод
  ════════════════════════════════ */
  const bcCanvas = document.createElement('canvas')
  let bcDrawn = false
  try {
    // displayValue: false — цифры рисуем вручную, чтобы контролировать размер
    JsBarcode(bcCanvas, tpl.barcode, {
      format: 'EAN13',
      width: 4,
      height: 80,
      displayValue: false,
      margin: 0,
      background: '#ffffff',
      lineColor: '#000000',
      flat: true,
    })
    bcDrawn = true
  } catch { /* невалидный баркод */ }

  if (bcDrawn && bcCanvas.width > 0) {
    // Рисуем полосы 1:1 — пиксель в пиксель, без масштабирования
    const bcX = Math.round((W_PX - bcCanvas.width) / 2)
    const bcY = 4
    ctx.drawImage(bcCanvas, bcX, bcY)

    // Цифры вручную с межсимвольным интервалом: подбираем spacing чтобы занять ~90% ширины баркода
    const targetTextW = Math.round(bcCanvas.width * 0.90)
    let fontSize = 30
    ctx.save()
    ctx.fillStyle = '#111111'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    // Подбираем шрифт + spacing: начинаем с spacing=6, уменьшаем если не влезает
    const digits = tpl.barcode
    let spacing = 8
    ctx.font = `normal ${fontSize}px Arial, sans-serif`
    const charW = ctx.measureText('0').width  // средняя ширина одной цифры
    // Общая ширина = charW * n + spacing * (n-1)
    const totalW = () => charW * digits.length + spacing * (digits.length - 1)
    while (totalW() > targetTextW && spacing > 0) spacing -= 1
    // Центрируем блок
    const blockW = charW * digits.length + spacing * (digits.length - 1)
    let cx = Math.round((W_PX - blockW) / 2)
    const textY = bcY + bcCanvas.height + 4
    for (const ch of digits) {
      ctx.fillText(ch, cx, textY)
      cx += Math.round(ctx.measureText(ch).width) + spacing
    }
    ctx.restore()
  }

  /* разделитель шапка / тело */
  ctx.save()
  ctx.strokeStyle = '#d4d4d4'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(PAD, BODY_Y); ctx.lineTo(W_PX - PAD, BODY_Y); ctx.stroke()
  ctx.restore()

  /* ════════════════════════════════
     ТЕЛО: текстовые поля (полная ширина)
  ════════════════════════════════ */
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, BODY_Y, W_PX, BODY_H)
  ctx.clip()

  let y = BODY_Y + 18
  const maxX = W_PX - PAD

  /* Наименование — жирное */
  ctx.fillStyle = '#111'
  ctx.font = `bold 24px Arial, sans-serif`
  let nm = tpl.name
  while (ctx.measureText(nm).width > maxX - PAD && nm.length > 2) nm = nm.slice(0, -1)
  if (nm !== tpl.name) nm += '…'
  ctx.fillText(nm, PAD, y)
  y += 32

  if (tpl.composition)      y = boldLabel(ctx, 'Состав: ',             tpl.composition,      PAD, y, 18, maxX)
  if (tpl.article)          y = boldLabel(ctx, 'Артикул: ',            tpl.article,          PAD, y, 18, maxX)
  if (tpl.brand)            y = boldLabel(ctx, 'Бренд: ',              tpl.brand,            PAD, y, 18, maxX)

  if (tpl.size || tpl.color) {
    ctx.fillStyle = '#111'
    let cx = PAD
    const pair = (lbl: string, val: string) => {
      ctx.font = `bold 18px Arial, sans-serif`
      ctx.fillText(lbl, cx, y); cx += ctx.measureText(lbl).width
      ctx.font = `18px Arial, sans-serif`
      ctx.fillText(val, cx, y); cx += ctx.measureText(val).width + 18
    }
    if (tpl.size)  pair('Размер: ', tpl.size)
    if (tpl.color) pair('Цвет: ',   tpl.color)
    y += Math.round(18 * 1.38)
  }

  if (tpl.supplier)         y = boldLabel(ctx, 'Поставщик: ',         tpl.supplier,         PAD, y, 18, maxX)
  if (tpl.supplier_address) y = boldLabel(ctx, 'Адрес поставщика: ',  tpl.supplier_address, PAD, y, 18, maxX)
  if (tpl.production_date)  y = boldLabel(ctx, 'Дата производства: ', tpl.production_date,  PAD, y, 18, maxX)
  boldLabel(ctx, 'Страна: ', tpl.country, PAD, y, 18, maxX)

  ctx.restore() // конец клиппинга левого блока

  /* ЕАС в правом верхнем углу тела */
  const eacSize = 64
  drawEAC(ctx, W_PX - PAD - eacSize, BODY_Y + 10, eacSize)

  /* разделитель тело / подвал */
  ctx.save()
  ctx.strokeStyle = '#d4d4d4'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(PAD, FOOTER_Y); ctx.lineTo(W_PX - PAD, FOOTER_Y); ctx.stroke()
  ctx.restore()

  /* ════════════════════════════════
     ПОДВАЛ: иконки по уходу + ЕАС
  ════════════════════════════════ */
  drawFooterIcons(ctx, FOOTER_Y, FOOTER_H)

  return canvas.toDataURL('image/png')
}

/* ── PDF helpers ─────────────────────────────────────────────── */
const buildPdf = (templates: StickerTemplate[]): jsPDF => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [W_MM, H_MM] })
  let first = true
  templates.forEach((tpl) => {
    const copies = Math.max(1, tpl.copies)
    const img = renderStickerToCanvas(tpl)
    for (let c = 0; c < copies; c++) {
      if (!first) doc.addPage([W_MM, H_MM], 'landscape')
      doc.addImage(img, 'PNG', 0, 0, W_MM, H_MM)
      first = false
    }
  })
  return doc
}

export const downloadStickerPdf = (templates: StickerTemplate[]): void => {
  if (templates.length === 0) return
  buildPdf(templates).save('stickers.pdf')
}

export const previewStickerPdf = (templates: StickerTemplate[]): void => {
  if (templates.length === 0) return
  const url = buildPdf(templates).output('bloburl') as string
  window.open(url, '_blank')
}
