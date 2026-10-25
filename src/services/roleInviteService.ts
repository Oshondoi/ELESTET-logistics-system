import { supabase } from '../lib/supabase'

export interface PublicRoleInvite {
  valid: boolean
  role_name?: string
  company_name?: string
  account_id?: string
}

export async function ensureRoleInviteLink(roleId: string): Promise<{ token: string; is_enabled: boolean }> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await (supabase as any).rpc('ensure_role_invite_link', { p_role_id: roleId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.token) throw new Error('Не удалось получить ссылку')
  return { token: String(row.token), is_enabled: Boolean(row.is_enabled) }
}

export async function setRoleInviteEnabled(roleId: string, enabled: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await (supabase as any).rpc('set_role_invite_enabled', { p_role_id: roleId, p_enabled: enabled })
  if (error) throw error
}

export async function fetchPublicRoleInvite(token: string): Promise<PublicRoleInvite> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await (supabase as any).rpc('get_public_role_invite', { p_token: token })
  if (error) throw error
  if (!data || typeof data !== 'object') return { valid: false }
  const row = data as Record<string, unknown>
  return {
    valid: row.valid === true,
    role_name: typeof row.role_name === 'string' ? row.role_name : undefined,
    company_name: typeof row.company_name === 'string' ? row.company_name : undefined,
    account_id: typeof row.account_id === 'string' ? row.account_id : undefined,
  }
}

export async function acceptRoleInvite(token: string): Promise<{ account_id: string }> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await (supabase as any).rpc('accept_role_invite', { p_token: token })
  if (error) throw error
  const row = data as Record<string, unknown> | null
  const accountId = row?.account_id
  if (typeof accountId !== 'string') throw new Error('Не удалось принять приглашение')
  return { account_id: accountId }
}
