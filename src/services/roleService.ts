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

  const roleIds = roles.map((role) => role.id)
  if (roleIds.length === 0) return roles

  const { data: assignments, error: assignmentsError } = await supabase.rpc('get_role_assignments', {
    p_account_id: accountId,
  })

  if (assignmentsError) throw new Error(assignmentsError.message)
  if (!assignments?.length) return roles.map((role) => ({ ...role, assigned_users: [] }))
  const assignmentsByRole = new Map<string, ResolvedUser[]>()
  for (const assignment of assignments ?? []) {
    assignmentsByRole.set(assignment.role_id, [
      ...(assignmentsByRole.get(assignment.role_id) ?? []),
      {
        user_id: assignment.user_id,
        email: assignment.email,
        full_name: assignment.full_name,
        short_id: assignment.short_id,
      },
    ])
  }

  return roles.map((role) => {
    return {
      ...role,
      assigned_users: assignmentsByRole.get(role.id) ?? [],
    }
  })
}

const setRoleAssignments = async (roleId: string, userIds: string[]): Promise<void> => {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await supabase.rpc('set_role_assignments', {
    p_role_id: roleId,
    p_user_ids: userIds,
  })
  if (error) throw new Error(error.message)
}

export const createRoleInSupabase = async (accountId: string, values: RoleFormValues): Promise<Role> => {
  if (!supabase) throw new Error('Supabase не настроен')

  const { data, error } = await supabase
    .from('roles')
    .insert({
      account_id: accountId,
      name: values.name.trim(),
      permissions: values.permissions as unknown as import('../types/supabase').Json,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  const role = data as unknown as Role
  try {
    await setRoleAssignments(role.id, values.assigned_user_ids ?? [])
  } catch (assignmentError) {
    await supabase.from('roles').delete().eq('id', role.id)
    throw assignmentError
  }
  return { ...role, assigned_users: [] }
}

export const updateRoleInSupabase = async (roleId: string, values: Partial<RoleFormValues>): Promise<Role> => {
  if (!supabase) throw new Error('Supabase не настроен')

  const payload = {
    ...(values.name !== undefined ? { name: values.name.trim() } : {}),
    ...(values.permissions !== undefined ? { permissions: values.permissions as unknown as import('../types/supabase').Json } : {}),
  }

  const { data, error } = await supabase
    .from('roles')
    .update(payload)
    .eq('id', roleId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  if (values.assigned_user_ids !== undefined) {
    await setRoleAssignments(roleId, values.assigned_user_ids)
  }
  return { ...(data as unknown as Role), assigned_users: [] }
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
  return { ...(data as unknown as Role), assigned_users: [] }
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
