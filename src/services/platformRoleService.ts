import { supabase, isSupabaseConfigured } from '../lib/supabase'
import type { PlatformRole } from '../hooks/usePlatformRole'

export interface StaffMember {
  user_id: string
  email: string
  platform_role: PlatformRole
  short_id: number | null
}

export interface FoundUser {
  user_id: string
  email: string
  current_role: PlatformRole
}

export async function adminGetPlatformRoles(): Promise<StaffMember[]> {
  if (!isSupabaseConfigured || !supabase) return []
  const { data, error } = await (supabase as any).rpc('admin_get_platform_roles')
  if (error) throw new Error(error.message)
  return (data ?? []) as StaffMember[]
}

export async function adminSetPlatformRole(userId: string, role: PlatformRole): Promise<void> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase не настроен')
  const { error } = await (supabase as any).rpc('admin_set_platform_role', {
    p_user_id: userId,
    p_role: role,
  })
  if (error) throw new Error(error.message)
}

export async function adminFindUserByShortId(shortId: number): Promise<FoundUser | null> {
  if (!isSupabaseConfigured || !supabase) return null
  const { data, error } = await (supabase as any).rpc('admin_find_user_by_short_id', { p_short_id: shortId })
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return null
  const row = data[0] as { found_user_id: string; found_email: string; found_role: string }
  return { user_id: row.found_user_id, email: row.found_email, current_role: row.found_role as PlatformRole }
}
