import { supabase } from '../lib/supabase'
import { blocksForMode, defaultBlocks, edgeGuides, goodsFromSticker, type LabelBlock, type LabelGuides, type LabelMode, type LabelSizeId, type LabelTemplate, type SheetGoods } from '../lib/labelSheet'
import type { StickerTemplate } from '../types'

function db() {
  if (!supabase) throw new Error('База не настроена. Обновите страницу.')
  return supabase as any
}

function missingTable(message: string): boolean {
  return /label_templates|schema cache|does not exist/i.test(message)
}

function readBlocks(value: unknown, mode: LabelMode): LabelBlock[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set(blocksForMode(mode))
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const type = String(row.type ?? '') as LabelBlock['type']
    if (!allowed.has(type)) return []
    const x = Number(row.x)
    const y = Number(row.y)
    const w = Number(row.w)
    const h = Number(row.h)
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return []
    return [{ id: String(row.id || type), type, x, y, w, h }]
  })
}

function readGuides(value: unknown): LabelGuides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return edgeGuides()
  const guides = (value as Record<string, unknown>).guides
  if (!guides || typeof guides !== 'object' || Array.isArray(guides)) return edgeGuides()
  const row = guides as Record<string, unknown>
  const next = {
    top: Number(row.top),
    right: Number(row.right),
    bottom: Number(row.bottom),
    left: Number(row.left),
  }
  if (![next.top, next.right, next.bottom, next.left].every((item) => Number.isFinite(item) && item >= 0)) return edgeGuides()
  return next
}

function readStored(value: unknown, mode: LabelMode): { blocks: LabelBlock[]; guides: LabelGuides } {
  if (Array.isArray(value)) return { blocks: readBlocks(value, mode), guides: edgeGuides() }
  if (value && typeof value === 'object') {
    return { blocks: readBlocks((value as Record<string, unknown>).blocks, mode), guides: readGuides(value) }
  }
  return { blocks: [], guides: edgeGuides() }
}

function storedSheet(blocks: LabelBlock[], guides: LabelGuides) {
  return { blocks, guides }
}

function rowToTemplate(row: Record<string, unknown>): LabelTemplate {
  const mode = (row.mode === 'kiz' || row.mode === 'combined' ? row.mode : 'barcode') as LabelMode
  const size: LabelSizeId = row.size === '120x75' ? '120x75' : '58x40'
  const stored = readStored(row.blocks, mode)
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    name: String(row.name ?? ''),
    size,
    mode,
    blocks: stored.blocks,
    guides: stored.guides,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export async function fetchLabelTemplates(accountId: string): Promise<LabelTemplate[]> {
  const client = db()
  const { data, error } = await client
    .from('label_templates')
    .select('id, account_id, name, size, mode, blocks, created_at, updated_at')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
  if (error) {
    if (missingTable(error.message ?? '')) return []
    throw new Error('Не удалось прочитать шаблоны. Обновите страницу.')
  }
  return ((data ?? []) as Record<string, unknown>[]).map(rowToTemplate)
}

export async function createLabelTemplate(accountId: string, name: string, size: LabelSizeId, mode: LabelMode): Promise<LabelTemplate> {
  const clean = name.trim()
  if (!clean) throw new Error('Введите название шаблона.')
  if (clean.length > 80) throw new Error('Название шаблона длиннее 80 знаков.')
  const client = db()
  const { data, error } = await client
    .from('label_templates')
    .insert({
      account_id: accountId,
      name: clean,
      size,
      mode,
      blocks: storedSheet(defaultBlocks(size, mode), edgeGuides()),
    })
    .select('id, account_id, name, size, mode, blocks, created_at, updated_at')
    .single()
  if (error) {
    if (missingTable(error.message ?? '')) throw new Error('Шаблоны ещё не созданы в базе. Примените patch_label_templates.sql.')
    if (/duplicate|unique/i.test(error.message ?? '')) throw new Error('Шаблон с таким названием уже есть.')
    throw new Error('Не удалось создать шаблон.')
  }
  return rowToTemplate(data as Record<string, unknown>)
}

export async function saveLabelTemplate(template: Pick<LabelTemplate, 'id' | 'name' | 'blocks' | 'guides'>): Promise<LabelTemplate> {
  const clean = template.name.trim()
  if (!clean) throw new Error('Введите название шаблона.')
  const client = db()
  const { data, error } = await client
    .from('label_templates')
    .update({ name: clean, blocks: storedSheet(template.blocks, template.guides), updated_at: new Date().toISOString() })
    .eq('id', template.id)
    .select('id, account_id, name, size, mode, blocks, created_at, updated_at')
    .single()
  if (error) {
    if (/duplicate|unique/i.test(error.message ?? '')) throw new Error('Шаблон с таким названием уже есть.')
    throw new Error('Не удалось сохранить шаблон.')
  }
  return rowToTemplate(data as Record<string, unknown>)
}

function productText(product: Record<string, unknown> | null, keys: string[]): string {
  if (!product) return ''
  for (const key of keys) {
    const value = product[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export async function goodsForPrint(storeId: string, gtin: string, product: Record<string, unknown> | null): Promise<{ goods: SheetGoods; linked: boolean }> {
  const client = db()
  const { data: link } = await client
    .from('fulfillment_product_gtin_links')
    .select('wb_barcode')
    .eq('store_id', storeId)
    .eq('gtin', gtin)
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  const barcode = String(link?.wb_barcode ?? '')
  let sticker: StickerTemplate | null = null
  if (barcode) {
    const { data } = await client.from('sticker_templates').select('*').eq('store_id', storeId).eq('barcode', barcode).limit(1).maybeSingle()
    sticker = (data as StickerTemplate | null) ?? null
  }
  if (sticker) return { goods: { ...goodsFromSticker(sticker), barcode: sticker.barcode || barcode }, linked: true }
  return {
    linked: Boolean(barcode),
    goods: {
      barcode,
      name: productText(product, ['fullName', 'full_name', 'name']),
      article: productText(product, ['article', 'nmId', 'nm_id']),
      sellerArticle: productText(product, ['vendorCode', 'vendor_code', 'sku']),
      size: productText(product, ['size']),
      color: productText(product, ['color', 'colour']),
      brand: productText(product, ['brand']),
      composition: '',
      supplier: '',
      address: '',
      date: '',
      country: '',
      icons: { wash: false, iron: false, noBleach: false, noTumble: false, dryClean: false, eac: false },
    },
  }
}

export async function deleteLabelTemplate(id: string): Promise<void> {
  const client = db()
  const { error } = await client.from('label_templates').delete().eq('id', id)
  if (error) throw new Error('Не удалось удалить шаблон.')
}
