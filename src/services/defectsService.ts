import { supabase } from '../lib/supabase'
import type { ProductDefect } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any

export async function fetchDefects(accountId: string, storeId?: string): Promise<ProductDefect[]> {
  let query = db()
    .from('product_defects')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  if (storeId) query = query.eq('store_id', storeId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ProductDefect[]
}

export async function addDefect(
  defect: Omit<ProductDefect, 'id' | 'created_at'>,
): Promise<ProductDefect> {
  const { data, error } = await db()
    .from('product_defects')
    .insert(defect)
    .select()
    .single()
  if (error) throw error
  return data as ProductDefect
}

export async function deleteDefect(id: string): Promise<void> {
  const { error } = await db().from('product_defects').delete().eq('id', id)
  if (error) throw error
}
