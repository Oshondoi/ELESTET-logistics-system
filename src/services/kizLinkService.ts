import { supabase } from '../lib/supabase'

export type KizBarcodeLink = {
  wb_barcode: string
  gtin: string
}

export type KizWbProduct = {
  id: string
  nm_id: number
  vendor_code: string | null
  name: string | null
  brand: string | null
  color: string | null
  barcodes: string[] | null
  photos: unknown
  sizes: unknown
}

export type KizGtinCard = {
  gtin: string
  name: string | null
  full_name: string | null
  product_group_code: string | null
  status: string | null
}

function db() {
  if (!supabase) throw new Error('База не настроена. Обновите страницу.')
  return supabase as any
}

export type KizSizeRow = {
  techSize: string
  barcode: string
  rowKey: string
}

const KIZ_LETTER_SIZE_ORDER: Array<[string, number]> = [
  ['XXXL', 8], ['XXL', 7], ['XXS', 1],
  ['6XL', 11], ['5XL', 10], ['4XL', 9], ['3XL', 8], ['2XL', 7],
  ['XL', 6], ['XS', 2], ['S', 3], ['M', 4], ['L', 5],
]

function kizSizeRank(techSize: string): [number, number] {
  const raw = techSize.trim().toUpperCase().replace(/\s+/g, '')
  if (!raw || raw === '—') return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const [head, tail = ''] = raw.split(/[/(]/)
  const letter = KIZ_LETTER_SIZE_ORDER.find(([token]) => head === token || head.startsWith(token))
  const tailNumber = Number.parseFloat(tail.replace(',', '.'))
  if (letter) return [letter[1], Number.isFinite(tailNumber) ? tailNumber : 0]
  const number = Number.parseFloat(head.replace(',', '.'))
  if (Number.isFinite(number)) return [1000 + number, 0]
  return [Number.POSITIVE_INFINITY, 0]
}

export function kizPhotoUrl(photos: unknown): string | null {
  const list = photos as Array<{ c246x328?: string; big?: string }> | null
  return list?.[0]?.c246x328 ?? list?.[0]?.big ?? null
}

export function kizSizeRows(product: KizWbProduct): KizSizeRow[] {
  const sizes = (product.sizes ?? []) as Array<{ techSize?: string; skus?: string[] }>
  if (sizes.length === 0) {
    return [{ techSize: '—', barcode: product.barcodes?.[0] ?? '—', rowKey: `${product.id}-0` }]
  }
  const rows: KizSizeRow[] = []
  sizes.forEach((size, sizeIndex) => {
    const skus = size.skus ?? []
    if (skus.length === 0) {
      rows.push({ techSize: size.techSize ?? '—', barcode: '—', rowKey: `${product.id}-${sizeIndex}` })
      return
    }
    skus.forEach((sku, skuIndex) => {
      rows.push({ techSize: size.techSize ?? '—', barcode: sku, rowKey: `${product.id}-${sizeIndex}-${skuIndex}` })
    })
  })
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const [aRank, aTie] = kizSizeRank(a.row.techSize)
      const [bRank, bTie] = kizSizeRank(b.row.techSize)
      return aRank - bRank || aTie - bTie || a.index - b.index
    })
    .map((item) => item.row)
}

export function kizProductMatches(product: KizWbProduct, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    String(product.nm_id),
    product.vendor_code,
    product.name,
    product.brand,
    product.color,
    ...(product.barcodes ?? []),
    ...kizSizeRows(product).map((row) => row.barcode),
  ]
  return haystack.some((value) => (value ?? '').toLowerCase().includes(needle))
}

export function kizLinkError(error: { message?: string; code?: string } | null): string {
  const message = error?.message ?? ''
  if (/set_kiz_barcode_gtin_link|clear_kiz_barcode_gtin_link|schema cache|does not exist/i.test(message)) {
    return 'Связка ещё не готова в базе. Повторите чуть позже.'
  }
  if (/владелец или администратор/i.test(message)) return 'Связку меняет владелец или администратор компании.'
  if (/уже связан/i.test(message)) return 'Этот GTIN уже связан с другим размером. Сначала снимите ту связку.'
  if (/нет среди товаров Teksher/i.test(message)) return message
  if (/не найден в товарах/i.test(message)) return message
  return 'Не удалось записать связку. Повторите.'
}

function catalogNeedle(search: string): string {
  return search.trim().replace(/[%_,]/g, '')
}

