import { supabase } from '../lib/supabase'

const localToday = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

export interface StickerPrintPreferences {
  show_wb_article: boolean
  show_seller_article: boolean
  supplier: string
  supplier_address: string
  production_date: string
  country: string
  icon_wash: boolean
  icon_iron: boolean
  icon_no_bleach: boolean
  icon_no_tumble_dry: boolean
  icon_eac: boolean
}

export interface StickerProductPrintOverride {
  name?: string
  composition?: string
  seller_article?: string
  brand?: string
  color?: string
  country?: string
  sizes?: Record<string, string>
}

export const defaultStickerPrintPreferences = (): StickerPrintPreferences => ({
  show_wb_article: true,
  show_seller_article: true,
  supplier: '',
  supplier_address: '',
  production_date: localToday(),
  country: '',
  icon_wash: false,
  icon_iron: false,
  icon_no_bleach: false,
  icon_no_tumble_dry: false,
  icon_eac: true,
})

export async function fetchStickerPrintPreferences(accountId: string, storeId: string): Promise<StickerPrintPreferences> {
  const defaults = defaultStickerPrintPreferences()
  if (!supabase || !accountId || !storeId) return defaults
  const db = supabase as any
  const { data, error } = await db
    .from('sticker_print_settings')
    .select('settings')
    .eq('account_id', accountId)
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw error
  return { ...defaults, ...((data?.settings as Partial<StickerPrintPreferences> | null) ?? {}) }
}

export async function saveStickerPrintPreferences(accountId: string, storeId: string, settings: StickerPrintPreferences): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const db = supabase as any
  const { error } = await db.from('sticker_print_settings').upsert({
    account_id: accountId,
    store_id: storeId,
    settings,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'account_id,store_id' })
  if (error) throw error
}

export async function fetchStickerProductOverrides(accountId: string, storeId: string): Promise<Map<string, StickerProductPrintOverride>> {
  const result = new Map<string, StickerProductPrintOverride>()
  if (!supabase || !accountId || !storeId) return result
  const db = supabase as any
  const { data, error } = await db
    .from('sticker_product_print_overrides')
    .select('product_id, overrides')
    .eq('account_id', accountId)
    .eq('store_id', storeId)
  if (error) throw error
  for (const row of data ?? []) result.set(String(row.product_id), (row.overrides ?? {}) as StickerProductPrintOverride)
  return result
}

export async function saveStickerProductOverride(
  accountId: string,
  storeId: string,
  productId: string,
  overrides: StickerProductPrintOverride,
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const db = supabase as any
  const { error } = await db.from('sticker_product_print_overrides').upsert({
    account_id: accountId,
    store_id: storeId,
    product_id: productId,
    overrides,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'account_id,store_id,product_id' })
  if (error) throw error
}
