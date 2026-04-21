import { supabase } from '../lib/supabase'
import type { ResolvedUser, Role, RoleFormValues } from '../types'

export const fetchRolesFromSupabase = async (accountId: string): Promise<Role[]> => {
  if (!supabase) throw new Error('Supabase не настроен')

  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  const roles = (data ?? []) as unknown as Role[]

  // Подтягиваем профили назначенных пользователей
  const userIds = roles.map((r) => r.assigned_user_id).filter(Boolean) as string[]
  if (userIds.length === 0) return roles

  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, full_name, short_id')
    .in('user_id', userIds)

  const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]))

  return roles.map((role) => {
    if (!role.assigned_user_id) return role
    const profile = profileMap.get(role.assigned_user_id)
    return {
      ...role,
      assigned_user_name: profile?.full_name ?? null,
      assigned_user_short_id: (profile?.short_id as number | undefined) ?? null,
    }
  })
}

export const createRoleInSupabase = async (accountId: string, values: RoleFormValues): Promise<Role> => {
  if (!supabase) throw new Error('Supabase не настроен')

  const { data, error } = await supabase
    .from('roles')
    .insert({
      account_id: accountId,
      name: values.name.trim(),
      permissions: values.permissions as unknown as import('../types/supabase').Json,
      assigned_user_id: values.assigned_user_id ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as unknown as Role
}

export const updateRoleInSupabase = async (roleId: string, values: Partial<RoleFormValues>): Promise<Role> => {
  if (!supabase) throw new Error('Supabase не настроен')

  const payload = {
    ...(values.name !== undefined ? { name: values.name.trim() } : {}),
    ...(values.permissions !== undefined ? { permissions: values.permissions as unknown as import('../types/supabase').Json } : {}),
    ...('assigned_user_id' in values ? { assigned_user_id: values.assigned_user_id ?? null } : {}),
  }

  const { data, error } = await supabase
    .from('roles')
    .update(payload)
    .eq('id', roleId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as unknown as Role
}

export const deleteRoleFromSupabase = async (roleId: string): Promise<void> => {
  if (!supabase) throw new Error('Supabase не настроен')

  const { error } = await supabase.from('roles').delete().eq('id', roleId)
  if (error) throw new Error(error.message)
}

// Клонирует роль в другую компанию (с тем же набором permissions)
export const cloneRoleToAccountInSupabase = async (
  role: Role,
  targetAccountId: string,
): Promise<Role> => {
  if (!supabase) throw new Error('Supabase не настроен')

  const { data, error } = await supabase
    .from('roles')
    .insert({ account_id: targetAccountId, name: role.name, permissions: role.permissions as unknown as import('../types/supabase').Json })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as unknown as Role
}

// Ищет пользователя по email, UUID или U{n} (короткий ID)
export const resolveAccountUser = async (
  accountId: string,
  params: { email?: string; userId?: string; shortId?: number },
): Promise<ResolvedUser | null> => {
  if (!supabase) throw new Error('Supabase не настроен')

  const { data, error } = await supabase.rpc('resolve_account_user', {
    p_account_id: accountId,
    p_email: params.email ?? null,
    p_user_id: params.userId ?? null,
    p_short_id: params.shortId ?? null,
  })

  if (error) throw new Error(error.message)
  if (!data || (data as ResolvedUser[]).length === 0) return null
  return (data as ResolvedUser[])[0]
}
