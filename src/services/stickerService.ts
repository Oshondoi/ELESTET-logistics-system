import { supabase } from '../lib/supabase'
import type { StickerTemplate, StickerFormValues, StickerBundle, StickerBundleItem } from '../types'
import { generateEAN13 } from '../lib/ean13'

export const fetchStickers = async (accountId: string): Promise<StickerTemplate[]> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('sticker_templates')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as StickerTemplate[]
}

export const createSticker = async (
  accountId: string,
  values: StickerFormValues,
): Promise<StickerTemplate> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const barcode = generateEAN13()
  const { data, error } = await supabase
    .from('sticker_templates')
    .insert({
      account_id: accountId,
      barcode,
      name: values.name.trim(),
      composition: values.composition.trim() || null,
      article: values.article.trim() || null,
      brand: values.brand.trim() || null,
      size: values.size.trim() || null,
      color: values.color.trim() || null,
      supplier: values.supplier.trim() || null,
      supplier_address: values.supplier_address.trim() || null,
      production_date: values.production_date.trim() || null,
      country: values.country.trim() || 'Кыргызстан',
      copies: values.copies,
      icon_wash: values.icon_wash,
      icon_iron: values.icon_iron,
      icon_no_bleach: values.icon_no_bleach,
      icon_no_tumble_dry: values.icon_no_tumble_dry,
      icon_eac: values.icon_eac,
    })
    .select()
    .single()
  if (error) throw error
  return data as StickerTemplate
}

export const updateSticker = async (
  accountId: string,
  stickerId: string,
  values: StickerFormValues,
): Promise<StickerTemplate> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('sticker_templates')
    .update({
      name: values.name.trim(),
      composition: values.composition.trim() || null,
      article: values.article.trim() || null,
      brand: values.brand.trim() || null,
      size: values.size.trim() || null,
      color: values.color.trim() || null,
      supplier: values.supplier.trim() || null,
      supplier_address: values.supplier_address.trim() || null,
      production_date: values.production_date.trim() || null,
      country: values.country.trim() || 'Кыргызстан',
      copies: values.copies,
      icon_wash: values.icon_wash,
      icon_iron: values.icon_iron,
      icon_no_bleach: values.icon_no_bleach,
      icon_no_tumble_dry: values.icon_no_tumble_dry,
      icon_eac: values.icon_eac,
    })
    .eq('id', stickerId)
    .eq('account_id', accountId)
    .select()
    .single()
  if (error) throw error
  return data as StickerTemplate
}

export const deleteSticker = async (accountId: string, stickerId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('sticker_templates')
    .delete()
    .eq('id', stickerId)
    .eq('account_id', accountId)
  if (error) throw error
}

/* ── Наборы стикеров ─────────────────────────────────────────────── */

export const fetchBundles = async (accountId: string): Promise<StickerBundle[]> => {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('sticker_bundles')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  // Если таблица ещё не создана — не крашим всё приложение
  if (error) return []
  return (data ?? []) as unknown as StickerBundle[]
}

export const createBundle = async (
  accountId: string,
  name: string,
  items: StickerBundleItem[],
): Promise<StickerBundle> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('sticker_bundles')
    .insert({ account_id: accountId, name: name.trim(), items: items as unknown as import('../types/supabase').Json })
    .select()
    .single()
  if (error) throw error
  return data as unknown as StickerBundle
}

export const updateBundle = async (
  accountId: string,
  bundleId: string,
  name: string,
  items: StickerBundleItem[],
): Promise<StickerBundle> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('sticker_bundles')
    .update({ name: name.trim(), items: items as unknown as import('../types/supabase').Json })
    .eq('id', bundleId)
    .eq('account_id', accountId)
    .select()
    .single()
  if (error) throw error
  return data as unknown as StickerBundle
}

export const deleteBundle = async (accountId: string, bundleId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('sticker_bundles')
    .delete()
    .eq('id', bundleId)
    .eq('account_id', accountId)
  if (error) throw error
}
