import { supabase } from '../lib/supabase'
import { DEFAULT_PERMISSIONS } from '../types'
import type { RolePermissions, Store } from '../types'

export type FbsWorkStore = Pick<
  Store,
  'id' | 'account_id' | 'name' | 'store_code' | 'marketplace' | 'supplier' | 'supplier_full' | 'address'
>

export interface FbsWorkContext {
  company_id: string
  company_name: string
  is_outsource: boolean
  connection_id: string | null
  permissions: RolePermissions
  stores: FbsWorkStore[]
}

export async function fetchFbsWorkContexts(homeAccountId: string): Promise<FbsWorkContext[]> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await (supabase as any).rpc('get_fbs_work_contexts', {
    p_home_account_id: homeAccountId,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    company_id: String(row.company_id),
    company_name: String(row.company_name ?? 'Компания'),
    is_outsource: row.is_outsource === true,
    connection_id: row.connection_id ? String(row.connection_id) : null,
    permissions: { ...DEFAULT_PERMISSIONS, ...((row.permissions ?? {}) as Partial<RolePermissions>) },
    stores: Array.isArray(row.stores) ? row.stores as FbsWorkStore[] : [],
  }))
}
