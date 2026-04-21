import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  cloneRoleToAccountInSupabase,
  createRoleInSupabase,
  deleteRoleFromSupabase,
  fetchRolesFromSupabase,
  updateRoleInSupabase,
} from '../services/roleService'
import type { Role, RoleFormValues } from '../types'

export const useRoles = (accountId: string | null) => {
  const [roles, setRoles] = useState<Role[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!accountId || !isSupabaseConfigured) {
      setRoles([])
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const data = await fetchRolesFromSupabase(accountId)
      setRoles(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки ролей')
    } finally {
      setIsLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void reload()
  }, [reload])

  const addRole = async (values: RoleFormValues): Promise<Role> => {
    if (!accountId) throw new Error('Компания не выбрана')
    const role = await createRoleInSupabase(accountId, values)
    setRoles((prev) => [...prev, role])
    return role
  }

  const updateRole = async (roleId: string, values: Partial<RoleFormValues>): Promise<Role> => {
    const updated = await updateRoleInSupabase(roleId, values)
    setRoles((prev) => prev.map((r) => (r.id === roleId ? updated : r)))
    return updated
  }

  const removeRole = async (roleId: string): Promise<void> => {
    await deleteRoleFromSupabase(roleId)
    setRoles((prev) => prev.filter((r) => r.id !== roleId))
  }

  const cloneRoleToAccount = async (role: Role, targetAccountId: string): Promise<void> => {
    await cloneRoleToAccountInSupabase(role, targetAccountId)
  }

  return {
    roles,
    isLoading,
    error,
    addRole,
    updateRole,
    removeRole,
    cloneRoleToAccount,
    reload,
  }
}
