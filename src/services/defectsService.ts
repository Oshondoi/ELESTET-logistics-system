import { supabase } from '../lib/supabase'
import type { ProductDefect } from '../types'

export async function fetchDefects(accountId: string, storeId?: string): Promise<ProductDefect[]> {
  let query = supabase
    .from('product_defects')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  if (storeId) query = query.eq('store_id', storeId)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function addDefect(
  defect: Omit<ProductDefect, 'id' | 'created_at'>,
): Promise<ProductDefect> {
  const { data, error } = await supabase
    .from('product_defects')
    .insert(defect)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteDefect(id: string): Promise<void> {
  const { error } = await supabase.from('product_defects').delete().eq('id', id)
  if (error) throw error
}
