export interface LogoCrop { x: number; y: number; zoom: number; aspect: number }
export const squareCrop: LogoCrop = { x: 50, y: 50, zoom: 1, aspect: 1 }
export const rectangleCrop: LogoCrop = { x: 50, y: 50, zoom: 1, aspect: 3 }
export async function renderLogoCrop(src: string, crop: LogoCrop): Promise<Blob> {
  const img=new Image();img.src=src;await img.decode()
  const canvas=document.createElement('canvas')
  canvas.width=512;canvas.height=Math.round(512/crop.aspect)
  const ctx=canvas.getContext('2d')
  if(!ctx)throw new Error('Не удалось подготовить логотип')
  const scale=Math.max(canvas.width/img.naturalWidth,canvas.height/img.naturalHeight)*crop.zoom
  const width=img.naturalWidth*scale,height=img.naturalHeight*scale
  ctx.drawImage(img,(canvas.width-width)*crop.x/100,(canvas.height-height)*crop.y/100,width,height)
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось сохранить обрезку')),'image/png'))
}
export function normalizeLogoCrop(value: Partial<LogoCrop> | null, square: boolean): LogoCrop {
  const bound = (v: unknown, min: number, max: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
  return { x: bound(value?.x,0,100,50), y: bound(value?.y,0,100,50), zoom: bound(value?.zoom,1,5,1), aspect: square ? 1 : bound(value?.aspect,1.5,5,3) }
}
// SVGs are kept private, rendered only in <img>, never inserted into the DOM.
// Reject scripts, external resources, foreignObject, CSS and event handlers.
export async function validateLogoFile(file: File) {
  if (!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('Нужен PNG, JPG, WebP или безопасный SVG до 2 МБ.')
  if (file.type === 'image/svg+xml') {
    const source = await file.text()
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVG содержит недопустимые инструкции.')
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Некорректный SVG.')
    const tags = new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','linearGradient','radialGradient','stop','clipPath','mask','title','desc'])
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      if (!tags.has(el.localName)) throw new Error('Этот SVG содержит неподдерживаемые элементы. Экспортируйте логотип в PNG или простой SVG.')
      for (const attr of Array.from(el.attributes)) {
        if (/^on|href|style/i.test(attr.name) || /url\(\s*[^#]|javascript:|data:|https?:/i.test(attr.value) && !attr.name.startsWith('xmlns')) throw new Error('SVG содержит внешние ресурсы или активное содержимое.')
      }
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image(); img.src = url; await img.decode()
    if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth > 8192 || img.naturalHeight > 8192) throw new Error('Максимальный размер логотипа — 8192 × 8192 пикселя.')
  } finally { URL.revokeObjectURL(url) }
}
