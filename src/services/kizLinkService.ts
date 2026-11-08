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

export async function fetchKizOrderSources(storeId: string): Promise<{
  products: KizWbProduct[]
  links: KizBarcodeLink[]
  gtins: KizGtinCard[]
}> {
  const client = db()
  const [productsResult, linksResult, gtinsResult] = await Promise.all([
    client.from('products').select('id,nm_id,vendor_code,name,brand,color,barcodes,photos,sizes').eq('store_id', storeId),
    client.from('fulfillment_product_gtin_links').select('wb_barcode,gtin').eq('store_id', storeId).eq('active', true),
    client.from('teksher_products').select('gtin,name,full_name,product_group_code,status').eq('store_id', storeId).order('full_name'),
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
