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
   BODY    = 280px  — текстовые поля (до самого низа)
   Итого   = 400px ✓
────────────────────────────────────────────────────────────── */
const HEADER_H = 120
const BODY_H   = H_PX - HEADER_H  // 280
const BODY_Y   = HEADER_H         // 120

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



/* ── Иконки по уходу — PNG из public/icons/ ────────────────────
   Файлы грузятся один раз при старте, браузер кэширует.
────────────────────────────────────────────────────────────── */
const _iconNames = ['wash-30', 'iron', 'no-bleach', 'no-tumble-dry'] as const
const _icons: Partial<Record<string, HTMLImageElement>> = {}
if (typeof document !== 'undefined') {
  for (const name of _iconNames) {
    const img = new Image()
    img.src = `/icons/${name}.svg`
    _icons[name] = img
  }
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
  ctx.font = `bold 27px Arial, sans-serif`
  let nm = tpl.name
  while (ctx.measureText(nm).width > maxX - PAD && nm.length > 2) nm = nm.slice(0, -1)
  if (nm !== tpl.name) nm += '…'
  ctx.fillText(nm, PAD, y)
  y += 38

  if (tpl.composition)      y = boldLabel(ctx, 'Состав: ',             tpl.composition,      PAD, y, 20, maxX)
  if (tpl.article)          y = boldLabel(ctx, 'Артикул: ',            tpl.article,          PAD, y, 20, maxX)
  if (tpl.brand)            y = boldLabel(ctx, 'Бренд: ',              tpl.brand,            PAD, y, 20, maxX)

  if (tpl.size || tpl.color) {
    ctx.fillStyle = '#111'
    let cx = PAD
    const pair = (lbl: string, val: string) => {
      ctx.font = `bold 20px Arial, sans-serif`
      ctx.fillText(lbl, cx, y); cx += ctx.measureText(lbl).width
      ctx.font = `20px Arial, sans-serif`
      ctx.fillText(val, cx, y); cx += ctx.measureText(val).width + 20
    }
    if (tpl.size)  pair('Размер: ', tpl.size)
    if (tpl.color) pair('Цвет: ',   tpl.color)
    y += Math.round(20 * 1.38)
  }

  if (tpl.supplier)         y = boldLabel(ctx, 'Поставщик: ',         tpl.supplier,         PAD, y, 20, maxX)
  if (tpl.supplier_address) y = boldLabel(ctx, 'Адрес поставщика: ',  tpl.supplier_address, PAD, y, 20, maxX)
  if (tpl.production_date)  y = boldLabel(ctx, 'Дата производства: ', tpl.production_date,  PAD, y, 20, maxX)

  /* Страна + иконки по уходу на одной строке */
  ctx.fillStyle = '#111'
  ctx.font = 'bold 20px Arial, sans-serif'
  const countryLabel = 'Страна: '
  ctx.fillText(countryLabel, PAD, y)
  ctx.font = '20px Arial, sans-serif'
  const countryVal = (tpl.country || '').replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
  ctx.fillText(countryVal, PAD + ctx.measureText(countryLabel).width, y)

  /* иконки по уходу справа на строке Страна — только включённые */
  const iconFlags: Record<string, boolean> = {
    'wash-30':       tpl.icon_wash,
    'iron':          tpl.icon_iron,
    'no-bleach':     tpl.icon_no_bleach,
    'no-tumble-dry': tpl.icon_no_tumble_dry,
  }
  const activeIcons = _iconNames.filter((n) => iconFlags[n])
  const iconSize = 44
  const iconGap  = 10
  if (activeIcons.length > 0) {
    const iconsTotal = activeIcons.length * iconSize + (activeIcons.length - 1) * iconGap
    const iconsX = W_PX - PAD - iconsTotal
    const iconsY = y - iconSize + 12
    for (let i = 0; i < activeIcons.length; i++) {
      const img = _icons[activeIcons[i]]
      const ix = iconsX + i * (iconSize + iconGap)
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, ix, iconsY, iconSize, iconSize)
      }
    }
  }

  ctx.restore() // конец клиппинга

  /* ЕАС в правом верхнем углу тела */
  if (tpl.icon_eac) {
    const eacSize = 64
    drawEAC(ctx, W_PX - PAD - eacSize, BODY_Y + 10, eacSize)
  }

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