export async function syncStoreTeksherCatalog(storeId: string): Promise<number> {
  if (!supabase) throw new Error('База не настроена. Обновите страницу.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Сессия истекла. Войдите снова.')
  const { data, error } = await supabase.functions.invoke('teksher-auth', {
    body: { store_id: storeId, action: 'link_products' },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) throw new Error('Не удалось обновить товары Teksher.')
  const payload = data as { error?: string; items?: unknown[] } | null
  if (payload?.error) throw new Error(payload.error)
  return payload?.items?.length ?? 0
}

export type TeksherCatalogItem = {
  id: string | number
  gtin: string
  name?: string
  fullName?: string
  status?: string
  codesCount?: number
}

export async function fetchGtinLinkFaces(storeId: string): Promise<Record<string, string | null>> {
  const client = db()
  const links: Array<{ gtin: string; wb_barcode: string }> = []
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await client.from('fulfillment_product_gtin_links')
      .select('gtin,wb_barcode')
      .eq('store_id', storeId)
      .eq('active', true)
      .range(from, from + 999)
    if (error) throw new Error('Не удалось загрузить связки.')
    links.push(...((data ?? []) as Array<{ gtin: string; wb_barcode: string }>))
    if (!data || data.length < 1000) break
  }
  const photoByBarcode = new Map<string, string | null>()
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await client.from('products').select('barcodes,photos,sizes').eq('store_id', storeId).range(from, from + 999)
    if (error) throw new Error('Не удалось загрузить фото товаров.')
    for (const product of (data ?? []) as KizWbProduct[]) {
      const photo = kizPhotoUrl(product.photos)
      const barcodes = [
        ...(product.barcodes ?? []),
        ...((product.sizes ?? []) as Array<{ skus?: string[] }>).flatMap((size) => size.skus ?? []),
      ]
      barcodes.forEach((barcode) => {
        if (barcode && !photoByBarcode.has(barcode)) photoByBarcode.set(barcode, photo)
      })
    }
    if (!data || data.length < 1000) break
  }
  const faces: Record<string, string | null> = {}
  links.forEach((link) => {
    if (!link.gtin) return
    faces[link.gtin] = photoByBarcode.get(link.wb_barcode) ?? null
  })
  return faces
}

export async function fetchTeksherCatalog(
  storeId: string,
  page: number,
  search: string,
  link: 'all' | 'yes' | 'no' = 'all',
  linkedGtins: string[] = [],
): Promise<{ items: TeksherCatalogItem[]; total: number }> {
  const client = db()
  if (link === 'yes' && linkedGtins.length === 0) return { items: [], total: 0 }
  const size = 20
  const from = page * size
  let query = client.from('teksher_products')
    .select('teksher_id,gtin,name,full_name,status,codes_count', { count: 'exact' })
    .eq('store_id', storeId)
    .eq('in_catalog', true)
    .order('full_name')
  const needle = catalogNeedle(search)
  if (needle) query = query.or(`name.ilike.%${needle}%,full_name.ilike.%${needle}%,gtin.ilike.%${needle}%`)
  if (link === 'yes') query = query.in('gtin', linkedGtins)
  if (link === 'no' && linkedGtins.length > 0) query = query.not('gtin', 'in', `(${linkedGtins.map((gtin) => `"${gtin}"`).join(',')})`)
  const { data, error, count } = await query.range(from, from + size - 1)
  if (error) throw new Error('Не удалось загрузить товары Teksher.')
  const items = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: (row.teksher_id as string | number | null) ?? String(row.gtin ?? ''),
    gtin: String(row.gtin ?? ''),
    name: (row.name as string | null) ?? undefined,
    fullName: (row.full_name as string | null) ?? undefined,
    status: (row.status as string | null) ?? undefined,
    codesCount: row.codes_count == null ? undefined : Number(row.codes_count),
  }))
  return { items, total: count ?? items.length }
}

export async function fetchStoreTeksherProducts(storeId: string): Promise<KizGtinCard[]> {
  const client = db()
  const pageSize = 1000
  const seen = new Set<string>()
  const items: KizGtinCard[] = []
  for (let from = 0; from < 100000; from += pageSize) {
    const { data, error } = await client.from('teksher_products')
      .select('gtin,name,full_name,product_group_code,status')
      .eq('store_id', storeId)
      .eq('in_catalog', true)
      .order('gtin')
      .range(from, from + pageSize - 1)
    if (error) throw new Error('Не удалось загрузить товары Teksher.')
    const rows = (data ?? []) as KizGtinCard[]
    rows.forEach((item) => {
      if (!item?.gtin || seen.has(item.gtin)) return
      seen.add(item.gtin)
      items.push(item)
    })
    if (rows.length < pageSize) break
  }
  return items
}

export async function fetchKizOrderSources(storeId: string): Promise<{
  products: KizWbProduct[]
  links: KizBarcodeLink[]
  gtins: KizGtinCard[]
}> {
  const client = db()
  const [productsResult, linksResult, gtinsResult] = await Promise.all([
    client.from('products').select('id,nm_id,vendor_code,name,brand,color,barcodes,photos,sizes').eq('store_id', storeId),
    client.from('fulfillment_product_gtin_links').select('wb_barcode,gtin').eq('store_id', storeId).eq('active', true),
    client.from('teksher_products').select('gtin,name,full_name,product_group_code,status').eq('store_id', storeId).eq('in_catalog', true).order('full_name'),
  ])
  if (productsResult.error) throw new Error('Не удалось загрузить товары магазина.')
  if (linksResult.error) throw new Error('Не удалось загрузить связки баркодов.')
  if (gtinsResult.error) throw new Error('Не удалось загрузить товары Teksher.')
  return {
    products: (productsResult.data ?? []) as KizWbProduct[],
    links: (linksResult.data ?? []) as KizBarcodeLink[],
    gtins: (gtinsResult.data ?? []) as KizGtinCard[],
  }
}

export async function saveKizBarcodeLink(storeId: string, barcode: string, gtin: string): Promise<void> {
  const client = db()
  const { error } = await client.rpc('set_kiz_barcode_gtin_link', {
    p_store_id: storeId,
    p_barcode: barcode,
    p_gtin: gtin,
  })
  if (error) throw new Error(kizLinkError(error))
}

export async function clearKizBarcodeLink(storeId: string, barcode: string): Promise<void> {
  const client = db()
  const { error } = await client.rpc('clear_kiz_barcode_gtin_link', {
    p_store_id: storeId,
    p_barcode: barcode,
  })
  if (error) throw new Error(kizLinkError(error))
}
