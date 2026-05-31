import { supabase } from '../lib/supabase'
import type { ActiveOverride } from '../lib/plans'

export type { ActiveOverride }

export interface AccessOverrideRow {
  id: string
  scope: 'global' | 'account'
  account_id: string | null
  account_name: string | null
  type: 'trial' | 'plan'
  plan: 'seller' | 'operational' | null
  free_until: string // ISO date
  reason: string | null
  created_at: string
  is_active: boolean
}

/** Получить активное переопределение для аккаунта (user-facing RPC) */
export async function getActiveOverride(accountId: string): Promise<ActiveOverride | null> {
  if (!supabase) return null
  const { data, error } = await (supabase as any).rpc('get_active_override', { p_account_id: accountId })
  if (error || !data || (data as any[]).length === 0) return null
  return (data as any[])[0] as ActiveOverride
}

/** Получить все переопределения (admin) */
export async function adminGetOverrides(): Promise<AccessOverrideRow[]> {
  if (!supabase) return []
  const { data, error } = await (supabase as any).rpc('admin_get_access_overrides')
  if (error) throw new Error(error.message)
  return (data ?? []) as AccessOverrideRow[]
}

/** Создать переопределение (admin) — возвращает id */
export async function adminCreateOverride(params: {
  scope: 'global' | 'account'
  account_id?: string | null
  type: 'trial' | 'plan'
  plan?: 'seller' | 'operational' | null
  free_until: string // ISO date
  reason?: string | null
}): Promise<string> {
  if (!supabase) throw new Error('No supabase')
  const { data, error } = await (supabase as any).rpc('admin_create_override', {
    p_scope:      params.scope,
    p_account_id: params.account_id ?? null,
    p_type:       params.type,
    p_plan:       params.plan ?? null,
    p_free_until: params.free_until,
    p_reason:     params.reason ?? null,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/** Деактивировать переопределение (admin) */
export async function adminDeactivateOverride(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await (supabase as any).rpc('admin_deactivate_override', { p_id: id })
  if (error) throw new Error(error.message)
}

/** Получить системные настройки (admin) */
export async function adminGetSystemSettings(): Promise<Record<string, string>> {
  if (!supabase) return {}
  const { data, error } = await (supabase as any).rpc('admin_get_system_settings')
  if (error) throw new Error(error.message)
  const result: Record<string, string> = {}
  for (const row of (data ?? []) as { key: string; value: string }[]) {
    result[row.key] = row.value
  }
  return result
}

/** Сохранить системную настройку (admin) */
export async function adminUpsertSystemSetting(key: string, value: string): Promise<void> {
  if (!supabase) return
  const { error } = await (supabase as any).rpc('admin_upsert_system_setting', { p_key: key, p_value: value })
  if (error) throw new Error(error.message)
}
