import { supabase } from '../lib/supabase'
import type { StickerTemplate, StickerFormValues } from '../types'
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
